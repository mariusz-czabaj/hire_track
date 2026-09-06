---
date: 2026-09-06T00:00:00+02:00
researcher: Mariusz Czabaj
git_commit: 1b8a5993eccd6497c32110fa653e56ccacac97ca
branch: main
repository: hire_track
topic: "Kanban board visual redesign"
tags: [research, codebase, kanban, design-system, ui-redesign]
status: complete
last_updated: 2026-09-06
last_updated_by: Mariusz Czabaj
---

# Research: Kanban board visual redesign

**Date**: 2026-09-06T00:00:00+02:00
**Researcher**: Mariusz Czabaj
**Git Commit**: 1b8a5993eccd6497c32110fa653e56ccacac97ca
**Branch**: main
**Repository**: hire_track

## Research Question

What is the current implementation of the recruitment Kanban board, what design-system tokens/primitives constrain a redesign, and what prior decisions/non-goals from related changes should a visual redesign respect?

## Summary

The Kanban board (`KanbanBoard.tsx`) is a single React island rendering a horizontally-scrollable row of fixed-width (`w-64`) columns, one per stage, with cards as shadcn `Card` instances stacked vertically. **There is no drag-and-drop anywhere in the repo** — stage moves happen through a modal dialog with a `<select>` and a mandatory note field, and this is a deliberate, repeated architectural choice (no dnd dependency, consistency with button-based stage reordering, keyboard-fallback concerns), not an oversight. Colors in the board are **already 100% token-based** (no raw Tailwind palette literals) — a prior slice (`app-shell-navigation`, S-08) did a "readability-only" color-token sweep of exactly these files, explicitly deferring layout/spacing/component-structure changes to later slices (S-10, S-12, S-13) that a visual redesign would now pick up. The design-token layer (`global.css`) is mature (23 tokens × light/dark, OKLCH color space) and the "colors only via tokens" rule is a written lesson, not lint-enforced — so a redesign must self-police literal creep. Several UI primitives (Avatar, Tooltip, Separator, Select-as-dropdown) are not yet installed; `Textarea`/`FileInput` are known **not** migrated to tokens yet and should be treated as off-limits for direct reuse until migrated. The board has zero pagination, zero virtualization, and no mobile-specific layout (just horizontal scroll) — flagged repeatedly as accepted deferred debt.

## Detailed Findings

### Current Kanban board implementation

