<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Recruiter Creates Recruitment

- **Plan**: context/changes/recruiter-creates-recruitment/plan.md
- **Scope**: Full plan (Phases 1–4, all complete)
- **Date**: 2026-09-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 7 observations
- **Triage**: 3 fixed (F1, F2, F3), 1 fixed via added test coverage (F7), 3 skipped as intentional/low-value (F4, F5, F6)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Automated verification (re-run live)

- `npm run lint` — pass (5 pre-existing `no-console` warnings, 0 errors)
- `npm run build` — pass
- `npm run test` — 18/18 pass (recruitments.test.ts, CreateRecruitmentForm.test.tsx)
- `npm run test:integration` — 7/7 pass (index.integration.test.ts, all 3 seeded roles + empty-group/missing-field 422s)
- `supabase/tests/rls_verification.sql` via `docker exec ... psql` (per the F-01 lesson that `supabase db query --local -f` can't run a multi-statement script) — "RLS verification passed", all assertions including the new RPC scenarios
- `npm run test:e2e` — 6/6 pass on a clean DB (an initial run showed one failure caused by running integration tests, which leave real rows behind, before e2e without an intervening `supabase db reset --local` — a self-inflicted ordering issue, not a product defect; CI already guards against this with its own reset step)

## Findings

### F1 — RPC lives in `public`, not `private`, schema

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20260901144455_create_recruitment_function.sql
- **Detail**: The plan's contract specifies `private.create_recruitment`, mirroring `private.has_operation`. The shipped function is `public.create_recruitment`. This is a necessary deviation, not an oversight: PostgREST/`supabase.rpc()` can only call functions exposed via the `public` (or `graphql_public`) schema, so a `private`-schema function would be unreachable from the client. All the hardening the plan actually cared about is intact — `security definer`, `set search_path = ''`, fully-qualified `public.*` references, the `has_operation('recruitment.write')` re-check, and `execute` granted to `authenticated` only.
- **Fix**: None needed — update the plan's Phase 1 contract text to say `public.create_recruitment` so future readers aren't misled by the stale `private.*` reference.
- **Decision**: FIXED — plan.md's Phase 1 §1 contract updated to reference `public.create_recruitment` and document why (PostgREST can't expose `private`-schema RPCs).

### F2 — FK violation on an invalid group id falls through to a generic 500

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/recruitments/index.ts:71-83 (error mapping), supabase/migrations/20260901144455_create_recruitment_function.sql:47-50 (FK)
- **Detail**: The POST handler special-cases Postgres error codes `42501` (not authorized) and `22023` (empty group array) into 403/422. An FK violation (`23503`) from a nonexistent `group_id` isn't mapped and falls through to a generic 500. The UI can't trigger this (group ids always come from `/api/security-groups`), so this only affects a malformed direct API call.
- **Fix**: Map `23503` to a 422 alongside the existing branches, for parity with the other validated failure modes.
- **Decision**: FIXED — added a `23503` branch mapping to `422 invalid_request` in `src/pages/api/recruitments/index.ts`.

### F3 — `createRecruitment`'s post-insert re-fetch isn't covered by the RPC's transaction

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/recruitments.ts:60-96
- **Detail**: `createRecruitment` calls the RPC, then does a second `select` to build the DTO. If that second call fails (e.g. a transient blip), the recruitment is already committed but the client gets a 500 with no id — the row exists but the UI has no way to reach it without a manual list refresh. Not data corruption, just a UX gap on an already-narrow failure window.
- **Fix**: Have the RPC itself `returning` the full row instead of a bare id, to remove the extra round trip and the window entirely.
- **Decision**: FIXED — new migration `20260901150000_create_recruitment_returns_row.sql` changes the RPC to `returns public.recruitments` (full row via `insert ... returning * into`); `createRecruitment` now maps that row directly with no second query; unit test, RLS verification SQL, and all automated verification re-run and passing.

### F4 — `p_group_ids` isn't scoped to groups the caller belongs to

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260901144455_create_recruitment_function.sql:47-50
- **Detail**: Any user with `recruitment.write` can link a new recruitment to any existing security group, including ones they aren't a member of — the RPC only checks the blanket operation, not per-group membership. This matches the pre-existing `recruitment_security_groups_insert` RLS policy's behavior exactly, so it's consistent with prior design rather than a regression introduced by this slice.
- **Fix**: None — flagging for awareness only; would need a product decision to change, and is out of this slice's scope.
- **Decision**: SKIPPED — consistent with existing design, not a regression; out of scope.

