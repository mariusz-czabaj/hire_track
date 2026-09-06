---
date: 2026-09-06T13:16:25+02:00
researcher: Claude
git_commit: b5a637e9479734d17b26b13ed4cd4930b5583998
branch: main
repository: mariusz-czabaj/hire_track
topic: "List Views Redesign (S-12)"
tags: [research, codebase, recruitment-list, candidate-list, admin-groups, design-tokens, filter-consolidation, e2e-anchors]
status: complete
last_updated: 2026-09-06
last_updated_by: Claude
---

# Research: List Views Redesign (S-12)

**Date**: 2026-09-06T13:16:25+02:00
**Researcher**: Claude
**Git Commit**: b5a637e9479734d17b26b13ed4cd4930b5583998
**Branch**: main
**Repository**: mariusz-czabaj/hire_track

## Research Question

Roadmap slice S-12 "list-views-redesign": the user is redesigning the recruitment list, candidate list, and admin (security groups) list screens onto the app's new design-token visual language, ensuring correct behavior on narrow screens, consolidating duplicated status-filter logic into one shared component, and preserving E2E test anchors (`data-testid="candidate-list"`, empty-state strings) byte-for-byte. What is the current implementation of these three screens, where is filter logic duplicated, what visual patterns should the redesign follow, and what exactly must survive unchanged for the test suite?

## Summary

All three list screens already use the design-token system exclusively (zero raw Tailwind palette literals found) — so S-12 is **not** a color-migration task. It's really three things:

1. **Visual/structural consistency migration** — bring list rows in line with the newer visual language established by S-10's kanban redesign (shadow-based cards instead of bordered ones, serif page titles, mobile stacking), and replace one hand-rolled `<input>` (admin) with the shared `Input` primitive.
2. **Filter consolidation** — extract the duplicated status button-group markup/logic shared between `RecruitmentList.tsx` (a *filter*) and `KanbanBoard.tsx`'s `StatusControl` (a *mutator*) into one shared component, likely backed by a new `useStatusFilter`-style hook.
3. **Regression-safe execution** — two empty-state strings and one `data-testid` are the only things E2E currently asserts on across these three screens; the candidate list's own empty-state string and the entire admin/security-groups screen have **zero E2E coverage today**, which is a bigger silent risk than the roadmap note implies.

## Detailed Findings

### Recruitment list screen

- Page: [src/pages/recruitments/index.astro](src/pages/recruitments/index.astro) — wraps `RecruitmentList` in `AppShell`, reads `?status=` from `Astro.url.searchParams` (line 11), passes `initialStatus` into the React island (`client:load`, line 40).
- Component: [src/components/recruitments/RecruitmentList.tsx](src/components/recruitments/RecruitmentList.tsx) (114 lines).
  - Status filter pills: lines 51-69, built from `STATUS_FILTER_OPTIONS` ([src/lib/recruitment-status.ts:8](src/lib/recruitment-status.ts)), active/inactive classes at lines 59-64.
  - Card rows: lines 85-107 — `<a>` wrapping `Card`, `hover:bg-accent flex flex-row items-center justify-between gap-4 p-4 transition-colors` (line 89); title, department/location, opened date, candidate count, `Badge` via `STATUS_PRESENTATION[...].variant` (lines 99-101).
  - **No pagination or cap+hint exists on this screen** — `useApiResource` fetches the full filtered list with no `limit`/`truncated` handling. S-12 needs to decide (or confirm with the user) whether this screen also needs a cap, or whether cap+hint stays candidate-search-only by design.
  - No responsive/mobile stacking variant on the row — `flex flex-row` with no `flex-col sm:flex-row` fallback. The design brief (`ui-redesign-foundation/design-brief.md`, item E1) explicitly calls for "add mobile stacking" here — a named, not-yet-closed gap.

### Candidate list / search screen

