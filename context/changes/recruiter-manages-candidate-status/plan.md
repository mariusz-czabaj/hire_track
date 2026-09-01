# Recruiter Manages Candidate Status Implementation Plan

## Overview

Deliver roadmap slice **S-04** (`recruiter-manages-candidate-status`): a recruiter adds a candidate to a
recruitment and moves them between kanban stages, where the move is hard-blocked unless a non-blank
interview note exists for **the stage being left**. Reverting a status is an ordinary move under the same
rule. PRD refs: FR-006, FR-008, FR-009, FR-013, §Business Logic.

## Current State Analysis

The F-01 schema anticipated this slice, but every write path is missing.

**What exists:**

- `candidates(id, full_name, email, phone, …)` with `unique index candidates_email_key on candidates (lower(email))`
  and a trigram index on `full_name` — `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:62-77`.
- `candidate_recruitments(candidate_id, recruitment_id, current_stage_id, added_at, unique(candidate_id, recruitment_id))`
  — `:79-92`. **Candidate status *is* `current_stage_id`**; there is no status column.
- `candidate_recruitment_status_history` — append-only, no UPDATE/DELETE policy — `:94-105`.
- A `before insert or update` trigger on `candidate_recruitments` rejecting a `current_stage_id` whose stage
  belongs to another recruitment, errcode `22023` — `20260901161434_kanban_stage_customization.sql:54-79`.
- RLS on all three tables: `candidates` gated org-wide by `candidate.read`/`candidate.write`; the link row and
  history gated per-recruitment by `recruitment.read`/`recruitment.write` — `20260831183457_rls_policies.sql:179-230`.
- A read-only board: `getKanbanBoard` (`src/lib/services/recruitments.ts:124-190`) and
  `GET /api/recruitments/[id]/board`, rendered by `src/components/recruitments/KanbanBoard.tsx`.

**What does not exist:**

- Any note storage. Zero occurrences of "note" across `supabase/` and `src/types.ts`.
- Any candidate write path — no RPC, no `src/lib/services/candidates.ts`, no `/api/recruitments/[id]/candidates*` route.
- Anything that populates status history. There is no trigger; `supabase/seed.sql:149-153` writes the initial row by hand.
- A textarea primitive in `src/components/ui/`, and any drag-and-drop dependency in `package.json`.

### Key Discoveries:

- **A route- or component-level note gate is decorative.** `candidate_recruitments_update`
  (`20260831183457_rls_policies.sql:202-205`) already lets any `recruitment.write` holder `UPDATE current_stage_id`
  through bare PostgREST. The PRD states the block as hard, so the gate must sit inside a `SECURITY DEFINER` RPC
  that is the sole sanctioned write path.
- **`update_default_stages` enumerates referencing tables by hand** when refusing to delete a still-referenced
  stage (`20260901180501_fix_update_default_stages_delete_order.sql:67-81`, errcode `PA002`). A notes table
  carrying `stage_id` would silently escape that guard and allow deletion of a stage a note points at.
- **Adding the first candidate permanently locks stage customization** — `replace_recruitment_stages` and
  `reset_recruitment_stages` raise `PA001 stages_locked` once any `candidate_recruitments` row exists
  (`20260901162000_kanban_stage_rpcs.sql:38-40`, `:88-90`). Test fixtures must customize stages *before* adding candidates.
- **Errcodes are a documented codebook** (`20260901162000:5-11`): `42501`, `P0002`, `22023`, `PA001`, `PA002`.
  `23503` already means "nonexistent group" at the recruitments route. This slice needs two fresh codes.
  `PA002` is still unmapped in every route.
- **Denial semantics are fixed**: not visible → 404, visible but no write → 403, produced by a read-then-write
  two-step as the RPC's first statements (`20260901162000:30-36`).
- **The UI never gates on capability, by explicit decision** (S-02 impl-review F7). A hiring manager sees the
  write affordances and must receive a clean 403, not a crash.
- **Services throw raw Supabase errors unwrapped** so `.code` survives to the route (S-03 Phase 4 §1); absence
  returns `null` via `.maybeSingle()` and becomes a 404.

## Desired End State

