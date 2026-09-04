# S-07: Administrator Manages Security Groups and Users — Implementation Plan

## Overview

Build the entire application surface for RBAC administration on top of the data
and security layer that already shipped in F-01. An administrator can create and
rename security groups, grant and revoke operations from the fixed five-value
catalog, and add or remove users from groups. The slice also closes two loose
ends F-01 left open: user enumeration (deliberately removed in S-04 and needed
again here in a narrowly gated form) and the absence of any signal telling the
frontend whether the caller holds `group.manage`.

## Current State Analysis

The three RBAC tables (`security_groups`, `group_memberships`, `group_operations`),
their RLS policies, and the `private.has_operation('group.manage')` gate all exist
and are correct (`supabase/migrations/20260831181826_security_rbac_schema.sql`,
`20260831183457_rls_policies.sql:66-127`). Writes to all three are already gated on
`group.manage`, so the ordinary typed table client under the caller's session is
sufficient — RLS denies non-admins with Postgres `42501`.

What does not exist: any `/api/admin/**` route, any `src/pages/admin/**` page, any
admin React component, `group.manage`-related DTOs in `src/types.ts`, a nav entry,
and any way to enumerate users. `src/lib/services/security-groups.ts` contains a
single 9-line `listSecurityGroups` function — the only group-touching application
code in the repository.

Two constraints shape the work. First, `auth.users` is not in PostgREST's exposed
schemas, and the general-purpose `get_user_emails(uuid[])` RPC was dropped in S-04
as an email-enumeration hole (`20260901230000_scope_get_user_emails_rpc.sql:1-9`);
FR-018's user picker therefore needs a new, narrowly gated lookup. Second, the
"at least one user must retain `group.manage`" invariant cannot be expressed in an
RLS policy — it needs a function.

## Desired End State

An administrator signs in, sees an **Admin** entry in the top bar, and manages
groups end to end: creates a group, renames it, toggles any of the five operations
on or off, searches for a user by email and adds them to the group, and removes
members. A non-administrator sees no Admin entry, and every admin API route
returns 403 to them regardless of what the UI renders. Removing the final
`group.manage` grant — by revoking the operation or removing the last member of
the only group holding it — is refused with a clear 422 rather than silently
bricking the installation.

Verification: `npm run test`, `npm run test:integration`, `npm run test:rls`,
`npm run typecheck`, and `npm run lint` all pass; manual walkthrough as
`admin.test@example.com` and as `hr.test@example.com` confirms the gate.

### Key Discoveries:

- RLS on all three tables is already exactly the gate S-07 needs
  (`supabase/migrations/20260831183457_rls_policies.sql:66-127`) — no
  `SECURITY DEFINER` is required for authorization, only where the query must
  reach outside `public`.
- The `operation` enum is a closed five-value catalog
  (`20260831181826_security_rbac_schema.sql:10-16`) — "assign operations" is a
  checkbox set over fixed values, never a create action.
- `recruitment_security_groups.group_id` is `on delete restrict`
  (`20260831182957_recruitment_candidate_schema.sql:25-31`); delete is out of
  scope this slice, which sidesteps the `23503` path entirely.
- The guard-order pattern for a hardened RPC is
  `20260901162000_kanban_stage_rpcs.sql:29-45` — permission check as the first
  statement, before any validation or work.
- `handleCandidateProfileError` (`src/lib/api/candidate-errors.ts:38-53`) is the
  precedent for plain-table (non-RPC) error mapping: `42501 → 403`, `22023 → 422`.
- `admin.test@example.com` already exists as a seeded principal holding
  `group.manage` only (`src/lib/test-support/integration-client.ts:24-32`) — the
  positive fixture is free, and `hr` / `noGroup` are ready-made negatives.

## What We're NOT Doing

- **Deleting groups.** Out of scope by decision; the `on delete restrict` FK and
  its `23503` mapping stay untouched.
- **Adding or removing operations from the catalog.** The enum is app-defined;
  changing it is a migration, not an admin action.
- **A description, soft-delete, or `updated_at` column on `security_groups`.** No
  schema change to the three RBAC tables at all.
- **Per-group audit logging** of who changed what and when.
- **Inviting or creating users.** The picker only finds users who already exist.
- **Reworking the recruitment-side group picker** (FR-001a) — it keeps using the
  existing `GET /api/security-groups`.
- **Adding S-07 to `context/foundation/test-plan.md` §3.** Research confirms none
  of its four rollout phases covers this slice; its tests belong to the slice.