- Page: [src/pages/candidates/index.astro](src/pages/candidates/index.astro) — reads `?q=` (line 11), renders `CandidateList` (line 32, `client:load`).
- Component: [src/components/candidates/CandidateList.tsx](src/components/candidates/CandidateList.tsx) (103 lines).
  - Root wrapper carries the E2E anchor `data-testid="candidate-list"` at **line 43**.
  - Search input: lines 44-59, labeled `Input`, 300ms debounce (`useDebouncedValue`, `SEARCH_DEBOUNCE_MS = 300` at line 14), `aria-label="Search candidates by name"`.
  - Result rows: lines 76-89, same `<a>` + `Card` pattern as recruitments.
  - **Cap + hint pattern (the S-06 decision referenced in the roadmap)**:
    - Service: [src/lib/services/candidate-list.ts](src/lib/services/candidate-list.ts) — `CANDIDATE_LIST_RESULT_CAP` (defined in `src/types.ts:238` as `50`), `.limit(CANDIDATE_LIST_RESULT_CAP + 1)` (line 34); if rows exceed the cap, `truncated = true` (line 46) and only the first 50 rows are returned (line 47).
    - UI hint: `CandidateList.tsx:90-94` — `"Showing the first matches. Refine your search to narrow the list."` when `resource.data.truncated`. No pagination controls anywhere — confirms cap+hint replaces paging by design.
  - Documented precedent: `context/changes/ui-redesign-foundation/design-brief.md:71` and `context/changes/candidate-history-search/plan-brief.md:1` record the original S-06 decision to keep cap+hint instead of pagination.

### Admin (security groups) screen

- List page: [src/pages/admin/groups/index.astro](src/pages/admin/groups/index.astro) — gates on `Astro.locals.operations.includes("group.manage")` (line 11); unauthorized users see an inline message (lines 36-38: `"You are not authorized to view this page."`).
- Detail page: `src/pages/admin/groups/[id].astro` (not read in full).
- Component: [src/components/admin/SecurityGroupList.tsx](src/components/admin/SecurityGroupList.tsx) (87 lines).
  - Create-group form (lines 34-53) uses a **hand-rolled `<input>`** (line 43: `"border-input bg-input/30 text-foreground placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"`) instead of the shared `Input` component that recruitment/candidate screens use — a concrete consolidation target for S-12.
  - List rows (lines 71-82): same `<a>` + `Card` pattern, `Shield` icon instead of a badge/date/count row.
  - No pagination, no cap/hint (group counts presumably small).
  - **No E2E or component-level test coverage exists for this screen at all** (`SecurityGroupDetail.test.tsx` exists; `SecurityGroupList.test.tsx` does not; no `tests/e2e/*.spec.ts` references `security-group` or `/admin`).

### Palette literals vs. design tokens

Grepping all three screens' components/pages for `bg-white`, `bg-cosmic`, `text-blue-*`, and gradient classes returned **zero matches** — every screen already composes semantic tokens via `cn()` ([src/lib/utils.ts:4-6](src/lib/utils.ts)), e.g. `bg-primary text-primary-foreground hover:bg-primary/90` (CTA), `border-accent bg-accent text-accent-foreground` (active filter pill), `hover:bg-accent ... transition-colors` (card hover, identical across all three screens). So there is no raw-color cleanup needed here — S-12's token-system work is about structural/typographic consistency and shared-component consolidation, not literal replacement. (`bg-cosmic` is a legacy raw-hex utility still present in `global.css:251-253`, flagged in `design-system-foundation/plan.md` and `kanban-visual-redesign/research.md` as something S-12 is a designated migration owner for — but it has no current consumers on these three screens per this research; confirm whether any other view still uses it.)

### Empty-state strings (exact literals + locations)

