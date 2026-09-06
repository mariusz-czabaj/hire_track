# Accessibility Remediation (WCAG 2.1 AA) Implementation Plan

## Overview

`context/changes/accessibility-audit-wcag-aa/research.md` is the audit. This plan is
the remediation sequence for the gaps it found, scoped to the **shared layer** —
design tokens, shared form primitives, the kanban card, the shared layout banner —
plus the automated gates that keep the fixes from regressing.

## Current State Analysis

The app is already better than an unaudited codebase: skip link, Radix dialog focus
trap/restore, a working dnd-kit `KeyboardSensor` with live-region announcements,
consistent `:focus-visible` rings, correct `<html lang>`, unique page titles, no
`div+onClick` anti-patterns, and correct icon-button labelling throughout. Those all
passed and are out of scope.

What is broken clusters in four shared places:

- **Tokens.** `--destructive` is `oklch(0.55 0.22 25)` in dark mode; used as error-text
  color on `--background` it measures **3.57:1** against a 4.5:1 requirement. The token
  is declared in four locations that must stay in sync: `src/styles/global.css` `:root`
  (:62), its `prefers-color-scheme: dark` block (:122), `.dark` (:179), and
  `src/lib/design-tokens.ts` `lightPalette` (:66) / `darkPalette` (:109). The
  `tokenPairs` list (`design-tokens.ts:145-185`) only ever pairs `X-foreground / X`,
  so a "destructive-as-text-on-background" row does not exist — `/dev/design-system`
  reports all-green while the failure is live.
- **Form primitives.** `FormField` wires `aria-invalid`/`aria-describedby` correctly
  (`form-field.tsx:49-50,56`), but `Textarea` and `FileInput` render an error `<p>`
  with **no `id` at all** (`textarea.tsx:38`, `file-input.tsx:39`), so the association
  cannot exist. No primitive accepts `required`. Note `Input` already spreads `...props`
  (`input.tsx:16`) and already styles `aria-invalid` (:13) — it needs no change.
- **Forms.** Three real `<form noValidate>` elements (`SignInForm.tsx:43`,
  `SignUpForm.tsx:66`, `CreateRecruitmentForm.tsx:88`) plus three dialog submit
  handlers (`AddCandidateDialog`, `StageEditor`, `MoveCandidateDialog`) each hand-roll
  validation. None moves focus to the first invalid field. `src/components/hooks/`
  holds `useApiResource`, `useCvUpload`, `useDebouncedValue`, `useMutation` — no
  form hook to extend.
- **Kanban card.** `DraggableCard` spreads dnd-kit `listeners` **and** `attributes`
  (which supply `role="button"` + `tabIndex=0`) onto a wrapper `div` that contains a
  real `<a>` and the `MoveCandidateDialog` trigger `<button>` — WCAG 4.1.2
  (`KanbanBoard.tsx:98`, used at :312-357).

Plus three isolated items: a hardcoded Polish string in `config-status.ts:15,17`
rendering via the shared `Layout.astro:24-38` on every page (WCAG 3.1.2 **and** a
`lessons.md` English-only violation), two unlabelled inputs
(`SecurityGroupDetail.tsx:184-194` rename box has no `id`/`label`/`aria-label`;
`UserSearchPicker.tsx:81-89` is placeholder-only), and `LibBadge.astro` — dead code
with a latent 1.07:1 contrast bug.

Tooling: `eslint-plugin-jsx-a11y` **is** enabled (`eslint.config.js:86` plugin +
`:108` `astro/flat/jsx-a11y-recommended`) — this closes the roadmap's S-14 open
question. There is no runtime axe check, exactly as `context/foundation/test-plan.md:106`
records. Unit tests are co-located (`src/lib/*.test.ts`, `src/components/**/*.test.tsx`)
under `vitest.config.ts`; `tests/e2e/` holds 8 Playwright specs.

## Desired End State

