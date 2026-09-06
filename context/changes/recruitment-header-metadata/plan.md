# Recruitment Header Metadata Implementation Plan

## Overview

Surface a recruitment's `location`, `department`, `employment_type` and `opened_at` in a
header above the Kanban board, rendered server-side into AppShell's currently-empty
`page-title` slot. This is roadmap slice S-09, which `app-shell-navigation` (S-08)
explicitly deferred.

## Current State Analysis

The recruitment detail page has **no header at all**. `src/pages/recruitments/[id].astro`
reads `Astro.params` and delegates everything to `<KanbanBoard client:load />` — it fills
neither `page-title` nor `page-actions`, yet `AppShell.astro:45-48` unconditionally renders
the wrapper row for those slots. The result is a live empty `mb-6` row on every board page.

The only recruitment-level chrome today lives inside the React island at
`src/components/recruitments/KanbanBoard.tsx:137-152`: an `<h1>` with the title, a status
`Badge`, and three action triggers (`StatusControl`, `StageEditor`, `AddCandidateDialog`).
All of it appears only after the client-side `useApiResource` fetch resolves.

The four columns this slice needs already exist on the `recruitments` table
(`supabase/migrations/20260831182957_recruitment_candidate_schema.sql:13-23`), all nullable.
Nothing selects them for a single recruitment: `getKanbanBoard` selects `id, title, status`
(`src/lib/services/recruitments.ts:218`), and `listRecruitments` selects the detail fields
but is a list query with no id filter and omits `employment_type` entirely
(`src/lib/services/recruitments.ts:46`).

## Desired End State

Opening `/recruitments/{id}` renders, immediately and without waiting on client hydration, a
header showing the recruitment's title as the page's single `<h1>`, followed by a metadata
row listing whichever of department, location, employment type and opened date have values.
The browser tab shows the recruitment's title rather than the generic "Recruitment board".
The Kanban board, status badge, and all three action controls behave exactly as they do
today.

Verify by loading a board page with JavaScript disabled: the title and metadata must be
present in the server HTML. Re-enable JS, change status via `StatusControl`, and confirm the
badge updates without a page reload and without the header going stale.

### Key Discoveries:

- `AppShell.astro:45-48` already renders the `page-title` / `page-actions` row — this page
  just never filled it, so no layout work is needed to make a header appear.
- **No `.astro` page in this repo has ever fetched data server-side.** Every page reads only
  `Astro.params` / `Astro.url` / `Astro.locals` and delegates to a client island. This slice
  sets that precedent.
- There is **no `Astro.locals.supabase`**. `src/middleware.ts:47` builds a client per request
  but never attaches it. Pages must call `createClient(Astro.request.headers, Astro.cookies)`
  from `src/lib/supabase.ts:6`, which returns `SupabaseClient<Database> | null` when env vars
  are unset — the null branch must be handled.
- There is **no `src/pages/404.astro`**. The established page-level pattern for "record not
  available" is an inline block, as in `src/pages/admin/groups/[id].astro:33-36`, mirroring
  `NotFoundState()` at `KanbanBoard.tsx:42-51`.
- `tests/e2e/recruitments.spec.ts:145,151,155` asserts on an **unscoped**
  `page.locator('[data-slot="badge"]')` that expects exactly one badge on the page. Keeping
  the status badge client-side (and adding none to the header) preserves this.
- `tests/e2e/recruitments.spec.ts:144` asserts the title heading **by accessible name**, not
  by level, so moving the `<h1>` from React to Astro keeps it passing — and makes it pass
  earlier, before hydration.
- `tests/e2e/recruitments.spec.ts:129-131` already fills Department, Location and Opened date
  when creating the E2E recruitment, and `employmentType` has a form default
  (`CreateRecruitmentForm.tsx:55`). **No seed fixture changes are needed** for the populated
  case.
- `CreateRecruitmentCommand` (`src/types.ts:50-57`) makes all four fields required, so a
  recruitment created through the app never has nulls. The null-omission behavior is only
  reachable from seed/direct DB rows — it belongs in the service unit test, not E2E.
- `EMPLOYMENT_TYPE_LABELS` already exists but is trapped as a local const at
  `CreateRecruitmentForm.tsx:20`. `STATUS_PRESENTATION` in `@/lib/recruitment-status` is the
  repo's precedent for a shared presentation map.
- `src/lib/services/recruitments.test.ts` already exists with a `FakeQueryBuilder` harness
  covering `getKanbanBoard`, `listRecruitments`, `createRecruitment` and
  `updateRecruitmentStatus` — the new function's tests extend it rather than starting fresh.
