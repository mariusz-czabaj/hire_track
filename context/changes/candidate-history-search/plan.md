# Candidate History Search (S-06) Implementation Plan

## Overview

Deliver the candidate database: a global, name-searchable **Candidates** view (FR-014, FR-015)
and, on the existing candidate profile, the full status-change log for every recruitment the
candidate took part in (FR-016, US-02). This is the first code in the project to read
`candidate_recruitment_status_history`, and the first genuinely global list in the application.

## Current State Analysis

Earlier slices built ahead specifically for this one:

- `candidate_recruitment_status_history` has existed since F-01, is append-only, is written by
  both S-04 RPCs, and carries an index on `candidate_recruitment_id` annotated "(S-06's
  per-candidate history query)". Outside the generated `src/db/database.types.ts`, **no
  application code reads it today**.
- A GIN trigram index sits on `candidates.full_name`
  (`supabase/migrations/20260831182957_recruitment_candidate_schema.sql:77`), commented
  "Trigram search index for name lookup (S-06)". `pg_trgm` is enabled at the same file's line 11.
- S-05 shipped `/candidates/:candidateId`, `GET|PATCH /api/candidates/[candidateId]`,
  `src/lib/services/candidate-profile.ts`, and `CandidateProfileDto` — explicitly so that S-06
  would inherit the resource rather than rework it. `/candidates` is already in
  `PROTECTED_ROUTES` (`src/middleware.ts:5`).
- `getCandidateProfile` (`src/lib/services/candidate-profile.ts:39-55`) already returns each
  recruitment the candidate belongs to with its **current** stage. FR-016 is therefore roughly
  half-built; the missing half is the log.

What is missing, and has no precedent anywhere in the repo:

- No candidates list or search endpoint (`src/pages/api/candidates/` holds only
  `[candidateId]/` and `cv-purge.ts`).
- No pagination or result bounding of any kind; no `.range()` call exists.
- No debounce hook or utility (zero grep hits), while `useApiResource`
  (`src/components/hooks/useApiResource.ts:67`) refetches on every `url` change.
- No status-history DTO in `src/types.ts`.
- No `input`, `table`, `select`, or `pagination` component in `src/components/ui/`.

The seed (`supabase/seed.sql:215-278`) gives every candidate exactly one recruitment and exactly
one history row, so nothing currently demonstrates the behaviour FR-016 exists for.

## Desired End State

A signed-in user holding `candidate.read` can open **Candidates** from the app, type part of a
name, and see matching candidates ordered alphabetically. Opening one shows their profile with
every recruitment they took part in *that the viewer's security groups permit*, and under each,
the complete ordered log of stage transitions with dates. A viewer in a different security group
sees the same candidate's identity but none of that recruitment's stages, dates, or history.

Verified by: `npm run test`, `npm run test:integration`, `npm run test:rls`, `npm run test:e2e`
all green, plus manual walkthrough of search → profile → history in the running app.

### Key Discoveries:

- **The authorization asymmetry is intentional and PRD-sourced.** `candidates` SELECT is
  org-wide on `has_operation('candidate.read')`
  (`supabase/migrations/20260831183457_rls_policies.sql:179`), while `candidate_recruitments` and
  the history table are scoped per security group (`:194`, `:210`). F-01's plan justified the
  org-wide scope by citing FR-015/FR-016 directly. So FR-016's "all recruitments" is necessarily
  the *visible subset*, and that is the test oracle — never "every row".
- **History stage names must be joined directly** from `kanban_stages` on `from_stage_id` /
  `to_stage_id`, not re-resolved through `resolveKanbanStages`. A recruitment's stage set may
  have been replaced since a transition; the referenced-stage guard
  (`supabase/migrations/20260901210100_extend_stage_referenced_guard.sql:63-75`) guarantees the
  historical rows survive precisely so the log stays readable.
- **`from_stage_id` is null on the initial add** (`add_candidate_to_recruitment`,
  `supabase/migrations/20260901210500_candidate_write_rpcs.sql:103`), so the first log entry has
  no source stage and must render as an "added" event.
- **A history row's note is keyed on the stage being *left*.** S-04's gate requires a note on the
  source stage, so a history row joins its note by `(candidate_recruitment_id, from_stage_id)`.
  This plan does not surface notes, but the pairing is recorded so a future reader does not join
  on `to_stage_id`.