Every gap that lives in a shared primitive or token is fixed at its single source, and
CI fails if any of them regress: contrast unit tests assert every `tokenPairs` entry
(including the new error-text pair) meets its threshold in both palettes, and an
axe-core Playwright scan covers key screens in both themes. Screen-level raw-literal
findings are recorded as a checklist and bound to the remaining slices by a
`lessons.md` rule that `/10x-plan` and `/10x-implement` re-read.

Verify by: `npm run test` (contrast + primitive tests green), `npm run test:e2e`
(axe scans green, existing 8 specs still green), `npm run lint`, `npm run typecheck`,
and a manual keyboard + both-theme pass over the kanban and one form.

### Key Discoveries

- `Input` needs no change — it already forwards arbitrary props and styles `aria-invalid`
  (`src/components/ui/input.tsx:13,16`). Only `FormField` needs a `required` prop.
- The destructive token lives in **four** places (`global.css:62,122,179` +
  `design-tokens.ts:66,109`); `global.css` carries both a `prefers-color-scheme` block
  and a `.dark` class block with identical values.
- `Toaster` uses one `aria-live="polite"` container (`toaster.tsx:22`). ARIA politeness
  is a property of the live region, not of children — assertive errors require a
  **second sibling region**, not an attribute change.
- `MoveCandidateDialog` already gives keyboard users a complete move path, so adding a
  drag handle does not remove any keyboard capability.
- `tests/e2e/kanban-drag-and-drop.spec.ts` exercises the card and will need its drag
  target updated in Phase 4.
- `lessons.md:12-17` already predicts the raw-literal contrast findings and scopes the
  token rule to S-08..S-13, "not retroactive" — consistent with deferring screen work.

## What We're NOT Doing

- Migrating auth pages (`signin/signup/confirm-email.astro`), `SubmitButton.tsx`, or
  `SignUpForm.tsx:59` off raw Tailwind literals — six slices (S-08..S-13) are actively
  rewriting those screens. They currently pass AA (~5.38-5.97:1). Deferred via Phase 6.
