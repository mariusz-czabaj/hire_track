# Recruiter Creates Recruitment Implementation Plan

## Overview

Recruiters create a new recruitment (title, department, location, employment type, opened date), assign at least one security group, and set/change its status (Draft / Live / Closed). This is roadmap slice S-02, unlocked by F-01 (data foundation) and S-01 (kanban board read path).

## Current State Analysis

The database write path for `recruitments` and `recruitment_security_groups` already exists (INSERT/UPDATE policies + grants shipped in F-01). No new table or base RLS policy is needed. `security_groups` is readable by all authenticated users (`using (true)`), which powers the group picker with no new machinery.

What's missing: the actual write endpoints, the atomic create mechanism, and all UI.

### Key Discoveries:

- **The naive create sequence deadlocks.** `recruitments_select` requires a row in `recruitment_security_groups` to exist before a recruitment is visible to its creator ([rls_policies.sql:133-135](../../../supabase/migrations/20260831183457_rls_policies.sql:133)). `.insert().select()` returns 403; `.insert()` without read-back succeeds but strands an unreachable row whose id the client never learns, so the group link can never be attached. Verified empirically against the local stack (see research.md). **The create must be one atomic `security definer` RPC** that inserts the recruitment, inserts the group links, and returns the new id in a single transaction.
- **No prior multi-step write function exists** to copy verbatim — the closest precedent is `private.has_operation` ([mark_rls_helpers_stable.sql:5-19](../../../supabase/migrations/20260831195143_mark_rls_helpers_stable.sql:5)): `private` schema, `security definer`, `set search_path = ''`, fully-qualified `public.*` references. The new RPC follows this header pattern but is `language plpgsql` (not `sql`) since it does multiple statements, and must **re-check `has_operation('recruitment.write')` itself** because `security definer` bypasses RLS.
- **No DB constraint enforces ≥1 group** — the RPC must enforce this in-transaction (raise an exception, causing rollback, if the groups array is empty).
- **Endpoint pattern to copy**: `src/pages/api/recruitments/index.ts` (`GET`) and `[id]/board.ts` — `export const prerender = false`, module-scope zod schema, `safeParse` → `jsonError(422, "invalid_request", ...)`, `createClient(...)` null-guard → `jsonError(500, "supabase_unconfigured", ...)`, service call in try/catch → `jsonError(500, "internal", ...)` on catch, `jsonOk(data)` on success. Helpers live in `src/lib/api-response.ts`.
- **Service layer pattern**: `src/lib/services/recruitments.ts` — functions take `client: SupabaseClient<Database>` first, destructure `{ data, error }`, `throw` on error, map snake_case → camelCase manually, return DTOs, return `null` for not-found (endpoint maps to 404).
- **`recruitmentStatusSchema = z.enum(["draft","live","closed"])`** ([types.ts:8](../../../src/types.ts:8)) is the single source of truth for status — reuse it for both the create command and the status-update command.
- **No mutation hook exists yet** — `useApiResource` ([useApiResource.ts:4-70](../../../src/components/hooks/useApiResource.ts:4)) is GET-only, fires on mount. A new hook is needed with an imperative `mutate(body)`, reusing its `readErrorMessage` and 401-redirect logic rather than duplicating them.
- **Form pattern to extend, not replace**: `FormField.tsx`, `SubmitButton.tsx` (uses `useFormStatus`, requires a native `<form>`), `SignInForm.tsx` (local `errors` state, `clearError`, `ServerError`). Because the create form submits via `fetch` (not a native POST), it **cannot use `useFormStatus`** — needs its own `submitting` state instead of reusing `SubmitButton` as-is.
- **shadcn/ui gap**: only `badge`, `button`, `card`, `skeleton` exist under `src/components/ui/`. No `input`, `select`, `label`, `form`. The existing forms don't use shadcn inputs at all (bespoke `FormField` matching the `bg-cosmic` glass theme) — new form fields extend `FormField`, not stock shadcn primitives.
- **Test conventions**: unit tests use Vitest with a hand-rolled `FakeQueryBuilder<T>` stub ([recruitments.test.ts](../../../src/lib/services/recruitments.test.ts)); RLS/write-permission verification uses raw SQL scripts with `begin...rollback` wrapping ([rls_verification.sql](../../../supabase/tests/rls_verification.sql)), run via `npx supabase db query --local -f ...`; E2E uses Playwright with a `signInAs(page, role)` helper against seeded users ([support/auth.ts](../../../tests/e2e/support/auth.ts)).
- **Middleware already protects this slice's routes**: `/recruitments` (`startsWith`) covers `/recruitments/new`, and the `/api/` guard (excluding `/api/auth/`) gives `POST /api/recruitments` 401 handling for free with `context.locals.user` guaranteed.