- **`changed_by` is nullable by design** (F-01 impl-review F1 changed the FK to
  `ON DELETE SET NULL`), which is one reason attribution is deferred here.
- **404 is the tenancy signal for plain RLS reads.** A denied caller and a nonexistent row are
  indistinguishable for non-RPC reads (`candidate-profile-and-cv-upload/change.md:60-67`).
- **The cookbook forbids global-count assertions and `beforeEach` truncation**
  (`context/foundation/test-plan.md` §6.4). "The list returns exactly N candidates" is the
  obvious wrong instinct for FR-014 and must not appear.

## What We're NOT Doing

- **No actor attribution on log entries.** FR-016 requires the log, not who made each change.
  Showing it would mean widening `get_user_emails_for_candidate`, whose predecessor was a
  CRITICAL email-enumeration finding. Recorded as a scoped follow-up in Phase 5 instead.
- **No disclosure of withheld recruitments.** Truncation is silent; no count, no notice.
- **No full-text search.** The existing trigram index stays; no migration to `tsvector`.
- **No offset or cursor pagination, and no pagination component.** A result cap with a refine
  signal instead.
- **No new migration at all.** No schema change, no new RPC, no new `operation` enum value —
  `candidate.read` already covers this surface, and a read-only query needs no `SECURITY DEFINER`
  function.
- **No new indexes on `from_stage_id`/`to_stage_id`.** S-04 flagged the revisit as due at S-06;
  the per-candidate query drives off the already-indexed `candidate_recruitment_id` and the stage
  join is a primary-key lookup. Confirmed rather than assumed in Phase 2's manual verification.
