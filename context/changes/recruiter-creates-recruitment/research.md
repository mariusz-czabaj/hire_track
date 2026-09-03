---
date: 2026-09-01T12:21:27Z
researcher: Mariusz Czabaj
git_commit: eb1c9fd5c3809541598949acd63027434b0c87ff
branch: main
repository: mariusz-czabaj/hire_track
topic: "S-02 — Recruiter creates a recruitment, assigns security groups and manages its status"
tags: [research, codebase, recruitments, security-groups, rls, write-path, forms, astro, supabase, s-02]
status: complete
last_updated: 2026-09-01
last_updated_by: Mariusz Czabaj
---

# Research: S-02 — recruiter creates a recruitment and manages its status

**Date**: 2026-09-01T12:21:27Z
**Researcher**: Mariusz Czabaj
**Git Commit**: `eb1c9fd5c3809541598949acd63027434b0c87ff`
**Branch**: `main` (pushed — permalink base `https://github.com/mariusz-czabaj/hire_track/blob/eb1c9fd/`)
**Repository**: `mariusz-czabaj/hire_track`

## Research Question

What evidence does the codebase provide for planning roadmap slice **S-02 `recruiter-creates-recruitment`** — a recruiter creates a new recruitment with metadata (title, location, department, employment type, opened date), assigns **at least one** security group, and sets/changes its status (Draft / Live / Closed)? PRD refs: FR-001, FR-001a, FR-002.

## Summary

**The database write path already exists — and it contains one hard, empirically-proven deadlock that dictates the entire architecture of this slice.**

Unlike S-01 (greenfield UI on a finished data layer), S-02 needs **no new table and no new policy for the basic write**. F-01 shipped INSERT/UPDATE policies _and_ matching grants for `recruitments` and `recruitment_security_groups`. That is the good news, and it is worth stating plainly because the natural assumption — "the last slice was read-only, so writes must be unimplemented" — is wrong.

Five findings dominate planning:

1. **The create flow deadlocks if written the idiomatic way.** `recruitments_select` is recruitment-scoped through `recruitment_security_groups`, so a freshly inserted recruitment has no group link and is therefore **invisible to its own creator**. `.insert().select()` fails outright, and the fallback (insert without read-back) succeeds but strands an unreachable row whose id you cannot discover — so you can never attach the group that would make it visible. **Verified empirically against the running local stack, not merely read from the policy.** This forces an atomic `security definer` RPC (or equivalent) rather than two client-side statements.
2. **The security-group picker works today with a plain query.** `security_groups` SELECT is `using (true)` for all authenticated users, added by F-01 explicitly to satisfy FR-001a. No admin role, no service key, no new policy.
3. **"At least one group" has no database enforcement**, and the recruitment insert plus the group-link insert are two separate statements — so both the FR-001a minimum _and_ the atomicity are the application's problem.
4. **The app has two competing submit patterns and S-02 must pick the newer one.** Legacy auth endpoints are formData + redirect with no zod; S-01's endpoints are JSON + zod + `jsonOk`/`jsonError`. S-02 follows S-01 — but that means losing `useFormStatus` (native-form-only) and inheriting an error contract that has **no field-level shape**, which a six-field form needs.
5. **A genuine tension in the inherited rules**: S-01 ruled "no UI-level permission logic — RLS does authz", but S-02 introduces the first write affordance and must decide whether to render a "New recruitment" button to a Hiring Manager who will always be denied.

## Detailed Findings

### The write path exists — inventory

