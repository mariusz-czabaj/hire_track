---
date: 2026-09-02T17:22:56+02:00
researcher: Mariusz Czabaj
git_commit: b7e44a1db0487f46ef0ee807bca6395d88416506
branch: main
repository: mariusz-czabaj/hire_track
topic: "Authorization and tenancy contract — proving a non-member gets no data and no write effect across every domain endpoint"
tags: [research, codebase, authorization, rls, tenancy, integration-tests, test-plan-phase-1]
status: complete
last_updated: 2026-09-02
last_updated_by: Mariusz Czabaj
---

# Research: Authorization and Tenancy Contract (test-plan §3 Phase 1)

**Date**: 2026-09-02T17:22:56+02:00
**Researcher**: Mariusz Czabaj
**Git Commit**: b7e44a1db0487f46ef0ee807bca6395d88416506
**Branch**: main
**Repository**: mariusz-czabaj/hire_track

## Research Question

Ground test-plan §3 Phase 1 ("Authorization and tenancy contract") in current
code: prove a non-member receives no rows and produces no write effect across
every domain endpoint. Covers risks **#1** (cross-group read/edit), **#4**
(shared candidate profile leaks PII from an invisible recruitment), and **#5**
(a principal lacking the write operation succeeds at a write).

Per test-plan §1 principle #3, this document is the ground truth for *where*
the failures live; §2 of the plan only says *what* could fail.

## Summary

Six findings drive the plan:

1. **Authorization lives entirely in Postgres.** No API handler reads
   `locals.user`; no handler performs a group check. The middleware is an
   authentication gate only. Asserting a 401 or a redirect proves nothing
   about tenancy — the test plan's "must challenge" for risk #1 is confirmed
   exactly as written.
2. **The database layer is already well covered — the HTTP layer is not.**
   `supabase/tests/rls_verification.sql` is 1032 lines / 33 assertions and
   already includes cross-group isolation. The test plan's "test base:
   sparse" judgement is accurate for the *application* surface but
   understates the DB surface. Phase 1 must not re-test RLS in SQL; it must
   cover what SQL impersonation structurally cannot reach.
3. **The decisive fixture gap: there is no "same powers, wrong tenant"
   principal.** The seeded non-member (`admin.test@example.com`) is a
   *privileged* non-member holding only `group.manage`, so every denial it
   produces is ambiguous — denied for non-membership, or denied for lacking
   `recruitment.*`? Phase 1 cannot prove isolation until this is fixed.
4. **Risk #4 must be re-framed, not tested as written.** Org-wide candidate
   visibility is *intentional and PRD-sourced* (FR-007, FR-015, FR-016). The
   leak to test is the *per-recruitment* fields, not the shared profile.
5. **Two live authorization weaknesses are in scope for risk #5**, both
   accepted-by-decision rather than accidental: unscoped group assignment on
   `recruitment_security_groups`, and a direct PostgREST write path on
   `candidate_recruitments` that bypasses the note gate.
6. **Three service-layer scope pre-checks exist only in TypeScript** and are
   invisible to the SQL harness. These are the highest-value HTTP-only tests.

## Detailed Findings

### The enforcement chain (what a test must actually pierce)

Every domain request follows one shape, with no variation:

`src/middleware.ts` → zod param/body validation → `createClient(request.headers, cookies)` → service in `src/lib/services/**` → RLS policy or `SECURITY DEFINER` RPC.

- `src/middleware.ts:19-27` — `isApiRoute` computed from the path; unauthenticated API requests get `jsonError(401, "unauthenticated", …)`. **Authentication only.** `PROTECTED_ROUTES` (`:5`) lists page routes (`/dashboard`, `/recruitments`) and is irrelevant to the API.
- `src/lib/supabase.ts:6-23` — the single client factory, `createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, …)` with the caller's cookies. **There is no service-role client anywhere in the repo**; a repo-wide grep for `service_role|SERVICE_ROLE|serviceRole|secret_key` returns zero hits in `src/`. Confirmed independently against `astro.config.mjs:24-25`, which declares only `SUPABASE_URL` and `SUPABASE_KEY`. This closes the test plan's "whether any code path uses a privileged client that bypasses row-level scoping" — **it does not**, and no test needs to chase one.
- Every service function in `src/lib/services/**` takes `client: Client` as its first parameter and never constructs one. Authorization is therefore always caller-scoped by construction.

