# Authorization and Tenancy Contract — Plan Brief

> Full plan: `context/changes/testing-authorization-tenancy-contract/plan.md`
> Research: `context/changes/testing-authorization-tenancy-contract/research.md`

## What & Why

Build the HTTP integration suite that proves test-plan §3 Phase 1's
proposition: **a request authenticated as a non-member receives no rows and
produces no write effect across every domain endpoint.** Covers risks #1
(cross-group read/edit), #4 (shared candidate profile leaking per-recruitment
PII), and #5 (a read-only principal succeeding at a write).

The motivation is empirical, not theoretical. Two real authorization defects
shipped and were caught in *review*, not by tests — org-wide email enumeration
via an unguarded `SECURITY DEFINER` RPC, and cross-recruitment stage confusion.
One review's own words are this phase's charter: "An assertion that a caller
cannot resolve emails for ids outside their visibility would have caught F1
before it shipped."

## Starting Point

Authorization lives **entirely in Postgres** — the middleware is an
authentication gate only, no handler performs a group check, and there is no
service-role client anywhere in `src/`. The database layer is well covered:
`rls_verification.sql` holds 33 assertions including cross-group isolation. But
that script is wired into no npm script and no CI job, and its in-file run
command is documented-broken.

The HTTP layer is where the gap is. Three integration suites (572 lines) cover
happy paths and denials on **recruitments writes only**. And the fixture that is
supposed to prove isolation — the seeded Administrator — holds no
`recruitment.*` operation at all, so every denial it produces is ambiguous:
denied for non-membership, or for lacking privilege? That ambiguity is the
blocker.

## Desired End State

One dedicated `authorization.integration.test.ts` holds the project's tenancy
contract as a readable document, backed by a seed containing a "same powers,
wrong tenant" principal and a second recruitment — so isolation is symmetrical
and provable. All seven write verbs are asserted per-verb with a member
read-back proving no write effect. `npm run test:rls` runs the SQL assertions
with a working command. Test-plan §6.4 becomes the canonical recipe for adding
an authorization test.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Fixture location | Expand `supabase/seed.sql`, not per-test setup | Matches the existing pattern and keeps one source of truth for principals. | Research |
| Fixture scope | All four: HR-equivalent peer group + user, 2nd recruitment, no-group user, multi-group user | The seed edit already forces a full three-suite re-run, so folding in the cheap extras avoids paying that cost twice; the multi-group user is the only way to reach the untested `go.group_id = rsg.group_id` conjunct. | Plan |
| Suite layout | One dedicated cross-cutting suite | The contract reads as one document and per-endpoint rows sit side by side, so a missing verb is visible — worth an explicit carve-out from cookbook §6.2's beside-the-route convention. | Plan |
| Write coverage | All 7 write verbs, non-member principal, each with a state read-back | Directly refutes risk #5's named anti-pattern (test one endpoint and generalise) at bounded cost. | Plan |
| The two accepted weaknesses | Characterization tests citing the prior SKIPPED decision; not repaired | A future change moving the boundary in either direction then fails visibly. | Research + Plan |
| Risk #4 framing | Test the shared-vs-per-recruitment **split**, both directions | Org-wide candidate visibility is intentional and PRD-sourced (FR-007); testing the shared fields is the named anti-pattern. | Research |
| Risk #4 observable | The `PA003 candidate_name_mismatch` path is the positive half | `getCandidateDetail` is already recruitment-scoped, so per-recruitment fields are unreachable by construction; `PA003` is the only HTTP-observable shared-identity surface, and it fires *after* the authorization checks. | Plan |
| SQL harness | Add `test:rls` and fix the broken header comment; CI blocking deferred | Makes 33 advisory assertions runnable now while leaving gate-hardening to test-plan Phase 4. | Research + Plan |
| Note-gate bypass | Deferred to test-plan Phase 2 | Keeps the phases from overlapping. | Research |

## Scope

