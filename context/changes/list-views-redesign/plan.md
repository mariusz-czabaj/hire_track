# List Views Redesign Implementation Plan

## Overview

Redesign the recruitment list, candidate list, and admin (security groups) list screens onto the shadow-card / serif-title / mobile-stacking visual language established by S-10 (kanban redesign) and S-08 (design brief), consolidate the duplicated status-pill visual styling shared between `RecruitmentList.tsx` and `KanbanBoard.tsx`'s `StatusControl`, and backfill test coverage for currently-unguarded empty states before/alongside touching their markup — while preserving the existing E2E-asserted strings and `data-testid="candidate-list"` byte-for-byte.

## Current State Analysis

All three screens already compose colors exclusively through design tokens (`cn()` + token-backed Tailwind classes) — there is no raw-palette-literal cleanup needed here. What's inconsistent is structural/typographic: list rows still use the pre-S-10 bordered `Card`, page titles are sans-serif `text-3xl font-bold` instead of the design-brief's serif ~40px spec, the recruitment list row has no responsive stacking, the admin screen uses a hand-rolled `<input>` instead of the shared `Input` primitive, and the status-filter button-group markup is duplicated (with different behavior — filter vs. mutate) between `RecruitmentList.tsx` and `KanbanBoard.tsx`. Test coverage today only guards 2 empty-state strings (`recruitments.spec.ts`) and one non-content-asserted `data-testid`; the candidate list's own empty-state string, the truncation hint, and the entire admin screen have zero coverage.

## Desired End State

All three list screens render shadow-based cards (`border-0`, `shadow-md`, left accent bar) matching the kanban board, serif bold ~40px page titles via `--font-serif`, and (for the recruitment list) mobile-stacking rows. The status-pill visual styling is defined once and consumed by both the recruitment-list filter and the kanban `StatusControl`, with each site keeping its own click-handler/state logic. The admin create-group form uses the shared `Input` component. New Playwright/component tests guard the candidate list's empty-state string, the truncation-hint string, and the admin screen's list/empty-state/authorization-gate copy. All pre-existing E2E assertions (`recruitments.spec.ts`, `candidate-history.spec.ts`) continue passing unmodified.

**Verification**: `npm run lint`, `npm run build`, and the full Playwright suite (`tests/e2e/**`) pass; manual visual check of all three screens in light/dark mode at desktop and mobile (< 768px) viewport widths.

### Key Discoveries:

- Card base classes: [src/components/ui/card.tsx:9](src/components/ui/card.tsx) — `bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm`. S-10's kanban card overrides this per-instance via `className="relative gap-1 overflow-hidden border-0 p-3 pl-4 shadow-md"` plus an absolutely-positioned accent bar div ([KanbanBoard.tsx:316-320](src/components/recruitments/KanbanBoard.tsx)) — the pattern to replicate on list rows, not a change to the shared `Card` component itself (kanban's board-cell usage still wants the default bordered look elsewhere, so this stays a per-usage `className` override).
- Status pill classes today: filter mode (`RecruitmentList.tsx:59-64`) uses `rounded-full border px-4 py-1.5 text-sm font-medium transition-colors`, active `border-accent bg-accent text-accent-foreground`, inactive `border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground`. Mutate mode (`KanbanBoard.tsx` `StatusControl`, lines 143-148) is nearly identical but `px-3 py-1 text-xs` plus `disabled:opacity-50`. A shared helper must accept a size variant (`sm`/`default`) and an `active`/`disabled` boolean, returning the composed class string via `cn()` — not a new stateful component.
- `data-testid="candidate-list"` is at [CandidateList.tsx:43](src/components/candidates/CandidateList.tsx) and must not move or be removed.
- Empty-state strings and their E2E coverage are fully inventoried in `research.md`'s table — treat as byte-for-byte contracts for `RecruitmentList.tsx:81` (both branches) and `recruitments.spec.ts` lines 52/56/102.
- `AppShell` ([AppShell.astro:1-53](src/components/AppShell.astro)) provides the `page-title` slot — serif title migration happens in each page's `.astro` file where the slot is filled, not inside the React island components.
- No pagination/cap+hint changes: recruitment list stays unbounded, candidate list's cap+hint (`CANDIDATE_LIST_RESULT_CAP = 50`, `src/lib/services/candidate-list.ts`) is untouched.
- `bg-cosmic` — confirmed zero usage on these 3 screens; no migration action needed here (noted as resolved/stale for this slice).

