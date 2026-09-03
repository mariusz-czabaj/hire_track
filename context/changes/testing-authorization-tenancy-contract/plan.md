# Authorization and Tenancy Contract Implementation Plan

## Overview

Build a dedicated HTTP integration suite that proves the test plan's Phase 1
proposition: **a request authenticated as a non-member receives no rows and
produces no write effect across every domain endpoint.** Covers test-plan §2
risks **#1** (cross-group read/edit), **#4** (shared candidate profile leaking
per-recruitment PII), and **#5** (a principal lacking the write operation
succeeding at a write).

The suite cannot be written until a fixture gap is closed first: today's
non-member fixture is *also* unprivileged, so every denial it produces is
ambiguous. Phase 1 therefore opens with a seed change, and only then writes
assertions.

## Current State Analysis

Authorization lives **entirely in Postgres**. `src/middleware.ts:19-27` is an
authentication gate that returns 401 for unauthenticated API requests and
performs no group check. No API handler reads `locals.user` for authorization.
`src/lib/supabase.ts:6-23` is the sole client factory and is always
caller-scoped — there is no service-role client anywhere in `src/`, confirmed
by grep and by `astro.config.mjs:24-25` declaring only `SUPABASE_URL` and
`SUPABASE_KEY`. Every service function in `src/lib/services/**` takes
`client: Client` as its first parameter and never constructs one.

Consequently: asserting a 401 or a redirect proves nothing about tenancy, and
no test needs to chase a privileged bypass path.

**The database layer is already well covered; the HTTP layer is not.**
`supabase/tests/rls_verification.sql` is 1032 lines / 33 assertions and already
includes a cross-group isolation assertion (added because a review caught its
absence). But that script is wired into **no** npm script and **no** CI job, so
its assertions are advisory, and its in-file run command at `:9`
(`npx supabase db query --local -f …`) is documented-broken — it cannot run a
multi-statement script.

Existing HTTP coverage is three suites totalling 572 lines
(`recruitments/index`, `[id]/stages`, `[id]/candidates`). They cover happy paths
and some denials on **recruitments writes only** — which is precisely risk #5's
named anti-pattern ("testing one write endpoint and generalising").

**The blocking fixture gap.** `supabase/seed.sql:31-105` seeds three principals,
each in exactly one group, and exactly one recruitment:

| Principal | Group | Operations |
|---|---|---|
| `hr.test@example.com` | HR/Rekruter | `recruitment.read/write`, `candidate.read/write` |
| `hiring-manager.test@example.com` | Hiring Manager | `recruitment.read`, `candidate.read` |
| `admin.test@example.com` | Administrator | `group.manage` **only** |

The seed comment designates the Administrator as the cross-group-isolation
fixture, but it conflates two axes: holding no `recruitment.*` operation at all,
every denial it produces is explicable by lack of privilege alone. It cannot
distinguish "denied because not a member" from "denied because it lacks the
operation" — the exact proposition risk #1 exists to test.

## Desired End State

A new `src/pages/api/authorization.integration.test.ts` holds the project's
tenancy contract as one readable document, backed by an expanded seed with a
"same powers, wrong tenant" principal and a second recruitment. Running
`npm run test:integration` against a live stack proves, per endpoint, that a
non-member receives no rows and leaves no write effect — each write assertion
paired with a read-back by a legitimate member. `npm run test:rls` runs the 33
SQL assertions with a working command. Test-plan §6.4 is filled in and the §3
Phase 1 row reads `complete`.

Verify by: `npm run test`, `npm run test:integration`, `npm run test:e2e`, and
`npm run test:rls` all green; and by reading §6.4 and finding a named reference
test plus the recipe for constructing an out-of-group principal.

### Key Discoveries:

- **404 is the tenancy signal, not 403.** `updateRecruitmentStatus`
  (`src/lib/services/recruitments.ts:99`) uses
  `.update().eq(id).select().maybeSingle()`; an invisible row makes the update a
  silent no-op returning `null`, mapped to 404 at
  `src/pages/api/recruitments/[id]/index.ts:47`. The status code alone is not
  evidence of a data boundary — every assertion must pair it with a member
  read-back.
- **Risk #4 must be re-framed.** Org-wide candidate visibility is intentional
  and PRD-sourced (`prd.md:91` FR-007: profile shared, notes and status separate
  per recruitment). Testing that the shared fields don't leak is the plan's
  named anti-pattern.
- **`getCandidateDetail` is already recruitment-scoped**
  (`src/lib/services/candidates.ts:107` — `.eq("recruitment_id", recruitmentId)`),
  so per-recruitment fields are unreachable to a non-member *by construction*.
  The only HTTP-observable **shared**-profile surface is the `PA003`
  `candidate_name_mismatch` path in `add_candidate_to_recruitment`
  (`20260901210500_candidate_write_rpcs.sql:64-71`), which fires **after** the
  three authorization checks at `:37-46`. That is the positive half of the split.
