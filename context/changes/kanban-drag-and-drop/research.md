---
date: 2026-09-06T00:00:00Z
researcher: Mariusz Czabaj
git_commit: 379b864a140c8dbb5a970783d47f49ad52d4a762
branch: main
repository: hire_track
topic: "Kanban drag-and-drop (S-11)"
tags: [research, codebase, kanban, drag-and-drop, recruitments]
status: complete
last_updated: 2026-09-06
last_updated_by: Mariusz Czabaj
---

# Research: Kanban Drag-and-Drop (S-11)

**Date**: 2026-09-06
**Researcher**: Mariusz Czabaj
**Git Commit**: 379b864a140c8dbb5a970783d47f49ad52d4a762
**Branch**: main
**Repository**: hire_track

## Research Question

What is the current kanban board architecture, and what's needed to implement drag-and-drop for moving candidate cards between stages?

## Summary

This is **not** greenfield work — drag-and-drop is an already-specified roadmap slice, **S-11 `kanban-drag-and-drop`**, depending on S-10 (`kanban-visual-redesign`, implemented). The roadmap's own risk note is explicit and binding: **dropping a card must only open the existing `MoveCandidateDialog`, never silently commit a move** — the mandatory move-note requirement (enforced server-side by the `move_candidate_stage` RPC) must survive unchanged. The DnD library chosen must have first-class keyboard support, and the existing button/dialog move path must remain equally valid, not a legacy fallback.

Today there is **zero** drag-and-drop infrastructure in the codebase: no dnd library in `package.json`, no drag event handlers anywhere in `src/`. All stage moves go through one sanctioned path: `MoveCandidateDialog` → `PATCH /api/recruitments/:id/candidates/:candidateId` → `move_candidate_stage` RPC, which requires a non-empty note for the stage being left and writes a `candidate_recruitment_status_history` row.

Notably, prior kanban changes (`kanban-visual-redesign`, `recruiter-customizes-kanban-stages`) *deliberately avoided* introducing a dnd dependency, three times over, precisely so a future DnD reversal would be a conscious, explicit decision — which the roadmap has since made official via S-11.

## Detailed Findings

### Current KanbanBoard architecture

