# Application Navigation and Removal of the Starter Surface — Implementation Plan

## Overview

Replace the page shell that is copy-pasted across eight `.astro` pages with the
`AppShell` delivered by F-02, and give the application a real navigation surface:
a persistent left sidebar (Recruitments / Candidates / Administration), a topbar
with a user menu and sign-out, a collapse toggle whose state survives navigation,
and an off-canvas drawer below the breakpoint. At the same time, delete the
starter surface — the marketing landing page, the placeholder `/dashboard`, and
the dead `Topbar.astro` — and point `/` at the right destination for signed-in
and signed-out visitors.

Because each page moves from a dark `bg-cosmic` surface onto the token-backed
`bg-background`, the React islands rendered inside it must stop expressing colour
as raw Tailwind literals in the same phase — otherwise the app ships white text
on a white surface. That colour work is deliberately **readability-only**: tokens
in, literals out, no layout or visual redesign. S-12 and S-13 still own the actual
redesign of those screens.

## Current State Analysis

- **`AppShell.astro` exists but is unused by the product.** F-02 delivered it at
  `src/components/AppShell.astro` with named slots `nav`, `topbar-actions`,
  `page-title`, `page-actions`, a default slot, a skip-to-content link, and a
  `containerWidth` prop (`narrow` = `max-w-xl`, `standard` = `max-w-4xl`,
  `wide` = `max-w-6xl`). Its only consumer today is
  `src/pages/dev/design-system.astro:39`.
- **Eight product pages duplicate the shell.** Each opens with
  `<div class="bg-cosmic min-h-screen p-4 text-white sm:p-8"><div class="mx-auto max-w-…">`,
  then a gradient `<h1>`, then in most cases a `← Back to …` link:
  `src/pages/recruitments/index.astro`, `new.astro`, `[id].astro`,
  `[id]/candidates/[candidateId].astro`, `src/pages/candidates/index.astro`,
  `[candidateId].astro`, `src/pages/admin/groups/index.astro`, `[id].astro`.
  The existing `max-w-*` values map onto the three `containerWidth` options with
  one exception: two pages use `max-w-3xl`, which has no `AppShell` equivalent.
- **`Topbar.astro` is dead code.** Nothing imports it. It nonetheless carries the
  pattern the sidebar needs: `Astro.locals.operations.includes("group.manage")`
  gating an Admin entry.
- **`src/pages/index.astro` renders `Welcome.astro`**, the Astro starter's
  marketing page (29 colour literals, no product value).
  `src/pages/dashboard.astro` is a placeholder card whose only real content is
  two links and a sign-out button.
- **`PROTECTED_ROUTES` at `src/middleware.ts:10`** is
  `["/dashboard", "/recruitments", "/candidates", "/admin"]`. `/dashboard`
  disappears with this change.
- **The theme preference pattern is proven and reusable.** `src/lib/theme.ts`
  exports a cookie name, a zod schema, and `resolveTheme`; `src/middleware.ts:45`
  resolves it into `Astro.locals.theme`; `src/pages/api/preferences/theme.ts`
  writes the cookie; `PUBLIC_API_ROUTES` exempts it from the API auth gate;
  `src/env.d.ts` declares the locals field. Sidebar collapse mirrors this shape
  exactly.
- **`radix-ui` (the unified package) is already a dependency**, alongside
  `@radix-ui/react-slot` and `lucide-react`. No new package is required for the
  dropdown menu or the drawer.
- **E2E blast radius is one assertion.** `tests/e2e/recruitments.spec.ts:106`
  asserts a `Back to recruitments` link on the not-found board. No test navigates
  through `/` or `/dashboard`.
- **Two `ui/` primitives were missed by F-02's migration.**
  `src/components/ui/textarea.tsx` and `src/components/ui/file-input.tsx` still
  carry `bg-white/10`, `text-blue-100/80`, `border-white/20`,
  `focus:ring-purple-400`, `text-red-300`. They render on AppShell pages, so they
  must be swept.

### Key Discoveries:

- `AppShell.astro` already renders `<nav aria-label="Primary">` as a sibling
  flex column, `hidden md:block md:w-64` — collapse and the mobile drawer are
  modifications to markup that already exists, not new structure.
