<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Application Navigation and Removal of the Starter Surface

- **Plan**: context/changes/app-shell-navigation/plan.md
- **Scope**: Phase 1 of 5 (full plan — all 5 phases complete)
- **Date**: 2026-09-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — AppShell hides the sidebar on collapse rather than narrowing its width

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/AppShell.astro
- **Detail**: The plan's phase 1 contract says "apply it to the existing `<nav>` width," implying the collapsed sidebar should narrow (e.g. to an icon rail). The implementation instead toggles `hidden` on the whole nav, fully removing it from layout when collapsed. This is a reasonable, working interpretation (matches the panel-open/close icon language in `SidebarToggle.tsx` and passed manual verification in phase 1), just a literal wording mismatch versus the plan text — not a functional defect.
- **Fix**: No action needed; optionally amend the plan's phase 1 wording to describe the "hide" behavior for future readers.
- **Decision**: ACCEPTED (no functional issue; documentation-only mismatch)

### F2 — Sign-in E2E flow is intermittently flaky (pre-existing, out of this plan's scope)

- **Severity**: OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: tests/e2e/support/auth.ts:18-36, src/pages/auth/signin.astro
- **Detail**: Running `npx playwright test` shows an intermittent failure (roughly 1 in 6-12 runs, not reproducible on every pass) where `signInAs` times out waiting for `/recruitments` after clicking "Sign in" — the page snapshot shows "Email is required" / "Password is required," meaning the form submitted with empty fields despite the pre-click `toPass` value check succeeding. The helper's own comment already documents this exact hydration race ("if it fills in before hydration attaches React's onChange... Retry the fill until the value actually sticks") — the retry covers the fill-then-check window but not a race between the check passing and the click registering. `src/pages/auth/signin.astro` and `SignInForm` are unmodified by this plan (explicitly out of scope: "No changes to the auth pages"), so this is pre-existing test fragility, not a regression introduced here. A clean `supabase db reset` plus repeated full-suite runs confirms the app itself functions correctly; only the timing-sensitive fill-then-submit sequence in the test occasionally loses the race.
- **Fix**: Harden `signInAs` to wait for hydration before filling (e.g. wait for the input to be enabled/interactive via a stable signal, or re-assert values immediately before the click inside the same retry loop) rather than only before the click.
  - Strength: Removes flakiness at its root without touching product code the plan says is out of scope.
  - Tradeoff: Touches shared test infrastructure used by every E2E spec; needs its own verification pass across the suite.
  - Confidence: MED — the race is clearly identified, but confirming zero-flake requires several repeated full-suite runs.
  - Blind spot: Haven't measured whether bundle-size growth from this plan's new islands (UserMenu, SidebarToggle, MobileNav) widened the hydration race window versus before — the sign-in page itself doesn't render AppShell, so no direct effect is expected, but it wasn't isolated with a before/after bisect.
- **Decision**: FIXED — moved the click and `waitForURL` inside the same `toPass` retry loop in `tests/e2e/support/auth.ts`, so a late hydration reset between the value check and the click is caught by the next attempt instead of submitting an emptied form. Verified with two consecutive clean full-suite runs (`supabase db reset` + `npx playwright test`), 14/14 passing each time.

## Automated Verification (full suite)

- `npm run build` — ✅ pass
- `npm run lint` — ✅ pass (0 errors, 18 pre-existing warnings unrelated to this diff)
- `npx vitest run` — ✅ 141/141 tests pass
- `npm run test:integration` (dev server + fresh `supabase db reset`) — ✅ 107/107 tests pass
- `npx playwright test` — ⚠️ intermittently flaky per F2; passes cleanly on most runs, one recurring failure mode isolated to the sign-in helper, unrelated to product code touched by this plan
- Grep checks (`Welcome|Topbar|/dashboard`, `bg-cosmic` outside `src/pages/auth/`, `min-h-screen` outside `src/pages/auth/`) — ✅ all clean