Prior decisions state this posture explicitly:
`context/changes/recruiter-views-kanban-board/plan.md:73` — "**Authorization stays in the database.** … The middleware `/api` guard is an authentication gate (is there a session?), not an authorization one."

### The tenancy model and its two grant tiers

`private.has_operation(op)` is **recruitment-independent**: membership in *any*
group holding the operation. `private.has_recruitment_operation(id, op)` is
correctly scoped — it requires membership **and** the operation on the *same*
group attached to that recruitment (`go.group_id = rsg.group_id`). Both at
`supabase/migrations/20260831195143_mark_rls_helpers_stable.sql:5-36`.

The tenancy edge is the only chain that matters:
`recruitment_security_groups → group_memberships → group_operations`.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `recruitments` | `HRO(id,read)` | **`HO(write)`** | `HRO(id,write)` | none |
| `recruitment_security_groups` | `HRO(rid,read)` | **`HO(write)`** | none | **`HO(write)`** |
| `candidates` | **`HO(candidate.read)`** | `HO(candidate.write)` | `HO(candidate.write)` | none |
| `candidate_recruitments` | `HRO(rid,read)` | `HRO(rid,write)` | `HRO(rid,write)` | none |
| `candidate_recruitment_status_history` | EXISTS→parent read | EXISTS→parent write | none | none |
| `candidate_stage_notes` | EXISTS→parent read | EXISTS→parent write | EXISTS→parent write | none |
| `security_groups` | **`using (true)`** | `HO(group.manage)` | `HO(group.manage)` | `HO(group.manage)` |

Policies: `supabase/migrations/20260831183457_rls_policies.sql:69-230`;
notes `20260901210000_candidate_stage_notes.sql:28-67`.
Bold entries are the **org-wide** checks — each is a place where the
recruitment boundary is deliberately not applied.

Every policy is `to authenticated`; **there is not one `anon` policy** — anon
is denied by absence. RLS is enabled on all tables.

**Attribution caveat for the plan.** Table grants (`:234-244`) are narrowed to
the verbs that have policies. A `DELETE` on `recruitments` therefore fails as
`42501` at the *grant* layer, not via RLS. A test asserting "RLS denied it"
would be asserting the wrong mechanism.

### Risk #1 — cross-group read and write