- **No search by email or phone.** FR-015 says name.
- **No candidate deletion, no removal from a recruitment, no CV history UI.**
- **Not closing the history-completeness gap.** A direct PostgREST update of `current_stage_id`
  still writes no history row (test-plan Risk #5, owned by test-plan Phase 2).

## Implementation Approach

Every query runs through the caller's own RLS-scoped Supabase client, so visibility is enforced
by Postgres and the application adds no authorization logic. That is what makes the truncation
behaviour correct by construction rather than by a filter someone could forget.

Work proceeds outside-in from the data: seed the fixture that makes the feature observable,
then read the history, then add the list surface, then the UI, then close the gates. The seed
lands first deliberately — it is the change with blast radius on existing suites, and finding
that out in Phase 1 is far cheaper than in Phase 5.

## Critical Implementation Details

**Seed blast radius.** Adding a candidate to an existing recruitment changes what every other
integration and e2e suite sees. The cookbook already forbids global-count assertions, but Phase 1
must verify that empirically by running all suites, not assume compliance. Add the fixture by
looking groups and recruitments up by name, never by assumed ordinal id — the existing suites do
the same (`src/pages/api/authorization.integration.test.ts:38-42`), and
`supabase/seed.sql:13` warns that ids 1–3 are relied upon elsewhere.

**Ordering within the log.** Order by `changed_at` ascending, then `id` ascending as a tiebreak.
Seeded and RPC-written rows can share a `changed_at` value (both default to `now()` inside one
transaction), so `changed_at` alone is not a total order and a test asserting sequence would
flake.

**Query shape for the profile.** `getCandidateProfile` already issues one query for the
recruitment rows and one for the CV. Fetch the history for all of the candidate's visible
`candidate_recruitments` in a **single** additional query filtered by
`in (candidateRecruitmentIds)` and group it in TypeScript — not one query per recruitment. RLS
filters the history rows anyway, so the grouping cannot leak.

## Phase 1: Cross-tenant seed fixture

### Overview

Seed one candidate who appears in both tenants with multi-step history, so FR-016 and the
truncation boundary are demonstrable in the running app and assertable against a real database.
Prove the addition breaks no existing suite.

### Changes Required:

#### 1. Shared cross-tenant candidate fixture

**File**: `supabase/seed.sql`

**Intent**: Add a candidate who participates in both the Backend Engineer (Tenant A / HR-Rekruter)
and Data Analyst (Tenant B) recruitments, with several stage transitions recorded in each, so
that the multi-recruitment log has something to show and the truncation boundary has both sides.

**Contract**: One new row in `candidates`; two new rows in `candidate_recruitments` (one per
recruitment, `current_stage_id` matching the last transition); several rows in
`candidate_recruitment_status_history` per `candidate_recruitment`, beginning with an initial-add
row (`from_stage_id` null) and continuing through at least two further transitions with distinct,
increasing `changed_at` values. `changed_by` uses each recruitment's own tenant principal — the
Tenant A rows use the HR user, the Tenant B rows the Tenant B principal — matching the existing
comment at `supabase/seed.sql:264-267` that a history author must be a real member, not a
cross-tenant reference. Resolve every foreign key by name lookup (`where email = …`,
`where title = …`, `where recruitment_id is null and name = …`), never by literal id.

Note that stage transitions here are written directly rather than through `move_candidate_stage`,
exactly as the existing seed does — the RPC's note gate is not being exercised, and S-04's
fixtures already established this precedent.

### Success Criteria:

#### Automated Verification:

- Database resets cleanly with the new fixture: `npx supabase db reset --local`
- Existing RLS assertions still pass: `npm run test:rls`
- Unit suite unaffected: `npm run test`
- **No existing integration test regressed by the new rows**: `npm run test:integration`
- **No existing e2e spec regressed by the new rows**: `npm run test:e2e`
- Linting and formatting pass: `npm run lint`

#### Manual Verification:

- The new candidate appears on both the Backend Engineer and Data Analyst kanban boards, on the
  stage matching their final transition in each.
- Signed in as the Tenant B principal, the candidate's existing profile page shows the Data
  Analyst recruitment and not the Backend Engineer one — confirming the truncation the later
  phases will assert.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Status history on the candidate profile

### Overview

Read `candidate_recruitment_status_history` for the first time and expose the ordered log per
recruitment on the existing profile endpoint.

### Changes Required:

#### 1. History DTO

**File**: `src/types.ts`

**Intent**: Introduce the shape of a single log entry and attach the log to each recruitment
summary. **This extends a shipped DTO** (`CandidateProfileDto`, consumed by
`CandidateProfile.tsx` and asserted in `candidates-profile.integration.test.ts`) — declared here
explicitly because a prior review finding (S-04 F7) flagged a plan that claimed a DTO was
unchanged when it was not.

**Contract**: A new `CandidateStatusHistoryEntryDto` carrying the entry id, the source stage name
(nullable — null means the initial add), the target stage name, and the change timestamp. Add a
required `history: CandidateStatusHistoryEntryDto[]` field to `CandidateRecruitmentSummaryDto`
(`src/types.ts:129`). Existing fields are untouched.

#### 2. History read in the candidate-scoped service

**File**: `src/lib/services/candidate-profile.ts`

**Intent**: After the existing recruitments query, fetch the status history for all of the
candidate's visible `candidate_recruitments` in one query and attach each ordered log to its
recruitment summary. Belongs here, not in `candidates.ts`, because the query is candidate-scoped
— the module split by scope is an established boundary in this codebase.

**Contract**: A query against `candidate_recruitment_status_history` selecting the entry id,
`candidate_recruitment_id`, `changed_at`, and the two joined stage names, filtered by
`in (<the candidateRecruitmentIds already fetched>)` and ordered by `changed_at` then `id`,
both ascending. Follow the file's existing conventions: a local `interface` for the joined row
shape applied via `.overrideTypes<Row[], { merge: false }>()`, Supabase errors re-thrown raw,
snake_case→camelCase mapping inline. Skip the query entirely when the candidate has no visible
recruitments.

The two stage joins are to the same table on different foreign keys, so each needs a disambiguated
alias in the PostgREST select string — an unaliased double join to `kanban_stages` will not
resolve. A recruitment with no visible rows must yield `history: []`, never `undefined`.

#### 3. Unit coverage for the history read

**File**: `src/lib/services/candidate-profile.test.ts`

**Intent**: Cover the log's shape and ordering, and the branches a real database will not easily
produce, against the file's existing hand-rolled stub.

**Contract**: Extend the local `FakeQueryBuilder` with any chain method the new query needs
(`in`, and `order` called twice) — the file already gained `neq`/`order`/`limit` this way in S-05.
Cases: entries are returned oldest-first; an initial-add row surfaces a null source stage; a
candidate with recruitments but no history rows yields empty arrays rather than a crash; a
candidate with no visible recruitments issues no history query at all.

#### 4. Integration coverage for the truncation boundary

**File**: `src/pages/api/candidates/candidates-profile.integration.test.ts`

**Intent**: Prove against a live database that the log is complete for a member and empty for a
non-member — the FR-016 oracle and test-plan Risk #4.

**Contract**: Using the Phase 1 fixture and the existing `signInIntegrationClient` harness: the
HR principal sees the Backend Engineer recruitment with its full ordered log; the `tenantPeer`
principal sees the same candidate's identity but not that recruitment at all. Assert **both
directions** — the cookbook's symmetry rule exists because a one-directional test passes when a
bug hides everything from everyone. Pair each denial with a read-back by a legitimate member
proving the data is still there (the paired-read-back rule). Assert on the presence and order of
specific entries, never on a total count.

### Success Criteria:

#### Automated Verification:

- Types check: `npm run astro check` (or `npm run build`)
- Unit tests pass, including the new history cases: `npm run test`
- Integration tests pass, including both truncation directions: `npm run test:integration`
- Generated database types are still in sync: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Linting passes: `npm run lint`

#### Manual Verification:

- `GET /api/candidates/<the Phase 1 candidate>` as HR returns both recruitments, each with an
  ordered `history` array beginning with a null-source "added" entry.
- The same request as the Tenant B principal returns only the Data Analyst recruitment.
- **Confirm the query plan does not sequential-scan the history table** — inspect the plan for
  the `in (...)` filter and record the result; this settles S-04's deferred question about
  indexing `from_stage_id`/`to_stage_id` with evidence rather than assumption.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 3: Candidates list and search API

### Overview

Add the global, name-searchable candidates list behind a new endpoint, bounded by a result cap.

### Changes Required:

#### 1. List item DTO and query contract

**File**: `src/types.ts`

**Intent**: Define what a row in the candidates list carries and how the endpoint signals that
results were capped.

**Contract**: A `CandidateListItemDto` with the candidate id, full name, email, and the count of
recruitments visible to the caller. A `CandidateListDto` wrapping `items` plus a boolean
indicating the cap was reached, so the UI can render the refine hint without comparing lengths
against a magic number. Export the result cap as a named constant so the service, the endpoint,
and the tests share one source of truth.

#### 2. Candidate list service

**File**: `src/lib/services/candidate-list.ts` (new)

**Intent**: Query candidates org-wide, optionally filtered by a name substring, ordered
alphabetically and bounded by the cap. A new candidate-scoped module rather than an addition to
`candidates.ts`, which is recruitment-scoped.

**Contract**: `listCandidates(client, { query }): Promise<CandidateListDto>`. Case-insensitive
substring match on `full_name` when a query of two or more characters is supplied; unfiltered
otherwise. Ordered by `full_name` ascending with `id` ascending as a tiebreak, so the order is
total and assertable. Fetches `cap + 1` rows to detect truncation, returns at most `cap`, and
sets the truncation flag accordingly — this avoids a separate count query.

The per-candidate recruitment count comes from the caller's RLS-scoped view, so it is the
*visible* count and is consistent with the profile's silent truncation. Escape `%` and `_` in the
user-supplied query before interpolating it into the pattern, or the input becomes a wildcard
injection that turns a search into a full scan.

#### 3. List endpoint

**File**: `src/pages/api/candidates/index.ts` (new)

**Intent**: Expose the list over HTTP following the established route template.

**Contract**: `export const prerender = false` and a `GET` typed `APIRoute`. A module-level zod
schema validates the optional `q` search param read via `context.url.searchParams.get("q")`,
following the only existing precedent (`src/pages/api/recruitments/index.ts:21-29`): trimmed,
length-capped, invalid input → `422 invalid_request`. A query shorter than two characters after
trimming is treated as absent rather than rejected, so the box behaves sensibly as the user types
the first letter. Standard `createClient` + `supabase_unconfigured` guard, `jsonOk` on success,
`handleCandidateProfileError` in the catch. No per-route auth check — middleware owns 401.

This file sits alongside the existing `candidates/[candidateId]/` directory, which is the
required nested-routing shape (`[id]/index.ts`, never `[id].ts` beside an `[id]/` directory).

#### 4. Unit coverage for the service

**File**: `src/lib/services/candidate-list.test.ts` (new)

**Intent**: Cover query construction and the cap logic, which a live database exercises awkwardly.

**Contract**: Following the file-local `FakeQueryBuilder` pattern used by the sibling service
tests: a short query is ignored rather than filtered on; wildcard characters in the query are
escaped; exactly `cap` rows with more available sets the truncation flag; fewer than `cap` does
not; ordering arguments are alphabetical with the id tiebreak.

#### 5. Authorization rows for the new endpoint

**File**: `src/pages/api/authorization.integration.test.ts`

**Intent**: Register the new read surface in the single cross-cutting tenancy suite, as the
cookbook's §6.2 carve-out requires — so a missing endpoint stays visible by inspection.

**Contract**: Under the existing `#4 shared candidate profile` risk grouping, `it` titles phrased
as claims about a principal: a principal holding `candidate.read` finds the cross-tenant
candidate by name regardless of group (the org-wide half); a principal *without* `candidate.read`
receives no rows (the denial half), paired with a read-back by a legitimate principal proving the
candidate still exists. Assert the effect, not a specific SQLSTATE.

#### 6. Integration coverage for search behaviour

**File**: `src/pages/api/candidates/candidates-list.integration.test.ts` (new)

**Intent**: Prove search and bounding against a live database.

**Contract**: A search for a distinctive fragment of the Phase 1 candidate's surname returns that
candidate; a search matching a first-name fragment returns them too (FR-015 says first *or* last
name and the column is a single `full_name`); a nonsense query returns an empty list with a 200,
not a 404; results are alphabetically ordered. Create any additional fixtures locally with
randomised names, and **assert on the presence and relative order of known candidates, never on
totals** — the harness has no reset between tests by design.

### Success Criteria:

#### Automated Verification:

- Types check: `npm run astro check` (or `npm run build`)
- Unit tests pass, including the new service cases: `npm run test`
- Integration tests pass, including search and the authorization rows: `npm run test:integration`
- Linting passes: `npm run lint`

#### Manual Verification:

- `GET /api/candidates` returns an alphabetical list; `?q=` with a partial surname narrows it;
  `?q=a` (one character) behaves as unfiltered rather than erroring.
- A query containing `%` returns no spurious matches.
- The list responds well within the 2-second NFR budget against the seeded database.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 4: Candidates UI

### Overview

Add the Candidates page with a debounced search box, and render the status log on the profile.

### Changes Required:

#### 1. Debounce hook

**File**: `src/components/hooks/useDebouncedValue.ts` (new)

**Intent**: Delay propagating the search term so typing does not fire one request per keystroke.
`useApiResource` refetches on every `url` change, so without this the search box is a request
generator.

**Contract**: `useDebouncedValue<T>(value: T, delayMs: number): T`, returning the latest value
after the delay has elapsed with no further change, and clearing its timer on unmount. Lives in
`src/components/hooks/` alongside the three existing hooks — note that is the real location, not
`src/hooks/`.

#### 2. Candidates list island

**File**: `src/components/candidates/CandidateList.tsx` (new)

**Intent**: Render the searchable list, driven by `useApiResource` against the Phase 3 endpoint.

**Contract**: Accepts `initialQuery?: string` (the raw `Astro.params`-style string from the page).
Mirrors `RecruitmentList.tsx:24-46` exactly: local state seeded from the prop, a `useMemo` that
builds the API URL from the debounced term, and a `syncUrl` writing `?q=` with
`window.history.replaceState` so the view is shareable and survives reload. Rows are `<a>`-wrapped
`<Card>` elements linking to `/candidates/{id}` — the first link to that route from anywhere in
the app. Renders the four states the codebase already standardises: `Skeleton` while loading,
`ServerError` on error, the centred empty-state paragraph when a search matches nothing, and the
list on success. When the response's truncation flag is set, show the refine hint beneath the
list. Add `data-testid` on the list container and `aria-label` on the search input, per the
existing testability convention.

The search input has no shadcn component to reuse (`src/components/ui/` has no `input.tsx`);
either add one via `npx shadcn@latest add input` following the house label/id pairing that
`textarea.tsx` and `file-input.tsx` document, or compose `FormField`. Prefer adding `input` — it
is the generic primitive several future slices will want.

#### 3. Candidates page

**File**: `src/pages/candidates/index.astro` (new)

**Intent**: The route shell for the list.

**Contract**: Mirrors `src/pages/recruitments/index.astro`: `Layout` wrapper, the
`bg-cosmic min-h-screen p-4 text-white sm:p-8` shell with a `max-w-4xl` inner container, the
gradient `h1`, and a single `client:load` island receiving
`Astro.url.searchParams.get("q") ?? undefined`. No data fetching in the frontmatter — the island
fetches its own JSON, which is the universal convention here. **No middleware change is needed**;
`/candidates` is already protected.

#### 4. Navigation entry point

**File**: `src/components/Topbar.astro` (or the shared navigation surface it renders)

**Intent**: Give users a way to reach the new view. US-02 begins "the user navigates to the
Candidates section", so a feature with no entry point does not satisfy the story.

**Contract**: A link to `/candidates` alongside the existing recruitments navigation, matching its
markup and active-state treatment. Verify the actual navigation component before editing — if the
topbar carries no links today, add the link to the dashboard instead and note the deviation.

#### 5. Status log rendering on the profile

**File**: `src/components/candidates/CandidateProfile.tsx`

**Intent**: Show each recruitment's ordered log inside the existing Recruitments card.

**Contract**: Under each recruitment entry, render its `history` in order as a compact list of
transitions: an initial entry reading as "Added to <stage>" when the source stage is null, and
subsequent entries as "<from> → <to>", each with its date formatted `en-CA` for locale stability
(the convention used throughout). A recruitment with an empty log renders the recruitment with no
log rather than being hidden — a prior review finding (S-04 F2) flagged exactly this: hiding a
row for lack of a sub-resource instead of showing it empty.

#### 6. Component coverage

**Files**: `src/components/candidates/CandidateList.test.tsx` (new),
`src/components/candidates/CandidateProfile.test.tsx`

**Intent**: Cover the list's states and the log's rendering.

**Contract**: Following the existing component-test pattern — a `vi.fn()` fetch mock dispatching
on url and method, `buildX(overrides)` DTO factories, `jsonResponse` helper, Testing Library with
`user-event`, `cleanup` in `afterEach`. List cases: renders returned candidates; typing filters
via the debounced URL (advance timers rather than waiting in real time); the empty state renders
for a query with no matches; the refine hint renders only when the truncation flag is set.
Profile cases: a transition list renders in order; a null source stage renders as an "added"
entry; a recruitment with an empty log still renders.

### Success Criteria:

#### Automated Verification:

- Types check: `npm run astro check` (or `npm run build`)
- Unit and component tests pass: `npm run test`
- Linting passes, including the `jsx-a11y` rules: `npm run lint`
- Formatting is clean: `npm run format`

#### Manual Verification:

- Navigating to Candidates from the app's navigation shows the alphabetical list.
- Typing a partial surname narrows the list, the address bar updates to `?q=…`, and reloading
  that URL restores the same filtered view.
- Typing quickly issues roughly one request rather than one per keystroke (confirm in the network
  panel — this is the whole reason the debounce hook exists).
- Clicking a candidate opens their profile; each recruitment shows its transitions in order with
  a leading "Added to …" entry.
- The page renders correctly at mobile width and in the app's dark theme.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 5: Gate closure and documentation

### Overview

Add the database-level policy assertion and the end-to-end path, then update the shared cookbook
and record the deferred attribution decision.

### Changes Required:

#### 1. Database policy assertion

**File**: `supabase/tests/rls_verification.sql`

**Intent**: Assert the history table's SELECT policy directly, outside the application — the
convention that every new read surface owes a numbered block. Three prior findings (S-03 F1/F3,
S-04 F6) were "a new read surface shipped without one".

**Contract**: Append assertion **(34)** in the file's existing style (the last is (33) at line
1007), following the established `set local role` / `set local request.jwt.claims` shape used by
the surrounding blocks: for the Phase 1 cross-tenant candidate, a Tenant A principal sees the
Backend Engineer history rows and zero Data Analyst rows, and the Tenant B principal sees the
mirror image. Both directions, as the symmetry rule requires.

