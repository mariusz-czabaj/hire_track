---
date: 2026-09-05T15:45:43Z
researcher: Mariusz Czabaj
git_commit: 55d85b0bb543c0f768894e7c4af6cebcde1155b6
branch: main
repository: 10x
topic: "HireTrack UI analysis as input for a visual redesign"
tags: [research, codebase, ui, design-system, tailwind, shadcn, astro, accessibility]
status: complete
last_updated: 2026-09-05
last_updated_by: Mariusz Czabaj
---

# Research: HireTrack UI analysis as input for a visual redesign

**Date**: 2026-09-05T15:45:43Z
**Researcher**: Mariusz Czabaj
**Git Commit**: 55d85b0bb543c0f768894e7c4af6cebcde1155b6
**Branch**: main
**Repository**: 10x

## Research Question

Analyse the hire_track project with a focus on the UI. The results will be used to plan a
visual redesign of the interface.

> Note on naming: there is no `hire_track` directory. The recruitment product (recruitments,
> kanban, candidates, security groups) *is* this repository — still carrying the starter's
> name `10x-astro-starter` in `package.json` and `10x Astro Starter` as the default page
> title. That naming leftover is itself a redesign item.

## Summary

The UI is functionally complete for the shipped slices but visually it is still the
**starter's "cosmic" theme**, applied by hand at every call site rather than through a design
system. Two styling systems coexist and the wrong one won:

1. A full **shadcn/ui token layer** exists (`src/styles/global.css` defines the complete
   `--background/--card/--primary/--muted/...` set for light and dark) and the primitives in
   `src/components/ui/` are **stock, unmodified, token-based** shadcn components.
2. Every feature screen **overrides those tokens with hard-coded utility classes** —
   `bg-white/10`, `border-white/10`, `text-blue-100/70`, `text-purple-300`, `bg-purple-600`,
   plus a `bg-cosmic` gradient and `bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text`
   headline treatment.

Counted across `src/` (tests excluded): `bg-white/` ×81, `text-blue-100` ×72, `border-white/`
×56, `text-purple-` ×23, `bg-purple-` ×17, `bg-cosmic` ×14, the gradient headline ×12 — versus
`text-muted-foreground` ×4, `bg-primary` ×5, `bg-card` ×1 (all inside `src/components/ui/`
itself, i.e. essentially zero token usage in feature code).

The practical consequence: **the theme cannot be changed from one place.** `.dark` is
hard-coded on `<html>` in the layout, and even switching it would change almost nothing,
because the visible colours are literal Tailwind palette values in ~35 files.

The good news for a redesign: the primitives are untouched, state handling is uniform
(`useApiResource` gives every screen loading/empty/error/not-found), the data layer is
cleanly separated from presentation, and E2E tests are mostly role/label-based — so a restyle
is largely a **class-and-shell** change, not a rewrite.

## Detailed Findings

### 1. Theming: token layer defined, then bypassed

- `src/styles/global.css:1-120` — complete shadcn `new-york`/`neutral` token set for `:root`
  and `.dark`, wired into Tailwind 4 via `@theme inline`. Radius scale `--radius: 0.625rem`.
- `src/styles/global.css:121-124` — the only project-specific addition is one utility:
  `@utility bg-cosmic { background-image: linear-gradient(to bottom, #0a0e1a, #0f1529, #0a0e1a); }`
  — raw hexes, outside the token system, not theme-aware.
- `src/layouts/Layout.astro:14` — `<html lang="en" class="dark">`: dark is permanent, there is
  no theme toggle and no `prefers-color-scheme` handling. The light token set is dead code.
- Chart tokens (`--chart-1..5`) and the whole `--sidebar-*` family are defined and **unused** —
  there is no sidebar and no charts.

**Redesign implication:** the token layer is the natural seam. Re-pointing `--primary`,
`--card`, `--border`, `--muted-foreground` to a HireTrack palette costs one file; the work is
in deleting the ~250 hard-coded overrides that currently shadow them.

### 2. Primitives vs. call sites

Primitives in `src/components/ui/` are stock shadcn, all `cn()`-composable and token-driven:
`button.tsx` (6 variants × 4 sizes), `card.tsx` (7 slots), `badge.tsx` (6 variants),
`dialog.tsx` (radix, with `DialogFooter` extended by a local `showCloseButton` prop),
`input.tsx`, `textarea.tsx`, `skeleton.tsx`, `file-input.tsx`.

Every consumer neutralises them at the call site:

- `src/components/recruitments/RecruitmentList.tsx:85` —
  `<Card className="... border-white/10 bg-white/10 p-4 text-white hover:bg-white/15">`:
  `bg-card`, the border token and the `py-6` rhythm are all overridden.