- The topbar in `AppShell.astro` is `justify-end` with a single
  `topbar-actions` slot. A collapse button belongs on the _left_ of that bar, so
  the header needs a second slot rather than reusing the existing one.
- `src/components/ThemeToggle.tsx` is the template for a preference island:
  `fetch` the preferences endpoint, then `window.location.reload()`. The same
  full-reload approach keeps the sidebar server-rendered and flash-free.
- `src/middleware.ts:65` deliberately fails closed on operation resolution
  (empty set on error) precisely so nav entries can be rendered from
  `locals.operations` without taking the app down. The sidebar's Admin gate is
  the intended consumer of that contract.
- Two pages (`candidates/[candidateId].astro`,
  `recruitments/[id]/candidates/[candidateId].astro`) use `max-w-3xl`, between
  `narrow` and `standard`. They are detail pages; `standard` is the correct
  target, and `AppShell` needs no new width.

## Desired End State

A signed-in user lands on `/recruitments` from `/`, sees a persistent sidebar
naming the product and offering Recruitments / Candidates / Administration (the
last only when they hold `group.manage`), with the current section highlighted.
A topbar carries a collapse toggle on the left and, on the right, the theme
toggle and an avatar button opening a menu with their email address and sign-out.
Collapsing the sidebar survives navigation. Below the breakpoint the sidebar is
replaced by a hamburger that opens the same navigation as a focus-trapped
overlay. Every product page renders inside one `AppShell` with a consistent
container width and no duplicated wrapper markup. The marketing landing page and
the `/dashboard` placeholder no longer exist, and a signed-out visitor to `/`
arrives at `/auth/signin`.

Verify by signing in, navigating between all three sections via the sidebar
alone, collapsing the sidebar and reloading, switching theme, and confirming
that no screen renders unreadable text in either theme at any viewport.

## What We're NOT Doing

- **No global search field in the topbar.** Explicitly parked for this milestone
  (design brief §H; user decision 2026-09-05). `/api/candidates?q=` already
  exists, so adding it later is cheap.
- **No help icon in the topbar**, despite design brief B3. There is no help
  content anywhere in the product for it to lead to, and shipping an affordance
  that goes nowhere repeats the placeholder problem B7 deletes `dashboard.astro`
  to fix. Recorded as an open roadmap question.
- **No visual redesign of any screen body.** The colour work in phases 3–5 is a
  readability-only token swap. Card layouts, spacing rhythm, table shapes,
  empty-state copy and kanban column styling are untouched — S-10, S-12 and S-13
  own those.
- **No changes to the auth pages** (`/auth/signin`, `/auth/signup`,
  `/auth/confirm-email`). They are not AppShell pages; S-13 owns their forms.
- **No recruitment header metadata, status badge or "…" actions menu.** That is
  S-09, which builds on the `page-title` / `page-actions` slots this change
  starts using.
- **No backend or data-model change.** No migration, no API contract change
  beyond the one new preferences endpoint.
- **No new dependency.** `radix-ui` and `lucide-react` cover the dropdown, the
  drawer and the icons.

## Implementation Approach

Build the chrome first against the one page that already consumes `AppShell`
(`/dev/design-system`), so the sidebar, user menu, collapse persistence and
mobile drawer are all working and verifiable before a single product page moves.
Then clear the starter routes, which is small, self-contained, and removes the
`/dashboard` link target before anything else could depend on it.

Then migrate the product pages **vertically by area** — recruitments, candidates,
admin — each phase moving that area's pages onto `AppShell` _and_ sweeping the
colour literals out of the islands those pages render. Slicing this way keeps the
application coherent at every commit. The alternative (all pages in one phase,
all colours in the next) leaves an intermediate state where the app is visibly
broken in one direction or the other.

## Critical Implementation Details

**State sequencing — collapse persistence must be server-resolved.** The obvious
implementation (island reads `localStorage` on mount, toggles a class) produces a
visible flash of the expanded sidebar on every navigation, because this is a
full-SSR app where every click is a document load. Follow the theme pattern
instead: the island POSTs the new value and reloads; middleware resolves the
cookie into `Astro.locals` before render, so `AppShell` emits the collapsed
markup directly. Register the new endpoint in `PUBLIC_API_ROUTES` — the comment
at `src/middleware.ts:13` explains why that list is deliberately separate from
the `isAuthRoute` check, and that reasoning applies here unchanged.

