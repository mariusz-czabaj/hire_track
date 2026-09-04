# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-02

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in `<area>`"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`, `tests/`
(33 commits in the last 30 days — sufficient signal).

Caveat on evidence quality: the Phase 2 interview was declined (three
consecutive skips). Every risk below is sourced from documents and churn
only. Principle #2 has no input in this revision — the first `--refresh`
should re-open the interview.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                          | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------ | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A user reads or edits a recruitment belonging to a security group they are not a member of       | High   | High       | PRD FR-001a `prd.md:81`; must-not `prd.md:46,117`; roadmap F-01 RLS `roadmap.md:44,78,80`; hot-spot dirs `src/pages/api` (19 commits/30d), `src/lib/services` (18), `supabase/tests/` (9)                       |
| 2   | A CV upload reports success but the file is unretrievable, or a disallowed type/size is accepted | High   | High       | PRD FR-012 and "file loss unacceptable" `prd.md:47,97`; Worker-proxy upload failure class `infrastructure.md:65,84,102`; slice `candidate-profile-and-cv-upload` at 9/43 with all upload verification unchecked |
| 3   | An expired CV is still downloadable, or retention silently never runs                            | High   | High       | PRD FR-013a `prd.md:100,119`; byte deletion is manual with no scheduler by explicit decision `candidate-profile-and-cv-upload/change.md:24-27`; `has_background_jobs: false` `tech-stack.md:19`                 |
| 4   | A shared candidate profile exposes PII from a recruitment the viewer cannot see                  | High   | Medium     | PRD shared-entity model `prd.md:90-92`; hot-spot dir `src/lib/services` (18 commits/30d)                                                                                                                        |
| 5   | A principal lacking the write operation succeeds at a write (read-only Hiring Manager)           | High   | Medium     | PRD roles `prd.md:26-32,136-139`; unresolved authz boundary `roadmap.md:100`; admin UI deferred and groups hand-seeded `roadmap.md:51,174`                                                                      |
| 6   | A stage move persists without the required per-stage interview note                              | High   | Medium     | PRD hard gate `prd.md:123-125`; business rule revised mid-flight, Reading A superseded by Reading B `recruiter-manages-candidate-status/change.md:14-28`                                                        |

Risks #1, #4, #5 are the abuse lens (authorization / IDOR — does the request
check _membership and operation_, not merely _authentication_?). Risk #2
carries the untrusted-input and resource-abuse lens (server-side MIME and
size parity). Risk #3 is PII retention, GDPR-adjacent.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                  | Must challenge                                                                                                    | Context `/10x-research` must ground                                                                                                  | Likely cheapest layer                               | Anti-pattern to avoid                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| #1   | A request authenticated as a non-member receives no rows and produces no write effect — not merely a redirect or a 403 page                                  | "The middleware redirects unauthenticated users, therefore the API is protected"                                  | Where group membership is resolved on a request; whether any code path uses a privileged client that bypasses row-level scoping      | Integration (HTTP against live database)            | Asserting the redirect or status code instead of the data boundary and the absence of a write                                     |
| #2   | An upload the API reported successful is afterwards retrievable byte-for-byte; oversize and wrong-MIME uploads are refused server-side, not only in the form | "The signed URL returned 200, therefore the object exists"; "the client validated the type"                       | The two-phase signed-upload contract and where MIME and size are actually enforced; what state a half-completed upload leaves behind | Integration, plus one e2e over the real upload flow | Mocking storage — the failure this risk describes lives precisely at that boundary                                                |
| #3   | A CV past its expiry is refused at read time, and the purge operation is idempotent and leaves the tombstone row intact                                      | "The trigger sets the expiry column, therefore access stops"; "purge ran once, so it is correct"                  | Where the read-time expiry check happens; tombstone semantics after byte deletion; how time is controlled in a test                  | Integration with controlled clock                   | Asserting the stored expiry value instead of the access decision it is supposed to drive                                          |
| #4   | A candidate visible through one recruitment does not leak notes, status, or CV belonging to another recruitment the viewer cannot see                        | "The candidate profile is a shared entity, so full visibility of it is correct"                                   | Which fields are per-recruitment versus shared; the join shape used to assemble a profile                                            | Integration                                         | Exercising only the shared fields, where by construction no leak is possible                                                      |
| #5   | A principal holding read-only grants is denied every write operation, checked per operation rather than per role                                             | "Roles are coarse today, so this is future work"                                                                  | The operation enum and how a grant is resolved for a request                                                                         | Integration                                         | Testing one write endpoint and generalising the result to the rest                                                                |
| #6   | A move out of a stage without a non-blank note on _that_ stage is rejected and leaves persisted state unchanged                                              | "A 422 was returned, therefore nothing was written"; "one note per candidate suffices" (the superseded Reading A) | That the RPC is the sole stage-write path; the note uniqueness key under Reading B                                                   | Integration, plus unit on the guard                 | Copying the expected error identifier out of the implementation under test — the oracle must come from the PRD rule, not the code |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                         | Goal (one line)                                                                                           | Risks covered | Test types                               | Status      | Change folder                                             |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------- | ----------- | --------------------------------------------------------- |
| 1   | Authorization and tenancy contract | Prove a non-member gets no data and no write effect across every domain endpoint                          | #1, #4, #5    | integration (HTTP against live database) | complete    | `context/changes/testing-authorization-tenancy-contract/` |
| 2   | Business-rule gates                | Prove the per-stage note gate holds server-side and a blocked move writes nothing                         | #6            | integration + unit                       | not started | —                                                         |
| 3   | CV lifecycle and retention         | Prove uploads are retrievable, bad input is refused, expired CVs are unreachable, and purge is idempotent | #2, #3        | integration + one e2e                    | not started | —                                                         |
| 4   | Gate hardening                     | Make the new suites required gates rather than optional, and consolidate §6                               | cross-cutting | gates                                    | not started | —                                                         |