## Implementation Approach

Work bottom-up, in the order the layers depend on each other: database functions
first, then the caller-operations signal (which the UI phase needs), then the API
routes, then the pages, then tests. The English rename of seeded group names goes
last and alone, because it touches four test files and `rls_verification.sql` and
would otherwise churn under every earlier phase.

Writes stay on plain RLS-covered tables wherever the invariant allows it — group
create, group rename, operation grant, and member add are all ordinary table
operations under the caller's session. Only the two paths that can destroy the
last `group.manage` grant (operation revoke, member remove) move onto
`SECURITY DEFINER` functions, because that invariant is a cross-row check RLS
cannot express. Operation toggles write immediately per checkbox rather than
batching, so each toggle maps to exactly one unique-constrained row and failures
stay isolated.

## Critical Implementation Details

**Guard ordering in the new functions.** Every `SECURITY DEFINER` function added
here must make `private.has_operation('group.manage')` its first statement and
raise `42501` on failure, before any validation, lookup, or write — matching
`20260901162000_kanban_stage_rpcs.sql:29-45`. Gating only at the route leaves the
function callable directly through PostgREST by any authenticated user.

**The lockout check must run after the write, inside the same transaction.**
Checking "would this leave zero holders" before deleting is racy and awkward to
express; performing the delete and then raising if the post-state has no
`group.manage` holder lets the raise roll the statement back. The check counts
distinct users reachable through `group_memberships → group_operations` where the
operation is `group.manage`.

**Email search must not become the hole S-04 closed.** The search function
requires a minimum-length query, matches on email only, and caps its result set.
A null, empty, or too-short term returns zero rows rather than everything.

## Phase 1: Database — gated user search and lockout-guarded writes

### Overview

Add the three `SECURITY DEFINER` functions this slice needs: a bounded user
search for the member picker, and the two write paths that must enforce the
"never lose the last administrator" invariant.

### Changes Required:

#### 1. User search function

**File**: `supabase/migrations/<timestamp>_admin_group_management_rpcs.sql`

**Intent**: Give the member picker a way to resolve users by email without
reopening the unscoped enumeration that S-04 removed. Gated on `group.manage`,
bounded in result size, and inert on short queries.

**Contract**: `public.search_users_for_group_management(search_term text)` returns
a set of `(id uuid, email text)`, `security definer`, `set search_path = ''`.
First statement raises `42501` unless `private.has_operation('group.manage')`.
Returns zero rows when `search_term` is null or trims to fewer than 2 characters;
otherwise case-insensitively matches `auth.users.email`, orders by email, and
limits to 20 rows. `execute` granted to `authenticated`.

#### 2. Lockout-guarded membership removal

**File**: same migration

**Intent**: Removing a member must not be able to strip the last `group.manage`
holder from the system.

**Contract**: `public.remove_group_member(target_group_id bigint, target_user_id uuid)`,
`security definer`, `set search_path = ''`. Guard raises `42501`; deletes the
`group_memberships` row; then raises `PA006` (`last_admin_required`) if no user
remains who holds `group.manage` through any group, which rolls back the delete.
Deleting a non-existent membership is a no-op, not an error.

#### 3. Lockout-guarded operation revoke

**File**: same migration

**Intent**: Same invariant, reached from the other direction — revoking
`group.manage` from the only group that holds it.

**Contract**: `public.revoke_group_operation(target_group_id bigint, target_operation public.operation)`,
same guard, same `PA006` post-check and rollback semantics.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Regenerated types compile: `npm run db:types && npm run typecheck`
- Existing RLS verification still passes: `npm run test:rls`
- Linting passes: `npm run lint`

#### Manual Verification:

- Calling `search_users_for_group_management` through PostgREST as a non-admin
  returns a `42501` error, not rows
- A short or empty search term returns no rows rather than the full user list
- Revoking `group.manage` from the Administrator group is refused with `PA006`

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 2: Caller-operations signal

### Overview

Give the frontend a read-only view of the caller's own operations so navigation
and admin pages can render correctly, while leaving the database as the only
actual authorization gate.

### Changes Required:

#### 1. Operation catalog as a zod enum

**File**: `src/types.ts`

**Intent**: Establish a single source of truth for the five operation values,
mirroring the discipline already applied to `recruitmentStatusSchema` and
`employmentTypeSchema`, including their drift note.