A recruiter opens a recruitment's board, adds a candidate by name/email/phone, and sees the card appear in the
first stage. Clicking the card opens a candidate detail page listing that candidate's per-stage notes in
stage order, Jira-comment style, each with author and timestamp, editable inline. Moving a card opens a dialog
that shows the note for the stage the candidate is currently in; if it is blank the Move button is refused by
the server with a clear "note required" message, and filling it in the same dialog saves the note and performs
the move in one atomic operation. Moving backwards works identically. A hiring manager sees the same controls
and gets a clean permission message.

### Verification

`supabase db reset --local`, then the RLS/RPC assertion script passes, `npm run test`, `npm run test:integration`,
`npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run build` all pass, and
`npm run db:types && git diff --exit-code src/db/database.types.ts` is clean.

## What We're NOT Doing

- **No CV upload, no full candidate profile** — FR-011/FR-012/FR-013a belong to S-05. This slice's detail page
  carries identity fields and notes only, and S-05 will restructure it.
- **No cross-recruitment candidate search or global candidate list** — FR-014..FR-016 belong to S-06.
- **No candidate removal.** No DELETE policy or grant exists on `candidates`, `candidate_recruitments`, or the
  history table, and no FR asks for it.
- **No drag-and-drop.** No such dependency exists; the move is a dialog, consistent with `StageEditor`'s
  button-based reordering.
- **No revisiting the `PA001` zero-candidates customization lock.** This slice makes it bite; changing it is a
  separate decision.
- **No client-side capability gating.** Affordances stay visible; denial is a clean message.
- **No note deletion, and no history of note edits.** One note per stage, overwritten on edit.
- **No CSRF work.** A pre-existing gap flagged at S-02, unchanged here.
- **No board pagination.** Pre-existing (S-01 impl-review F3, skipped).

## Implementation Approach

Bottom-up, because the note gate is a database invariant and everything above it is presentation. Phase 1
establishes storage and closes the stage-deletion hole the new table opens. Phase 2 puts both write operations
behind `SECURITY DEFINER` RPCs so the gate cannot be bypassed, and proves them with SQL assertions before any
TypeScript exists. Phase 3 exposes them over HTTP with the established error mapping. Phases 4 and 5 build the
two UI surfaces, and Phase 6 proves the whole path end to end.

Note editing from the detail page is a plain RLS-covered table upsert, not an RPC: it is a single-table write
with no atomicity requirement and no gate to enforce, so an RPC would add a bypass-able surface for nothing.
The move RPC accepts an optional note precisely so the blocked case is never a dead end.

## Critical Implementation Details

**Ordering — the note is written for the source stage.** `move_candidate_stage` must capture
`current_stage_id` into a local variable *before* updating it, upsert the supplied note against that captured
source stage, then evaluate the gate, then update. Upserting after the update would attach the note to the
target stage and silently unblock the next move instead of this one.

**The stage-deletion guard must be extended in the same phase that creates the table.** `update_default_stages`
lists referencing tables explicitly; adding `candidate_stage_notes` to that check is not optional cleanup — if
Phase 1 ships without it, a default stage referenced only by a note can be deleted, and the note's FK is
`on delete restrict`, so the failure surfaces as an opaque 500 rather than `PA002`.

**Fixture ordering in tests.** Any test that customizes stages must do so before adding a candidate, or
`PA001 stages_locked` will reject it.

---

## Phase 1: Notes schema

### Overview

Create per-stage note storage, its RLS policies and grants, and close the stage-deletion hole the new
`stage_id` reference opens.

### Changes Required:

#### 1. Notes table, policies, grants

**File**: `supabase/migrations/20260901210000_candidate_stage_notes.sql`

**Intent**: Store one interview note per candidate per recruitment per stage, authored and timestamped, so the
move gate has something to check and the detail page has something to list. Follow the existing migration
conventions: a header comment naming the slice and the FR, RLS enabled here, per-operation policies `to authenticated`,
every helper call wrapped in `(select …)`, explicit grants at the end.

**Contract**:

```sql
create table candidate_stage_notes (
  id bigint generated always as identity primary key,
  candidate_recruitment_id bigint not null references candidate_recruitments (id) on delete cascade,
  stage_id bigint not null references kanban_stages (id) on delete restrict,
  body text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_recruitment_id, stage_id),
  constraint candidate_stage_notes_body_not_blank check (length(trim(body)) > 0)
);
```

