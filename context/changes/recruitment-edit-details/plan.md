# Recruitment Edit Details Implementation Plan

## Overview

Let a recruiter change a recruitment's scalar details — title, department, location, employment type, opened date — from the recruitment detail page, via a "…" action menu in the page header that opens an edit dialog. The write goes through a new `update_recruitment` SECURITY DEFINER RPC so an unauthorized caller gets a real 403 rather than a misleading 404, and validation rules are extracted into one module shared by both the create and edit paths.

This is roadmap slice **S-15 (`recruitment-edit-details`, MS-10)**.

## Current State Analysis

Recruitment details are write-once: they can be set at `/recruitments/new` and never changed again. Nothing in the app edits them.

- `PATCH /api/recruitments/[id]` exists but accepts **only** `{ status }` (`src/pages/api/recruitments/[id]/index.ts:12-14`), delegating to `updateRecruitmentStatus` (`src/lib/services/recruitments.ts:110-134`), a plain `.update()`.
- The page header is static Astro markup in `src/pages/recruitments/[id].astro:54-76` — an `<h1>`, a `RecruitmentStatusBadge` client island, and a metadata row built from `metadataEntries`. **There is no "…" action menu**; S-09 explicitly cut it from its own scope.
- `src/components/ui/dropdown-menu.tsx` is installed and token-styled, with **zero consumers anywhere in `src/`**.
- Validation for the same five fields lives in two places that already diverge in form: `createRecruitmentSchema` (`src/pages/api/recruitments/index.ts:12-19`) and a hand-rolled `validate()` (`src/components/recruitments/CreateRecruitmentForm.tsx:34-48`). Neither has any max-length bound, and `openedAt` is only checked non-empty.

Key constraints discovered:

- **RLS for scalar-field editing is already correct.** `recruitments_update` (`supabase/migrations/20260831183457_rls_policies.sql:141-144`) is scoped per-recruitment via `has_recruitment_operation(id, 'recruitment.write')`. No policy work is needed.
- **A plain `.update()` cannot distinguish forbidden from missing** — RLS silently yields zero rows, which is exactly why the existing status PATCH returns 404 to a read-only caller.
- **`updated_at` is already trigger-maintained** on `recruitments` (`supabase/migrations/20260831194708_add_updated_at_triggers.sql:15-16`), so every update records when it happened for free.

### Key Discoveries:

- **The cross-island live-update mechanism already exists and is named.** `src/lib/recruitment-status-events.ts` defines `RECRUITMENT_STATUS_CHANGED_EVENT` + `dispatchRecruitmentStatusChanged`; `RecruitmentStatusBadge.tsx:20-33` consumes it, precisely because the status control lives in a *different* island (`KanbanBoard.tsx:120-166`). A sibling details-changed event is the precedented answer to "header updates without reload".
- **`create_recruitment` is a directly copyable RPC precedent** (`supabase/migrations/20260901150000_create_recruitment_returns_row.sql`): `security definer`, `set search_path = ''`, permission check → `raise ... using errcode = '42501'`, `22023` for invalid input, returns the full `public.recruitments` row. Its route-side error mapping is at `src/pages/api/recruitments/index.ts:71-87`.
- **`Astro.locals.operations` carries the user's operation set** (`src/env.d.ts`), already used by `Sidebar.astro:4` to gate the Administration link. It is the *global union* across the user's groups, not recruitment-scoped — so it is a UI hint only; the RPC remains the authority.
- **`Toaster` is mounted globally** in `AppShell.astro:23`, and `StatusControl` already toasts on success (`KanbanBoard.tsx:143`) — success confirmation needs no new plumbing.
- **Existing `data-testid` anchors must survive untouched**: `status-control` (`KanbanBoard.tsx:151`) and `kanban-columns` (`KanbanBoard.tsx:295`) are named as invariants in the roadmap and asserted in `tests/e2e/recruitments.spec.ts:85-95`.

## Desired End State