| String | Source | E2E coverage |
|---|---|---|
| `"No recruitments match this filter."` | [RecruitmentList.tsx:81](src/components/recruitments/RecruitmentList.tsx) | `tests/e2e/recruitments.spec.ts:52,56` |
| `"No recruitments are visible to you."` | RecruitmentList.tsx:81 (else-branch of same ternary) | `tests/e2e/recruitments.spec.ts:102` |
| `"No candidates match this search."` | [CandidateList.tsx:71](src/components/candidates/CandidateList.tsx) | **none** |
| `"Showing the first matches. Refine your search to narrow the list."` | CandidateList.tsx:90-94 | **none** |
| `"No security groups yet."` | [SecurityGroupList.tsx:67](src/components/admin/SecurityGroupList.tsx) | **none** |
| `"You are not authorized to view this page."` | `src/pages/admin/groups/index.astro:37` | **none** |
| `"Recruitments could not be found."` | RecruitmentList.tsx:109 (error state) | not checked |
| `"Candidates could not be found."` | CandidateList.tsx:98 (error state) | not checked |

### E2E test anchors — full inventory

- `tests/e2e/recruitments.spec.ts` — recruitment list + board. Locators used against the list itself: `getByText("Backend Engineer")` (lines 30, 49, 60), `getByRole("button", { name: "Draft"/"All", exact: true })` (lines 51, 59), the two empty-state strings above (lines 52, 56, 102), `getByText(title)` for a dynamically created recruitment (line 156), URL assertions `toHaveURL(/status=draft/)` / `not.toHaveURL(/status=/)` tied to filter state (lines 53, 57, 61).
- `tests/e2e/candidate-history.spec.ts` — candidate list. `getByLabel("Search candidates by name")` (lines 17, 38), `getByTestId("candidate-list").getByText("Julia Wojcik")` (lines 18, 20, 39) — **the `data-testid` is only ever used as a scoping container to disambiguate a name match; its own text/structure is never asserted.**
- `tests/e2e/candidates.spec.ts` — despite the name, only exercises the recruitment board/kanban dialogs, not the candidate list screen.
- **No spec touches `/admin/groups` at all.**
- `data-testid="candidate-list"` is defined once, at `CandidateList.tsx:43`, and is the *only* root-level `data-testid` among these three screens — recruitment list and security-group list rely purely on text-based locators, so they have no stable-selector fallback if copy changes.
- `src/pages/api/candidates/candidates-list.integration.test.ts` and `src/lib/services/candidate-list.test.ts` are pure API/service-level Vitest tests (JSON body assertions, no DOM/rendering) — unaffected by markup/CSS changes, only by API-contract changes.

