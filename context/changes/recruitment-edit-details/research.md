---
date: 2026-09-15T17:25:35Z
researcher: Claude (Sonnet 5)
git_commit: 7165490f42cab7de828a36240ec05cb83bd8a66c
branch: main
repository: 10x
topic: "Edit recruitment details (S-15 recruitment-edit-details)"
tags: [research, codebase, recruitments, forms, rls, dropdown-menu]
status: complete
last_updated: 2026-09-15
last_updated_by: Claude (Sonnet 5)
---

# Research: Edit recruitment details (S-15 recruitment-edit-details)

**Date**: 2026-09-15T17:25:35Z
**Researcher**: Claude (Sonnet 5)
**Git Commit**: 7165490f42cab7de828a36240ec05cb83bd8a66c
**Branch**: main
**Repository**: 10x

## Research Question

What exists today, and what needs to be built, to let a recruiter edit a recruitment's details (title, department, location, employment type, opened date, and possibly assigned security groups) from the recruitment detail page, per roadmap slice **S-15 (`recruitment-edit-details`, MS-10)**?

## Summary

**Nothing is built yet.** There is no edit UI, no extended PATCH endpoint, and — critically — **the "…" action menu that S-15 is supposed to slot into does not exist**. Roadmap slice S-09 (`recruitment-header-metadata`, status `done`) explicitly scoped the "…" menu **out** of its own work ("No '…' overflow/actions menu... The roadmap outcome for S-09 names only the four metadata fields" — its plan.md, "What We're NOT Doing"). So S-15 inherits building the menu trigger itself, not just an item inside it.

The good news: every building block needed already exists as a reusable primitive, just never assembled for this purpose:
- `PATCH /api/recruitments/[id]` exists but accepts **only** `{ status }` — extending it with optional fields is additive and low-risk, and RLS authorization for it is **already correctly scoped** (`recruitments_update` policy, per-recruitment `recruitment.write` check) — no migration needed for the plain-field edit.
- `CreateRecruitmentForm.tsx` is a near-complete template for validation rules, field layout, and the security-group checkbox picker — reuse, don't reinvent.
- `MoveCandidateDialog.tsx` is the template for a Dialog-wrapped form with server-side field errors via `useMutation` + `useFormErrors`.
- `src/components/ui/dropdown-menu.tsx` (radix-based, token-styled) is installed but has **zero consumers anywhere in `src/`** — this change would be its first use.
- `getRecruitmentDetail` already returns every editable scalar field but not `groupIds` — needs extending if group editing is in scope.

One real design fork to resolve before/in planning: the existing status-only PATCH silently returns **404** (not 403) for a caller who lacks `recruitment.write` but can still read the recruitment, because a plain `.update()` blocked by RLS just yields zero rows. The create/stages endpoints instead use a SECURITY DEFINER RPC that explicitly raises `42501` for a real 403. If edit-details should return 403 (matching create/stages precedent), it likely needs the same RPC pattern rather than a plain update — see Open Questions.

## Detailed Findings

### Current PATCH endpoint (status-only today)

`src/pages/api/recruitments/[id]/index.ts` (54 lines, full file) is a single `PATCH` handler:

```ts
const idParamSchema = z.coerce.number().int().positive();
const updateStatusSchema = z.object({
  status: recruitmentStatusSchema,
});
```

It validates the id, parses `{ status }` only, calls `updateRecruitmentStatus`, and maps a `null` result to 404. **It does not map any Supabase/Postgres error codes** — unlike sibling routes (`src/pages/api/recruitments/index.ts:71-87`, `src/pages/api/recruitments/[id]/stages.ts:25-42`), so a denied write today would surface as a generic 500 if it ever threw, though in practice RLS makes it silently return 0 rows → null → 404 instead.

### Service layer — `src/lib/services/recruitments.ts` (312 lines)

