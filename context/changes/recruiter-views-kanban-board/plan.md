# Recruitment List & Candidate Kanban Board (S-01) Implementation Plan

## Overview

Deliver roadmap slice S-01: a recruiter signs in, sees a status-filterable list of recruitments, and opens one as a read-only kanban board of candidates grouped by stage, with a per-column count and the date added on each card. Satisfies US-01, FR-003, FR-004 (default stage set only), FR-005 and FR-010.

This is the first slice to reach the database from application code, so it also establishes the typed data-access path — generated `Database` types, a service layer, and a JSON error contract — that S-02 through S-07 will copy.

## Current State Analysis

F-01 landed a complete, RLS-enforced schema plus seed data; **no application code touches it**. There is not a single `.from()` call in `src/`.

What exists:
- 7 applied migrations covering `recruitments`, `kanban_stages`, `candidates`, `candidate_recruitments`, status history, and the security-group tables, with RLS policies and two `stable security definer` helpers.
- Seed data with three role identities and one `live` recruitment holding 5 candidates across 5 of 6 default stages.
- An Astro 6 SSR skeleton: one layout, one protected page, three form-POST auth endpoints, `button.tsx` as the only shadcn component.

What is missing, despite CLAUDE.md describing several as established conventions:
- `src/types.ts`, generated `Database` types, `src/lib/services/`, zod (not even a dependency), `src/components/hooks/`, any JSON response envelope, any test framework.

Key constraints discovered:
- **`strictTypeChecked` + an untyped Supabase client is a hard blocker.** [eslint.config.js:15](../../../eslint.config.js:15) enables `no-unsafe-assignment`/`-member-access`/`-call`/`-return`/`-argument` as errors; `createServerClient` is called without a `Database` generic at [src/lib/supabase.ts:9](../../../src/lib/supabase.ts:9). Typed query code is unwritable until types are generated.
- `PROTECTED_ROUTES = ["/dashboard"]` only, and `/api/*` is entirely unguarded ([src/middleware.ts:4](../../../src/middleware.ts:4)).
- `createClient` returns `null` when env vars are absent (both are `optional: true`) — every call site must handle it.
- The Supabase client is **not** on `locals`; `App.Locals` declares only `user` ([src/env.d.ts:1](../../../src/env.d.ts:1)).
- shadcn is configured for light-mode tokens while every page is hand-styled dark glassmorphism, and **nothing ever sets `.dark`** ([src/styles/global.css:4](../../../src/styles/global.css:4)).
- CI's branch filter is `master` while work happens on `main`, so lint and build currently never run on pushes.

Full evidence: [research.md](research.md).

## Desired End State

A signed-in recruiter can navigate to `/recruitments`, filter by Draft / Live / Closed / All, and click a row to open `/recruitments/<id>` as a kanban board with one column per default stage, a candidate count per column header, and a card per candidate showing full name and date added. A Hiring Manager sees exactly the same read-only views. An Administrator (no `recruitment.read`) sees an empty list. An unauthenticated visitor is redirected to sign-in; an unauthenticated API call gets 401 JSON.

