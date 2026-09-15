<!-- PLAN-REVIEW-REPORT -->

# Plan Review: AWS + RDS Migration

- **Plan**: context/changes/aws-rds-migration/plan.md
- **Mode**: Deep
- **Date**: 2026-09-06
- **Verdict**: REVISE → SOUND (all 8 findings fixed in triage)
- **Findings**: 3 critical, 3 warnings, 2 observations

## Verdicts

| Dimension             | Verdict | After triage |
| --------------------- | ------- | ------------ |
| End-State Alignment   | FAIL    | PASS         |
| Lean Execution        | PASS    | PASS         |
| Architectural Fitness | WARNING | PASS         |
| Blind Spots           | FAIL    | PASS         |
| Plan Completeness     | FAIL    | PASS         |

## Grounding

12/12 paths ✓, 6/6 measured claims ✓ (14 `.rpc()` sites, 13/25 auth-shaped migrations, `major_version = 17`, storage confined to `candidate-cv.ts`, `origin = github.com/mariusz-czabaj/hire_track`, `ci.yml` triggers on `main` while `CLAUDE.md` says `master`). No `plan-brief.md`; no `docs/reference/contract-surfaces.md` (check skipped).

## Findings

### F1 — Phase 2 silently disables RLS; 2.2 plumbs the wrong GUC

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 2 goal statement, 2.1, 2.2
- **Detail**: RLS enforces today only because PostgREST connects as `authenticator` and per request sets `request.jwt.claims` + `SET LOCAL ROLE authenticated` — the sequence `supabase/tests/rls_verification.sql:16-21` reproduces by hand. `auth.uid()` reads that GUC and nothing else. A Drizzle/Kysely pool on the direct connection string authenticates as the database owner, who has BYPASSRLS: all 71 `TO authenticated` policies and 11 `SECURITY DEFINER` functions stop constraining anything, silently and with a green suite. 2.2's `app.user_id` is the Phase 4 GUC and does not close the gap.
- **Fix A ⭐ Recommended**: Set both GUCs in 2.2 and connect as a non-owner role.
  - Strength: Keeps Phase 2's "untouched" promise literally true; mechanism already proven in-repo.
  - Tradeoff: Requires transaction pinning (see F5).
  - Confidence: HIGH — the exact mechanism is checked into this repo.
  - Blind spot: Whether Supabase exposes an `authenticator`-equivalent login role on the direct connection string is unverified — spike at 2.1.
- **Fix B**: Accept RLS bypass through Phases 2–3 and move authz into the service layer now.
  - Strength: No GUC plumbing or transaction pinning.
  - Tradeoff: Discards the DB backstop during the longest phase; pre-empts the deferred 4.1 decision.
  - Confidence: MEDIUM.
  - Blind spot: Last-admin and per-operation-grant invariants would need service-layer equivalents first.
- **Decision**: FIXED via Fix A — Phase 2 goal rewritten, 2.1 now specifies a non-owner login role plus a spike, 2.2 sets all three GUCs, phase verification requires the denial tests to be seen failing against an owner connection, new Risks row added.

### F2 — Phase 3's verification cannot pass as sequenced

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3.2, Phase 3 Verification, Phase 4.4
- **Detail**: 3.2 restores `public` only, but `public`'s DDL depends on `auth.*` — 71 policies name `TO authenticated` (a role RDS lacks), 13 migrations call `auth.uid()`, and `auth.users` FKs dangle. Phase 3 then asserts `npm run test:rls` passes on RDS, but the rewrite enabling that is 4.4, one phase later. Mechanically, `test:rls` also hardcodes `docker exec -i supabase_db_10x-astro-starter`, which 3.5 deletes.
- **Fix**: Pull an `auth.*` compatibility shim forward as 3.2a — create `authenticated`/`anon`/`service_role` roles, `public.users` (4.3 moved forward) with FK repointing, and `auth.uid()` reading `request.jwt.claims`. 4.4 narrows to deleting the shim. Rewrite `test:rls` to take a connection string in 3.5.
- **Decision**: FIXED — 3.2a added, 3.2 now dumps `auth.users` explicitly, 4.3 marked moved, 4.4 rewritten as shim retirement, Risks row updated.