- `updateRecruitmentStatus(client, id, status)` (`:110-134`) — the direct template for a plain-update version of edit-details:
  ```ts
  const { data: row, error } = await client
    .from("recruitments")
    .update({ status })
    .eq("id", recruitmentId)
    .select("id, status")
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;
  ```
  A new `updateRecruitmentDetails(client, id, patch)` would follow the exact same shape, `.update({...})` with only the provided optional fields, returning `null` on no-row-match (not-found-or-not-authorized under RLS).
- `createRecruitment` (`:82-108`) goes through an RPC (`create_recruitment`), not a plain insert — because it needs to atomically also assign `groupIds` and because it wants a real 403 rather than an RLS-silent failure. This is the precedent to weigh against the plain-update approach if group editing or explicit 403s are required.
- `getRecruitmentDetail` (`:199-224`) already selects everything scalar an edit form needs: `id, title, status, department, location, employment_type, opened_at`. It does **not** return `groupIds` — would need extending (or a separate fetch) if the security-group picker in the edit form should pre-select current groups.
- Two local mappers, `toRecruitmentStatus` and `toEmploymentType` (`:38-49`), zod-validate DB values and fall back gracefully rather than throwing.

### Types — `src/types.ts`

Relevant existing definitions to build on:
```ts
export const recruitmentStatusSchema = z.enum(["draft", "live", "closed"]);
export const employmentTypeSchema = z.enum(["full-time", "part-time", "contract", "internship"]);
export const operationSchema = z.enum([
  "recruitment.read", "recruitment.write", "candidate.read", "candidate.write", "group.manage",
]);

export interface CreateRecruitmentCommand {
  title: string; department: string; location: string;
  employmentType: EmploymentType; openedAt: string; groupIds: number[];
}
export interface UpdateRecruitmentStatusCommand { status: RecruitmentStatus; }
export interface RecruitmentDetailDto {
  id: number; title: string; status: RecruitmentStatus; department: string | null;
  location: string | null; employmentType: EmploymentType | null; openedAt: string | null;
}
```
No `UpdateRecruitmentCommand` / `UpdateRecruitmentDetailsCommand` type exists yet — will need adding, most naturally mirroring `CreateRecruitmentCommand` with all fields optional (minus `groupIds`, unless group editing is in scope, in which case it stays required-if-present with the same `min(1)` validation as create).

### Data model & RLS — already sufficient for scalar-field editing

Table (`supabase/migrations/20260831182957_recruitment_candidate_schema.sql:13-23`):
```sql
create table recruitments (
  id bigint generated always as identity primary key,
  title text not null,
  location text,
  department text,
  employment_type text,
  opened_at date,
  status text not null default 'draft' check (status in ('draft', 'live', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
`employment_type`/`status` are free text with a CHECK, not Postgres enums — app-side zod is the real gate.

RLS (`supabase/migrations/20260831183457_rls_policies.sql:141-144`):
```sql
create policy recruitments_update on recruitments
  for update to authenticated
  using ((select private.has_recruitment_operation(id, 'recruitment.write')))
  with check ((select private.has_recruitment_operation(id, 'recruitment.write')));
