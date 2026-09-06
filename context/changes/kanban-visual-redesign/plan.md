# Kanban Visual Redesign (S-10) Implementation Plan

## Overview

Bring the recruitment kanban board into the M-2 visual language: a new, AA-verified `--stage-*` design-token family; full-width colored stage header pills; white cards carrying a stage-colored left accent bar; and a flex-fit column layout in which every stage is visible at once, falling back to horizontal scroll only when columns would otherwise become unreadably narrow.

This is roadmap slice **S-10**, the north star of milestone **M-2** (`context/foundation/roadmap.md`), covering scope anchor **MS-04** and design-brief items **D1–D8**. Drag-and-drop (D9) belongs to S-11 and is out of scope.

## Current State Analysis

- `src/components/recruitments/KanbanBoard.tsx` is a single React island. Columns and cards are inlined — there is no `Column` or `CandidateCard` component.
- Columns today: `flex gap-4 overflow-x-auto pb-2` container; each column `border-border bg-muted w-64 shrink-0 rounded-xl border p-3` with a plain `<h2>` stage name and a muted count span.
- Cards today: shadcn `Card` with `gap-1 p-3`, a name link, a `MoveCandidateDialog` trigger, and a `Added {date}` line.
- **Colors are already 100% token-based** in every kanban file — the S-08 color sweep did that and explicitly deferred "kanban column styling" to this slice. This plan is layout/structure/palette, not a token migration.
- **No stage-color tokens exist.** `src/styles/global.css` carries 23 tokens; the only multi-hue set is `--chart-1..5`, which are stock shadcn values, never contrast-measured, semantically wrong, and 5-wide against 6 seeded stages.
- Contrast tooling exists and is the AA gate: `src/lib/contrast.ts` (`contrastRatio`, `meetsAA`, `WCAG_AA_NORMAL_TEXT`/`WCAG_AA_LARGE_TEXT`), fed by `src/lib/design-tokens.ts` (`lightPalette`/`darkPalette`/`tokenPairs`, hand-synced with `global.css`), rendered by the dev-only `/dev/design-system` route.
- S-09 landed the recruitment header as an Astro `page-title` slot in `src/pages/recruitments/[id].astro`. The board island still renders its own action row above the columns.
- Stage names come raw from the DB and stages are user-configurable per recruitment (S-03), so any color mapping must be positional (`sortOrder`), never name-based.

### Key Discoveries

- `src/lib/design-tokens.ts:1-6` — the file's own header states it duplicates `global.css` values by hand and must be kept in sync. Adding stage tokens means editing **both** files; a drift here silently invalidates the AA table.
- `src/styles/global.css` has **three** blocks that must each receive the new tokens: `:root` (light), the `@media (prefers-color-scheme: dark)` fallback, and the explicit `.dark` class block. Omitting the third breaks the manual theme toggle only — a failure mode that light/dark auto-testing would miss.
- `tests/e2e/candidates.spec.ts:60,85,109,147,150` addresses columns as `getByTestId("kanban-columns").locator("> div").nth(N)`. **Columns must remain direct element children of the `kanban-columns` container, in `sortOrder` order.** Any wrapper element inserted between them breaks five assertions.
- `tests/e2e/recruitments.spec.ts:43` and `tests/e2e/candidates.spec.ts:62` assert `/^Added \d{4}-\d{2}-\d{2}$/` as a *single* text node; `tests/e2e/recruitments.spec.ts:39` asserts the literal text `No candidates`. Both strings are being kept (see Decisions) — the two-line D4 treatment is achieved with layout, not by splitting the text node.
- `src/components/recruitments/KanbanBoard.tsx:167-184` — the card's `MoveCandidateDialog` trigger label is `Move candidate {index}: {name}`, where the index is a board-wide running counter built in `cardIndexById`. E2E matches `/^Move candidate \d+: Ada Lovelace$/`. Preserve this labelling scheme exactly.
- `src/lib/recruitment-status.ts:15-22` (`STATUS_PRESENTATION`) is the established precedent for a presentation map living in `src/lib/` rather than inline in a component — the stage-color helper follows it.
- `context/foundation/lessons.md` — "colors only through design tokens" applies to S-08…S-13 and is **not lint-enforced**. This PR needs manual self-audit for raw Tailwind palette literals.
- `jsx-a11y` runs at `warn` for `.tsx`; warnings will not fail the build, so the a11y criteria below must be checked deliberately.