#### 2. End-to-end path

**File**: `tests/e2e/candidate-history.spec.ts` (new)

**Intent**: Prove the full browser-session path FR-014→FR-015→FR-016 that no integration test
crosses.

**Contract**: Using `signInAs` from `tests/e2e/support/auth.ts` — including its hydration-retry
`expect(async …).toPass()` block, which exists because islands mount asynchronously — sign in as
HR, navigate to Candidates, type part of the Phase 1 candidate's name, click the result, and
assert the profile shows both recruitments each with an ordered transition list. Reuse the
`data-testid` hooks added in Phase 4 rather than text selectors where the text is data.

#### 3. Cookbook update

**File**: `context/foundation/test-plan.md`

**Intent**: Record the patterns this slice established so the next author does not rediscover
them. §6.7 ("Per-rollout-phase notes") is currently empty and is the designated home.

**Contract**: A §6.7 entry covering: asserting on presence and relative order rather than totals
when the harness has no reset; the cross-tenant shared-candidate fixture as the reusable Risk #4
probe; and controlling debounced UI with fake timers. Bump the §8 freshness ledger date. Do not
alter §1–§5 — the strategy is frozen, and changing it is `/10x-test-plan`'s job, not this slice's.

#### 4. Decision record

**File**: `context/changes/candidate-history-search/change.md`