Index on `candidate_recruitment_id`. Policies for SELECT / INSERT / UPDATE only (no DELETE — mirrors the
history table's append-oriented posture), each resolving the parent's recruitment via
`exists (select 1 from candidate_recruitments cr where cr.id = candidate_recruitment_id and (select private.has_recruitment_operation(cr.recruitment_id, …)))`
— `recruitment.read` for SELECT, `recruitment.write` for INSERT and UPDATE (both `using` and `with check`).
Grant `select, insert, update` to `authenticated`. Attach the existing `private.set_updated_at()` trigger.

The `body` CHECK makes the blank-note case unrepresentable, so the gate only ever tests for row existence.

#### 2. Extend the stage-deletion guard

**File**: `supabase/migrations/20260901210100_extend_stage_referenced_guard.sql`

**Intent**: Teach `update_default_stages` that a note also pins a stage, so removing a referenced default stage
still raises `PA002` instead of failing on the FK. Ship as a full `create or replace` of the function in a new
file — never edit the merged migration.

**Contract**: The `PA002` existence check in `20260901180501_fix_update_default_stages_delete_order.sql:72-77`
gains a third arm over `candidate_stage_notes.stage_id`. No signature change.

#### 3. Regenerate types

**File**: `src/db/database.types.ts`

**Intent**: Keep the generated types in sync; CI fails on a dirty diff.

**Contract**: Output of `npm run db:types`, committed in the same commit as the migrations.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `npx supabase db reset --local`
- Types are in sync: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- Inserting a note as a user without `recruitment.write` on that recruitment is rejected by RLS
- Deleting a default stage referenced only by a note raises `PA002`, not an FK error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human before proceeding.

---

## Phase 2: Domain RPCs

### Overview

Put both writes behind `SECURITY DEFINER` functions in `public`, allocate two new errcodes, and prove the gate
with SQL assertions before any TypeScript exists.

### Changes Required:

#### 1. Add-candidate and move RPCs

**File**: `supabase/migrations/20260901210500_candidate_write_rpcs.sql`

**Intent**: Make find-or-create-and-link atomic, and make the note gate unbypassable by giving stage changes a
single sanctioned write path. Both functions follow the house contract: `security definer set search_path = ''`,
schema-qualified identifiers, a read-then-write permission check as the first statements, `returning` the full
row, and a trailing `revoke execute … from public, anon; grant execute … to authenticated;`. The header comment
documents the two new errcodes alongside the existing codebook.

**Contract**:

```
public.add_candidate_to_recruitment(
  target_recruitment_id bigint, full_name text, email text, phone text
) returns public.candidate_recruitments
```

Checks `recruitment.read` on the recruitment (`P0002` if not) then `recruitment.write` (`42501`), and
`candidate.write` (`42501`) since it may insert a profile. Trims and validates inputs (`22023`). Looks the
candidate up by `lower(email)`; if a row exists whose `full_name` differs from the submitted name, raises
**`PA003` `candidate_name_mismatch`** rather than linking or renaming. Otherwise inserts the profile or reuses
the match, inserts the `candidate_recruitments` row with `current_stage_id` = the lowest `sort_order` stage of
the recruitment's resolved set (overrides if any exist, else the global defaults — same resolution rule as
`src/lib/services/recruitments.ts:131-159`), and inserts the initial history row `from_stage_id = null`.
A duplicate link (`unique(candidate_id, recruitment_id)`) raises `22023` with a clear message.

```
public.move_candidate_stage(
  target_candidate_recruitment_id bigint, to_stage_id bigint, note text default null
) returns public.candidate_recruitments
```

Resolves the parent recruitment, checks `recruitment.read` (`P0002`) then `recruitment.write` (`42501`).
**Captures `current_stage_id` into a local before any write.** If `note` is non-blank, upserts it against
`(candidate_recruitment_id, captured_source_stage_id)` with `created_by = auth.uid()`. Then evaluates the gate:
if no `candidate_stage_notes` row exists for the captured source stage, raises **`PA004` `note_required`**.
Then updates `current_stage_id` (the existing consistency trigger validates stage ownership, `22023`) and
inserts a history row `from_stage_id = captured source, to_stage_id = target, changed_by = auth.uid()`.
Any stage in the resolved set is a valid target, forward or backward; a no-op move is permitted.

#### 2. RLS and RPC assertions

**File**: `supabase/tests/rls_verification.sql`

**Intent**: Prove the gate and the permission matrix at the database level, where they are actually enforced.

