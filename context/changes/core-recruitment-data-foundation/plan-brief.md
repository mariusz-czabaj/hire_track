# Core Recruitment Data Foundation — Plan Brief

> Full plan: `context/changes/core-recruitment-data-foundation/plan.md`

## What & Why

Build the Postgres schema + RLS security model that every recruiting slice (S-01 through S-07) depends on: recruitments, candidates, the candidate↔recruitment link with status history, security groups with an operations catalog, group membership, and the default kanban stages. This is roadmap item F-01 — pure data foundation, no UI or API. The roadmap explicitly flags this as the item where getting it wrong is expensive to redo later ("zrobienie tego później oznaczałoby przebudowę RLS pod istniejące dane").

## Starting Point

`supabase/` exists with local dev configured (`config.toml`) but no `migrations/` and no domain schema. Auth is Supabase-managed email+password with no app-level `profiles` table — group membership will reference `auth.users(id)` directly.

## Desired End State

`npx supabase db reset` on a clean database produces a fully working, RLS-enforced schema: an HR user can see and edit a seeded recruitment and its candidates; a Hiring-Manager-only user can see the same recruitment but any write attempt is rejected by Postgres itself; an unauthenticated request sees nothing. A SQL script proves all three behaviors automatically.

## Key Decisions Made

| Decision               | Choice                                                                                    | Why (1 sentence)                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Status history         | Dedicated `candidate_recruitment_status_history` table from day one                       | S-06 needs a full log; adding it later means a migration + a decision about unrecoverable pre-existing history        |
| Kanban stages          | Lookup table (`recruitment_id` nullable: null = default, set = override)                  | S-03's per-recruitment override becomes a pure insert, not a schema change                                            |
| Operations catalog     | Fixed Postgres enum, per-entity CRUD (5 values)                                           | Matches the PRD's 3 example groups exactly; no admin-editable operation set is requested anywhere                     |
| RLS write sequencing   | Full operation-gated RLS now, with seed grants for the PRD's example groups               | Avoids a real security gap (any group member could write) during the gap before S-07 ships an admin UI                |
| Candidate dedup        | Unique email (case-insensitive); app-layer "add candidate" links to existing row on match | Directly required by FR-007's shared-profile model; without it S-06's history search silently fragments               |
| Seed data              | Shipped in this change (`supabase/seed.sql`)                                              | S-01's plan already assumes seeded test data exists; F-01 owns the schema being seeded                                |
| Group deletion         | `ON DELETE RESTRICT` — blocks deleting a group still assigned to a recruitment            | Prevents a recruitment silently becoming invisible to everyone                                                        |
| Candidate search index | Trigram GIN index added now, in the same migration that creates the column                | One migration instead of two; avoids a slow scan the moment S-06 ships                                                |
| RLS verification       | Automated SQL script simulating multiple users, not manual Studio clicking                | Repeatable regression safety net for a security-critical policy set; no test framework exists yet to build on instead |

## Scope

**In scope:** recruitments, candidates, candidate↔recruitment link + status history, security groups/operations/membership, default kanban stages, RLS on all of it, local seed data, an automated RLS verification script.

**Out of scope:** candidate notes and the status-change-blocking rule (S-04), CV upload/retention (S-05), per-recruitment kanban stage customization UI (S-03), recruitment create/edit UI (S-02), kanban board UI (S-01), admin UI for groups/membership (S-07), any deletion of recruitments/candidates, OAuth migration (parked).

## Architecture / Approach

Four migrations in dependency order: (1) security/RBAC tables, (2) recruitment/candidate domain tables + real default kanban-stage data, (3) two `SECURITY DEFINER` helper functions in a `private` schema plus RLS policies on all 9 tables, (4) `supabase/seed.sql` local fixtures + a SQL verification script. Permission checks go through the helper functions rather than inline joins, so the two RBAC lookup tables (`group_memberships`, `group_operations`) can stay locked down to admins-only without breaking every other table's policy checks.

## Phases at a Glance

| Phase                                    | What it delivers                                     | Key risk                                                                                  |
| ---------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1. Security & RBAC Schema                | Groups, operations enum, membership                  | Low — no RLS yet, pure schema                                                             |
| 2. Recruitment & Candidate Domain Schema | All 6 domain tables + default stages + search index  | Medium — schema choices here (stage shape, status history) are the ones costly to reverse |
| 3. RLS Policies                          | Helper functions + policies + grants on all 9 tables | High — the security-critical phase; the INSERT chicken-and-egg sequencing must be right   |
| 4. Seed Data + RLS Verification          | Local fixtures + automated proof the policies work   | Medium — verification script correctness determines whether Phase 3 bugs get caught       |

**Prerequisites:** none beyond local Supabase running (`npx supabase start`).
**Estimated effort:** ~1-2 sessions across 4 phases.

## Open Risks & Assumptions

- Default kanban stage names (Nowy/Screening/Rozmowa/Oferta/Zatrudniony/Odrzucony) aren't specified in the PRD — chosen as a reasonable default; low-cost to rename later since it's data, not schema.
- Assumes a recruitment can be assigned to any existing security group at creation time, not only groups the assigning user belongs to (needed to resolve the INSERT chicken-and-egg — see plan's Critical Implementation Details).

## Success Criteria (Summary)

- `npx supabase db reset` succeeds end-to-end and lint is clean.
- An automated SQL script proves group-scoped read/write enforcement and anonymous denial — no manual RLS testing required for future regressions.
- Every table F-01's roadmap outcome names exists with the exact shape S-01/S-02/S-04/S-06/S-07 will need, verified by inspection in Supabase Studio.