**In scope:**
- Seed expansion with four new principals and a second recruitment; harness `SEEDED_CREDENTIALS` extension
- One cross-cutting authorization suite: read boundary, risk #4 split, all 7 write verbs, read-only-principal denials
- The three TypeScript-only mismatched-`[id]` pre-checks that SQL impersonation cannot reach
- Characterization of the unscoped `recruitment_security_groups` INSERT/DELETE
- A CI readiness probe for the new route module graphs
- `test:rls` script, SQL header fix, test-plan §6.4 + §6.2 carve-out

**Out of scope:**
- Fixing either accepted weakness (the DELETE half is raised for decision, not repaired)
- The note-gate bypass on `candidate_recruitments` UPDATE (test-plan Phase 2)
- Making `test:rls` blocking in CI (test-plan Phase 4)
- Re-testing RLS in SQL, or auditing the 33 existing assertions for tautology
- Resolving the Hiring Manager vs Recruiter scope question (`roadmap.md:100`)
- Any unit test or e2e spec

## Architecture / Approach

Fixtures first, assertions second. The seed change perturbs the pristine
baseline every existing integration test and e2e spec runs against, so it ships
alone with all three suites re-run green as its only gate. Assertions then layer
onto a stable fixture set, organised by *proposition* rather than by route.

Two invariants govern every assertion. **404 is the tenancy signal, not 403** —
an invisible row makes a scoped update a silent no-op, so a status code alone is
never evidence of a data boundary and must be paired with a member read-back.
And **every isolation assertion is symmetrical** — a one-directional test passes
when a bug hides data from everyone, the exact tautology class already caught
once in this repo.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Seed fixtures & harness principals | Four new principals, a second recruitment, extended `SEEDED_CREDENTIALS` | Perturbs the baseline for every existing test; `validCreateBody()`'s ordinal `groupIds: [1]` will break |
| 2. Read boundary suite | The new suite: symmetrical invisibility, risk #4 split both ways, multi-group conjunct, no-group floor case | First integration coverage of three new route module graphs — inherits the Vite optimizer flake hazard |
| 3. Write surface | All 7 write verbs with state read-backs, plus the 3 TypeScript-only pre-checks | Expected status varies by denial mechanism; "normalising" them would encode the wrong thing |
| 4. Characterization of weaknesses | Both halves of the unscoped group assignment pinned with citations | A green test documenting a weakness can be misread as endorsement |
| 5. Runnability & cookbook | `test:rls`, SQL header fix, §6.4 filled, §3 row closed | `docker exec` container name is environment-specific |

**Prerequisites:** a local Supabase stack (`npx supabase start`) and a running
Astro dev server — both manual by design, since `vitest.integration.config.ts`
has no `globalSetup`. Docker required for `test:rls`.

**Estimated effort:** ~3–4 sessions across 5 phases; Phase 1 and Phase 3 are the
substantial ones.

## Open Risks & Assumptions

- **The multi-group principal may need two users, not one.** Exercising the
  same-group conjunct requires holding the operation in group A while being a
  member of attached group B where A is unattached — satisfying that and the
  no-group floor case may not collapse into a single fixture.
- **A green authorization suite that cannot fail is worse than no suite.** The
  plan's manual step 5 deliberately weakens a policy and confirms the suite
  fails; without that, the assertions' teeth are unverified.
- **The tautology risk is inherited.** If any of the 33 existing SQL isolation
  assertions is tautological, the database-layer isolation proof is illusory —
  auditing them is a tracked follow-up, not this phase.
- **`test:rls` hardcodes a container name**, so it is a local convenience until
  Phase 4 hardens it.
- **These assertions pin today's coarse per-operation split**, which the open
  product question at `roadmap.md:100` may change.

## Success Criteria (Summary)

- A user signed in outside a recruitment's security groups can neither see it
  nor change it — proven per endpoint by the data boundary and the absence of a
  write, not by a status code
- A user holding read-only grants is denied every one of the seven write
  operations, each checked individually
- The next person adding an authorization test reads §6.4 and knows how to build
  an out-of-group principal without reverse-engineering a precedent