**Contract**: New numbered assertion blocks in the file's existing `begin; set_config('request.jwt.claims', …);
set local role authenticated; do $$ … raise exception 'FAIL: …' … $$; rollback;` form, covering: a move with no
source-stage note raises `PA004`; the same move with a note succeeds and writes exactly one history row; a
backward move with a note succeeds; a hiring manager (read but no write) gets `42501`; an unrelated user gets
`P0002`; `add_candidate_to_recruitment` links to an existing profile on an email match and raises `PA003` on a
name mismatch; a note insert by a non-member is denied by RLS. Per S-03 impl-review F1, each assertion must
capture the affected row with `returning … into` and assert the value actually changed — never a predicate that
passes when zero rows match.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `npx supabase db reset --local`
- Assertions pass: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_verification.sql`
- Types are in sync: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Linting passes: `npm run lint`

#### Manual Verification:

- Each new assertion has been observed to FAIL when its guard is temporarily removed
- A direct PostgREST `UPDATE` of `current_stage_id` is recognised as still possible, and the RPC is confirmed as
  the only path the application uses

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human before proceeding.

---

## Phase 3: Service layer and API routes

### Overview

Expose the RPCs and the note upsert over HTTP, with the established validation, error-mapping, and integration-test
conventions.

### Changes Required:

#### 1. Candidate service

**File**: `src/lib/services/candidates.ts`

**Intent**: House the candidate aggregate's data access, mirroring `recruitments.ts` — client first, errors
thrown raw and unwrapped so `.code` reaches the route, absence returned as `null` via `.maybeSingle()`.

**Contract**: `addCandidateToRecruitment(client, recruitmentId, command)`, `moveCandidateStage(client, recruitmentId,
candidateRecruitmentId, command)`, `getCandidateDetail(client, recruitmentId, candidateRecruitmentId)`, and
`upsertCandidateNote(client, candidateRecruitmentId, stageId, body)`. The first two call `client.rpc(...)` with
the RPCs' declared argument names; the last two are direct table reads/writes. Row→DTO mapping stays inline,
snake_case to camelCase, as in `recruitments.ts`.

#### 2. New types

**File**: `src/types.ts`

**Intent**: Add the commands and DTOs this slice needs, following the hand-written `…Command` / `…Dto`
convention (no `Row` picks).

**Contract**: `AddCandidateCommand { fullName; email; phone? }`, `MoveCandidateCommand { toStageId; note? }`,
`UpsertCandidateNoteCommand { stageId; body }`, `CandidateNoteDto { stageId; stageName; body; authorEmail; createdAt; updatedAt }`,
and `CandidateDetailDto { id; candidateId; fullName; email; phone; addedAt; currentStageId; notes: CandidateNoteDto[] }`.
`CandidateCardDto` is unchanged — the card deliberately shows nothing about notes.

#### 3. Routes

**Files**: `src/pages/api/recruitments/[id]/candidates/index.ts`,
`src/pages/api/recruitments/[id]/candidates/[candidateId]/index.ts`,
`src/pages/api/recruitments/[id]/candidates/[candidateId]/notes.ts`

**Intent**: Add `POST` (201 → `CandidateCardDto`), `GET` and `PATCH` on the candidate, and `PUT` on its notes,
following the house route skeleton exactly: `export const prerender = false`, module-local zod schemas, whole
`context` never destructured, per-route `createClient` with the `supabase_unconfigured` guard, no per-route auth
check (middleware owns 401), 422 for invalid input with a `fields` map.

**Contract**: `[candidateId]` is the `candidate_recruitments.id`, not the candidate's own id — the outer segment
must stay `id`, so the inner param needs a distinct name. A shared `handleCandidateRpcError`, modelled on
`handleStageRpcError` (`src/pages/api/recruitments/[id]/stages.ts:19-42`), maps `P0002`→404 `not_found`,
`42501`→403 `forbidden`, `22023`→422 `invalid_request`, `PA003`→422 `candidate_name_mismatch`,
`PA004`→422 `note_required`, default→`console.error` then 500 `internal`. Every code the RPCs can raise gets an
explicit branch — unmapped codes fell through to 500s twice already (S-02 F2, S-03 F4).

#### 4. Unit and integration tests

**Files**: `src/lib/services/candidates.test.ts`, `src/pages/api/recruitments/[id]/candidates/candidates.integration.test.ts`