**Contract**: `operationSchema = z.enum([...])` covering `recruitment.read`,
`recruitment.write`, `candidate.read`, `candidate.write`, `group.manage`; exported
`Operation` type. Add the DTOs this slice needs: a group detail shape carrying its
operations and member list, a member shape (`userId`, `email`), and a user search
result shape. Carry a comment noting that any migration altering the `operation`
enum must update this in the same commit.

#### 2. Resolve the caller's operations in middleware

**File**: `src/middleware.ts`

**Intent**: Populate `context.locals.operations` for authenticated requests so
Astro pages and the top bar can render from it. This is rendering data, not
authorization — every route keeps its server-side gate.

**Contract**: After `locals.user` is set, resolve the caller's distinct operations
via the group-memberships join and expose them as `Operation[]` (empty array when
unauthenticated). Add `/admin` to `PROTECTED_ROUTES`. Skip the lookup for
unauthenticated requests and for `/api/auth/*`.

#### 3. Locals typing

**File**: `src/env.d.ts`

**Intent**: Type the new field so pages get autocomplete and `astro check` catches
misuse.

**Contract**: Add `operations: import("@/types").Operation[]` to `App.Locals`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm run test`
- Linting passes: `npm run lint`

#### Manual Verification:

- Signed in as `admin.test@example.com`, `Astro.locals.operations` contains
  `group.manage`
- Signed in as `hr.test@example.com`, it contains the four recruitment/candidate
  operations and not `group.manage`
- Signed in as `no-group.test@example.com`, it is empty
- No measurable added latency on ordinary page loads

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 3: Admin API routes and service layer

### Overview

Expose the group management surface over HTTP, following the established route
shape and adding one shared error mapper for the family.

### Changes Required:

#### 1. Error mapper

**File**: `src/lib/api/security-group-errors.ts`

**Intent**: One mapper for every route in this family, with an explicit branch per
errcode the layer can raise — the house convention noted in
`candidate-errors.ts` after unmapped codes fell through to 500s three times.

**Contract**: `handleSecurityGroupError(error): Response` mapping `42501 → 403`,
`23505 → 422` (duplicate group name, duplicate membership, duplicate grant),
`23503 → 422` (unknown user id), `22023 → 422`, `PA006 → 422`
(`last_admin_required`, with a message explaining at least one administrator must
remain), and an unmapped fallback that logs and returns 500.

#### 2. Service module

**File**: `src/lib/services/security-groups.ts`

**Intent**: Extend the existing module with the queries and writes the routes
need, keeping `listSecurityGroups` untouched for the FR-001a picker.

**Contract**: Add `createSecurityGroup`, `renameSecurityGroup`,
`getSecurityGroupDetail` (group plus its operations plus its members, with member
emails resolved through the Phase 1 search-adjacent path or a member-scoped
lookup), `grantGroupOperation`, `revokeGroupOperation` (RPC), `addGroupMember`,
`removeGroupMember` (RPC), and `searchUsers` (RPC). All take the caller's client;
all let Postgres errors propagate for the mapper to translate.

#### 3. Group collection route

**File**: `src/pages/api/security-groups.ts`

**Intent**: Add group creation alongside the existing GET, which stays as is.

**Contract**: `POST` with a zod-validated `{ name }` body — trimmed, non-empty,
length-capped. Returns 201 with the created group. Body parse failure and zod
issues become 422 `invalid_request` with a `fields` map keyed by
`issue.path.join(".")`.

#### 4. Group detail and rename route

**File**: `src/pages/api/security-groups/[id].ts`

**Intent**: Serve the detail page and accept renames.

**Contract**: `GET` returns the group detail DTO; `PATCH` accepts `{ name }` and
returns the updated group. Path id validated with
`z.coerce.number().int().positive()` → 422 on failure. A group the caller cannot
see yields 404; a write the caller cannot perform yields 403.

#### 5. Operations route

**File**: `src/pages/api/security-groups/[id]/operations.ts`

**Intent**: Back the per-checkbox immediate write.

**Contract**: `POST` `{ operation }` validated against `operationSchema` grants it;
`DELETE` `{ operation }` revokes it through the guarded RPC. Both return the
group's resulting operation list so the UI can reconcile without a refetch.

#### 6. Members route

**File**: `src/pages/api/security-groups/[id]/members.ts`

**Intent**: FR-018's add and remove.

**Contract**: `POST` `{ userId }` (uuid) adds a membership; `DELETE` `{ userId }`
removes it through the guarded RPC. Both return the group's resulting member list.

#### 7. User search route

**File**: `src/pages/api/admin/users.ts`

**Intent**: Back the member picker.

**Contract**: `GET` with a `q` query parameter; returns `{ id, email }[]` from the
Phase 1 RPC. A missing or too-short `q` returns an empty array with 200, matching
the function's own behaviour rather than erroring.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm run test`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- As `admin.test@example.com`, each route performs its operation successfully
- As `hr.test@example.com`, every write route returns 403 with the shared error
  body shape
