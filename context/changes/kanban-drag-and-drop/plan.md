# Kanban Drag-and-Drop Implementation Plan

## Overview

Add drag-and-drop card movement to the kanban board (roadmap slice S-11). Dragging a candidate card — by mouse or keyboard — onto a different column opens the existing `MoveCandidateDialog` pre-filled with the target stage. The drop itself never writes anything; it is strictly a shortcut to open the dialog the user must still confirm (with a note), so the mandatory move-note rule (FR-013, enforced by the `move_candidate_stage` RPC) is untouched. The existing per-card "Move" button stays fully functional as an equal, not fallback, path.

## Current State Analysis

- [KanbanBoard.tsx](src/components/recruitments/KanbanBoard.tsx) renders stage columns (`role="region"`, `aria-labelledby` keyed by `stage.id`) and candidate `Card`s with a stage-colored accent bar. No drag code exists.
- [MoveCandidateDialog.tsx](src/components/recruitments/MoveCandidateDialog.tsx) is self-contained: it owns its own `open` state, its trigger is an icon `Button`, and `MoveCandidateForm` derives its initial `toStageId`/`note` from the fetched `CandidateDetailDto.currentStageId` once loaded.
- The one sanctioned mutation path is `PATCH /api/recruitments/:id/candidates/:candidateId` → `moveCandidateStage()` → RPC `move_candidate_stage`, which requires a non-empty note for the stage being left and is unaffected by this plan.
- No dnd library exists in `package.json`; this is a deliberate reversal of three prior slices' decision to avoid one — now made official by roadmap S-11.
- `src/styles/global.css` already defines a `--ring` token (used for focus rings) in both light/dark blocks, reusable for a target-column drag-highlight without inventing a new token.
- No existing E2E test touches drag or move-by-card interactions (`tests/e2e/kanban-stages.spec.ts` covers stage CRUD, not moves), so there is no legacy assertion layer to preserve here beyond the general `data-testid="kanban-columns"` / `data-testid="move-candidate-dialog"` anchors.

## Desired End State

A recruiter can pick up a candidate card (mouse drag, or keyboard: Tab to focus, Space to lift, Arrow keys to move between columns, Space/Enter to drop) and release it over a different column. On drop, `MoveCandidateDialog` opens pre-filled with the target stage and the note field seeded per existing behavior; confirming moves the candidate exactly as the button path does today. Cancelling or a failed save leaves the card in its original column. The per-card Move button continues to work unchanged.

**Verification**: `npm run build` and `npm run lint` pass; Vitest unit tests for the board/dialog contracts pass; a new Playwright E2E spec exercises mouse-drag, keyboard-drag, and cancel-leaves-card-in-place.

### Key Discoveries:

- [KanbanBoard.tsx:134-138](src/components/recruitments/KanbanBoard.tsx#L134) — `cardIndexById` is a board-wide index used only for the Move button's aria-label; unaffected by this change but must still resolve correctly once cards are wrapped in draggable containers.
- [MoveCandidateDialog.tsx:135](src/components/recruitments/MoveCandidateDialog.tsx#L135) — `open` state currently lives inside `MoveCandidateDialog` itself; this plan lifts it to be controllable from `KanbanBoard` so a drop can open the same dialog instance with a specific initial stage.
- [MoveCandidateForm](src/components/recruitments/MoveCandidateDialog.tsx#L35) seeds `toStageId` from `detail.currentStageId` once the candidate detail loads; this needs an optional override so a drag-initiated open can seed the *target* stage instead of the current one.

## What We're NOT Doing

- No changes to the API route, Zod schema, service, or RPC — the mutation path is already correct and sufficient.
- No optimistic move of the card into the target column before confirmation — the card stays in its origin column until the dialog is confirmed (per roadmap framing: a drop is only a shortcut to open the dialog).
- No toast/notification system — failures continue to render inline inside the open dialog, exactly as today.
- No changes to `stage-palette.ts` or the stage color system.
- No new drag library beyond `@dnd-kit/core` (and `@dnd-kit/utilities` if needed for transform helpers) — no `@dnd-kit/sortable`, since within-column reordering is out of scope.
- No changes to `tests/e2e/kanban-stages.spec.ts` or other existing specs.

## Implementation Approach

Wrap the columns container in a single `DndContext` (pointer + keyboard sensors) inside `KanbanBoard`. Each column becomes a `useDroppable` target keyed by `stage.id`; each card becomes a `useDraggable` source keyed by `candidateRecruitmentId`. `KanbanBoard` owns one lifted dialog-open state (`{ candidateRecruitmentId, initialStageId } | null`) set both by the existing per-card button (initial = current stage, unchanged behavior) and by `onDragEnd` (initial = the dropped-on column's stage, only when it differs from the card's current column). `MoveCandidateDialog` becomes a controlled component reading that state instead of managing its own `open`.

## Phase 1: DnD foundation

### Overview

Add the dependency and wire up drag detection with no visible/behavioral change beyond the ability to pick up and drop a card (drop is a no-op placeholder in this phase).

### Changes Required:

#### 1. Add dependency

**File**: `package.json`

**Intent**: Add `@dnd-kit/core` (and `@dnd-kit/utilities` for the transform CSS helper) as the sole new runtime dependency for this slice.

**Contract**: `npm install @dnd-kit/core @dnd-kit/utilities` — both packages support React 19.

#### 2. Wrap board in DndContext with sensors

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: Wrap the `data-testid="kanban-columns"` container in a `DndContext` configured with `PointerSensor` and `KeyboardSensor` (from `@dnd-kit/core`), so both mouse and keyboard users can initiate a drag.

**Contract**: `DndContext` takes `sensors`, `onDragEnd` (initially a no-op / logs nothing — wired up in Phase 3), and wraps the existing column-rendering JSX unchanged. `KeyboardSensor`'s default coordinate-getter is sufficient since columns lay out horizontally with cards stacked vertically inside — no custom coordinate function needed.

#### 3. Make columns droppable

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: Each stage column becomes a drop target identified by `stage.id`, so `onDragEnd` can resolve which stage a card was released over.

**Contract**: `useDroppable({ id: stage.id })`; the returned `setNodeRef` attaches to the existing column `div` (the one with `role="region"`) without altering its existing props/classes structurally.

#### 4. Make cards draggable

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: Each candidate `Card` becomes a drag source identified by `candidateRecruitmentId`, carrying enough data in its `useDraggable` payload (`{ candidateRecruitmentId, fromStageId: stage.id }`) for `onDragEnd` to detect a same-column drop and ignore it.

**Contract**: `useDraggable({ id: candidate.candidateRecruitmentId, data: { fromStageId: stage.id } })`; `setNodeRef`, `listeners`, and `attributes` spread onto the `Card` root. The existing `MoveCandidateDialog` trigger button inside the card must remain independently clickable — `attributes`/`listeners` from `useDraggable` must not swallow pointer events meant for the button (verify in Phase 4's manual pass; `@dnd-kit`'s default sensors already distinguish a click from a drag via activation distance, so no extra guard is expected to be needed).

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds
- `npm run lint` passes
- Existing `KanbanBoard.test.tsx` contract tests still pass unchanged (region labeling, sortOrder DOM order, card numbering)

#### Manual Verification:

- A card can be picked up with the mouse and dropped without a console error
- Tab reaches a card, Space "picks it up" (dnd-kit keyboard sensor activates — verify via browser focus/aria state), Arrow keys move focus between drop targets, Space drops
- The per-card Move button remains independently clickable while a card is draggable

---

## Phase 2: Drag visuals

### Overview

Give the drag interaction a visible affordance: a floating overlay copy of the dragged card, and a highlighted border on the column currently being dragged over.

### Changes Required:

#### 1. Drag overlay

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: Render a `DragOverlay` showing a lifted copy of the active card while dragging, using `onDragStart`/`onDragEnd` to track which candidate is active.

**Contract**: `DragOverlay` renders the same `Card` markup (name + accent bar) for the actively-dragged candidate, tracked via `activeId` state set in `onDragStart`/cleared in `onDragEnd`.

#### 2. Target column highlight

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: While a card is being dragged over a column, that column's container gets a visible highlight using the existing `--ring` token (e.g. a ring/border utility class), applied via `useDroppable`'s `isOver` flag.

**Contract**: `cn()`-merge a `ring-2 ring-ring` (or equivalent existing ring utility) class onto the column container when `isOver` is true; token-based per [lessons.md](context/foundation/lessons.md) "colors only through design tokens" rule — no new raw color literal.

#### 3. Keyboard drag instructions

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: Provide `DndContext`'s `accessibility.announcements` (or an equivalent visually-hidden instructions element) so screen reader / keyboard users understand how to pick up and move a card, since the interaction has no visible button prompting it.

**Contract**: Use `@dnd-kit/core`'s built-in `useDndMonitor`/`announcements` hook surface (or a `sr-only` static instructions paragraph referenced by the draggable's `aria-describedby`) — whichever the library's own accessibility API surfaces most directly; no custom live-region plumbing beyond what `@dnd-kit/core` already provides.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds
- `npm run lint` passes

#### Manual Verification:

- Dragging a card with the mouse shows a floating overlay copy and the hovered column visibly highlights
- The highlight is visible with sufficient contrast in both light and dark themes (spot-check via `/dev/design-system` or the existing contrast tooling, since `--ring` is already AA-verified for its existing use as a focus ring)
- A screen reader (VoiceOver) announces pickup/move/drop guidance for a card

---

## Phase 3: Dialog integration

### Overview

Wire a drop onto a different column to open `MoveCandidateDialog` pre-filled with the target stage, replacing the dialog's internally-owned `open` state with one lifted into `KanbanBoard`.

### Changes Required:

#### 1. Lift dialog open state into KanbanBoard

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: `KanbanBoard` holds one `moveDialogState: { candidateRecruitmentId: number; initialStageId?: number } | null`, set by the per-card Move button (no `initialStageId` override — same as today's current-stage seeding) and by a valid cross-column drop (`initialStageId` = the target column's `stage.id`).

**Contract**: `onDragEnd(event)` reads `event.over?.id` (target stage id) and `event.active.data.current?.fromStageId`; if they differ and `event.over` exists, sets `moveDialogState` to open the dialog for that candidate with the target stage pre-filled. A same-column drop or a drop outside any droppable is a no-op.

#### 2. Convert MoveCandidateDialog to a controlled component

**File**: `src/components/recruitments/MoveCandidateDialog.tsx`

**Intent**: Replace the internal `useState(false)` for `open` with `open`/`onOpenChange` props supplied by `KanbanBoard`, and accept an optional `initialStageId` passed through to `MoveCandidateForm` to seed `toStageId` (overriding the detail-derived default) when present.

**Contract**: `MoveCandidateDialogProps` gains `open: boolean`, `onOpenChange: (open: boolean) => void`, `initialStageId?: number`. `MoveCandidateForm`'s seeding logic (`detail && detail !== seededDetail`) sets `toStageId` to `initialStageId ?? detail.currentStageId` when seeding. The per-card Move button becomes a plain trigger `Button` (no longer `DialogTrigger asChild`) that calls `onOpenChange(true)` via the lifted state in `KanbanBoard`, since the `Dialog` root now needs to live where the lifted `open` state lives — confirm during implementation whether keeping `Dialog` mounted per-card (controlled by lifted state) or hoisting a single shared `Dialog` instance in `KanbanBoard` is the smaller diff; either satisfies this contract as long as only one dialog can be open at a time and `data-testid="move-candidate-dialog"` is preserved.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds
- `npm run lint` passes
- `KanbanBoard.test.tsx` and any `MoveCandidateDialog` unit tests pass, updated if the controlled-props change affects their setup

#### Manual Verification:

- Dropping a card onto a different column opens the dialog with that column's stage pre-selected and the note field empty (or seeded per existing per-stage note lookup, unchanged)
- Confirming the dialog moves the card into the new column and closes the dialog (existing refetch behavior)
- Cancelling the dialog (closing without confirming) leaves the card in its original column
- A failed save (e.g. simulate a network error) keeps the dialog open with the inline error, card still in its original column
- The per-card Move button still opens the dialog pre-filled with the *current* stage, exactly as before this change

---

## Phase 4: E2E verification

### Overview

Add browser-level coverage for the drag interactions per `/10x-e2e`, since dnd-kit's pointer/keyboard sensors are impractical to simulate reliably in jsdom.

### Changes Required:

#### 1. New E2E spec

**File**: `tests/e2e/kanban-drag-and-drop.spec.ts`

**Intent**: Cover the risk this slice actually introduces: (a) mouse drag of a card to a different column opens the dialog pre-filled with that stage and confirming it moves the candidate; (b) the keyboard-only equivalent (focus card, pick up, move, drop) does the same; (c) cancelling the dialog after a drop leaves the card in its original column with no move recorded.

**Contract**: Follow `/10x-e2e`'s workflow (seed via existing fixtures, `getByRole`/`getByLabel` locators, no `waitForTimeout`, unique per-test data, cleanup). Use Playwright's mouse `dragTo`/manual `mouse.move`+`mouse.down`+`mouse.up` sequence for the mouse case, and `keyboard.press` sequences (Tab, Space, Arrow, Space) for the keyboard case, asserting against the dialog's pre-filled stage `<select>` value and the resulting column membership after confirmation.

### Success Criteria:

#### Automated Verification:

- New Playwright spec passes: `npx playwright test tests/e2e/kanban-drag-and-drop.spec.ts`
- Full E2E suite still passes (no regression to `kanban-stages.spec.ts` or others)

#### Manual Verification:

- Manually perform the mouse-drag, keyboard-drag, and cancel flows once against the running dev server to confirm the automated spec matches real behavior

---

## Testing Strategy

### Unit Tests:

- `KanbanBoard.test.tsx`: verify columns/cards still render their existing contracts (region labeling, DOM order, card numbering) once wrapped in `DndContext`/`useDroppable`/`useDraggable`.
- `MoveCandidateDialog` (new or extended unit test): verify the controlled `open`/`onOpenChange`/`initialStageId` props behave correctly — dialog opens/closes per prop, `initialStageId` overrides the seeded stage when provided.

### Integration Tests:

- None beyond the above component-level contracts; drag gesture coverage lives entirely in E2E (Phase 4), per the confirmed test-strategy decision.

### Manual Testing Steps:

1. Drag a card by mouse to a different column; confirm the dialog opens pre-filled with that stage, confirm the move, verify the card lands in the new column.
2. Repeat via keyboard only (Tab, Space, Arrow keys, Space).
3. Drag a card and cancel the dialog; verify the card stays in its original column.
4. Attempt to drop a card back into its own column; verify nothing happens (no dialog opens).
5. Click the existing per-card Move button; verify it still opens the dialog pre-filled with the *current* stage, independent of any drag interaction.
6. Check the target-column highlight and drag overlay in both light and dark themes.

## Performance Considerations

None expected — `@dnd-kit/core` only activates listeners on interaction and the board's data volume (a handful of stages/candidates per recruitment) is far below any scale where sensor overhead would be noticeable.

## Migration Notes

None — no data model or persisted-state changes.

## References

- Related research: `context/changes/kanban-drag-and-drop/research.md`
- Sanctioned move path: [src/lib/services/candidates.ts:42-80](src/lib/services/candidates.ts#L42), [supabase/migrations/20260901210500_candidate_write_rpcs.sql:119-182](supabase/migrations/20260901210500_candidate_write_rpcs.sql#L119)
- Prior deliberate no-dnd decisions: `context/changes/kanban-visual-redesign/research.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DnD foundation

#### Automated

- [x] 1.1 `npm run build` succeeds — 3b7dd5e
- [x] 1.2 `npm run lint` passes — 3b7dd5e
- [x] 1.3 Existing `KanbanBoard.test.tsx` contract tests still pass unchanged — 3b7dd5e

#### Manual

- [x] 1.4 A card can be picked up with the mouse and dropped without a console error — 3b7dd5e
- [x] 1.5 Keyboard pickup/move/drop works via Tab, Space, Arrow keys, Space — 3b7dd5e
- [x] 1.6 The per-card Move button remains independently clickable while a card is draggable — 3b7dd5e

### Phase 2: Drag visuals

#### Automated

- [x] 2.1 `npm run build` succeeds — 4a76754
- [x] 2.2 `npm run lint` passes — 4a76754

#### Manual

- [x] 2.3 Dragging shows a floating overlay copy and the hovered column highlights — 4a76754
- [x] 2.4 Highlight has sufficient contrast in both light and dark themes — 4a76754
- [x] 2.5 Screen reader announces pickup/move/drop guidance — 4a76754

### Phase 3: Dialog integration

#### Automated

- [x] 3.1 `npm run build` succeeds — 487a90c
- [x] 3.2 `npm run lint` passes — 487a90c
- [x] 3.3 `KanbanBoard.test.tsx` and `MoveCandidateDialog` unit tests pass — 487a90c

#### Manual

- [x] 3.4 Dropping onto a different column opens the dialog pre-filled with that stage — 487a90c
- [x] 3.5 Confirming moves the card and closes the dialog — 487a90c
- [x] 3.6 Cancelling leaves the card in its original column — 487a90c
- [x] 3.7 A failed save keeps the dialog open with inline error, card unmoved — 487a90c
- [x] 3.8 The per-card Move button still opens the dialog pre-filled with the current stage — 487a90c

### Phase 4: E2E verification

#### Automated

- [x] 4.1 New Playwright spec `tests/e2e/kanban-drag-and-drop.spec.ts` passes — e374a8e
- [x] 4.2 Full E2E suite still passes — e374a8e

#### Manual

- [x] 4.3 Manually perform mouse-drag, keyboard-drag, and cancel flows against the running dev server — e374a8e
