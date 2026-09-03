<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Recruiter Manages Candidate Status Implementation Plan

- **Plan**: context/changes/recruiter-manages-candidate-status/plan.md
- **Scope**: All 6 phases (full plan review)
- **Date**: 2026-09-01
- **Verdict**: REJECTED (as reviewed) — all findings subsequently fixed and re-verified during triage
- **Findings**: 1 critical, 3 warnings, 3 observations — all 7 FIXED

## Verdicts (as originally reviewed, before triage fixes)

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Post-triage status

Every finding was fixed during the same session's triage (see each finding's `Decision` below) and re-verified:
`npx supabase db reset --local`, the extended `rls_verification.sql` (including new assertions for the scoped
`get_user_emails_for_candidate` RPC), `npm run db:types` (clean diff against the new RPC signature), `npm run test`
(54/54), `npm run lint`, `npm run typecheck`, and `npm run build` all pass. Integration and e2e suites were not
re-run in this session (no changes touched their code paths, and they require a running dev server); worth a
confirmation pass before the next deploy.

## Findings

### F1 — `get_user_emails` RPC has no authorization check

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260901220000_get_user_emails_rpc.sql:7-20
- **Detail**: `get_user_emails(user_ids uuid[])` is `security definer`, correctly `set search_path = ''` and schema-qualified, but performs no authorization check before returning `email` for any requested id. It is granted to `authenticated`, so any signed-in user (recruiter, hiring manager, anyone) can call `rpc/get_user_emails` directly via PostgREST with an arbitrary array of UUIDs and enumerate the email address of any user in the system, completely bypassing the per-recruitment RLS model every other object in this feature enforces (contrast with `add_candidate_to_recruitment`/`move_candidate_stage`, which both check `has_recruitment_operation`/`has_operation` first). The application only ever calls it with note-author ids the caller can already see via RLS-scoped `candidate_stage_notes` rows, but that is a client-side convention, not a server-side guarantee — this RPC is a new, undocumented (not mentioned anywhere in the plan) write/read surface. `supabase/tests/rls_verification.sql` has no assertion at all for it (see F6).
- **Fix**: Restrict the function to ids the caller is actually entitled to see — e.g. add a `for_candidate_recruitment_id bigint` parameter, check `recruitment.read` on its recruitment, and only resolve `created_by` ids from `candidate_stage_notes`/`candidate_recruitment_status_history` rows scoped to that `candidate_recruitment_id`, instead of accepting an arbitrary uuid array.
  - Strength: Matches the authorization pattern used by every other RPC in this migration set; closes the enumeration hole entirely rather than relying on caller discipline.
  - Tradeoff: One extra join per call; `getCandidateDetail` already has `candidateRecruitmentId` in scope so the call site change is small.
  - Confidence: HIGH — the vulnerability is unambiguous (no authz check at all, `grant ... to authenticated`), and the fix mirrors this file's own sibling migrations.
  - Blind spot: None significant.
- **Decision**: FIXED — replaced `get_user_emails(uuid[])` with `get_user_emails_for_candidate(target_candidate_recruitment_id, user_ids)` in `supabase/migrations/20260901230000_scope_get_user_emails_rpc.sql`, checking `recruitment.read` and filtering to `created_by` ids on that candidate's own notes. Updated the call site in `candidates.ts` and the unit test mock. Added RLS assertions (27) covering the HR-success and unrelated-user-denied cases — see F6.

### F2 — Candidate detail page hides un-noted stages instead of showing an empty-state line

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/recruitments/CandidateDetail.tsx:188-213
- **Detail**: Plan Phase 5 §2 contract: "Notes render in stage order — one entry per stage in the resolved set... with an empty-state line for stages not yet noted." The actual code filters `candidate.notes` down to `note.body !== null` and renders only stages that already have a note; a single blanket "No notes yet." only appears when _every_ stage is un-noted. A candidate partially through the pipeline (some stages noted, some not) shows no indication that the un-noted stages exist at all.
- **Fix**: Render every entry in `candidate.notes` (drop the `.filter`), and inside `NoteCard` (or a small variant) show a muted "No note yet" placeholder when `note.body === null` instead of the note body.
- **Decision**: FIXED — `CandidateDetail.tsx` now maps over every resolved stage and `NoteCard` shows a "No note yet" placeholder when `body` is null; updated the component test accordingly.