- Creating a group with a name that already exists returns 422, not 500
- Revoking the last `group.manage` grant returns 422 with the
  `last_admin_required` message

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 4: Admin UI

### Overview

A list page for browsing and creating groups and a detail page for renaming,
toggling operations, and managing membership — following the list/detail shape
already used by recruitments.

### Changes Required:

#### 1. Group list page

**File**: `src/pages/admin/groups/index.astro`

**Intent**: Entry point to administration, mirroring
`src/pages/recruitments/index.astro` in layout and styling.

**Contract**: Renders a `Layout` with a heading and a client-loaded React island.
Reads `Astro.locals.operations` and renders a not-authorized state instead of the
island when `group.manage` is absent.

#### 2. Group list island

**File**: `src/components/admin/SecurityGroupList.tsx`

**Intent**: List groups and create new ones.

**Contract**: Uses `useApiResource` for `GET /api/security-groups` and
`useMutation` for the create POST, surfacing `fieldErrors` on the name input and
refetching on success. Each row links to the detail page.

#### 3. Group detail page

**File**: `src/pages/admin/groups/[id].astro`

**Intent**: Host the per-group management island.

**Contract**: Passes the validated route id to the island; same
`group.manage`-absent fallback as the list page.

#### 4. Group detail island

**File**: `src/components/admin/SecurityGroupDetail.tsx`

**Intent**: Rename, operation checkboxes, and member management in one view.

**Contract**: Fetches the detail DTO; a rename form; a checkbox per value of
`operationSchema.options` writing immediately on toggle and reconciling from the
response, with the toggle disabled while in flight and reverted on error; a member
list with a remove control per row.

#### 5. Member picker

**File**: `src/components/admin/UserSearchPicker.tsx`

**Intent**: Find a user by email and add them.

**Contract**: Debounced query against `GET /api/admin/users`, with distinct
below-minimum, loading, empty-result, and error states. Selecting a result issues
the member POST. Users already in the group are either excluded or shown as
already-added rather than offered again.

#### 6. Navigation entry

**File**: `src/components/Topbar.astro`

**Intent**: Make administration discoverable to the users who can use it.