- Composition: `[id].astro` mounts `KanbanBoard` as a `client:load` island ([src/pages/recruitments/[id].astro](src/pages/recruitments/[id].astro)). Inside it: `StatusControl` (inline, KanbanBoard.tsx:53-107), `StageEditor` dialog (KanbanBoard.tsx:144), `AddCandidateDialog` (KanbanBoard.tsx:150), and per-stage columns rendered inline (not extracted into a `Column` component) containing shadcn `Card`s (KanbanBoard.tsx:153-189), each with a `MoveCandidateDialog` (KanbanBoard.tsx:175).
- No separate `Column`/`CardItem` components exist — columns and cards are inlined directly in `KanbanBoard.tsx`.
- **No drag-and-drop library** is present anywhere in `src/` (grep for "dnd"/"drag" returns nothing). Moving a candidate is done via `MoveCandidateDialog` → a `<select>` of target stages + mandatory stage-exit note → `PATCH /api/recruitments/{id}/candidates/{candidateRecruitmentId}`.
- Data flow: `useApiResource` ([src/components/hooks/useApiResource.ts:27](src/components/hooks/useApiResource.ts)) drives the board via `GET /api/recruitments/{id}/board`; every mutation (`useMutation`, [src/components/hooks/useMutation.ts:21](src/components/hooks/useMutation.ts)) calls `refetch()` on success — full board re-GET, no optimistic UI, no incremental patching. `refetch()` snaps directly to success/error state without an intermediate loading flash (useApiResource.ts:75-100).
- Layout classes: column row `flex gap-4 overflow-x-auto pb-2` (KanbanBoard.tsx:153); column `border-border bg-muted w-64 shrink-0 rounded-xl border p-3` (fixed 256px width, no reflow on narrow viewports — horizontal scroll only); card list `flex flex-col gap-2`.
- Card: shadcn `Card` (`bg-card text-card-foreground ... rounded-xl border py-6 shadow-sm`, [src/components/ui/card.tsx:8](src/components/ui/card.tsx)) with `className="gap-1 p-3"` override; shows candidate name (link, `hover:underline`) and "date added" timestamp only — **no note preview**, by deliberate design (`CandidateCardDto` doesn't carry note text so payload doesn't grow with note length).
- Empty column: dashed-border placeholder "No candidates" (KanbanBoard.tsx:161-165) — no icon/illustration. A stage with zero candidates is **always rendered as a visible empty column** — this is the single most emphasized invariant from S-01 research (a redesign must not collapse/hide empty stages).
- Loading: 4-column `SkeletonColumns` shell using shadcn `Skeleton` (pulse animation) (KanbanBoard.tsx:28-40).
- Not-found/error: shared centered muted box + back link, distinct from generic error (`ServerError`) — deliberate: unauthorized access renders identically to not-found (no 403 leak of recruitment existence).
- **All colors already token-based** — zero raw Tailwind color literals in KanbanBoard.tsx, StageEditor.tsx, AddCandidateDialog.tsx, MoveCandidateDialog.tsx. Status badges use `STATUS_PRESENTATION` map ([src/lib/recruitment-status.ts:15-22](src/lib/recruitment-status.ts)) over shadcn `badgeVariants`.
- Data model: `KanbanBoardDto` / `KanbanBoardStageDto` / `CandidateCardDto` in [src/types.ts:99-128](src/types.ts); `getKanbanBoard` service does 3 queries (recruitment, resolved stages, candidates grouped by `current_stage_id`) ([src/lib/services/recruitments.ts:255](src/lib/services/recruitments.ts)).
- No pagination or upper bound on candidates fetched per board — flagged as accepted deferred debt across S-01/S-03/S-04 impl reviews; relevant if a redesign changes card density.

### Design-system tokens and primitives available

- `src/styles/global.css` defines 23 CSS custom properties (OKLCH color space) across a `:root` (light), a `prefers-color-scheme: dark` fallback block, and an explicit `.dark` class block — same variable names, all mapped into Tailwind utilities via `@theme inline` (`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--chart-1..5` (unused, no charts planned), `--sidebar` family, plus `--radius-sm/md/lg/xl`, `--font-sans`, `--font-serif`, `--shadow-sm/md/lg`).
- A legacy `@utility bg-cosmic` (raw hex gradient, `global.css:198`) exists outside the token system, intentionally left until its last consumers (slices S-08/S-12/S-13) fully migrate — **not** something a kanban redesign should reach for.
- `src/lib/contrast.ts` implements WCAG 2.1 contrast math (OKLCH→linear-sRGB→relative luminance→ratio, AA thresholds 4.5/3.0), consumed only by the dev-only `/dev/design-system` route ([src/pages/dev/design-system.astro](src/pages/dev/design-system.astro), 404s outside `DEV`) which renders a live pass/fail contrast table plus every primitive/variant — a redesign should visually check new color combinations there.
- shadcn primitives currently installed: `Badge` (6 variants), `Button` (6 variants × 4 sizes), `Card` family, `Dialog`, `DropdownMenu`, `Input`, `Skeleton`. **Not yet installed**: `Avatar`, `Tooltip`, `Separator`, toast — would need `npx shadcn@latest add <name>` before a redesign could use them (e.g. a candidate-avatar-on-card idea).
- `Textarea` and `FileInput` are custom (not stock shadcn), still carry hardcoded cosmic-theme classes, and are **explicitly not migrated** to tokens yet (pending slice S-13) — treat as not-reusable as-is in a redesign.
- The established filter-control pattern in this app is **chip/button toggles**, not a dropdown `<Select>` — an installed but unused `select.tsx` was deleted in S-01's impl review specifically because `StatusControl` uses button toggles instead.
- Enforcement of "colors only through tokens" is **not tooled** — no ESLint rule (`no-restricted-syntax`/similar), no CI check, no visual-regression gate; it exists purely as a written lesson. A redesign PR needs manual discipline/self-review against raw Tailwind color literals.
- `jsx-a11y` ESLint plugin is active at `warn` level for `.tsx` — an accessibility gate, unrelated to color enforcement but relevant since redesign changes should stay a11y-clean.

