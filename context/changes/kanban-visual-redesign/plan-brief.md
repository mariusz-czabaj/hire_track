# Kanban Visual Redesign (S-10) — Plan Brief

> Full plan: `context/changes/kanban-visual-redesign/plan.md`
> Research: `context/changes/kanban-visual-redesign/research.md`
> Design brief (section D): `context/changes/ui-redesign-foundation/design-brief.md`

## What & Why

Bring the recruitment kanban into the M-2 visual language: colored stage header pills, white cards with a stage-colored accent bar, and a deterministic stage palette. This is the **north star of milestone M-2** — the densest screen in the product and the one carrying the most design decisions. If the token system holds here, it holds everywhere.

## Starting Point

The board is a single React island whose colors are already fully token-based (the S-08 sweep did that and explicitly deferred column styling to this slice). What remains is structural: fixed 256px columns on a muted surface, plain text stage headings, bordered cards with no stage signal, and horizontal scroll at every width. Critically, **no stage-color tokens exist** — the only multi-hue set in `global.css` is the stock, never-measured `--chart-1..5`.

## Desired End State

A recruiter sees every stage side by side without scrolling, each topped by a full-width uppercase color pill with its name and count, and white cards floating on the page background with a left accent bar in the stage color. Stage colors are assigned from `sortOrder`, so custom stages are colored as coherently as seeded ones. Both themes pass WCAG 2.1 AA for every hue, and screen-reader users hear each column as a named region.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Stage palette | New `--stage-1..6` token family | A purpose-built, AA-tuned set gives S-11 and S-14 a named contract instead of borrowed chart hues. | Plan |
| Pill contrast | Paired `--stage-N-foreground` per hue, per theme | Amber and cyan cannot carry white text at AA, and darkening every hue to fit white would kill the distinguishability that justifies the palette. | Plan |
| Accent-bar a11y | Column is a labelled region; bar is `aria-hidden` | Satisfies F3 with zero per-card DOM noise, and adds column-level navigation the board lacks today. | Plan |
| Action row | Restyle in place, do not relocate | The "…" menu consolidation is brief item C4, owned by MS-03/S-09; crossing that seam risks three test anchors on the milestone's riskiest slice. | Plan |
| Card copy | Keep "Added {date}" as one text node | The two-line D4 look is achievable with layout alone, so three E2E specs stay untouched; "Applied" is also the wrong domain word here. | Plan |
| Column fit | Equal-width columns with a min-width floor | **User override of brief item D6** — horizontal scroll is removed as the primary layout so the whole board is visible at once. | User |
| Overflow | Horizontal scroll as fallback below the floor | Keeps scroll out of the common case without ever rendering an unreadably narrow column. | Plan |
| Drag-and-drop | Out of scope | Brief item D9 is roadmap slice S-11, which depends on this layout landing first. | Roadmap |

## Scope

**In scope:** stage token family (all three theme blocks + `@theme inline` + the `design-tokens.ts` mirror); `/dev/design-system` stage section; `stage-palette.ts` helper; column pills, flex-fit layout, accent-bar cards, labelled regions, empty state and skeleton; action-row restyle; unit tests for the helper and the board.

**Out of scope:** drag-and-drop (S-11); moving the action row into a header menu (S-09/C4); copy changes; API, DTO or schema change; pagination or virtualization; new shadcn primitives; `bg-cosmic`, `Textarea`, `FileInput` (S-13).

## Architecture / Approach

Tokens first, board second. Phase 1 lands the palette with **no product-facing change**, gated on an objective AA readout from tooling that already exists (`contrast.ts` → `design-tokens.ts` → `/dev/design-system`) — so a failing hue is retuned in a file nothing depends on yet. Phase 2 rebuilds the markup on the proven tokens, routing color through a `sortOrder`-indexed helper in `src/lib/` that follows the `STATUS_PRESENTATION` precedent. Phase 3 pins the new contracts under test and verifies a11y against the running board.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Stage palette tokens | Twelve tokens across three theme blocks, mirrored for contrast math, rendered on `/dev/design-system` | A hue failing AA — caught here by design, before anything depends on it; `global.css` and `design-tokens.ts` drifting apart would produce a silent false pass |
| 2. Board redesign | Pills, flex-fit columns, accent-bar cards, labelled regions, restyled empty/skeleton states | Five E2E assertions address columns as `kanban-columns > div` with `.nth()` — inserting a wrapper element breaks them |
| 3. Test alignment | Helper and board unit tests; E2E confirmed green | An E2E failure tempting an assertion edit when the correct repair is to the component |

**Prerequisites:** F-02 (token layer, themes) and S-09 (recruitment header) — both landed. No new dependencies to install.
**Estimated effort:** ~2–3 sessions across 3 phases; Phase 1 is small but gated on manual contrast review.

## Open Risks & Assumptions

- **Assumption:** brief item D5 stands — columns lose their `bg-muted` surface so cards float on the page background. The user's layout answer replaced that option, so this defaults to the accepted brief.
- Removing horizontal scroll as the primary layout departs from the reference screenshot (D6). **S-11 inherits whatever column layout this slice lands**, so a later reversal is more expensive than it looks.
- "Colors only via tokens" is a written lesson with **no lint rule or CI check** — the diff needs manual self-audit for palette literals.
- `jsx-a11y` runs at `warn`, so accessibility criteria will not fail the build and must be checked deliberately.
- S-14 (WCAG audit) can still overturn palette decisions made here; measuring contrast in this slice rather than deferring is what keeps that cost low.

## Success Criteria (Summary)

- A recruiter reads the board by stage color, with every stage visible at once on a desktop viewport.
- Every stage hue passes WCAG 2.1 AA against its pill text in both light and dark themes.
- Stage identity is never carried by color alone — the column region announces it to assistive tech.