- Introducing an i18n layer. The one Polish string is translated in place.
- Removing or redesigning kanban drag-and-drop (S-11's feature).
- Adding `<fieldset>`/`<legend>` to checkbox groups — minor, screen-level, deferred.
- `scope`/`caption` on `/dev/design-system` tables — dev-only, not recruiter-facing.
- Changing dialog keydown propagation (`ui/dialog.tsx:55-63`) — confirmed correct.
- Claiming full M-2 AA sign-off; this is the shared-layer pass plus the gate.

## Implementation Approach

Sequence lowest-risk-first and make each phase independently verifiable. Tokens go
first because they are pure CSS/TS with no DOM coupling, and because later phases'
error UI depends on the new token existing. Shared primitives next (single-file,
covered by existing co-located tests). The `useFormErrors` hook follows, since it
consumes the primitives' `required` contract. The kanban restructure is isolated but
carries E2E risk, so it sits after the form work rather than tangled with it. Isolated
semantics fixes batch into one phase. The verification harness lands last so it gates
a codebase that already passes.

## Critical Implementation Details

**State sequencing — token duplication.** `--destructive-text` must be added to all
five declaration sites in the same commit (`global.css` `:root`, the
`prefers-color-scheme: dark` block, `.dark`, and both `design-tokens.ts` palettes),
plus a `@theme inline` mapping (`global.css:219+`) so a `text-destructive-text`
utility exists. Adding it to `.dark` but not the media-query block produces a token
that works only after the theme script runs — a flash of unstyled/failing color.

**Live-region politeness.** Per above, splitting error toasts to `assertive` means
rendering two `aria-live` containers and partitioning `toasts` by variant. Both
regions must persist across renders — creating a live region at announce-time is not
reliably announced by screen readers.

---

## Phase 1: Contrast Tokens & Checker Coverage

### Overview

Give error text an AA-passing color in both themes, and close the `tokenPairs` blind
spot that let the failure hide.

### Changes Required:

#### 1. Error-text token

**File**: `src/styles/global.css`

**Intent**: Introduce a `--destructive-text` token intended for destructive *copy* on
`--background`/`--card`, leaving `--destructive` as the fill/border/ring color so
destructive buttons and `aria-invalid` rings are visually unchanged.

**Contract**: New custom property declared in all three blocks — `:root` (~:62),
`@media (prefers-color-scheme: dark)` (~:122), `.dark` (~:164) — plus a
`--color-destructive-text: var(--destructive-text);` entry in `@theme inline` (~:219)
so Tailwind emits `text-destructive-text`. The dark value must measure >= 4.5:1 against
`--background` `oklch(0.16 0.01 275)`; raising lightness toward ~`oklch(0.72 0.16 25)`
is the lever. The light value must measure >= 4.5:1 against `oklch(1 0 0)`. Verify both
with `contrastRatio()` before committing — do not eyeball.

#### 2. TS palette mirror

**File**: `src/lib/design-tokens.ts`

**Intent**: Mirror the new token in both palettes so the checker sees the same values
the browser does.

**Contract**: Add `destructiveText: string` to `TokenPalette` (~:8-50), and the matching
entries to `lightPalette` (~:66) and `darkPalette` (~:109). Values must be byte-identical
to `global.css`.

#### 3. Close the tokenPairs gap

**File**: `src/lib/design-tokens.ts`

**Intent**: Add the pairs the audit found missing so `/dev/design-system` stops
reporting false green.

**Contract**: Append to `tokenPairs` (~:145-185): `destructive-text / background`,
`destructive-text / card`, `muted-foreground / muted`, `primary / background`
(link text), and `border / background` + `input / background` at `size: "large"`
(the 3:1 non-text threshold). Every added pair must pass in both palettes; any that
does not is a real finding to fix in this phase, not to suppress.

#### 4. Consume the token

**Files**: `src/components/ui/form-field.tsx`, `src/components/ui/textarea.tsx`,
`src/components/ui/file-input.tsx`

**Intent**: Switch error-message `<p>` copy from `text-destructive` to the new
`text-destructive-text`. Border/ring usages (`border-destructive`,
`focus:ring-destructive`) stay on `--destructive`.

**Contract**: `form-field.tsx:56`, `textarea.tsx:38`, `file-input.tsx:39` — className
change only, no structural edit. Also audit `CreateRecruitmentForm.tsx` for
`text-destructive` used as copy.

#### 5. Contrast regression tests

**File**: `src/lib/design-tokens.test.ts` (new)

**Intent**: Make the checker's coverage executable so a token edit that breaks AA fails
CI rather than being noticed in a future audit.

**Contract**: Table-driven over `tokenPairs` x `{lightPalette, darkPalette}`, asserting
`meetsAA(contrastRatio(fg, bg), pair.size)`. Reuses the existing exports from
`src/lib/contrast.ts:57-68`. Follows the co-located pattern of `src/lib/contrast.test.ts`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- New contrast table test covers every `tokenPairs` entry in both palettes and passes
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Error text under a failing field is legible in dark mode and in light mode
- Destructive buttons and `aria-invalid` focus rings look unchanged from before
- `/dev/design-system` renders the new pairs, all green, with no missing-token errors

**Implementation Note**: Pause here for manual confirmation before Phase 2.

---

## Phase 2: Shared Form Primitives

### Overview

Make `Textarea` and `FileInput` announce their errors the way `FormField` already does,
and give every primitive a way to declare a field required.

### Changes Required:

#### 1. ARIA error association

**Files**: `src/components/ui/textarea.tsx`, `src/components/ui/file-input.tsx`

**Intent**: Replicate `FormField`'s existing, correct wiring so screen readers announce
the error that is already visible.

**Contract**: The error `<p>` gains `id={`${id}-error`}`; the control gains
`aria-invalid={!!error}` and `aria-describedby={error ? `${id}-error` : undefined}` —
matching `form-field.tsx:49-50,56` exactly. Do not alter the `label`/`htmlFor` pairing:
the file comments at `textarea.tsx:14-16` and `file-input.tsx:13-14` record that 37
`getByLabel` locators depend on it.

#### 2. Required pass-through and marker

**Files**: `src/components/ui/form-field.tsx`, `src/components/ui/textarea.tsx`,
`src/components/ui/file-input.tsx`

**Intent**: Let a field declare itself required to both assistive tech and sighted
users, without handing validation back to the browser.

**Contract**: Each primitive's props gain `required?: boolean`. When set, the control
receives `aria-required` and the rendered label carries a visible required indicator
whose meaning is available to screen readers (an `aria-hidden` asterisk paired with
visually-hidden text, or equivalent — do not rely on the asterisk glyph alone).
`noValidate` stays on the forms and the native `required` attribute is **not** set —
setting it would re-enable browser validation bubbles and break existing E2E error
assertions. `Input` needs no change (`input.tsx:16` already spreads props).

#### 3. Primitive tests

**Files**: `src/components/ui/textarea.test.tsx` (new),
`src/components/ui/file-input.test.tsx` (new), `src/components/ui/form-field.test.tsx`

**Intent**: Lock the ARIA contract so a future refactor cannot silently drop it.

**Contract**: Assert that with an `error` set the control is `aria-invalid` and its
accessible description resolves to the error text; assert `required` yields
`aria-required` and a perceivable marker. Extend the existing `form-field.test.tsx`
rather than duplicating it.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- New `Textarea`/`FileInput` ARIA tests pass
- Existing E2E suite still passes: `npm run test:e2e`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- With a screen reader, focusing an errored textarea announces label, invalid state, and the error text
- Required fields are visibly marked before any submit attempt
- `MoveCandidateDialog` note field and `CvPanel` file input behave and look unchanged

**Implementation Note**: Pause here for manual confirmation before Phase 3.

---

## Phase 3: `useFormErrors` Hook & Focus-to-Error

### Overview

Extract the duplicated error-state/validation shape into one hook that also moves focus
to the first invalid field on failed submit, and adopt it across the validating forms.

### Changes Required:

#### 1. The hook

**File**: `src/components/hooks/useFormErrors.ts` (new)

**Intent**: Own field-error state and, on a failed submit, move focus to the first
invalid field in DOM order so keyboard and screen-reader users are taken to the problem
instead of being left where they were.

**Contract**: Follows the existing hook conventions in `src/components/hooks/`
(`useApiResource`, `useMutation`). Exposes error state keyed by field id, a setter that
accepts a validation result, and a way to focus the first invalid control. Focus
resolution should key off the field `id` the primitives already require, so a form
declares its field order once. The hook must not assume a `<form>` element exists —
three consumers are dialog submit handlers, not forms.

#### 2. Adoption

**Files**: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`,
`src/components/recruitments/CreateRecruitmentForm.tsx`,
`src/components/recruitments/AddCandidateDialog.tsx`,
`src/components/recruitments/StageEditor.tsx`,
`src/components/recruitments/MoveCandidateDialog.tsx`

**Intent**: Replace each hand-rolled error-state block with the hook, and mark required
fields using the Phase 2 `required` prop so the declaration sits next to the field.

**Contract**: Each form's existing `validate()` logic and its user-facing error strings
are preserved verbatim — this is a refactor of *where state lives*, not of *what is
validated*. Entry points: `SignInForm.tsx:36-43`, `SignUpForm.tsx:51-66`,
`CreateRecruitmentForm.tsx:38-44,70-99`, `StageEditor.tsx:92-99`,
`AddCandidateDialog.tsx:54-60`, `MoveCandidateDialog.tsx:108-115`. Required fields in
`CreateRecruitmentForm` are `title`, `department`, `location`, `openedAt`, `groupIds`.
Do not change any `label` text or `id` — the E2E `getByLabel` locators depend on both.

#### 3. Hook test

**File**: `src/components/hooks/useFormErrors.test.ts` (new)

**Contract**: Cover: errors set on failed validation; focus lands on the first invalid
field in declared order, not the last; a passing validation clears prior errors and
moves no focus.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- `CreateRecruitmentForm.test.tsx` and the auth form tests still pass unmodified in intent
- Existing E2E suite still passes: `npm run test:e2e`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Submitting each form empty moves focus to the first invalid field, keyboard-only
- The dialog forms keep focus inside the dialog when validation fails
- No error message wording changed anywhere

**Implementation Note**: Pause here for manual confirmation before Phase 4.

---

## Phase 4: Kanban Drag Handle

### Overview

Stop announcing the whole card as a button while it contains a link and a button, without
losing keyboard drag.

### Changes Required:

#### 1. Restructure `DraggableCard`

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: Attach dnd-kit's drag affordance to a dedicated handle element rather than to
a wrapper that contains other interactive controls, resolving the WCAG 4.1.2 nesting
violation while keeping both pointer and keyboard drag operable.

**Contract**: `DraggableCard` (:85-102) keeps `setNodeRef` on the wrapper `div` — dnd-kit
needs the node for hit-testing — but `listeners` and `attributes` move onto a rendered
handle `<button type="button">` inside the card. The handle needs an accessible name
identifying the candidate it moves (mirror the naming already used for the move-dialog
trigger at :335, which includes card index and full name). The wrapper must no longer
carry `role`/`tabIndex` from `attributes`. `KeyboardSensor` and the `announcements`
wiring (:164-167, :219-244, :280) are correct and must not be touched.

#### 2. E2E drag target

**File**: `tests/e2e/kanban-drag-and-drop.spec.ts`

**Intent**: Point the existing drag interactions at the handle.

**Contract**: Locate the handle via its accessible name (`getByRole("button", { name: ... })`)
— not a CSS selector or test id — per the repo's E2E locator rule in `CLAUDE.md`.
Keyboard-drag assertions must continue to exercise the real `KeyboardSensor` path.

### Success Criteria:

#### Automated Verification:

- E2E suite passes, including `kanban-drag-and-drop.spec.ts`: `npm run test:e2e`
- Unit tests pass: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting (incl. `jsx-a11y`) passes: `npm run lint`

#### Manual Verification:

- Pointer drag works from the handle; the card link and move button are clickable without starting a drag
- Tab order is card link -> move button -> handle (or equivalent sensible order) with no phantom button stop on the card itself
- Keyboard drag (focus handle, activate, arrow, drop) still moves the candidate and is announced
- Handle is visible and hit-target-sized on touch widths

**Implementation Note**: Pause here for manual confirmation before Phase 5.

---

## Phase 5: Semantics Cleanup

### Overview

Four isolated fixes that share no code but all close confirmed findings.

### Changes Required:

#### 1. English banner string

**File**: `src/lib/config-status.ts`

**Intent**: Remove the Polish string rendering on every page via the shared layout,
fixing WCAG 3.1.2 without a `lang` attribute and satisfying the `lessons.md` English-only
rule.

**Contract**: `message` (:15) and `docsLabel` (:17) rewritten in English, preserving
meaning. No change to `Layout.astro:24-38`. Note the S-13 roadmap entry flags the same
Polish-string class in `Banner.astro`; keep wording consistent if that lands nearby.

#### 2. Assertive error toasts

**File**: `src/components/ui/toaster.tsx`

**Intent**: Let failure toasts interrupt rather than queue behind other announcements,
while keeping success/info polite.

**Contract**: Render **two** persistent sibling live regions — the existing
`aria-live="polite"` container (:22) and a new `aria-live="assertive"` one — and
partition `toasts` by `variant === "error"`. Both regions must render on every pass
(empty when unused); a region created at announce-time is unreliably announced. Visual
stacking must remain a single visual column.

#### 3. Label the unlabelled inputs

**Files**: `src/components/admin/SecurityGroupDetail.tsx`,
`src/components/admin/UserSearchPicker.tsx`

**Intent**: Give both controls a real accessible name (WCAG 3.3.2 / 4.1.2).

**Contract**: The rename input (:184-194) gains an `id` and an associated `<label>` —
visually-hidden if the inline layout has no room. The search input (:81-89) gains a real
label; `CandidateList.tsx`'s correctly-labelled search box is the pattern to copy.
Placeholder text is not a label and must not be the only name.

#### 4. Delete dead component

**File**: `src/components/ui/LibBadge.astro`

**Intent**: Remove an unused component carrying a latent 1.07:1 contrast bug before
anyone reuses it.

**Contract**: Confirm zero imports repo-wide, then delete the file.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- E2E suite passes: `npm run test:e2e`
- No repo-wide references to `LibBadge` remain
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- No non-English UI strings remain in `src/lib/config-status.ts`

#### Manual Verification:

- An error toast is announced immediately by a screen reader; a success toast is not disruptive
- Both regions coexist without visual duplication or layout shift
- Rename and user-search inputs announce a meaningful name on focus
- Banner renders correct English copy when Supabase env vars are absent

**Implementation Note**: Pause here for manual confirmation before Phase 6.

---

## Phase 6: Verification Harness & Handoff

### Overview

Install the runtime gate that `context/foundation/test-plan.md:106` records as missing,
and hand the deferred screen-level findings to the slices that will own them.

### Changes Required:

#### 1. axe-core in Playwright

**Files**: `package.json`, `tests/e2e/accessibility.spec.ts` (new)

**Intent**: Catch DOM-level WCAG regressions automatically on key screens in both themes.

**Contract**: Add `@axe-core/playwright` as a dev dependency. The spec authenticates via
the existing `tests/e2e/support/auth.ts` helper, visits the primary screens (sign-in,
recruitments list, kanban board, candidate profile, admin groups), and runs an axe scan
per screen in **both** light and dark themes, filtered to `wcag2a`/`wcag2aa` tags.
Assertions must fail on violations, not merely report. Follows the repo E2E rules in
`CLAUDE.md`: no `page.waitForTimeout`, independent tests with their own setup. Screens
still carrying deferred raw literals may need narrowly-scoped, individually-commented
exclusions referencing the Phase 6 checklist — never a blanket disable.

#### 2. Deferred findings checklist

**File**: `context/changes/accessibility-audit-wcag-aa/deferred-findings.md` (new)

**Intent**: Record every audit finding this change deliberately did not fix, so it is
schedulable rather than lost.

**Contract**: One row per deferred finding with its file:line, WCAG criterion, and the
slice expected to own it: auth-page raw literals (`signin/signup/confirm-email.astro`,
`SubmitButton.tsx:18`, `SignUpForm.tsx:59`), checkbox groups missing
`<fieldset>`/`<legend>` (`CreateRecruitmentForm.tsx:161-195`,
`SecurityGroupDetail.tsx:206-221`), and `/dev/design-system` table `scope`/`caption`.

#### 3. Lessons entry

**File**: `context/foundation/lessons.md`

**Intent**: Bind the deferred work to the remaining slices via the register that
`/10x-plan`, `/10x-implement` and the review skills re-read at start.

**Contract**: Append one entry, in the file's existing
Context/Problem/Rule/Applies-to format, requiring any slice touching
`src/components/**` or `src/pages/**` to measure contrast on the screens it changes and
clear the relevant `deferred-findings.md` rows. Scope "Applies to" at S-08..S-13 and
later, consistent with the existing token lesson at :12-17.

#### 4. Test-plan update

**File**: `context/foundation/test-plan.md`

**Contract**: Update the `accessibility` row (:106) — runtime axe coverage now exists;
state what it covers and what it does not (axe catches roughly 30-40% of WCAG issues;
keyboard and screen-reader passes remain manual).

### Success Criteria:

#### Automated Verification:

- Full E2E suite incl. new axe spec passes: `npm run test:e2e`
- axe scan runs against every listed screen in both themes with zero unexplained violations
- Unit tests pass: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Deliberately reverting one Phase 1-5 fix makes the harness fail (gate proven, then revert the revert)
- `deferred-findings.md` accounts for every audit finding not fixed here
- The `lessons.md` entry reads as actionable to someone planning S-08..S-13

**Implementation Note**: This is the final phase. Confirm the full audit-to-remediation
trail is coherent before closing the change.

---

## Testing Strategy

### Unit Tests

- `tokenPairs` x both palettes contrast table (the Phase 1 gate)
- `Textarea`/`FileInput` `aria-invalid` + accessible-description association
- `required` yields `aria-required` and a perceivable marker
- `useFormErrors`: error set, first-invalid focus order, clear-on-pass

### Integration / E2E

- axe-core scans of five key screens x light/dark, `wcag2a`/`wcag2aa`
- Existing kanban drag spec retargeted at the handle, keyboard path included
- Existing 8 specs must pass unmodified except the kanban drag target

### Manual Testing Steps

1. Screen reader: submit each form empty — focus moves to the first invalid field and its error is announced.
2. Keyboard-only kanban: tab to a card's handle, drag with the keyboard, confirm the move is announced.
3. Toggle light/dark on a screen with a visible field error; confirm error text is legible in both.
4. Trigger an error toast and a success toast; confirm only the error interrupts.
5. Unset Supabase env vars locally; confirm the banner reads correct English.
6. Tab the whole kanban board and confirm no card announces as a bare "button" wrapper.

## Performance Considerations

None material. The second live region is an empty `div` when unused. axe scans run only
in the E2E suite and will add noticeably to its runtime — if that becomes a problem,
narrow the screen list rather than dropping the theme dimension, since dark mode is
where the audit's contrast failure lived.

## Migration Notes

No data migration. The only cross-cutting risk is the token change: `--destructive`
keeps its current value, so existing destructive fills, borders and rings are visually
untouched; only error *copy* moves to the new token. Rollback of any phase is a plain
revert — no phase depends on a deployed state of a prior one beyond source.

## References

- Audit / research: `context/changes/accessibility-audit-wcag-aa/research.md`
- Token lesson this plan extends: `context/foundation/lessons.md:12-17`
- Roadmap item: `context/foundation/roadmap.md` S-14 (`accessibility-audit-wcag-aa`)
- Test coverage gap this closes: `context/foundation/test-plan.md:106`
- Correct ARIA pattern to replicate: `src/components/ui/form-field.tsx:40-59`
- Prior token work: `context/changes/design-system-foundation/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contrast Tokens & Checker Coverage

#### Automated

- [x] 1.1 Unit tests pass: `npm run test` — b91a1bf
- [x] 1.2 New contrast table test covers every `tokenPairs` entry in both palettes and passes — b91a1bf
- [x] 1.3 Type checking passes: `npm run typecheck` — b91a1bf
- [x] 1.4 Linting passes: `npm run lint` (pre-existing unrelated error in kanban-drag-and-drop.spec.ts not caused by this phase) — b91a1bf

#### Manual

- [x] 1.5 Error text legible in dark and light mode — b91a1bf
- [x] 1.6 Destructive buttons and `aria-invalid` rings visually unchanged — b91a1bf
- [x] 1.7 `/dev/design-system` renders new pairs, all green — b91a1bf

### Phase 2: Shared Form Primitives

#### Automated

- [x] 2.1 Unit tests pass: `npm run test` — 4ca6b8a
- [x] 2.2 New `Textarea`/`FileInput` ARIA tests pass — 4ca6b8a
- [x] 2.3 Existing E2E suite still passes: `npm run test:e2e` — 4ca6b8a
- [x] 2.4 Type checking passes: `npm run typecheck` — 4ca6b8a
- [x] 2.5 Linting passes: `npm run lint` — 4ca6b8a

#### Manual

- [x] 2.6 Screen reader announces label, invalid state and error text on an errored textarea — 4ca6b8a
- [x] 2.7 Required fields visibly marked before submit — 4ca6b8a
- [x] 2.8 `MoveCandidateDialog` note field and `CvPanel` file input unchanged — 4ca6b8a

### Phase 3: `useFormErrors` Hook & Focus-to-Error

#### Automated

- [x] 3.1 Unit tests pass: `npm run test` — 619d892
- [x] 3.2 Existing form tests still pass unmodified in intent — 619d892
- [x] 3.3 Existing E2E suite still passes: `npm run test:e2e` — 619d892
- [x] 3.4 Type checking passes: `npm run typecheck` — 619d892
- [x] 3.5 Linting passes: `npm run lint` — 619d892

#### Manual

- [x] 3.6 Empty submit moves focus to first invalid field, keyboard-only, in every form — 619d892
- [x] 3.7 Dialog forms keep focus inside the dialog on validation failure — 619d892
- [x] 3.8 No error message wording changed — 619d892

### Phase 4: Kanban Drag Handle

#### Automated

- [x] 4.1 E2E suite passes incl. `kanban-drag-and-drop.spec.ts`: `npm run test:e2e` (2 pre-existing failures in `recruitments.spec.ts` confirmed unrelated — reproduce identically on `main` before this phase's changes) — a49e07c
- [x] 4.2 Unit tests pass: `npm run test` — a49e07c
- [x] 4.3 Type checking passes: `npm run typecheck` — a49e07c
- [x] 4.4 Linting (incl. `jsx-a11y`) passes: `npm run lint` — a49e07c

#### Manual

- [x] 4.5 Pointer drag works from handle; link and move button clickable without dragging — a49e07c
- [x] 4.6 Sensible tab order, no phantom button stop on the card wrapper — a49e07c
- [x] 4.7 Keyboard drag still moves the candidate and is announced — a49e07c
- [x] 4.8 Handle visible and hit-target-sized on touch widths — a49e07c

### Phase 5: Semantics Cleanup

#### Automated

- [x] 5.1 Unit tests pass: `npm run test` — fb6cd3d
- [x] 5.2 E2E suite passes: `npm run test:e2e` (2 pre-existing failures in `recruitments.spec.ts`, same as flagged unrelated in Phase 4) — fb6cd3d
- [x] 5.3 No repo-wide references to `LibBadge` remain — fb6cd3d
- [x] 5.4 Type checking passes: `npm run typecheck` — fb6cd3d
- [x] 5.5 Linting passes: `npm run lint` — fb6cd3d
- [x] 5.6 No non-English UI strings remain in `src/lib/config-status.ts` — fb6cd3d

#### Manual

- [x] 5.7 Error toast announced immediately; success toast not disruptive — fb6cd3d
- [x] 5.8 Both live regions coexist without visual duplication or layout shift — fb6cd3d
- [x] 5.9 Rename and user-search inputs announce a meaningful name — fb6cd3d
- [x] 5.10 Banner renders correct English copy when Supabase env vars absent — fb6cd3d

### Phase 6: Verification Harness & Handoff

#### Automated

- [x] 6.1 Full E2E suite incl. new axe spec passes: `npm run test:e2e` (2 pre-existing failures in `recruitments.spec.ts`, same as flagged unrelated in Phases 4-5) — 3f7ed00
- [x] 6.2 axe scan covers every listed screen in both themes with zero unexplained violations — 3f7ed00
- [x] 6.3 Unit tests pass: `npm run test` — 3f7ed00
- [x] 6.4 Type checking passes: `npm run typecheck` — 3f7ed00
- [x] 6.5 Linting passes: `npm run lint` — 3f7ed00

#### Manual

- [x] 6.6 Reverting one earlier fix makes the harness fail (gate proven) — 3f7ed00
- [x] 6.7 `deferred-findings.md` accounts for every unfixed audit finding — 3f7ed00
- [x] 6.8 `lessons.md` entry reads as actionable for S-08..S-13 planning — 3f7ed00