## What We're NOT Doing

- Not adding a cap+hint pattern to the recruitment list (stays unbounded).
- Not merging the recruitment-list filter and kanban `StatusControl` into one behavioral component — only their visual class-generation is shared.
- Not migrating any `bg-cosmic` usage elsewhere in the codebase (none found on these 3 screens).
- Not changing the candidate-search cap+hint mechanism or its 50-row limit.
- Not adding pagination anywhere.
- Not touching auth screens or `FormField`/`Banner.astro` (design-brief items E4/E6/E7) — out of scope for S-12.
- Not changing API contracts, service-layer code, or the `STATUS_FILTER_OPTIONS`/`STATUS_PRESENTATION` data layer.

## Implementation Approach

Work bottom-up: extract the shared status-pill styling helper first (Phase 1) since both later phases consume it. Then redesign each screen independently (Phases 2-4), each preserving its own byte-for-byte test contracts. Backfill new test coverage last (Phase 5) so it exercises the final, redesigned markup rather than needing a second pass — new tests are written to assert on the *preserved* strings/structure, so they can be written referencing the current source and validated once each screen's redesign phase lands.

## Phase 1: Shared Status-Pill Styling Helper

### Overview

Extract the duplicated status button-group visual styling into one shared helper so both the recruitment-list filter and the kanban `StatusControl` mutate-button render identical pill styling without duplicating the class strings.

### Changes Required:

#### 1. New shared styling helper

**File**: `src/lib/status-pill-styles.ts` (new)

**Intent**: Provide a single function that returns the composed Tailwind class string for a status pill/button, parameterized by active state, disabled state, and size, so both call sites import from one place instead of hand-rolling `cn()` calls with duplicated literals.

**Contract**: Export a function, e.g. `statusPillClasses({ active, disabled, size }: { active: boolean; disabled?: boolean; size: "default" | "sm" }): string`, built with `cn()` from `@/lib/utils`, covering the base pill shape (`rounded-full transition-colors`), the two size variants (`px-4 py-1.5 text-sm font-medium` vs `px-3 py-1 text-xs`), the active/inactive color pairs currently in `RecruitmentList.tsx:59-64` and `KanbanBoard.tsx:143-148`, and `disabled:opacity-50` when `disabled` is true.

#### 2. Recruitment list filter

**File**: `src/components/recruitments/RecruitmentList.tsx`

**Intent**: Replace the inline `cn()`/class-literal logic for each filter pill with a call to the new shared helper, passing `size: "default"`.

**Contract**: Lines 59-64's className expression is replaced by `statusPillClasses({ active, size: "default" })`; no change to the surrounding button markup, click handler, or `STATUS_FILTER_OPTIONS` iteration.

#### 3. Kanban `StatusControl`

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: Replace `StatusControl`'s inline pill classes with the shared helper, passing `size: "sm"` and the mutation's pending/disabled state.

**Contract**: Lines 143-148's className expression is replaced by `statusPillClasses({ active, disabled, size: "sm" })`; no change to `useMutation` wiring or PATCH behavior.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run build`
- [ ] Linting passes: `npm run lint`
- [ ] Existing recruitment E2E spec passes unchanged: `npx playwright test tests/e2e/recruitments.spec.ts`

#### Manual Verification:

- Recruitment list filter pills render identically to before (visual no-op at this phase)
- Kanban status-mutate buttons render identically to before (visual no-op at this phase)

---

## Phase 2: Recruitment List Redesign

### Overview

Migrate the recruitment list page title to serif styling, convert list rows to the shadow-based card language with an accent bar, and add mobile stacking — while preserving both empty-state strings and the client-side URL-sync filter behavior.

### Changes Required:

#### 1. Page title