- `src/components/recruitments/KanbanBoard.tsx:161` — same pattern on the kanban card.
- `src/components/recruitments/KanbanBoard.tsx:32-36`,
  `src/components/recruitments/RecruitmentList.tsx:74` — `<Skeleton className="... bg-white/10">`
  overrides `bg-accent` on every loading state.
- Only `Badge` is used as designed — via `STATUS_PRESENTATION` in
  `src/lib/recruitment-status.ts:16-24`, mapping `draft/live/closed` to
  `outline/default/secondary`. This is the one existing example of a semantic-token mapping and
  is the pattern the redesign should generalise.

Three components bypass the primitives entirely:

- `src/components/auth/FormField.tsx:5` — its own `inputBase` string
  (`bg-white/10 border ... placeholder-white/40 focus:ring-purple-400`) instead of `Input`,
  so auth forms and app forms cannot share a field style.
- `src/components/auth/ServerError.tsx:11` — bespoke `border-red-500/30 bg-red-900/30
  text-red-300` error box instead of a `destructive` token. It is the **only** error surface
  used app-wide, so one file governs every error's look.
- `src/components/Banner.astro` — scoped `<style>` with literal hexes (`#dbeafe`, `#fef3c7`,
  `#fee2e2`) and **light-mode colours on a permanently dark page**. It renders config errors at
  the very top of every page (`src/layouts/Layout.astro:20-33`) and is visually foreign.

Filter/segmented controls are hand-rolled `<button>` pill groups with duplicated selected/
unselected class logic — `RecruitmentList.tsx:57-64` (status filter) and
`KanbanBoard.tsx:93-99` (`StatusControl`) are the same 4 lines of `cn()` twice. There is no
`Tabs`, `Select`, `Toggle`, `Table`, `Toast`, `DropdownMenu`, `Avatar` or `Tooltip` primitive
installed — every future control is either hand-rolled or a new `npx shadcn add`.

### 3. Page shell, navigation and information architecture

Every route repeats the same three-line shell by hand:

```
<div class="bg-cosmic min-h-screen p-4 text-white sm:p-8">
  <div class="mx-auto max-w-4xl">
    <h1 class="mb-6 bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-3xl font-bold text-transparent">
```

Seen in `src/pages/recruitments/index.astro`, `recruitments/new.astro`, `recruitments/[id].astro`,
`candidates/index.astro`, `admin/groups/index.astro`, `dashboard.astro`, `auth/signin.astro`.
Container widths drift with no rule: `max-w-4xl` (recruitments, candidates, admin), `max-w-6xl`
(kanban), `max-w-xl` (new recruitment), `max-w-sm` (auth).

**There is no application navigation.** `src/components/Topbar.astro` — the only nav component,
with user email, Dashboard/Admin links and sign-out — is imported **exclusively** by
`src/components/Welcome.astro:2`, i.e. the marketing landing page. Every authenticated screen
(recruitments, kanban, candidates, admin) renders **without any nav chrome**; the only way
between sections is a bare `&larr; Back to recruitments` text link
(`recruitments/new.astro`, `recruitments/[id].astro`) or the two buttons on
`dashboard.astro`. `/candidates` and `/admin/groups` have no back link at all.