### F5 — Hardcoded test password in the new integration harness

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/test-support/integration-client.ts:16
- **Detail**: `PASSWORD = "password123"` for seeded local accounts. Fine for a local-only stack; only a concern if these seeded credentials could ever exist in a shared or deployed Supabase project.
- **Fix**: None needed now — worth a one-line confirmation that seeding stays local-stack-only if that's ever in doubt.
- **Decision**: SKIPPED — local-only test fixture, no real risk.

### F6 — `useApiResource.refetch()` duplicates the mount-effect's fetch logic

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/hooks/useApiResource.ts:75-100
- **Detail**: `refetch()` re-implements the effect's fetch/state-transition logic nearly verbatim rather than sharing an extracted `load` function. The code comments explain this is deliberate, to avoid tripping the `react-hooks/set-state-in-effect` lint rule. Reasonable trade-off; flagged only because the duplication is a maintenance risk if one copy gets a new response-status branch and the other doesn't.
- **Fix**: None needed now — leave as documented; revisit if the two copies drift.
- **Decision**: SKIPPED — deliberate, documented trade-off; leave as-is.

### F7 — Unclear whether a Hiring Manager sees a clickable-but-dead status control

- **Severity**: OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/components/recruitments/KanbanBoard.tsx (StatusControl), tests/e2e/recruitments.spec.ts:63-70
- **Detail**: `StatusControl` renders one button per `recruitmentStatusSchema` option with no client-side role gating (by design — RLS is the enforcement boundary). The e2e assertion for the Hiring Manager view only checks that the kanban columns (`[data-testid="kanban-columns"]`) render zero action buttons; it doesn't explicitly assert on the StatusControl buttons living outside that container. If a Hiring Manager does see clickable status buttons, clicking one gets a clean 404 (no crash, RLS still blocks the write) — so this is at most a UX smell, not a security gap.
  - Approach A ⭐ Recommended: Add an explicit e2e assertion (or a quick manual check) confirming whether the Hiring Manager sees the StatusControl buttons at all, and if they do, that clicking one surfaces a clean denial rather than silent failure. · Strength: Closes the actual gap in test coverage with a small addition, no product-behavior change. · Tradeoff: One more assertion to maintain. · Confidence: HIGH — the existing 404-on-PATCH path already handles this correctly server-side; this only adds visibility. · Blind spot: Haven't manually verified in-browser what a Hiring Manager currently sees.
  - Approach B: Leave as-is — RLS already prevents any actual state change, so a dead button is cosmetic only. · Strength: Zero effort, no regression risk. · Tradeoff: A confusing UX rough edge ships un-flagged for a later slice to rediscover. · Confidence: MEDIUM — depends on how much the team cares about UX polish for read-only roles right now. · Blind spot: Same as above.
- **Decision**: FIXED via Approach A — added an e2e assertion (`tests/e2e/recruitments.spec.ts`, "Hiring Manager sees the identical read-only board") confirming the Hiring Manager does see `StatusControl` buttons (no client-side gating, as designed) and that clicking one surfaces a clean denial with no state change. Also added a `data-testid="status-control"` to `KanbanBoard.tsx` for the assertion to target.

  **Investigation note**: while wiring this up, an initial version of the test appeared to show the Hiring Manager successfully changing the recruitment's status — a potential privilege-escalation bug. Traced via a Playwright network trace and a direct isolated `fetch` reproduction: the app/RLS layer was never actually compromised. The seeded "Backend Engineer" recruitment's status is `'live'` in `supabase/seed.sql` (not `'draft'` as assumed when the test was first written); the test's first version clicked the already-current "Live" button, which is a no-op in the UI (`handleChange` bails when `next === status`) and never sent a PATCH at all. Fixed by targeting "Draft" (a genuinely different status) instead — that version correctly reproduces and asserts the 404 denial with no persisted change. No code fix was needed; this was a test-authoring mistake, not a defect. Confirmed via `docker exec ... psql` running the PATCH as Hiring Manager directly against Postgres and via a clean-session HTTP fetch, both correctly denied (0 rows / 404) throughout.
