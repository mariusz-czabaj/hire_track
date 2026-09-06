# Accessibility Remediation (WCAG 2.1 AA) — Plan Brief

> Full plan: `context/changes/accessibility-audit-wcag-aa/plan.md`
> Research (the audit itself): `context/changes/accessibility-audit-wcag-aa/research.md`

## What & Why

The research doc is a completed WCAG 2.1 AA audit; this plan is the remediation. It fixes
every gap that lives in a **shared** primitive or design token — error-text contrast,
form ARIA wiring, required-field semantics, focus-on-validation-failure, the kanban
card's nested-interactive violation, and a Polish string on every page — then installs
automated gates so those fixes cannot silently regress. WCAG AA is a hard M-2 acceptance
criterion, and today the project's own contrast tool reports green while a real dark-mode
failure is live.

## Starting Point

The app already passes on skip link, landmarks, page titles, `<html lang>`, dialog focus
trap/restore, keyboard drag-and-drop with live-region announcements, focus-visible rings,
and icon-button labelling. `eslint-plugin-jsx-a11y` is enabled, so static rules are
covered — but there is no runtime accessibility check anywhere (`test-plan.md:106`). The
real failures cluster in four shared places: the destructive token (3.57:1 as error text
in dark mode, and absent from the checker's own pair list), `Textarea`/`FileInput` whose
error text has no `id` to associate, six forms that hand-roll validation with no shared
hook and no focus-to-error, and a kanban card that wraps a link and a button in a
`role="button"` draggable div.

## Desired End State

Error text is legible in both themes; every form field announces its invalid state,
its error, and whether it is required; a failed submit takes the user to the first
problem field; the kanban card exposes a proper drag handle instead of impersonating a
button. Contrast unit tests and an axe-core Playwright scan run in CI across both themes,
so a regression fails the build rather than waiting for the next audit.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Remediation scope | Shared layer now, screens deferred | Six slices (S-08..S-13) are actively rewriting those screens, so per-screen fixes would be immediate rework. | Plan |
| Contrast fix | New `--destructive-text` token | Fixes text contrast without shifting destructive buttons, borders and focus rings that share `--destructive`. | Plan |
| Focus-to-error | Shared `useFormErrors` hook | Fixes all six forms once and stops the duplication growing; matches the existing `src/components/hooks/` convention. | Plan |
| Required fields | `aria-required` + visible marker | Serves screen-reader and sighted users while keeping `noValidate`, so existing inline errors and E2E assertions survive. | Plan |
| Kanban card | Dedicated drag handle | Removes the WCAG 4.1.2 nesting violation while preserving both pointer and keyboard drag. | Plan |
| Verification | axe in Playwright + contrast unit tests | Closes both the runtime gap (`test-plan.md:106`) and the checker blind spot that produced the false green. | Plan |
| Polish banner string | Translate to English | Fixes WCAG 3.1.2 and the `lessons.md` English-only rule without an i18n layer for one dev-facing string. | Plan |
| Deferred findings | Checklist + `lessons.md` rule | `lessons.md` is re-read by `/10x-plan` and `/10x-implement`, so the deferred work is enforced rather than buried. | Plan |
| Audit findings | Confirmed against source | `Input` already forwards props and styles `aria-invalid`; the destructive token is declared in four places; jsx-a11y is enabled. | Research + Plan |

## Scope

**In scope:** `--destructive-text` token across all declaration sites; `tokenPairs`
coverage + contrast tests; `aria-invalid`/`aria-describedby` on `Textarea`/`FileInput`;
`required` pass-through with a visible marker; `useFormErrors` hook adopted by six forms;
kanban drag-handle restructure; English banner string; assertive error toasts; two
unlabelled admin inputs; deleting dead `LibBadge.astro`; axe-core E2E harness; deferred
checklist + `lessons.md` entry.

**Out of scope:** auth-page raw Tailwind literals and other screen-level restyling (owned
by S-08..S-13); any i18n layer; removing or redesigning kanban drag-and-drop;
`<fieldset>`/`<legend>` on checkbox groups; `/dev/design-system` table semantics; the
dialog keydown guard (confirmed correct); full M-2 AA sign-off.

## Architecture / Approach

Lowest-risk-first, each phase independently verifiable. Tokens lead because they are pure
CSS/TS with no DOM coupling and later phases' error UI depends on the new token. Shared
primitives follow (single-file, existing co-located tests). The `useFormErrors` hook comes
next since it consumes the primitives' `required` contract. The kanban restructure is
isolated but carries E2E risk, so it sits apart from the form work. Isolated semantics
fixes batch together. The verification harness lands last, gating a codebase that already
passes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Contrast tokens & checker | AA-passing error text in both themes + contrast tests | Token declared in 4 places; missing one causes a theme-flash mismatch |
| 2. Shared form primitives | ARIA error association + `required` semantics | 37 `getByLabel` locators depend on the untouched label/id pairing |
| 3. `useFormErrors` hook | Focus-to-first-invalid across six forms | Refactoring state in six files at once; error wording must not drift |
| 4. Kanban drag handle | WCAG 4.1.2 fixed, keyboard drag preserved | Existing drag E2E spec must be retargeted without weakening it |
| 5. Semantics cleanup | English banner, assertive toasts, labels, dead code gone | Toast politeness needs a second live region, not an attribute flip |
| 6. Verification harness | axe in CI, deferred checklist, lessons rule | Deferred-literal screens may need scoped, justified axe exclusions |

**Prerequisites:** None blocking. Roadmap S-14 nominally waits on S-08..S-13, but the
shared-layer scope is deliberately chosen to be safe to land while those are in flight.
Requires local Supabase for E2E, plus a new `@axe-core/playwright` dev dependency.

**Estimated effort:** ~4-6 sessions across 6 phases; Phase 3 is the largest single step.

## Open Risks & Assumptions

- Landing shared-primitive changes while six slices are in flight risks merge conflicts in
  the same files; sequencing with those slices' owners may be needed.
- Phase 3 touches all six forms at once — the assumption that validation logic can move
  wholesale without behaviour change should be checked against the existing form tests early.
- axe covers roughly 30-40% of WCAG issues; keyboard and screen-reader passes stay manual,
  so the harness is a floor, not a sign-off.
- Screens still holding deferred raw literals may force scoped axe exclusions; if those grow
  beyond a couple, the deferral boundary should be revisited.
- The new dark-mode `--destructive-text` value must be measured, not eyeballed — the whole
  audit finding exists because a value was assumed to pass.

## Success Criteria (Summary)

- A screen-reader user submitting any form is taken to the first invalid field and hears the label, the invalid state, the error, and whether the field was required.
- A keyboard-only user moves a candidate across the kanban via a named drag handle, and no card announces itself as a bare button.
- Error text is legible in both themes, and CI fails if any token pair — or any scanned screen — regresses below AA.