Verify by: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:e2e` all passing, plus manual sign-in as each of the three seeded users.

### Key Discoveries

- The kanban's query pattern is already indexed: `candidate_recruitments` carries indexes on `recruitment_id` and `current_stage_id`, added for exactly this purpose ([20260831182957_recruitment_candidate_schema.sql:88](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:88)).
- **Board columns come from `kanban_stages where recruitment_id is null order by sort_order`.** The per-recruitment override column exists but has no write policy and no write grant — S-03's job. Read stages from the table regardless, never hardcode, so S-03 stays a pure insert.
- **A board query needs two operations, not one**: `recruitment.read` on that recruitment (for link rows) *and* org-wide `candidate.read` (for names). `candidates` SELECT is **not** recruitment-scoped ([20260831183457_rls_policies.sql:179](../../../supabase/migrations/20260831183457_rls_policies.sql:179)).
- Candidate status is **not** a column — it is `candidate_recruitments.current_stage_id`. FR-010's date is `added_at`.
- Recruitment status is `text` + CHECK with lowercase values (`draft`/`live`/`closed`), not an enum — labels are a UI mapping.
- Seed data provides three ready test identities (`hr.test@`, `hiring-manager.test@`, `admin.test@`, all `password123`) and a genuinely empty `Odrzucony` column. **Ids are sequence-assigned — never hardcode them.**
- The established interactivity pattern is Astro page + query-param server state + a single `client:load` leaf island ([src/pages/auth/signin.astro:5](../../../src/pages/auth/signin.astro:5)).
- `tsconfig.json` extends `astro/tsconfigs/strict`, not `strictest`, so `noUncheckedIndexedAccess` is **off** — stage-keyed map lookups won't be forced to null-check. Do it anyway.

## What We're NOT Doing

- **No drag-and-drop, no stage changes, no candidate creation** — FR-006/008/009/013 are S-04. This slice is read-only on candidate state.
- **No per-recruitment stage customization** (FR-004's override half) — S-03. No write policy or grant exists for `kanban_stages`.
- **No recruitment create/edit form** — FR-001/001a/002 are S-02.
- **No candidate profile page, no CV upload** — S-05.
- **No candidate search across recruitments** — S-06.
- **No admin UI for groups, operations or membership** — S-07.
- **No notes UI** — no notes table exists.
- **No delete affordances anywhere** — RLS denies DELETE on `recruitments`, `candidates`, `candidate_recruitments` and `kanban_stages`.
- **No Realtime / live-updating board** — `has_realtime: false` in tech-stack.md.
- **No 403 handling** — forbidden and missing both return 404 by decision (see Implementation Approach).
- **No translation of existing Polish `context/**` documents** — the new lessons.md rule binds new artifacts; retrofitting the PRD and roadmap is a separate change.
- **No `locals.supabase`** — endpoints create their own client, matching every existing call site.

## Implementation Approach

**Typed path first, then endpoints, then UI.** Generated `Database` types are phase 1 because nothing typed can be written without them; the lint gate makes this a blocker rather than a preference.

**JSON endpoints + client-side fetch.** Pages are Astro shells; a `client:load` island fetches from `/api/recruitments` and `/api/recruitments/[id]/board` and owns loading, empty and error states. This establishes the API contract S-04 needs for mutations. The cost, accepted deliberately: a read-only screen carries fetch/loading machinery that server-rendering would not need, and the `<2s` NFR now includes a client round-trip after hydration.

**Error contract:** success returns the payload directly with 200; failure returns `{ error: { code, message } }` with a real status code (401 / 404 / 422 / 500). The client branches on `res.ok`.

**Forbidden is indistinguishable from missing, by design.** RLS returns zero rows for both, and we return 404 for both rather than probing existence with elevated privileges. This satisfies PRD guardrail line 46 and the security NFR, and keeps any RLS-bypass credential out of the Worker. The accepted cost: a recruiter genuinely lacking group access sees "not found" with no hint to request access — revisit when S-07 makes such guidance actionable.

**Authorization stays in the database.** Endpoints run as the signed-in user via the anon key plus session cookie; RLS does the scoping. No UI-level permission logic, which would drift from the policies. The middleware `/api` guard is an authentication gate (is there a session?), not an authorization one.

**Stage names get renamed to English in this slice** (phase 1), per the `context/foundation/lessons.md` rule. Safe now: they are data, no rows reference them by name, and no per-recruitment overrides exist.

## Critical Implementation Details

**Middleware branching.** The `/api` guard must return 401 JSON, not a redirect — a redirect to an HTML sign-in page would surface to a `fetch()` caller as an opaque parse error. Page routes keep redirecting. Both behaviors live in the same `onRequest`, so the guard must branch on `pathname.startsWith("/api")` before choosing its response.

**Candidate counts and RLS asymmetry.** The list's candidate count must be derived from `candidate_recruitments`, not `candidates`, because only the former is recruitment-scoped. A user with `recruitment.read` but not `candidate.read` still gets correct counts and column headers while individual cards would have no name — degrade to showing the count and omitting unnamed cards rather than rendering blanks.

**Stage grouping must be driven by the stage list, not by the candidate rows.** Iterate the ordered stages and bucket candidates into them, so a stage with zero candidates still renders as an empty column. Grouping by what candidates return would silently drop `Rejected` — the one column seed data leaves empty, and therefore the case most likely to ship broken.

## Phase 1: Data & Type Foundation

### Overview

Rename default stages to English, generate typed database bindings, define shared DTOs, and repair the quality gates so later phases are actually verified.

### Changes Required:

#### 1. English default stage names

**File**: `supabase/migrations/<timestamp>_rename_default_kanban_stages_to_english.sql`

**Intent**: Rename the six global default stages from Polish to English so the board renders English text, per the `context/foundation/lessons.md` English-artifacts rule.

**Contract**: Updates `kanban_stages.name` for rows where `recruitment_id is null`, keyed by `sort_order` so the mapping is unambiguous: 1→`New`, 2→`Screening`, 3→`Interview`, 4→`Offer`, 5→`Hired`, 6→`Rejected`. Touches no schema, no constraints, and no other table.

#### 2. Seed data alignment

**File**: `supabase/seed.sql`

**Intent**: Update the stage-name lookups so seeding a fresh database produces the same English names and the candidate-to-stage mapping still resolves.

**Contract**: The `select id from kanban_stages where name = ...` lookups switch to the English names. Candidate-to-stage assignments stay as they are: 5 candidates across `New`…`Hired`, leaving `Rejected` empty.

#### 3. Generated database types

**File**: `src/db/database.types.ts` (generated, committed)

**Intent**: Produce the `Database` type from the live local schema so query results are typed and `no-unsafe-*` stops firing.

**Contract**: Output of `supabase gen types typescript --local`. Committed so CI and fresh clones typecheck without a running database. Exposed via an npm script `db:types` for regeneration after future migrations.

#### 4. Typed Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Parameterize the existing client factory with the generated `Database` type so every consumer inherits typed tables.

**Contract**: `createServerClient<Database>(...)`; the exported `createClient(requestHeaders, cookies)` signature and its `null` return when env vars are missing both stay unchanged.

#### 5. Shared DTOs

**File**: `src/types.ts` (new)

**Intent**: Define the wire types the endpoints return and the UI consumes — the first entries in the file CLAUDE.md mandates.

**Contract**: `RecruitmentStatus` — **hand-written** as a zod enum (`"draft" | "live" | "closed"`) with the TS union inferred from it. Do **not** try to derive this from the generated types: the column is `text` + CHECK, not a Postgres enum, so the generator emits `status: string` (verified). That zod enum is the single source for the DTO type, the endpoint's query validation, and the UI filter options; the service parses DB rows through it to narrow `string` → union. Because the union can drift from the CHECK constraint, any future migration touching allowed statuses must update it in the same commit. (Contrast: `operation` *is* a real enum and does generate a union — that asymmetry is what makes this easy to get wrong.) Then: `RecruitmentListItemDto` (id, title, department, location, openedAt, status, candidateCount); `KanbanStageDto` (id, name, sortOrder); `CandidateCardDto` (id, fullName, addedAt); `KanbanBoardDto` (recruitment summary + ordered stages, each with its candidates and count); `ApiErrorBody` (`{ error: { code, message } }`). DTO field names are camelCase; mapping from the snake_case DB rows happens in the service layer.

#### 6. Dependencies

**File**: `package.json`

**Intent**: Add zod for endpoint input validation per CLAUDE.md, and scripts for typechecking and type generation.

**Contract**: Adds `zod` to dependencies; adds scripts `typecheck` (`astro check`) and `db:types`. `@astrojs/check` is already a dependency but nothing invoked it.

#### 7. CI repair

**File**: `.github/workflows/ci.yml`

**Intent**: Make CI actually run on this repository's branch and gate on typechecking, so the `strictTypeChecked` risks in later phases are caught automatically.

**Contract**: Branch filter changes `master` → `main` for both `push` and `pull_request`; a `npm run typecheck` step is added after `astro sync` and before `lint`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a reset: `npx supabase db reset`
- Default stages are English: querying `kanban_stages where recruitment_id is null order by sort_order` returns New, Screening, Interview, Offer, Hired, Rejected
- Type generation succeeds and is committed: `npm run db:types` produces no diff
- Typechecking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Seed data still loads after `db reset` with 5 candidates spread across stages and `Rejected` empty
- Existing sign-in / sign-out flow still works (typed client did not break auth)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: API Endpoints & Service Layer

### Overview

Gate `/api`, establish the error contract, and expose the two read endpoints backed by a service module.

### Changes Required:

#### 1. Route protection

**File**: `src/middleware.ts`

**Intent**: Protect the new product routes and close the blanket `/api` hole, returning JSON rather than a redirect for API callers.

**Contract**: `PROTECTED_ROUTES` gains `"/recruitments"`. A separate check guards `"/api/"` — excluding `/api/auth/` so sign-in and sign-up remain reachable — and returns a 401 `ApiErrorBody` response instead of `context.redirect`. Page-route behavior is unchanged.

#### 2. Error contract helpers

**File**: `src/lib/api-response.ts` (new)

**Intent**: Centralize JSON success and error responses so all endpoints (this slice's and later slices') share one shape.

**Contract**: `jsonOk(data)` → 200 with the payload directly; `jsonError(status, code, message)` → the given status with `{ error: { code, message } }`. Codes used by this slice: `unauthenticated` (401), `not_found` (404), `invalid_request` (422), `internal` (500), `supabase_unconfigured` (500).

#### 3. Recruitments service

**File**: `src/lib/services/recruitments.ts` (new)

**Intent**: Hold the queries and the row-to-DTO mapping, so endpoints stay thin and the logic is unit-testable without HTTP.

**Contract**: Two exported functions taking a typed `SupabaseClient` plus arguments:
- `listRecruitments(client, { status })` → `RecruitmentListItemDto[]`, ordered by `opened_at` descending with `created_at` as tiebreaker, filtered by status when provided. Candidate counts come from `candidate_recruitments` (see Critical Implementation Details), not from `candidates`.

  **Counts must be a single query — no per-row count calls.** Use PostgREST's embedded aggregate: `select("id, title, department, location, opened_at, status, candidate_recruitments(count)")`. Verified against the running database; it returns the count array-wrapped, e.g. `"candidate_recruitments": [{ "count": 5 }]`, so the mapper reads `row.candidate_recruitments[0]?.count ?? 0`. RLS still applies to the embedded table, so counts stay correctly scoped. Typed inference over embedded aggregates is awkward — declare a narrow local row type for this select rather than widening with a cast.
- `getKanbanBoard(client, recruitmentId)` → `KanbanBoardDto | null`, returning `null` when the recruitment is not visible or does not exist. Stages are read via `recruitment_id is null order by sort_order`; candidates are bucketed by iterating the stage list so empty stages survive.

Both surface Supabase `{ error }` values as thrown errors for the endpoint to convert; neither swallows them.

#### 4. List endpoint

**File**: `src/pages/api/recruitments/index.ts` (new)

**Intent**: Serve the filtered recruitment list.

**Contract**: `export const GET: APIRoute` plus `export const prerender = false`. Validates the optional `status` query param with a zod enum matching `RecruitmentStatus` (absent or `all` → no filter); an invalid value returns 422 `invalid_request`. Handles `createClient` returning `null` with 500 `supabase_unconfigured`. Returns `RecruitmentListItemDto[]`.

#### 5. Board endpoint

**File**: `src/pages/api/recruitments/[id]/board.ts` (new)

**Intent**: Serve one recruitment's kanban board.

**Contract**: `export const GET: APIRoute` plus `export const prerender = false`. Validates `params.id` as a positive integer via zod (non-numeric → 422). A `null` service result → 404 `not_found`, used for both forbidden and missing. Returns `KanbanBoardDto`.

### Success Criteria:

#### Automated Verification:

- Typechecking passes: `npm run typecheck`
- Linting passes: `npm run lint` (no `no-unsafe-*` or `no-floating-promises` errors)
- Build passes: `npm run build`

#### Manual Verification:

- `curl` without a session cookie on `/api/recruitments` returns 401 JSON, not an HTML redirect
- `/api/auth/signin` still works (the `/api` guard did not break auth)
- Signed in as `hr.test@example.com`: list returns the seeded `Backend Engineer`; board returns 6 stages with `Rejected` present and empty
- Signed in as `admin.test@example.com`: list returns `[]` and the board id returns 404
- `?status=closed` returns `[]`; `?status=bogus` returns 422; a non-numeric board id returns 422

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Vitest & Service Tests

### Overview

Introduce unit testing and cover the data-shaping logic six later slices will reuse.

### Changes Required:

#### 1. Test framework

**File**: `vitest.config.ts` (new), `package.json`

**Intent**: Add Vitest configured for the `@/*` path alias so service modules import identically to production code.

**Contract**: Adds `vitest` (and `@vitest/coverage-v8` if coverage is wanted) as devDependencies plus a `test` script. Config resolves `@` → `./src` and restricts includes to `src/**/*.test.ts`.

#### 2. Service tests

**File**: `src/lib/services/recruitments.test.ts` (new)

**Intent**: Pin the mapping and grouping rules that the UI depends on, without needing a database.

**Contract**: Tests drive `listRecruitments` and `getKanbanBoard` against a hand-rolled stub client returning fixture rows. Cases: status filter passthrough and the no-filter path; snake_case → camelCase DTO mapping; candidate counts derived from link rows; **a stage with zero candidates still appears as an empty column**; stage ordering follows `sort_order`; `getKanbanBoard` returns `null` on an empty recruitment result; a Supabase `{ error }` value propagates as a throw.

#### 3. Lint scope

**File**: `eslint.config.js`

**Intent**: Keep test files inside the typed lint program without weakening the rules that protect production code.

**Contract**: Test files are linted under the same `strictTypeChecked` config — **no override is added**. Where a stub would otherwise trip `no-unsafe-*`, write a small typed builder returning the generated row type instead of an untyped literal. The only change here is ensuring the ESLint `projectService` picks up `vitest.config.ts` and the test files (add them to the tsconfig include if `astro check` or the lint run reports them as outside the project).

#### 4. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Run unit tests on every push and PR.

**Contract**: A `npm run test` step after `typecheck`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- The empty-column test fails when grouping is inverted to iterate candidates instead of stages (verify by temporarily breaking it)
- Linting passes on test files: `npm run lint`
- Typechecking passes: `npm run typecheck`

#### Manual Verification:

- CI run on a pushed branch shows typecheck and test steps executing (confirms the `main` filter fix from phase 1)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: UI Foundation & Recruitment List

### Overview

Activate the dark token set, install the needed shadcn components, and ship `/recruitments` with status filtering.

### Changes Required:

#### 1. Theme activation

**File**: `src/layouts/Layout.astro`

**Intent**: Activate the existing shadcn dark token set so stock components match the established `bg-cosmic` glassmorphism instead of rendering light-on-dark.

**Contract**: Adds the `dark` class to the `<html>` element, which switches on the `.dark` block already defined in [src/styles/global.css:41-73](../../../src/styles/global.css:41). No token values change. Blast radius is limited to `button.tsx`, the only shadcn component in use.

#### 2. shadcn components

**File**: `src/components/ui/{card,badge,select,skeleton}.tsx` (generated)

**Intent**: Install the primitives the list and board need.

**Contract**: `npx shadcn@latest add card badge select skeleton`. Adds `@radix-ui/react-select` as a dependency. Note that `components.json` points `aliases.hooks` at `@/hooks` while CLAUDE.md mandates `src/components/hooks/` — if the CLI scaffolds a hook, relocate it.

#### 3. Status presentation

**File**: `src/lib/recruitment-status.ts` (new)

**Intent**: Map stored lowercase status values to display labels and badge variants in one place, shared by list and board.

**Contract**: Exports an ordered filter option list (`All`, `Draft`, `Live`, `Closed`) and a label/variant lookup keyed by `RecruitmentStatus`. The `All` option carries no status value.

#### 4. Shared fetch hook

**File**: `src/components/hooks/useApiResource.ts` (new)

**Intent**: Give both islands one typed way to fetch a JSON endpoint and handle its states, so the `res.ok` branch, the `ApiErrorBody` parse and the 401 path exist in a single place. Also establishes `src/components/hooks/`, the directory CLAUDE.md mandates and which does not yet exist.

**Contract**: A generic hook taking a URL and returning discriminated state — loading / success with typed data / not-found / error — refetching when the URL changes. Two behaviors it centralizes:
- **401 → redirect to `/auth/signin`**, not the generic error state. The page is server-protected, but the island fetches afterwards; if the session expires in between, the `/api` guard returns 401 JSON and the user must be sent to sign in rather than shown "failed to load".
- **404 → a distinct not-found state**, so the board can render its own not-found view instead of a generic error.

Consumed by both islands in this phase and phase 5. Keep it minimal — no caching, no retries, no global store.

#### 5. List page shell

**File**: `src/pages/recruitments/index.astro` (new)

**Intent**: Provide the protected page shell and hand the initial filter from the URL to the island.

**Contract**: Uses `Layout`, reads `Astro.locals.user` (middleware guarantees it), and reads the `status` search param, passing it as the island's initial value. Renders the island with `client:load`, matching the only hydration pattern in the repo.

#### 6. List island

**File**: `src/components/recruitments/RecruitmentList.tsx` (new)

**Intent**: Render the filterable list on top of `useApiResource`, owning only the presentational states.

**Contract**: Props: the initial status filter. Fetches `/api/recruitments` via `useApiResource` with the status param, re-fetching on filter change and syncing the choice into the URL via `history.replaceState` so the view is shareable and survives reload. Renders one row per recruitment (title, department, location, status badge, opened date, candidate count) linking to `/recruitments/<id>`. States: `Skeleton` rows while loading; an empty state distinguishing "no recruitments visible to you" from "none match this filter"; an error state reusing the `ServerError` visual idiom from [src/components/auth/ServerError.tsx:10](../../../src/components/auth/ServerError.tsx:10). Dates render in a fixed `en-CA` (ISO-like) format to stay locale-stable.

### Success Criteria:

#### Automated Verification:

- Typechecking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests still pass: `npm run test`
- Build passes: `npm run build`

#### Manual Verification:

- Signed out, visiting `/recruitments` redirects to `/auth/signin`
- As `hr.test@example.com`, the list shows `Backend Engineer` with department, location, status badge and a candidate count of 5
- Filter chips work: `Live` shows the recruitment, `Draft` and `Closed` show the no-match empty state; the choice persists across a reload via the URL
- As `admin.test@example.com`, the list shows the "nothing visible to you" empty state, not an error
- Skeleton appears during load; existing dashboard and auth pages still look correct after `.dark` activation
- Clearing the session cookie in devtools and triggering a refetch redirects to `/auth/signin`, not the generic error state

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Kanban Board View

### Overview

Ship `/recruitments/[id]` as a read-only board — the slice's north-star outcome.

### Changes Required:

#### 1. Board page shell

**File**: `src/pages/recruitments/[id].astro` (new)

**Intent**: Provide the protected shell for one recruitment's board and pass the id to the island.

**Contract**: Uses `Layout`, passes `Astro.params.id` to the island, and renders a back link to `/recruitments`. Inherits protection from the `/recruitments` prefix added in phase 2. Does not itself query — the island fetches.

#### 2. Board island

**File**: `src/components/recruitments/KanbanBoard.tsx` (new)

**Intent**: Fetch and render the board: one column per stage, a count per header, a card per candidate.

**Contract**: Props: the recruitment id. Fetches `/api/recruitments/<id>/board` via the `useApiResource` hook from phase 4, inheriting its 401-redirect and not-found handling. Renders the recruitment title and status badge above a horizontally scrollable row of columns in `sort_order`, each header showing the stage name and candidate count, each card showing `fullName` and the added date (labelled as date added, per FR-010 — not "application date"). States: skeleton columns while loading; a per-column empty state so `Rejected` renders visibly empty; a not-found state on 404 offering the back link; the shared error state otherwise. Cards are **not** interactive and not draggable — no stage mutation exists until S-04.

#### 3. Navigation entry point

**File**: `src/pages/dashboard.astro`

**Intent**: Make the new feature reachable, since there is no nav component on protected pages.

**Contract**: Adds a link to `/recruitments` alongside the existing sign-out form, styled with the page's existing glass-panel idiom.

### Success Criteria:

#### Automated Verification:

- Typechecking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests still pass: `npm run test`
- Build passes: `npm run build`

#### Manual Verification:

- As `hr.test@example.com`, opening the seeded recruitment shows 6 columns in order New → Rejected, counts summing to 5, and each card showing a name and date added
- `Rejected` renders as a visible, empty column — not omitted
- As `hiring-manager.test@example.com`, the identical board renders with no write affordances
- As `admin.test@example.com`, the same URL shows the not-found state, not an error or a blank board
- A nonexistent id (e.g. `999999`) shows the same not-found state; a non-numeric id does not crash the page
- Board and list both render within ~2s on the seeded dataset (NFR line 116), and the board scrolls horizontally without the page scrolling
- Verified in Chrome and one of Firefox/Edge (NFR line 118)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: Playwright E2E

### Overview

Cover US-01's acceptance criteria end to end, including the role cases that unit tests cannot reach.

### Changes Required:

#### 1. Framework

**File**: `playwright.config.ts` (new), `package.json`

**Intent**: Add Playwright driving a real browser against the dev server and local Supabase.

**Contract**: Adds `@playwright/test` as a devDependency and a `test:e2e` script. Config uses a `webServer` entry to start `npm run dev`, a single Chromium project (NFR requires Chrome, Firefox and Edge — the latter two stay manual to keep CI lean), and a `tests/e2e` directory excluded from the Vitest include glob so the two runners never collide.

#### 2. Auth helper

**File**: `tests/e2e/support/auth.ts` (new)

**Intent**: Sign in as a named seeded user without duplicating form steps in every spec.

**Contract**: A helper taking a page and one of the three seeded emails, submitting the sign-in form with `password123`. Resolves users by email only — **ids are sequence-assigned and must not be hardcoded**.

#### 3. Specs

**File**: `tests/e2e/recruitments.spec.ts` (new)

**Intent**: Assert the user-visible contract of US-01 across all three roles.

**Contract**: Cases: unauthenticated visit to `/recruitments` redirects to sign-in; HR sees the recruitment and opens the board; the board shows 6 ordered columns with counts summing to 5 and cards bearing a name and date; `Rejected` is present and empty; the status filter narrows and clears correctly and survives reload; Hiring Manager sees the same board; Administrator sees the empty list and a not-found board. Assertions target accessible roles and text, not CSS classes.

#### 4. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Run E2E in CI against a local Supabase stack.

**Contract**: Adds a job starting Supabase via `supabase start` (CLI action), applying migrations and seed, installing Playwright browsers with `--with-deps`, and running `test:e2e`. `SUPABASE_URL` / `SUPABASE_KEY` point at the local stack for the dev server. **The job runs unconditionally and a failure is a real failure to fix** — no opt-out condition, no local-only fallback. If the stack proves slow to provision, address it with caching, not by gating the job.

### Success Criteria:

#### Automated Verification:

- E2E suite passes locally against a seeded local Supabase: `npm run test:e2e`
- Unit and E2E runners do not pick up each other's files: `npm run test` and `npm run test:e2e` each report only their own specs
- Linting passes on test files: `npm run lint`
- Typechecking passes: `npm run typecheck`
- The CI job regenerates `src/db/database.types.ts` against the running stack and fails on a non-empty diff (verify by committing a deliberately stale file once)

#### Manual Verification:

- CI run shows the E2E job passing — unconditionally, with no gating condition
- Deliberately breaking stage grouping (iterating candidates instead of stages) makes the `Rejected`-column spec fail

**Implementation Note**: This is the final phase. After verification, the change is ready for `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests (Vitest, phase 3)