**Intent**: Cover DTO mapping and error propagation without infrastructure, and the real HTTP contract against a
running stack.

**Contract**: Unit tests extend the hand-rolled `FakeQueryBuilder` pattern from `recruitments.test.ts:24-65`
with whichever chain methods the new paths use — no mocking library. Integration tests use
`src/lib/test-support/integration-client.ts`, create their own recruitment and candidate per case rather than
mutating seeds, and assert both status and `body.error.code` across the HR-allowed / hiring-manager-403 /
unrelated-404 matrix, plus the `PA004` blocked move and the same move succeeding once a note is supplied.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Integration tests pass against a reset DB and running dev server: `npm run test:integration`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification:

- A blocked move returns 422 `note_required` with a message a recruiter can act on
- Supplying the note in the same PATCH both saves it and performs the move

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human before proceeding.

---

## Phase 4: Board interaction

### Overview

Add the two dialogs that drive the board, plus the textarea primitive they need, and make cards navigable.

### Changes Required:

#### 1. Textarea primitive

**File**: `src/components/ui/textarea.tsx`

**Intent**: Provide the multi-line input this slice needs; none exists. Mirror `FormField`'s label/id pairing and
inline error markup so `getByLabel` works in both RTL and Playwright.

**Contract**: shadcn "new-york" styling via `cn()`, controlled value, `id`/`htmlFor` pairing, optional error text.

#### 2. Add-candidate dialog

**File**: `src/components/recruitments/AddCandidateDialog.tsx`

**Intent**: Let a recruiter add a candidate from the board.

**Contract**: Controlled Radix `Dialog` following `StageEditor`'s shape — `handleOpenChange` seeds state and
clears errors on open, local synchronous validation before submit, `disabled` with a label swap while pending.
Uses `useMutation<AddCandidateCommand, CandidateCardDto>(url, "POST")`, takes `onChanged: () => void`, and renders
`ServerError` plus `fieldErrors`. Surfaces `candidate_name_mismatch` as a field-level error on the name input.

#### 3. Move-candidate dialog

**File**: `src/components/recruitments/MoveCandidateDialog.tsx`

**Intent**: Move a candidate and capture the note for the stage being left, in one action.

**Contract**: On open, GETs the candidate detail and seeds the textarea with the note for the candidate's
**current** stage (blank if none). Offers every stage in the board's resolved set as a target, including earlier
ones. Submits `{ toStageId, note }` via `useMutation(url, "PATCH")`, then calls `onChanged`. A 422
`note_required` renders as a field error on the note textarea, so the blocked case is fixable in place.

#### 4. Board wiring

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: Host the add trigger, give each card a move control and a link to the detail page, and refetch after
either mutation.

**Contract**: Both dialogs receive `onChanged={() => { void resource.refetch(); }}` — mutations never own data.
Each card links to `/recruitments/{id}/candidates/{candidateRecruitmentId}` and carries a move button with an
indexed, name-bearing `aria-label` so both RTL and Playwright can target it by role. `CandidateCardDto` is
unchanged, so the board read path and its existing tests are untouched.

#### 5. Component tests

**Files**: `src/components/recruitments/AddCandidateDialog.test.tsx`, `MoveCandidateDialog.test.tsx`

**Intent**: Cover the payloads and the failure surfaces.

**Contract**: The local `mockFetch(config)` pattern from `StageEditor.test.tsx:18-42` — throws on any
unregistered URL, installed via `vi.stubGlobal`. Cases: happy-path payload asserted as an exact serialized body;
`note_required` 422 rendered against the note field; `candidate_name_mismatch` 422 against the name field; a
clean 403 message.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification:

- Adding a candidate makes the card appear in the first stage without a page reload
- Moving with a blank note is refused, and filling the note in the same dialog completes the move
- Moving a candidate backwards works
- A hiring manager sees the controls and gets a clean denial, not a crash

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human before proceeding.

---

## Phase 5: Candidate detail page

### Overview

Give notes a home: a minimal page showing the candidate's identity and their per-stage notes as a Jira-style list.

### Changes Required:

#### 1. Page shell

**File**: `src/pages/recruitments/[id]/candidates/[candidateId].astro`

**Intent**: Server-render the page shell and hydrate the React island, following the repo's existing pattern.

