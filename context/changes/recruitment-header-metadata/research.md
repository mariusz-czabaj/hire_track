---
date: 2026-09-06T00:00:00+02:00
researcher: Mariusz Czabaj
git_commit: e18942deee2498a9e60958031ac1ee5115e57aef
branch: main
repository: hire_track
topic: "Recruitment header metadata (S-09): location, department, employment type, opened date"
tags: [research, codebase, recruitments, kanban-board, app-shell, header-metadata]
status: complete
last_updated: 2026-09-06
last_updated_by: Mariusz Czabaj
---

# Research: Recruitment header metadata (S-09)

**Date**: 2026-09-06T00:00:00+02:00
**Researcher**: Mariusz Czabaj
**Git Commit**: e18942deee2498a9e60958031ac1ee5115e57aef
**Branch**: main
**Repository**: hire_track

## Research Question

What is the current state of the recruitment detail page's header/metadata
display, and what does the codebase already provide (data model, API, AppShell
slots, prior-phase patterns) to implement S-09 — showing location, department,
employment type, and opened date in the recruitment header?

## Summary

The recruitment detail page (`src/pages/recruitments/[id].astro`) currently has
**no header at all** above the Kanban board — no `page-title`/`page-actions`
slot content, no metadata row. The only recruitment-level data rendered
anywhere near the board is the title and a status badge/control, and those live
*inside* `KanbanBoard.tsx`, not in a page-level header.

This gap is intentional: the just-completed `app-shell-navigation` (S-08)
change explicitly deferred "recruitment header metadata, status badge or '…'
actions menu" to S-09 (this change), while it did wire up `AppShell.astro`'s
`page-title` / `page-actions` slots for other pages. Every other AppShell page
puts a static `<h1 class="text-foreground text-3xl font-bold">` in
`page-title`, but none render dynamic entity metadata there — there is no
shared `PageHeader`/`DetailHeader` component to extend. S-09 is greenfield UI
work in that sense.

The data this slice needs to surface (`location`, `department`,
`employment_type`, `opened_at`) **already exists in the `recruitments` table**
but is not selected by `getKanbanBoard`, not on `KanbanBoardDto.recruitment`,
and not typed anywhere for board consumption. So the work spans: DB (no
migration needed — columns exist), service layer (extend the Supabase select +
return shape), DTO (`src/types.ts`), and the Astro page + `KanbanBoard.tsx`
header UI, following the token-only-color rule from
`context/foundation/lessons.md`.

## Detailed Findings

### Recruitment detail page today

- `src/pages/recruitments/[id].astro:11` reads `id` from `Astro.params` and
  renders `Layout` → `AppShell` → `KanbanBoard recruitmentId={id} client:load`
  directly (lines 14-31). No `page-title` or `page-actions` `Fragment` slot is
  used — the entire page body is the Kanban board component.
- Prior to S-08, this page had a bare `<a href="/recruitments">← Back to
  recruitments</a>` link and no other header content; S-08's diff (`ddc6f08`)
  removed that link (nav moved to the sidebar) and did **not** add a
  replacement title/metadata block.
- Sibling route `src/pages/recruitments/[id]/candidates/[candidateId].astro`
  (candidate-within-recruitment detail) also has no `page-title` — just a bare
  "← Back to board" link ahead of `CandidateDetail`.

### Where recruitment metadata is rendered today

- `src/components/recruitments/KanbanBoard.tsx:137-152` — the only place any
  recruitment-level info appears:
  - Line 140: `<h1 className="text-foreground text-2xl font-bold">{recruitment.title}</h1>`
  - Lines 141-143: `<Badge variant={STATUS_PRESENTATION[recruitment.status].variant}>{STATUS_PRESENTATION[recruitment.status].label}</Badge>`
  - Line 144: `<StatusControl recruitmentId={...} status={recruitment.status} onChanged={handleChanged} />` (a local status-switcher, lines 53-107, `PATCH /api/recruitments/{id}`)
  - Lines 145-150: `<StageEditor ... />` (action, not metadata)
  - Line 151: `<AddCandidateDialog ... />` (action, not metadata)
- No `location`, `department`, `employment_type`, `opened_at`, or
  `created_at` is rendered anywhere on this page. Candidate counts appear
  per-stage (`stage.candidateCount`, `KanbanBoard.tsx:159`), not as a
  recruitment-level total.
- `RecruitmentListItemDto` (`src/types.ts:73-81`, used by the *list* page)
  already carries richer fields than the board DTO — worth checking as a
  naming/shape reference when extending `KanbanBoardDto`.

### Data flow: DTO → API → service → DB