- Status filter passthrough and the unfiltered path
- snake_case row → camelCase DTO mapping
- Candidate counts derived from `candidate_recruitments`, not `candidates`
- **Stages with zero candidates still render as columns** — the highest-value assertion, since seed data's empty `Rejected` column is the case most likely to ship broken
- Stage ordering by `sort_order`
- `getKanbanBoard` → `null` for an invisible or missing recruitment
- Supabase `{ error }` propagates as a throw rather than an empty result

### Integration / E2E Tests (Playwright, phase 6)

- Unauthenticated redirect
- HR: list → board navigation, column count and ordering, counts, card contents
- Hiring Manager: identical read-only board
- Administrator: empty list, not-found board
- Filter behavior including URL persistence

### Manual Testing Steps

1. `npx supabase db reset` to reapply migrations and seed.
2. Sign in as `hr.test@example.com` / `password123`; confirm the list row shows title, department, location, `Live` badge and count 5.
3. Exercise each filter chip; reload to confirm the URL preserves the choice.
4. Open the recruitment; confirm 6 English columns New → Rejected, counts summing to 5, each card with name and date added, `Rejected` visibly empty.
5. Repeat as `hiring-manager.test@example.com` — identical board, no write controls.
6. Repeat as `admin.test@example.com` — empty list, not-found board.
7. Sign out; confirm `/recruitments` redirects and `curl /api/recruitments` returns 401 JSON.
8. Try `/recruitments/999999` and `/recruitments/abc` — not-found state and no crash.
9. Confirm the dashboard and auth pages still look right after `.dark` activation.
10. Repeat step 4 in Firefox or Edge.