**File**: `src/pages/recruitments/index.astro`

**Intent**: Apply the design-brief's serif bold ~40px title spec to the `page-title` slot content.

**Contract**: The `<h1>` (or equivalent) filling `AppShell`'s `page-title` slot gets `font-serif` (mapped to `--font-serif`/Fraunces) plus a bold ~40px size utility (e.g. `text-4xl font-bold`), replacing the current sans `text-3xl font-bold`.

#### 2. List row card + accent bar

**File**: `src/components/recruitments/RecruitmentList.tsx`

**Intent**: Convert each recruitment row from the bordered `Card` to the shadow-based style used by kanban's `DraggableCard`, adding a status-colored (or neutral, since recruitment status ≠ stage color) left accent bar for visual consistency with the new card language.

**Contract**: The row's `Card` className (currently implicit default) gets `border-0 shadow-md` plus `relative overflow-hidden` for the accent-bar positioning, matching `KanbanBoard.tsx:316`'s pattern. Row content (title, department/location, opened date, candidate count, badge) is unchanged. Empty-state markup/strings at line 81 remain byte-for-byte identical.

#### 3. Mobile stacking

**File**: `src/components/recruitments/RecruitmentList.tsx`

**Intent**: Make each row's internal layout stack vertically below the `sm` breakpoint instead of staying `flex-row` at all widths, closing design-brief item E1.

**Contract**: The row's flex container class changes from `flex flex-row items-center justify-between gap-4 p-4` (line 89) to a responsive variant, e.g. `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run build`
- [ ] Linting passes: `npm run lint`
- [ ] Existing recruitment E2E spec passes unchanged: `npx playwright test tests/e2e/recruitments.spec.ts`

#### Manual Verification:

- Recruitment list renders shadow-based cards with accent bar in both light and dark mode
- Page title renders in serif font at ~40px
- Recruitment list rows stack vertically below 768px viewport width and remain readable/usable
- Status filter pills still filter correctly and sync `?status=` in the URL
- Both empty-state strings ("No recruitments match this filter." / "No recruitments are visible to you.") still render correctly for their respective conditions

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Candidate List Redesign

### Overview

Migrate the candidate list page title to serif styling and convert list rows to the shadow-based card language, preserving `data-testid="candidate-list"`, the search/debounce behavior, and the cap+hint mechanism unchanged.

### Changes Required:

#### 1. Page title

**File**: `src/pages/candidates/index.astro`

**Intent**: Apply the same serif bold ~40px title treatment as the recruitment list, for visual consistency.

**Contract**: Same as Phase 2 item 1, applied to this page's `page-title` slot content.

#### 2. List row card styling

**File**: `src/components/candidates/CandidateList.tsx`

**Intent**: Convert each candidate row from the bordered `Card` to the shadow-based style, matching Phase 2's recruitment-list treatment.

**Contract**: Same `border-0 shadow-md relative overflow-hidden` + accent-bar treatment as Phase 2 item 2, applied to the row markup at lines 76-89. The root `data-testid="candidate-list"` (line 43) and the search input's `aria-label="Search candidates by name"` are untouched. The empty-state string (line 71) and the truncation-hint string (lines 90-94) remain byte-for-byte identical.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run build`
- [ ] Linting passes: `npm run lint`
- [ ] Existing candidate-history E2E spec passes unchanged: `npx playwright test tests/e2e/candidate-history.spec.ts`

#### Manual Verification:

- Candidate list renders shadow-based cards with accent bar in both light and dark mode
- Page title renders in serif font at ~40px
- Search-by-name still debounces and filters results correctly
- Truncation hint still appears when results are capped at 50
- Empty-state string still renders correctly when no candidates match

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Admin (Security Groups) List Redesign

### Overview

Migrate the admin list page title to serif styling, convert list rows to the shadow-based card language, and replace the hand-rolled `<input>` in the create-group form with the shared `Input` component.

### Changes Required:

#### 1. Page title

**File**: `src/pages/admin/groups/index.astro`

**Intent**: Apply the same serif bold ~40px title treatment for visual consistency with the other two list screens.

