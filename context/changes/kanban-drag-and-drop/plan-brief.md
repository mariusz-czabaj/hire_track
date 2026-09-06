# Kanban Drag-and-Drop — Plan Brief

> Full plan: `context/changes/kanban-drag-and-drop/plan.md`
> Research: `context/changes/kanban-drag-and-drop/research.md`

## What & Why

Recruiters can drag a candidate card between kanban columns (mouse or keyboard) as a shortcut to opening the existing move dialog, pre-filled with the target stage. This is roadmap slice S-11 — the only new functionality in the M-2 visual-redesign milestone, and the one slice that touches a real business rule: the mandatory move note (FR-013) must survive unchanged.

## Starting Point

The board ([KanbanBoard.tsx](src/components/recruitments/KanbanBoard.tsx)) has zero drag infrastructure today. The only way to move a candidate is the per-card "Move" button, which opens `MoveCandidateDialog` — a self-contained component that fetches candidate detail, seeds a stage select + required note textarea, and PATCHes through the sanctioned `move_candidate_stage` RPC. No dnd library exists in `package.json`; three prior kanban slices deliberately avoided adding one, so this is a conscious reversal, now made official by the roadmap.

## Desired End State

A recruiter picks up a card and drops it on a different column; the same `MoveCandidateDialog` opens, pre-filled with that column's stage, and only confirming it moves the candidate. Keyboard users get an equivalent pick-up/move/drop flow via arrow keys. The button-based path is untouched and remains equally valid.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| DnD library | `@dnd-kit/core` (+ `@dnd-kit/utilities`) | First-class keyboard sensor satisfies the roadmap's hard accessibility requirement; React 19-compatible and actively maintained. | Plan |
| Card position pre-confirm | Stays in origin column | Matches the roadmap's exact framing — a drop is only a shortcut to open the dialog, never a write. | Plan |
| Keyboard interaction | dnd-kit's built-in keyboard sensor (Space/Arrow/Space) | Standard, tested pattern shipped with the library; makes drag genuinely keyboard-operable, not just mouse-operable. | Plan |
| Failure recovery | Card stays put, dialog shows inline error | Reuses `MoveCandidateDialog`'s existing error-handling exactly — no new state machine. | Plan |
| Drag visuals | `DragOverlay` + `--ring`-token column highlight | Standard drag affordance using dnd-kit's built-in overlay and an already-AA-verified token, no new color literal. | Plan |
| Test strategy | Unit tests for non-drag logic, Playwright E2E for drag/keyboard flows | dnd-kit sensors depend on real layout measurement that jsdom fakes poorly; matches this repo's established contract-test + E2E split. | Plan |

## Scope

**In scope:**
- `@dnd-kit/core` integration on `KanbanBoard` (drag detection, overlay, column highlight, keyboard sensor)
- Lifting `MoveCandidateDialog`'s open state to be drop-controllable, with an `initialStageId` override
- A new Playwright spec for mouse-drag, keyboard-drag, and cancel-leaves-card-in-place

**Out of scope:**
- Any change to the move API route, Zod schema, service, or RPC
- Optimistic card movement before dialog confirmation
- Toast/notification system
- Within-column reordering or `@dnd-kit/sortable`
- Changes to existing E2E specs (`kanban-stages.spec.ts`, etc.)

## Architecture / Approach

`KanbanBoard` wraps its columns in one `DndContext` (pointer + keyboard sensors). Columns become `useDroppable` targets keyed by `stage.id`; cards become `useDraggable` sources carrying their origin stage. `KanbanBoard` owns a single lifted dialog-open state set either by the existing per-card button (current stage) or by `onDragEnd` when a card is dropped on a *different* column (target stage). `MoveCandidateDialog` becomes a controlled component driven by that state instead of managing its own `open`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. DnD foundation | `@dnd-kit/core` wired up, columns droppable, cards draggable | Draggable listeners could swallow the Move button's own click events |
| 2. Drag visuals | Floating drag overlay, target-column highlight, keyboard instructions | Highlight contrast must hold in both themes |
| 3. Dialog integration | Drop opens `MoveCandidateDialog` pre-filled with target stage | Lifting `open` state changes the button trigger's wiring — must not regress it |
| 4. E2E verification | Playwright coverage for mouse drag, keyboard drag, cancel | dnd-kit gestures are notoriously fiddly to script reliably in Playwright |

**Prerequisites:** S-10 (`kanban-visual-redesign`) implemented — done.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- Whether `Dialog` should stay mounted per-card (controlled) or be hoisted to a single shared instance in `KanbanBoard` is left for the implementer to resolve in Phase 3 — either satisfies the contract as long as only one dialog is open at a time.
- Scripting reliable Playwright drag gestures against dnd-kit's sensors may need iteration in Phase 4.

## Success Criteria (Summary)

- A recruiter can move a candidate by dragging a card, with the note requirement still enforced exactly as today.
- The same move is fully achievable by keyboard alone.
- The existing button-based move path is unaffected.
