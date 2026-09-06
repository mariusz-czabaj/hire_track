# List Views Redesign — Plan Brief

> Full plan: `context/changes/list-views-redesign/plan.md`
> Research: `context/changes/list-views-redesign/research.md`

## What & Why

Restyle the recruitment list, candidate list, and admin (security groups) list onto the shadow-card / serif-title visual language S-10 already established for the kanban board, consolidate the duplicated status-pill button styling, and close a test-coverage gap that would otherwise leave the redesign unprotected — especially on the admin screen, which has zero tests today.

## Starting Point

All three screens already use design tokens exclusively (no raw-color migration needed). What's inconsistent is structural: bordered pre-S-10 cards instead of shadow-based ones, sans-serif titles instead of the design brief's serif spec, no mobile stacking on the recruitment list, a hand-rolled `<input>` in the admin form, and the status-pill styling duplicated between the recruitment filter and the kanban `StatusControl`. Only 2 empty-state strings + 1 non-content-asserted `data-testid` are currently E2E-guarded across all three screens.

## Desired End State

All three list screens visually match the kanban board (shadow cards, accent bar, serif titles); the recruitment list stacks on mobile; the admin form uses the shared `Input`; status-pill styling is defined once; and new E2E tests guard the candidate list's empty-state/truncation strings plus a full admin-screen spec — all while every pre-existing E2E assertion keeps passing unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Card visual language | Adopt shadow-based cards (border-0, shadow-md, accent bar) | Matches S-10's already-established, more recent pattern for full app consistency | Plan |
| Filter/mutate consolidation | Shared visual-styling helper only, not one behavioral component | Filter (URL-sync) and mutate (PATCH) are genuinely different behaviors — over-merging adds risk for no benefit | Plan |
| Recruitment mobile stacking | Add `flex-col sm:flex-row` | Closes a named, explicit design-brief gap (item E1) | Plan |
| Recruitment cap+hint | Stay unbounded | Not requested by the roadmap; avoids scope creep for a low-volume list | Plan |
| Test coverage gap | Add coverage alongside the redesign | Admin screen currently has zero tests — redesigning it blind is a real regression risk | Plan |
| `bg-cosmic` migration | Note as stale, no action | Zero usage found on these 3 screens; not this slice's concern | Plan / Research |
| Page titles | Migrate to serif ~40px | Directly matches an already-decided design-brief item (A6), low risk | Plan |

## Scope

**In scope:**
- Shadow-card + accent-bar styling on all 3 screens
- Serif page titles on all 3 screens
- Mobile stacking on the recruitment list row
- Shared status-pill styling helper (visual only)
- Admin form's shared `Input` component
- New E2E coverage: candidate-list empty-state + truncation-hint strings, full admin/security-groups spec

**Out of scope:**
- Cap+hint pagination pattern for the recruitment list
- Merging filter and mutate status controls into one behavioral component
- `bg-cosmic` cleanup elsewhere in the codebase
- Auth screens, `FormField`, `Banner.astro` (design-brief items E4/E6/E7)
- Any API/service-layer or data-model changes

## Architecture / Approach

Bottom-up: extract the shared status-pill styling helper first (both later phases consume it), then redesign each screen independently, each preserving its own byte-for-byte test contracts (empty-state strings, `data-testid`, URL-sync behavior). New test coverage is added last, against the final redesigned markup.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Shared Status-Pill Styling Helper | One `statusPillClasses()` helper consumed by both filter and mutate sites | Low — pure extraction, visual no-op |
| 2. Recruitment List Redesign | Shadow card, serif title, mobile stacking | Must not break `?status=` URL-sync or the 2 guarded empty-state strings |
| 3. Candidate List Redesign | Shadow card, serif title | Must not move `data-testid="candidate-list"` or disturb cap+hint/search debounce |
| 4. Admin List Redesign | Shadow card, serif title, shared `Input` | No existing E2E to break, but must not regress the authorization-gate message |
| 5. Test Coverage Backfill | New E2E coverage for previously-unguarded strings + full admin spec | Must genuinely catch regressions, not just pass trivially |

**Prerequisites:** F-02 (`design-system-foundation`) and S-08 (`ui-redesign-foundation`) already complete; S-10's shadow-card pattern already in the codebase as a reference.
**Estimated effort:** ~5 sessions across 5 phases.

## Open Risks & Assumptions

- Admin screen's empty-state test (Phase 5) depends on whether seed data always includes at least one security group — needs confirming against seed setup during implementation; may need to skip or adjust that specific assertion.
- No visual regression tooling (Argos/Lost Pixel) is set up — shadow-card/accent-bar correctness relies on manual verification each phase.

## Success Criteria (Summary)

- All three list screens visually match the kanban board's shadow-card/serif-title language, including correct mobile stacking on the recruitment list.
- Every pre-existing E2E assertion (`recruitments.spec.ts`, `candidate-history.spec.ts`) still passes unchanged.
- New E2E coverage exists for the candidate list's empty-state/truncation strings and the admin/security-groups screen.