- **Two grant tiers by design.** `private.has_operation(op)` is
  recruitment-independent; `private.has_recruitment_operation(id, op)` requires
  membership **and** the operation on the *same* group
  (`go.group_id = rsg.group_id`, `20260831195143_mark_rls_helpers_stable.sql:5-36`).
  No seed fixture is in two groups, so that conjunct has never been exercised.
- **"No policy" is the deny mechanism.** Table grants
  (`20260831183457_rls_policies.sql:234-244`) are narrowed to verbs that have
  policies, so e.g. `DELETE` on `recruitments` fails at the *grant* layer as
  `42501`, not via RLS. Assert the **effect** (no row change), never a specific
  SQLSTATE origin.
- **Harness constraints are non-obvious.** `integration-client.ts` needs
  `Origin: BASE_URL` (`:48`, Astro CSRF) and `redirect: "manual"` (`:47`, to read
  the 302's cookies). There is **no data reset of any kind** — no `beforeEach`,
  no truncation, no rollback. The discipline is create-your-own-fixture and
  never assert on global counts.
- **CI has three readiness gates**, each added after a real flake
  (`.github/workflows/ci.yml:51-99`): poll `/api/security-groups`, poll a second
  *distinct* route because Astro dev's Vite optimizer reloads dep bundles per
  route module graph, then a real curl sign-in retried until 200 because
  GoTrue/PostgREST clock skew yields `PGRST303`. **A new suite touching new
  route module graphs inherits this hazard.**
- **`validCreateBody()` uses `groupIds: [1]`**, relying on seed insertion order.
  New fixtures must look groups up **by name**, as `seed.sql` itself does.

## What We're NOT Doing

- **Not fixing the two accepted authorization weaknesses.** The unscoped
  `recruitment_security_groups` INSERT/DELETE
  (`20260831183457_rls_policies.sql:155-160`) and `create_recruitment`'s
  blanket-only check (`20260901150000_create_recruitment_returns_row.sql:26`)
  are pinned as current behaviour with a citation to the prior **SKIPPED**
  decision (`recruiter-creates-recruitment/reviews/impl-review.md:69-71`), not
  repaired. The DELETE half is raised separately for the user's decision.
- **Not asserting the note-gate bypass** on `candidate_recruitments` UPDATE
  (`20260901210500_candidate_write_rpcs.sql:4-7`). That is risk #6 and belongs to
  test-plan Phase 2; asserting it here would overlap the phases.
- **Not making `rls_verification.sql` blocking in CI.** That is Phase 4 gate
  hardening. Phase 1 only makes it runnable.
- **Not re-testing RLS in SQL.** The 33 existing assertions stay as they are;
  this phase covers what SQL impersonation structurally cannot reach.
- **Not auditing the 33 existing SQL assertions for the tautology class**
  (`recruiter-customizes-kanban-stages/reviews/impl-review.md:29`). Follow-up,
  noted in the epilogue.
- **Not resolving the Hiring Manager vs Recruiter scope question**
  (`roadmap.md:100`). Tests pin *today's* coarse split and must not be read as
  settling the product question.
- **No unit tests and no e2e specs.** Every assertion here needs a live database
  and a real session cookie; the browser crossing adds nothing.

## Implementation Approach

Five phases, ordered so that the destabilising change lands first and alone.

Phase 1 edits the pristine seed baseline that every existing integration test
and e2e spec runs against — so it ships by itself, with all three suites re-run
green as its only gate. Phases 2–4 then write assertions against a stable
fixture set. Phase 5 makes the SQL harness runnable and closes the cookbook.

All assertions live in **one dedicated cross-cutting suite**, deliberately
departing from cookbook §6.2's beside-the-route convention: the contract reads
as one document, per-endpoint rows sit side by side so a missing verb is
visible, and §6.4 gets a single reference file. §6.2 gains an explicit carve-out
in Phase 5.

## Critical Implementation Details

**Ordering & lifecycle.** The seed has no reset between tests and rows
accumulate, so a second recruitment must not disturb existing assertions. E2E
specs already PATCH freshly created recruitments off `draft` to avoid polluting
filter assertions (`tests/e2e/candidates.spec.ts:6-33`) — the new seeded
recruitment must pick a status that keeps those filters intact, and no new
assertion may depend on a global count.

**Route module graphs.** The suite is the first integration coverage to touch
`/api/recruitments/[id]/board`, `.../candidates/[candidateId]/notes`, and
`/api/security-groups`. Each is a distinct Vite dependency graph in Astro dev.
The CI readiness block must gain a probe for a route from the new graph, or the
suite's first test will race the optimizer exactly as three prior flakes did.

## Phase 1: Seed Fixtures and Harness Principals

### Overview

Close the fixture gap: add a principal with the *same powers as HR but in a
different tenant*, a recruitment only that principal can see, a principal in no
group at all, and a principal in two groups. This is the only phase that changes
the baseline every other test runs against, so it ships alone.

### Changes Required:

#### 1. Seed data

**File**: `supabase/seed.sql`

**Intent**: Add the four principals research identified as (a)–(d) plus a second
recruitment, so that isolation becomes symmetrical and provable rather than
merely coincident with lack of privilege. Update the stale block comment at
`:26-30` that designates the Administrator as the isolation fixture — that
claim is what misled the existing assertions.

**Contract**:
- A fourth group with operations **identical** to `HR/Rekruter`
  (`recruitment.read`, `recruitment.write`, `candidate.read`, `candidate.write`)
  — the "same powers, wrong tenant" tier. Name it distinctly from the three PRD
  example groups so it reads as a test fixture, not product config.
- Four new `auth.users` + matching `auth.identities` rows, following the
  existing `extensions.crypt('password123', extensions.gen_salt('bf'))` pattern
  and the fixed-UUID convention (`4444…`, `5555…`, `6666…`): one member of the
  fourth group; one in **no** group; one in **both** `HR/Rekruter` and the
  fourth group (the multi-group principal); and — for the
  `go.group_id = rsg.group_id` conjunct specifically — a principal whose
  write-holding group is *not* attached to the recruitment while its
  read-holding group is.
- A second `recruitments` row linked via `recruitment_security_groups` to the
  fourth group **only**. Its `status` must not perturb
  `tests/e2e/candidates.spec.ts`'s filter assertions.
- At least one `candidates` row linked to the second recruitment via
  `candidate_recruitments`, plus its initial
  `candidate_recruitment_status_history` row, mirroring the existing pattern at
  `:107-141`. Needed for the risk #4 split.
- **All group and stage lookups by name** (`select id from security_groups where
  name = …`), never by literal id.

**Note on the multi-group requirement**: exercising the same-group conjunct
requires a principal holding the operation in group A and membership of
attached group B where A is *not* attached. Satisfying both (c) and (d) may need
the two users listed above rather than one; resolve during implementation and
keep the group→operation→attachment mapping in a comment, because the predicate
is not readable from the seed rows alone.

#### 2. Harness principals

**File**: `src/lib/test-support/integration-client.ts`

**Intent**: Expose the new principals to tests through the existing sign-in
harness, so no test forges a cookie or invents a second harness.

**Contract**: Extend the `SEEDED_CREDENTIALS` map (`:18-22`) with one key per new
principal; `SeededRole` widens automatically via `keyof typeof`. Keys should name
the *authorization role in the contract* (the tenant-peer principal, the
no-group principal, the multi-group principal), not the person — the test bodies
read as propositions about principals. No other change: the sign-in flow,
`Origin` header, and `redirect: "manual"` behaviour stay as they are.

#### 3. Existing-suite fallout

**File**: `src/pages/api/recruitments/index.integration.test.ts` (and the other
two suites if affected)

**Intent**: Repair any assertion that breaks because a second recruitment or new
groups now exist — and replace the ordinal `groupIds: [1]` dependency with a
by-name lookup so the fixture set can grow again without breaking it.

**Contract**: `validCreateBody()`'s `groupIds` resolved from
`GET /api/security-groups` by group name rather than hardcoded `[1]`. Any
assertion depending on recruitment count or list ordering becomes
count-independent (filter for the row under test rather than indexing).

### Success Criteria:

#### Automated Verification:

- Local database reset applies the new seed cleanly: `npx supabase db reset --local`
- Unit tests pass: `npm run test`
- Integration tests pass unchanged in meaning: `npm run test:integration`
- E2E tests pass: `npm run test:e2e`
- Existing SQL assertions still pass against the expanded seed: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_verification.sql`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- Signing in as the new tenant-peer principal in a browser shows exactly one recruitment, and it is not `Backend Engineer`
- The no-group principal reaches `/dashboard` but sees no recruitments and no candidates
- The seed's block comment no longer claims the Administrator is the cross-group-isolation fixture

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase. This phase
changes the baseline for every other test in the repository; do not layer new
assertions on an unverified fixture set.

---

## Phase 2: Read Boundary Suite

### Overview

Create the dedicated suite and establish the read half of the contract:
symmetrical cross-group invisibility, the risk #4 shared-vs-per-recruitment
split in **both** directions, the multi-group predicate branch, and the
no-group floor case.

### Changes Required:

#### 1. The authorization contract suite

**File**: `src/pages/api/authorization.integration.test.ts` (new)

**Intent**: Hold the whole tenancy contract as one document, organised by
proposition rather than by route, so a reviewer can see every boundary at once
and spot a missing endpoint.

**Contract**: A top-level describe per risk (`#1 cross-group read`, `#4 shared
profile split`), each containing named `it` blocks whose titles state the
proposition in user terms. Sessions obtained via
`signInIntegrationClient(role)`; no forged cookies. No `beforeEach` truncation —
fixtures are the seeded rows plus anything the test creates itself. No assertion
on a global count.

**Read assertions to establish:**

- **Symmetrical invisibility.** The HR principal's `GET /api/recruitments` does
  not contain the second recruitment; the tenant-peer principal's does not
  contain `Backend Engineer`. Both directions, because a bug that hides
  everything from everyone would pass a one-directional test — the tautology
  class a prior review already caught in this repo
  (`recruiter-customizes-kanban-stages/reviews/impl-review.md:29`).
- **Per-resource invisibility.** For the tenant-peer principal against
  `Backend Engineer`: `GET /api/recruitments/[id]` (via the list plus the
  detail route as applicable), `GET .../board`, `GET .../stages`, and
  `GET .../candidates/[candidateId]` each return 404 — and the matching request
  by the HR principal returns 200 with data, so the 404 is attributable to
  tenancy rather than to a broken route.
- **The no-group floor case.** The no-group principal is authenticated (not 401)
  yet receives an empty recruitment list and 404 on every scoped resource —
  `prd.md:117` ("no candidate data is available to an unauthorized user").
- **The multi-group conjunct.** The multi-group principal gets **read** on the
  recruitment attached to its read-holding group, and its write-holding group
  being unattached does **not** confer write there. This is the
  `go.group_id = rsg.group_id` branch, never previously exercised. Note in a
  comment which group supplies which half, since the predicate is invisible from
  the request alone.
- **Risk #4, the negative half.** A principal holding `candidate.read` who is
  not a member of recruitment R sees **zero** notes, **zero** status history, and
  no stage or `added_at` from R. Because `getCandidateDetail` is already scoped
  by `recruitment_id` (`candidates.ts:107`), the observable form is a 404 on the
  candidate-detail and board routes for R — assert that, and state in a comment
  *why* it is a 404 rather than a filtered payload, so a future reader does not
  mistake it for a missing-row bug.
- **Risk #4, the positive half.** The tenant-peer principal — a member of its
  own recruitment, holding `candidate.write`, and **not** a member of
  `Backend Engineer` — POSTs a candidate whose email already exists under a
  different name on `Backend Engineer`, and receives `422
  candidate_name_mismatch` (`PA003`). This is the **intended** shared-profile
  behaviour and the only HTTP-observable proof that identity is org-wide while
  per-recruitment fields are not. The comment must record that `PA003` fires
  *after* the three authorization checks
  (`20260901210500_candidate_write_rpcs.sql:37-46,64-71`), so the leak is bounded
  to callers who already hold write on some recruitment — and that this is
  PRD-sourced (`prd.md:91` FR-007), not a defect.
- **The unfiltered group list, pinned.** `GET /api/security-groups` returns the
  full list to any authenticated principal, including the no-group one, because
  `security_groups_select` is `using (true)` and FR-001a needs the list at
  creation time (`core-recruitment-data-foundation/plan.md:163`). Assert the
  expected group names explicitly rather than leaving it implicit — group names
  are organisational metadata, and an intentional exposure deserves a visible
  pin so an *unintentional* widening elsewhere is caught.

#### 2. CI readiness probe

**File**: `.github/workflows/ci.yml`

**Intent**: Extend the existing readiness block for the new route module graphs
this suite is the first to load, preventing a repeat of the three prior
optimizer flakes.

**Contract**: Add a poll loop in the same shape as the two at `:57-73`, for a
route in a graph none of the current probes touch (the board or notes route).
Keep the existing no-`-f` convention — any HTTP response, including 401/404,
means ready. Add a comment naming *which* graph it covers and why, matching the
density of the comments already there.

### Success Criteria:

#### Automated Verification:

- The new suite passes: `npm run test:integration`
- Every pre-existing suite still passes: `npm run test:integration`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- Each `it` title states a proposition about a principal, not a route — readable as a contract without opening the body
- Every 404 assertion has a paired positive-case assertion by a legitimate member in the same block
- The risk #4 positive case carries a comment citing FR-007, so a future reader cannot mistake it for a bug being enshrined

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 3: Write Surface

### Overview

Establish the write half of the contract: **all seven** write verbs asserted
against the non-member principal, each paired with a member read-back proving no
write effect — directly refuting risk #5's anti-pattern of testing one endpoint
and generalising. Plus the three TypeScript-only pre-checks that SQL
impersonation structurally cannot reach.

### Changes Required:

#### 1. Per-verb non-member write denial

**File**: `src/pages/api/authorization.integration.test.ts`

**Intent**: Prove that every write endpoint denies a non-member *and* leaves
persisted state unchanged, enumerated per verb so a newly added endpoint's
absence is visible.

**Contract**: A table-driven block covering exactly these seven verbs, so the
enumeration itself is reviewable:

| Verb | Route |
|---|---|
| `POST` | `/api/recruitments` |
| `PATCH` | `/api/recruitments/[id]` |
| `PUT` | `/api/recruitments/[id]/stages` |
| `DELETE` | `/api/recruitments/[id]/stages` |
| `POST` | `/api/recruitments/[id]/candidates` |
| `PATCH` | `/api/recruitments/[id]/candidates/[candidateId]` |
| `PUT` | `/api/recruitments/[id]/candidates/[candidateId]/notes` |

Each row asserts, as the tenant-peer principal against `Backend Engineer`:
a non-2xx response, **and** a read-back by the HR principal showing the target
resource unchanged. Assert the **effect**, not a SQLSTATE origin — denial arrives
variously from RLS, from a narrowed table grant (`42501` at the grant layer,
`20260831183457_rls_policies.sql:234-244`), and from an RPC's explicit `raise`,
and the response shape differs accordingly (404 for scoped no-ops via
`maybeSingle()`, 403 via `handleCandidateRpcError`
(`src/lib/api/candidate-errors.ts:9-27`) and `handleStageRpcError`
(`stages.ts:25-38`)). Record the expected status per row in the table and add a
comment explaining that the variation is by design — a reader who "normalises"
these to one code would be encoding the wrong mechanism.

`POST /api/recruitments` is the one row where the tenant-peer principal
legitimately succeeds (it holds blanket `recruitment.write`); assert the
**no-group** principal's denial there instead, and comment why the principal
differs for this row — otherwise the row looks like an inconsistency.

#### 2. Read-only principal denials

**File**: `src/pages/api/authorization.integration.test.ts`

**Intent**: Pin the second denial axis — sufficient tenancy, insufficient
operation — so it is never again conflated with non-membership.

**Contract**: The hiring-manager principal (`recruitment.read` + `candidate.read`,
and a genuine member of `Backend Engineer`) is denied the write verbs on that
recruitment, with the state read-back as above. Cover the candidate and stage
writes at minimum; the recruitments-write rows already exist in
`index.integration.test.ts` and should be cross-referenced in a comment rather
than duplicated.

#### 3. Service-layer pre-checks

**File**: `src/pages/api/authorization.integration.test.ts`

**Intent**: Cover the three scope checks that exist **only** in TypeScript and
are therefore invisible to the SQL harness — the highest-value HTTP-only
assertions in the phase. They guard a mismatched `[id]` URL segment: a caller
with legitimate write on recruitment X addressing a candidate row belonging to
recruitment Y.

**Contract**: As the HR principal, holding real write on its own recruitment,
issue requests whose `[id]` and `[candidateId]` belong to *different*
recruitments, and assert the pre-check rejects them:
- `PATCH .../candidates/[candidateId]` — `moveCandidateStage`'s `id` +
  `recruitment_id` scoping (`candidates.ts:54-67`), which exists because the RPC
  resolves its own recruitment from `candidateRecruitmentId`.
- `PUT .../candidates/[candidateId]/notes` — the same pre-check in
  `upsertCandidateNote` (`candidates.ts:187-199`).
- A `stageId` from another recruitment's resolved stage set — the synthetic
  `22023` at `candidates.ts:216-222`, added after a review found
  cross-recruitment stage confusion
  (`recruiter-manages-candidate-status/reviews/impl-review.md:62`).

Also assert that a note's author is the session user and not a request-body
value: `UpsertCandidateNoteCommand` carries no author field (`src/types.ts:99`)
and `created_by` is derived from the session (`candidates.ts:202-208`). Send an
author-shaped extra field and assert the stored note's `authorEmail` is the
caller's — this pins an invariant that would otherwise be one careless schema
addition away from breaking.

Finally, one assertion for the known gap that `move_candidate_stage` does not
verify `to_stage_id` belongs to the recruitment's stage set: a foreign
**override** stage is caught by the `BEFORE UPDATE` consistency trigger
(`20260901161434_kanban_stage_customization.sql:54-74`, `22023`), while a
**global default** stage id is accepted unconditionally. Pin whichever behaviour
is current for each, labelled as characterization.

### Success Criteria:

#### Automated Verification:

- The full suite passes: `npm run test:integration`
- Unit tests pass: `npm run test`
- E2E tests pass (the suite creates real rows against the shared local stack): `npm run test:e2e`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- All seven write verbs appear as distinct table rows; no verb is covered "by generalisation"
- Every denial row has a paired state read-back, not just a status-code assertion
- The two rows whose principal differs from the default (`POST /api/recruitments`, and the read-only axis) carry comments explaining why
- The expected-status variation across rows is explained in a comment as mechanism-dependent, not normalised away

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 4: Characterization of Accepted Weaknesses

### Overview

Pin today's permissive behaviour on the two known-and-accepted authorization
weaknesses, so that a future change moving the boundary in **either** direction
fails visibly. This phase characterises; it does not repair.

### Changes Required:

#### 1. Unscoped group assignment, pinned

**File**: `src/pages/api/authorization.integration.test.ts`

**Intent**: Encode that a `recruitment.write` holder can create a recruitment
scoped to a group it does not belong to, and can attach or detach groups on a
recruitment it cannot read — the current, deliberately-accepted behaviour.

**Contract**: A clearly separated `describe` block whose title marks it as
characterization of accepted behaviour, **not** a specification. Two
propositions:

- **INSERT half.** The tenant-peer principal `POST /api/recruitments` with
  `groupIds` naming a group it is not a member of, and the request succeeds —
  because `create_recruitment` checks only the blanket operation without
  validating membership in `p_group_ids`
  (`20260901150000_create_recruitment_returns_row.sql:26`). Comment must cite the
  chicken-and-egg justification: a creator cannot be scoped to a recruitment that
  does not yet exist.
- **DELETE half — plan premise corrected during implementation.** The plan
  originally expected this to be permitted, on the reasoning that
  `recruitment_security_groups`' INSERT and DELETE both use the broad
  `has_operation('recruitment.write')` (`20260831183457_rls_policies.sql:155-160`)
  with no membership check. Running the assertion against the real database
  showed it does **not** reproduce: PostgreSQL implicitly ANDs a table's
  `SELECT` policy into `UPDATE`/`DELETE` (a row must be visible to be
  targeted), and `recruitment_security_groups_select` **is** scoped to
  `has_recruitment_operation(id, 'recruitment.read')` — confirmed via
  `EXPLAIN ANALYZE`, whose filter shows the SELECT policy's predicate ANDed
  into the DELETE. So the DELETE half is safe today; only the INSERT half
  reproduces the accepted gap. The test now pins the corrected, verified
  behaviour (0 rows deleted, scoping unchanged) instead of the originally
  planned permissive one, with a comment recording why the original premise
  was wrong. See the epilogue note below.

Each block cites `recruiter-creates-recruitment/reviews/impl-review.md:69-71`
("**Decision: SKIPPED** — consistent with existing design, not a regression") so
the provenance of the acceptance is in the code, not only in this plan.

The DELETE characterization mutates seeded scoping. Because the harness has no
reset, it must operate on a recruitment the test creates itself, never on
`Backend Engineer` — detaching a seeded group would silently break Phase 2's and
Phase 3's assertions and the e2e suite.

### Success Criteria:

#### Automated Verification:

- The full suite passes: `npm run test:integration`
- E2E tests still pass, proving the characterization mutations did not disturb seeded scoping: `npm run test:e2e`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- The characterization block's title and comments make it unmistakable that a passing test documents current behaviour rather than endorsing it
- The INSERT half cites the prior SKIPPED decision by path and line
- The DELETE half's comment records that the plan's original premise (permitted) was wrong, explains the SELECT-policy-into-DELETE combination that closes the gap, and cites the EXPLAIN ANALYZE finding
- The mutations touch only test-created recruitments

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 5: Runnability and Cookbook

### Overview

Make the 33 existing SQL assertions runnable with one command, and close the
phase by filling test-plan §6.4 so the next person adding an authorization test
has a recipe rather than a precedent to reverse-engineer.

### Changes Required:

#### 1. SQL harness npm script

**File**: `package.json`

**Intent**: Give test-plan §5's "authorization suite green" gate something to
reference, without pulling Phase 4 gate-hardening forward.

**Contract**: A `test:rls` script running the SQL harness through the invocation
that actually works —
`docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_verification.sql`
(`core-recruitment-data-foundation/plan.md:217`). Note in the plan epilogue that
the container name is environment-specific, which is part of why making this
blocking in CI is deferred to test-plan Phase 4.

#### 2. Fix the documented-broken run command

**File**: `supabase/tests/rls_verification.sql`

**Intent**: Remove a header comment that has already misled readers.

**Contract**: Replace the `npx supabase db query --local -f …` recommendation at
`:9` with `npm run test:rls`, and state in one line why the `db query -f` form
cannot work ("cannot insert multiple commands into a prepared statement"), so
nobody reintroduces it. No assertion changes.

#### 3. Cookbook §6.4 and §6.2 carve-out

**File**: `context/foundation/test-plan.md`

**Intent**: Convert the §6.4 placeholder into the canonical recipe, and record
the deliberate departure from §6.2's convention.

**Contract**: §6.4 gains **Location** (the one cross-cutting suite, with the
reason), **Naming**, **Reference test**
(`src/pages/api/authorization.integration.test.ts`), **Run locally**
(`npm run test:integration`, plus `npm run test:rls` for the database layer), and
the pattern itself: *how to construct a principal outside the assigned security
group* — name the tenant-peer principal, state that it holds HR-equivalent
operations so a denial is attributable to tenancy rather than privilege, and
state the paired-read-back rule (a status code alone is not evidence of a data
boundary). §6.2 gains one line noting that cross-cutting authorization
assertions live in the dedicated suite rather than beside the route, and why.
Bump the §8 freshness date.

#### 4. Rollout status

**File**: `context/foundation/test-plan.md`, `context/changes/testing-authorization-tenancy-contract/change.md`

**Intent**: Reflect completion so the orchestrator advances to Phase 2.

**Contract**: §3 Phase 1 row Status → `complete`. `change.md` frontmatter
`status` → `implemented`, `updated` → the completion date.

### Success Criteria:

#### Automated Verification:

- `npm run test:rls` runs the harness and all 33 assertions pass
- The full test suite passes: `npm run test && npm run test:integration && npm run test:e2e`
- Linting passes: `npm run lint`
- Formatting is clean: `npm run format`

#### Manual Verification:

- §6.4 answers "how do I add an authorization test for a new endpoint?" without needing to read this plan
- §6.4 names the out-of-group principal construction recipe and the paired-read-back rule explicitly
- The SQL file's header no longer recommends a command that cannot work
- §3 Phase 1 reads `complete`

**Implementation Note**: This is the final phase. After automated verification
passes, pause for manual confirmation, then the change is ready for
`/10x-impl-review` and `/10x-archive`.

---

## Testing Strategy

This change *is* tests, so the strategy is about how the new assertions are
themselves trustworthy.

### Unit Tests:

None added. Every proposition here requires a live database and a real session
cookie; a stubbed client would remove the only signal these assertions exist to
give (cookbook §6.2's mocking policy).

### Integration Tests:

The whole deliverable. Non-negotiable properties:

- **Every denial is paired with a state read-back by a legitimate member.** A
  status code alone is not evidence of a data boundary — 404 is the deliberate
  tenancy signal for scoped reads and updates.
- **Every isolation assertion is symmetrical.** A one-directional test passes
  when a bug hides data from everyone. This exact tautology class has already
  been caught once in this repo (`UPDATE 0` and `UPDATE 1` both passing,
  `recruiter-customizes-kanban-stages/reviews/impl-review.md:29`).
- **Assert effects, never SQLSTATE origins.** Denial arrives from RLS, from a
  narrowed grant, or from an RPC `raise`, and which one is an implementation
  detail.
- **The oracle comes from the PRD, not the implementation.** Expected error
  identifiers must be justified by an FR or a documented decision, not copied
  out of the code under test.
- **No global-count assertions and no `beforeEach` truncation.** The harness has
  no reset by design; tests create their own fixtures.

### Manual Testing Steps:

1. `npx supabase start`, then `npx supabase db reset --local`, then `npm run dev`.
2. Sign in as the tenant-peer principal; confirm exactly one recruitment is
   visible and it is not `Backend Engineer`. Sign in as the HR principal; confirm
   the converse.
3. Sign in as the no-group principal; confirm `/dashboard` loads but exposes no
   recruitments and no candidates.
4. `npm run test:integration` and `npm run test:rls`.
5. Deliberately weaken one policy locally (e.g. broaden a `recruitments` SELECT
   predicate), re-run the suite, and confirm it **fails**. A green authorization
   suite that cannot fail is worse than no suite; this is the one check that the
   assertions have teeth.
6. Revert the weakening; confirm green.

## Performance Considerations

The suite adds roughly 25–35 HTTP round-trips against a live local stack, each
preceded by a sign-in. Sign-ins dominate: obtain one client per principal at
`describe` scope and reuse it rather than signing in per `it`. If CI runtime
becomes a concern, the table-driven write block is the place to parallelise —
but not before Phase 4 makes the gate blocking, since a flaky-but-advisory suite
teaches people to ignore it.

## Migration Notes

The seed change is local/dev-only; `supabase/seed.sql` runs on
`supabase db reset` and is never applied to a real environment via `db push`.
No production data is affected and there is no migration to write. Rollback is
`git revert` plus `npx supabase db reset --local`.

The one real coordination cost: anyone with a local stack must re-run
`npx supabase db reset --local` after Phase 1 lands, or their integration and
e2e runs will fail against the old fixture set. Worth a line in the Phase 1
commit message.

## References

- Related research: `context/changes/testing-authorization-tenancy-contract/research.md`
- Quality contract: `context/foundation/test-plan.md` §2 risks #1/#4/#5, §3 Phase 1, §5, §6.4
- Mandated harness: `src/lib/test-support/integration-client.ts:15-72`
- Reference integration test: `src/pages/api/recruitments/index.integration.test.ts`
- SQL harness: `supabase/tests/rls_verification.sql:1-1032`
- RLS helpers: `supabase/migrations/20260831195143_mark_rls_helpers_stable.sql:5-36`
- All policies and grants: `supabase/migrations/20260831183457_rls_policies.sql:69-244`
- Accepted weakness, decision SKIPPED: `context/changes/recruiter-creates-recruitment/reviews/impl-review.md:69-71`
- "An assertion would have caught F1": `context/changes/recruiter-manages-candidate-status/reviews/impl-review.md:92`
- CI readiness gates: `.github/workflows/ci.yml:51-99`

## Epilogue Notes (for `/10x-impl-review` and archive)

- **Correction to the plan's own premise, found during Phase 4**: the
  `recruitment_security_groups` **DELETE** half was expected to be an
  unpatched weakness — broad `has_operation('recruitment.write')` with no
  chicken-and-egg justification, letting any write-holder detach groups from
  a recruitment they cannot read (`20260831183457_rls_policies.sql:155-160`).
  It does not reproduce: PostgreSQL implicitly ANDs the table's `SELECT`
  policy (`recruitment_security_groups_select`, scoped to
  `has_recruitment_operation(id, 'recruitment.read')`) into `DELETE`, closing
  the gap. Confirmed via `EXPLAIN ANALYZE` on the live database, not by
  reading the DELETE policy in isolation. Only the **INSERT** half
  (`create_recruitment` skipping group-membership validation) remains a live,
  accepted weakness — still tracked per the prior SKIPPED decision. No
  further action needed on the DELETE half; Phase 4's test now pins the
  verified-safe behaviour instead of the originally planned permissive one.
- **Follow-up, out of scope**: audit the 33 existing SQL assertions for the
  tautology class (`recruiter-customizes-kanban-stages/reviews/impl-review.md:29`).
  If an *isolation* assertion is tautological, the isolation proof is illusory —
  which would undercut the confidence this phase claims to establish.
- **`test:rls` is not blocking in CI** and its `docker exec` container name is
  environment-specific. Test-plan §3 Phase 4 owns hardening it.
- **These assertions pin today's coarse per-operation split.** `roadmap.md:100`
  (Hiring Manager vs Recruiter scope; Owner: user, non-blocking) stays open —
  expect to revisit when S-07 lands. A green suite here does not resolve that
  product question.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Seed Fixtures and Harness Principals

#### Automated

- [x] 1.1 Local database reset applies the new seed cleanly — 7b70363
- [x] 1.2 Unit tests pass — 7b70363
- [x] 1.3 Integration tests pass unchanged in meaning — 7b70363
- [x] 1.4 E2E tests pass — 7b70363
- [x] 1.5 Existing SQL assertions still pass against the expanded seed — 7b70363
- [x] 1.6 Linting passes — 7b70363
- [x] 1.7 Type checking passes — 7b70363

#### Manual

- [x] 1.8 Tenant-peer principal sees exactly one recruitment, and it is not Backend Engineer — 7b70363
- [x] 1.9 No-group principal reaches /dashboard but sees no recruitments and no candidates — 7b70363
- [x] 1.10 Seed block comment no longer claims the Administrator is the isolation fixture — 7b70363

### Phase 2: Read Boundary Suite

#### Automated

- [x] 2.1 The new suite passes — 01b22fd
- [x] 2.2 Every pre-existing suite still passes — 01b22fd
- [x] 2.3 Linting passes — 01b22fd
- [x] 2.4 Type checking passes — 01b22fd

#### Manual

- [x] 2.5 Each `it` title states a proposition about a principal, not a route — 01b22fd
- [x] 2.6 Every 404 assertion has a paired positive-case assertion by a legitimate member — 01b22fd
- [x] 2.7 The risk #4 positive case cites FR-007 so it cannot be mistaken for enshrining a bug — 01b22fd

### Phase 3: Write Surface

#### Automated

- [x] 3.1 The full suite passes — 1cbcfa1
- [x] 3.2 Unit tests pass — 1cbcfa1
- [x] 3.3 E2E tests pass — 1cbcfa1
- [x] 3.4 Linting passes — 1cbcfa1
- [x] 3.5 Type checking passes — 1cbcfa1

#### Manual

- [x] 3.6 All seven write verbs appear as distinct table rows — 1cbcfa1
- [x] 3.7 Every denial row has a paired state read-back — 1cbcfa1
- [x] 3.8 Rows whose principal differs from the default carry comments explaining why — 1cbcfa1
- [x] 3.9 Expected-status variation is explained as mechanism-dependent, not normalised — 1cbcfa1

### Phase 4: Characterization of Accepted Weaknesses

#### Automated

- [x] 4.1 The full suite passes
- [x] 4.2 E2E tests still pass, proving seeded scoping was not disturbed
- [x] 4.3 Linting passes
- [x] 4.4 Type checking passes

#### Manual

- [x] 4.5 Characterization block makes clear a passing test documents a weakness, not an endorsement
- [x] 4.6 Both halves cite the prior SKIPPED decision by path and line
- [x] 4.7 The DELETE half records that it lacks the INSERT half's justification and is open for decision
- [x] 4.8 Mutations touch only test-created recruitments

### Phase 5: Runnability and Cookbook

#### Automated

- [ ] 5.1 `npm run test:rls` runs the harness and all 33 assertions pass
- [ ] 5.2 The full test suite passes
- [ ] 5.3 Linting passes
- [ ] 5.4 Formatting is clean

#### Manual

- [ ] 5.5 §6.4 answers "how do I add an authorization test for a new endpoint?" standalone
- [ ] 5.6 §6.4 names the out-of-group principal recipe and the paired-read-back rule
- [ ] 5.7 The SQL file's header no longer recommends a command that cannot work
- [ ] 5.8 §3 Phase 1 reads `complete`
