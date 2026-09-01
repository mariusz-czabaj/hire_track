<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Recruitment List & Candidate Kanban Board (S-01)

- **Plan**: `context/changes/recruiter-views-kanban-board/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-01
- **Verdict**: REVISE → **SOUND** (all 7 findings fixed in the plan)
- **Findings**: 2 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict | After fixes |
|-----------|---------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | FAIL | PASS |

## Grounding

10/10 paths ✓, 4/4 symbols ✓, brief↔plan ✓. Two riskiest claims verified by execution against the running local Supabase stack rather than by inspection.

## Findings

### F1 — RecruitmentStatus cannot be derived from generated types

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1, change #5 (Shared DTOs)
- **Detail**: The plan instructed that `RecruitmentStatus` be "derived from the generated enum-ish column type rather than hand-written". Running `supabase gen types typescript --local` shows `status: string` — the column is `text` + CHECK, not a Postgres enum, so no union is emitted. The real `operation` enum *does* generate a union, which is the likely source of the error. The implementer would follow an impossible instruction and then improvise a cast that `strictTypeChecked` rejects.
- **Fix A ⭐ Recommended**: Hand-write the union as a zod enum; parse at the service boundary
  - Strength: No schema change; one zod enum is the single source for the DTO type, endpoint validation and filter options.
  - Tradeoff: The union can drift from the CHECK constraint — a status added in SQL won't fail typecheck.
  - Confidence: HIGH — verified generator output; zod parse is the standard narrowing idiom.
  - Blind spot: Whether S-02 wants to add statuses later wasn't surveyed.
- **Fix B**: Convert `status` to a real Postgres enum in the Phase 1 migration
  - Strength: Generated types give the union for free and can never drift.
  - Tradeoff: Alters an F-01 table already closed out; `ALTER TYPE` is more rigid than a CHECK; affects S-02's insert path.
  - Confidence: MEDIUM — mechanically simple, but edits a reviewed foundation table.
  - Blind spot: Whether F-01 chose text+CHECK deliberately for flexibility — migration comments don't say.
- **Decision**: FIXED via Fix A — plan now explicitly forbids deriving it, names the zod enum as single source, and requires any future status migration to update the union in the same commit.

### F2 — Progress section under-enumerates Phase 5 manual criteria

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `## Progress` → Phase 5, Manual
- **Detail**: Phase 5's body listed 7 Manual Verification bullets while Progress enumerated 6; item 5.8 silently merged "admin sees not-found" with "nonexistent/non-numeric id handling". Progress is the mechanical contract `/10x-implement` parses, so a merged item lets one verification be checked off without being performed.
- **Fix**: Split 5.8 into two items, renumbering the remainder.
- **Decision**: FIXED — Phase 5 now runs 5.5–5.11. Validated all six phases mechanically afterwards: body↔Progress counts match, numbering is continuous, no checkboxes outside Progress, exactly one Progress heading.

### F3 — Candidate-count query shape unspecified; N+1 risk

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2, change #3 (`listRecruitments`)
- **Detail**: The plan said counts "come from `candidate_recruitments`" and called it "a grouped count query", but supabase-js has no GROUP BY. Without a named contract the likely implementation is one count query per row — an N+1 the plan's own `<2s` NFR discussion never anticipates. Verified the correct approach against the live DB: `select=id,title,status,candidate_recruitments(count)` returns `"candidate_recruitments":[{"count":5}]` in a single RLS-respecting query.
- **Fix**: Pin the select string and array-wrapped result shape in the service contract, with an explicit "single query, no per-row counts" note.
  - Strength: Executed against the running database; one round-trip; counts stay RLS-scoped.
  - Tradeoff: Typed inference over embedded aggregates is awkward; needs a narrow local row type.
  - Confidence: HIGH — verified by execution.
  - Blind spot: How cleanly the generated `Database` type infers the embedded count under `strictTypeChecked` is untested.
- **Decision**: FIXED — contract now names the select string, the `row.candidate_recruitments[0]?.count ?? 0` mapping, and requires a narrow local type rather than a widening cast.

### F4 — Two islands hand-roll identical fetch/loading/error state

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 change #5, Phase 5 change #2
- **Detail**: Both islands fetch a JSON endpoint and each owns loading, empty, error and 401 handling. The plan never created `src/components/hooks/` — a directory CLAUDE.md mandates and research confirmed absent. This is the repo's first client-fetch pattern and S-02, S-04, S-05 and S-06 will each copy whatever shape lands, so the duplication compounds six times.
- **Fix**: Extract a minimal typed fetch hook to `src/components/hooks/useApiResource.ts`, consumed by both islands.
  - Strength: One home for the `res.ok` branch, `ApiErrorBody` parse and 401 path; establishes the required hooks directory.
  - Tradeoff: An abstraction introduced at two call sites, before its third consumer exists.
  - Confidence: MEDIUM — two consumers is the usual threshold, and four slices are queued behind it.
  - Blind spot: Whether S-04's mutations want the same hook shape.
- **Decision**: FIXED — added as Phase 4 change #4; both islands now consume it, and it is the designated home for the F7 401 behavior.

### F5 — Two decisions deferred to the implementer as conditionals

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 change #3, Phase 6 change #4
- **Detail**: Phase 3 said "only if stub typing proves genuinely obstructive, add a narrowly scoped override"; Phase 6 said "if provisioning Supabase in CI proves unreliable... gate the CI job behind a documented condition". Both leave a judgment call mid-implementation, which the planning convention forbids.
- **Fix**: Decide both now — no eslint override (typed stub builders instead), and run E2E in CI unconditionally.
- **Decision**: FIXED — Phase 3 now states no override is added and prescribes typed stub builders; Phase 6 states the job runs unconditionally, with caching as the answer to slow provisioning rather than gating.

### F6 — No ongoing guard that committed DB types match migrations

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 change #3 and success criteria
- **Detail**: "`npm run db:types` produces no diff" was a one-time Phase 1 check. After any later migration, stale committed types still typecheck cleanly — the mismatch surfaces at runtime, not at build time. Six slices of migrations are queued.
- **Fix**: Note the regeneration rule in Migration Notes and add a CI drift check.
- **Decision**: FIXED — Migration Notes now carries the rule, and Phase 6's CI job regenerates and fails on a non-empty diff (criterion 6.5, verified by deliberately committing a stale file once).

### F7 — 401 mid-session behavior unspecified for islands

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 change #1, Phase 4 change #5
- **Detail**: The page is server-protected but the island fetches afterwards. If the session expires in between, the new `/api` guard returns 401 JSON and the island falls into its generic error state, showing "failed to load" instead of sending the user to sign in.
- **Fix**: Specify that a 401 from any island fetch redirects to `/auth/signin`, distinct from the generic error state.
- **Decision**: FIXED — specified in the `useApiResource` contract, with Phase 4 manual criterion 4.10 verifying it by clearing the session cookie and triggering a refetch.

## Notes

- Not flagged, as they were explicit user decisions rather than defects: the six-phase shape, the client-fetch architecture over SSR, and adopting both Vitest and Playwright.
- Verification method worth recording: F1 and F3 were settled by running the generator and the query against the live local stack. Both would have read as plausible under inspection alone — F1 was in fact wrong, and F3's stated approach was unimplementable as written.
