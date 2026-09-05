# Application Navigation and Removal of the Starter Surface — Plan Brief

> Full plan: `context/changes/app-shell-navigation/plan.md`
> Roadmap slice: `context/foundation/roadmap.md` (S-08)
> Design requirements: `context/changes/ui-redesign-foundation/design-brief.md` §B

## What & Why

Give the application a real navigation surface. A signed-in user should move
between Recruitments, Candidates and Administration through a persistent sidebar
and a topbar with their account menu — not by hunting for "← Back to …" links.
At the same time, retire the Astro starter's leftovers: the marketing landing
page and the placeholder `/dashboard`.

## Starting Point

F-02 delivered `AppShell.astro` — slots, container widths, skip-link, token layer,
theme resolution — but nothing in the product consumes it; its only caller is the
dev design-system page. Meanwhile eight `.astro` pages each carry their own
copy-pasted shell (`bg-cosmic min-h-screen` + a `max-w-*` container + a gradient
heading + a back link). `Topbar.astro` exists as dead code, `/` renders the
starter's marketing page, and `/dashboard` is a placeholder card.

## Desired End State

Every product page renders inside one `AppShell` with a consistent container
width. A persistent sidebar names the product and offers Recruitments /
Candidates / Administration (the last only for holders of `group.manage`), with
the current section highlighted. The topbar carries a collapse toggle, the theme
toggle and an avatar menu with the user's email and sign-out. Collapsing the
sidebar survives navigation; below the breakpoint it becomes a focus-trapped
drawer. `/` sends signed-in users to `/recruitments` and everyone else to
`/auth/signin`; the landing page and `/dashboard` are gone.

## Key Decisions Made

| Decision                     | Choice                                         | Why                                                                                                    | Source   |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| Nav entries and gating       | Recruitments / Candidates / Administration     | Administration gated on `group.manage`, reusing the existing middleware operations contract            | Roadmap  |
| Sidebar technology           | `.astro`, not React                            | Chrome ships no JS; only collapse, drawer and menus are islands                                        | Brief B6 |
| Islands still using literals | Readability-only token sweep in the same phase | Keeps the app usable at every commit; S-12/S-13 inherit a clean baseline instead of a double migration | Plan     |
| Collapse persistence         | Cookie, resolved server-side in middleware     | Mirrors the proven theme pattern; `localStorage` would flash the expanded sidebar on every load        | Plan     |
| Below the breakpoint         | Off-canvas drawer on radix Dialog              | Focus trap, Escape and focus restoration for free — hand-rolling them is a WCAG failure S-14 finds     | Plan     |
| Back links                   | Remove top-level, keep drill-down              | The sidebar cannot link to a _specific_ recruitment, so candidate detail keeps its parent link         | Plan     |
| User menu                    | radix DropdownMenu island                      | Already an installed dependency, and S-09 needs the same primitive for its "…" menu                    | Plan     |
| Help icon (brief B3)         | Omitted, recorded as deferred                  | No help content exists to link to; shipping a dead affordance repeats the problem B7 deletes           | Plan     |
| Global search (brief B3)     | Out of scope                                   | Parked for this milestone; search stays on `/candidates`                                               | Brief    |

## Scope

**In scope:** `Sidebar.astro`; `UserMenu`, `SidebarToggle` and `MobileNav`
islands; collapse-preference lib, endpoint, middleware field and locals type;
`AppShell` extended with a `topbar-leading` slot and collapse state; eight
product pages migrated; `Welcome.astro`, `dashboard.astro` and `Topbar.astro`
deleted; `/` redirect; `PROTECTED_ROUTES` updated; readability-only token sweep
of 12 islands plus `ui/textarea.tsx` and `ui/file-input.tsx`; E2E updates.

**Out of scope:** topbar global search; help icon; any visual redesign of screen
bodies (S-10 / S-12 / S-13); auth pages; recruitment header metadata and actions
menu (S-09); backend, data-model or API contract changes; new dependencies.

## Architecture / Approach

`Sidebar.astro` reads `Astro.locals.operations` and `Astro.url.pathname` to
render nav pills with an active state — no JS. `AppShell.astro` gains a
`topbar-leading` slot and reads a new collapse field from `Astro.locals`, which
middleware resolves from a cookie exactly as it already does for theme. Three
small islands handle what genuinely needs interactivity: the collapse toggle
(POST + reload, following `ThemeToggle`), the avatar dropdown, and the mobile
drawer, which reuses the sidebar's markup through `children` rather than
duplicating it in JSX.

Delivery is sliced **vertically by area** rather than by concern. Migrating all
pages in one phase and sweeping colours in the next would leave the app visibly
broken in between — light shell with white text, or dark shell with token text.
Doing each area's shell and colours together keeps every commit coherent.

## Phases at a Glance

| Phase                    | What it delivers                                                   | Key risk                                                                       |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 1. Chrome primitives     | Sidebar, user menu, collapse persistence, mobile drawer            | Drawer focus management is the one genuinely fiddly piece                      |
| 2. Route surface cleanup | `/` redirect; landing page, `/dashboard` and dead `Topbar` deleted | Low — verified by a grep for stale references                                  |
| 3. Recruitments area     | 4 pages on `AppShell` + sweep of 6 islands and 2 shared primitives | Largest phase; two E2E assertions are coupled to colour literals and must move |
| 4. Candidates area       | 2 pages on `AppShell` + sweep of 2 islands                         | CV upload flow spans the swept `file-input` primitive                          |
| 5. Admin area            | 2 pages on `AppShell` + sweep of 3 islands                         | Not-authorized fallbacks must stay intact and readable in both themes          |

**Prerequisites:** F-02 (`design-system-foundation`) complete — it is
(`status: impl_reviewed`). No new dependency: `radix-ui` and `lucide-react` are
already installed.
**Estimated effort:** ~3–4 sessions across 5 phases; phase 3 is roughly the size
of phases 4 and 5 combined.

## Open Risks & Assumptions

- The token sweep is scoped as readability-only. It is the phase most likely to
  drift into redesign, which would collide head-on with S-12 and S-13.
- Two E2E assertions are coupled to colour literals
  (`recruitments.spec.ts:95` on `bg-white/20`, `:106` on a back link). Both must
  be re-anchored to semantic locators, not to the replacement token classes.
- The sweep assumes existing token coverage is sufficient. If a surface needs a
  token that does not exist, it must be added to **both** the light and dark
  blocks of `global.css` — adding to one is the failure mode.
- `ui/textarea.tsx` and `ui/file-input.tsx` were missed by F-02's migration and
  are folded into phase 3. If more `ui/` primitives turn out to be unmigrated,
  phase 3 grows.
- Assumed: `standard` (`max-w-4xl`) is the right target for the two pages
  currently at `max-w-3xl`. No new container width is being added.

## Success Criteria (Summary)

- A signed-in user reaches every section of the product through the sidebar
  alone, from any page, at desktop and mobile widths.
- No screen renders unreadable text in either theme, and the starter's landing
  page and `/dashboard` placeholder no longer exist.
- The shell is defined in exactly one place: no page under `src/pages/` outside
  `auth/` declares its own `min-h-screen` wrapper or references `bg-cosmic`.