**Intent**: Record the decisions taken during planning so the next reader sees the lineage, in
keeping with how every prior slice documented its choices.

**Contract**: A dated note covering the six planning decisions — silent truncation, cap-plus-hint
bounding, substring search with a two-character floor, attribution deferred, history delivered on
the existing profile GET, and the cross-tenant fixture — with the attribution follow-up stated
concretely enough to act on later: widen `get_user_emails_for_candidate` to also admit ids drawn
from `candidate_recruitment_status_history.changed_by` for that same `candidate_recruitment`,
keeping the per-`candidate_recruitment` scoping that finding F1 introduced.

### Success Criteria:

#### Automated Verification:

- Database policy assertions pass, including (34): `npm run test:rls`
- End-to-end suite passes, including the new spec: `npm run test:e2e`
- Full suite green: `npm run test` and `npm run test:integration`
- Production build succeeds: `npm run build`
- Linting and formatting pass: `npm run lint` and `npm run format`

#### Manual Verification:

- The complete US-02 walkthrough works in the running app: sign in, open Candidates, search a
  surname, open the candidate, read the full history per recruitment.
- Signing in as the Tenant B principal and repeating the walkthrough shows the candidate with
  only the Data Analyst recruitment and its log — the truncation behaves as decided.

**Implementation Note**: This is the final phase. After all automated verification passes, pause
for manual confirmation before considering the plan complete.