## Performance Considerations

The `<2s` NFR (PRD line 116) has no defined load target — roadmap open questions 1 and 2 (QPS, data volume) are unanswered and non-blocking — so it is verified at seed scale only.

Two known characteristics worth recording rather than optimizing now:
- **`recruitments` has no index beyond its PK.** The list's status filter and ordering are sequential scans. Fine at seed scale; if the list slows once S-02 creates real volume, an index on `(status, opened_at desc)` is the obvious first move.
- **The client-fetch architecture adds a round-trip after hydration**, so perceived load is hydration + fetch rather than a single server render. Skeletons cover the gap. If the NFR is ever measured under load, this is the first thing to revisit.

RLS helpers are `stable` and their calls are `(select ...)`-wrapped, so they evaluate per query rather than per row — S-01 inherits that posture for free.

## Migration Notes

**Generated types must be regenerated with every future migration.** `src/db/database.types.ts` is committed, so a stale file still typechecks cleanly — the mismatch surfaces at runtime, not at build time. Six slices of migrations are queued behind this one, so the rule matters beyond S-01: any commit adding a migration also runs `npm run db:types`. The CI job enforces it by regenerating against the local stack and failing on a non-empty `git diff` of that file (added in the phase 6 CI job, where Supabase is already running).

The stage rename is a data-only `update` on six rows with `recruitment_id is null`. It is safe because nothing references stage names — `candidate_recruitments.current_stage_id` is a FK on `id`, and no per-recruitment override rows can exist (no write grant). No rollback migration is needed; reverting is a symmetric `update`. `supabase/seed.sql` must change in the same commit or a fresh `db reset` will fail its stage lookups.