## Desired End State

A recruiter opening `/recruitments/{id}` sees every stage side by side without scrolling: each column topped by a full-width, uppercase, bold color pill showing the stage name and its candidate count, and beneath it white cards floating directly on the page background, each with a left accent bar in that stage's color, the candidate name in bold on the left and the added-date treatment on the right. Stage colors are assigned deterministically from `sortOrder`, so a recruitment with custom stages (S-03) is colored just as coherently as a seeded one. Both themes pass WCAG 2.1 AA for every stage hue, and a screen-reader user hears each column announced as a named region so the accent bar's color is never the sole carrier of stage information.

Verify by: opening `/dev/design-system` and confirming every `stage-N` / `stage-N-foreground` pair shows PASS in both the light and dark contrast tables; opening a recruitment board in both themes; and running the full lint / unit / E2E suites green.

## What We're NOT Doing

- **No drag-and-drop.** That is S-11 (`kanban-drag-and-drop`), which depends on this slice landing first.
- **No action-row relocation.** The status badge, `StatusControl`, `StageEditor` and `AddCandidateDialog` stay where they are in the island, restyled in place. Consolidating them into a header "…" menu is brief item C4, owned by MS-03 / S-09, and crossing that Astro/React seam would put the `status-control`, `stage-editor-trigger` and `add-candidate-trigger` anchors at risk on the milestone's highest-risk slice.
- **No copy changes.** "Added {date}" stays "Added"; the empty state stays "No candidates". The reference screenshot's "Applied" wording is deliberately not adopted.
- **No API, DTO, or database change.** `KanbanBoardDto` already carries `sortOrder` and `candidateCount`; user-chosen stage colors are parked (brief decision, 2026-09-05).
- **No pagination or virtualization.** Accepted deferred debt from S-01/S-03/S-04, unchanged here.
- **No new shadcn primitives.** `Avatar` / `Tooltip` / `Separator` are not needed for D1–D8.
- **No changes to `MoveCandidateDialog`, `StageEditor`, or `AddCandidateDialog` internals** beyond what column/card restyling forces at their trigger call sites.
- **No touching `bg-cosmic`, `Textarea`, or `FileInput`** — S-13 owns those.

## Implementation Approach

Three phases, ordered so the risky part is provable before it is visible.

Phase 1 lands the palette as pure tokens plus a contrast readout, with **no board change at all**. Its exit gate is objective: every stage hue passes AA against its paired foreground in both themes, measured by the tooling that already exists. If a hue fails there, it is retuned in a file nobody else depends on yet — far cheaper than discovering it after the board is rebuilt on top.

Phase 2 rebuilds the board markup against those now-proven tokens: a `stageColor` helper in `src/lib/`, header pills, flex-fit columns, accent-bar cards, region labelling, and restyled empty/skeleton states.

Phase 3 aligns and extends the test surface, then re-verifies contrast and a11y against the running board rather than against static token values.

## Critical Implementation Details

**Token sync is a two-file operation.** `src/lib/design-tokens.ts` duplicates `global.css` values by hand (stated in its own header comment) because Astro SSR has no computed-style access. Every stage token must be added to `global.css` in all three blocks (`:root`, the `prefers-color-scheme: dark` media block, and `.dark`) *and* mirrored into `lightPalette`/`darkPalette`. A value that drifts between the two files makes the `/dev/design-system` AA table report on colors the board is not actually using — a silent false pass.

**Column DOM depth is load-bearing.** Five E2E assertions select columns via `kanban-columns > div` with `.nth()`. The flex-fit layout must be achieved by changing classes on the existing container and column elements, not by introducing a wrapper element around each column.