- `KanbanBoard.tsx:110-111,125` fetches `GET /api/recruitments/{id}/board` via
  `useApiResource<KanbanBoardDto>`, destructuring `{ recruitment, stages,
  stagesSource }`.
- `KanbanBoardDto` — `src/types.ts:110-118`:
  ```ts
  export interface KanbanBoardDto {
    recruitment: { id: number; title: string; status: RecruitmentStatus };
    stagesSource: "default" | "custom";
    stages: KanbanBoardStageDto[];
  }
  ```
  `recruitment` currently has exactly 3 fields — this is the type to extend.
- API route: `src/pages/api/recruitments/[id]/board.ts` — `GET` handler
  (lines 11-33) validates `id`, calls `getKanbanBoard(supabase, parsedId.data)`
  (line 24), 404s if null (25-27), else `jsonOk(board)` (28). No change needed
  here beyond whatever the service returns.
- Service: `src/lib/services/recruitments.ts:215-272` (`getKanbanBoard`).
  Line 218 selects only `id, title, status` from the `recruitments` table.
  Lines 255-259 build the returned `recruitment` object with the same 3
  fields. **This is the single choke point to widen** — add the new columns
  to the select and to the returned object.

### Database schema — fields already exist, no migration needed

`supabase/migrations/20260831182957_recruitment_candidate_schema.sql:13-23`:
```sql
create table recruitments (
  id bigint generated always as identity primary key,
  title text not null,
  location text,
  department text,
  employment_type text,
  opened_at date,
  status text not null default 'draft' check (status in ('draft', 'live', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
All four fields the outcome asks for (`location`, `department`,
`employment_type`, `opened_at`) are already columns, all nullable except the
implicit defaults on `status`/timestamps. No migration is required for S-09 —
purely a read/select + DTO + UI change. There is no `recruiter`/`owner`
column; access/ownership is modeled via `recruitment_security_groups`
(same migration, lines 25-31), not a single-owner field, so "recruiter name"
is out of scope for this slice's stated fields.

### AppShell integration point

- `AppShell.astro` (delivered by F-02) exposes `page-title` and
  `page-actions` slots. S-08's plan explicitly named these as the seam S-09
  should build on.
- Current usage pattern across S-08's phases (p3 recruitments list, p4
  candidates, p5 admin) is uniform and simple:
  ```astro
  <Fragment slot="page-title">
    <h1 class="text-foreground text-3xl font-bold">Recruitments</h1>
  </Fragment>
  <Fragment slot="page-actions">
    <a href="/recruitments/new" class="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors">
      New recruitment
    </a>
  </Fragment>
  ```
  (`src/pages/recruitments/index.astro`, post-S-08 diff.)
- Every existing `page-title` fragment is a **static string**, even on
  per-record detail pages (`candidates/[candidateId].astro` → "Candidates";
  `admin/groups/[id].astro` → "Security group"). **None render dynamic
  entity data in `page-title` today.** S-09 introducing a dynamic
  title + metadata row + status badge + actions menu in this slot is new
  pattern, not an extension of an existing shared component — there is no
  `PageHeader`/`DetailHeader` component in the codebase to reuse.
- Because `[id].astro` is an Astro page (not React), and `recruitment.title`/
  metadata is only known after the client-side `KanbanBoard` fetch resolves,
  putting the *dynamic* header content in the Astro `page-title` slot is not
  straightforward with the current data-fetching pattern (board data is
  fetched client-side via `useApiResource`, not server-side in the `.astro`
  frontmatter). Two realistic approaches to weigh in planning:
  1. Fetch minimal recruitment metadata server-side in `[id].astro`'s
     frontmatter (a lightweight Supabase call) to populate `page-title`
     immediately, independent of the client-fetched board data.
  2. Keep the header inside `KanbanBoard.tsx` (client-rendered, as today) and
     simply enrich the existing inline header block with the new fields,
     leaving `page-title`/`page-actions` slots empty as they are now — this
     is the lower-risk option since it doesn't introduce a second data-fetch
     path or a Astro/React boundary split for one header.

### Design-token constraint

`context/foundation/lessons.md` ("Colors only through design tokens, never
raw Tailwind palette literals") explicitly scopes to "S-08 through S-13 (and
any later slice touching `src/components/**` or `src/pages/**`)". Any new
metadata row, badges, or actions-menu styling added in S-09 must use existing
tokens (`--foreground`, `--muted-foreground`, `--primary`, etc.) or add new
tokens to both light/dark blocks in `src/styles/global.css` — never a raw
Tailwind color literal.

## Code References

- `src/pages/recruitments/[id].astro:11-31` — recruitment detail page, no header today
- `src/pages/recruitments/[id]/candidates/[candidateId].astro` — sibling detail page, same gap
- `src/components/recruitments/KanbanBoard.tsx:110-152` — current inline header (title + status only)
- `src/components/recruitments/KanbanBoard.tsx:53-107` — `StatusControl` (status-switcher pattern to reuse/extend for an actions menu)
- `src/types.ts:110-118` — `KanbanBoardDto` (the type to extend with new metadata fields)
- `src/types.ts:73-81` — `RecruitmentListItemDto` (reference for existing metadata field naming/shape)
- `src/pages/api/recruitments/[id]/board.ts:11-33` — `GET` board endpoint, no change needed beyond service output
- `src/lib/services/recruitments.ts:215-272` — `getKanbanBoard`, the single choke point to widen the select + returned shape
- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:13-23` — `recruitments` table, all four needed columns already present
- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:25-31` — `recruitment_security_groups` (no single "recruiter" field exists)
- `src/pages/recruitments/index.astro` — reference pattern for `page-title`/`page-actions` usage post-S-08
- `src/pages/candidates/[candidateId].astro` — p4 reference, static `page-title` on a detail page
- `src/pages/admin/groups/[id].astro` — p5 reference, static `page-title` on a detail page

## Architecture Insights

- Data-fetch boundary: Astro pages in this app fetch minimally (mostly just
  `Astro.params`), delegating to client-side React (`useApiResource`) for
  entity data. This matters for S-09 because `AppShell`'s `page-title` slot is
  rendered server-side in the `.astro` file, while the recruitment's title/
  metadata is currently only known client-side inside `KanbanBoard`.
- No shared header/detail-page component exists across recruitments,
  candidates, or admin areas — each area hand-rolls its own `page-title`
  markup. A generic `PageHeader`/`DetailHeader` component doesn't need to be
  invented to satisfy S-09 (scope is recruitment-specific per the roadmap
  outcome), but if S-10/S-12 also touch headers, a shared component might be
  worth flagging as a follow-up, not required now.
- Service layer (`src/lib/services/recruitments.ts`) is already the single
  choke point pattern for board data — extending its select is
  low-risk and consistent with how `stages`/`stagesSource` were added.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:58` — S-09 defined: "rekruter widzi w
  nagłówku rekrutacji jej lokalizację, dział, typ zatrudnienia i datę
  otwarcia", depends on F-02 + S-08, unlocks S-10.
- `context/foundation/roadmap.md:85` — "`KanbanBoardDto.recruitment` niesie
  tylko `id`, `title`, `status` (rozszerzenie w S-09)" — the roadmap itself
  already names the exact DTO extension point this research confirms.
- `context/changes/app-shell-navigation/plan.md` ("What We're NOT Doing") —
  explicit deferral: "No recruitment header metadata, status badge or '…'
  actions menu. That is S-09, which builds on the `page-title` /
  `page-actions` slots this change starts using."
- `context/changes/app-shell-navigation/change.md` — status `impl_reviewed`,
  confirms F-02 delivered `AppShell.astro`'s `page-title`/`page-actions`
  slots.
- `context/changes/app-shell-navigation/reviews/impl-review.md` — APPROVED,
  0 critical/0 warnings; does not mention recruitment header/metadata
  (consistent with it being out of scope for that change).
- `context/foundation/lessons.md` — token-only-color rule, explicitly scoped
  to include S-09.

## Related Research

- No prior `research.md` exists specifically for recruitment header/metadata;
  `context/changes/app-shell-navigation/plan.md` and `research.md` (if
  present) are the closest related artifacts and were consulted above.

## Open Questions

- Should the header live in the Astro `page-title`/`page-actions` slots
  (requiring a server-side metadata fetch in `[id].astro`'s frontmatter,
  independent of the client-side board fetch) or stay inline in
  `KanbanBoard.tsx` as an enriched version of the current header? The roadmap
  outcome and S-08's plan text both point toward using the slots, but no
  existing page in this codebase populates `page-title` with dynamic
  server-fetched entity data yet — this is a real design decision for
  `/10x-plan` to resolve, not something the research settles.
- Does the "…" actions menu mentioned in S-08's deferral note (alongside
  "status badge") belong to S-09's scope, or is it a separate future slice?
  The roadmap's one-line outcome for S-09 only mentions
  location/department/employment-type/opened-date, not an actions menu —
  worth clarifying before planning.
- Should `opened_at` (nullable `date`) have a defined empty-state
  presentation (e.g. "Not yet opened") since the column allows `null`?
- Is `RecruitmentListItemDto`'s existing field naming (`src/types.ts:73-81`)
  meant to be reused verbatim for the board DTO's new fields, for
  consistency across list and detail views?