**Net regression risk**: only 2 empty-state strings + 1 non-content-asserted testid are actually guarded by E2E today. The candidate list's own empty-state string, the truncation-hint string, and the entire admin screen are currently *unguarded* — a redesign mistake there wouldn't be caught by CI. Worth deciding in planning whether to add coverage before or alongside the redesign, especially for the admin screen given the "high test-regression risk" framing in the roadmap actually undersells the admin gap (there's no test to regress, just none to protect the redesign either).

### Filter-logic duplication — the two implementations

**A. `RecruitmentList.tsx` (the canonical filter)** — lines 40-69. `useState<RecruitmentStatus | undefined>` seeded from the Astro-provided `initialStatus` prop, parsed via `parseInitialStatus`/`recruitmentStatusSchema`. Options come from `STATUS_FILTER_OPTIONS` (includes an "All" option, `undefined`). Selecting a pill calls `handleFilterChange` → `setStatus` + `syncUrl` (client-side `history.replaceState`, no full navigation) → refetch via `useApiResource`. Button classes (lines 59-64): `"rounded-full border px-4 py-1.5 text-sm font-medium transition-colors"`, active `"border-accent bg-accent text-accent-foreground"`, inactive `"border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"`.

**B. `KanbanBoard.tsx`'s `StatusControl`** — lines 103-157. Not a filter but a status *mutator* for a single recruitment; duplicates the same button-group visual pattern (lines 143-148, nearly identical classes at `px-3 py-1 text-xs` plus `disabled:opacity-50`) and reuses `STATUS_PRESENTATION` for labels. On click, calls `useMutation(...).mutate({ status: next })` → `PATCH /api/recruitments/:id`, then triggers a refetch — no URL sync, no client-only state.

No third duplicate exists — `CandidateList.tsx` has only a text-search filter, no status logic.

**Consolidation target**: since S-12 frames this as filter-logic duplication, the two are best unified into one shared status button-group/toggle component parameterized by behavior (filter-with-URL-sync vs. mutate-via-PATCH), built on the already-shared data layer `STATUS_FILTER_OPTIONS`/`STATUS_PRESENTATION` ([src/lib/recruitment-status.ts](src/lib/recruitment-status.ts)). The inline `useState` + `buildUrl` + `syncUrl` logic in `RecruitmentList.tsx` (lines 25-46) is also a candidate for extraction into a shared hook (e.g. `useStatusFilter`), alongside the shared UI component — no such hook currently exists in `src/components/hooks/` (`useApiResource`, `useMutation`, `useDebouncedValue`, `useCvUpload` are the only ones, none filter-specific).

No existing shared filter *component* exists in `src/components/ui/`; only shared filter *data* (`STATUS_FILTER_OPTIONS`, `STATUS_PRESENTATION`) is already centralized and reused by both duplicate sites.

### Design-token system and established visual patterns (from F-02/S-08/S-10)

- Tokens defined in [src/styles/global.css:44-249](src/styles/global.css) — OKLCH values, three theme blocks (light `:root`, dark-media, `.dark` class), mapped to Tailwind via `@theme inline` (lines 194-249). Core families: `--background/--foreground`, `--card`, `--popover`, `--primary` (indigo), `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius(-sm/md/lg/xl)`, `--sidebar-*`, `--font-sans`/`--font-serif` (self-hosted "Fraunces"), `--shadow-sm/md/lg`. S-10 added a stage-color palette (`--stage-1..6` + `-foreground`, lines 80-94, 131-143, 180-191), mirrored in `src/lib/design-tokens.ts` and measured via `src/lib/contrast.ts` / the dev-only `/dev/design-system.astro` route.
- `cn()` ([src/lib/utils.ts:4-6](src/lib/utils.ts)) is the universal class-composition helper — `twMerge(clsx(inputs))`. Every component composes token-backed base classes plus a `className` override this way, e.g. `Card`'s base is `bg-card text-card-foreground ... rounded-xl border py-6 shadow-sm` (`src/components/ui/card.tsx:9`).
- **Visual patterns established by S-10 (kanban redesign) that S-12 should mirror for consistency**:
  - Cards: S-10 moved from bordered cards to **shadow-only** surfaces (`border-0 p-3 pl-4 shadow-md`, `KanbanBoard.tsx:316`) with a decorative left accent bar (`absolute inset-y-0 left-0 w-1.5`, `aria-hidden="true"`). List rows in `RecruitmentList.tsx`/`CandidateList.tsx`/`SecurityGroupList.tsx` still use the older *bordered* `Card` — S-12 should decide whether to migrate list rows to the shadow-based language for consistency with the kanban screens.
  - Badges: `rounded-full`, driven by a semantic presentation map (`STATUS_PRESENTATION`) — the pattern to generalize for any status-like indicator in list views.
  - Pill/segmented filter controls: hand-rolled `<button>` groups (not a `Select`), the exact pattern duplicated between `RecruitmentList`/`KanbanBoard` above — S-12's consolidation target.
  - Typography: page `<h1>` currently uses `text-3xl font-bold` (sans), but the design brief (item A6) calls for a bold **serif** ~40px title via `--font-serif`/Fraunces — recruitment/candidate/admin list page titles (`src/pages/*/index.astro`) are candidates for this migration.
  - Empty states: dashed-border box (`border-border border-dashed rounded-lg`), muted centered text — already consistent across all three screens.
  - Skeletons: shape-mirroring, token-based, no raw color overrides — already consistent.
  - Hover/focus: `hover:bg-accent`/`hover:bg-primary/90` + `transition-colors`; focus via `--ring` token (`focus-visible:ring-2`) — already consistent.
- **AppShell nesting** ([src/components/AppShell.astro:1-53](src/components/AppShell.astro)) — every list page must render inside it. Named slots: `nav`, `topbar-leading`, `topbar-actions`, `page-title`, `page-actions`, default slot for content. `containerWidth` prop (`"narrow" | "standard" | "wide"`); list pages should use `"standard"`. `src/pages/recruitments/index.astro` is the canonical usage example.
- **Narrow-screen conventions**: nav area is `hidden` below `md` (768px), shown at `md:block md:w-64` (`AppShell.astro:17`); mobile access goes through a separate `MobileNav` client island, not a re-rendered nav. The design brief (item E1) explicitly calls out "add mobile stacking" for the recruitment list row as an open gap — current markup is `flex flex-row` with no responsive stacking variant. No other explicit breakpoint values are defined beyond Tailwind's default `md`.

## Code References

- [src/pages/recruitments/index.astro](src/pages/recruitments/index.astro) — recruitment list page, canonical AppShell usage
- [src/components/recruitments/RecruitmentList.tsx:1-114](src/components/recruitments/RecruitmentList.tsx) — recruitment list component, filter pills, empty/loading/error states
- [src/components/recruitments/KanbanBoard.tsx:103-157](src/components/recruitments/KanbanBoard.tsx) — `StatusControl`, the second duplicate of the filter pattern
- [src/components/recruitments/KanbanBoard.tsx:280-357](src/components/recruitments/KanbanBoard.tsx) — S-10's card/column visual language to mirror
- [src/pages/candidates/index.astro](src/pages/candidates/index.astro) — candidate list page
- [src/components/candidates/CandidateList.tsx:1-103](src/components/candidates/CandidateList.tsx) — candidate list component, `data-testid="candidate-list"` (line 43), cap+hint UI (lines 90-94)
- [src/lib/services/candidate-list.ts](src/lib/services/candidate-list.ts) — cap+hint server-side implementation
- [src/pages/admin/groups/index.astro](src/pages/admin/groups/index.astro) — admin list page, authorization gate
- [src/components/admin/SecurityGroupList.tsx:1-87](src/components/admin/SecurityGroupList.tsx) — admin list component, hand-rolled input (line 43)
- [src/lib/recruitment-status.ts](src/lib/recruitment-status.ts) — `STATUS_FILTER_OPTIONS`, `STATUS_PRESENTATION` (shared data layer for filter consolidation)
- [src/lib/stage-palette.ts](src/lib/stage-palette.ts) — stage-color-by-`sortOrder` helper, precedent for list-item color mapping
- [src/styles/global.css:44-253](src/styles/global.css) — token definitions, `bg-cosmic` legacy utility
- [src/lib/utils.ts:4-6](src/lib/utils.ts) — `cn()` helper
- [src/components/AppShell.astro:1-53](src/components/AppShell.astro) — shell/slots/`containerWidth`
- [src/components/ui/card.tsx](src/components/ui/card.tsx), [src/components/ui/badge.tsx](src/components/ui/badge.tsx), [src/components/ui/input.tsx](src/components/ui/input.tsx) — shared primitives
- [tests/e2e/recruitments.spec.ts](tests/e2e/recruitments.spec.ts) — recruitment list E2E coverage
- [tests/e2e/candidate-history.spec.ts](tests/e2e/candidate-history.spec.ts) — candidate list E2E coverage
- [src/pages/api/candidates/candidates-list.integration.test.ts](src/pages/api/candidates/candidates-list.integration.test.ts), [src/lib/services/candidate-list.test.ts](src/lib/services/candidate-list.test.ts) — API/service-level tests, unaffected by markup changes

## Architecture Insights

- **Token adoption is already complete on these screens** — the redesign work here is presentation-consistency and component-consolidation, not the color-literal migration that earlier slices (S-08, S-10) had to do elsewhere.
- **Status filtering is a hybrid SSR/client pattern**: Astro reads the initial `?status=` query param server-side and passes it as a prop; all subsequent filtering is client-only (React state + manual `history.replaceState`), with no server round-trip. Any redesign of the filter component must preserve this URL-sync behavior since `recruitments.spec.ts` asserts on `toHaveURL(/status=draft/)`.
- **The same button-group visual pattern serves two different semantic purposes** (filtering vs. mutating) at two different sites — a shared component needs a mode/behavior prop, not just shared styling, since the click handlers and side effects diverge completely (URL+state vs. PATCH mutation).
- **`STATUS_FILTER_OPTIONS`/`STATUS_PRESENTATION` are already the right shared data layer** — the consolidation is about the *component* and possibly a *hook*, not the underlying status vocabulary.
- **The cap+hint pattern (S-06) is candidate-search-specific** — it doesn't exist on the recruitment list or admin screens, and nothing in this research suggests it should be extended there; the roadmap note only mentions preserving it, not spreading it.
- **Card visual language is inconsistent between kanban (shadow-based, post-S-10) and list screens (still bordered, pre-S-10 vintage)** — worth an explicit decision in planning about whether list rows adopt the shadow-based look for full visual consistency, since nothing in the roadmap forces this but it's the more recent established pattern.

## Historical Context (from prior changes)

- `context/changes/design-system-foundation/` (F-02) — established the OKLCH token system, `cn()` convention, and the "colors only through tokens" rule now recorded in `context/foundation/lessons.md`.
- `context/changes/ui-redesign-foundation/` (S-08) — built `AppShell`, `Sidebar`, `MobileNav`, and the design-brief document (`design-brief.md`) that explicitly enumerates S-12's scope (item E1: recruitment list mobile stacking; item E: list/form screens generally; item G: 9 `data-testid` anchors and E2E locator rules) and the cap+hint decision origin (line 71, referencing S-06).
- `context/changes/kanban-visual-redesign/` (S-10, in-progress) — the most complete worked example of a token-driven visual migration (palette-first, then rebuild, then re-test), and the source of the shadow-card/accent-bar/pill-header patterns S-12 should decide whether to mirror.
- `context/changes/candidate-history-search/plan-brief.md` — original S-06 decision to use "cap + hint to narrow" instead of pagination for candidate search; must not regress to a pager.
- `context/foundation/roadmap.md:159-169` — the S-12 slice definition itself: outcome, prerequisites (F-02, S-08), parallel work (S-09, S-10, S-13), and the risk note this research was scoped against.

## Related Research

- None yet under `context/changes/**/research.md` specifically for S-12 prior to this document.

## Open Questions

1. **Recruitment list cap+hint?** Should the recruitment list gain a cap+hint pattern (currently unbounded), or is unbounded fine given expected recruitment counts stay low? Not specified in the roadmap.
2. **Card visual language convergence** — should list rows adopt S-10's shadow-based card style (dropping the border) to match the kanban screens, or is that out of scope for S-12 and left for a later pass?
3. **Test-coverage gap before redesign** — should E2E/component coverage be added for the candidate list's own empty-state string, the truncation hint, and the entire admin/security-groups screen (currently zero coverage) before or alongside the redesign, given the roadmap's stated regression-risk concern is currently only half-covered by existing tests?
4. **Shared filter component API** — does the consolidated status component need to support both "filter mode" (URL-synced, includes "All") and "mutate mode" (PATCH-backed, no "All"), or should `KanbanBoard`'s `StatusControl` be left alone and only the *visual* styling extracted (e.g. a shared `statusPillClasses()` helper) rather than a single behavioral component? The roadmap phrasing ("filtrów" = filters specifically) leans toward the former but this should be confirmed in planning.
5. **`bg-cosmic` migration** — the lessons file and prior plans note S-12 as a designated `bg-cosmic` migration owner, but this research found zero `bg-cosmic` usage on the three in-scope screens. Confirm whether this refers to some other view not covered here, or whether that note is now stale.