The correct scoping is in place for `recruitments` SELECT/UPDATE and for
everything hanging off a recruitment. Assertion (5) of the SQL harness already
proves the Administrator sees zero recruitments — added specifically because a
review caught its absence
(`context/changes/core-recruitment-data-foundation/reviews/impl-review.md:68`:
"none test the property the whole `recruitment_security_groups` design exists
for").

What is **not** covered anywhere, and is HTTP-observable:

- **404-vs-403 semantics.** `updateRecruitmentStatus` uses
  `.update().eq(id).select().maybeSingle()` (`src/lib/services/recruitments.ts:99`);
  an invisible row makes the update a silent no-op returning `null`, which the
  handler maps to **404** (`src/pages/api/recruitments/[id]/index.ts:46`). The
  existing test already encodes this (`HM PATCH → 404`). Phase 1 must assert
  the *pair*: the non-member gets 404 **and** the row is unchanged when read
  back by a member. Asserting only the status code is the test plan's named
  anti-pattern.
- **The multi-group principal.** Because `has_recruitment_operation` requires
  membership and operation on the same group, a user in group A (write, not
  linked) and group B (read, linked) must get read only. No seed fixture has a
  multi-group user, so this branch of the predicate has never been exercised.

### Risk #4 — re-framed: the shared profile is intentional

The org-wide `candidates` scope is a deliberate, documented product decision,
not a defect:

- `context/foundation/prd.md:91` (FR-007, verbatim): "profil (dane, CV) jest
  współdzielony, notatki i status są osobne per rekrutacja."
- `context/changes/core-recruitment-data-foundation/plan.md:22`: "FR-015/FR-016
  and the Access Control guardrail describe candidate visibility as org-wide
  for any authenticated user with the read operation — not scoped
  per-recruitment-group like recruitment visibility is."

So the boundary to test is the **split**, exactly as the test plan's "Context
research must ground" column demanded ("Which fields are per-recruitment
versus shared"):

| Shared (org-wide, `candidate.read`) | Per-recruitment (`HRO`) |
|---|---|
| `candidates.full_name`, `email`, `phone` | `candidate_recruitments` link, `current_stage_id`, `added_at` |
| `candidate_cvs` rows and CV bytes | `candidate_recruitment_status_history` |
| | `candidate_stage_notes` |

Testing that a non-member *can* see the shared profile is correct behaviour;
testing that the shared fields don't leak is the plan's named anti-pattern
("exercising only the shared fields, where by construction no leak is
possible"). **The assertion is: a viewer holding `candidate.read` but not a
member of recruitment R sees the candidate's identity, and sees zero notes,
zero status history, and no stage/`added_at` from R.**

This risk has already materialised once, which is strong evidence it is
correctly rated. `get_user_emails(uuid[])` shipped as `SECURITY DEFINER` with
no authorization check, allowing any signed-in user to enumerate every user
email in the system
(`context/changes/recruiter-manages-candidate-status/reviews/impl-review.md:38`).
It was replaced by the scoped `get_user_emails_for_candidate`
(`supabase/migrations/20260901230000_scope_get_user_emails_rpc.sql:8-40`,
raising `P0002` on an unreadable recruitment). The review's own lesson at `:92`
is effectively Phase 1's charter: "An assertion that a caller cannot resolve
emails for ids outside their visibility would have caught F1 before it
shipped."

### Risk #5 — per-operation writes, and two accepted weaknesses

`hiringManager` (`recruitment.read` + `candidate.read`) is the read-only
principal. Denials surface as `42501` → **403** via the shared error mappers
(`src/lib/api/candidate-errors.ts:9-27`,
`src/pages/api/recruitments/[id]/stages.ts:25`). The test plan's anti-pattern
here — "testing one write endpoint and generalising" — is precisely the current
state: `index.integration.test.ts` covers POST/PATCH on recruitments only. Every
write verb needs its own row.

The full write surface to enumerate:
`POST /api/recruitments`; `PATCH /api/recruitments/[id]`;
`PUT` and `DELETE /api/recruitments/[id]/stages`;
`POST /api/recruitments/[id]/candidates`;
`PATCH /api/recruitments/[id]/candidates/[candidateId]`;
`PUT /api/recruitments/[id]/candidates/[candidateId]/notes`.

Two genuine weaknesses, both **accepted by prior decision** — Phase 1 should
characterise them, not silently "fix" them:

- **Unscoped group assignment.** `recruitment_security_groups` INSERT *and*
  DELETE both use the broad `HO('recruitment.write')`
  (`20260831183457_rls_policies.sql:155-160`), and `create_recruitment` checks
  only the blanket operation without validating that the caller belongs to the
  groups in `p_group_ids`
  (`20260901150000_create_recruitment_returns_row.sql:26`). A `recruitment.write`
  holder can therefore create a recruitment scoped to a group they are not in,
  and can detach or attach groups on a recruitment they cannot read. Documented
  as an accepted simplification at
  `context/changes/core-recruitment-data-foundation/plan.md:41` and re-flagged
  and consciously skipped at
  `context/changes/recruiter-creates-recruitment/reviews/impl-review.md:69-71`
  ("**Decision: SKIPPED** — consistent with existing design, not a
  regression"). The INSERT half has a real chicken-and-egg justification; the
  **DELETE half does not**, and is the sharper of the two.
- **Note gate bypass.** `candidate_recruitments_update` lets any
  `recruitment.write` holder set `current_stage_id` directly through PostgREST,
  bypassing `move_candidate_stage`'s note requirement. The gate holds only
  because the app always routes through the RPC — stated at
  `20260901210500_candidate_write_rpcs.sql:4-7`. This is risk #6's mechanism but
  surfaces through risk #5's lens; **flag it and defer the assertion to Phase 2**
  to keep the phases from overlapping.

### Service-layer pre-checks — the HTTP-only test targets

Three checks exist solely in TypeScript, so SQL impersonation cannot reach them.
They guard against a **mismatched `[id]` URL segment** — a caller with
`recruitment.write` on recruitment X addressing a candidate row belonging to
recruitment Y:

- `src/lib/services/candidates.ts:54-67` — `moveCandidateStage` scopes
  `candidate_recruitments` by both `id` and `recruitment_id` before calling the
  RPC, because "move_candidate_stage resolves its own recruitment from
  candidateRecruitmentId".
- `src/lib/services/candidates.ts:187-199` — the same pre-check in
  `upsertCandidateNote`.
- `src/lib/services/candidates.ts:216-222` — `stageId` must belong to this
  recruitment's resolved stage set, throwing a synthetic `22023`. Added after a
  review found cross-recruitment stage confusion
  (`context/changes/recruiter-manages-candidate-status/reviews/impl-review.md:62`).
- `src/lib/services/candidates.ts:202-208` — `created_by` is derived from the
  session, never the request body; `UpsertCandidateNoteCommand` carries no
  author field (`src/types.ts:99`).

A related gap worth one assertion: `move_candidate_stage` does not verify that
`to_stage_id` belongs to the recruitment's stage set. A foreign *override* stage
is caught by the `BEFORE UPDATE` consistency trigger
(`20260901161434_kanban_stage_customization.sql:54-74`, `22023`), but any
*global default* stage id is accepted unconditionally.

`GET /api/security-groups` also returns the full group list unfiltered
(`src/pages/api/security-groups.ts:15`), relying on `security_groups_select
using (true)`. This is intentional — FR-001a needs the list at creation time
(`core-recruitment-data-foundation/plan.md:163`) — but group *names* are
organisational metadata, so it deserves a documented expected-value assertion
rather than being left implicit.

### Harness — what to reuse, and its sharp edges

`src/lib/test-support/integration-client.ts` is the mandated harness
("reuse, don't invent a new harness" —
`context/changes/recruiter-creates-recruitment/plan.md:263`). It signs in
through the **real** `POST /api/auth/signin` and replays `Set-Cookie`; there are
no forged cookies and no injected `locals.user`.

Non-obvious constraints any new suite must copy:

- `Origin: BASE_URL` header (`:48`) — Astro's CSRF protection rejects the
  sign-in POST without it.
- `redirect: "manual"` (`:47`) — so the 302's cookies are readable.
- `client.fetch` always sets `Content-Type: application/json` and takes
  relative paths.
- `TEST_BASE_URL` defaults to `http://localhost:4321` (`:15`);
  `PASSWORD = "password123"` (`:16`).
- **No data reset of any kind** — no `beforeEach`, no truncation, no
  transaction rollback. The discipline is create-your-own-fixture and never
  assert on global counts. Rows accumulate; CI resets with
  `npx supabase db reset --local` *after* the integration job.
- `validCreateBody()` uses `groupIds: [1]`, relying on seed insertion order.
  New fixtures should look groups up **by name**, as `seed.sql` itself does.

`vitest.integration.config.ts:9-18` has no `environment`, no `setupFiles`, no
`globalSetup` and no env loading — a running Supabase stack and Astro dev server
are manual prerequisites by design.

CI (`.github/workflows/ci.yml:51-99`) runs the integration suite in the `e2e`
job and performs **three** readiness gates before it, each added in response to
a real flake: poll `/api/security-groups`, poll a second distinct route (Astro
dev's Vite optimizer reloads dep bundles per route module graph — **a new suite
introducing new routes inherits this hazard**), then a real curl sign-in retried
until `200` because GoTrue/PostgREST clock skew right after `supabase start`
yields `PGRST303 "JWT issued at future"`.

**The SQL harness run command in-file is wrong.** `rls_verification.sql:9`
recommends `npx supabase db query --local -f …`, which cannot run a
multi-statement script ("cannot insert multiple commands into a prepared
statement"). The working invocation is
`docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_verification.sql`
(`core-recruitment-data-foundation/plan.md:217`; "ignore it" —
`recruiter-customizes-kanban-stages/plan.md:113`). The script is also wired
into **no** npm script and **no** CI job — so its 33 assertions are currently
advisory. Test-plan §5 lists the authorization gate as "required after Phase 1";
wiring this script is a cheap, high-value part of that.

### The fixture gap — the single biggest blocker

Seeded principals (`supabase/seed.sql:31-89`), each in exactly one group:

| Principal | Group | Operations |
|---|---|---|
| `hr.test@example.com` | HR/Rekruter | `recruitment.read/write`, `candidate.read/write` |
| `hiring-manager.test@example.com` | Hiring Manager | `recruitment.read`, `candidate.read` |
| `admin.test@example.com` | Administrator | `group.manage` **only** |

There is exactly **one** recruitment (`Backend Engineer`), linked to *both*
HR/Rekruter and Hiring Manager (`seed.sql:94-105`).

The seed comment calls the Administrator the cross-group-isolation fixture, and
`core-recruitment-data-foundation/plan.md:202` agrees ("not `Administrator` —
that's the point of the isolation assertion"). **But it conflates two axes.**
Because it holds no `recruitment.*` operation at all, every denial it produces
is explicable by lack of privilege alone. It cannot distinguish "denied because
not a member" from "denied because it lacks the operation" — which is the exact
proposition risk #1 exists to test.

To prove isolation rather than mere lack of privilege, Phase 1 needs:

- **(a)** a fourth group with the *same* operations as HR/Rekruter, and a user
  in it — the "same powers, wrong tenant" principal;
- **(b)** a **second recruitment** scoped only to that fourth group, so each
  principal has a recruitment the other cannot see (isolation becomes
  symmetrical and testable in both directions);
- **(c)** a user in **no group at all** — the floor case for
  `prd.md:117` ("Żadne dane kandydatów nie są dostępne nieuprawnionemu…");
- **(d)** a **multi-group** user, to exercise the `go.group_id = rsg.group_id`
  branch of `has_recruitment_operation`.

(a) and (b) are the minimum for a meaningful contract. Adding them means
editing `supabase/seed.sql` and extending `SEEDED_CREDENTIALS`
(`integration-client.ts:18-22`) — a change that touches every existing
integration and e2e test's environment, so it should be its own early sub-phase
with the full suite re-run as its verification.

Note also that a *new* recruitment must not disturb existing assertions: e2e
specs already PATCH freshly created recruitments off `draft` to avoid polluting
filter assertions (`tests/e2e/candidates.spec.ts:6-33`).

## Code References

- `src/middleware.ts:19-27` — API auth gate; 401 only, no authorization
- `src/lib/supabase.ts:6-23` — sole client factory, caller-scoped, no service role
- `src/lib/services/recruitments.ts:99` — invisible-row UPDATE returns `null` → 404
- `src/lib/services/candidates.ts:54-67`, `:187-199`, `:216-222` — TS-only scope pre-checks
- `src/lib/services/candidates.ts:202-208` — `created_by` from session, not body
- `src/lib/api/candidate-errors.ts:9-27` — `42501`→403, `P0002`→404, `PA003/PA004`→422
- `src/pages/api/security-groups.ts:15` — unfiltered group list
- `supabase/migrations/20260831195143_mark_rls_helpers_stable.sql:5-36` — both RLS helpers
- `supabase/migrations/20260831183457_rls_policies.sql:69-244` — all policies + grants
- `supabase/migrations/20260831183457_rls_policies.sql:155-160` — broad group-assign INSERT/DELETE
- `supabase/migrations/20260901150000_create_recruitment_returns_row.sql:26` — blanket-only check
- `supabase/migrations/20260901210500_candidate_write_rpcs.sql:4-7` — note-gate bypass note
- `supabase/migrations/20260901230000_scope_get_user_emails_rpc.sql:8-40` — scoped email RPC
- `supabase/seed.sql:9-105` — groups, grants, three users, single recruitment
- `supabase/tests/rls_verification.sql:1-1032` — 33 SQL assertions
- `src/lib/test-support/integration-client.ts:15-72` — the mandated HTTP harness
- `vitest.integration.config.ts:9-18` — integration config, manual prerequisites
- `.github/workflows/ci.yml:51-99` — three readiness gates, then DB reset

## Architecture Insights

- **Single enforcement point, by policy.** Authorization is in Postgres and
  nowhere else. This is a strength for auditability and the reason the SQL
  harness is so thorough — but it means the application layer's own scoping
  logic (the three TS pre-checks) has *no* coverage at all, because the SQL
  harness cannot see it and unit tests stub the client.
- **Two-tier grants are a deliberate design, not an oversight.** Org-wide for
  `candidate.*` and `group.manage`; recruitment-scoped for `recruitment.*` on
  existing rows. Every broad check is accompanied by a migration comment
  explaining it. A test suite that treats a broad check as a bug will produce
  noise; the correct posture is to pin the intended behaviour so an
  *unintentional* widening is caught.
- **"No policy" is the deny mechanism.** Absent DELETE/UPDATE policies plus
  narrowed grants mean denial arrives at the grant layer. Tests should assert
  the *effect* (no row change), not a specific SQLSTATE origin.
- **404 is the tenancy signal, not 403.** For scoped reads and updates, an
  invisible row is indistinguishable from a missing one — deliberately.
  Assertions must therefore always pair the response with a read-back by a
  legitimate member; the status code alone is not evidence of a data boundary.
- **Review history shows this risk class is real and recurring.** Two
  authorization defects (email enumeration; cross-recruitment note stages) and
  one tautological assertion were all caught in *review*, not by tests. That
  is the strongest available argument for Phase 1's cost.

## Historical Context (from prior changes)

- `context/changes/core-recruitment-data-foundation/plan.md:22,37,41,163-170,202,210,217` — the whole RBAC/RLS design, the org-wide candidates decision, the accepted unscoped-group-assignment simplification, the SQL harness pattern, and the broken run command
- `context/changes/core-recruitment-data-foundation/reviews/impl-review.md:68` — cross-group isolation assertion was missing and was added
- `context/changes/recruiter-creates-recruitment/plan.md:156,168,263` — the HTTP harness was built once here; reuse is mandated
- `context/changes/recruiter-creates-recruitment/reviews/impl-review.md:69-71` — unscoped group assignment re-flagged, decision SKIPPED
- `context/changes/recruiter-manages-candidate-status/reviews/impl-review.md:38,62,88,92` — email-enumeration hole, cross-recruitment stage confusion, missing assertion, and the "an assertion would have caught this" lesson
- `context/changes/recruiter-customizes-kanban-stages/reviews/impl-review.md:29,39,51` — tautological assertion (`UPDATE 0` and `UPDATE 1` both passed), three `fix(ci):` flake commits, and an assertion that caught a real bug
- `context/changes/recruiter-views-kanban-board/plan.md:73` — "authorization stays in the database"
- `context/changes/candidate-profile-and-cv-upload/research.md:44-46,53,71-73` — shared-profile fork, absence of any service-role identity, asymmetric read/write actors
- `context/foundation/roadmap.md:100` — the unresolved Hiring-Manager-vs-Recruiter scope question (Owner: user; non-blocking)
- `context/archive/` contains only `README.md` — no archived changes exist yet

## Related Research

- `context/foundation/test-plan.md` §2 risks #1/#4/#5, §3 Phase 1, §6.4 (the TBD cookbook entry this phase fills)
- `context/changes/candidate-profile-and-cv-upload/research.md` — CV/storage authorization, relevant to test-plan Phase 3

## Resolved Decisions

Settled with the user on 2026-09-02. These are inputs to `/10x-plan`, not
open questions.

1. **Fixture expansion goes in `supabase/seed.sql`** — not per-test setup. It
   matches the existing pattern and keeps a single source of truth for
   principals. Because it changes the pristine baseline that every current
   integration test and e2e spec runs against, it becomes **Phase 1's first
   sub-phase**, with the full suite (`test`, `test:integration`, `test:e2e`)
   re-run green as its verification gate. New fixtures look groups up **by
   name**, never by identity id. Minimum content: a fourth group with
   HR-equivalent operations, a user in it, and a second recruitment scoped
   only to that group. The no-group user and the multi-group user are
   desirable in the same edit if they cost little.
2. **The two accepted weaknesses are pinned as current behaviour**, each with
   a comment citing the prior SKIPPED decision
   (`recruiter-creates-recruitment/reviews/impl-review.md:69-71`), so that a
   future change which widens or narrows the boundary fails visibly. Phase 1
   does **not** fix them. Separately, the `recruitment_security_groups`
   **DELETE** half — broad `has_operation('recruitment.write')` with no
   chicken-and-egg justification, letting any write-holder detach groups from
   a recruitment they cannot read — is **raised for the user's decision** and
   tracked as its own item; it is characterised by a test here, not repaired
   here.
3. **The note-gate bypass on `candidate_recruitments` UPDATE stays with Phase
   2.** It is flagged in this document and deliberately not asserted in Phase
   1, to keep the phases from overlapping.
4. **`rls_verification.sql` gets an npm script in Phase 1** (fixing the
   documented-broken `supabase db query -f` invocation in its header at
   `:9`), and Phase 4 makes it blocking in CI. This gives test-plan §5's
   "authorization suite green" gate something to reference without pulling
   gate-hardening forward.
5. **Phase 1 encodes today's coarse per-operation split.** `roadmap.md:100`
   (Hiring Manager vs Recruiter scope; Owner: user, non-blocking) stays open
   — the tests pin current behaviour and must not be read as resolving the
   product question. Expect to revisit these assertions when S-07 lands.
6. **Auditing the 33 existing SQL assertions for the tautology class**
   (`recruiter-customizes-kanban-stages/reviews/impl-review.md:29`) is a
   follow-up, not Phase 1 scope. Worth one note in the plan's epilogue: if an
   *isolation* assertion is tautological, the isolation proof is illusory.

## Open Questions

None blocking. Items 2 (the `recruitment_security_groups` DELETE gap) and 6
(SQL assertion audit) are tracked for later decision, and `roadmap.md:100`
remains the user's open product question.
