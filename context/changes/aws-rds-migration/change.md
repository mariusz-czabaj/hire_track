---
change_id: aws-rds-migration
title: Migrate from Cloudflare Workers + Supabase to AWS + RDS Postgres
status: plan_reviewed
created: 2026-09-06
updated: 2026-09-06
archived_at: null
---

## Notes

from user request — "migrate the service to AWS and RDS DB"

### 2026-09-06 — Scoping and phase ordering decided

**"Migrate to Postgres first" is a no-op as stated.** Supabase _is_ Postgres. The step the user was reaching for is
decoupling from the Supabase **SDK surface** (PostgREST, GoTrue, Storage) while still pointed at Supabase's own
database. That is a real and valuable intermediate state; it is just not a database migration.

**RDS replaces one of four Supabase subsystems.** In use here: Postgres (→ RDS), PostgREST (→ SQL client, no AWS
equivalent), GoTrue auth (→ Cognito or self-hosted), Storage (→ S3). Sizing the work as "swap the DB" undercounts
by roughly 4x.

**Phase order was inverted from the user's initial proposal, for a runtime reason.** The instinct — decouple from
the vendor before moving infra — is normally right. It is wrong here because `wrangler.jsonc` runs `workerd`, which
cannot open ordinary TCP connections to Postgres; a SQL-client rewrite performed while still on Cloudflare would
need Hyperdrive or a fetch-based driver as scaffolding, thrown away one phase later. Moving to a Node runtime on
AWS first is therefore the _enabling_ step, not the risky one. Decided by user 2026-09-06.

**The app keeps a deployable, green-test state after every phase.** Phases 1 and 2 each leave Supabase functional;
the vendor cutover is concentrated in Phases 3–4. Stopping after Phase 2 still yields most of the
vendor-independence benefit.

### 2026-09-06 — Coupling audit (measured, not estimated)

- **48 files under `src/` reference Supabase**, of which ~40 are data-access (`.from().select()`) in services and
  API routes.
- **14 `.rpc()` call sites** across **13 distinct Postgres functions**.
- **13 of 25 migrations reference `auth.uid()` / `auth.jwt()` / `auth.users`** — this, not the table DDL, is what
  makes the schema Supabase-shaped.
- **Storage is confined to `src/lib/services/candidate-cv.ts`** plus its 3 CV endpoints (`createSignedUploadUrl`,
  `download`, `remove`) — narrower than expected, and a clean S3 swap.
- **Direct GoTrue/PostgREST test coupling is in exactly 3 files**, not scattered across all 8 integration suites:
  `authorization.integration.test.ts`, `candidates-cv.integration.test.ts`,
  `security-groups.integration.test.ts`. These use `getAccessTokenForRole` / `supabaseRestUrl` /
  `SUPABASE_ANON_KEY` to assert _around_ the app, and cannot be ported as-is — they must become direct SQL
  assertions. The other 5 suites go through the app's own HTTP surface and survive untouched.

### 2026-09-06 — Open decision, deliberately deferred to Phase 4

**Whether to keep RLS.** Recommendation on record: keep it, via a per-request `SET LOCAL app.user_id` GUC, and
rewrite the policies' `auth.uid()` references against that. The alternative — moving authorisation into the service
layer — is faster but discards a database-level backstop that `supabase/tests/rls_verification.sql` currently
proves, and which enforces non-trivial invariants (security groups, per-operation grants, the last-admin
invariant). Not decided yet; Phase 4 must open with this decision.

### 2026-09-06 — GitHub → Bitbucket added, sequenced first

**Added to scope by user request.** Placed as **Phase 0**, ahead of the AWS move, for the same reason the
Cloudflare step precedes the data-access rewrite: Phase 1.5 was going to rewrite `ci.yml` to build and push to ECR.
Doing that on GitHub Actions and then porting the result to Bitbucket Pipelines means writing the deploy pipeline
twice. Porting CI **once**, as a like-for-like lift, before any deploy logic exists, is strictly less work.

**The `ci` step ports trivially; the `e2e` step is the real risk.** `.github/workflows/ci.yml` runs `supabase start`
(~10 containers) on an `ubuntu-latest` runner. Bitbucket Pipelines caps the Docker service's memory far more
tightly, and the stack may not fit even at `size: 2x`. This is the one item in Phase 0 that can genuinely fail, so
it is spiked first (0.4) rather than discovered at the end.

**Documented fallback if it does not fit:** move only the `ci` step to Bitbucket, leave `e2e` on GitHub Actions
temporarily, and collapse it onto Bitbucket at **Phase 3** — which replaces the entire Supabase Docker stack with a
single `postgres:17` container and dissolves the memory constraint. This keeps Phase 0 unblocked instead of turning
a one-day task into an open-ended one.

**The e2e job's polling bash must be ported verbatim, not tidied.** Its readiness probes and sign-in retry loop
encode several separately-diagnosed CI flakes — Astro/Vite lazily reloading a route's dependency graph on first
request (one probe added per route, four times over), and GoTrue/PostgREST clock skew right after `supabase start`
producing `PGRST303` on the first authenticated call. It is plain shell and carries over unchanged.

**Three GitHub-specific mechanics have no Bitbucket equivalent** and need real translation, not a syntax swap:
`actions/checkout` + `actions/setup-node` (→ a `node:22` image + cache definition), `supabase/setup-cli@v1` (→
explicit install; the CLI is already a devDependency), and `$GITHUB_ENV` (→ no cross-step env persistence, so the
Supabase-status export and its consumer must merge into one shell step).

**Phase 1.5 should use Bitbucket OIDC** to assume the AWS deploy role, rather than storing long-lived AWS access
keys as repository variables.

**Incidental finding:** `CLAUDE.md`'s CI section documents GitHub Actions _and_ a `master` branch, but `ci.yml`
triggers on `main`. Already stale today; Phase 0.6 corrects both.