A recruiter viewing `/recruitments/:id` sees a "…" button in the page header beside the title and status badge. Opening it reveals **Edit details**; choosing it opens a dialog pre-filled with the recruitment's current title, department, location, employment type and opened date. Saving persists the change, closes the dialog, shows a success toast, and repaints the header's title and metadata row in place — no page reload. A caller without `recruitment.write` on that recruitment receives a 403 from the API, and a caller who cannot see the recruitment at all receives a 404.

Verify by: opening a recruitment as the seeded `hr` user, editing every field including clearing an optional one, and confirming the header updates without reload and the value survives a manual refresh; then confirming the same PATCH as `hiringManager` returns 403.

## What We're NOT Doing

- **Security-group reassignment.** The roadmap's S-15 outcome names it, but its own open unknown flagged the self-lockout hazard for decision at plan time; it is deferred to a follow-up slice. `getRecruitmentDetail` keeps its current shape with no `groupIds`, and `recruitment_security_groups` is untouched.
- **No audit/history record of edits.** No schema precedent exists (only candidate stage notes), the PRD never requires it, and the `updated_at` trigger already records when a recruitment last changed. This closes the roadmap's second open unknown.
- **No concurrency detection.** Last write wins; no version token, no 409 path.
- **Not moving `StatusControl` or `StageEditor` into the header menu.** S-09's deferred design wants that eventually, but doing it here would move `data-testid="status-control"` and break existing E2E navigation. The "…" menu ships with a single item.
- **Not changing the existing status-only PATCH contract.** Its request shape, response shape (`RecruitmentStatusDto`) and its current 404-on-forbidden behavior all stay exactly as they are. The 404-vs-403 asymmetry between the two paths is accepted for this slice and noted below.
- **No `ui/select` primitive.** Employment type stays a token-styled native `<select>`, matching `CreateRecruitmentForm.tsx:135-148`.

## Implementation Approach

Work bottom-up so each phase leaves something verifiable.

The validation module comes first because both the create path and the new edit path must import it — extracting it *after* writing the edit schema would leave two divergent rule sets, which is the specific failure the roadmap risk note warns about. The RPC follows, giving a real 403; then the route, which becomes a two-branch handler (status → existing plain-update path; details → new RPC path) rather than a second endpoint. Only then does the UI land, because it needs a working contract to submit against.

The header restructure is the one structural change: today's `<h1>` + metadata row are static Astro, which cannot repaint. They become a single `RecruitmentHeader` island that also absorbs `RecruitmentStatusBadge` (keeping its existing status-event listener) and hosts the "…" menu.

## Critical Implementation Details

**Distinguishing 404 from 403 without leaking existence.** The RPC must check read access *before* write access: if `has_recruitment_operation(p_id, 'recruitment.read')` is false, raise the not-found error — this covers both "no such recruitment" and "exists but invisible to you", so a caller can never probe for the existence of a recruitment they cannot see. Only then check `recruitment.write` and raise `42501`. Checking existence directly with a `select 1` first would invert this and leak.

**The details branch is a full replace, not a partial patch.** The dialog always submits all five scalar fields loaded from the current record, so the RPC writes all five columns every time. At the route level this means the details block is all-or-nothing: if any detail field is present, all five keys must be present (`title` non-empty; the other four present but nullable). This avoids the ambiguity of "absent means unchanged" vs "absent means clear" entirely.

**Empty string and null are the same thing on input.** The four optional fields accept `string | null`; whitespace-only and empty strings normalize to `null` before hitting the database, so a user clearing a field in the form produces a real SQL `NULL` rather than an empty string that would render as a blank metadata entry.

## Phase 1: Shared validation, RPC, and service layer

### Overview

Extract one validation module used by both create and edit, add the `update_recruitment` RPC, and add the service function that calls it — with unit tests. No user-visible change yet.

### Changes Required:

#### 1. Shared recruitment field validation

**File**: `src/lib/validation/recruitment.ts` (new)

**Intent**: Become the single source of truth for recruitment field rules, so the create and edit paths cannot drift. Adds the length and date bounds that exist nowhere today.