### F3 — Note upsert doesn't verify the stage belongs to the candidate's recruitment

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/candidates.ts:211-233
- **Detail**: `upsertCandidateNote` looks up `command.stageId` in `kanban_stages` with no filter tying it to `recruitmentId`, unlike every other query in this file (`moveCandidateStage`, `getCandidateDetail`), which explicitly scope by `recruitment_id`. A caller with `recruitment.write` on recruitment A can `PUT` a note against a `stageId` that belongs to recruitment B's custom stage set — RLS still requires `recruitment.write` on the note's own `candidate_recruitment_id`, so this isn't a cross-tenant write, but it produces a note logically attached to the wrong recruitment's stage (a data-correctness bug, and if the mismatched stage doesn't exist at all, the FK violation surfaces as a raw 500 — see F5).
- **Fix**: Validate `command.stageId` against `resolveKanbanStages(client, recruitmentId)` (already imported and used elsewhere in this file) before the upsert, returning 404/422 for a stage outside the recruitment's resolved set.
- **Decision**: FIXED — `upsertCandidateNote` now resolves the recruitment's stage set and rejects (`22023`) any `stageId` not in it, before ever reaching the insert. This also resolves F5 (the same check now catches a nonexistent stage before the FK would fire). Updated unit tests, including a new case for the rejected stage.

### F4 — `MoveCandidateDialog` bypasses the shared `useApiResource` hook

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/recruitments/MoveCandidateDialog.tsx:50-67
- **Detail**: `loadDetail()` hand-rolls `fetch()` + manual JSON parsing + manual error-shape handling to load the candidate detail, instead of the `useApiResource` hook that `KanbanBoard.tsx` and `CandidateDetail.tsx` both use for the same kind of GET. This duplicates loading/error-state and error-body-parsing logic the hook already centralizes and is the one structural deviation from `StageEditor.tsx`'s dialog shape that the plan asked this component to follow.
- **Fix**: Replace the manual `fetch` in `loadDetail` with `useApiResource<CandidateDetailDto>`, seeding `toStageId`/`note` from its resolved data instead of from local fetch state.
- **Decision**: FIXED — extracted a `MoveCandidateForm` inner component, mounted only while the dialog is open, that uses `useApiResource<CandidateDetailDto>` for the GET (preserving open-triggered, not per-card, fetch timing) and seeds `toStageId`/`note` from its resolved data during render. Component tests pass unchanged.

### F5 — No `23503` mapping for a nonexistent note stage

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/api/candidate-errors.ts:8-31
- **Detail**: If `upsertCandidateNote`'s `command.stageId` doesn't exist at all, `stageRow` comes back `undefined` but the code still attempts the insert; the `on delete restrict` FK on `candidate_stage_notes.stage_id` raises `23503`, which `handleCandidateRpcError` has no branch for, so it falls through to the generic 500 rather than a 422 `invalid_request` (the pattern used for the equivalent `22023` case elsewhere in this same file).
- **Fix**: Add a `23503` branch to `handleCandidateRpcError` mapping to 422 `invalid_request`, or resolve this alongside F3's stage-scoping fix (which would catch the case before the insert).
- **Decision**: FIXED — resolved as a side effect of F3; a nonexistent/foreign stage is now rejected with `22023` before the insert, so the FK violation can no longer occur.

### F6 — No RLS/RPC assertion covers `get_user_emails`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/rls_verification.sql
- **Detail**: Every other new RPC/table in this slice has a numbered assertion block; `get_user_emails` has none. An assertion that a caller cannot resolve emails for ids outside their visibility would have caught F1 before it shipped.
- **Fix**: Add an assertion block once F1 is fixed, proving a caller without visibility into a given `candidate_recruitment_id` gets nothing back for its note authors' ids.
- **Decision**: FIXED — resolved as part of F1; assertion block (27) covers both the HR-success case and the unrelated-user-denied (`P0002`) case for `get_user_emails_for_candidate`.

### F7 — Plan states `CandidateCardDto` is unchanged; it was necessarily extended

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/types.ts, src/lib/services/recruitments.ts
- **Detail**: Plan Phase 4 §4 contract says "`CandidateCardDto` is unchanged, so the board read path and its existing tests are untouched," but the same phase also requires each card to link to `/recruitments/{id}/candidates/{candidateRecruitmentId}` — which needs `candidateRecruitmentId` on the DTO. The implementation correctly added the field (and exported `resolveKanbanStages`/`KanbanStageRow` from `recruitments.ts` for reuse in `candidates.ts`, and updated `recruitments.test.ts`/`tests/e2e/recruitments.spec.ts` accordingly) — this is the right call, but it contradicts the plan's own text and wasn't called out as an addendum.
- **Fix**: Documentation-only — add a one-line plan addendum noting `CandidateCardDto` gained `candidateRecruitmentId` and why. No code change needed.
- **Decision**: FIXED — added an addendum to plan.md's Phase 4 §4 contract.