**User experience spec — the mobile drawer needs real focus management.** It must
trap focus while open, close on Escape and on outside click, and return focus to
the hamburger that opened it. Using the radix Dialog primitive supplies all of
this; hand-rolling it does not, and a keyboard user who opens the drawer and
cannot escape it is a WCAG failure that S-14 will find.

**Timing & lifecycle — the sweep must not outrun the shell.** Within phases 3–5,
move the pages onto `AppShell` and swap that area's island colours in the same
commit. Swapping colours while a page still renders on `bg-cosmic` produces dark
background with dark token text, which is just as broken as the reverse.

---

## Phase 1: Chrome Primitives

### Overview

Build the sidebar, user menu, collapse persistence and mobile drawer, and extend
`AppShell` to host them. Nothing outside `/dev/design-system` renders them yet,
so this phase is additive and cannot regress a product screen.

### Changes Required:

#### 1. Sidebar collapse preference

**File**: `src/lib/sidebar.ts`

**Intent**: Give the collapse preference the same cookie-backed, server-resolved
shape the theme preference already has, so `AppShell` can render the collapsed
state without a flash.

**Contract**: Mirror `src/lib/theme.ts` — export a cookie name constant, a zod
schema for the two states, and a resolver that maps an unrecognised or absent
cookie value to the default (expanded). Unlike theme, there is no "follow the
system" third state, so the resolver returns a concrete value rather than `null`.

**File**: `src/pages/api/preferences/sidebar.ts`

**Intent**: Persist the collapse choice.

**Contract**: A `POST` route mirroring `src/pages/api/preferences/theme.ts`
exactly — `prerender = false`, zod-validated JSON body, `422` on malformed input
via `jsonError`, and the same cookie options (`path: "/"`, `sameSite: "lax"`,
`httpOnly: true`, one-year `maxAge`).

**File**: `src/middleware.ts`

**Intent**: Resolve the cookie into locals on every request and keep the new
endpoint reachable.

**Contract**: Resolve alongside the existing `context.locals.theme` assignment,
and add the new route to `PUBLIC_API_ROUTES` — not to the `isAuthRoute` check,
per the comment already in that file.

**File**: `src/env.d.ts`

**Intent**: Type the new locals field.

**Contract**: Add the collapse field to `App.Locals` beside `theme`.

#### 2. Navigation surface

**File**: `src/components/Sidebar.astro`

**Intent**: Render the primary navigation as nav pills with an active state, plus
the product name at the top. Astro, not React — this is chrome and must ship no
JS (design brief B6).

**Contract**: Reads `Astro.locals.operations` and `Astro.url.pathname`. Entries:
Recruitments → `/recruitments`, Candidates → `/candidates`, Administration →
`/admin/groups`, the last rendered only when `operations.includes("group.manage")`
— the same gate `src/components/Topbar.astro:3` uses today. The active entry is
determined by pathname prefix, so `/recruitments/123` highlights Recruitments,
and carries `aria-current="page"`. Colours come from the token layer only
(active = accent surface + primary text, inactive = muted foreground); no raw
Tailwind palette literal, per the lessons register.

**File**: `src/components/UserMenu.tsx`

**Intent**: Put the signed-in user's email and sign-out behind an avatar button,
per design brief B4.

**Contract**: A React island taking the user's email as a prop. Built on the
radix dropdown-menu primitive from the installed `radix-ui` package, following
the `src/components/ui/` conventions (cva variants where the existing primitives
use them, `cn()` for class merging). Sign-out must remain a `POST` form to
`/api/auth/signout` — it is a state-changing action and must not become a `GET`
link. The trigger needs an accessible name even though it renders only an avatar.

**File**: `src/components/SidebarToggle.tsx`

**Intent**: Toggle the collapse preference from the topbar.

**Contract**: Follows `src/components/ThemeToggle.tsx` line for line — takes the
current state as a prop, POSTs the next state to the preferences endpoint,
re-enables itself on failure rather than reloading, and calls
`window.location.reload()` on success. Needs an `aria-label` naming the action
and `aria-expanded` reflecting sidebar state.