Ordering note: Phase 3 must not open until the `candidate-profile-and-cv-upload`
slice reaches full Progress. Testing its unbuilt phases would be
speculative, and the orchestrator should hold Phase 3 at `not started`
until then.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

Test-base profile: **sparse**. All three runners are configured and wired
into CI, but the 13 existing test files cluster on the recruitments,
stages, and candidates feature. Auth, middleware, authorization through the
running application, and the CV lifecycle are bare.

| Layer                  | Tool                                            | Version | Notes                                                                                                                                                    |
| ---------------------- | ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit                   | Vitest                                          | ^3      | jsdom + Testing Library; `npm run test`                                                                                                                  |
| integration            | Vitest (separate config)                        | ^3      | Runs HTTP against a live local Supabase; `npm run test:integration`                                                                                      |
| e2e                    | Playwright                                      | ^1      | Chromium, database reset to pristine seed before the run; `npm run test:e2e`                                                                             |
| database policy checks | SQL verification script under `supabase/tests/` | n/a     | Exercises row-level policies directly, outside the application                                                                                           |
| API mocking            | none                                            | n/a     | Deliberate — integration tests run against the real database, not a mock                                                                                 |
| accessibility          | none yet                                        | n/a     | `eslint-plugin-jsx-a11y` covers static rules only; no runtime axe check                                                                                  |
| (optional) AI-native   | Playwright MCP — checked: 2026-09-02            | n/a     | When NOT to use: any assertion a deterministic integration test can already make. Reserved for exploratory checks on surfaces without a stable selector. |

**Stack grounding tools (current session):**

- Docs: none — no Context7 or framework docs MCP exposed in this session; stack facts came from local manifests and configs; checked: 2026-09-02
- Search: none — no Exa.ai or web-search MCP exposed in this session; checked: 2026-09-02
- Runtime/browser: Playwright MCP available, plus an in-app browser tool — possible exploratory layer, not used for this plan; checked: 2026-09-02
- Provider/platform: Supabase MCP present but unauthorized in this session, so no live database introspection was possible; Atlassian MCP available but not quality-gate relevant; checked: 2026-09-02