```
This is **already** scoped exactly right for editing any recruitment's scalar fields — no new migration needed for title/department/location/employmentType/openedAt.

Group reassignment (only relevant if in scope), `recruitment_security_groups_insert`/`_delete` (`:148-161`), both gated on the **broad** `has_operation('recruitment.write')` (not recruitment-scoped) — same "chicken-and-egg" pattern as `recruitments_insert`, because a not-yet-assigned recruitment can't be scope-checked. Editing group membership on an *existing* recruitment would need to reconcile this with the recruitment-scoped update check, likely via an RPC (see Open Questions).

### Authorization pattern — enforced entirely at the DB layer

No app-level `hasOperation`/`requireOperation` helper exists anywhere in `src/`. Every route just issues the query as the authenticated user and lets RLS filter, then either:
- **Plain update** (status pattern): denied write → 0 rows → `null` → route returns 404. No distinction between "doesn't exist" and "exists but I can't write it."
- **RPC** (create/stages pattern): SECURITY DEFINER function explicitly checks and `raise exception ... using errcode = '42501'` (e.g. `create_recruitment` in `supabase/migrations/20260901150000_create_recruitment_returns_row.sql:26-28`), and the route pattern-matches `error.code` to return a real 403 (`src/pages/api/recruitments/index.ts:71-87`, `stages.ts`'s `handleStageRpcError`).

**This is the key design fork for the plan**: if edit-details should 403 a read-only caller (matching create/stages precedent), it needs the RPC pattern, not a plain `.update()`.

### UI — page, header, and the missing "…" menu

`src/pages/recruitments/[id].astro` (90 lines, full file): SSR page, fetches `recruitment` via `getRecruitmentDetail`, renders title + `RecruitmentStatusBadge` + a metadata row directly inline in the `page-title` slot of `AppShell` — **no separate header component, no action menu, no dropdown import**. `KanbanBoard` (client:load) follows below.

The only existing status-change control, `data-testid="status-control"`, lives inside `KanbanBoard.tsx:120-166` as a row of pill buttons in the Kanban toolbar — **not in the header**, and not a dropdown menu.

Per `context/changes/recruitment-header-metadata/plan.md` ("What We're NOT Doing"): *"No '…' overflow/actions menu, despite S-08's deferral note mentioning one. The roadmap outcome for S-09 names only the four metadata fields."* Confirmed by grep: zero `MoreHorizontal`/`DropdownMenu`/overflow-menu usage anywhere in `src/components/recruitments/` or `src/pages/recruitments/`.

`src/components/ui/dropdown-menu.tsx` (101 lines, full file) — radix-based (`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuGroup`), token-styled (`bg-popover`, `focus:bg-accent`, `data-[variant=destructive]:text-destructive`). **Installed, zero consumers in `src/`.** This change is the natural first consumer — the trigger button goes in the header (currently inline JSX in `[id].astro`), and would need to become (or be adjacent to) a small client island since the menu needs interactivity (`.astro` files can't host onClick handlers).

### Form template — `CreateRecruitmentForm.tsx` (218 lines, full file) + test (111 lines)

Closest existing analogue, to reuse rather than reinvent:
- Hand-rolled `validate()` (`:34-48`) — no zod schema for form fields (only `employmentTypeSchema` reused for select options). No max-length constraints on any string field, server or client side (confirmed via `createRecruitmentSchema` in `src/pages/api/recruitments/index.ts:12-19`: `title/department/location: z.string().min(1)`, `openedAt: z.string().min(1)`, no upper bound).
- `FIELD_ORDER` (`:26-32`) drives focus-first-invalid-field via `useFormErrors`.
- Data hooks: `useApiResource<SecurityGroupDto[]>("/api/security-groups")` for the groups list, `useMutation<CreateRecruitmentCommand, RecruitmentListItemDto>("/api/recruitments", "POST")` for submit.
- Employment type is a raw `<select>` styled with token classes (**no shadcn `ui/select` used** anywhere in the codebase for this).
- Security-group picker (`:165-199`) is an inline checkbox list bound to local `groupIds: number[]` state via a `toggleGroup` helper — the **only** group-picker implementation in the codebase; not extracted into a reusable component. Good candidate to extract into e.g. `SecurityGroupPicker` since edit needs the identical UI pre-populated with current `groupIds`.
- Submit flow: client validate → `mutate()` → success toast → `window.location.href` redirect. No server-side field-error wiring on this particular form (unlike `MoveCandidateDialog`).

### Dialog + server-field-error template — `MoveCandidateDialog.tsx` (193 lines, full file)

Best template for a modal edit form:
- `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter` from `src/components/ui/dialog.tsx` (146 lines, radix-based, token-styled).
- Inner form (`MoveCandidateForm`) only mounted while `open` is true (`{open && <MoveCandidateForm .../>}`) — fetches on-open, not on page load. Apply the same trick for fetching full recruitment detail when the edit dialog opens (avoids an extra fetch on every page load).
- `useMutation` + `fieldErrors` wired to input `error` props and `focusFirstInvalidField` in a `useEffect` — the pattern for surfacing server-side validation errors (e.g. a 422 on `openedAt`).
- `data-testid="move-candidate-dialog"` on `DialogContent` — edit-details dialog should get an analogous stable testid, e.g. `data-testid="edit-recruitment-dialog"`.

### Hooks — `src/components/hooks/`

- `useApiResource.ts` (103 lines) — GET-only, `loading|success|not-found|error` states, 401→redirect, 404→`not-found`. Reuse for lazily fetching full recruitment detail (and `groupIds`, if added) when the edit dialog opens.
- `useMutation.ts` (74 lines) — generic `useMutation<TBody,TResponse>(url, method)`, parses `ApiErrorBody.error.fields` into `fieldErrors`. This is what the edit form's submit should use against the extended `PATCH /api/recruitments/:id`.
- `useFormErrors.ts` (47 lines) — `{errors, setErrors, clearError}` + exported `focusFirstInvalidField`, shared by both existing forms.

### Design tokens rule (`context/foundation/lessons.md:12-24`)

Hard rule: colors only through design tokens (`bg-background`, `text-primary`, `border-input`, etc., via `cn()`), never raw Tailwind palette literals or new non-token utilities. If a needed token is missing, add it to **both** light and dark blocks in `src/styles/global.css`. A second lesson ties any touched screen back to the WCAG audit: measure contrast (`src/lib/contrast.ts`) and clear any matching row in `context/changes/accessibility-audit-wcag-aa/deferred-findings.md`. Every primitive this change would reuse (`FormField`, `Alert`, `Button`, `Dialog`, `DropdownMenu`) is already on tokens, so following existing patterns keeps this automatic.

### Test conventions

**Unit** (`src/lib/services/recruitments.test.ts`): hand-rolled `FakeQueryBuilder<T>` + per-shape client factories (`makeUpdateStatusClient`, etc.). `updateRecruitmentStatus` tests (`:279-296`) are the 3-case template to copy for a new `updateRecruitmentDetails`: "returns updated DTO on match" / "returns null when no row matches" / "propagates a Supabase error as a throw".

**Integration** (`src/pages/api/recruitments/index.integration.test.ts`, real local Supabase + running Astro server, `signInIntegrationClient("hr"|"hiringManager"|"admin")`): PATCH tests for status already live here starting `:117` — new edit-details PATCH tests should sit in the same `describe("PATCH /api/recruitments/[id]")` block, covering: HR with write access succeeds and persists; a caller without write access to that specific recruitment gets 403 (`body.error.code === "forbidden"`, **if** the RPC-based 403 approach is adopted — currently this exact scenario for status returns 404, so decide which is correct going forward, possibly for both) or 404 (current behavior); invalid fields → 422 with `body.error.fields`. Note: there's no separate `[id]/index.integration.test.ts` file — PATCH tests for the `[id]` route currently live inside the confusingly-named top-level `index.integration.test.ts`; decide whether to keep that or split out a per-route file (`stages.integration.test.ts` already does the per-route split).

**E2E** (`tests/e2e/recruitments.spec.ts`, `tests/e2e/support/auth.ts`): strict `getByRole`/`getByLabel`/`getByText`, with `getByTestId` only for the two invariant anchors (`status-control`, `move-candidate-dialog`). `signInAs(page, role)` wraps sign-in in a `toPass` retry (the sign-in island is `client:load` and can lose fill values to a hydration race — apply the same retry pattern to any new form fill in E2E). Recruitment creation in tests (`:120-171`) uses `` `E2E Test Role ${Date.now()}` `` for uniqueness and has **no teardown** — no DB cleanup step exists in this suite; a new edit-details E2E spec should follow the same no-cleanup convention already in place (not introduce one unilaterally).

**`data-testid` inventory** (11 found in `src/`, roadmap says 9 — roadmap count is stale):
`candidate-list`, `add-candidate-trigger`, `add-candidate-dialog`, `stage-editor-trigger`, `stage-editor-dialog`, `stages-locked-message`, `move-candidate-dialog`, `` note-${stageId} ``, `status-control`, `kanban-columns`, plus a test-only `icon` in `form-field.test.tsx` (not a real app anchor). `status-control` and `move-candidate-dialog` are explicitly "must not change" invariants per roadmap risk notes and `recruitments.spec.ts:85-95`.

### PRD scope — editing is a post-MVP addition, not contradicted or pre-authorized

`context/foundation/prd.md`, Rekrutacje section:
- **FR-001**: create a recruitment with title + metadata.
- **FR-001a**: at least one security group must be assigned at creation; "edytowalna" there refers to access-control scope, not an edit *feature*.
- **FR-002**: status change only.

No FR explicitly grants or scopes post-creation editing of title/location/department/employment-type/opened-date, and the PRD's Non-Goals section doesn't mention it either — S-15/MS-10 is a roadmap-only addition layered on top of FR-001/FR-001a, not a PRD gap-fill.

### Existing implementation state — fully greenfield

`grep -rniE "edit.*recruitment|recruitment.*edit" src/` → zero UI/route hits (only unrelated `StageEditor` copy). No `EditRecruitment*` component, page, or route stub anywhere. `context/changes/recruitment-edit-details/change.md` exists (status `preparing`) with only the identity/notes scaffold — no prior `research.md`/`plan.md`.

## Code References

- `src/pages/api/recruitments/[id]/index.ts:10-53` — current status-only PATCH handler
- `src/lib/services/recruitments.ts:110-134` — `updateRecruitmentStatus`, template for the new update function
- `src/lib/services/recruitments.ts:199-224` — `getRecruitmentDetail`, needs `groupIds` if group editing is in scope
- `src/lib/services/recruitments.ts:82-108` — `createRecruitment`, RPC-based precedent for atomic writes + real 403s
- `src/types.ts:8,15,23-29,50-66,83-91` — status/employmentType/operation schemas, `CreateRecruitmentCommand`, `UpdateRecruitmentStatusCommand`, `RecruitmentDetailDto`
- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:13-23` — `recruitments` table definition
- `supabase/migrations/20260831183457_rls_policies.sql:141-144` — `recruitments_update` RLS policy (already correctly scoped)
- `supabase/migrations/20260831183457_rls_policies.sql:148-161` — `recruitment_security_groups_insert`/`_delete` policies (broad, not recruitment-scoped)
- `supabase/migrations/20260901150000_create_recruitment_returns_row.sql:26-28` — RPC 403-raising precedent
- `src/pages/api/recruitments/index.ts:12-19,71-87` — `createRecruitmentSchema` + RPC error-code mapping pattern
- `src/pages/recruitments/[id].astro:54-79` — inline header, no action menu, `KanbanBoard` mount
- `src/components/recruitments/KanbanBoard.tsx:120-166,151,290-296` — `StatusControl`, `data-testid="status-control"`, toolbar placement
- `src/components/ui/dropdown-menu.tsx` — installed, unused primitive for the "…" menu
- `src/components/recruitments/CreateRecruitmentForm.tsx:26-48,59-68,135-148,165-199,203-215` — form template, group picker, validation, submit/loading states
- `src/components/recruitments/MoveCandidateDialog.tsx:62-66,174,182` — Dialog + server field-error template, `data-testid` convention
- `src/components/hooks/useApiResource.ts`, `useMutation.ts`, `useFormErrors.ts` — reusable data/form hooks
- `context/foundation/lessons.md:12-24` — design-token rule + WCAG follow-through rule
- `src/lib/services/recruitments.test.ts:279-296` — unit test template for update functions
- `src/pages/api/recruitments/index.integration.test.ts:62-85,117+` — integration test conventions, 403 assertion pattern for POST
- `tests/e2e/recruitments.spec.ts:85-95,120-171` — E2E creation/status flow, invariant assertions
- `tests/e2e/support/auth.ts:5-38` — `signInAs`, seeded users, hydration-race retry pattern