## References

- Related research: [research.md](research.md)
- Upstream slice definition: [context/foundation/roadmap.md:91-102](../../foundation/roadmap.md:91)
- English-artifacts rule: [context/foundation/lessons.md](../../foundation/lessons.md)
- Schema contract: [context/changes/core-recruitment-data-foundation/plan.md](../core-recruitment-data-foundation/plan.md)
- Hydration pattern to follow: [src/pages/auth/signin.astro:5,16](../../../src/pages/auth/signin.astro:5)
- Error-display idiom to reuse: [src/components/auth/ServerError.tsx:10](../../../src/components/auth/ServerError.tsx:10)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data & Type Foundation

#### Automated

- [x] 1.1 Migration applies cleanly on a reset — 8e8fd17
- [x] 1.2 Default stages are English in sort_order — 8e8fd17
- [x] 1.3 Type generation succeeds and is committed with no diff — 8e8fd17
- [x] 1.4 Typechecking passes — 8e8fd17
- [x] 1.5 Linting passes — 8e8fd17
- [x] 1.6 Build passes — 8e8fd17

#### Manual

- [x] 1.7 Seed data loads after db reset with Rejected empty — 8e8fd17
- [x] 1.8 Existing sign-in / sign-out still works — 8e8fd17

### Phase 2: API Endpoints & Service Layer