No AI-native rollout phase is included. Every risk in §2 has a deterministic
oracle available from the PRD, so a model layer on top would add cost
without signal. Reconsider at `--refresh` if a surface appears whose failure
mode cannot be asserted deterministically.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate                                   | Where                        | Required?                 | Catches                                                         |
| -------------------------------------- | ---------------------------- | ------------------------- | --------------------------------------------------------------- |
| lint + typecheck                       | local + CI                   | required                  | syntactic and type drift                                        |
| unit                                   | local + CI                   | required                  | logic regressions                                               |
| build                                  | CI                           | required                  | packaging and adapter breakage                                  |
| database type drift check              | CI                           | required                  | schema and generated-type divergence                            |
| HTTP integration against live database | CI                           | required                  | authorization and persistence regressions                       |
| e2e on critical flows                  | CI on PR                     | required                  | broken critical user paths                                      |
| authorization suite green              | CI on PR                     | required after §3 Phase 1 | cross-group data exposure and write-grant bypass                |
| CV lifecycle suite green               | CI on PR                     | required after §3 Phase 3 | unretrievable uploads, reachable expired files                  |
| pre-prod smoke                         | between merge and production | optional                  | environment-specific failures, notably the Workers deploy shape |

The first six gates are already wired. Phases 1 and 3 add suites; Phase 4
makes those suites blocking rather than advisory.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, the sub-section names the pattern
it will carry.

### 6.1 Adding a unit test

- **Location**: beside the unit under test.
- **Naming**: `<module>.test.ts` / `<Component>.test.tsx`.
- **Reference test**: `src/lib/services/recruitments.test.ts`.
- **Run locally**: `npm run test`.

### 6.2 Adding an integration test

- **Location**: beside the route under test.
- **Naming**: `<route>.integration.test.ts`.
- **Mocking policy**: do not mock the database. Integration tests run HTTP
  against a live local Supabase; mocking the boundary would remove the only
  signal these tests exist to give.
- **Reference test**: `src/pages/api/recruitments/index.integration.test.ts`.
- **Run locally**: `npm run test:integration`.
- **Carve-out**: cross-cutting authorization assertions (denial by tenancy or
  by operation, checked across many routes at once) do not live beside their
  route. They live in the single dedicated suite named in §6.4, so the
  tenancy contract reads as one document and a missing endpoint is visible
  by inspection rather than by absence.

### 6.3 Adding an e2e test

- **Location**: `tests/e2e/`.
- **Reference test**: `tests/e2e/recruitments.spec.ts`.
- **Run locally**: `npm run test:e2e`.
- **When to prefer integration instead**: whenever the failure does not
  require the full browser-session-cookie crossing.

### 6.4 Adding an authorization test for a new endpoint

- **Location**: the single dedicated cross-cutting suite, not beside the
  route — `src/pages/api/authorization.integration.test.ts`. Every
  authorization boundary lives here so the tenancy contract reads as one
  document and a missing endpoint is visible by inspection. See the §6.2
  carve-out.
- **Naming**: a top-level `describe` per risk, containing named `it` blocks
  whose titles state the proposition in user terms (a claim about a
  principal, not a route) — e.g. "the tenant-peer principal cannot read a
  recruitment it is not a member of."
- **Reference test**: `src/pages/api/authorization.integration.test.ts`.
- **Run locally**: `npm run test:integration` for the HTTP layer,
  `npm run test:rls` for the underlying database policy assertions.
- **The pattern — constructing a principal outside the assigned security
  group**: a fixture that merely lacks any group cannot distinguish "denied
  for lack of tenancy" from "denied for lack of the operation." Use (or add,
  following the same shape in `supabase/seed.sql`) a principal that holds
  the **same operations** as a legitimate member but is scoped to a
  **different** security group — see `tenantPeer` in
  `src/lib/test-support/integration-client.ts` and its seed fixture. Sign in
  via `signInIntegrationClient(role)`; never forge a cookie or invent a
  second harness.
- **The paired-read-back rule**: a status code alone is not evidence of a
  data boundary. 404 is the deliberate tenancy signal for scoped reads and
  no-op updates (`maybeSingle()` returning `null`), and the same shape
  covers both "resource doesn't exist" and "resource exists but you can't
  see it" — so every denial assertion must be paired, in the same test or
  block, with a read-back by a legitimate member proving the resource is
  unchanged and still exists. Assert the **effect** (no row change), never a
  specific SQLSTATE origin — denial arrives variously from RLS, from a
  narrowed table grant, or from an RPC's explicit `raise`, and which
  mechanism fired is an implementation detail.