### F3 — No cutover, freeze, or rollback story for the RDS data move

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3.2, 3.4
- **Detail**: 3.2 dumps and restores; 3.4 repoints the connection string. Between them the app is live against Supabase, so any write in that window is lost. No read-only freeze, no maintenance window, no row-count reconciliation gate (it was listed as after-the-fact verification), and no path back if RDS misbehaves later. The Risks table had no row for data loss at the plan's only irreversible step.
- **Fix**: Add 3.6 cutover runbook — announce window → freeze writes at source → dump/restore/shim → reconcile per-table row counts as a gate → flip connection string → retain read-only Supabase as rollback target, naming the point after which rollback becomes a reverse migration.
- **Decision**: FIXED — 3.6 added as a six-step runbook, 3.4's deletions deferred until retention expires, two Risks rows added.

### F4 — No cost model for a migration whose premise is infrastructure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1.2, Phase 3.1, plan-wide
- **Detail**: `context/foundation/infrastructure.md` chose Cloudflare partly because "the Workers free tier covers MVP traffic with no billing required". This plan supersedes it with App Runner/Fargate + RDS + S3 + Secrets Manager, plus a NAT gateway if RDS is private — a floor in the tens of dollars a month against roughly zero, never stated.
- **Fix**: Add a Cost subsection under Phase 1 with monthly estimates per compute option and RDS size (including the no-NAT variant), record the override rationale in 1.6, and establish expected traffic volume, which `context/` does not capture anywhere.
- **Decision**: FIXED — cost paragraph added under 1.6, priced before 1.2 is decided; feeds 3.1's sizing gate.

### F5 — Connection pooling vs. per-request GUCs is unaddressed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2.1, 2.2, 2.3
- **Detail**: `SET LOCAL` survives only inside a transaction, on the connection that ran it. Today 20 call sites each construct a stateless `createClient(headers, cookies)`. A pool means every request-scoped GUC must wrap its queries in one transaction on one checked-out connection, and the seam must reach all 20 — but the current seam returns a client with no lifecycle. This gates 2.3's whole service-by-service port.
- **Fix**: Make the request-scoped seam 2.2's first deliverable — `withUserTx(locals, cb)` acquiring one connection, opening a transaction, setting the GUCs, passing a bound builder to the callback, resolved in middleware and reached via `context.locals`. Port `security-groups` against it and review the shape before the other five follow.
- **Decision**: FIXED — seam-shape paragraph added to 2.2; review step recorded as Progress 2.8.

### F6 — No `## Progress` section; `/10x-implement` will fail to parse the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: end of plan.md
- **Detail**: The plan had no `## Progress` block and no `#### Automated Verification:` / `#### Manual Verification:` headings — each phase carried a prose `**Verification:**` line instead.
- **Fix**: Restructure verification prose into Automated/Manual bullets and append a `## Progress` section keyed to the plan's own step numbers.
- **Decision**: FIXED — all five phases converted, phase headings normalised to the `## Phase N: <name>` contract, and a 33-step `## Progress` section appended.

### F7 — Phase count and sizing table both omit Phase 0

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Overview; "Rough sizing"
- **Detail**: Overview said "five independently deployable phases" against six (0–4), and the sizing table skipped Phase 0 — the phase carrying the plan's own flagged genuine-failure risk.
- **Fix**: Say six; add a Phase 0 row noting the open-ended e2e Docker spike.
- **Decision**: FIXED

### F8 — "CV bytes never transit the server" is true for upload, not download

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries; Phase 4.5
- **Detail**: `src/lib/services/candidate-cv.ts:197` calls `.download()`, pulling the whole blob through the server. Only uploads are presigned, and the workerd body-limit rationale stops applying once Phase 1 lands on Node.
- **Fix**: Narrow the claim to uploads; make 4.5 prefer presigned GET rather than treating it as a coin flip.
- **Decision**: FIXED