**Contract**: Same as Phase 2 item 1, applied to this page's `page-title` slot content.

#### 2. Create-group form input

**File**: `src/components/admin/SecurityGroupList.tsx`

**Intent**: Replace the hand-rolled `<input>` (line 43) with the shared `Input` component from `src/components/ui/input.tsx`, so the admin form matches the input styling used everywhere else in the app.

**Contract**: Import `Input` from `@/components/ui/input` and replace the raw `<input className="border-input bg-input/30 ...">` element with `<Input ...props />`, preserving whatever `name`/`value`/`onChange`/`placeholder`/`required` props the current element carries.

#### 3. List row card styling

**File**: `src/components/admin/SecurityGroupList.tsx`

**Intent**: Convert each security-group row from the bordered `Card` to the shadow-based style, matching Phases 2-3.

**Contract**: Same `border-0 shadow-md relative overflow-hidden` + accent-bar treatment as Phase 2 item 2, applied to the row markup at lines 71-82. The empty-state string ("No security groups yet.", line 67) and the authorization-gate string ("You are not authorized to view this page.", `index.astro:37`) remain byte-for-byte identical.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run build`
- [ ] Linting passes: `npm run lint`

#### Manual Verification:

- Admin security-groups list renders shadow-based cards with accent bar in both light and dark mode
- Page title renders in serif font at ~40px
- Create-group form's input renders and behaves identically (focus ring, placeholder, validation) using the shared `Input` component
- Unauthorized users still see the authorization-gate message unchanged
- Empty-state string still renders correctly when no groups exist

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Test Coverage Backfill

### Overview

Add test coverage for the strings and screens that currently have zero regression protection, so the redesign (and future changes) can't silently break them: the candidate list's own empty-state string, the truncation-hint string, and the entire admin/security-groups screen.

### Changes Required:

#### 1. Candidate list empty-state + truncation-hint coverage

**File**: `tests/e2e/candidate-history.spec.ts`

**Intent**: Add assertions for the candidate list's own empty-state string and the truncation-hint string, which today are rendered but never asserted on by any spec.

**Contract**: Add test case(s) that search for a term matching zero candidates and assert `getByText("No candidates match this search.")` is visible; add a test case that triggers >50 matching results (or mocks/seeds accordingly) and asserts `getByText("Showing the first matches. Refine your search to narrow the list.")` is visible. Follow existing locator conventions in the file (`getByRole`/`getByLabel`/`getByText`, no CSS selectors, no `waitForTimeout`).

#### 2. New admin/security-groups E2E spec

**File**: `tests/e2e/admin-groups.spec.ts` (new)

**Intent**: Establish baseline E2E coverage for a screen that currently has none — list rendering, empty state, authorization gate, and the create-group form.

**Contract**: New Playwright spec following the project's existing E2E conventions (role/label/text locators, independent tests with unique-id cleanup where mutating data, no `waitForTimeout`). Cover: (a) an authorized user sees existing security groups listed by name, (b) the empty-state string "No security groups yet." renders when no groups exist (or is skipped if seed data always has groups — confirm against seed setup), (c) an unauthorized user sees "You are not authorized to view this page.", (d) creating a new group via the form successfully adds it to the list.

### Success Criteria:

#### Automated Verification:

- [ ] New and existing Playwright specs pass: `npx playwright test tests/e2e/candidate-history.spec.ts tests/e2e/admin-groups.spec.ts`
- [ ] Full E2E suite passes: `npx playwright test`
- [ ] Linting passes: `npm run lint`

#### Manual Verification:

- New admin E2E spec correctly fails if the authorization gate or empty-state string is changed (spot-check by temporarily breaking one and confirming the test catches it, then reverting)

---

## Testing Strategy

### Unit Tests:

- No new unit/component tests planned beyond the E2E coverage in Phase 5 — these three screens' logic (filtering, search, cap+hint) is already exercised by existing service-level tests (`candidate-list.test.ts`) which are unaffected by markup/CSS changes.

### Integration Tests:

- Existing API/service-level tests (`candidates-list.integration.test.ts`) remain unaffected — no API-contract changes in this plan.

### Manual Testing Steps:

1. Load each of the three list screens in light mode, verify shadow-card + accent-bar + serif-title rendering.
2. Toggle to dark mode, verify token-based colors still render correctly (no raw literals introduced).
3. Resize to a mobile viewport (<768px) and verify the recruitment list stacks vertically and remains usable.
4. Exercise the recruitment status filter and confirm URL sync (`?status=draft` etc.) still works.
5. Exercise candidate search with a term matching 0 results and a term matching >50 results, verify both new strings render.
6. Visit `/admin/groups` as an authorized and an unauthorized user, verify both messages render correctly; create a group via the form and confirm it appears in the list.

## Performance Considerations

None — this is a presentation-layer change with no new data fetching, additional network calls, or algorithmic changes.

## Migration Notes

Not applicable — no data model or schema changes.

## References

- Related research: `context/changes/list-views-redesign/research.md`
- Kanban shadow-card precedent: `src/components/recruitments/KanbanBoard.tsx:316-320`
- Design brief: `context/changes/ui-redesign-foundation/design-brief.md` (items A6, E1, E2, E3)
- Lessons: `context/foundation/lessons.md` ("Colors only through design tokens")

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared Status-Pill Styling Helper

#### Automated

- [x] 1.1 Type checking passes: `npm run build`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Existing recruitment E2E spec passes unchanged: `npx playwright test tests/e2e/recruitments.spec.ts`

#### Manual

- [ ] 1.4 Recruitment list filter pills render identically to before (visual no-op at this phase)
- [ ] 1.5 Kanban status-mutate buttons render identically to before (visual no-op at this phase)

### Phase 2: Recruitment List Redesign

#### Automated

- [ ] 2.1 Type checking passes: `npm run build`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Existing recruitment E2E spec passes unchanged: `npx playwright test tests/e2e/recruitments.spec.ts`

#### Manual

- [ ] 2.4 Recruitment list renders shadow-based cards with accent bar in both light and dark mode
- [ ] 2.5 Page title renders in serif font at ~40px
- [ ] 2.6 Recruitment list rows stack vertically below 768px viewport width and remain readable/usable
- [ ] 2.7 Status filter pills still filter correctly and sync `?status=` in the URL
- [ ] 2.8 Both empty-state strings still render correctly for their respective conditions

### Phase 3: Candidate List Redesign

#### Automated

- [ ] 3.1 Type checking passes: `npm run build`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Existing candidate-history E2E spec passes unchanged: `npx playwright test tests/e2e/candidate-history.spec.ts`

#### Manual

- [ ] 3.4 Candidate list renders shadow-based cards with accent bar in both light and dark mode
- [ ] 3.5 Page title renders in serif font at ~40px
- [ ] 3.6 Search-by-name still debounces and filters results correctly
- [ ] 3.7 Truncation hint still appears when results are capped at 50
- [ ] 3.8 Empty-state string still renders correctly when no candidates match

### Phase 4: Admin (Security Groups) List Redesign

#### Automated

- [ ] 4.1 Type checking passes: `npm run build`
- [ ] 4.2 Linting passes: `npm run lint`

#### Manual

- [ ] 4.3 Admin security-groups list renders shadow-based cards with accent bar in both light and dark mode
- [ ] 4.4 Page title renders in serif font at ~40px
- [ ] 4.5 Create-group form's input renders and behaves identically using the shared `Input` component
- [ ] 4.6 Unauthorized users still see the authorization-gate message unchanged
- [ ] 4.7 Empty-state string still renders correctly when no groups exist

### Phase 5: Test Coverage Backfill

#### Automated

- [ ] 5.1 New and existing Playwright specs pass: `npx playwright test tests/e2e/candidate-history.spec.ts tests/e2e/admin-groups.spec.ts`
- [ ] 5.2 Full E2E suite passes: `npx playwright test`
- [ ] 5.3 Linting passes: `npm run lint`

#### Manual

- [ ] 5.4 New admin E2E spec correctly fails if the authorization gate or empty-state string is changed (spot-check by temporarily breaking one and confirming the test catches it, then reverting)