- **Symmetry**: isolation assertions must check both directions — principal
  A cannot see B's data, and principal B cannot see A's data. A
  one-directional test passes when a bug hides everything from everyone;
  this exact tautology already surfaced in this repo once
  (`recruiter-customizes-kanban-stages/reviews/impl-review.md:29`).
- **No global-count assertions and no `beforeEach` truncation**: the
  integration harness has no reset between tests by design. Create your own
  fixtures; never assert on how many rows exist in total.

### 6.5 Adding a test for a server-enforced business rule

- TBD — see §3 Phase 2, for the "blocked operation returns a domain error
  and leaves persisted state unchanged" pattern.

### 6.6 Adding a test for the CV lifecycle

- TBD — see §3 Phase 3, for the "uploaded file is afterwards retrievable"
  and "expired file is refused at read time, purge is idempotent" patterns,
  including clock control.

### 6.7 Per-rollout-phase notes

**S-06 candidate history search** (`context/changes/candidate-history-search/plan.md`):

- **Asserting presence and relative order, never totals, when the harness never resets.**
  The integration and e2e harnesses share one database across the whole run with no
  per-test truncation, so a global-count assertion (`expect(items).toHaveLength(N)`) is
  guaranteed to flake as other specs add rows. Instead assert that a specific known row is
  present (`expect(names).toContain("Julia Wojcik")`) and, for ordered results, that two
  known rows appear in the expected relative order (`indexOf(a) < indexOf(b)`) — never that
  the result set has an exact length.
- **The cross-tenant shared-candidate fixture as a reusable Risk #4 probe.** Seed one
  candidate who belongs to recruitments in two different security groups, each with its own
  multi-step status-history chain (`supabase/seed.sql`, Julia Wojcik). Any future slice that
  needs to prove per-group visibility on a candidate-scoped read can reuse this fixture
  instead of growing a new one — the pairing already demonstrates both the "member sees it"
  and "non-member does not" directions in one seed.
- **Controlling debounced UI with fake timers, not real waits.** A component wrapping a
  debounce hook (`useDebouncedValue`) must be tested with `vi.useFakeTimers()` and
  `vi.advanceTimersByTime(delayMs)` around the state update, not `await new Promise(r =>
setTimeout(r, delayMs))` — the latter makes the suite's wall-clock time track the debounce
  interval for no signal gained, and is exactly the kind of real-time wait the unit layer
  exists to avoid.

## 7. What We Deliberately Don't Test

The Phase 2 interview was declined, so this section carries no user-stated
exclusions. The entries below are derived from the PRD's non-goals and from
this plan's own scoping decisions, and are weaker evidence than an
interview answer would be. Re-open them at the first `--refresh`.

- **Anything behind a PRD non-goal** — external ATS integration, import and
  export, multi-tenancy, public job postings, self-application, email
  notification, offline support (`prd.md:147-151`). Re-evaluate if a
  non-goal is promoted into the roadmap.
- **Page-load performance against the 2-second budget** (`prd.md:116`) —
  this is observability and alerting, not a test. Re-evaluate if a perf
  budget becomes a release criterion.
- **Supabase cold-start latency** (`infrastructure.md:86,106`) — an
  infrastructure property, not application behaviour under our control.
- **Status-change reversibility** (`prd.md:48,94`) — shipped and
  implementation-reviewed at full Progress; excluded from this rollout on
  priority, not on principle. Re-evaluate if the status history schema
  changes.
- **UI snapshot tests** — no rollout phase adds them; they would encode
  markup rather than behaviour, and every risk in §2 is a server-side data
  or authorization failure.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-02
- Stack versions last verified: 2026-09-02
- AI-native tool references last verified: 2026-09-02
- Cookbook §6.2/§6.4 last updated: 2026-09-03 (§3 Phase 1 landed)
- Cookbook §6.7 last updated: 2026-09-03 (S-06 candidate-history-search landed)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes,
- the Phase 2 interview becomes possible (this revision has no user-stated
  evidence at all).