`src/pages/dashboard.astro` is a placeholder card ("This page is only for authenticated
users.") holding two links and a sign-out button — it is the post-login landing page and
carries no recruiter-relevant content.

`src/pages/index.astro` renders `Welcome.astro` (126 lines): starter marketing copy
("10x Astro Starter", "A production-ready starter with authentication… cosmic developer
experience"), decorative blurred orbs and an inline-styled radial-gradient star field. It is
still the public front door of the product.

**Redesign implication:** the highest-leverage structural change is an authenticated
`AppShell` layout (persistent nav + breadcrumb + page-title slot + container scale) replacing
the copy-pasted shell — this also gives the kanban its own full-width case without an ad-hoc
`max-w-6xl`.

### 4. Screen inventory (what has to be redesigned)

| Route | Shell | Island | Notes |
|---|---|---|---|
| `/` | `Welcome.astro` | — | Starter marketing page, `Topbar` only here |
| `/auth/signin`, `/auth/signup`, `/auth/confirm-email` | centered glass card | `SignInForm`, `SignUpForm` | Own `FormField`, not `Input` |
| `/dashboard` | centered glass card | — | Placeholder |
| `/recruitments` | `max-w-4xl` | `RecruitmentList` | Pill filters + link-wrapped cards |
| `/recruitments/new` | `max-w-xl` | `CreateRecruitmentForm` (222 ln) | Longest form in the app |
| `/recruitments/:id` | `max-w-6xl` | `KanbanBoard` (194 ln) | Densest screen; header packs h1 + badge + 3 status pills + 2 dialog triggers on one flex row |
| `/recruitments/:id/candidates/:crId` | `max-w-4xl` | `CandidateDetail` (225 ln) | Notes + status history |
| `/candidates` | `max-w-4xl` | `CandidateList` | Debounced search |
| `/candidates/:id` | `max-w-4xl` | `CandidateProfile` (306 ln) | Largest component; CV upload |
| `/admin/groups`, `/admin/groups/:id` | `max-w-4xl` | `SecurityGroupList`, `SecurityGroupDetail` (258 ln) | Inline unauthorized message |

Dialogs (`AddCandidateDialog`, `MoveCandidateDialog`, `StageEditor`) are the only modal
surfaces and are the one place where shadcn styling shows through mostly unmodified — so today
they read as a **different visual language** from the pages behind them (light-token dialog on
a cosmic page).

### 5. State handling — the strongest part of the current UI

`src/components/hooks/useApiResource.ts` returns a discriminated union
(`loading | success | error | not-found`), and every list/detail screen renders all four. Empty
states are explicit and written per screen, e.g. `RecruitmentList.tsx:78-81`
("No recruitments match this filter." / "No recruitments are visible to you."),
`KanbanBoard.tsx:150` ("No candidates" in a dashed-border box). Skeletons mirror the real
layout (`SkeletonColumns` draws 4 columns of 2 cards).

There is **no toast/notification system**: success is communicated only by a refetch
(`onChanged` → `resource.refetch()`), so a successful status move or stage edit gives no
confirmation. That is a redesign opportunity, not a defect to keep.

Mutations use `useMutation` and surface failure through `ServerError`, always inline, always
the same box.

### 6. Accessibility and responsiveness

- `eslint-plugin-jsx-a11y` 6.10.2 is a dependency — worth confirming it is actually enabled in
  `eslint.config.js` before relying on it.
- ARIA use is sparse: only 9 files contain any `aria-*`, most a single attribute
  (`StageEditor.tsx` has 3). Live regions for async results are absent — `ServerError` renders
  a plain `<p>` with no `role="alert"`, so failures are silent for screen readers. `Banner.astro`
  *does* set `role="alert"`/`role="status"` and is the model to follow.
- **Contrast risk is systemic**: the palette leans on `text-blue-100/40`, `/50`, `/60`, `/70`
  over `bg-white/5` on a near-black gradient. `text-blue-100/40` on `bg-white/5`
  (`KanbanBoard.tsx:150`) is almost certainly below WCAG AA. Every low-emphasis label in the
  app uses one of these — a redesign should replace them with a `--muted-foreground` token
  chosen once and measured once.
- Responsiveness is thin: `sm:p-8` on the shells and `sm:flex-row` in a couple of dialog
  footers. The kanban is `flex gap-4 overflow-x-auto` with `w-64` columns — it degrades to
  horizontal scroll on mobile rather than adapting. `RecruitmentList` cards use a
  `flex-row justify-between` with 3 metadata items and a badge on the right, with **no**
  mobile stacking — this will crush on narrow screens.
- Link semantics: `RecruitmentList.tsx:84` wraps a whole `Card` in an `<a>` — fine, but the
  card contains no other interactive element; `KanbanBoard.tsx:163-176` puts a link *and* a
  dialog trigger inside a card, correctly avoiding the nested-interactive trap.
- `formatDate` uses `toLocaleDateString("en-CA")` (i.e. forced ISO `YYYY-MM-DD`) in
  `KanbanBoard.tsx:25` and `RecruitmentList.tsx:22` — duplicated, and a deliberate-looking
  locale hack worth revisiting as part of a presentation-layer cleanup.

### 7. Constraints a redesign must respect

- **E2E coupling.** `tests/e2e/*.spec.ts` uses `getByText` ×54, `getByRole` ×44,
  `getByLabel` ×37, `getByTestId` ×16, `locator()` ×8. Role/label/text locators survive a
  restyle; the 8 raw `locator()` calls and any text-based assertion on copy you change will
  not. The 9 `data-testid` anchors in `src/` (`kanban-columns`, `status-control`,
  `add-candidate-trigger`, `add-candidate-dialog`, `move-candidate-dialog`,
  `stage-editor-trigger`, `stage-editor-dialog`, `stages-locked-message`, `candidate-list`)
  must be **carried over verbatim** into any restructured markup.
- **Unit tests assert copy.** `*.test.tsx` files sit next to their components and query by
  visible text; renaming labels means updating them in the same change.
- **English-only rule.** `context/foundation/lessons.md` — all UI strings must be English,
  regardless of conversation language. Note the current violation: `Layout.astro:22` renders
  `<strong>Uwaga:</strong>` and `Dokumentacja` in the config banner.
- **No design requirements exist yet.** `context/foundation/prd.md` contains no UI, branding,
  responsiveness or accessibility section, and `tech-stack.md` only names Tailwind 4. The
  redesign will therefore be **defining** the visual contract, not implementing a given one —
  worth an explicit decision record.
- Astro islands: all React components are `client:load`, so restyling has no hydration
  consequences, but any new nav should stay in `.astro` (as `Topbar` already is) to avoid
  shipping JS for chrome.

## Code References

- `src/styles/global.css:1-124` — token layer + the `bg-cosmic` escape hatch
- `src/layouts/Layout.astro:14` — `class="dark"` hard-coded; `:20-33` — config banner slot
- `src/components/Topbar.astro:1-60` — the only nav, used only on the landing page
- `src/components/Welcome.astro:1-40` — starter marketing hero, orbs, inline star field
- `src/components/recruitments/KanbanBoard.tsx:29-40,82-105,140-185` — skeleton, status pills, board markup
- `src/components/recruitments/RecruitmentList.tsx:52-100` — filter pills, cards, all four states
- `src/components/auth/FormField.tsx:5` — parallel input styling outside `ui/input.tsx`
- `src/components/auth/ServerError.tsx:11` — the single app-wide error surface
- `src/components/Banner.astro:14-40` — light-mode literal hexes on a dark app
- `src/lib/recruitment-status.ts:16-24` — the one good semantic→variant mapping
- `src/components/hooks/useApiResource.ts` — the four-state contract every screen renders

## Architecture Insights

- **Two design systems, one loser.** The token system is present, correct and unused; the
  cosmic theme is ad hoc, duplicated and authoritative. Any redesign that does not first
  invert this will just repaint 35 files by hand again.
- **Presentation is already separable.** Data fetching (`useApiResource`/`useMutation`),
  domain mapping (`lib/services/*`, `lib/recruitment-status.ts`) and rendering are cleanly
  split, so the redesign touches components and CSS almost exclusively.
- **The missing layer is layout, not components.** The repeated page shell and the absent
  authenticated navigation are bigger UX problems than any single component's look.
- **Repetition is the tell.** Filter pills, page shells, `formatDate`, skeleton overrides and
  the gradient headline are each duplicated 2-14 times — each is a component waiting to be
  extracted, and extraction is what makes a future theme change a one-file change.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md` — S-01…S-07 are all UI-bearing slices; several are still
  `in-progress`, so a redesign lands on moving ground. The roadmap and PRD are in Polish while
  the UI is English (a known issue recorded in `lessons.md`).
- `context/changes/recruiter-views-kanban-board/plan.md` — origin of the kanban markup and its
  `data-testid` anchors.
- `context/changes/candidate-history-search/change.md` — "cap-plus-hint" instead of pagination:
  the candidates list deliberately has **no pagination component**, it shows a refine hint. Any
  redesign must keep that affordance rather than inventing a pager.
- `context/changes/admin-manages-security-groups/` — most recent UI work; `SecurityGroupDetail`
  (258 lines) is the newest complex screen and a good sample of current conventions.

## Related Research

- `context/changes/recruiter-views-kanban-board/research.md`
- `context/changes/candidate-profile-and-cv-upload/research.md`
- `context/changes/admin-manages-security-groups/research.md`

## Open Questions

1. **Is there a brand?** No colours, type or logo exist anywhere in `context/`. Does HireTrack
   get a defined palette, or do we adopt a neutral shadcn base?
2. **Dark, light, or both?** Light tokens are already written; keeping only dark is a choice
   that should be made explicitly rather than inherited from the starter.
3. **How far does the shell go** — top nav only, or sidebar (the `--sidebar-*` tokens are
   already there)?
4. **Scope of the landing page**: replace `Welcome.astro` with a HireTrack page, or redirect
   `/` to `/recruitments` for signed-in users and drop the marketing surface entirely?
5. **Does the redesign carry a WCAG AA target?** If yes, the `text-blue-100/40..70` family and
   the missing live regions become in-scope work, not follow-ups.
6. **Does `dashboard.astro` survive?** It has no content of its own; it may be better replaced
   by a recruiter home (my recruitments / recent activity) or removed.
7. **Sequencing against in-progress slices** — restyle now and absorb conflicts, or after the
   remaining S-NN slices land?