---

## Testing Strategy

### Unit Tests:

- History mapping: ordering, the null source stage on an initial add, empty logs, and the
  no-visible-recruitments short-circuit that skips the query.
- List service: short queries ignored, wildcard escaping, cap detection via the `cap + 1` fetch,
  alphabetical ordering with the id tiebreak.
- Components: list states (loading, empty, error, capped), debounced URL construction under fake
  timers, and log rendering including the empty-log case.

### Integration Tests:

- Profile history for a member versus a non-member, asserted **in both directions** with a paired
  read-back proving the resource is unchanged.
- Search by first-name and surname fragments, the empty result, and alphabetical ordering.
- Authorization rows for the new list endpoint in the single cross-cutting suite.
- No test asserts a global count, and none truncates tables in `beforeEach`.

### Manual Testing Steps:

1. Reset the database, sign in as HR, and open Candidates from the navigation.
2. Type a partial surname; confirm the list narrows, `?q=` appears in the address bar, and the
   network panel shows roughly one request rather than one per keystroke.
3. Reload the filtered URL and confirm the view is restored.
4. Open the cross-tenant candidate; confirm both recruitments render with ordered logs beginning
   with an "Added to …" entry.
5. Sign in as the Tenant B principal and repeat step 4; confirm only the Data Analyst recruitment
   and its log appear, with no hint that anything was withheld.
