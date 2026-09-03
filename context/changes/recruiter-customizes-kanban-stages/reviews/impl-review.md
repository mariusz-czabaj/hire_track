<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Recruiter Customizes Kanban Stages Implementation Plan

- **Plan**: context/changes/recruiter-customizes-kanban-stages/plan.md
- **Scope**: Phase 6 of 6 (full plan review)
- **Date**: 2026-09-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Findings

### F1 — RLS assertion (13) doesn't actually exercise the admin-update policy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/rls_verification.sql (assertion 13, "An Administrator user updates a global default stage's name")
- **Detail**: The assertion runs `update kanban_stages set name = 'New' where recruitment_id is null and name = 'New'`. On a fresh seed no default stage is named "New" at that point in the harness's stage-name lifecycle in a way that guarantees a match reliably across future seed changes, and more importantly the predicate is tautological (`name = 'New'` on both sides of the `set`) — the statement "succeeds" whether or not any row actually matches, and if it does match, it doesn't change anything, so `UPDATE 0` and `UPDATE 1` both pass the assertion silently. It never proves the `kanban_stages_update` policy's `USING`/`WITH CHECK` actually admits an administrator's write to a real row.
- **Fix**: Change the assertion to update a value that's verifiably different (e.g. rename to a scratch value and assert the row count via `GET DIAGNOSTICS`, or select the row afterward and assert the name changed), so a real UPDATE is proven to have occurred under the policy.
- **Decision**: FIXED — assertion now renames to `'RLS Test Renamed Stage'` with `returning name into v_updated_name` and asserts it stuck; verified the assertion actually fails when a non-admin (HR) is substituted (RLS silently no-ops the update, 0 rows).

### F2 — `.github/workflows/ci.yml` changed outside the plan's file list

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .github/workflows/ci.yml
- **Detail**: Three `fix(ci):` commits landed interleaved with the feature phases (dev-server readiness probe, DB reset ordering, background dev-server cleanup), none mentioned in plan.md. Each is a well-isolated, well-justified CI flake fix discovered live during Phase 4/6 verification (not feature scope creep), but the plan document itself was never updated to note it.
- **Fix**: Add a short addendum note to plan.md (or change.md's Notes section) recording the CI fix and linking the commits, so future readers of the plan aren't surprised by an untracked file in the diff.
- **Decision**: FIXED — added a note to `change.md`'s Notes section recording commit `1f3a94f` and the root cause (only that one CI commit belongs to this change; the other two `fix(ci):` commits in git log predate it and belong to the prior change).

### F3 — `update_default_stages` has no automated test coverage

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/migrations/20260901162000_kanban_stage_rpcs.sql (lines 114–228)
- **Detail**: Per the plan's explicit scope ("No admin UI for the global defaults... the screen belongs to S-07"), this RPC intentionally has no app-facing caller yet, and Phase 2's Automated success criteria never required a test file for it (only migration-applies / db:types-clean / lint). I manually verified its two-phase renumber and referenced-removal refusal via `psql` during Phase 2's manual gate, but that verification isn't captured as a repeatable automated test — so a future refactor of this RPC has no regression safety net until S-07 wires it up.
- **Fix**: Optional now; when S-07 builds the admin surface, add integration coverage for `update_default_stages` at that time (or add a lightweight `rls_verification.sql`-style script now if the team wants a safety net sooner).
- **Decision**: FIXED — added `rls_verification.sql` assertions (16)-(18) covering rename-in-place + two-phase renumber, the PA002 referenced-removal refusal, and a net removal+addition in one call. **Assertion (18) caught a real bug**: net additions were being inserted _before_ the removal-cleanup delete, and a freshly inserted row's auto-generated id was never in the submitted-id list, so the cleanup step immediately deleted every row the same call had just inserted. Fixed via a new migration, `supabase/migrations/20260901180501_fix_update_default_stages_delete_order.sql` (CREATE OR REPLACE, reordering delete-before-insert), following this repo's convention of never editing an already-merged migration. Re-verified: all 18 RLS assertions pass, full local CI (lint/db:types/unit/build) clean.

### F4 — `PA002` (stage_referenced) errcode is unmapped in the stages endpoint

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/recruitments/[id]/stages.ts:25-42 (`handleStageRpcError`)
- **Detail**: `PA002` is only raised by `update_default_stages`, which no route currently calls (see F3), so this is currently dead code, not a live gap. If/when an admin endpoint is added for the defaults RPC, `handleStageRpcError` (or its own mapper) will need a `PA002 → 422` case, or a `PA002` will silently fall through to the generic 500.
- **Fix**: No action needed now; flag as a checklist item when S-07's admin endpoint for `update_default_stages` is built.
- **Decision**: SKIPPED — dead code today; will resurface when S-07 wires up an admin endpoint.

## Additional notes (not findings — verified clean)

- SQL injection: none found; all RPCs use parameterized args, schema-qualified identifiers, `set search_path=''`.
- RLS predicate logic (`kanban_stages_insert/update/delete`): the `(recruitment_id is not null AND ...) OR (recruitment_id is null AND ...)` disjunction is not invertible/bypassable; verified by assertions 10–15 in `rls_verification.sql`.
- Every SECURITY DEFINER RPC re-checks authorization as its first statement, matching `create_recruitment`'s established contract.
- The two-phase negate-then-assign renumber and the delete-and-reinsert override path are each a single implicit transaction; a `raise exception` mid-function rolls back everything, and ordinary row-level locking serializes concurrent calls safely against the non-deferrable partial unique index.
- The two hardest load-bearing details in the plan were both honored: the two-phase renumber (implemented as two literal separate `UPDATE`s) and the Phase-3-before-Phase-5 ordering (commit `3821355` precedes `20593af`).
- `useMutation`'s widened method union is backward compatible; existing POST/PATCH callers are unaffected.
- "What We're NOT Doing" guardrails (no admin UI, no candidate re-mapping, no soft-delete column, `STAGE_ORDER`/seeded e2e untouched) are all respected.
