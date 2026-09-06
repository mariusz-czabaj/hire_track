<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Recruitment Header Metadata Implementation Plan

- **Plan**: context/changes/recruitment-header-metadata/plan.md
- **Scope**: Phase 1-3 of 3 (full plan)
- **Date**: 2026-09-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Unrelated auth.ts fix bundled into feature commit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: tests/e2e/support/auth.ts (commit d47cb72)
- **Detail**: Commit d47cb72's message admits bundling a pre-existing, unrelated dirty change to the sign-in retry helper alongside the Phase 1 data-layer work. The change itself is a real flake fix (moves the Sign-in click and `waitForURL` inside the `toPass` retry block so a hydration-triggered form reset can't fire a doomed submit), and is not harmful, but it wasn't part of this plan and landed in an unrelated commit rather than its own.
- **Fix**: No action needed retroactively (already merged and disclosed in the commit message); going forward, split unrelated pre-existing dirty files into their own commit rather than folding them into a feature commit.
- **Decision**: ACKNOWLEDGED, no action

### F2 — New tests/e2e/seed.spec.ts not mentioned in plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: tests/e2e/seed.spec.ts (commit 3361699)
- **Detail**: A new file was added in the Phase 3 commit that isn't described anywhere in the plan's "Changes Required." Its own commit message frames it as a seed-pattern exemplar for the `/10x-e2e` skill rather than feature-specific coverage, which is plausible but wasn't captured in the plan text.
- **Fix**: If it's meant to be a durable exemplar, note it as a plan addendum; otherwise no action needed since it's benign, unrelated test infrastructure.
- **Decision**: ACKNOWLEDGED, no action

### F3 — openedAt rendered raw instead of through shared formatDate

- **Severity**: OBSERVATION
- **Dimension**: Plan Adherence
- **Location**: src/pages/recruitments/[id].astro:56 (metadata entry) and src/components/recruitments/KanbanBoard.tsx:24 (`formatDate`)
- **Detail**: Plan says `openedAt` should format as YYYY-MM-DD "matching `formatDate` at KanbanBoard.tsx:24." The implementation renders `recruitment.openedAt` directly without calling `formatDate` (or any shared formatter). Value-equivalent today because the DB column is a `date` type already serialized as YYYY-MM-DD, but there's no actual code-level reuse — if the column's serialization ever changes, this would silently diverge from the rest of the app's date rendering.
- **Decision**: FIXED — added local `formatDate` helper to `src/pages/recruitments/[id].astro` (mirroring the KanbanBoard.tsx pattern) and routed `openedAt` through it.

### F4 — No-h2-in-page-title-slot rule already broken pre-existing elsewhere on the page

- **Severity**: OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: src/components/recruitments/KanbanBoard.tsx (stage column headings, pre-existing since commit 7cb73c4)
- **Detail**: The plan's "no `<h2>`" instruction is correctly followed in the new header (only `<h1>` + a metadata row), but Kanban stage columns elsewhere on the same page already use `<h2>` and predate this change — not a regression introduced by this diff, just worth being aware the rule wasn't universal.
- **Decision**: ACKNOWLEDGED, no action (pre-existing, out of scope for this plan)

## Automated Verification Re-run

- `npm run lint` — PASS (0 errors, 18 pre-existing `no-console` warnings unrelated to this change)
- `npx vitest run src/lib/services/recruitments.test.ts` — PASS (23/23 tests, including 6 new `getRecruitmentDetail` cases)
- Build / full E2E suite not re-run in this review (already verified per Progress log with commit SHAs; no code changed since).

## Summary

Both sub-agent reviews (plan drift + safety/pattern) came back clean: every planned file change matches its Phase 1-3 contract, the critical same-commit `<h1>` ordering rule was upheld (commit d3b23e6), the RLS not-found collapsing behaves as specified, and there are no CRITICAL security/reliability/data-safety findings. The only issues are minor scope-discipline notes about two out-of-plan file touches (one disclosed flake fix, one new exemplar test) and two low-stakes observations about date formatting and a pre-existing heading-level inconsistency elsewhere on the page.