| Object                        | INSERT                 | UPDATE                             | DELETE               | Evidence                                                                                                                                                                                                                                     |
| ----------------------------- | ---------------------- | ---------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recruitments`                | ✅ policy + grant      | ✅ policy + grant                  | ❌ none (deliberate) | [rls_policies.sql:137](../../../supabase/migrations/20260831183457_rls_policies.sql:137), [:141](../../../supabase/migrations/20260831183457_rls_policies.sql:141), [:239](../../../supabase/migrations/20260831183457_rls_policies.sql:239) |
| `recruitment_security_groups` | ✅ policy + grant      | ❌ none — reassign = delete+insert | ✅ policy + grant    | [:155](../../../supabase/migrations/20260831183457_rls_policies.sql:155), [:159](../../../supabase/migrations/20260831183457_rls_policies.sql:159), [:240](../../../supabase/migrations/20260831183457_rls_policies.sql:240)                 |
| `security_groups`             | —                      | —                                  | —                    | SELECT `using (true)` at [:69](../../../supabase/migrations/20260831183457_rls_policies.sql:69)                                                                                                                                              |
| `kanban_stages`               | ❌ no policy, no grant | ❌                                 | ❌                   | [:163](../../../supabase/migrations/20260831183457_rls_policies.sql:163) — S-03's job, **not S-02's**                                                                                                                                        |

All PKs are `bigint generated always as identity`, so **no sequence grant is required** and an INSERT must never supply `id` ([rls_policies.sql:232-233](../../../supabase/migrations/20260831183457_rls_policies.sql:232)).

The INSERT policy on `recruitments` deliberately uses the **unscoped** `private.has_operation('recruitment.write')` rather than the per-recruitment helper — you cannot check a row-scoped permission on a row that does not exist yet. The per-recruitment helper guards UPDATE instead.

### The create deadlock — empirically verified

`recruitments_select` requires `has_recruitment_operation(id, 'recruitment.read')`, which joins through `recruitment_security_groups` ([rls_policies.sql:133-135](../../../supabase/migrations/20260831183457_rls_policies.sql:133)). Probes run against the live local stack as `hr.test@example.com`:

| Probe                                                                                 | Result                                                                              |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `POST /recruitments` with `Prefer: return=representation` (i.e. `.insert().select()`) | **403** `42501 new row violates row-level security policy for table "recruitments"` |
| `POST /recruitments` with `Prefer: return=minimal`                                    | **201 Created** — the row really is written                                         |
| `GET /recruitments?title=eq.<the row just created>` as the creator                    | **`[]`** — invisible                                                                |
| `GET /recruitments` (creator's whole visible list)                                    | only the seeded `Backend Engineer`                                                  |
| Same row, via service role after inserting its `recruitment_security_groups` link     | **now visible** to the creator                                                      |

So the row is created, is real (confirmed via `psql` as superuser), and is permanently unreachable by the user who created it. **You cannot learn its id through any path available to that user**, and the id is exactly what you need to write the group link that would reveal it. Writing this slice as "insert, then insert the links" produces invisible garbage rows on every create.

This was predicted in F-01's own research and carried forward into S-01's notes — _"a newly created recruitment is invisible to its creator until a `recruitment_security_groups` row exists… `insert ... returning _` will fail the SELECT-side check"\* ([S-01 research.md:210](../recruiter-views-kanban-board/research.md:210)) — but it had never been executed. It now has.

**Implication:** the create must be one atomic server-side unit that inserts the recruitment, inserts the group links, and returns the new id — i.e. a `security definer` function called via RPC, in a new migration. Three consequences follow: it is the slice's first new migration (so the `db:types` regeneration rule applies), the function must re-check `has_operation('recruitment.write')` itself because `security definer` bypasses RLS, and the "≥1 group" rule can finally be enforced in the same transaction rather than hopefully.

### Security groups and the FR-001a picker

`security_groups` is readable by every authenticated user — the policy is literally `using (true)`, with an F-01 comment citing FR-001a as the reason ([rls_policies.sql:66-71](../../../supabase/migrations/20260831183457_rls_policies.sql:66)). `name` is `text not null unique` and is the only human-readable column, so it is both the label and a safe display key. Ids are `bigint` → TS `number`.

Two adjacent tables are **not** freely readable and must stay out of the picker query: `group_memberships` is own-rows-or-admin ([:88-93](../../../supabase/migrations/20260831183457_rls_policies.sql:88)) and `group_operations` is admin-only ([:111-113](../../../supabase/migrations/20260831183457_rls_policies.sql:111)). A recruiter therefore **cannot** filter the picker down to "groups that actually confer `recruitment.read`" — that would return zero rows for them. Showing all groups is the only option without new server-side machinery, and F-01 already accepted the consequence: _a user may assign any existing group, including ones they do not belong to_ ([F-01 plan.md:41](../core-recruitment-data-foundation/plan.md:41)). Note the self-inflicted-footgun case this creates: assigning only groups you are not a member of makes your own new recruitment invisible to you, legitimately.

`recruitment_security_groups` has `unique (recruitment_id, group_id)` and `group_id ... on delete restrict` ([recruitment_candidate_schema.sql:25-31](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:25)). There is **no** DB constraint requiring at least one group.

### The authorization model and who can do what

Enum `operation` has exactly five values — `recruitment.read`, `recruitment.write`, `candidate.read`, `candidate.write`, `group.manage` ([security_rbac_schema.sql:10-16](../../../supabase/migrations/20260831181826_security_rbac_schema.sql:10)). **There is no `recruitment.create`**; org-wide create authority is `recruitment.write` checked by the unscoped helper.

Both helpers are `stable security definer` with `search_path=''`, execute granted only to `authenticated` ([mark_rls_helpers_stable.sql:5-36](../../../supabase/migrations/20260831195143_mark_rls_helpers_stable.sql:5)). In plain terms: **U may do O on R iff U belongs to some group G, G is assigned to R, and G is granted O** — all three joins on the _same_ `group_id`.

Seeded role matrix ([seed.sql:15-22, 86-89](../../../supabase/seed.sql:15)) — this is the S-02 test fixture set:

| User                              | Group          | Operations                                   | Can create a recruitment?           |
| --------------------------------- | -------------- | -------------------------------------------- | ----------------------------------- |
| `hr.test@example.com`             | HR/Rekruter    | recruitment.read/write, candidate.read/write | **Yes** — the only positive fixture |
| `hiring-manager.test@example.com` | Hiring Manager | recruitment.read, candidate.read             | No — read-only                      |
| `admin.test@example.com`          | Administrator  | `group.manage` only                          | No — strongest negative fixture     |

All three can still read the full group list (the `using (true)` policy is unconditional).

### Status changes

`status text not null default 'draft' check (status in ('draft','live','closed'))` ([recruitment_candidate_schema.sql:20](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:20)). Notable:

- **There is no recruitment status-history table.** The only history table is `candidate_recruitment_status_history`, keyed to `candidate_recruitment_id` ([:94-101](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:94)) and unusable here. A status change writes the row and nothing else — no audit trail exists or is required by FR-002.
- `updated_at` is maintained by a `before update` trigger ([add_updated_at_triggers.sql:15-16](../../../supabase/migrations/20260831194708_add_updated_at_triggers.sql:15)) — **never set it manually**.
- UPDATE is guarded by the _scoped_ helper, so a status change on a recruitment the user cannot write returns zero rows → per the inherited rule, that surfaces as **404, not 403**.
- No DELETE policy anywhere on `recruitments` — "closing" is a status update, never a delete.
- `employment_type` is **free-text with no CHECK** ([:18](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:18)); any allowed-value list must live in zod, following the `recruitmentStatusSchema` precedent and its drift warning.

### Application conventions this slice must match

**Use the S-01 JSON pattern, not the legacy auth pattern.** The auth endpoints read `formData()`, cast `form.get("email") as string` with **no zod**, and redirect with errors in a query param ([signin.ts:5-19](../../../src/pages/api/auth/signin.ts:5)). S-01's endpoints are the standard to copy: `export const prerender = false`, module-scope zod schema, `safeParse` → 422, `createClient(...)` null-guard → 500 `supabase_unconfigured`, service call in `try/catch` with `console.error` then a generic 500 ([api/recruitments/index.ts:8-33](../../../src/pages/api/recruitments/index.ts:8)).

Consequences of choosing the JSON pattern:

- The auth React forms are **native form POSTs** (`<form method="POST" action=...>`, [SignInForm.tsx:43](../../../src/components/auth/SignInForm.tsx:43)) and get their pending state from `useFormStatus()` ([SubmitButton.tsx:12](../../../src/components/auth/SubmitButton.tsx:12)). A fetch-based create form **cannot use `useFormStatus`** and needs its own `submitting` state.
- Worth keeping from the auth forms regardless: the `errors` object keyed by field, `clearError` on change, `FormField error=`, and `ServerError` for form-level failures ([SignInForm.tsx:18-40](../../../src/components/auth/SignInForm.tsx:18)).
- **No form library** — `react-hook-form` is not a dependency. State is plain `useState` per field.
- **The error contract has no field-level shape.** `ApiErrorBody` is a flat `{ error: { code, message } }` ([types.ts:47-52](../../../src/types.ts:47)) and no endpoint returns per-field detail. A six-field form needs a decision: extend the contract (e.g. optional `fields`) or validate per-field on the client and render the 422 through `ServerError`.
- `useApiResource` is **GET-only and fires on mount** ([useApiResource.ts:4-8](../../../src/components/hooks/useApiResource.ts:4)); a mutation needs a sibling hook with an imperative `mutate(body)`, reusing that file's `readErrorMessage` and 401-redirect rather than duplicating them.

**Service layer**: every function takes `client: SupabaseClient<Database>` first, returns DTOs, `throw`s on Supabase `{error}`, maps snake_case→camelCase manually, and returns `null` for not-found so the endpoint can 404 ([services/recruitments.ts:10-90](../../../src/lib/services/recruitments.ts:10)). `createRecruitment(client, command)` must mirror that shape.

**Routing is already handled**: `PROTECTED_ROUTES` includes `/recruitments` matched by `startsWith`, so `/recruitments/new` is **already protected**, and the `/api/` guard (excluding `/api/auth/`) means a new `POST /api/recruitments` gets 401 handling for free with `context.locals.user` guaranteed ([middleware.ts:5,19-28](../../../src/middleware.ts:5)). Middleware is method-agnostic; **no CSRF protection exists** anywhere — worth a conscious note now that mutations are arriving.

**UI kit gap**: `src/components/ui/` currently holds only `LibBadge.astro`, `badge`, `button`, `card`, `skeleton` — `select.tsx` was deleted in `eb1c9fd` as unused. `input`, `label`, `select`/combobox, `form`, `dialog`, `checkbox` all need installing. Caveat: existing forms don't use shadcn inputs at all — they use a bespoke `FormField.tsx` with glass/`bg-white/10` styling matching the `bg-cosmic` shell, so dropping in stock shadcn `Input` will look off-theme. Extending `FormField` is the lower-risk path.

## Code References

- `supabase/migrations/20260831183457_rls_policies.sql:133-161` — the recruitment + join-table policies; the SELECT policy at :133 is the deadlock's cause
- `supabase/migrations/20260831183457_rls_policies.sql:66-71` — `security_groups` SELECT `using (true)`, justified by FR-001a
- `supabase/migrations/20260831183457_rls_policies.sql:236-241` — all grants, per-verb
- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:13-35` — `recruitments` columns + the join table
- `supabase/migrations/20260831195143_mark_rls_helpers_stable.sql:5-36` — both authorization helpers, full bodies
- `supabase/migrations/20260831181826_security_rbac_schema.sql:10-41` — operation enum + group/membership tables
- `supabase/seed.sql:9-22,86-105` — groups, operation grants, memberships, the seeded recruitment's links
- `src/pages/api/recruitments/index.ts:8-33` — the endpoint template to copy
- `src/lib/services/recruitments.ts:10-90` — service-layer shape, error handling, DTO mapping
- `src/types.ts:8,47-52` — `recruitmentStatusSchema` and the flat `ApiErrorBody`
- `src/components/auth/SignInForm.tsx:18-43` — field-error idiom worth keeping; native-POST idiom to abandon
- `src/components/hooks/useApiResource.ts:4-70` — GET-only state machine; mutation sibling needed
- `src/middleware.ts:5,19-28` — `/recruitments` already protected; `/api/` 401 guard
- `src/db/database.types.ts:243-332,426-438` — generated `security_groups` / `recruitment_security_groups` types and the `Tables<>` / `Enums<>` helpers

