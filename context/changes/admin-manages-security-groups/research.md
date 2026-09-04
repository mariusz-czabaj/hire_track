---
date: 2026-09-04T08:39:58+02:00
researcher: Mariusz Czabaj
git_commit: 2f74cf57c49604c972f123788096ff27fd169eea
branch: main
repository: mariusz-czabaj/hire_track
topic: "S-07 — Administrator manages security groups, operations and user membership"
tags: [research, codebase, rbac, security-groups, admin, rls, s-07]
status: complete
last_updated: 2026-09-04
last_updated_by: Mariusz Czabaj
---

# Research: S-07 — Administrator manages security groups and users

**Date**: 2026-09-04T08:39:58+02:00
**Researcher**: Mariusz Czabaj
**Git Commit**: 2f74cf57c49604c972f123788096ff27fd169eea
**Branch**: main
**Repository**: mariusz-czabaj/hire_track

## Research Question

What must be built for roadmap slice S-07 (`admin-manages-security-groups`,
FR-017/FR-018): an administrator creates security groups, assigns operations to
them, and adds/removes users from groups. What already exists, what is missing,
and which patterns must the implementation follow?

## Summary

The **entire data and security layer for S-07 already shipped in F-01** and is
unused by any application code. Every table, every RLS policy, and the
`group.manage` gate exist and are correct. What is missing is the whole
application surface: no admin API routes, no admin pages, no service module
beyond a two-line group-name lister, and — the one genuine design gap — **no way
to enumerate users**, which FR-018 requires.

Three findings drive the plan:

1. **RLS is done and admin-only where it must be.** `security_groups` write,
   `group_operations` (all verbs), and `group_memberships` write are already
   gated on `private.has_operation('group.manage')`. A plain PostgREST table
   client with the caller's session is therefore sufficient for most of S-07 —
   unlike S-02…S-05, this slice does **not** need `SECURITY DEFINER` RPCs for
   authorization, only where it must reach outside `public` (see #2).

2. **User enumeration is the blocking gap.** FR-018 ("add/remove users from
   groups") needs a user picker, but `auth.users` is not in PostgREST's exposed
   schemas, and the general-purpose `get_user_emails(uuid[])` RPC was
   **deliberately dropped** in S-04's impl-review as an email-enumeration hole
   and replaced by a candidate-scoped variant. S-07 must add a new
   `group.manage`-gated `SECURITY DEFINER` lookup — this is the one place where
   the enumeration that S-04 removed is legitimate, and it must be gated at the
   first statement of the function, not only at the route.

3. **The caller's own operations are not observable by the frontend.** There is
   no endpoint or `Astro.locals` field exposing "does this user hold
   `group.manage`". The house rule to date is *no UI-level permission logic*
   (403/404 from the server is the only gate), which is defensible for
   recruitment routes but produces a dead-end for an admin nav entry. This is
   the main open product question below.

## Detailed Findings

### RBAC schema — complete, unused by app code

`supabase/migrations/20260831181826_security_rbac_schema.sql`:

- `operation` is a **fixed Postgres enum of exactly five values** —
  `recruitment.read`, `recruitment.write`, `candidate.read`, `candidate.write`,
  `group.manage` (lines 10–16). It is app-defined and **not admin-extensible**;
  FR-017's "assign operations to groups" means picking from this closed
  catalog, never creating new operations. Adding one is a migration, not an
  admin action.
- `security_groups (id, name unique, created_at)` — **no description column**,
  no soft-delete, no updated_at.
- `group_memberships (group_id, user_id → auth.users on delete cascade, unique(group_id,user_id))`
  with an explicit `group_memberships_user_id_idx`.
- `group_operations (group_id, operation, unique(group_id, operation))`, plus
  `created_at` added later in `20260831195552_add_group_operations_created_at.sql`.

Cascade behaviour that matters for a "delete group" affordance:
`group_memberships.group_id` and `group_operations.group_id` are `on delete
cascade`, but `recruitment_security_groups.group_id` is **`on delete restrict`**
(`20260831182957_recruitment_candidate_schema.sql:28`). A group still assigned
to any recruitment therefore cannot be deleted — Postgres raises `23503`, which
the endpoint must map to a 422 with a human message rather than a 500.

### RLS policies — already the exact gates S-07 needs

`supabase/migrations/20260831183457_rls_policies.sql`:

| Table | SELECT | INSERT / UPDATE / DELETE |
| --- | --- | --- |
| `security_groups` | `using (true)` — every authenticated user (needed by FR-001a's group picker) | `group.manage` |
| `group_memberships` | own rows **or** `group.manage` | `group.manage` |
| `group_operations` | `group.manage` | `group.manage` |

Grants match: `select, insert, update, delete` on all three tables to
`authenticated` (end of file). So S-07's writes work through the ordinary
typed table client under the caller's own session — RLS denies non-admins.

The header comment of that migration explains why permission checks live in
`private.has_operation` / `private.has_recruitment_operation` (`SECURITY DEFINER`,
`set search_path = ''`): a policy joining `group_operations` inline would be
blocked by that table's own admin-only policy. Any new S-07 function must reuse
`private.has_operation('group.manage')` rather than re-implementing the join.

**Consequence for error mapping**: an RLS denial on a plain table write surfaces
as Postgres `42501`, not as a silent zero-row result (that only happens for
SELECT). `handleCandidateProfileError` in `src/lib/api/candidate-errors.ts` is
the precedent for the plain-table (non-RPC) case and maps `42501 → 403`.

### The user-enumeration gap (FR-018)

`supabase/migrations/20260901220000_get_user_emails_rpc.sql` added
`public.get_user_emails(uuid[])`, and
`20260901230000_scope_get_user_emails_rpc.sql` **dropped it** with an explicit
rationale: "any authenticated user could enumerate any other user's email via
PostgREST." Its replacement,
`get_user_emails_for_candidate(bigint, uuid[])`, resolves ids only from
`candidate_stage_notes` rows the caller already has `recruitment.read` on.

S-07 needs the opposite shape — list *candidate* users to add to a group — so it
must introduce a new function, e.g.
`public.list_users_for_group_management()` / `search_users(...)`, whose **first
statement** is `if not (select private.has_operation('group.manage')) then raise
… errcode '42501'`, mirroring the guard order in
`20260901162000_kanban_stage_rpcs.sql:31-38`. Returning `id` + `email` only, with
a search filter and a bounded result set, keeps it from becoming the same
enumeration hole in a new coat.

Note the asymmetry that already exists: reading a group's **members** needs no
new RPC for the ids (`group_memberships` SELECT is admin-visible), but turning
those `user_id`s into emails does.

### Application layer — what exists to copy, what is absent

Existing and directly reusable:

- `src/lib/services/security-groups.ts` — `listSecurityGroups(client)` returns
  `id, name` ordered by name. The only group-touching code in the app; S-07
  extends this module.
- `src/pages/api/security-groups.ts` — the single existing route, GET only,
  the thinnest example of the house route shape (`prerender = false`,
  `createClient(headers, cookies)`, `supabase_unconfigured` 500 guard,
  `jsonOk`/`jsonError`).
- `src/lib/api-response.ts` — `jsonOk` / `jsonError(status, code, message, fields?)`.
- `src/middleware.ts` — `PROTECTED_ROUTES = ["/dashboard","/recruitments","/candidates"]`;
  every `/api/*` route except `/api/auth/*` already returns 401 when
  unauthenticated. **`/admin` must be added to `PROTECTED_ROUTES`.**
- `src/components/hooks/useApiResource.ts` (GET, with `refetch`) and
  `useMutation.ts` (POST/PATCH/PUT/DELETE, exposes `error` + `fieldErrors`) —
  both already handle 401 → redirect to `/auth/signin` and parse the
  `ApiErrorBody` contract.

Absent entirely: any `/api/admin/**` or `/api/security-groups/[id]/**` route,
any `src/pages/admin/**` page, any admin React component, `group.manage` DTOs in
`src/types.ts`, and a nav entry (`src/components/Topbar.astro` links only
Dashboard + Sign out).

### Route and error-mapping conventions to follow

`src/pages/api/recruitments/[id]/stages.ts` is the closest structural template
(collection + verbs + shared error mapper):

- zod `z.coerce.number().int().positive()` for path ids; 422 `invalid_request`.
- JSON body parse wrapped in try/catch → 422 `invalid_request`.
- zod issue list flattened into `fields` keyed by `issue.path.join(".")`.
- A single `handleXxxError(error)` per family, with an **explicit branch per
  errcode the layer can raise**. `src/lib/api/candidate-errors.ts` records why:
  "unmapped codes have fallen through to 500s three times in prior slices."

For S-07 the codes to map are `42501 → 403`, `23505 → 422` (duplicate group
name, duplicate membership, duplicate operation grant — all backed by unique
constraints), `23503 → 422` (group still assigned to a recruitment, or a
`user_id` that is not a real user), and `22023 → 422`.

### Testing conventions

`src/lib/test-support/integration-client.ts` already seeds an
`admin.test@example.com` principal (`SeededRole = "admin"`) whose group holds
**`group.manage` only** — deliberately the strongest negative fixture for every
other slice, and now the *positive* fixture for S-07. `hr`, `hiringManager`,
`noGroup`, `tenantPeer`, `multiGroup` are all available as negatives.
`getAccessTokenForRole` + `supabaseRestUrl` allow asserting directly against
PostgREST for paths the app never exposes.

`context/foundation/test-plan.md` §3 lists four rollout phases; **none of them
covers S-07** (Phase 1 authorization/tenancy is `complete`, Phases 2–4 cover
notes, CV and gate hardening). S-07's own tests are therefore this slice's
responsibility, not a test-plan phase.

## Code References

- `supabase/migrations/20260831181826_security_rbac_schema.sql:10-41` — `operation` enum + three tables
- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:25-31` — `on delete restrict` on the group FK
- `supabase/migrations/20260831183457_rls_policies.sql:22-49` — `private.has_operation` / `has_recruitment_operation`
- `supabase/migrations/20260831183457_rls_policies.sql:66-127` — the three security tables' policies
- `supabase/migrations/20260901230000_scope_get_user_emails_rpc.sql:1-9` — why unscoped user enumeration was removed
- `supabase/migrations/20260901162000_kanban_stage_rpcs.sql:29-45` — guard order inside a hardened RPC
- `src/lib/services/security-groups.ts:8-16` — the only existing group query
- `src/pages/api/security-groups.ts:9-24` — minimal route shape
- `src/pages/api/recruitments/[id]/stages.ts:24-41` — `handleStageRpcError` template
- `src/lib/api/candidate-errors.ts:38-53` — `handleCandidateProfileError`, the plain-table (non-RPC) mapper
- `src/middleware.ts:5` — `PROTECTED_ROUTES`
- `src/lib/test-support/integration-client.ts:24-32` — seeded principals incl. `admin`
- `supabase/seed.sql:28-39,175-181` — operation grants and memberships per seeded group

## Architecture Insights

- **Authorization lives in the database, never in the UI.** Every slice so far
  gates on RLS/RPC and returns 403/404; the frontend renders affordances
  unconditionally. S-07 is the first slice where that rule has a visible cost
  (an admin nav entry every user can click into a 403).
- **404-over-403 for resource visibility, 403 for operation denial.** Prior
  slices return 404 when RLS hides a row (indistinguishable from missing, by
  design — `recruiter-views-kanban-board/plan.md:74`), and 403 when the row is
  visible but the operation is not held. `security_groups` is world-readable to
  authenticated users, so S-07 is squarely in **403** territory: an admin write
  denial is not a visibility question.
- **The operations catalog is closed.** FR-017's "assign operations" is a
  checkbox set over five fixed enum values, so the UI can hardcode the list from
  a zod enum in `src/types.ts` — the same single-source-of-truth pattern already
  used for `recruitmentStatusSchema` and `employmentTypeSchema`
  (`src/types.ts:8,16`), which carry an explicit "any migration touching this
  must update the enum in the same commit" discipline note.
- **`SECURITY DEFINER` only where RLS cannot reach.** S-02…S-05 used RPCs for
  atomicity and cross-table guards. S-07 needs one only for `auth.users`.

## Historical Context (from prior changes)

- `context/changes/core-recruitment-data-foundation/plan.md:20` — the PRD's
  example groups (HR/Rekruter, Hiring Manager, Administrator) are
  "konfiguracja — nie część schematu" and live in seed data precisely because
  "S-07 lets real admins create arbitrary groups later."
- `context/changes/core-recruitment-data-foundation/plan-brief.md:24` — full
  operation-gated RLS was shipped in F-01 specifically to avoid a security gap
  "during the gap before S-07 ships an admin UI." That gap is what this slice closes.
- `context/changes/recruiter-creates-recruitment/research.md:173` — an already
  open, user-owned question: should create affordances be hidden from users who
  cannot create? Flagged as "directly in tension with the inherited no-UI-level-
  permission-logic rule." S-07 forces an answer.
- `context/changes/recruiter-views-kanban-board/change.md:18` and
  `roadmap.md` S-01 Unknowns — the Hiring-Manager vs Recruiter scope question was
  explicitly deferred to "when S-07 delivers the full operation→group model."
- `context/changes/candidate-profile-and-cv-upload/research.md:355` — records
  `PA002` as "unmapped in the stages endpoint (dead until S-07)", i.e. a known
  loose end this slice may activate.

## Related Research

- `context/changes/core-recruitment-data-foundation/plan.md` — the schema and RLS this slice drives
- `context/changes/recruiter-creates-recruitment/research.md` — prior analysis of the operation enum and seeded principals
- `context/changes/testing-authorization-tenancy-contract/` — the authorization integration-test harness S-07's tests extend

## Open Questions

1. **Does S-07 gate the admin UI client-side, or keep the no-UI-permission-logic
   rule?** Without a "current user's operations" signal, either every user sees
   an Admin nav entry that 403s, or the rule is broken for the first time. A
   narrow escape hatch: expose the caller's own operations (which
   `private.has_operation` already computes) via `Astro.locals` in
   `src/middleware.ts` or a `GET /api/me/operations` route, and treat it as
   *rendering* data rather than authorization. **Owner: user.** This is the one
   decision that changes the shape of the slice.

2. **Self-lockout: may an admin remove the last `group.manage` grant, or remove
   themselves from the Administrator group?** Nothing in schema or PRD prevents
   it, and it is unrecoverable through the UI (recovery would need direct SQL).
   A guard ("at least one user must retain `group.manage`") is cheap inside a
   `SECURITY DEFINER` function but impossible in an RLS policy alone.
   **Owner: user/team.**

3. **Does the slice include deleting/renaming groups, or only create + assign?**
   FR-017 says "create … and assign operations"; RLS grants UPDATE and DELETE
   regardless. Delete interacts with the `on delete restrict` FK above.
   **Owner: user.**

4. **How are users discovered for FR-018 — a full list or a search box?** The
   PRD gives no user count. A search-with-minimum-query shape limits the
   enumeration surface reopened by the new RPC; a full list is simpler.
   **Owner: team (plan-level).**

5. **Do the seeded Polish group names get renamed?** `HR/Rekruter` violates the
   English-only rule in `context/foundation/lessons.md`, and S-07 is the slice
   that makes group names editable. Renaming seeded data is in scope only if the
   user wants it. **Owner: user.**