## Architecture Insights

- **Authorization lives entirely in Postgres RLS**, never in route code — a plan for this feature should specify which write path (plain update vs. SECURITY DEFINER RPC) based on whether a real 403 is required, not assume the app layer will check permissions.
- **The "…" header action menu is a shared prerequisite two roadmap slices (S-09, S-15) each assumed the other would build.** S-09 explicitly deferred it; S-15's own outcome text presupposes it exists. The plan for this change needs to either build the dropdown scaffold itself or flag it as a co-requisite.
- **Group-membership UI has never been extracted into a reusable component** — both `CreateRecruitmentForm` (existing) and this new edit form (needed) want the identical checkbox-list-bound-to-`groupIds` pattern; extracting a shared `SecurityGroupPicker` avoids a second copy of the same logic the roadmap already flagged as a duplication risk pattern elsewhere (see S-12's filter-logic consolidation note).
- **No client-side or server-side max-length validation exists on any recruitment text field** today — an edit form mirroring `CreateRecruitmentForm`'s `validate()` would inherit that same gap; worth a conscious decision rather than silent inheritance.
- **Test suite convention is "no cleanup"** — recruitments created by E2E/integration tests accumulate in the seeded DB relying only on timestamp-uniqueness, not deletion. A new edit-details test suite should follow this same convention rather than introducing an inconsistent teardown step.

## Historical Context (from prior changes)

- `context/changes/recruitment-header-metadata/plan.md` ("What We're NOT Doing") — explicit statement that the "…" menu was cut from S-09's scope, the direct cause of S-15 needing to build it.
- `context/changes/recruiter-creates-recruitment/` (plan.md, research.md, reviews/) — origin of `createRecruitmentSchema`, `CreateRecruitmentForm`, and the security-group checkbox picker; the validation rules and RPC-based write pattern this change should mirror or deliberately diverge from.
- `context/foundation/roadmap.md:130,198` — S-09's own risk note already anticipated status-control needing to move into a future "…" menu without breaking `data-testid="status-control"`; S-15's risk note (line 198) anticipates the PATCH schema extension needing to stay additive for the same reason.

## Related Research

- None yet under `context/changes/recruitment-edit-details/` — this is the first artifact for this change.

## Open Questions

1. **Plain `.update()` vs. SECURITY DEFINER RPC for the extended PATCH.** The status-only PATCH today returns 404 (not 403) for a caller who can read but not write. If edit-details should return a real 403 (matching create/stages precedent and what integration tests assert for POST), it needs the RPC pattern instead of a plain update. Needs a decision before implementation — this also decides whether the *existing* status-only PATCH's 404-for-forbidden is an accepted gap or something to fix in the same change.
2. **Is security-group reassignment in scope for S-15**, per the roadmap's own open unknown (self-lockout risk: a recruiter could remove the group that gives them access to the very recruitment they're editing). If in scope, needs `groupIds` added to `getRecruitmentDetail`, reconciling the broad (non-recruitment-scoped) `recruitment_security_groups_insert`/`_delete` RLS policies with per-recruitment write checks, and a UX guard against self-lockout.
3. **Does an edit create a history/audit entry**, per the roadmap's second open unknown — no existing precedent for recruitment-level history exists in the schema (only candidate stage-note history).
4. **Should the "…" dropdown menu subsume the existing `StatusControl` pill buttons** (currently in the Kanban toolbar, `data-testid="status-control"`), or does edit-details get its own separate trigger while status stays where it is? The roadmap's S-09 risk note implies status should eventually move into the menu too, but that's not S-15's stated scope — worth an explicit scope call to avoid scope creep or a half-migrated header.
5. **Max-length / format validation for text fields** — should this change add bounds that don't exist today (e.g. `title`/`department`/`location` length caps, `openedAt` real date-format validation), or strictly mirror the current unlimited-length behavior from `createRecruitmentSchema`?