#### Automated

- [x] 2.1 Typechecking passes — d9855c8
- [x] 2.2 Linting passes with no no-unsafe-* or no-floating-promises errors — d9855c8
- [x] 2.3 Build passes — d9855c8

#### Manual

- [x] 2.4 Unauthenticated /api/recruitments returns 401 JSON — d9855c8
- [x] 2.5 /api/auth/signin still works — d9855c8
- [x] 2.6 HR user: list and board return seeded data with Rejected present and empty — d9855c8
- [x] 2.7 Admin user: list empty, board 404 — d9855c8
- [x] 2.8 Filter and id validation return 422 / empty as specified — d9855c8

### Phase 3: Vitest & Service Tests

#### Automated

- [x] 3.1 Unit tests pass — 2ac3462
- [x] 3.2 Empty-column test fails when grouping is inverted — 2ac3462
- [x] 3.3 Linting passes on test files — 2ac3462
- [x] 3.4 Typechecking passes — 2ac3462

#### Manual

- [x] 3.5 CI run shows typecheck and test steps executing

### Phase 4: UI Foundation & Recruitment List

#### Automated

- [x] 4.1 Typechecking passes — 0f42535
- [x] 4.2 Linting passes — 0f42535
- [x] 4.3 Unit tests still pass — 0f42535
- [x] 4.4 Build passes — 0f42535

