# Recruiter Creates Recruitment — Plan Brief

> Full plan: `context/changes/recruiter-creates-recruitment/plan.md`
> Research: `context/changes/recruiter-creates-recruitment/research.md`

## What & Why

Recruiters currently have no way to create recruitments — S-01 shipped the read-only kanban view against seeded data only. This slice adds the create flow (title, department, location, employment type, opened date, ≥1 security group) and status management (Draft/Live/Closed), making the product usable without manual database seeding.

## Starting Point

The database write path already exists: F-01 shipped INSERT/UPDATE policies and grants for `recruitments` and `recruitment_security_groups`, and `security_groups` is readable by all authenticated users. No new table or base RLS policy is needed — but no create/update UI, API, or atomic write mechanism exists yet.

## Desired End State

A recruiter member of a group with `recruitment.write` fills in a form at `/recruitments/new`, picks one or more security groups, submits, and immediately sees the new recruitment (no invisible-row bug). They can change its status from the board/detail view, any transition allowed. A Hiring Manager sees the same "New recruitment" button but gets a clean denial on submit — no client-side role gating.

## Key Decisions Made

| Decision                     | Choice                                            | Why (1 sentence)                                                                                                                                                      | Source   |
| ---------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Create mechanism             | Atomic `security definer` RPC                     | Two-statement client-orchestrated create deadlocks — a freshly inserted recruitment is invisible to its own creator until linked, and by then its id is unrecoverable | Research |
| Error contract               | Extend `ApiErrorBody` with optional `fields`      | Six-field form needs per-field errors; small additive contract change beats duplicating validation client-side                                                        | Plan     |
| "New recruitment" affordance | Always shown, denial handled gracefully           | Matches the inherited "authorization stays in the database" rule — no UI-level permission logic                                                                       | Plan     |
| `employment_type`            | Fixed list (zod enum)                             | Consistent data for future filtering, matches the `recruitmentStatusSchema` drift-discipline precedent                                                                | Plan     |
| Status transitions           | Any transition legal, including reopening Closed  | FR-002 states no restriction; inventing a one-way flow would be unrequested business logic                                                                            | Plan     |
| Group auto-assignment        | None — creator picks explicitly                   | Matches FR-001a as written; the self-inflicted invisible-recruitment case is real but discoverable and out of spec                                                    | Plan     |
| Test coverage                | RPC + API integration tests, form component tests | Matches F-01/S-01 precedent, directly exercises the deadlock this slice exists to prevent regressing                                                                  | Plan     |

## Scope

**In scope:**

- Atomic create RPC (migration) + `POST /api/recruitments`
- `PATCH /api/recruitments/[id]` for status changes
- Create form UI at `/recruitments/new`, group picker, status control on the board/detail view
- RPC-level, API-level, component-level, and E2E test coverage

**Out of scope:**

- `kanban_stages` customization (S-03)
- Recruitment status-history/audit trail (no requirement, no table)
- Restricting status transitions
- Auto-assigning the creator's own security group
- CSRF protection (none exists anywhere in the app; unrelated to this slice)
- Admin/security-group management UI (S-07)

## Architecture / Approach

A new Postgres `security definer` function (`private.create_recruitment`) inserts the recruitment and its group links in one transaction, re-checking `recruitment.write` itself since definer rights bypass RLS. The API layer follows S-01's JSON+zod convention exactly. The form extends the existing bespoke `FormField` component family (not stock shadcn) to stay on-theme, and a new fetch-based `useMutation` hook (sibling to the GET-only `useApiResource`) drives both the create and status-change actions.

## Phases at a Glance

| Phase                | What it delivers                                                      | Key risk                                                                                                                    |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1. Atomic create RPC | New migration with the `security definer` function, regenerated types | First multi-step write function in the codebase — no prior pattern to copy verbatim, must get the RLS-bypass re-check right |
| 2. API endpoints     | POST create + PATCH status, new schemas/DTOs, extended error contract | Mapping RPC exceptions to the right HTTP status (403 vs generic 500)                                                        |
| 3. Frontend          | Create form, group picker, status control                             | Form is fetch-driven so can't reuse `useFormStatus`; needs its own pending-state handling                                   |
| 4. Tests             | RPC/API/component/E2E coverage                                        | Integration tests must exercise all 3 seeded role fixtures to catch RLS regressions                                         |

**Prerequisites:** F-01 and S-01 merged (both already `in-progress`/further along per their own `change.md`, ahead of the roadmap's stale snapshot).
**Estimated effort:** ~4 phases, roughly one focused session per phase.

## Open Risks & Assumptions

- The exact employment-type enum values aren't specified anywhere (PRD says only "employment type") — the plan picks a reasonable starter list (`full-time`, `part-time`, `contract`, `internship`); confirm with the user if this needs adjusting before implementation.
- No prior integration-test harness for hitting local Supabase from Vitest was found by name in research — Phase 4 assumes one exists from F-01/S-01 and reuses it; if none exists, that harness needs to be built first.

## Success Criteria (Summary)

- HR user creates a recruitment through the UI and sees it immediately, with no invisible-row bug.
- HR user changes a recruitment's status through any legal transition.
- Hiring Manager gets a clean, non-crashing denial on both actions.
- RLS verification script proves the deadlock scenario is solved, not just the happy path.