- `formatDate` at `KanbanBoard.tsx:24` establishes `en-CA` (YYYY-MM-DD) as this app's date
  rendering.

## What We're NOT Doing

- **No migration.** All four columns already exist and are already nullable.
- **No change to the status badge, `StatusControl`, `StageEditor` or `AddCandidateDialog`.**
  They stay exactly where they are inside `KanbanBoard.tsx`. Nothing status-related is
  server-rendered.
- **No `page-actions` slot usage.** Moving the action islands out of `KanbanBoard` would
  require plumbing `recruitmentId` and the refetch callback across the Astro/React boundary;
  that is not this slice's outcome.
- **No "…" overflow/actions menu**, despite S-08's deferral note mentioning one. The roadmap
  outcome for S-09 names only the four metadata fields.
- **No editing of metadata from the header.** Read-only display.
- **No changes to `getKanbanBoard` or the `/board` endpoint.** It keeps returning
  `id, title, status`; the header is fed by a separate query.
- **No candidate-detail page header** (`[id]/candidates/[candidateId].astro`) — out of scope.
- **No new design tokens.** Existing `--foreground` / `--muted-foreground` cover this surface.

## Implementation Approach

Add a second, deliberately narrow read path for the header rather than widening
`KanbanBoardDto`. The header's data (title + four static fields) never changes during a
session, so it is a natural fit for a one-shot server render; the board's data (stages,
candidates, status) mutates constantly and stays on the client refetch path it already uses.

Splitting on that mutability line is what makes the dual fetch safe: because no
status-dependent chrome is server-rendered, a `StatusControl` mutation followed by
`resource.refetch()` cannot leave a stale server-rendered element behind. Had the badge moved
into the Astro header, the same mutation would have required a full page reload.

The cost is that `title` is fetched twice per page load. That is accepted — it buys an
instantly-visible header, a meaningful browser tab title, and a header that renders without
JavaScript.

## Critical Implementation Details

**Ordering within Phase 2.** The `<h1>` must be added to `[id].astro` and removed from
`KanbanBoard.tsx:140` in the same commit. Landing either half alone leaves the page with
two `<h1>`s or none, and the E2E heading assertion at `recruitments.spec.ts:144` cannot
distinguish the two states — it matches by name and would pass with a duplicate.

**RLS parity.** The page-level client is built from the same request cookies as the API
route's, so row-level security applies identically. A recruitment the user cannot see comes
back as `null` from `maybeSingle()`, which must render the same not-found block as a
genuinely missing id — do not distinguish the two, since doing so would leak existence.

## Phase 1: Recruitment detail data layer

### Overview

Add a single-recruitment query returning the four metadata fields, with unit coverage for the
nullable and not-found paths. No UI touches this phase; it lands green and independently
verifiable.

### Changes Required:

#### 1. Detail DTO

**File**: `src/types.ts`

**Intent**: Add the DTO the header consumes. Keep it separate from `KanbanBoardDto` so the
board's contract is untouched.

**Contract**: New `RecruitmentDetailDto` interface. Field names must match the existing
`RecruitmentListItemDto` (`src/types.ts:73-81`) precedent exactly — `department`, `location`,
`openedAt` as `string | null` — plus `employmentType: EmploymentType | null`. Include `id`,
`title` and `status`. `employmentType` is nullable in the DTO even though
`employmentTypeSchema` is a closed enum, because the column has no NOT NULL constraint and
pre-existing rows may hold null or an unrecognized value.

#### 2. Detail query

**File**: `src/lib/services/recruitments.ts`

**Intent**: Fetch one recruitment's header fields. Follow the shape of `getRecruitmentStages`
(lines 162-178): `maybeSingle()`, throw on error, return `null` when absent.

**Contract**: `getRecruitmentDetail(client: Client, recruitmentId: number): Promise<RecruitmentDetailDto | null>`.
Selects `id, title, status, department, location, employment_type, opened_at`. Reuses
`toRecruitmentStatus()` (line 35) for `status`. Nulls pass through untransformed — the
omit-empty decision belongs to the view, not the query. An `employment_type` value that is
not one of `employmentTypeSchema.options` maps to `null` rather than throwing, so one bad row
cannot take down the page.

#### 3. Unit tests

**File**: `src/lib/services/recruitments.test.ts`

**Intent**: Cover the new function's branches using the file's existing `FakeQueryBuilder`
harness.

**Contract**: Cases — all four fields populated; a mix of populated and null; all four null;
row absent (returns `null`); query error (throws); unrecognized `employment_type` string
(yields `null` for that field, other fields intact).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Unit tests pass: `npx vitest run src/lib/services/recruitments.test.ts`
- Build succeeds: `npm run build`