6. Confirm the list renders correctly at mobile width and in the dark theme.

## Performance Considerations

The 2-second NFR applies to the recruitments list and kanban board, but the global candidates list
is the first unbounded query in the project and should respect it. Three properties keep it
bounded: the substring match rides the existing `full_name` trigram GIN index; the result cap
means at most `cap + 1` rows cross the wire regardless of table size, well under PostgREST's
`max_rows = 1000`; and the profile's history is a single `in (...)` query against the indexed
`candidate_recruitment_id`, not one query per recruitment.

The one query plan worth actually inspecting is the history `in (...)` filter, recorded as a
manual item in Phase 2 — that measurement is what settles S-04's deferred question about indexing
`from_stage_id`/`to_stage_id`, and it should be settled with evidence rather than by adding
speculative indexes.

## Migration Notes

No migration. No schema change, no new RPC, no `operation` enum change — the existing
`candidate.read` grant and the existing RLS policies already express exactly the visibility this
slice needs. The only database-side change is seed data, which is recreated by
`npx supabase db reset --local` and carries no production migration concern.

## References

- Related research: `context/changes/candidate-history-search/research.md`
- Schema and RLS rationale: `context/changes/core-recruitment-data-foundation/plan.md`
- The route family this extends: `context/changes/candidate-profile-and-cv-upload/plan.md`
- Tenancy contract and Risk #4 framing:
  `context/changes/testing-authorization-tenancy-contract/research.md`
