# Candidate History Search (S-06) — Plan Brief

> Full plan: `context/changes/candidate-history-search/plan.md`
> Research: `context/changes/candidate-history-search/research.md`

## What & Why

Recruiters and hiring managers cannot see whether a candidate has been through the company before
— the whole reason the shared candidate profile exists. This slice delivers the candidate
database: a global, name-searchable **Candidates** view, and, on each candidate, the complete
status-change log for every recruitment they took part in (US-02, FR-014, FR-015, FR-016).

## Starting Point

Earlier slices built ahead for this one. The `candidate_recruitment_status_history` table has
existed since F-01 with a read index annotated "S-06's per-candidate history query", a trigram
index sits on `candidates.full_name` tagged for S-06, and S-05 shipped `/candidates/:candidateId`
explicitly so this slice would inherit rather than rework it. `getCandidateProfile` already
returns each recruitment with its _current_ stage — so FR-016 is roughly half-built. But no
application code has ever read the history table, there is no candidates list or search endpoint,
and the repo has never had pagination or a debounce hook.

## Desired End State

A user with `candidate.read` opens Candidates, types part of a name, and sees matching candidates
alphabetically. Opening one shows their profile with every recruitment their security groups
permit, each carrying the ordered log of stage transitions with dates. A user in a different
group sees the same candidate's identity but none of that recruitment's stages, dates, or history.

## Key Decisions Made

| Decision                 | Choice                                                                  | Why                                                                                                                                                                  | Source   |
| ------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-016 vs RLS scope      | Silent truncation — show only visible recruitments, no count, no notice | Strictest reading of the PRD guardrail; a withheld count is itself a disclosure and would need a `SECURITY DEFINER` function, this repo's most repeated defect class | Plan     |
| Bounding the global list | Result cap plus a "refine your search" signal                           | Honours the 2s NFR with no new UI component and no cursor contract; search-first UX means users narrow rather than page                                              | Plan     |
| Search strategy          | Case-insensitive substring on `full_name`, two-character floor          | Exactly what FR-015 asks; rides the trigram index F-01 planted; no migration                                                                                         | Plan     |
| Actor attribution        | Deferred, with the widening scoped as a follow-up                       | FR-016 requires the log, not the actor; showing it re-touches the RPC whose predecessor leaked every account's email                                                 | Plan     |
| History delivery         | Extend the existing profile GET with `history[]`                        | One round-trip, one authorization surface; S-05 built this route for S-06 to inherit                                                                                 | Plan     |
| Fixtures                 | One cross-tenant candidate in both tenants with multi-step history      | A single fixture proves the multi-recruitment log _and_ serves as the Risk #4 truncation probe from both sides                                                       | Plan     |
| List sort order          | Alphabetical by `full_name`, `id` as tiebreak                           | Deterministic, so tests assert order without global counts                                                                                                           | Plan     |
| Authorization            | Inherited entirely from existing RLS; no migration, no new RPC          | `candidate.read` and the current policies already express this visibility exactly                                                                                    | Research |

## Scope

**In scope:** cross-tenant seed fixture; status history read and DTO extension on the candidate
profile; `GET /api/candidates` with name search and a result cap; `/candidates` page with a
debounced search island; history rendering on the profile; navigation entry point; unit,
integration, authorization, RLS and e2e coverage; cookbook update.

**Out of scope:** actor attribution; disclosing withheld recruitments; full-text search; offset or
cursor pagination; any migration, RPC or `operation` enum change; search by email or phone;
candidate deletion; CV history UI; closing the history-completeness gap (test-plan Risk #5, owned
by test-plan Phase 2).

## Architecture / Approach

Every query runs through the caller's own RLS-scoped Supabase client, so visibility is enforced by
Postgres and the application adds no authorization logic — which is what makes the truncation
correct by construction rather than by a filter someone could forget. Two read surfaces:
`listCandidates` in a new candidate-scoped service behind `GET /api/candidates`, and one
additional `in (...)` query inside the existing `getCandidateProfile` that fetches history for all
visible recruitments at once and groups it in TypeScript. Two thin React islands follow the
established `useApiResource` + `replaceState` pattern, with a new debounce hook between the input
and the URL.

## Phases at a Glance

| Phase                             | What it delivers                                           | Key risk                                                                                        |
| --------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. Cross-tenant seed fixture      | A candidate in both tenants with multi-step history        | Seed changes affect every existing suite — sequenced first so blast radius surfaces immediately |
| 2. Status history on the profile  | `history[]` on the profile DTO, read for the first time    | Extends a shipped DTO; the two stage joins need disambiguated aliases                           |
| 3. Candidates list and search API | `GET /api/candidates?q=` with cap and ordering             | Unescaped wildcards in user input would turn a search into a full scan                          |
| 4. Candidates UI                  | `/candidates` page, debounced search island, log rendering | No `input` component and no debounce hook exist yet; both are new ground                        |
| 5. Gate closure                   | RLS assertion (34), e2e spec, cookbook, decision record    | Easy to under-deliver on tests once the feature visibly works                                   |

**Prerequisites:** F-01 and S-04 shipped (both are); a local Supabase stack for integration, RLS
and e2e runs. S-05 is parallel, not blocking, though its route family is what Phase 2 extends.
**Estimated effort:** ~3–4 sessions across five phases; Phases 1 and 5 are small, Phase 4 is the
largest.

## Open Risks & Assumptions

- The seed addition is the one change with cross-suite blast radius. The cookbook already forbids
  global-count assertions, but Phase 1 verifies that empirically by running every suite rather
  than trusting compliance.
- Silent truncation means a hiring manager can read a partial history as if it were complete.
  This is a deliberate, recorded product choice, not an oversight — revisit if users misread it.
- The history log and `current_stage_id` can in principle disagree, because a direct PostgREST
  update writes no history row. S-06 does not close that gap but is the first surface where it
  would become user-visible.
- Whether `from_stage_id`/`to_stage_id` need indexes is assumed "no" and confirmed by inspecting a
  real query plan in Phase 2, rather than by adding indexes speculatively.

## Success Criteria (Summary)

- A user can find a candidate by typing part of their first or last name and open their profile.
- The profile shows every recruitment the viewer is entitled to see, each with its complete,
  correctly ordered status log starting from the initial add.
- A user outside a recruitment's security group sees the candidate but none of that recruitment's
  stages, dates, or history — asserted in both directions at the HTTP and database layers.