### Historical decisions and non-goals (from related changes)

- **S-01 `recruiter-views-kanban-board`**: established the horizontal-scroll-column layout, count-per-column header, "date added" (not "application date") card copy, always-visible empty columns, skeleton/not-found/error state idioms, and — critically — **no client-side capability/role gating anywhere**: affordances always render for every role, and denial is a clean 403/404-shaped message, never a hidden button or crash. A redesign must preserve this (don't hide buttons based on role client-side).
- **S-03 `recruiter-customizes-kanban-stages`**: added the stage-editor dialog as a header-row sibling to `StatusControl` — this establishes the header-affordance placement precedent. Confirmed again: no drag-and-drop dependency exists or was considered; reordering is button-based (up/down arrows). Stage names render raw/unstyled from the DB with no label-mapping (unlike recruitment status, which has a badge map) — worth deciding in the redesign whether stage names get any visual treatment.
- **S-04 `recruiter-manages-candidate-status`**: candidate moves are button+dialog based, not drag-and-drop, for the same reasons (no dnd dependency, consistency, keyboard fallback). The move is hard-blocked server-side without a note (422 surfaced inline on the textarea). Cards carry `candidateRecruitmentId` specifically to link to a candidate-detail page (`/recruitments/{id}/candidates/{candidateId}`) that lists per-stage notes Jira-comment style — this detail page is an adjacent screen a broader visual redesign should likely also account for. No candidate-removal affordance exists on the board by design.
- **`app-shell-navigation` (S-08)** is the most load-bearing precedent: it explicitly did a **color-token-only sweep** of `KanbanBoard.tsx`, `MoveCandidateDialog.tsx`, `StageEditor.tsx` and stated in scope: *"Card layouts, spacing rhythm, table shapes, empty-state copy and kanban column styling are untouched — S-10, S-12 and S-13 own those."* This means the current board visuals are consciously **not yet the final design** — a kanban-visual-redesign change is very likely the intended continuation of that S-10/S-12/S-13 line of work, not a from-scratch effort.
- App-shell chrome (sidebar/topbar) now wraps the board page (`containerWidth="wide"`); sidebar/nav is deliberately zero-JS Astro (no React island) — any new board-level chrome should respect this JS-budget convention.
- One e2e test previously coupled an assertion to a raw color-literal class (`bg-white/20`); it was reworked to a token/semantic-attribute check. A redesign must not reintroduce color-literal-coupled test locators — use role/label/semantic-attribute locators per repo E2E convention (also stated directly in [CLAUDE.md](CLAUDE.md)'s locator rule).
- `ui-redesign-foundation` change folder exists but is a thin placeholder (`change.md` only, references `design-brief.md`/`research.md` that weren't found at that path) — worth checking directly if the redesign needs the original design-brief requirements (B1–B7) cited by `app-shell-navigation/plan.md`.
- `recruitment-header-metadata` (referenced by `app-shell-navigation/plan.md` as the slice that fills the board page's `page-title`) is the change currently in progress in this repo (uncommitted changes to `src/pages/recruitments/[id].astro` per git status) — a kanban visual redesign should coordinate with whatever header layout that change lands, since it shares the same page.

## Code References

- `src/components/recruitments/KanbanBoard.tsx:28-40` - `SkeletonColumns` loading state
- `src/components/recruitments/KanbanBoard.tsx:53-107` - `StatusControl` (status pill toggles)
- `src/components/recruitments/KanbanBoard.tsx:109-190` - main board render: header, dialogs, columns, cards
- `src/components/recruitments/KanbanBoard.tsx:153-165` - column container + empty-state placeholder
- `src/components/recruitments/KanbanBoard.tsx:167-184` - card markup
- `src/components/recruitments/StageEditor.tsx` - stage add/remove/reorder dialog, locked once candidates exist
- `src/components/recruitments/AddCandidateDialog.tsx` - add-candidate dialog
- `src/components/recruitments/MoveCandidateDialog.tsx` - move-candidate dialog with mandatory note
- `src/components/hooks/useApiResource.ts:27,75-100` - board data fetch + refetch semantics
- `src/components/hooks/useMutation.ts:21,47-50` - mutation hook, 401 redirect
- `src/pages/api/recruitments/[id]/board.ts` - board GET endpoint
- `src/pages/recruitments/[id].astro` - page mounting the board island
- `src/types.ts:99-139` - `CandidateCardDto`, `KanbanBoardStageDto`, `KanbanBoardDto`, `MoveCandidateCommand`
- `src/lib/services/recruitments.ts:255` - `getKanbanBoard` service
- `src/lib/recruitment-status.ts:15-22` - `STATUS_PRESENTATION` badge-variant map
- `src/styles/global.css:44-151` - full token definitions (light/dark)
- `src/styles/global.css:153-196` - `@theme inline` Tailwind mapping
- `src/styles/global.css:198` - legacy `bg-cosmic` utility (not token-based, do not extend)
- `src/lib/contrast.ts` - WCAG contrast math
- `src/pages/dev/design-system.astro` - live token/primitive/contrast preview (dev-only)
- `src/components/ui/card.tsx:8` - base Card classes
- `src/components/ui/skeleton.tsx:5` - Skeleton base classes
- `src/components/ui/badge.tsx:8-24` - badge variants

## Architecture Insights

- Colors are already fully migrated to the design-token layer for every kanban-related file; the redesign's job is layout/spacing/interaction polish, not a token migration.
- The repo has a consistent "no drag-and-drop" architectural stance across three separate slices (stage reordering, candidate moves) — reintroducing dnd would be a deliberate reversal of a repeated decision, not a neutral choice, and should be called out explicitly if proposed.
- Full-board refetch-after-mutation (no optimistic updates, no incremental patching) is the established data-flow pattern; a redesign that adds richer interactions (e.g. inline status changes) should decide whether to keep this simple model or introduce optimistic UI.
- "Colors via tokens only" is a lesson, not a lint rule — any redesign PR should be self-audited for raw Tailwind color literals since nothing will catch it automatically.
- The `/dev/design-system` route is the built-in tool for validating new tokens/contrast before rolling them onto the board.

## Historical Context (from prior changes)

- `context/changes/recruiter-views-kanban-board/plan.md` - established board layout, empty-column invariant, no-dnd, no-client-gating precedents
- `context/changes/recruiter-customizes-kanban-stages/plan.md` - stage-editor header placement, button-based reordering
- `context/changes/recruiter-manages-candidate-status/plan.md` - move-dialog UX, mandatory note, candidate-detail page link
- `context/changes/app-shell-navigation/plan.md` - color-token sweep of the board files; explicitly defers kanban column styling to "S-10, S-12, S-13" (this change is likely that continuation)
- `context/changes/design-system-foundation/plan.md` - origin of the token layer and `/dev/design-system` tooling
- `context/foundation/lessons.md` - "colors only via tokens" rule (scope: S-08 onward, not retroactive)

## Related Research

- `context/changes/recruiter-views-kanban-board/research.md`
- `context/changes/recruiter-customizes-kanban-stages/research.md`
- `context/changes/recruiter-manages-candidate-status/research.md`
- `context/changes/app-shell-navigation/plan.md` (no separate research.md read for this one beyond plan/change)

## Open Questions

- What exactly are "S-10, S-12, S-13" in the roadmap (`context/foundation/roadmap.md`), and does this `kanban-visual-redesign` change correspond to one of them, or is it a new, differently-scoped effort? Worth checking `context/foundation/roadmap.md` before planning.
- Should the redesign introduce drag-and-drop (reversing a 3x-repeated decision), or stay button/dialog-based and focus purely on visual polish (spacing, density, card content, empty/loading states, column headers)?
- Does the redesign need to coordinate with the in-flight `recruitment-header-metadata` change (uncommitted changes to `src/pages/recruitments/[id].astro` per current git status)?
- Should stage names get a presentation/label treatment (like recruitment status badges), or stay raw text?
- Are `Avatar`/`Tooltip` primitives actually wanted for cards, justifying `npx shadcn@latest add avatar tooltip`?