## Architecture Insights

- **The chicken-and-egg is structural, not a bug.** Row-scoped read policies that depend on a _separate_ link table always make freshly-created rows invisible. The schema authors saw it (they used the unscoped helper for INSERT precisely to avoid the analogous problem on the write side) but the read-back consequence was left for this slice. Any future entity with the same "row + link table grants visibility" shape will hit it again — this is lesson-worthy beyond S-02.
- **`security definer` is the sanctioned escape hatch here** and the codebase already uses it twice with the correct hardening (`stable`, `search_path=''`, execute revoked from `anon`/`public`). A create-RPC would be the third and should copy that hardening exactly, including re-checking the operation itself since definer rights bypass RLS.
- **Authorization is uniformly a database concern**, and S-02 is the first slice where that rule is uncomfortable: the DB will correctly reject a Hiring Manager's create, but only _after_ they fill in a form. The inherited rule forbids a client-side role check; resolving this without violating it means either always showing the affordance and handling the denial gracefully, or exposing capability from the server (which is a small, principled extension rather than UI-side RBAC drift).
- **Two-statement writes have no transaction across PostgREST calls.** This slice is where that limitation first bites; the RPC solves atomicity and the FR-001a minimum in the same stroke, which is a strong argument for it over any client-orchestrated sequence.
- **The status filter and the status _setter_ are now different concerns** over the same three values. `recruitmentStatusSchema` is already the single source of truth for both, and its drift comment already warns that a CHECK-changing migration must update it in the same commit.