#### Manual Verification:

- None for this phase — no user-visible change.

**Implementation Note**: This phase has no manual verification; proceed to Phase 2 once
automated checks pass.

---

## Phase 2: Server-rendered header

### Overview

Render the header from the Astro page, and remove the now-duplicate heading from the React
island. This is the user-visible change and the phase that sets the server-fetch precedent.

### Changes Required:

#### 1. Shared employment-type labels

**File**: `src/lib/employment-type.ts` (new), `src/components/recruitments/CreateRecruitmentForm.tsx`

**Intent**: The header and the create form need the same human-readable labels. Lift the map
out of the form so both consume one source, mirroring how `STATUS_PRESENTATION` lives in
`@/lib/recruitment-status`.

**Contract**: Export `EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string>` from the new
module, moved verbatim from `CreateRecruitmentForm.tsx:20`. The form imports it instead of
declaring it; its rendered option labels must not change.

#### 2. Header markup and server fetch

**File**: `src/pages/recruitments/[id].astro`

**Intent**: Fetch the recruitment in frontmatter and render title + metadata into the
`page-title` slot. Give the browser tab a meaningful title.

**Contract**: Frontmatter parses `Astro.params.id` to a number, builds a client via
`createClient(Astro.request.headers, Astro.cookies)`, and calls `getRecruitmentDetail`. Three
paths collapse to one not-found render: a non-numeric id, a null client, and a null result.
`<Layout title={...}>` receives the recruitment title (falling back to the existing
"Recruitment board" string when not found).

The `page-title` slot holds a single `<h1>` carrying the title, and beneath it a metadata row
that renders **only** the fields with values — a fully-null recruitment renders no row at
all, not an empty container. `openedAt` formats as YYYY-MM-DD, matching `formatDate` at
`KanbanBoard.tsx:24`. `employmentType` renders through `EMPLOYMENT_TYPE_LABELS`. Colors come
from `--foreground` (title) and `--muted-foreground` (metadata) per
`context/foundation/lessons.md`; no raw palette literals.

Each metadata entry must be independently readable — pair a label with its value rather than
emitting bare values, so a row showing only "Remote" is not ambiguous between location and
department. Introduce **no `<h2>`** in this slot: `recruitments.spec.ts:35-36,69-70` and
`kanban-stages.spec.ts:49-50` assert on level-2 headings for stage columns.

The not-found branch renders an inline block in the default slot following
`admin/groups/[id].astro:33-36`, and must not render `<KanbanBoard />`.

#### 3. Remove the duplicate heading

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: The title now lives in the Astro header; the island's `<h1>` would be a second
top-level heading.

**Contract**: Delete the `<h1>` at line 140. The `Badge` (141-143), `StatusControl` (144),
`StageEditor` (145-150) and `AddCandidateDialog` (151) all stay, as does the flex row that
holds them. `recruitment.title` may become unused for rendering — `recruitment.id` is still
needed for the candidate links at line 171. `NotFoundState` (42-51) stays as the client-side
fallback for a board API 404.

### Success Criteria:

#### Automated Verification:

- Type checking and linting pass: `npm run lint`
- Existing unit tests still pass: `npx vitest run`
- Build succeeds: `npm run build`
- Existing E2E suite still passes: `npx playwright test tests/e2e/recruitments.spec.ts`

#### Manual Verification:

- Board page shows title and metadata row with all four fields for a fully-populated recruitment
- A recruitment with some null fields shows only the populated ones, with no gaps or stray separators
- Page source (JS disabled) contains the title and metadata — confirming server render
- Browser tab shows the recruitment title
- Exactly one `<h1>` on the page, and the status badge appears exactly once
- Changing status via `StatusControl` updates the badge without a page reload and leaves the header intact
- An unknown recruitment id shows the not-found block and no Kanban board
- Header is readable in both light and dark themes, and wraps sensibly at mobile width

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: End-to-end coverage

### Overview

Lock the header's behavior into the E2E suite, including the single-badge invariant that the
existing spec silently depends on.

### Changes Required:

#### 1. Board header assertions

**File**: `tests/e2e/recruitments.spec.ts`

**Intent**: Assert the metadata the created recruitment carries, and pin the invariants that
future header changes could break.

**Contract**: Extend the existing create-and-open flow (lines 118-155), which already fills
Department "Engineering", Location "Remote" and Opened date "2026-02-01". After the existing
heading assertion at line 144, assert those three values plus the employment-type label are
visible in the header. Add an explicit assertion that `[data-slot="badge"]` resolves to
exactly one element, making the assumption behind lines 145/151/155 explicit rather than
incidental. Assert exactly one `<h1>`.