**Contract**: Exports per-field zod schemas — title (trimmed, 1–200 chars), department and location (trimmed, max 120), employment type (re-exported `employmentTypeSchema`), and an `openedAt` schema enforcing a real `YYYY-MM-DD` calendar date rather than merely non-empty. Also exports two composed object schemas: the create shape (all five required, matching today's semantics plus the new bounds) and the edit shape (title required; the other four accept `string | null`, with empty/whitespace normalized to `null`).

#### 2. Create route adopts the shared module

**File**: `src/pages/api/recruitments/index.ts`

**Intent**: Replace the inline `createRecruitmentSchema` with the composed create shape from the new module, so the bounds apply to creation too.

**Contract**: `createRecruitmentSchema` (lines 12-19) is replaced by an import; `groupIds` validation stays here since it is create-only. The 422 field-error mapping and every existing error code branch are unchanged.

#### 3. Create form adopts the shared module

**File**: `src/components/recruitments/CreateRecruitmentForm.tsx`

**Intent**: Replace the hand-rolled `validate()` with the shared schema so client and server agree on bounds, not just on required-ness.

**Contract**: `validate()` (lines 34-48) derives its per-field messages from the shared edit/create schema's parse issues, keyed to the existing `FIELD_ORDER` so `focusFirstInvalidField` behavior is preserved.

#### 4. `update_recruitment` RPC

**File**: `supabase/migrations/<timestamp>_update_recruitment.sql` (new)

**Intent**: Provide a write path that can return a true 403, mirroring `create_recruitment`.

**Contract**: `public.update_recruitment(p_id bigint, p_title text, p_department text, p_location text, p_employment_type text, p_opened_at date) returns public.recruitments`, `language plpgsql`, `security definer`, `set search_path = ''`. Checks `private.has_recruitment_operation(p_id, 'recruitment.read')` first and raises with `errcode = 'P0002'` if false (→ 404); then checks `'recruitment.write'` and raises `errcode = '42501'` if false (→ 403). Updates all five columns and returns the full row. Ends with `revoke execute ... from public, anon;` and `grant execute ... to authenticated;`, matching the create RPC's footer.

#### 5. `updateRecruitmentDetails` service function

**File**: `src/lib/services/recruitments.ts`

**Intent**: Wrap the RPC and map the returned row to the DTO the header needs.

**Contract**: `updateRecruitmentDetails(client, recruitmentId, command): Promise<RecruitmentDetailDto>` — calls `client.rpc("update_recruitment", {...})`, throws the Supabase error as-is (route maps codes), and maps the row through the existing `toRecruitmentStatus` / `toEmploymentType` helpers. Unlike `updateRecruitmentStatus` it does not return `null`; absence is signalled by the RPC's `P0002`.

#### 6. New command type

**File**: `src/types.ts`

**Intent**: Type the edit payload.

**Contract**: `UpdateRecruitmentDetailsCommand` with `title: string` and `department | location | employmentType | openedAt` each nullable, placed beside `UpdateRecruitmentStatusCommand`.

#### 7. Service unit tests

**File**: `src/lib/services/recruitments.test.ts`

**Intent**: Cover the new service function following the existing fake-client pattern.

**Contract**: An RPC-shaped fake client (the file already has `makeCreateClient` for `create_recruitment`) plus cases for: returns the mapped DTO on success, and propagates a Supabase error as a throw.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Unit tests pass: `npm run test`
- Type checking and linting pass: `npm run lint`
- Existing create-path tests still pass unchanged: `npm run test -- recruitments`

#### Manual Verification:

- Creating a recruitment through `/recruitments/new` still works, and a title longer than 200 characters is now rejected with a field-level message.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: PATCH endpoint extension

### Overview

Teach the existing route to handle a details payload alongside the untouched status payload, with proper error-code mapping.

### Changes Required:

#### 1. Two-branch PATCH handler

**File**: `src/pages/api/recruitments/[id]/index.ts`

**Intent**: Accept a details update additively, without disturbing the status contract.

**Contract**: The body is parsed as a union of the existing status shape and the new details shape (imported from `src/lib/validation/recruitment.ts`). A body carrying only `status` follows the existing path and returns `RecruitmentStatusDto` exactly as today. A body carrying detail fields routes to `updateRecruitmentDetails` and returns `RecruitmentDetailDto`. A body carrying both is rejected 422 (`invalid_request`) — status and details are not updated in one call. Adds error-code mapping in the catch: `42501` → 403 `forbidden`, `P0002` → 404 `not_found`, falling through to the existing 500. The per-issue `fields` mapping mirrors the POST handler's loop.

#### 2. Integration tests

**File**: `src/pages/api/recruitments/index.integration.test.ts`

**Intent**: Cover the new branch against a real local Supabase, in the same `describe` block where the existing status PATCH tests live.

**Contract**: Cases for — `hr` updates details and the change persists across a re-fetch; `hr` clears an optional field and it comes back `null`; a caller without write access on that recruitment gets 403 with `error.code === "forbidden"`; an unknown id gets 404; an over-length title gets 422 with `error.fields.title`; and a regression case asserting the status-only PATCH still returns the unchanged `RecruitmentStatusDto` shape.

### Success Criteria:

#### Automated Verification:

- Integration tests pass: `npm run test:integration`
- Type checking and linting pass: `npm run lint`
- The existing status-PATCH integration tests pass with no edits to their assertions

#### Manual Verification:

- A manual `curl`/REST PATCH with a details body as a signed-in recruiter returns 200 and the updated detail DTO.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Header island, action menu, and edit dialog

### Overview

Replace the static header markup with one island that owns title, status badge, metadata and the "…" menu, and add the dialog that edits the record.

### Changes Required:

#### 1. Details-changed event

**File**: `src/lib/recruitment-details-events.ts` (new)

**Intent**: Let the dialog notify the header across island boundaries, mirroring the status event.

**Contract**: Exports `RECRUITMENT_DETAILS_CHANGED_EVENT`, a detail interface carrying `recruitmentId` plus the updated `RecruitmentDetailDto`, and a `dispatchRecruitmentDetailsChanged` helper — structurally identical to `src/lib/recruitment-status-events.ts`.

#### 2. `RecruitmentHeader` island

**File**: `src/components/recruitments/RecruitmentHeader.tsx` (new)

**Intent**: Own the whole page-title block so title and metadata can repaint in place, and host the action menu.

**Contract**: Props `{ recruitment: RecruitmentDetailDto; canEdit: boolean }`. Holds the recruitment in state seeded from props; subscribes to both `RECRUITMENT_STATUS_CHANGED_EVENT` (absorbing the listener from `RecruitmentStatusBadge`) and the new details event. Renders the `<h1>`, the status `Badge` via `STATUS_PRESENTATION`, the metadata row (the `metadataEntries` / `formatDate` logic moves here verbatim from the `.astro` file), and — only when `canEdit` — a `DropdownMenu` trigger labelled for screen readers with a single `DropdownMenuItem` opening the edit dialog.

#### 3. `EditRecruitmentDialog`

**File**: `src/components/recruitments/EditRecruitmentDialog.tsx` (new)

**Intent**: The edit form itself, following the `MoveCandidateDialog` pattern.

**Contract**: Controlled `open`/`onOpenChange` from the header; the inner form is mounted only while open. `data-testid="edit-recruitment-dialog"` on `DialogContent`. Uses `useMutation<UpdateRecruitmentDetailsCommand, RecruitmentDetailDto>(url, "PATCH")` and `useFormErrors` with a `FIELD_ORDER` for `focusFirstInvalidField`, client-validates via the shared module, renders `Alert variant="error"` for the request-level error and per-field errors on `FormField`. On success: `toast({variant:"success"})`, dispatch the details event, close.

#### 4. Wire the page

**File**: `src/pages/recruitments/[id].astro`

**Intent**: Swap the static header block for the island.

**Contract**: The `page-title` Fragment renders `<RecruitmentHeader recruitment={recruitment} canEdit={Astro.locals.operations.includes("recruitment.write")} client:load />`. The `RecruitmentStatusBadge` import, the `metadataEntries` computation, the `formatDate` helper and the `EMPLOYMENT_TYPE_LABELS` import all move out. `Layout title=` still uses the server-side title.

#### 5. Retire `RecruitmentStatusBadge`

**File**: `src/components/recruitments/RecruitmentStatusBadge.tsx` (delete)

**Intent**: Its sole consumer is gone and its behavior is absorbed by the header island.

**Contract**: Delete the file; confirm no remaining imports.

#### 6. Component tests

**Files**: `src/components/recruitments/RecruitmentHeader.test.tsx`, `EditRecruitmentDialog.test.tsx` (new)

**Intent**: Cover the island's event wiring and the dialog's validation/submit behavior.

**Contract**: Header — renders title/metadata from props, hides the menu when `canEdit` is false, and repaints on both dispatched events. Dialog — blocks submit on an empty title without firing fetch, renders a server field error, and dispatches the details event on success. Follow the `vi.stubGlobal("fetch", ...)` URL/method mocking already used in `CreateRecruitmentForm.test.tsx`.

### Success Criteria:

#### Automated Verification:

- Unit and component tests pass: `npm run test`
- Type checking and linting pass: `npm run lint`
- Production build succeeds: `npm run build`
- No dangling references: `grep -rn "RecruitmentStatusBadge" src/` returns nothing

#### Manual Verification:

- The "…" menu opens from the header, the dialog pre-fills current values, and saving updates the title and metadata row without a reload.
- Clearing an optional field removes it from the metadata row.
- The menu is absent for a user without `recruitment.write`.
- Keyboard-only operation works: the menu opens, the item activates, focus moves into the dialog and returns to the trigger on close.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: E2E and accessibility verification

### Overview

Prove the flow end-to-end in a browser and satisfy the accessibility obligations `lessons.md` attaches to any slice touching `src/components/**`.

### Changes Required:

#### 1. E2E spec

**File**: `tests/e2e/recruitments.spec.ts`

**Intent**: Cover the edit flow alongside the existing create/status specs.

**Contract**: A test signing in via `signInAs(page, "hr")`, creating a recruitment with a `Date.now()`-suffixed title (matching the existing uniqueness convention, and following the suite's no-teardown convention), opening the "…" menu, editing the title and one metadata field, asserting the header updates without navigation, then reloading to assert persistence. Locators use `getByRole`/`getByLabel` per the repo rule, with `getByTestId` only for the dialog anchor. Form fills use the existing `toPass` retry wrapper, since the header is a `client:load` island subject to the same hydration race documented in `tests/e2e/support/auth.ts`.

#### 2. Accessibility follow-through

**File**: `tests/e2e/accessibility.spec.ts` (verify), `context/changes/accessibility-audit-wcag-aa/deferred-findings.md` (check)

**Intent**: Meet the two obligations in `context/foundation/lessons.md:21-24`.

**Contract**: Confirm the axe scan of the recruitment detail screen still passes in both themes with the new island and an open dialog; measure any new color pairing with `contrastRatio()`/`meetsAA()` from `src/lib/contrast.ts` rather than by eye; and check `deferred-findings.md` for a row matching `[id].astro` or the retired badge component, removing it if this change resolved it.

### Success Criteria:

#### Automated Verification:

- E2E suite passes: `npm run test:e2e`
- The axe scan in `tests/e2e/accessibility.spec.ts` passes in light and dark
- Design-token assertions pass: `npm run test -- design-tokens`
- Full lint and build pass: `npm run lint && npm run build`

#### Manual Verification:

- The edit dialog is usable with a screen reader: the menu item is announced, the dialog title is read on open, and validation errors are announced.
- No raw Tailwind palette literal was introduced anywhere in the new components.

---

## Testing Strategy

### Unit Tests:

- Shared validation module: title bounds at 0/1/200/201 chars, department and location at 120/121, `openedAt` accepting a real date and rejecting `2026-02-30` and free text, empty-string-to-null normalization for each clearable field.
- `updateRecruitmentDetails`: success mapping, error propagation.
- `RecruitmentHeader`: props rendering, `canEdit` gating, repaint on each of the two events.
- `EditRecruitmentDialog`: client-side block before fetch, server field error rendering, event dispatch on success.

### Integration Tests:

- Details update persists; optional field clears to `null`; 403 for a caller without write access; 404 for an unknown id; 422 with `fields` for an over-length title; status-only PATCH regression.

### Manual Testing Steps:

1. Sign in as the seeded `hr` user and open an existing recruitment.
2. Open the "…" menu, choose Edit details, change the title and department, save — confirm the toast, the in-place header update, and no page navigation.
3. Reopen the dialog, clear the location, save — confirm it disappears from the metadata row and stays gone after a reload.
4. Submit an empty title — confirm the field error and that focus lands on the title input.
5. Sign in as `hiringManager` on the same recruitment — confirm the "…" menu is absent.
6. Repeat step 2 in dark mode and with keyboard only.

## Performance Considerations

None material. The dialog adds one PATCH per save and the header island replaces static markup with a hydrated component of comparable size. The dialog form mounts only while open, so no extra work happens on page load.

## Migration Notes

One forward-only migration adding a new function; no data is altered and no existing column or policy changes. Rolling back means dropping `public.update_recruitment` — the route's details branch would then 500, but the status branch, which never touches the RPC, keeps working.

The new length bounds apply on write only. Any existing row whose title exceeds 200 characters remains readable and is only rejected if someone tries to re-save it unchanged; the seeded data is well inside the bounds.

## References

- Related research: `context/changes/recruitment-edit-details/research.md`
- RPC precedent: `supabase/migrations/20260901150000_create_recruitment_returns_row.sql`
- Route error-mapping precedent: `src/pages/api/recruitments/index.ts:71-87`
- Cross-island event precedent: `src/lib/recruitment-status-events.ts`, `src/components/recruitments/RecruitmentStatusBadge.tsx:20-33`
- Dialog + field-error precedent: `src/components/recruitments/MoveCandidateDialog.tsx`
- Form precedent: `src/components/recruitments/CreateRecruitmentForm.tsx`
- Accessibility obligations: `context/foundation/lessons.md:21-24`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared validation, RPC, and service layer

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — ae70277
- [x] 1.2 Unit tests pass: `npm run test` — ae70277
- [x] 1.3 Type checking and linting pass: `npm run lint` — ae70277
- [x] 1.4 Existing create-path tests still pass unchanged: `npm run test -- recruitments` — ae70277

#### Manual

- [x] 1.5 Creating a recruitment still works, and an over-length title is rejected with a field-level message — ae70277

### Phase 2: PATCH endpoint extension

#### Automated

- [x] 2.1 Integration tests pass: `npm run test:integration`
- [x] 2.2 Type checking and linting pass: `npm run lint`
- [x] 2.3 Existing status-PATCH integration tests pass with no edits to their assertions

#### Manual

- [x] 2.4 Manual PATCH with a details body as a signed-in recruiter returns 200 and the updated detail DTO

### Phase 3: Header island, action menu, and edit dialog

#### Automated

- [ ] 3.1 Unit and component tests pass: `npm run test`
- [ ] 3.2 Type checking and linting pass: `npm run lint`
- [ ] 3.3 Production build succeeds: `npm run build`
- [ ] 3.4 No dangling references: `grep -rn "RecruitmentStatusBadge" src/` returns nothing

#### Manual

- [ ] 3.5 Menu opens, dialog pre-fills, saving updates header without reload
- [ ] 3.6 Clearing an optional field removes it from the metadata row
- [ ] 3.7 Menu is absent for a user without `recruitment.write`
- [ ] 3.8 Keyboard-only operation works including focus return on close

### Phase 4: E2E and accessibility verification

#### Automated

- [ ] 4.1 E2E suite passes: `npm run test:e2e`
- [ ] 4.2 Axe scan passes in light and dark
- [ ] 4.3 Design-token assertions pass: `npm run test -- design-tokens`
- [ ] 4.4 Full lint and build pass: `npm run lint && npm run build`

#### Manual

- [ ] 4.5 Edit dialog is usable with a screen reader
- [ ] 4.6 No raw Tailwind palette literal introduced in the new components