**The accent bar must not be reachable by assistive tech.** The stage identity is carried by the column's labelled region (`role="region"` + `aria-labelledby` pointing at the pill's heading id); the bar itself is `aria-hidden` decoration. Generate the heading id from the stage id, not the array index, so it stays stable across refetches.

## Phase 1: Stage palette tokens and AA verification

### Overview

Introduce a six-hue stage palette as first-class design tokens with per-hue paired foregrounds, and extend the dev contrast page to prove every pair passes AA in both themes. No product-facing change in this phase.

### Changes Required

#### 1. Token definitions

**File**: `src/styles/global.css`

**Intent**: Add the stage palette so the board can express stage color exclusively through the token layer, per the standing lessons rule.

**Contract**: Twelve new custom properties — `--stage-1` … `--stage-6` and `--stage-1-foreground` … `--stage-6-foreground` — declared in **all three** blocks: `:root`, `@media (prefers-color-scheme: dark)`, and `.dark`. Values in OKLCH, matching the file's existing convention. Each foreground is chosen per hue and per theme for AA, not fixed to white: dark hues take a near-white foreground, light hues (amber, cyan) take a near-black one. Six distinguishable hues spread around the wheel, harmonious with the indigo `--primary` at `oklch(… 275)`.

Then map all twelve into Tailwind utilities inside the existing `@theme inline` block, following the established `--color-<name>: var(--<name>)` form, so `bg-stage-1` / `text-stage-1-foreground` resolve.

#### 2. Contrast-measurement mirror

**File**: `src/lib/design-tokens.ts`

**Intent**: Mirror the new token values so the SSR-side contrast math can measure them, keeping this file in sync with `global.css` as its header comment requires.

**Contract**: Extend `TokenPalette` with the twelve new keys (`stage1`, `stage1Foreground`, … `stage6Foreground`), add the corresponding entries to `lightPalette` and `darkPalette`, and add six entries to `tokenPairs` pairing each `stageNForeground` over `stageN`. Pill text is small uppercase, so measure at `size: "normal"` (4.5:1) — not the 3:1 large-text threshold.

#### 3. Dev design-system readout

**File**: `src/pages/dev/design-system.astro`

**Intent**: Render the stage palette as its own visible section so a reviewer can see the six pills as they will appear on the board, alongside the pass/fail numbers.