- Cookbook and gates: `context/foundation/test-plan.md` §6
- Query-param precedent: `src/pages/api/recruitments/index.ts:21-29`
- Filter and URL-sync precedent: `src/components/recruitments/RecruitmentList.tsx:24-46`
- Service and stub conventions: `src/lib/services/candidate-profile.ts`,
  `src/lib/services/candidate-profile.test.ts:18-58`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cross-tenant seed fixture

#### Automated

- [x] 1.1 Database resets cleanly with the new fixture
- [x] 1.2 Existing RLS assertions still pass
- [x] 1.3 Unit suite unaffected
- [x] 1.4 No existing integration test regressed by the new rows
- [x] 1.5 No existing e2e spec regressed by the new rows
- [x] 1.6 Linting and formatting pass

#### Manual

- [x] 1.7 New candidate appears on both kanban boards at the correct stage
- [x] 1.8 Tenant B principal sees only the Data Analyst recruitment on the profile

### Phase 2: Status history on the candidate profile

#### Automated

- [ ] 2.1 Types check
- [ ] 2.2 Unit tests pass, including the new history cases
- [ ] 2.3 Integration tests pass, including both truncation directions
- [ ] 2.4 Generated database types are still in sync
- [ ] 2.5 Linting passes

#### Manual

- [ ] 2.6 Profile GET as HR returns both recruitments with ordered history
- [ ] 2.7 Profile GET as Tenant B returns only the Data Analyst recruitment
- [ ] 2.8 History query plan inspected; stage-index question settled with evidence

### Phase 3: Candidates list and search API

#### Automated

- [ ] 3.1 Types check
- [ ] 3.2 Unit tests pass, including the new service cases
- [ ] 3.3 Integration tests pass, including search and the authorization rows
- [ ] 3.4 Linting passes

#### Manual

- [ ] 3.5 List returns alphabetically; `?q=` narrows; one-character query behaves as unfiltered
- [ ] 3.6 A query containing `%` returns no spurious matches
- [ ] 3.7 List responds within the 2-second budget against the seeded database

### Phase 4: Candidates UI

#### Automated

- [ ] 4.1 Types check
- [ ] 4.2 Unit and component tests pass
- [ ] 4.3 Linting passes, including the jsx-a11y rules
- [ ] 4.4 Formatting is clean

#### Manual

- [ ] 4.5 Candidates reachable from app navigation; alphabetical list renders
- [ ] 4.6 Search narrows, address bar updates, reload restores the filtered view
- [ ] 4.7 Fast typing issues roughly one request, not one per keystroke
- [ ] 4.8 Candidate profile shows ordered transitions with a leading "Added to …" entry
- [ ] 4.9 Renders correctly at mobile width and in the dark theme

### Phase 5: Gate closure and documentation

#### Automated

- [ ] 5.1 Database policy assertions pass, including (34)
- [ ] 5.2 End-to-end suite passes, including the new spec
- [ ] 5.3 Full unit and integration suites green
- [ ] 5.4 Production build succeeds
- [ ] 5.5 Linting and formatting pass

#### Manual

- [ ] 5.6 Complete US-02 walkthrough works in the running app
- [ ] 5.7 Tenant B walkthrough shows the truncated view as decided