Locators follow the repo rule — `getByRole` / `getByLabel` / `getByText` first, never CSS or
DOM structure. The one exception is the pre-existing `[data-slot="badge"]` locator, which
this phase pins but does not introduce. No `page.waitForTimeout()`; the header is
server-rendered, so it is present on navigation without waiting for hydration.

### Success Criteria:

#### Automated Verification:

- Full E2E suite passes: `npx playwright test`
- Linting passes: `npm run lint`

#### Manual Verification:

- E2E suite passes on a re-run without manual DB cleanup between runs

---

## Testing Strategy

### Unit Tests:

- `getRecruitmentDetail`: all fields populated; partial nulls; all nulls; row absent; query
  error; unrecognized `employment_type` value.

### Integration Tests:

- Covered by E2E — the server-render path exercises page → `createClient` → service →
  Supabase in one flow, which no unit test can reach.

### Manual Testing Steps:

1. Open a fully-populated recruitment board; confirm title + four metadata fields render.
2. Disable JavaScript, reload; confirm title and metadata are still present.
3. Via SQL, null out `location` and `employment_type` on that recruitment; reload; confirm
   only department and opened date render, with no leftover separators.
4. Null all four; confirm the metadata row disappears entirely and the title still renders.
5. Change status via `StatusControl`; confirm badge updates in place and the header does not
   flicker, reload, or go stale.
6. Visit `/recruitments/999999`; confirm the not-found block renders and no board appears.
7. Toggle light/dark; confirm header contrast in both.
8. Narrow to mobile width; confirm the metadata row wraps rather than overflowing.

## Performance Considerations

One additional round-trip per board page load, for a single indexed primary-key lookup
returning one row. It runs server-side in the same request as the page render, so it costs
no extra client latency and is not on the critical path for interactivity. Net perceived
performance improves: the title and metadata now paint with the initial HTML instead of
after the board fetch resolves.

## Migration Notes

None. No schema change, no data backfill. Existing rows with null metadata are handled by
the omit-empty rule.

## References

- Research: `context/changes/recruitment-header-metadata/research.md`
- Deferral that scoped this slice: `context/changes/app-shell-navigation/plan.md` ("What We're NOT Doing")
- Roadmap item S-09: `context/foundation/roadmap.md:58`
- Token rule: `context/foundation/lessons.md` ("Colors only through design tokens")
- Slot host: `src/components/AppShell.astro:45-48`
- Query shape to mirror: `src/lib/services/recruitments.ts:162-178` (`getRecruitmentStages`)
- Shared presentation-map precedent: `src/lib/recruitment-status.ts` (`STATUS_PRESENTATION`)
- Inline not-found precedent: `src/pages/admin/groups/[id].astro:33-36`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Recruitment detail data layer

#### Automated

- [x] 1.1 Type checking passes: `npm run lint` — d47cb72
- [x] 1.2 Unit tests pass: `npx vitest run src/lib/services/recruitments.test.ts` — d47cb72
- [x] 1.3 Build succeeds: `npm run build` — d47cb72

### Phase 2: Server-rendered header

#### Automated

- [x] 2.1 Type checking and linting pass: `npm run lint` — d3b23e6
- [x] 2.2 Existing unit tests still pass: `npx vitest run` — d3b23e6
- [x] 2.3 Build succeeds: `npm run build` — d3b23e6
- [x] 2.4 Existing E2E suite still passes: `npx playwright test tests/e2e/recruitments.spec.ts` — d3b23e6

#### Manual

- [x] 2.5 Board page shows title and metadata row with all four fields for a fully-populated recruitment — 84fc85b
- [x] 2.6 A recruitment with some null fields shows only the populated ones, with no gaps or stray separators — 84fc85b
- [x] 2.7 Page source (JS disabled) contains the title and metadata — confirming server render — 84fc85b
- [x] 2.8 Browser tab shows the recruitment title — 84fc85b
- [x] 2.9 Exactly one `<h1>` on the page, and the status badge appears exactly once — 84fc85b
- [x] 2.10 Changing status via `StatusControl` updates the badge without a page reload and leaves the header intact — 84fc85b
- [x] 2.11 An unknown recruitment id shows the not-found block and no Kanban board — 84fc85b
- [x] 2.12 Header is readable in both light and dark themes, and wraps sensibly at mobile width — 84fc85b

### Phase 3: End-to-end coverage

#### Automated

- [x] 3.1 Full E2E suite passes: `npx playwright test`
- [x] 3.2 Linting passes: `npm run lint`

#### Manual

- [x] 3.3 E2E suite passes on a re-run without manual DB cleanup between runs