**File**: `src/components/MobileNav.tsx`

**Intent**: Below the breakpoint, open the same navigation as an overlay.

**Contract**: A React island wrapping the radix Dialog primitive, which supplies
the focus trap, Escape handling, outside-click dismissal and focus restoration
this needs. It receives the rendered navigation through `children` so the markup
is authored once in `Sidebar.astro` and reused, rather than duplicated in JSX
where the two copies could drift.

#### 3. AppShell integration

**File**: `src/components/AppShell.astro`

**Intent**: Host the collapse state, give the topbar a left-hand region, and wire
the mobile drawer.

**Contract**: Read the collapse state from `Astro.locals` and apply it to the
existing `<nav aria-label="Primary">` width. Add a `topbar-leading` slot for the
collapse toggle and hamburger — the current header is `justify-end` with a single
`topbar-actions` slot, which cannot position an element on the left. Preserve the
existing `containerWidth` prop, the skip-to-content link, and the
`page-title` / `page-actions` slot contract unchanged; S-09 depends on them.

**File**: `src/pages/dev/design-system.astro`

**Intent**: Render the real chrome so it can be reviewed and contrast-checked in
both themes.

**Contract**: Replace the placeholder `nav` slot content at line 40 with
`Sidebar.astro`, and add `SidebarToggle` / `MobileNav` to the new
`topbar-leading` slot and `UserMenu` beside the existing `ThemeToggle`. The page
stays dev-only behind its existing `import.meta.env.DEV` guard.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes, including `jsx-a11y` rules on the new islands: `npm run lint`
- Unit tests pass: `npx vitest run`
- Existing E2E suite still passes: `npx playwright test`

#### Manual Verification:

- On `/dev/design-system`, the sidebar shows Recruitments and Candidates;
  Administration appears only for a user holding `group.manage`
- Collapsing the sidebar and reloading keeps it collapsed, with no flash of the
  expanded state on load
- The avatar menu opens with keyboard alone, shows the signed-in email, and
  signs the user out
- Below the breakpoint the sidebar is replaced by a hamburger; the drawer traps
  focus, closes on Escape, and returns focus to the hamburger
- The `/dev/design-system` contrast table still reports AA passes in both themes,
  and the new nav pill colours are readable in both

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding to the next phase.

---

## Phase 2: Route Surface Cleanup

### Overview

Delete the starter surface and send `/` somewhere useful. Self-contained, and it
removes `/dashboard` as a link target before any page could start pointing at it.

### Changes Required:

#### 1. Root redirect

**File**: `src/pages/index.astro`

**Intent**: Send signed-in users to the application and signed-out users to sign-in,
replacing the starter's marketing page (design brief B7).

**Contract**: The page renders nothing; it returns a redirect from the frontmatter
based on `Astro.locals.user` — `/recruitments` when present, `/auth/signin`
otherwise. Use `Astro.redirect`, keeping the decision in the page rather than
widening `PROTECTED_ROUTES`, which only knows how to redirect _away_ from a route.

#### 2. Deletions

**File**: `src/components/Welcome.astro` — delete. Astro starter marketing page,
after this phase referenced by nothing.

**File**: `src/pages/dashboard.astro` — delete. Placeholder whose only content is
links now served by the sidebar and a sign-out now served by the user menu.

**File**: `src/components/Topbar.astro` — delete. Already dead code; its
`group.manage` gate now lives in `Sidebar.astro`.

#### 3. Middleware

**File**: `src/middleware.ts`

**Intent**: Stop protecting a route that no longer exists.

**Contract**: Remove `/dashboard` from `PROTECTED_ROUTES` at line 10. The other
three entries are unchanged.

### Success Criteria:

#### Automated Verification:

- Build succeeds with no unresolved imports after the deletions: `npm run build`
- Linting passes: `npm run lint`
- No source reference to the deleted modules or route remains:
  `grep -rn "Welcome\|Topbar\|/dashboard" src/ tests/` returns nothing
- E2E suite still passes: `npx playwright test`

#### Manual Verification:

- Visiting `/` while signed out lands on `/auth/signin`
- Visiting `/` while signed in lands on `/recruitments`
- Visiting `/dashboard` returns a 404 rather than redirecting or erroring

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Recruitments Area

### Overview

Move the four recruitment pages onto `AppShell` and, in the same commit, sweep
colour literals out of the islands they render plus the two shared `ui/`
primitives that F-02 missed. This is the largest phase and the one that proves
the pattern the next two follow.

### Changes Required:

#### 1. Pages onto AppShell

**File**: `src/pages/recruitments/index.astro`

**Intent**: Adopt the shell, moving the page heading and the "New recruitment"
action into the slots F-02 provided.

**Contract**: Wrap in `AppShell` with `containerWidth="standard"` (matching
today's `max-w-4xl`), pass `Sidebar.astro` to `nav`, the chrome islands to
`topbar-leading` / `topbar-actions`, the heading to `page-title`, and the "New
recruitment" link to `page-actions`. Delete the `bg-cosmic min-h-screen …`
wrapper and the inner `mx-auto max-w-4xl` — `AppShell` owns both. `initialStatus`
parsing from the query string is unchanged.

**File**: `src/pages/recruitments/new.astro`

**Intent**: Same adoption; drop the now-redundant back link.

**Contract**: `containerWidth="narrow"` (today's `max-w-xl`). Remove the
`← Back to recruitments` link — the sidebar covers it.

**File**: `src/pages/recruitments/[id].astro`

**Intent**: Same adoption for the board.

**Contract**: `containerWidth="wide"` (today's `max-w-6xl`). Remove the
`← Back to recruitments` link. Leave `page-title` empty — S-09 fills it with the
recruitment header, and inventing a placeholder title here would only be deleted
next slice.

**File**: `src/pages/recruitments/[id]/candidates/[candidateId].astro`

**Intent**: Same adoption; this is a drill-down page, so it keeps its parent link.

**Contract**: `containerWidth="standard"` (today's `max-w-3xl`, which has no
`AppShell` equivalent; `standard` is the correct target and no new width is
added). **Keep** the `← Back to board` link pointing at `/recruitments/${id}` —
the sidebar cannot link to a specific recruitment, so this is the page's only
route back to its parent.

#### 2. Readability token sweep

**Files**: `src/components/recruitments/RecruitmentList.tsx`,
`CreateRecruitmentForm.tsx`, `KanbanBoard.tsx`, `CandidateDetail.tsx`,
`MoveCandidateDialog.tsx`, `StageEditor.tsx`, and the shared primitives
`src/components/ui/textarea.tsx`, `src/components/ui/file-input.tsx`

**Intent**: Make these readable on the token-backed light surface by expressing
colour through the token layer, per the lessons register. Readability only — no
layout, spacing, copy or component-structure change.

**Contract**: Every raw Tailwind palette literal maps to a token-backed
equivalent: surfaces (`bg-white/5`, `bg-white/10`) → `bg-card` / `bg-muted`,
body and heading text (`text-white`, `text-blue-100/*`) → `text-foreground` /
`text-muted-foreground`, borders (`border-white/10`, `border-white/20`) →
`border-border`, error text and rings (`text-red-300`, `border-red-400/60`,
`focus:ring-red-400`) → `text-destructive` and the destructive ring tokens,
accents (`bg-purple-600`, `focus:ring-purple-400`) → `bg-primary` /
`focus-visible:ring-ring`. Two constraints hold throughout: no raw literal
survives, and if a surface needs a token that does not exist, add it to **both**
the light and dark blocks of `src/styles/global.css` rather than reaching for a
literal.

One assertion couples a test to a literal: `tests/e2e/recruitments.spec.ts:95`
asserts `toHaveClass(/bg-white\/20/)` on the active status pill. It must be
re-anchored to whatever token class replaces it, or to a semantic attribute
— the latter is preferable, since S-09 moves this control into a menu and will
otherwise break it again.

#### 3. E2E updates

**File**: `tests/e2e/recruitments.spec.ts`

**Intent**: Track the removed back link and the re-tokenised status pill.

**Contract**: The `Back to recruitments` assertion at line 106 no longer has a
target — the not-found board keeps its "This recruitment could not be found."
message, so assert navigability via the sidebar's Recruitments entry instead.
Update the line 95 class assertion per the note above. Locators stay
role/label-based, per the repository's E2E rules.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Linting passes: `npm run lint`
- Unit tests pass, including the component tests for the swept islands:
  `npx vitest run`
- E2E suite passes: `npx playwright test`
- No colour literal remains in the swept files:
  `grep -nE "bg-cosmic|(bg|text|border|from|to|via)-(white|blue|purple|red)(-[0-9]{2,3})?(/[0-9]{1,3})?" src/components/recruitments/ src/components/ui/textarea.tsx src/components/ui/file-input.tsx`
  returns nothing

#### Manual Verification:

- All four recruitment pages render inside the shell with consistent width and no
  duplicated wrapper
- Every screen is readable in **both** light and dark themes — no white-on-white
  or dark-on-dark text anywhere, including dialogs and error states
- The candidate detail page still offers its route back to the board
- Creating a recruitment, moving a candidate, and editing stages all still work
- No visual regression beyond colour: card layout, spacing and copy are unchanged

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Candidates Area

### Overview

Same treatment for the two candidate pages, following the pattern proven in
phase 3.

### Changes Required:

#### 1. Pages onto AppShell

**File**: `src/pages/candidates/index.astro`

**Contract**: `containerWidth="standard"` (today's `max-w-4xl`), heading into
`page-title`, wrapper markup deleted. `initialQuery` parsing unchanged — the
candidate search stays on this page and does not move to the topbar.

**File**: `src/pages/candidates/[candidateId].astro`

**Contract**: `containerWidth="standard"` (today's `max-w-3xl`). **Remove** the
`← Back to recruitments` link: this page is reached from the candidates list, so
the link points at the wrong parent and the sidebar covers the right one.

#### 2. Readability token sweep

**Files**: `src/components/candidates/CandidateList.tsx`,
`src/components/candidates/CandidateProfile.tsx`

**Intent**: Same readability-only token swap as phase 3, same mapping rules.

**Contract**: As phase 3. `CandidateProfile` renders the CV upload flow through
`ui/file-input.tsx`, already swept in phase 3 — verify the composed result rather
than re-editing the primitive.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Linting passes: `npm run lint`
- Unit tests pass: `npx vitest run`
- E2E suite passes, including `candidates.spec.ts`, `candidate-profile.spec.ts`
  and `candidate-history.spec.ts`: `npx playwright test`
- No colour literal remains: `grep -nE "bg-cosmic|(bg|text|border)-(white|blue|purple|red)(-[0-9]{2,3})?(/[0-9]{1,3})?" src/components/candidates/ src/pages/candidates/`
  returns nothing

#### Manual Verification:

- Both candidate pages render inside the shell and are readable in both themes
- The candidate search field still filters, and the CV upload and download flow
  still works with a readable file input in both themes

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Admin Area

### Overview

The last two pages. Completes the removal of the duplicated shell and closes the
colour sweep for every screen inside `AppShell`.

### Changes Required:

#### 1. Pages onto AppShell

**File**: `src/pages/admin/groups/index.astro`

**Contract**: `containerWidth="standard"` (today's `max-w-4xl`), heading into
`page-title`. The existing `isAdmin` guard and its "You are not authorized to
view this page." fallback are preserved verbatim — this is an authorization
surface, and the sidebar's Admin gate is a rendering convenience, not a
substitute for it.

**File**: `src/pages/admin/groups/[id].astro`

**Contract**: `containerWidth="standard"`. Same guard preserved. This page has no
heading today; give it `page-title` content naming the group section so the shell
does not render an empty title row.

#### 2. Readability token sweep

**Files**: `src/components/admin/SecurityGroupList.tsx`,
`SecurityGroupDetail.tsx`, `UserSearchPicker.tsx`

**Intent**: Same readability-only token swap, same mapping rules.

**Contract**: As phase 3, including the not-authorized fallback panels in both
`.astro` pages.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`
- Linting passes: `npm run lint`
- Unit tests pass, including `SecurityGroupDetail.test.tsx` and
  `UserSearchPicker.test.tsx`: `npx vitest run`
- Full E2E suite passes: `npx playwright test`
- Integration tests pass: `npx vitest run src/pages/api`
- No colour literal or `bg-cosmic` reference remains anywhere outside the auth
  pages: `grep -rn "bg-cosmic" src/` returns only `src/pages/auth/` matches
- No page still declares its own shell:
  `grep -rn "min-h-screen" src/pages/` returns only `src/pages/auth/` matches

#### Manual Verification:

- Both admin pages render inside the shell and are readable in both themes
- A non-admin user still sees the not-authorized message, readable in both
  themes, and does **not** see the Administration entry in the sidebar
- An admin can still create a group, add and remove members, and grant operations
- Walking all eight product pages at desktop and mobile widths shows one
  consistent shell, correct active nav state on each, and no unreadable text in
  either theme

---

## Testing Strategy

### Unit Tests:

- The existing component tests for the swept islands
  (`RecruitmentList`, `CandidateList`, `CandidateProfile`, `CandidateDetail`,
  `SecurityGroupDetail`, `UserSearchPicker`, `StageEditor`,
  `CreateRecruitmentForm`, `MoveCandidateDialog`, `AddCandidateDialog`) must keep
  passing untouched. If a test breaks, it was asserting on a colour literal — the
  fix is to re-anchor it to a role, label or semantic attribute, never to assert
  the new token class.
- `resolveSidebarCollapsed` deserves a small test alongside the theme resolver's:
  absent cookie, malformed cookie, and both valid values.

### Integration Tests:

- `src/pages/api/authorization.integration.test.ts` covers the operation gates
  the sidebar reads. It must keep passing — the sidebar changes rendering, not
  authorization.
- The new preferences endpoint needs the same shape of coverage the theme
  endpoint has: valid body sets the cookie, malformed body returns `422`, and the
  route is reachable without authentication.

### Manual Testing Steps:

1. Sign out and visit `/` — expect `/auth/signin`.
2. Sign in as HR and visit `/` — expect `/recruitments`, sidebar visible,
   Recruitments highlighted, Administration absent.
3. Navigate to Candidates via the sidebar — expect the active pill to move.
4. Sign in as an admin — expect Administration present and functional.
5. Collapse the sidebar, navigate to another section, reload — expect it to stay
   collapsed with no flash of the expanded state.
6. Toggle to dark theme and repeat steps 2–4, checking every screen for
   unreadable text.
7. Narrow the viewport below the breakpoint — expect the hamburger; open the
   drawer, Tab through it (focus must not escape), press Escape (must close and
   restore focus to the hamburger).
8. On the candidate detail page under a recruitment, confirm the back link
   returns to the correct board.
9. Visit `/dashboard` — expect a 404.
10. Open the avatar menu with the keyboard alone and sign out.

## Performance Considerations

The chrome adds three React islands (`UserMenu`, `SidebarToggle`, `MobileNav`) to
every product page. `Sidebar.astro` stays Astro so the navigation markup itself
ships no JS, per design brief B6. Both preference toggles use a full reload
rather than client-side state — correct for an SSR app, and it keeps the server
the single source of truth for the rendered state, avoiding the flash that
`localStorage` would introduce.

Deleting `Welcome.astro` removes the largest single template in the repository
from the build.

## Migration Notes

No data migration. Two user-visible route changes: `/` stops rendering a landing
page and becomes a redirect, and `/dashboard` stops existing. Neither is
bookmarked by any test, and `/dashboard` was a placeholder with no unique content
— its two links and its sign-out button are all served by the new chrome.

The sidebar collapse cookie is new; an absent cookie resolves to expanded, so
existing sessions get the default with no special handling.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-08)
- Design requirements: `context/changes/ui-redesign-foundation/design-brief.md` §B
- Prior UI analysis: `context/changes/ui-redesign-foundation/research.md`
- Prerequisite: `context/changes/design-system-foundation/plan.md` (F-02)
- Token rule: `context/foundation/lessons.md` — "Colors only through design tokens"
- Shell to extend: `src/components/AppShell.astro`
- Preference pattern to mirror: `src/lib/theme.ts`,
  `src/pages/api/preferences/theme.ts`, `src/components/ThemeToggle.tsx`
- Authorization gate pattern: `src/components/Topbar.astro:3`, `src/middleware.ts:65`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Chrome Primitives

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — fd4d6ff
- [x] 1.2 Linting passes, including `jsx-a11y` rules on the new islands: `npm run lint` — fd4d6ff
- [x] 1.3 Unit tests pass: `npx vitest run` — fd4d6ff
- [x] 1.4 Existing E2E suite still passes: `npx playwright test` — fd4d6ff

#### Manual

- [x] 1.5 Sidebar shows Recruitments and Candidates; Administration only with `group.manage` — fd4d6ff
- [x] 1.6 Collapse survives reload with no flash of the expanded state — fd4d6ff
- [x] 1.7 Avatar menu opens with keyboard alone, shows email, signs out — fd4d6ff
- [x] 1.8 Mobile drawer traps focus, closes on Escape, restores focus to the hamburger — fd4d6ff
- [x] 1.9 Contrast table still reports AA passes in both themes, including nav pills — fd4d6ff

### Phase 2: Route Surface Cleanup

#### Automated

- [x] 2.1 Build succeeds with no unresolved imports after the deletions: `npm run build` — 601f155
- [x] 2.2 Linting passes: `npm run lint` — 601f155
- [x] 2.3 No source reference to the deleted modules or route remains — 601f155
- [x] 2.4 E2E suite still passes: `npx playwright test` — 601f155

#### Manual

- [x] 2.5 `/` while signed out lands on `/auth/signin` — 601f155
- [x] 2.6 `/` while signed in lands on `/recruitments` — 601f155
- [x] 2.7 `/dashboard` returns a 404 — 601f155

### Phase 3: Recruitments Area

#### Automated

- [x] 3.1 Build succeeds: `npm run build` — ddc6f08
- [x] 3.2 Linting passes: `npm run lint` — ddc6f08
- [x] 3.3 Unit tests pass, including the swept islands' component tests: `npx vitest run` — ddc6f08
- [x] 3.4 E2E suite passes: `npx playwright test` — ddc6f08
- [x] 3.5 No colour literal remains in the swept recruitment files and shared primitives — ddc6f08

#### Manual

- [x] 3.6 All four recruitment pages render inside the shell with consistent width — ddc6f08
- [x] 3.7 Every recruitment screen is readable in both themes, including dialogs and error states — ddc6f08
- [x] 3.8 Candidate detail page still offers its route back to the board — ddc6f08
- [x] 3.9 Creating a recruitment, moving a candidate, and editing stages still work — ddc6f08
- [x] 3.10 No visual regression beyond colour — ddc6f08

### Phase 4: Candidates Area

#### Automated

- [x] 4.1 Build succeeds: `npm run build` — 48ae145
- [x] 4.2 Linting passes: `npm run lint` — 48ae145
- [x] 4.3 Unit tests pass: `npx vitest run` — 48ae145
- [x] 4.4 E2E suite passes, including the three candidate specs: `npx playwright test` — 48ae145
- [x] 4.5 No colour literal remains in the candidate components and pages — 48ae145

#### Manual

- [x] 4.6 Both candidate pages render inside the shell and are readable in both themes — 48ae145
- [x] 4.7 Candidate search still filters; CV upload and download still work with a readable file input — 48ae145

### Phase 5: Admin Area

#### Automated

- [ ] 5.1 Build succeeds: `npm run build`
- [ ] 5.2 Linting passes: `npm run lint`
- [ ] 5.3 Unit tests pass, including the admin component tests: `npx vitest run`
- [ ] 5.4 Full E2E suite passes: `npx playwright test`
- [ ] 5.5 Integration tests pass: `npx vitest run src/pages/api`
- [ ] 5.6 No `bg-cosmic` reference remains outside the auth pages
- [ ] 5.7 No page still declares its own shell (`min-h-screen` only under `src/pages/auth/`)

#### Manual

- [ ] 5.8 Both admin pages render inside the shell and are readable in both themes
- [ ] 5.9 Non-admin sees a readable not-authorized message and no Administration entry
- [ ] 5.10 Admin can still create a group, manage members, and grant operations
- [ ] 5.11 All eight product pages show one consistent shell at desktop and mobile widths
