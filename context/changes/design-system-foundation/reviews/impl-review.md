<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Fundament systemu projektowego — tokeny, motywy, AppShell

- **Plan**: context/changes/design-system-foundation/plan.md
- **Scope**: Phase 5 of 5 (full plan)
- **Date**: 2026-09-05
- **Verdict**: APPROVED
- **Findings**: [0 critical] [2 warnings] [1 observation]

## Verdicts

| Dimension           | Verdict           |
| ------------------- | ----------------- |
| Plan Adherence      | PASS               |
| Scope Discipline    | PASS               |
| Safety & Quality    | WARNING            |
| Architecture        | PASS               |
| Pattern Consistency | PASS               |
| Success Criteria    | PASS               |

## Findings

### F1 — ThemeToggle reloads the page even on a failed save

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ThemeToggle.tsx:14-26
- **Detail**: `handleToggle` POSTs to `/api/preferences/theme` and calls `window.location.reload()` unconditionally after the fetch resolves. `fetch` only rejects on network-level failure, not on a 4xx/5xx response, so a server error (e.g. malformed cookie write, transient 500) is silently treated as success — the page reloads, the cookie was never set, and the user sees no error and no explanation for the unchanged theme.
- **Fix**: Check `response.ok` before reloading; on failure, skip the reload and surface a lightweight error state (or just leave `isSaving` false without reloading) so the user isn't left confused by a silent no-op.
- **Decision**: FIXED

### F2 — design-system.astro computes contrast measurements unconditionally, outside the dev guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dev/design-system.astro:16-34
- **Detail**: The `isDev` check gates only the rendered markup and the 404 status; `measure(lightPalette)` / `measure(darkPalette)` and the variant array literals run unconditionally in frontmatter on every request, including in production, before the 404 is returned. Today's cost is negligible (~11 token pairs, O(1) per pair), so this isn't an active problem, but it's fragile: any future heavier addition to this file's frontmatter would silently run on every production request despite the page correctly 404'ing.
- **Fix**: Move the `measure()` calls and other dev-only computation inside the `isDev` branch (or return/rewrite to 404 before doing any of that work) so nothing beyond the guard check executes when `import.meta.env.DEV` is false.
- **Decision**: FIXED

### F3 — src/lib/design-tokens.ts duplicates global.css token values with no automated sync check

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/design-tokens.ts
- **Detail**: Not named in the plan, but for a real reason: Astro SSR can't read computed CSS custom properties, so the contrast meter and preview page need the palette values as plain JS data. The file documents itself as "duplicated from src/styles/global.css, keep in sync manually." There's no automated check enforcing that — a future palette edit in `global.css` without a matching edit here would make the contrast measurements silently stale (still numerically valid, just no longer describing the real palette).
- **Fix**: Optional — no action required now; worth a follow-up test that asserts the two sources match (e.g. parse global.css or fail loudly) if this file survives past the current milestone.
- **Decision**: PENDING

## Notes

- Both parallel sub-agent reviews (plan drift; safety/quality/pattern) independently confirmed: all planned file changes match their stated contracts, `isAuthRoute` was correctly left untouched with a separate `PUBLIC_API_ROUTES` predicate added instead, the multi-rule `@custom-variant dark` CSS matches the plan's exact (non-simplified) structure, and the theme cookie value is always zod-validated before reaching the `<html>` class — no raw cookie reflection.
- `DesignSystemDialogDemo.tsx` is unplanned by name but is exactly the Dialog-variant demo the plan's own Phase 4 contract calls for ("every token-driven primitive ... dialog") — benign, in-scope.
- All automated verification re-run and confirmed passing at full-plan scope: `npm run lint` (0 errors, 18 pre-existing warnings unrelated to this change), `npm run typecheck` (0 errors), `npm test` (137/137 passed, including `contrast.test.ts` and `theme.test.ts`), `npm run build` (succeeds), `npx eslint --print-config` on `KanbanBoard.tsx` reports 34 active `jsx-a11y/*` rules (was 0 before this change), and `npm run preview` confirms `/dev/design-system` returns 404.
- Manual verification checkboxes in the plan's Progress section are all marked complete for all 5 phases; no rubber-stamping signal found — the claims (no flash, keyboard operability, contrast pass/fail per pair, screen-collapse behavior) are all backed by code that implements them (skip-link, `aria-live`-free but textual pass/fail labels, `class:list` server-rendered before response, etc.).