**Contract**: Render an `Admin` link to `/admin/groups` only when
`Astro.locals.operations` includes `group.manage`, styled as the existing
Dashboard link.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm run test`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- As an administrator: create a group, rename it, toggle each operation on and
  off, search for and add a user, then remove them — all reflected without a
  manual page refresh
- As `hr.test@example.com`: no Admin link appears, and navigating directly to
  `/admin/groups` shows the not-authorized state
- Signed out, `/admin/groups` redirects to `/auth/signin`
- Attempting to remove the last administrator shows the 422 message inline rather
  than a generic failure
- Layout holds at narrow widths

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 5: Integration tests on the security boundary

### Overview

Prove the parts a mock would lie about: RLS denial on every write path, the gate
inside the search RPC, the unique constraints, and the lockout invariant.

### Changes Required:

#### 1. Security group integration tests

**File**: `src/pages/api/security-groups/security-groups.integration.test.ts`

**Intent**: Cover the admin surface against a real database using the seeded
principals, following the structure of `authorization.integration.test.ts`.

**Contract**: As `admin` — create, rename, grant, revoke, add member, remove
member all succeed and are observable on re-read. As `hr` and `noGroup` — every
write returns 403 and the state is unchanged afterwards. Duplicate group name and
duplicate membership return 422. The lockout guard returns 422 both by revoking
`group.manage` from the only group holding it and by removing its last member,
and the state is unchanged in both cases. Tests create and clean up their own
groups rather than mutating seeded ones, except where the lockout case
deliberately targets the Administrator group and asserts the refusal.

#### 2. User search tests

**File**: same file

**Intent**: Pin the enumeration boundary that S-04 established.

**Contract**: As `admin`, a valid term returns matching users; a below-minimum,
empty, and missing term each return an empty array. As `hr`, the route returns
403. Direct PostgREST invocation of the function as a non-admin — using
`getAccessTokenForRole` and `supabaseRestUrl` — is rejected, proving the guard
lives in the function and not only in the route.

### Success Criteria:

#### Automated Verification:

- Integration tests pass: `npm run test:integration`
- Unit tests still pass: `npm run test`
- Linting passes: `npm run lint`

#### Manual Verification:

- The suite passes from a clean `npx supabase db reset` and leaves no residual
  test groups behind
- Temporarily removing the guard from the search function makes the direct
  PostgREST test fail, confirming it tests what it claims to

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 6: Rename seeded group names to English

### Overview

Clear the known English-only violation in seed data, in a single isolated commit,
now that renaming is a product capability.

### Changes Required:

#### 1. Seed data

**File**: `supabase/seed.sql`

**Intent**: Replace the Polish group name with an English one everywhere it
appears, including the comments that reference it.

**Contract**: `HR/Rekruter` → `HR Recruiter` at the insert (line 19), the four
`group_operations` rows, the `group_memberships` row, the
`recruitment_security_groups` link, and the three explanatory comments. Group id
ordering must not change, since comments elsewhere document `HR/Rekruter=1`.

#### 2. RLS verification script

**File**: `supabase/tests/rls_verification.sql`

**Intent**: Keep the SQL verification suite resolving the same group.

**Contract**: Update the three name lookups and the one narrative comment.

#### 3. Test fixtures

**Files**: `src/pages/api/authorization.integration.test.ts`,
`src/pages/api/recruitments/index.integration.test.ts`,
`src/pages/api/recruitments/[id]/stages.integration.test.ts`,
`src/components/recruitments/CreateRecruitmentForm.test.tsx`

**Intent**: Update every literal and expectation referencing the old name.

**Contract**: Replace the name in the `securityGroupIdByName` / `groupIdByName`
call sites, the sorted group-name expectation in `authorization.integration.test.ts`,
the mock fixture and three assertions in `CreateRecruitmentForm.test.tsx`, and the
comments naming it.

### Success Criteria:

#### Automated Verification:

- Database reseeds cleanly: `npx supabase db reset`
- RLS verification passes: `npm run test:rls`
- Unit tests pass: `npm run test`
- Integration tests pass: `npm run test:integration`
- Linting passes: `npm run lint`
- No occurrences remain: `grep -r "Rekruter" supabase src` returns nothing

#### Manual Verification:

- The recruitment creation form's group picker shows the English name
- An existing local database that has not been reset still functions, with the
  old name displayed until reseeded

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `handleSecurityGroupError` maps each errcode to its status, and the unmapped
  fallback logs and returns 500
- Zod validation of group name and operation value rejects empty, whitespace-only,
  over-length, and out-of-catalog input
- `SecurityGroupDetail` reverts a checkbox when its write fails
- `UserSearchPicker` renders its below-minimum, loading, empty, and error states

### Integration Tests:

- Full admin lifecycle against a real database, per Phase 5
- Every write path denied for `hr` and `noGroup`, with state verified unchanged
- Lockout guard refuses both routes to the last-administrator state
- Search RPC gate holds when called directly through PostgREST

### Manual Testing Steps:

1. Sign in as `admin.test@example.com`; confirm the Admin link appears
2. Create a group, then create another with the same name — expect an inline 422
3. Open the group, toggle each of the five operations on and off
4. Search for `hr` in the member picker, add the result, confirm it appears, remove it
5. Open the Administrator group and try to revoke `group.manage` — expect the
   last-administrator refusal
6. Sign in as `hr.test@example.com`; confirm no Admin link and that
   `/admin/groups` shows the not-authorized state
7. Sign out and hit `/admin/groups` directly — expect a redirect to sign-in

## Performance Considerations

The middleware operations lookup adds one query per authenticated request. It is
a small indexed join (`group_memberships_user_id_idx` exists) returning at most
five rows, and it is skipped entirely for unauthenticated requests. If it shows up
in practice, caching it on the session is the follow-up — not done here, since
staleness after a permission change would be a correctness regression.

The user search caps results at 20 and requires a minimum query length, so it
cannot degrade with user count.

## Migration Notes

One forward migration adding three functions; no schema changes to existing
tables, so there is nothing to backfill and rollback is a `drop function`. The
Phase 6 seed rename affects local and CI databases only on reseed — no production
data is involved, since these groups are seed fixtures rather than user data.

## References

- Research: `context/changes/admin-manages-security-groups/research.md`
- RBAC schema: `supabase/migrations/20260831181826_security_rbac_schema.sql:10-41`
- RLS policies: `supabase/migrations/20260831183457_rls_policies.sql:66-127`
- RPC guard pattern: `supabase/migrations/20260901162000_kanban_stage_rpcs.sql:29-45`
- Why unscoped user enumeration was removed: `supabase/migrations/20260901230000_scope_get_user_emails_rpc.sql:1-9`
- Plain-table error mapper precedent: `src/lib/api/candidate-errors.ts:38-53`
- Route shape: `src/pages/api/recruitments/[id]/stages.ts:24-41`
- Seeded principals: `src/lib/test-support/integration-client.ts:24-32`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — gated user search and lockout-guarded writes

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 156c875
- [x] 1.2 Regenerated types compile: `npm run db:types && npm run typecheck` — 156c875
- [x] 1.3 Existing RLS verification still passes: `npm run test:rls` — 156c875
- [x] 1.4 Linting passes: `npm run lint` — 156c875

#### Manual

- [x] 1.5 Non-admin PostgREST call to the search function returns 42501 — 156c875
- [x] 1.6 Short or empty search term returns no rows — 156c875
- [x] 1.7 Revoking `group.manage` from the Administrator group is refused with PA006 — 156c875

### Phase 2: Caller-operations signal

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 7a34c73
- [x] 2.2 Unit tests pass: `npm run test` — 7a34c73
- [x] 2.3 Linting passes: `npm run lint` — 7a34c73

#### Manual

- [x] 2.4 `admin.test@example.com` locals contain `group.manage` — 7a34c73
- [x] 2.5 `hr.test@example.com` locals exclude `group.manage` — 7a34c73
- [x] 2.6 `no-group.test@example.com` locals are empty — 7a34c73
- [x] 2.7 No measurable added latency on ordinary page loads — 7a34c73

### Phase 3: Admin API routes and service layer

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — 8b7e8d4
- [x] 3.2 Unit tests pass: `npm run test` — 8b7e8d4
- [x] 3.3 Linting passes: `npm run lint` — 8b7e8d4
- [x] 3.4 Build succeeds: `npm run build` — 8b7e8d4

#### Manual

- [x] 3.5 Every route succeeds as `admin.test@example.com` — 8b7e8d4
- [x] 3.6 Every write route returns 403 as `hr.test@example.com` — 8b7e8d4
- [x] 3.7 Duplicate group name returns 422, not 500 — 8b7e8d4
- [x] 3.8 Revoking the last `group.manage` grant returns 422 with `last_admin_required` — 8b7e8d4

### Phase 4: Admin UI

#### Automated

- [x] 4.1 Type checking passes: `npm run typecheck`
- [x] 4.2 Unit tests pass: `npm run test`
- [x] 4.3 Linting passes: `npm run lint`
- [x] 4.4 Build succeeds: `npm run build`

#### Manual

- [x] 4.5 Full admin lifecycle works in the UI without a manual refresh
- [x] 4.6 Non-admin sees no Admin link and a not-authorized state at `/admin/groups`
- [x] 4.7 Signed out, `/admin/groups` redirects to `/auth/signin`
- [x] 4.8 Last-administrator refusal renders inline
- [x] 4.9 Layout holds at narrow widths

### Phase 5: Integration tests on the security boundary

#### Automated

- [ ] 5.1 Integration tests pass: `npm run test:integration`
- [ ] 5.2 Unit tests still pass: `npm run test`
- [ ] 5.3 Linting passes: `npm run lint`

#### Manual

- [ ] 5.4 Suite passes from a clean reset and leaves no residual test groups
- [ ] 5.5 Removing the function guard makes the direct PostgREST test fail

### Phase 6: Rename seeded group names to English

#### Automated

- [ ] 6.1 Database reseeds cleanly: `npx supabase db reset`
- [ ] 6.2 RLS verification passes: `npm run test:rls`
- [ ] 6.3 Unit tests pass: `npm run test`
- [ ] 6.4 Integration tests pass: `npm run test:integration`
- [ ] 6.5 Linting passes: `npm run lint`
- [ ] 6.6 `grep -r "Rekruter" supabase src` returns nothing

#### Manual

- [ ] 6.7 Recruitment form group picker shows the English name
- [ ] 6.8 A non-reset local database still functions with the old name