**Contract**: A new `<section>` following the existing heading/`aria-labelledby` pattern used by the sibling sections, rendering each stage hue as a sample pill using its own token pair. The six new `tokenPairs` entries flow into the existing light/dark contrast tables automatically — no change to the `measure()` logic.

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`
- `src/lib/design-tokens.ts` declares all twelve stage keys in both `lightPalette` and `darkPalette`, and six new `tokenPairs` entries
- `src/styles/global.css` declares all twelve stage tokens in each of the three theme blocks, and maps all twelve in `@theme inline`

#### Manual Verification

- `/dev/design-system` light-mode contrast table shows PASS for all six `stage-N-foreground` over `stage-N` pairs
- `/dev/design-system` dark-mode contrast table shows PASS for all six pairs
- The six sample pills are visually distinguishable from one another in both themes, and none clashes with the indigo `--primary`
- Toggling the theme switch (not just OS preference) recolors the stage samples, confirming the `.dark` block was not missed

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the AA tables are green in both themes before proceeding. A hue that fails here must be retuned now, not after Phase 2 builds on it.

---

## Phase 2: Board redesign

### Overview

Rebuild the kanban markup on the proven palette: deterministic stage-color assignment, colored header pills, flex-fit columns without a background surface, accent-bar cards, labelled column regions, and restyled empty and loading states.

### Changes Required

#### 1. Stage color helper

**File**: `src/lib/stage-palette.ts` (new)

**Intent**: Map a stage's `sortOrder` to a stage-token index deterministically and cyclically, so custom stages defined in S-03 are colored as coherently as seeded ones, and so the mapping is unit-testable independently of the board.

**Contract**: Follows the `STATUS_PRESENTATION` precedent in `src/lib/recruitment-status.ts` — a presentation concern living in `src/lib/`, not inline in the component. Exports a function taking `sortOrder: number` and returning the Tailwind class names for that stage's background and foreground (both token-backed). Wrapping is `sortOrder` modulo the palette size, and must be defined for `sortOrder` values that are zero-based, one-based, non-contiguous (after a stage is removed), and negative — the DB does not guarantee a dense zero-based sequence.

#### 2. Board columns and cards

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: Replace the current column and card markup with the D1–D5 treatment while preserving every existing test anchor, label scheme, and behavioral invariant.

**Contract**:

- **Container** (`data-testid="kanban-columns"`): columns share the available width equally instead of being fixed at `w-64`, with a min-width floor below which they stop shrinking; the container becomes horizontally scrollable **only** on overflow past that floor. Columns remain direct element children in `sortOrder` order — no wrapper element.
- **Column**: loses `bg-muted` and its border (D5). Becomes `role="region"` with `aria-labelledby` pointing at its pill heading, whose id derives from `stage.id`.
- **Header pill** (D1): full column width, stage background + paired foreground from the helper, uppercase, bold, small size with letter-spacing per brief A6, fully rounded per A7. Contains the stage name and the count. The count remains readable as a distinct value, not fused into the name string.
- **Card** (D3, D4): white `card` surface with shadow rather than border (A8), a left accent bar in the stage color marked `aria-hidden`, candidate name bold on the left, and the date block right-aligned in a smaller muted style. **The date remains a single text node reading `Added {YYYY-MM-DD}`** — the two-line appearance is layout, not a split string. The `MoveCandidateDialog` trigger and its `Move candidate {index}: {name}` label are carried over unchanged, including the board-wide `cardIndexById` counter.
- **Empty column** (D8): keeps the exact text `No candidates` and the dashed border, restyled to the new tokens and rhythm.
- **Skeleton** (D7): `SkeletonColumns` updated to mirror the new column shape — a pill-shaped header block over card blocks — using the same flex-fit container classes so the layout does not jump when data arrives.
- Unchanged: the always-render-empty-stages invariant (S-01), no client-side role gating (S-01), the not-found/error states, and full-board `refetch()` after mutation.

#### 3. Action row restyle

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: Bring the existing action row into the new language without moving it, so the board no longer reads as two visual eras stacked on one screen.

**Contract**: Same elements, same order, same `data-testid` anchors (`status-control`, `stage-editor-trigger`, `add-candidate-trigger`) and same `aria-pressed` semantics on the status toggles. Add-candidate presents as the primary action; the status toggles adopt the new pill rhythm. No element is added, removed, or reparented.

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run build`
- Linting passes, including `jsx-a11y` with no new warnings: `npm run lint`
- Unit tests pass: `npm run test`
- Existing E2E suite passes unchanged: `npm run test:e2e`
- No raw Tailwind palette literal or hex value appears in the diff (self-audit — nothing enforces this automatically)
- All nine `data-testid` anchors from design-brief constraint G1 still resolve

#### Manual Verification

- Every stage is visible without horizontal scrolling on a standard desktop viewport
- With enough stages to exceed the min-width floor, columns stop shrinking and the container scrolls horizontally instead of rendering unreadable columns
- Header pills render in six distinct colors, cycling correctly when stage count exceeds the palette size
- A recruitment with custom stages (added via `StageEditor`) is colored coherently, with no uncolored or duplicate-adjacent column
- Cards show the accent bar in their column's color, with name and date laid out per D4
- A stage with zero candidates still renders as a visible column with the dashed "No candidates" placeholder
- The board reads correctly in both light and dark themes
- The loading skeleton matches the loaded layout with no visible jump
- Keyboard navigation reaches every card link and move trigger; a screen reader announces each column as a named region

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Test alignment and verification

### Overview

Lock the new contracts under test — deterministic color assignment, cyclic wrapping, and the labelled-region structure — and re-verify accessibility and contrast against the running board rather than against static token values.

### Changes Required

#### 1. Stage palette unit tests

**File**: `src/lib/stage-palette.test.ts` (new)

**Intent**: Pin the deterministic mapping so a future palette resize (or S-11 refactor) cannot silently change which stage gets which color.