**Contract**: Passes scalar params only (`recruitmentId`, `candidateRecruitmentId`) to a `client:load` island;
the island fetches its own JSON. Same `bg-cosmic` page wrapper as the other recruitment pages, with a back link
to the board.

#### 2. Detail island

**File**: `src/components/recruitments/CandidateDetail.tsx`

**Intent**: Show identity fields and the note list, and let a recruiter edit any stage's note in place.

**Contract**: `useApiResource<CandidateDetailDto>` with the standard loading / `not-found` / error branches
(skeleton, NotFoundState, `ServerError`) matching `KanbanBoard.tsx:110-120`. Notes render in stage order — one
entry per stage in the resolved set, each showing stage name, author, timestamp, and body, with an empty-state
line for stages not yet noted. Editing opens the textarea inline and `PUT`s `{ stageId, body }`, then refetches.
Identity fields are read-only in this slice; S-05 makes them editable.

#### 3. Component tests

**File**: `src/components/recruitments/CandidateDetail.test.tsx`

**Intent**: Cover rendering and the note upsert.

**Contract**: Same `mockFetch` pattern. Cases: notes listed in stage order with empty states; a successful edit
sends the exact `PUT` body and refetches; a 403 renders cleanly.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification:

- Clicking a card from the board opens the detail page for that candidate
- Notes appear in stage order with author and timestamp, and editing one persists after reload
- A note written here unblocks a move made afterwards from the board

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human before proceeding.

---

## Phase 6: End-to-end coverage

### Overview

Prove the whole path through the real application, and pre-empt the CI flake classes new API routes reintroduce.

### Changes Required:

#### 1. E2E spec

**File**: `tests/e2e/candidates.spec.ts`

**Intent**: Cover the slice's user-visible contract end to end.

**Contract**: Uses `signInAs(page, "hr")` and seeds its own recruitment via `page.request.post("/api/recruitments", …)`
in `beforeAll` — **never** touching the seeded "Backend Engineer" recruitment, whose board `STAGE_ORDER` in
`tests/e2e/recruitments.spec.ts:4` asserts and which holds 5 candidates. Every island form fill is wrapped in the
`toPass()` hydration-race guard used in `kanban-stages.spec.ts:59-62`. Cases: add a candidate and see the card;
attempt a move with no note and see the refusal; fill the note in the dialog and see the card land in the target
column; move it backwards; open the detail page and see the note. A hiring-manager case asserts a clean denial
followed by a reload proving nothing persisted.

#### 2. CI readiness probe

**File**: `.github/workflows/ci.yml`

**Intent**: Keep the dev-server readiness probe meaningful now that new API routes exist. Astro dev lazily
reloads per route module graph, so a probe of one route does not prove another is ready — the exact failure fixed
in commit `1f3a94f`.

**Contract**: Extend the existing readiness probe to also poll one of the new candidate routes before the
integration and e2e jobs run. The authenticated warm-up added in `d7ff36b` for PostgREST clock skew stays as is.

### Success Criteria:

#### Automated Verification:

- Full suite passes from a clean database: `npx supabase db reset --local`, then `npm run test`, `npm run test:integration`, `npm run test:e2e`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification:

- The e2e suite passes twice in a row without a database reset between runs, confirming the new spec does not
  pollute fixtures other specs assert on
- CI passes on a pushed branch

**Implementation Note**: After completing this phase and all automated verification passes, pause here for
manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- Service DTO mapping and raw-error propagation (`candidates.test.ts`), using the `FakeQueryBuilder` pattern
- Dialog payloads asserted as exact serialized bodies; `note_required` and `candidate_name_mismatch` mapped to the
  right field; clean 403 rendering
- Detail page note ordering, empty states, and the upsert body

### Integration Tests:

- `POST /api/recruitments/[id]/candidates` — 201, duplicate link 422, `candidate_name_mismatch` 422, HM 403, unrelated 404
- `PATCH …/candidates/[candidateId]` — `note_required` 422, success with note, backward move, HM 403, unrelated 404
- `PUT …/candidates/[candidateId]/notes` — 200, blank body 422, HM 403

### RLS Tests:

- The Phase 2 assertion blocks in `supabase/tests/rls_verification.sql`, each written to fail loudly when its
  guard is removed

### Manual Testing Steps:

1. Reset the database, sign in as `hr.test@example.com`, open a recruitment board.
2. Add a candidate; confirm the card appears in the first stage with today's date.
3. Try to move the card without a note; confirm the refusal names the missing note.
4. Type the note in the same dialog and move; confirm the card lands in the target column.
5. Move the card back to an earlier stage; confirm it is allowed and the note for the stage just left was required.
6. Open the card's detail page; confirm the notes list shows stage, author, and timestamp, and that editing persists.
7. Sign in as `hiring-manager.test@example.com`; confirm the controls are visible, the action is denied cleanly,
   and a reload shows nothing changed.
8. Confirm that a recruitment which already has a candidate refuses stage customization with the `stages_locked` message.

## Performance Considerations

The board query remains unpaginated (pre-existing, S-01 impl-review F3) and this slice is what makes candidate
counts grow — worth watching, not fixing here. `CandidateCardDto` deliberately does not carry note text, so the
board payload does not grow with note length. The detail page issues one query per candidate. History stage
columns remain unindexed, declined in S-03; this slice writes history at volume for the first time, so if history
queries appear in S-06 the index decision should be revisited there.

## Migration Notes

Three new migrations, all additive; no existing data is rewritten. Merged migrations are never edited — the
`update_default_stages` change ships as a full `create or replace` in a new file. `src/db/database.types.ts` must
be regenerated and committed in the same commit as the migrations, since CI fails on a dirty diff. Once this
slice ships, any recruitment with a candidate permanently refuses stage customization via `PA001`; existing
seeded recruitments already have candidates and are therefore already locked.

## References

- Research: `context/changes/recruiter-manages-candidate-status/research.md`
- Decision record: `context/changes/recruiter-manages-candidate-status/change.md`
- RPC and errcode template: `supabase/migrations/20260901162000_kanban_stage_rpcs.sql`
- Error-mapping template: `src/pages/api/recruitments/[id]/stages.ts:19-42`
- Dialog and form template: `src/components/recruitments/StageEditor.tsx`
- Stage resolution rule: `src/lib/services/recruitments.ts:124-190`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Notes schema

#### Automated

- [x] 1.1 Migrations apply cleanly
- [x] 1.2 Types are in sync
- [x] 1.3 Linting passes
- [x] 1.4 Type checking passes

#### Manual

- [ ] 1.5 Note insert without recruitment.write is rejected by RLS
- [ ] 1.6 Deleting a note-referenced default stage raises PA002

### Phase 2: Domain RPCs

#### Automated

- [ ] 2.1 Migrations apply cleanly
- [ ] 2.2 RLS/RPC assertions pass
- [ ] 2.3 Types are in sync
- [ ] 2.4 Linting passes

#### Manual

- [ ] 2.5 Each new assertion observed to fail when its guard is removed
- [ ] 2.6 RPC confirmed as the application's only stage-write path

### Phase 3: Service layer and API routes

#### Automated

- [ ] 3.1 Unit tests pass
- [ ] 3.2 Integration tests pass
- [ ] 3.3 Linting passes
- [ ] 3.4 Type checking passes
- [ ] 3.5 Build succeeds

#### Manual

- [ ] 3.6 Blocked move returns actionable 422 note_required
- [ ] 3.7 Note supplied in the PATCH both saves and moves

### Phase 4: Board interaction

#### Automated

- [ ] 4.1 Unit tests pass
- [ ] 4.2 Linting passes
- [ ] 4.3 Type checking passes
- [ ] 4.4 Build succeeds

#### Manual

- [ ] 4.5 Added candidate appears without reload
- [ ] 4.6 Blank-note move refused, then completes once filled
- [ ] 4.7 Backward move works
- [ ] 4.8 Hiring manager gets a clean denial

### Phase 5: Candidate detail page

#### Automated

- [ ] 5.1 Unit tests pass
- [ ] 5.2 Linting passes
- [ ] 5.3 Type checking passes
- [ ] 5.4 Build succeeds

#### Manual

- [ ] 5.5 Card click opens the correct detail page
- [ ] 5.6 Notes list in stage order; edit persists after reload
- [ ] 5.7 A note written here unblocks a later move

### Phase 6: End-to-end coverage

#### Automated

- [ ] 6.1 Full suite passes from a clean database
- [ ] 6.2 Linting passes
- [ ] 6.3 Type checking passes
- [ ] 6.4 Build succeeds

#### Manual

- [ ] 6.5 E2E passes twice without a DB reset between runs
- [ ] 6.6 CI passes on a pushed branch
