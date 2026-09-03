<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Recruiter Creates Recruitment Implementation Plan

- **Plan**: context/changes/recruiter-creates-recruitment/plan.md
- **Mode**: Deep
- **Date**: 2026-09-01
- **Verdict**: REVISE (all findings fixed during triage — see Decisions)
- **Findings**: 1 critical, 3 warnings, 1 observation — all FIXED

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

## Grounding

9/9 paths ✓, 4/4 symbols ✓, brief↔plan ✓

## Findings

### F1 — Phase 4 assumes an integration-test harness that doesn't exist

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 2 (success criteria) & Phase 4 — API integration tests
- **Detail**: Phase 2 and Phase 4 both require "Integration tests pass...against local Supabase, all 3 seeded role fixtures" from Vitest. Verified: the only existing Vitest test (`src/lib/services/recruitments.test.ts`) mocks Supabase entirely via a hand-rolled `FakeQueryBuilder` — never touches a real database. The only thing that actually hits local Supabase with role-based auth is `supabase/tests/rls_verification.sql` (raw SQL, not Vitest) and Playwright E2E (browser-level, not API-level). No harness exists for "sign in as a seeded user, call `POST /api/recruitments` over HTTP, assert the response" from Vitest.
- **Fix A ⭐ Recommended**: Build a minimal Vitest+HTTP integration harness in Phase 2
  - Strength: Sign in as each seeded user via `supabase-js` against the local instance (same credentials as `tests/e2e/support/auth.ts`'s `SEEDED_USERS`), issue real `fetch()` calls to the local Astro server with the session attached — the same shape `rls_verification.sql` already proves at the SQL layer, moved to HTTP.
  - Tradeoff: Needs a running Astro server during `npm run test` — adds test-setup complexity not present in today's pure-unit suite.
  - Confidence: MED — seeded-user credentials and local Supabase connection confirmed to exist; running Astro server-side during Vitest is a new pattern for this repo.
  - Blind spot: Whether CI already runs a local Supabase + Astro server for E2E (and can be reused here) wasn't verified.
- **Fix B**: Drop Vitest-level API integration tests, rely on rls_verification.sql + E2E
  - Strength: No new test infrastructure — reuses the two harnesses that already exist.
  - Tradeoff: Loses fast, isolated endpoint-level coverage (e.g. exact 422/`fields` shape, exact 403 vs 404 mapping) that only an HTTP-level test catches without a full browser.
  - Confidence: HIGH — both fallback harnesses are confirmed working today.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A — harness added as Phase 2 item 5)

### F2 — No UI refresh after status mutation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3, item 4 — Status control
- **Detail**: `KanbanBoard.tsx` is purely read-only today — no mutation, no refetch, no drag/drop — and its data comes from `useApiResource`, which only fetches once on mount, no exposed `refetch`. The plan's status-control item never states how the board reflects the new status afterward — a successful PATCH leaves the displayed badge stale until a manual reload.
- **Fix**: Specify the post-mutation UI behavior explicitly: either (a) the mutation hook triggers a full-page reload/redirect, or (b) `useApiResource` gains a `refetch()` exposed and called after a successful status mutation. Add this to Phase 3 item 4's Contract.
- **Decision**: FIXED (option b — refetch())

### F3 — `api-response.ts`'s `jsonError` isn't in the Phase 2 change list

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, item 1 — Types and schemas
- **Detail**: `jsonError(status, code, message)` builds `ApiErrorBody` with only `{code, message}` — no parameter for the new optional `fields`. The plan only lists `src/types.ts` as a Phase 2 change target; the constructor that actually populates the new field is missing from Changes Required.
- **Fix**: Add `src/lib/api-response.ts` as a Phase 2 change entry: extend `jsonError` to accept an optional 5th `fields?: Record<string,string>` param and include it in the constructed body when present.
- **Decision**: FIXED

### F4 — `[id].ts` alongside the existing `[id]/` directory breaks the established routing convention

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2, item 4 — Status update endpoint
- **Detail**: `src/pages/api/recruitments/[id]/board.ts` already exists as a directory-based dynamic route. The plan's proposed `src/pages/api/recruitments/[id].ts` resolves to a different path so it isn't a hard collision, but it puts a file and a directory with the same param name as direct siblings — an inconsistent convention the codebase hasn't used before.
- **Fix**: Use `src/pages/api/recruitments/[id]/index.ts` instead of `[id].ts`, keeping the dynamic segment consistently expressed as a directory across the whole `recruitments` route tree.
- **Decision**: FIXED

### F5 — Confirm `private.` schema-qualification before writing the new RPC

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1, item 1 — New migration
- **Detail**: Every existing `security definer` function was found consistent with a `private` schema convention via grep context — not verified at the level of reading the literal `CREATE FUNCTION private.xxx` statement side-by-side in both files.
- **Fix**: Before writing the migration, open both files and confirm the exact `CREATE FUNCTION private.<name>` qualification, then copy it verbatim for `create_recruitment`.
- **Decision**: FIXED