## Desired End State

A recruiter (member of a group with `recruitment.write`) can:
1. Navigate to `/recruitments/new`, fill in title, department, location, employment type (fixed list), opened date, and pick one or more security groups, and submit.
2. On success, the recruitment exists in the DB, is immediately visible to the creator (via the atomic RPC), and the recruitor is redirected to the recruitment's board/detail view.
3. On validation failure, per-field errors render inline on the form.
4. Change a recruitment's status between Draft/Live/Closed (any transition legal) via a control on the recruitment detail/board view; a Hiring Manager attempting either action gets a clear, non-crashing denial (404 for status update, per the inherited 403→404-on-scoped-write rule; 403 for create, since create authorization is unscoped).

A Hiring Manager sees the "New recruitment" affordance but is denied on submit — no client-side role gating.

### Verification

- `npm run lint` and `npm run build` pass.
- Vitest unit tests pass for the new service functions and mutation hook.
- `supabase/tests/rls_verification.sql` extended with the create-RPC deadlock scenario (positive: HR creates and immediately sees it; negative: Hiring Manager and Admin denied) passes via `npx supabase db query --local -f supabase/tests/rls_verification.sql`.
- Playwright E2E happy path: HR user creates a recruitment, sees it in their list, changes its status.

## What We're NOT Doing