#### Manual

- [x] 4.5 Signed out, /recruitments redirects to sign-in — 0f42535
- [x] 4.6 HR list shows recruitment with metadata and count 5 — 0f42535
- [x] 4.7 Filter chips work and persist across reload — 0f42535
- [x] 4.8 Admin sees empty state, not an error — 0f42535
- [x] 4.9 Skeleton appears during load; existing pages still correct after .dark — 0f42535
- [x] 4.10 Expired session on refetch redirects to /auth/signin, not the error state — 0f42535

### Phase 5: Kanban Board View

#### Automated

- [x] 5.1 Typechecking passes — 7cb73c4
- [x] 5.2 Linting passes — 7cb73c4
- [x] 5.3 Unit tests still pass — 7cb73c4
- [x] 5.4 Build passes — 7cb73c4

#### Manual

- [x] 5.5 HR board shows 6 ordered columns, counts summing to 5, name and date per card — 7cb73c4
- [x] 5.6 Rejected renders as a visible empty column — 7cb73c4
- [x] 5.7 Hiring Manager sees identical read-only board — 7cb73c4
- [x] 5.8 Admin user sees not-found for the same recruitment URL — 7cb73c4
- [x] 5.9 Nonexistent id shows not-found; non-numeric id does not crash — 7cb73c4
- [x] 5.10 Views render within ~2s at seed scale; board scrolls horizontally — 7cb73c4
- [x] 5.11 Verified in Chrome plus Firefox or Edge — 7cb73c4

### Phase 6: Playwright E2E

#### Automated

- [x] 6.1 E2E suite passes locally against seeded Supabase
- [x] 6.2 Unit and E2E runners do not collect each other's files
- [x] 6.3 Linting passes on test files
- [x] 6.4 Typechecking passes
- [x] 6.5 CI fails on a stale committed database.types.ts (type-drift guard)

#### Manual

- [x] 6.6 CI E2E job passes unconditionally, with no gating condition
- [x] 6.7 Breaking stage grouping makes the Rejected-column spec fail