## Historical Context (from prior changes)

- [S-01 plan.md:52](../recruiter-views-kanban-board/plan.md:52) — _"No recruitment create/edit form — FR-001/001a/002 are S-02."_ The handoff is explicit.
- [F-01 plan.md:96](../core-recruitment-data-foundation/plan.md:96) — F-01 deliberately shipped the **complete** FR-001/FR-002 column set even though the UI was S-02's job, which is why no schema change is needed for the fields.
- [F-01 plan.md:166-168](../core-recruitment-data-foundation/plan.md:166) — write policies were shipped for `recruitments` and the join table but **deliberately withheld for `kanban_stages`** (S-03). Confirms the boundary: S-02 must not touch stages.
- [S-01 research.md:210](../recruiter-views-kanban-board/research.md:210) — the invisible-new-row constraint, recorded but never executed until now.
- [F-01 plan.md:41](../core-recruitment-data-foundation/plan.md:41) — accepted: group assignment is not restricted to the assigner's own groups.
- [S-01 plan.md:69-73](../recruiter-views-kanban-board/plan.md:69) — the inherited JSON error contract, the 404-for-forbidden ruling, and "authorization stays in the database".
- [S-01 plan.md:541](../recruiter-views-kanban-board/plan.md:541) — any commit adding a migration must also run `npm run db:types`; CI enforces with `git diff --exit-code`.
- [S-01 plan.md:534](../recruiter-views-kanban-board/plan.md:534) — _"if the list slows once S-02 creates real volume, an index on `(status, opened_at desc)` is the obvious first move"_ — S-02 is the slice that starts generating that volume.
- [lessons.md:5,9](../../foundation/lessons.md:5) — English-only for all artifacts including SQL migrations and seed data.
- Recent CI fix `4426ead`: `supabase status -o env` emits quoted values, stripped via `${API_URL//\"/}` — do not reintroduce.
- **Roadmap status is stale**: F-01 and S-01 are both further along in their own `change.md` files than [roadmap.md:44-46](../../foundation/roadmap.md:44) shows (`in-progress`), and S-02 is still `proposed`.

