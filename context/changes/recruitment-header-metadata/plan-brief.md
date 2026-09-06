# Recruitment Header Metadata — Plan Brief

> Full plan: `context/changes/recruitment-header-metadata/plan.md`
> Research: `context/changes/recruitment-header-metadata/research.md`

## What & Why

A recruiter opening a recruitment's Kanban board can't see what the role actually is — only
its title and status. Roadmap slice S-09 puts the recruitment's location, department,
employment type and opened date into a header above the board. `app-shell-navigation` (S-08)
built the `page-title` slot for exactly this and explicitly deferred the content to here.

## Starting Point

`src/pages/recruitments/[id].astro` renders nothing but `<KanbanBoard client:load />`. It
fills neither of AppShell's header slots, even though `AppShell.astro:45-48` renders the
wrapper row unconditionally — so there is a live empty header row on every board page today.
The only recruitment chrome (title, status badge, three action triggers) lives inside the
React island and appears only after the client fetch resolves. All four metadata columns
already exist on the `recruitments` table; nothing selects them for a single recruitment.

## Desired End State

Opening a board shows the recruitment's title as the page's single `<h1>` with a metadata row
beneath it, both present in the initial server HTML — no waiting on hydration, and readable
with JavaScript off. The browser tab carries the recruitment's name instead of a generic
"Recruitment board". Fields without values simply don't appear. The board, status badge and
all controls behave exactly as before.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Header placement | Server-fetch in `[id].astro`, render into `page-title` | Fills the slot S-08 built for it; paints instantly and works without JS | Plan |
| Status badge | Stays client-side in `KanbanBoard` | Nothing status-dependent is server-rendered, so a status mutation can't strand a stale element — this is what makes the dual fetch safe | Plan |
| Null fields | Omit entirely; no row at all if all four are null | Keeps the header scannable; matches how the list view treats the same nullable columns | Plan |
| Data path | New narrow `getRecruitmentDetail`, not a widened `KanbanBoardDto` | Splits on mutability: static header data server-rendered once, volatile board data on the existing client refetch | Plan |
| Scope of controls | Metadata only — `StatusControl`/`StageEditor`/`AddCandidate` untouched | Matches the roadmap's one-line S-09 outcome; moving islands into an Astro slot needs cross-boundary plumbing | Plan |
| Test coverage | Service unit tests + extended E2E | Null-omission is unreachable through the app's own create form, so it belongs in unit tests; E2E covers the real server-render path | Plan |

## Scope

**In scope:** `getRecruitmentDetail` service function + `RecruitmentDetailDto`; server fetch
and header render in `[id].astro`; extracting `EMPLOYMENT_TYPE_LABELS` into a shared module;
removing the duplicate `<h1>` from `KanbanBoard`; unit + E2E coverage.

**Out of scope:** any migration (columns exist); the status badge and all three action
controls; the `page-actions` slot; a "…" overflow menu; editing metadata from the header;
changes to `getKanbanBoard` or `/board`; the candidate-detail page header; new design tokens.

## Architecture / Approach

Two read paths, split on mutability. The header's data never changes during a session, so it
is fetched once server-side in the page frontmatter and rendered into `page-title`. The
board's data mutates constantly and stays on the `useApiResource` client-refetch path it
already uses. Because no status-dependent chrome is server-rendered, a `StatusControl`
mutation followed by `refetch()` cannot leave a stale server element behind. The cost is
`title` being fetched twice per load — accepted in exchange for an instantly-visible header,
a real browser tab title, and a no-JS-readable page.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | `getRecruitmentDetail` + DTO + unit tests | Low — no UI, lands independently green |
| 2. Server-rendered header | The visible change; sets the server-fetch precedent | The `<h1>` add and remove must land together, or the page has two headings or none — and the E2E heading assertion can't tell the difference |
| 3. E2E coverage | Header assertions + pins the single-badge invariant | Low — flow already creates a populated recruitment |

**Prerequisites:** F-02 (design-system-foundation) and S-08 (`app-shell-navigation`), both
complete. Local Supabase running for E2E.
**Estimated effort:** ~1-2 sessions across 3 phases; ~6 files touched, no migration.

## Open Risks & Assumptions

- **This is the repo's first server-side Supabase fetch in an `.astro` page.** Every existing
  page delegates to a client island. The pattern is straightforward, but there is no in-repo
  precedent to copy — the API-route pattern is the nearest reference.
- There is **no `Astro.locals.supabase`**; middleware builds a client per request but doesn't
  attach it. The page builds its own, which can return `null` when env vars are unset — that
  branch must be handled, not assumed away.
- RLS applies identically to the page client and the API route, so a hidden recruitment
  returns `null`. Not-found and not-permitted must render identically to avoid leaking
  existence.
- `tests/e2e/recruitments.spec.ts:145` uses an unscoped `[data-slot="badge"]` locator that
  assumes exactly one badge page-wide. Phase 3 makes that assumption explicit; any future
  header badge will break it.
- Assumes no `employment_type` values outside `employmentTypeSchema` in production data;
  the query maps unrecognized values to `null` rather than throwing, so a bad row degrades
  one field instead of the page.

## Success Criteria (Summary)

- A recruiter sees department, location, employment type and opened date on the board page
  without scrolling, clicking, or waiting for the board to load.
- A recruitment missing some of those fields shows the ones it has, cleanly — no placeholders,
  gaps, or stray separators.
- Changing a recruitment's status still updates in place, with no page reload and no stale
  header.