- No `kanban_stages` changes (S-03's job).
- No recruitment status-history / audit trail (not required by FR-002; no table exists for it).
- No restriction on status transitions (any Draft/Live/Closed transition is legal, including reopening Closed).
- No auto-assignment of the creator's own security group.
- No CSRF protection (none exists anywhere in the app today; out of scope for this slice).
- No new admin/role-management UI (that's S-07).
- No filtering the security-group picker down to "groups conferring `recruitment.read`" (not possible without new server-side machinery per research; out of scope).

## Implementation Approach

Ship the atomic create as a `security definer` Postgres function (new migration), then a thin API layer (`POST /api/recruitments`, `PATCH /api/recruitments/[id]`) following the S-01 JSON+zod convention exactly, then a create form and status control reusing/extending the existing `FormField` component family, then tests at all three layers (RPC, API, E2E).

## Critical Implementation Details

### Timing & lifecycle

The RPC is the *only* place the recruitment insert and the group-link inserts may happen together. Any code path that inserts a recruitment without inserting at least one `recruitment_security_groups` row in the same transaction reproduces the deadlock. The RPC must `raise exception` (causing an automatic rollback of the recruitment insert too) if the caller-supplied group id array is empty or if `has_operation('recruitment.write')` is false — do not rely on the RLS INSERT policy alone, since `security definer` bypasses it.

## Phase 1: Atomic create RPC (migration)

### Overview

Add a `security definer` function that atomically creates a recruitment, links it to one or more security groups, enforces ≥1 group, re-checks `recruitment.write`, and returns the new recruitment id. Regenerate TypeScript types.

### Changes Required:

#### 1. New migration: create-recruitment RPC

**File**: `supabase/migrations/<timestamp>_create_recruitment_function.sql`

**Intent**: Atomically insert a `recruitments` row and its `recruitment_security_groups` links in one transaction, so the row is never visible-but-unlinked or linked-but-invisible. Solves the deadlock documented in research.md.

**Contract**: `private.create_recruitment(p_title text, p_department text, p_location text, p_employment_type text, p_opened_at date, p_group_ids bigint[]) returns bigint`, `language plpgsql`, `security definer`, `set search_path = ''`. Body: re-check `public.has_operation('recruitment.write')` (raise exception if false — mirrors the unscoped check the INSERT policy already uses), raise exception if `p_group_ids` is null or empty, insert into `public.recruitments` returning `id` into a local var, insert one row per group id into `public.recruitment_security_groups`, `return` the new id. Grant `execute` to `authenticated` only (mirror existing helpers — no explicit `anon`/`public` grant). Before writing this migration, read the literal `create function private.xxx` statements in `mark_rls_helpers_stable.sql` and `rls_policies.sql` side-by-side to confirm the exact schema-qualification and grant pattern, and copy it verbatim.

#### 2. Regenerate types

**File**: `src/db/database.types.ts`

**Intent**: Pick up the new RPC in the generated `Functions` type so the service layer gets type-safe `supabase.rpc(...)` calls.

**Contract**: Run `npm run db:types`. No manual edits.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset --local` (or `npx supabase migration up --local`)
- `npm run db:types` regenerates `database.types.ts` with the new function present and the diff is committed (CI enforces via `git diff --exit-code`)
- `supabase/tests/rls_verification.sql` extended with: HR creates via RPC and immediately sees the row (positive); Hiring Manager and Admin calling the RPC are rejected (negative); calling with an empty group array is rejected — run via `npx supabase db query --local -f supabase/tests/rls_verification.sql`

#### Manual Verification:

- Inspect the migration SQL for the exact hardening pattern (`search_path=''`, re-check, fully-qualified table refs) against `mark_rls_helpers_stable.sql`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: API endpoints

### Overview

Add `POST /api/recruitments` (create, calls the RPC) and `PATCH /api/recruitments/[id]` (status update), plus the zod schemas, DTO/command types, and the `fields` extension to `ApiErrorBody`.

### Changes Required:

#### 1. Types and schemas

**File**: `src/types.ts`

**Intent**: Add the create-command and status-update-command shapes, an `employmentTypeSchema` fixed-list enum, and extend the error contract with optional per-field errors.

**Contract**: `employmentTypeSchema = z.enum([...])` (pick a small, reasonable fixed list — e.g. `["full-time", "part-time", "contract", "internship"]` — following the `recruitmentStatusSchema` drift-discipline comment pattern). `CreateRecruitmentCommand` (title, department, location, employmentType, openedAt, groupIds: number[], all required per FR-001/FR-001a) and `UpdateRecruitmentStatusCommand` (status: reuse `recruitmentStatusSchema`). Extend `ApiErrorBody` with an optional `fields?: Record<string, string>`, populated only on 422 responses from a failed `safeParse`.

#### 1a. Error response helper

**File**: `src/lib/api-response.ts`

**Intent**: `jsonError` currently has no way to populate the new `fields` on `ApiErrorBody` — this is the one place that constructs the error body, so it must be extended alongside the type.

**Contract**: `jsonError(status, code, message, fields?: Record<string, string>)` — include `fields` in the constructed body only when passed.

#### 2. Service functions

**File**: `src/lib/services/recruitments.ts`

**Intent**: Add `createRecruitment(client, command)` calling `client.rpc("create_recruitment", {...})`, mapping the returned id into a re-fetch or a minimal DTO; add `updateRecruitmentStatus(client, id, status)` doing a scoped `update().eq("id", id).select().maybeSingle()`, returning `null` on no-match (404) per the existing not-found convention.

**Contract**: Same shape as existing functions — `Client` type alias, throw on `{error}`, camelCase DTO out.

#### 3. Create endpoint

**File**: `src/pages/api/recruitments/index.ts`

**Intent**: Add a `POST` export alongside the existing `GET`, following the file's established shape.

**Contract**: `export const POST: APIRoute = async (context) => {...}` — parse JSON body, `CreateRecruitmentCommand`-shaped zod schema `safeParse` → 422 with `fields` populated from zod's per-field issues, `createClient` null-guard → 500, call `createRecruitment` in try/catch → catch maps RPC "not authorized" exception to 403 `jsonError(403, "forbidden", ...)`, any other error to 500; success → `jsonOk(dto, 201)`.

#### 4. Status update endpoint

**File**: `src/pages/api/recruitments/[id]/index.ts`

**Intent**: New file, `PATCH` handler for status changes, mirroring `[id]/board.ts`'s path-param parsing.

**Contract**: `export const prerender = false; export const PATCH: APIRoute = ...` — `z.coerce.number().int().positive()` for the id param, zod body validation against `UpdateRecruitmentStatusCommand`, `updateRecruitmentStatus` returning `null` → `jsonError(404, "not_found", ...)` (per the inherited 404-for-forbidden-or-missing rule since UPDATE is scoped-permission-guarded), success → `jsonOk(dto)`.

#### 5. HTTP integration-test harness

**File**: `src/lib/test-support/integration-client.ts` (new)

**Intent**: No prior harness exists for hitting local Supabase over HTTP with role-based auth from Vitest — the only existing role-aware harness is raw SQL (`rls_verification.sql`, not Vitest) and Playwright E2E (browser-level, not API-level). This slice is the first to need endpoint-level integration coverage, so the harness is built here, once, and reused by Phase 4's tests.

**Contract**: A helper that, for a given seeded role key (`"hr" | "hiringManager" | "admin"`, reusing `SEEDED_USERS` credentials from `tests/e2e/support/auth.ts`), signs in via `supabase-js` against the local instance, and returns a `fetch`-compatible caller that attaches the resulting session to requests against a locally running Astro server (started via the same mechanism the E2E suite already relies on for local dev/preview). Document the one manual prerequisite (a running local Supabase + Astro server) directly in this file's header comment, since it's a new requirement `npm run test` didn't previously have.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check` (or project's typecheck script)
- Linting passes: `npm run lint`
- Unit tests pass for `createRecruitment` and `updateRecruitmentStatus`: `npm run test` (following `recruitments.test.ts`'s `FakeQueryBuilder` pattern)
- Integration tests pass for both endpoints against local Supabase, covering all 3 seeded role fixtures (HR succeeds, Hiring Manager and Admin denied) and the empty-group-array 422/403 case
- HTTP integration-test harness (`src/lib/test-support/integration-client.ts`) exists and is used by the above tests

#### Manual Verification:

- `curl -X POST /api/recruitments` with a valid body as the seeded HR user returns 201 with the new recruitment visible in a subsequent `GET /api/recruitments`
- Same request as the seeded Hiring Manager returns 403
- `curl -X PATCH /api/recruitments/<id>` with a status change as HR returns 200; as Hiring Manager returns 404

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Frontend — create form and status control

### Overview

A `/recruitments/new` page with a create form (six fields + group multi-select), and a status-change control added to the existing recruitment board/detail view. A new mutation hook backs both.

### Changes Required:

#### 1. Mutation hook

**File**: `src/components/hooks/useMutation.ts`

**Intent**: Fetch-based imperative mutation hook (POST/PATCH), sibling to `useApiResource`, reusing its `readErrorMessage` helper and 401-redirect behavior rather than duplicating them.

**Contract**: `useMutation<TBody, TResponse>(url, method)` returning `{ mutate(body: TBody): Promise<TResponse>, status, error, fieldErrors }` — on a 422 response, populate `fieldErrors` from `ApiErrorBody.fields`.

#### 2. Group picker data

**File**: `src/lib/services/security-groups.ts` (new) + `src/pages/api/security-groups.ts` (new, `GET`)

**Intent**: Expose the full security-group list (id, name) for the picker — `security_groups` SELECT is `using (true)`, so this is a plain unscoped read, following the existing `GET` endpoint pattern.

**Contract**: `listSecurityGroups(client)` returns `{id, name}[]`; endpoint follows the same `prerender=false` / try-catch / `jsonOk` shape as `recruitments/index.ts`'s `GET`.

#### 3. Create form page

**File**: `src/pages/recruitments/new.astro` + `src/components/recruitments/CreateRecruitmentForm.tsx` (new React island)

**Intent**: Render the form for title, department, location, employment type (fixed-list `<select>` sourced from `employmentTypeSchema`), opened date, and a multi-select group picker (checkboxes or a multi-select, fetched via the new endpoint). Client-side required-field validation before submit (mirroring `SignInForm`'s local `validate()`), server 422 `fields` rendered inline via `FormField`'s `error` prop. Submit via `useMutation`, own `submitting` state (no `useFormStatus`, since this is a fetch-driven submit not a native form POST). On success, redirect to the new recruitment's board (`/recruitments/[id]`, reusing S-01's routing).

**Contract**: The "New recruitment" link/button is always rendered for any authenticated user (no client-side capability check) per the confirmed UI-affordance decision; a 403 on submit renders through `ServerError`.

#### 4. Status control

**File**: existing recruitment board/detail component (from S-01) — add a status `<select>` or button group

**Intent**: Let the user change status from the board/detail view; call `useMutation` against `PATCH /api/recruitments/[id]`; any transition allowed; a 404 response (Hiring Manager denied) surfaces via `ServerError` or an inline toast, no crash. On success, the board must reflect the new status without a manual reload.

**Contract**: Reuses `recruitmentStatusSchema` values as the option list. `useApiResource` gains an exposed `refetch(): Promise<void>` that re-runs its fetch and updates state; the status control calls it after a successful mutation so the displayed badge updates in place.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Component tests pass for `CreateRecruitmentForm` (client-side validation, error rendering): `npm run test`

#### Manual Verification:

- As seeded HR user: navigate to `/recruitments/new`, submit a valid form, confirm redirect and the new recruitment appears in the list/board
- Submit with a missing required field, confirm inline field error renders
- Submit with zero groups selected, confirm inline error (client-side) blocks submission before hitting the API
- As seeded Hiring Manager user: navigate to `/recruitments/new` (affordance visible), submit, confirm a clear denial message renders (no crash)
- Change a recruitment's status from the board view as HR, confirm it persists; attempt as Hiring Manager, confirm denial

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Tests

### Overview

Round out automated coverage: RPC-level SQL verification, API integration tests across all 3 seeded roles, form component tests, and an E2E happy path.

### Changes Required:

#### 1. RLS/RPC verification

**File**: `supabase/tests/rls_verification.sql`

**Intent**: Extend with the create-RPC scenarios already specified in Phase 1's success criteria (this phase is where they're written, Phase 1 is where they must pass before merge — listed there for gating, implemented here as the actual SQL).

**Contract**: Follow the file's existing `begin...rollback` + `raise exception` assertion style.

#### 2. API integration tests

**File**: `src/pages/api/recruitments/index.test.ts`, `src/pages/api/recruitments/[id].test.ts` (new, or colocated per existing convention if different)

**Intent**: Cover POST/PATCH against the local Supabase stack for all 3 seeded role fixtures, plus the empty-group-array and missing-field 422 cases.

**Contract**: Follow whatever integration-test harness pattern F-01/S-01 established for hitting local Supabase from Vitest (reuse, don't invent a new harness).

#### 3. Form component tests

**File**: `src/components/recruitments/CreateRecruitmentForm.test.tsx`

**Intent**: Cover client-side required-field validation, error clearing on change, and server-error rendering on a mocked 422/403.

#### 4. E2E happy path

**File**: `tests/e2e/recruitments.spec.ts` (extend existing)

**Intent**: HR user creates a recruitment end-to-end via the real form, confirms it appears in their list, changes its status.

**Contract**: Reuse `signInAs(page, "hr")` from `tests/e2e/support/auth.ts`.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes (all unit + component + integration tests)
- `npm run test:e2e` passes
- `supabase/tests/rls_verification.sql` passes
- `npm run lint` and `npm run build` pass

#### Manual Verification:

- Full manual pass through the create → status-change flow one more time end-to-end as a sanity check before closing the change

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `createRecruitment` / `updateRecruitmentStatus` service functions (mocked Supabase client, `FakeQueryBuilder` pattern)
- Zod schemas: `employmentTypeSchema`, create-command schema — valid/invalid cases
- `useMutation` hook: success, 422 with `fields`, 401 redirect, generic error

### Integration Tests:

- RPC: atomic create + immediate visibility (HR), rejection (Hiring Manager, Admin), empty-group rejection
- POST /api/recruitments and PATCH /api/recruitments/[id] against local Supabase, all 3 seeded roles

### Manual Testing Steps:

1. As HR: create a recruitment with all fields + 2 groups, confirm immediate visibility and correct data
2. As HR: attempt create with 0 groups, confirm blocked client-side
3. As Hiring Manager: attempt create, confirm 403 renders cleanly
4. As HR: change status Draft → Live → Closed → Draft (reopen), confirm all transitions succeed
5. As Hiring Manager: attempt a status change, confirm 404 renders cleanly

## Performance Considerations

None specific to this slice beyond the already-noted future index on `(status, opened_at desc)` if list volume grows (S-01's note, not actioned here).

## Migration Notes

Single new migration (Phase 1). No existing data to migrate — this is additive.

## References

- Related research: `context/changes/recruiter-creates-recruitment/research.md`
- F-01 plan (schema/RLS contract): `context/changes/core-recruitment-data-foundation/plan.md`
- S-01 plan (JSON error contract, 404-for-forbidden rule, db:types CI enforcement): `context/changes/recruiter-views-kanban-board/plan.md`
- Endpoint template: `src/pages/api/recruitments/index.ts`
- Service layer template: `src/lib/services/recruitments.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Atomic create RPC (migration)

#### Automated

- [x] 1.1 Migration applies cleanly — e696c83
- [x] 1.2 db:types regenerated and committed — e696c83
- [x] 1.3 rls_verification.sql RPC scenarios pass — e696c83

#### Manual

- [x] 1.4 Migration SQL hardening reviewed against mark_rls_helpers_stable.sql pattern — 321d70b

### Phase 2: API endpoints

#### Automated

- [x] 2.1 Type checking passes — fb3d62b
- [x] 2.2 Linting passes — fb3d62b
- [x] 2.3 Unit tests pass for service functions — fb3d62b
- [x] 2.4 Integration tests pass for both endpoints, all 3 role fixtures — fb3d62b
- [x] 2.8 HTTP integration-test harness built and documented — fb3d62b

#### Manual

- [x] 2.5 curl POST as HR returns 201 and recruitment is visible — 0c6fdb9
- [x] 2.6 curl POST as Hiring Manager returns 403 — 0c6fdb9
- [x] 2.7 curl PATCH status as HR returns 200, as Hiring Manager returns 404 — 0c6fdb9

### Phase 3: Frontend — create form and status control

#### Automated

- [x] 3.1 Type checking passes — 065811e
- [x] 3.2 Linting passes — 065811e
- [x] 3.3 Build succeeds — 065811e
- [x] 3.4 Component tests pass for CreateRecruitmentForm — 065811e

#### Manual

- [x] 3.5 HR creates recruitment via form, redirect and visibility confirmed — 065811e
- [x] 3.6 Missing required field shows inline error — 065811e
- [x] 3.7 Zero groups selected blocked client-side — 065811e
- [x] 3.8 Hiring Manager sees affordance, gets clean denial on submit — 065811e
- [x] 3.9 Status change works for HR, denied cleanly for Hiring Manager — 065811e

### Phase 4: Tests

#### Automated

- [x] 4.1 npm run test passes (unit + component + integration)
- [x] 4.2 npm run test:e2e passes
- [x] 4.3 rls_verification.sql passes
- [x] 4.4 lint and build pass

#### Manual

- [x] 4.5 Full manual pass through create → status-change flow