## Related Research

- [S-01 internal research](../recruiter-views-kanban-board/research.md) — the read path, hydration pattern, and the constraint that seeded this slice's central problem
- [F-01 plan](../core-recruitment-data-foundation/plan.md) — the schema and RLS contract in full

## Open Questions

1. **How should the atomic create be implemented?** Evidence points hard at a `security definer` RPC (insert + links + return id, in one transaction, re-checking `recruitment.write` and enforcing ≥1 group). Alternatives — a client-orchestrated two-call sequence, or relaxing `recruitments_select` to also admit a creator column — are weaker: the first cannot recover from a partial failure and strands invisible rows, the second changes S-01's read semantics and adds a column F-01 didn't model. **Owner: plan.**
2. **Does the API need field-level validation errors?** Six fields and a required-multi-select argue yes; the existing flat contract and the auth forms' client-side `errors` map argue it can wait. Whichever way, it sets the precedent for S-04 onward. **Owner: plan.**
3. **Should the "New recruitment" affordance be hidden from users who cannot create?** Directly in tension with the inherited "no UI-level permission logic" rule. Related to the still-open roadmap unknown about Hiring-Manager vs Recruiter scope before S-07 ([roadmap.md:100](../../foundation/roadmap.md:100), owner: user, non-blocking). **Owner: user.**
4. **Is `employment_type` a free-text field or a fixed list?** The DB says free text; the PRD says only "employment type". A zod enum would need the same drift discipline as status. **Owner: user.**
5. **Are there status-transition rules?** FR-002 says set/change Draft/Live/Closed with no stated restrictions — confirm that any transition is legal (including reopening a closed recruitment) rather than assuming a one-way flow. **Owner: user.**
6. **Should creating a recruitment auto-assign the creator's own group?** Would prevent the self-inflicted invisible-recruitment case, but is not in FR-001a and would be inventing product behaviour. **Owner: user.**