**Contract**: Sits alongside `src/lib/contrast.test.ts` and `src/lib/theme.test.ts`. Covers: the same `sortOrder` always yields the same classes; wrapping past the palette size returns to the first hue; adjacent `sortOrder` values never collide; and the non-contiguous, zero-based, one-based, and negative `sortOrder` cases named in the helper's contract are all handled without returning an undefined class.

#### 2. Board component tests

**File**: `src/components/recruitments/KanbanBoard.test.tsx` (new)

**Intent**: Cover the structural contracts the E2E suite depends on but does not assert directly, so a regression is caught at the unit level rather than in a browser run.

**Contract**: Follows the existing `MoveCandidateDialog.test.tsx` / `StageEditor.test.tsx` conventions in the same directory. Asserts: each column is an accessible region named by its stage; a zero-candidate stage still renders a column with the `No candidates` text; the date renders as a single node matching `/^Added \d{4}-\d{2}-\d{2}$/`; the `Move candidate {n}: {name}` trigger labels are numbered board-wide; and columns appear in `sortOrder` order as direct children of the `kanban-columns` element.

#### 3. E2E confirmation

**File**: `tests/e2e/candidates.spec.ts`, `tests/e2e/recruitments.spec.ts`

**Intent**: Confirm the existing board specs still pass against the new markup, and repair only what the layout change genuinely breaks.

**Contract**: These specs are expected to pass **unchanged** — the `kanban-columns > div` nth locators, the `/^Added \d{4}-\d{2}-\d{2}$/` regex, the `No candidates` text and the `Move candidate` name pattern were all deliberately preserved in Phase 2. If any assertion fails, the correct repair is to the component (restoring the contract) rather than to the assertion, unless the failure is a genuine, intended structural change. Per `CLAUDE.md`, no new locator may bind to a color literal or CSS/DOM-structure selector.

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Full unit suite passes, including the two new test files: `npm run test`
- Full E2E suite passes: `npm run test:e2e`
- `tests/e2e/candidates.spec.ts` and `tests/e2e/recruitments.spec.ts` pass with no assertion-layer edits

#### Manual Verification

- `/dev/design-system` AA tables remain green in both themes after any Phase 2 hue retuning
- A screen reader walking the board announces each column region by stage name before reading its cards
- Stage color is confirmed to be non-essential: with color rendering disabled, every card's stage remains determinable from the column heading
- No visual regression on the adjacent candidate-detail page (`/recruitments/{id}/candidates/{candidateId}`), which shares the card idiom

**Implementation Note**: This is the final phase. Confirm the manual accessibility walk before closing the plan.

---

## Testing Strategy

### Unit Tests

- `stage-palette.ts`: determinism, cyclic wrap, adjacency, and the four `sortOrder` shape cases (zero-based, one-based, non-contiguous, negative)
- `KanbanBoard.tsx`: column region labelling, empty-stage rendering, single-node date text, board-wide move-trigger numbering, column order and DOM depth

### Integration Tests

- None required — no API, service, or DTO change in this slice

### Manual Testing Steps

1. Open a seeded recruitment board in light mode; confirm all stages visible with no horizontal scroll, distinct pill colors, and accent bars matching their column
2. Toggle to dark mode; confirm the same, with no washed-out or illegible pill
3. Add stages via `StageEditor` until the count exceeds the palette size; confirm colors cycle and the min-width floor engages, switching the container to horizontal scroll
4. Move a candidate between stages; confirm the card's accent bar changes to the destination color after refetch, and the mandatory-note rule is untouched
5. Open a recruitment with a stage that has zero candidates; confirm the column is still rendered with the dashed placeholder
6. Narrow the viewport to phone width; confirm columns hold their min-width and the board scrolls horizontally rather than collapsing
7. Navigate the board by keyboard only; confirm every card link and move trigger is reachable and focus is visible
8. Walk the board with a screen reader; confirm each column is announced as a named region

## Performance Considerations

Negligible. The stage-color helper is a modulo lookup per column, and no additional data is fetched. The board still has no pagination or virtualization — accepted deferred debt carried forward from S-01. Note only that the new card treatment is not denser than the current one, so it does not worsen the unbounded-candidate-count exposure.

