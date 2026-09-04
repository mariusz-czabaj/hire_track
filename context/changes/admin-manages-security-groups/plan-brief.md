# S-07: Administrator Manages Security Groups and Users — Plan Brief

> Full plan: `context/changes/admin-manages-security-groups/plan.md`
> Research: `context/changes/admin-manages-security-groups/research.md`

## What & Why

An administrator needs to create security groups, grant them operations, and add
or remove users from them (FR-017, FR-018). The entire database and security layer
for this shipped in F-01 and has sat unused ever since — F-01 deliberately shipped
full operation-gated RLS to avoid a security gap "during the gap before S-07 ships
an admin UI." This slice closes that gap by building the application surface on
top of it.

## Starting Point

All three RBAC tables, their RLS policies, and the `private.has_operation('group.manage')`
gate exist and are correct. Application code touching any of it amounts to a single
9-line `listSecurityGroups` function and one GET route. There is no admin API, no
admin page, no way to enumerate users, and no signal telling the frontend whether
the caller is an administrator.

## Desired End State

An administrator sees an Admin entry in the top bar, creates and renames groups,
toggles any of the five catalog operations per group, searches for users by email
and manages membership. Non-administrators see no Admin entry, and every admin
route returns 403 to them regardless. Removing the last `group.manage` grant is
refused with a clear message rather than silently bricking the installation.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| UI gating | Expose the caller's own operations in `Astro.locals` | Closes the dead-end nav entry without weakening security — the database stays the only real gate. | Plan |
| Self-lockout | Hard guard inside `SECURITY DEFINER` functions | The "at least one administrator remains" invariant is trivial in a function and impossible in an RLS policy alone. | Plan |
| CRUD scope | Create, rename, operations, membership — no delete | Covers FR-017/FR-018 fully and sidesteps the `on delete restrict` FK entirely. | Plan |
| User discovery | Search box with a minimum query length | Keeps the enumeration surface narrow — the exact concern that killed the unscoped `get_user_emails` in S-04. | Plan |
| Page structure | List page plus group detail page | Matches the existing recruitments list/detail shape and keeps each React island small. | Plan |
| Operation writes | Per-checkbox immediate write | Each toggle maps to exactly one unique-constrained row; no diffing, failures stay isolated. | Plan |
| Authorization mechanism | Plain RLS-covered tables except the two lockout paths | RLS already gates all three tables on `group.manage`; only the cross-row invariant needs a function. | Research |
| Testing | Integration tests on the security boundary | Tests what a mock would lie about — RLS, unique constraints, the lockout invariant — with fixtures that already exist. | Plan |
| Seed names | Rename `HR/Rekruter` to English, in its own phase | Clears a known English-only violation at the moment renaming becomes a product feature; it ripples through 4 test files. | Plan |

## Scope

**In scope:**
- Gated user-search RPC and two lockout-guarded write functions
- Caller-operations signal in middleware and `Astro.locals`
- Admin API routes for groups, operations, members, and user search
- `/admin/groups` list and detail pages, plus a gated nav entry
- Integration tests on the security boundary
- English rename of seeded group names

**Out of scope:**
- Deleting groups; any schema change to the three RBAC tables
- Adding or removing values from the operation catalog (that is a migration)
- Inviting or creating users; per-group audit logging
- Reworking the recruitment-side group picker
- Adding S-07 to `test-plan.md` §3 — no rollout phase covers this slice

## Architecture / Approach

Bottom-up in dependency order: database functions, then the operations signal the
UI needs, then API routes, then pages, then tests, then the seed rename alone at
the end. Writes stay on plain RLS-covered tables wherever possible — create,
rename, grant, and member-add are ordinary table operations under the caller's
session, denied by RLS with `42501` for non-admins. Only the two paths that can
destroy the last `group.manage` grant move onto `SECURITY DEFINER` functions,
which perform the write and then roll it back if the post-state has no
administrator left. The user search is the one place S-04's removed enumeration is
legitimate, and it is gated at the function's first statement rather than only at
the route.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database | Gated user search plus two lockout-guarded write functions | A guard placed only at the route leaves the function callable via PostgREST |
| 2. Operations signal | Caller's own operations in `Astro.locals`; `/admin` protected | Adds a query to every authenticated request |
| 3. API + service | Four route families and a shared error mapper | Unmapped errcodes falling through to 500s — the failure this repo has hit three times |
| 4. Admin UI | List and detail pages, member picker, gated nav entry | Per-checkbox writes leaving visibly partial state on failure |
| 5. Integration tests | Security-boundary coverage with existing fixtures | Tests that pass without actually exercising the guard |
| 6. Seed rename | English group names across seed, RLS script, 4 test files | Missed reference breaking an unrelated suite |

**Prerequisites:** F-01 (`core-recruitment-data-foundation`) — shipped. Local Supabase
running for phases 1, 5, and 6.
**Estimated effort:** ~4-5 sessions across 6 phases; phases 1-2 are small, phases 3-4
carry most of the work.

## Open Risks & Assumptions

- The middleware operations lookup runs per authenticated request; caching it on the
  session is the follow-up if it shows up in practice, but staleness after a permission
  change would be a correctness regression, so it is not done here.
- Exposing the caller's operations for rendering is the first deliberate softening of
  the no-UI-permission-logic rule; the plan keeps the database authoritative, and the
  new rule reads "render from operations, authorize in DB". Worth capturing as a lesson.
- Assumes the operation catalog stays closed. If a future slice makes operations
  admin-extensible, the zod enum in `src/types.ts` becomes a drift hazard.
- The lockout guard counts `group.manage` holders globally, not per group; an install
  with a single administrator will hit the refusal on legitimate reorganization and must
  add a second administrator first.

## Success Criteria (Summary)

- An administrator can create a group, grant it operations, and add a user to it
  entirely through the UI, without a page refresh
- A non-administrator sees no admin affordance and cannot reach any admin route
- No sequence of UI actions can leave the installation with zero administrators