- [KanbanBoard.tsx](src/components/recruitments/KanbanBoard.tsx) (211 lines) fetches `/api/recruitments/${id}/board` via `useApiResource` ([KanbanBoard.tsx:113-114](src/components/recruitments/KanbanBoard.tsx#L113)), renders loading/404/error states, then columns.
- Columns render as `data-testid="kanban-columns"` container ([KanbanBoard.tsx:156](src/components/recruitments/KanbanBoard.tsx#L156)), each a `<div role="region" aria-labelledby={headingId}>` where `headingId` is derived from `stage.id` (not array index) for refetch stability ([KanbanBoard.tsx:158-167](src/components/recruitments/KanbanBoard.tsx#L158)).
- Column header pill background/foreground comes from `stageClassesForSortOrder(stage.sortOrder)` ([stage-palette.ts](src/lib/stage-palette.ts)), cycling 6 Tailwind token pairs modulo `STAGE_PALETTE_SIZE = 6`.
- Each candidate is a `Card` with a left accent bar colored via `stageClasses.background` ([KanbanBoard.tsx:182-185](src/components/recruitments/KanbanBoard.tsx#L182)), a name link, a `MoveCandidateDialog` trigger, and an "Added {date}" line.
- `cardIndexById` ([KanbanBoard.tsx:134-138](src/components/recruitments/KanbanBoard.tsx#L134)) is a board-wide 1-based index over `stages.flatMap(s => s.candidates)`, used only to number dialog trigger labels ("Move candidate N: Name") — exercised directly by [KanbanBoard.test.tsx:72-100](src/components/recruitments/KanbanBoard.test.tsx#L72).
- Columns render in `sortOrder` order as direct children of `#kanban-columns` — no wrapper div — verified by [KanbanBoard.test.tsx:102-123](src/components/recruitments/KanbanBoard.test.tsx#L102).
- **No drag-and-drop code exists anywhere in this component.**

### The one sanctioned move path today

- UI: [MoveCandidateDialog.tsx](src/components/recruitments/MoveCandidateDialog.tsx) — a `Dialog` with a stage `<select>` and a **required** `Textarea` note; submits via `useMutation` PATCH ([MoveCandidateDialog.tsx:52-55](src/components/recruitments/MoveCandidateDialog.tsx#L52)).
- API: `PATCH /api/recruitments/:id/candidates/:candidateId` ([index.ts](src/pages/api/recruitments/[id]/candidates/[candidateId]/index.ts)), Zod schema:
  ```ts
  const moveCandidateSchema = z.object({
    toStageId: z.number().int().positive(),
    note: z.string().trim().min(1).optional(),
  });
  ```
  ([index.ts:12-15](src/pages/api/recruitments/[id]/candidates/[candidateId]/index.ts#L12))
- Service: `moveCandidateStage()` in [candidates.ts:42-80](src/lib/services/candidates.ts#L42) scopes to the recruitment, then calls Supabase RPC `move_candidate_stage`.
- RPC: `move_candidate_stage(target_candidate_recruitment_id, to_stage_id, note)` in [20260901210500_candidate_write_rpcs.sql:119-182](supabase/migrations/20260901210500_candidate_write_rpcs.sql#L119) — checks `recruitment.write` permission, **upserts a required note for the stage being left** (raises `note_required` / `PA004` if none), updates `current_stage_id`, inserts a `candidate_recruitment_status_history` row. Documented as "the sole sanctioned path for changing" a candidate's stage.
- `board.ts` API route ([board.ts](src/pages/api/recruitments/[id]/board.ts)) is **GET-only** — no move endpoint lives there; the board is refetched via `resource.refetch()` after a successful move ([KanbanBoard.tsx:130-132](src/components/recruitments/KanbanBoard.tsx#L130), [MoveCandidateDialog.tsx] `onMoved()`).

### Drag-and-drop library status

- `package.json` has no `@dnd-kit/*`, `react-beautiful-dnd`, or `@hello-pangea/dnd` — grep across `package.json` and `src/` for dnd-related imports/handlers returns nothing.
- React 19.2.6 / `@astrojs/react` 5.0.4 — any chosen library must support React 19.
- shadcn/ui components present (`src/components/ui/`) provide no drag primitives.

### Supabase schema (stages / candidate-stage assignment)

- `kanban_stages` table: `id`, `recruitment_id` (nullable FK for defaults), `name`, `sort_order`, with partial unique indexes for default vs. per-recruitment ordering ([20260831182957_recruitment_candidate_schema.sql:37-49](supabase/migrations/20260831182957_recruitment_candidate_schema.sql#L37)).
- `candidate_recruitments.current_stage_id` references `kanban_stages(id)` ([same migration:79-90](supabase/migrations/20260831182957_recruitment_candidate_schema.sql#L79)) — this is the field a drag-drop mutates.
- `candidate_recruitment_status_history` — audit trail with `from_stage_id`, `to_stage_id`, `changed_by`, `changed_at`.

## Code References

- [src/components/recruitments/KanbanBoard.tsx](src/components/recruitments/KanbanBoard.tsx) - board rendering, columns, cards, no DnD
- [src/components/recruitments/KanbanBoard.test.tsx](src/components/recruitments/KanbanBoard.test.tsx) - existing contract tests (region labeling, sortOrder DOM order, card numbering)
- [src/components/recruitments/MoveCandidateDialog.tsx](src/components/recruitments/MoveCandidateDialog.tsx) - the sanctioned move UI (note required)
- [src/pages/api/recruitments/[id]/candidates/[candidateId]/index.ts](src/pages/api/recruitments/[id]/candidates/[candidateId]/index.ts) - PATCH move endpoint + Zod schema
- [src/lib/services/candidates.ts:42-80](src/lib/services/candidates.ts#L42) - `moveCandidateStage()` service
- [src/pages/api/recruitments/[id]/board.ts](src/pages/api/recruitments/[id]/board.ts) - GET-only board endpoint
- [src/lib/stage-palette.ts](src/lib/stage-palette.ts) - `stageClassesForSortOrder`, deterministic per-stage color
- [supabase/migrations/20260901210500_candidate_write_rpcs.sql:119-182](supabase/migrations/20260901210500_candidate_write_rpcs.sql#L119) - `move_candidate_stage` RPC (note enforcement, audit trail)
- [src/types.ts](src/types.ts) - `KanbanBoardDto`, `MoveCandidateCommand`, `KanbanBoardStageDto`, `CandidateCardDto`

## Architecture Insights

- **Region-labeled columns by stage id, not index**: `aria-labelledby` is keyed off `stage.id`, deliberately chosen for refetch stability — any DnD implementation must preserve this, not re-key by array position.
- **Deterministic per-stage coloring from `sortOrder`** cycling a fixed 6-color palette — works uniformly for default and custom stages.
- **Single source of truth for stage moves**: one API route, one RPC, enforced note. Any new UI path (drag) must call the *same* endpoint/RPC rather than introduce a parallel mutation path.
- **Server-enforced business rule, not just UI convention**: the note requirement is enforced in the RPC itself (`note_required` / `PA004`), so a drag interaction cannot bypass it even if the client tried — but the UX still needs to route through `MoveCandidateDialog` (or equivalent note capture) rather than surprise the user with a rejected drop.

## Historical Context (from prior changes)

- [context/foundation/roadmap.md:60](context/foundation/roadmap.md#L60): S-11 `kanban-drag-and-drop`, depends on S-10, milestone MS-05, status `new`.
- [context/foundation/roadmap.md:149-159]: S-11's risk note (paraphrased) — drag **must not** become a shortcut around the note; a drop is only a shortcut to open the existing `MoveCandidateDialog`, never a standalone write; requires a DnD library with keyboard support; existing button-based move path must remain equally valid, not a fallback.
- [context/foundation/roadmap.md:71]: dependency chain `F-02 → S-08 → S-09 → S-10 → S-11`; DnD called out as "the only new functionality in this milestone."
- [context/changes/kanban-visual-redesign/plan-brief.md:30,36] and [plan.md:7,39](context/changes/kanban-visual-redesign/plan.md#L7): "No drag-and-drop. That is S-11 (`kanban-drag-and-drop`), which depends on this slice landing first."
- [context/changes/kanban-visual-redesign/research.md:28,36,61-62,98]: flags that avoiding a dnd dependency was a **deliberate, repeated** architectural choice (also in `recruiter-customizes-kanban-stages`, `recruiter-manages-candidate-status`) for keyboard-accessibility and consistency reasons — "reintroducing dnd would be a deliberate reversal of a repeated decision, not a neutral choice, and should be called out explicitly if proposed." The roadmap has since made that reversal official via S-11, but a plan for this change should still surface the reversal explicitly.
- [context/foundation/roadmap.md] S-14 `accessibility-audit-wcag-aa` (status `new`) is the downstream safety net that re-verifies WCAG AA app-wide, explicitly including keyboard operability of candidate moves (i.e., drag-and-drop).
- S-10's roadmap "at a glance" table entry may still read `in-progress`/not flipped to `done` despite the epilogue commit (`379b864`) closing it out — worth correcting before starting S-11 work.
- `context/foundation/prd.md` does not mention drag-and-drop directly; it exists only at the roadmap slice level.

## Related Research

- [context/changes/kanban-visual-redesign/research.md](context/changes/kanban-visual-redesign/research.md)
- [context/changes/recruiter-views-kanban-board/research.md](context/changes/recruiter-views-kanban-board/research.md)
- [context/changes/recruiter-customizes-kanban-stages/research.md](context/changes/recruiter-customizes-kanban-stages/research.md)

## Open Questions

- Which keyboard-accessible DnD library to adopt (none currently in `package.json`) — `@dnd-kit/core` is the common React 19-compatible choice satisfying the keyboard requirement, but this decision belongs in `/10x-plan`, not here.
- Should the drop gesture always open `MoveCandidateDialog` pre-filled with the target stage (requiring the user to still type a note and confirm), or is there a lighter-weight confirmation the roadmap risk note would still accept? The roadmap language ("drop is only a shortcut to open the dialog") suggests pre-filling + still requiring explicit confirmation, but the shortcut UX vs. dialog-modality trade-off needs plan-level decision.
- Whether to update `context/foundation/roadmap.md`'s S-10 status to `done` as part of this change or a separate housekeeping change.