## Migration Notes

None. No schema, DTO, or API change; no stored data carries color. A rollback is a revert of the component and token changes with no data implications. The new `--stage-*` tokens are additive — nothing existing consumes them, so Phase 1 alone is safe to land independently.

## References

- Research: `context/changes/kanban-visual-redesign/research.md`
- Roadmap slice S-10: `context/foundation/roadmap.md`
- Design brief section D (D1–D8) and constraints G: `context/changes/ui-redesign-foundation/design-brief.md`
- Token/contrast precedent: `src/lib/design-tokens.ts`, `src/lib/contrast.ts`, `src/pages/dev/design-system.astro`
- Presentation-map precedent: `src/lib/recruitment-status.ts:15-22`
- Prior slice that deferred this work: `context/changes/app-shell-navigation/plan.md`
- Colors-via-tokens rule: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Stage palette tokens and AA verification

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — 01b088e
- [x] 1.2 Linting passes: `npm run lint` — 01b088e
- [x] 1.3 Unit tests pass: `npm run test` — 01b088e
- [x] 1.4 `design-tokens.ts` declares twelve stage keys in both palettes and six new `tokenPairs` — 01b088e
- [x] 1.5 `global.css` declares twelve stage tokens in all three theme blocks and maps them in `@theme inline` — 01b088e

#### Manual

- [x] 1.6 Light-mode contrast table shows PASS for all six stage pairs — 01b088e
- [x] 1.7 Dark-mode contrast table shows PASS for all six stage pairs — 01b088e
- [x] 1.8 Six hues visually distinguishable in both themes, none clashing with `--primary` — 01b088e
- [x] 1.9 Theme toggle recolors stage samples, confirming the `.dark` block — 01b088e

### Phase 2: Board redesign

#### Automated

- [x] 2.1 Type checking passes: `npm run build` — 95ff2d9
- [x] 2.2 Linting passes with no new `jsx-a11y` warnings: `npm run lint` — 95ff2d9
- [x] 2.3 Unit tests pass: `npm run test` — 95ff2d9
- [x] 2.4 Existing E2E suite passes unchanged: `npm run test:e2e` — 95ff2d9
- [x] 2.5 No raw Tailwind palette literal or hex value in the diff (self-audit) — 95ff2d9
- [x] 2.6 All nine `data-testid` anchors still resolve — 95ff2d9

#### Manual

- [x] 2.7 All stages visible without horizontal scrolling on desktop — 95ff2d9
- [x] 2.8 Min-width floor engages and container scrolls when stage count overflows — 95ff2d9
- [x] 2.9 Header pills render six distinct colors, cycling correctly past the palette size — 95ff2d9
- [x] 2.10 Custom stages from `StageEditor` colored coherently — 95ff2d9
- [x] 2.11 Cards show accent bar in column color with D4 name/date layout — 95ff2d9
- [x] 2.12 Zero-candidate stage still renders a column with the dashed placeholder — 95ff2d9
- [x] 2.13 Board reads correctly in both themes — 95ff2d9
- [x] 2.14 Skeleton matches loaded layout with no jump — 95ff2d9
- [x] 2.15 Keyboard reaches every card link and move trigger; columns announced as named regions — 95ff2d9

### Phase 3: Test alignment and verification

#### Automated

- [x] 3.1 Type checking passes: `npm run build` — 8911a85
- [x] 3.2 Linting passes: `npm run lint` — 8911a85
- [x] 3.3 Full unit suite passes including both new test files: `npm run test` — 8911a85
- [x] 3.4 Full E2E suite passes: `npm run test:e2e` — 8911a85
- [x] 3.5 Board E2E specs pass with no assertion-layer edits — 8911a85

#### Manual

- [x] 3.6 AA tables still green in both themes after any hue retuning — 8911a85
- [x] 3.7 Screen reader announces each column region by stage name before its cards — 8911a85
- [x] 3.8 Stage determinable without color rendering — 8911a85
- [x] 3.9 No visual regression on the candidate-detail page — 8911a85
