# Forms, Error Messages, and Action Confirmations Implementation Plan

## Overview

Unify the app's form fields onto one `Input`-backed primitive, replace the single
overloaded `ServerError` component with a variant-driven, accessible `Alert`, and
introduce a cross-island toast system so a successful mutation gives visible
confirmation instead of a silent refetch. Also fixes the configuration banner's
raw hex colors and its Polish strings.

This is roadmap slice **S-13** (milestone MS-07). Prerequisite F-02
(`design-system-foundation`) is complete.

## Current State Analysis

- **14 form surfaces**, all hand-rolled (`useState` + manual `validate()`), no
  `react-hook-form`. Server-side zod validation is authoritative everywhere;
  client-side checks are UX-only duplicates.
- **Two parallel field styles.** `src/components/auth/FormField.tsx` carries its
  own `inputBase` string built from raw literals (`bg-white/10`, `text-white`,
  `focus:ring-purple-400`) and is imported by 8 files across auth, recruitments,
  and candidates. `src/components/ui/input.tsx` is token-driven but offers no
  label, no icon slot, and no error slot — so consolidation is a genuine merge,
  not a swap. `src/components/ui/file-input.tsx` is already fully tokenized and
  is the closest existing model for the merged field.
- **One error surface for three meanings.** `ServerError` is imported by
  **15 files**. It is a plain `<p>` with raw literals (`border-red-500/30`,
  `bg-red-900/30`, `text-red-300`) and **no `role="alert"`**. It renders genuine
  server errors, resource-load failures, and not-found states alike
  (`SecurityGroupDetail.tsx:169`).
- **No confirmation UI at all.** No toast dependency, no `Toaster`, no portal.
  Success is communicated only by `onChanged()` → `refetch()`.
- **No `--success`, `--warning`, or `--info` tokens.** Only `--destructive`
  exists. `--stage-1..6` (added in S-10) is the precedent for adding a semantic
  family.
- **`Banner.astro`** already sets `role="alert"`/`role="status"` correctly but
  styles itself with light-mode hex literals (`#dbeafe`, `#fef3c7`, `#fee2e2`).
  Its **Polish strings live in `src/layouts/Layout.astro:27,33`**, not in
  `Banner.astro` — the research doc placed them in the wrong file.
- **Test infrastructure already exists**: `vitest.config.ts` (jsdom + RTL +
  `@testing-library/jest-dom`), with 10 component test files under
  `src/components/**`. `npm test` is the runner.
- **Islands, not one React tree.** Every page mounts 5–6 *independent*
  `client:load` roots (`SidebarToggle`, `MobileNav`, `ThemeToggle`, `UserMenu`,
  plus the page island). Every non-auth page renders through `AppShell.astro`.

## Desired End State

Every form field in the app renders through one `ui/form-field.tsx` that wraps
the token-driven `ui/input.tsx`, with `label`/`htmlFor`, leading icon,
`aria-invalid`, and `aria-describedby` wired consistently. Every error, warning,
and informational message renders through one `ui/alert.tsx` that announces
assertively only when it is actually an error. Every data-changing mutation
raises a toast naming what happened, announced politely to screen readers. The
configuration banner is token-styled and English.

Verified by: `npm test` (new RTL suites for `Alert`, `FormField`, toast store,
plus the existing 10 component suites), `npm run test:e2e` green with its 53
`getByLabel` locators unchanged, `npm run typecheck`, `npm run lint`, and a
manual pass over `/dev/design-system` in both themes.

### Key Discoveries:

- `src/components/ui/file-input.tsx:16-45` — already-tokenized labeled field with
  inline error; the structural model for `ui/form-field.tsx`.
- `src/components/hooks/useMutation.ts:5` — `DEFAULT_ERROR_MESSAGE` is module-
  private today; `SecurityGroupDetail.tsx` repeats the literal 4 times.
- `src/lib/design-tokens.ts:1-6` — hand-maintained `oklch()` mirror of
  `global.css`, consumed by `contrast.ts` and `/dev/design-system`. Its own
  header comment mandates keeping it in sync.
- `src/styles/global.css` — token values appear in **three** theme blocks
  (`:root` @44, `@media (prefers-color-scheme: dark) :root:not(.light)` @97,
  `.dark` @147) plus the `@theme` mapping (~@200). A new token needs all four.
- `src/components/AppShell.astro` — used by all 9 non-auth pages; the single
  sanctioned mount point for a global `Toaster`.
- `tests/e2e/` asserts **nothing** on `ServerError`'s markup, its strings, or on
  any `role`-based alert — so adding `role="alert"` carries no E2E risk, but the
  error surface has no regression net either.
- `src/components/recruitments/StageEditor.tsx:36-38` — documents that client
  validation is UX-only and the server is authoritative; the convention any new
  client-side validation must follow.

## What We're NOT Doing

- **Not converting the auth forms to fetch.** `SignInForm`/`SignUpForm` keep
  their native `<form method="POST">`, full-page redirect, and `?error=` query
  decode. They get the new field and alert primitives, nothing more.
- **Not refactoring `SecurityGroupDetail` onto `useMutation`.** Its three manual
  fetch blocks stay; only the duplicated error *string* is unified. Deferred as
  a follow-up.
- **Not generalising `SubmitButton`.** It stays tied to `useFormStatus` and to
  the two auth forms; the other forms keep their hand-rolled spinners.
- **Not adding a separate `EmptyState` component.** Not-found and no-results
  states move to `Alert`'s non-error variants; a dedicated empty-state primitive
  is out of scope (S-12 already owns list empty-state copy).
- **Not introducing `react-hook-form`, a shared schema directory, or any new
  runtime dependency.** The toast system is hand-rolled, matching how every other
  primitive in `ui/` was built.
- **Not toasting errors.** Errors stay inline and anchored to the failing form.
- **Not touching `bg-cosmic`** or the remaining literal-color cleanup outside the
  files this slice edits.

## Implementation Approach

Four phases, sequenced so that tokens exist and are contrast-validated before any
UI consumes them (the rule F-02's plan review, finding F4, established), and so
that building the primitives is separated from the mechanical migration of ~24
call sites. `ServerError` is retained as a thin alias re-exporting `Alert` so
Phase 2 can land without touching 15 files, and Phase 3 removes it.

## Critical Implementation Details

**Cross-island toast delivery.** Toasts are raised inside one React island (e.g.
`AddCandidateDialog`) and rendered by a `Toaster` mounted as a *different* island
in `AppShell`. React context and any provider-based store therefore cannot carry
them — the two roots share no tree. The store must be a singleton pinned to
`globalThis`/`window` (not merely a module-level `let`, which is only reliable if
the bundler emits one shared chunk for every island on the page), with
subscription via `useSyncExternalStore`. Guard the singleton's creation so SSR
and repeated island hydration do not reset it. This is the highest-risk detail
in the slice; if it is wrong, toasts fire from page islands but never from
topbar islands, and the failure is silent.

**Token sync has four sites, not one.** Adding `--success` means editing
`:root`, the `prefers-color-scheme` block, the `.dark` block, and the `@theme`
`--color-*` mapping in `global.css`, plus both `lightPalette` and `darkPalette`
in `design-tokens.ts`. There is no automated sync check (flagged as finding F3 in
F-02's implementation review), so Phase 1's contrast test is the only thing that
will catch a missed block.

**`aria-describedby` and the 53 `getByLabel` locators.** `FormField`'s
`label`/`htmlFor`/`id` triple is what those locators resolve through. The error
text gets its own id (`${id}-error`) referenced by `aria-describedby`; the
`label`'s association with the input must not change shape.

---

## Phase 1: Semantic Tokens

### Overview

Add `--success`, `--warning`, and `--info` (each with a `-foreground` pair) to the
token layer and prove their contrast before any component consumes them.

### Changes Required:

#### 1. Token definitions

**File**: `src/styles/global.css`

**Intent**: Define the three new semantic color pairs so toasts, alerts, and the
config banner can express meaning through the theme system rather than literals.

**Contract**: Six new custom properties — `--success`, `--success-foreground`,
`--warning`, `--warning-foreground`, `--info`, `--info-foreground` — declared in
**all three** theme blocks (`:root`, the `prefers-color-scheme: dark` block, and
`.dark`), with matching `--color-*: var(--*)` entries in the `@theme` mapping so
Tailwind emits `bg-success` / `text-success-foreground` utilities. Values are
`oklch()`, following the `--destructive` and `--stage-*` conventions. Each
foreground must clear WCAG AA (4.5:1) against its own background in both themes.

#### 2. JS token mirror

**File**: `src/lib/design-tokens.ts`

**Intent**: Keep the browser-free mirror in step with the CSS so contrast
measurement covers the new tokens.

**Contract**: Extend the `TokenPalette` interface with the six new keys and add
their values to both `lightPalette` and `darkPalette`.

#### 3. Contrast coverage

**File**: `src/lib/contrast.test.ts`

**Intent**: Fail the build if a new semantic pair drops below AA in either theme.

**Contract**: Extend the existing AA assertion table with the three new
foreground/background pairs, asserted against both palettes.

#### 4. Design-system swatches

**File**: `src/pages/dev/design-system.astro`

**Intent**: Make the new tokens visually inspectable alongside the stage palette.

**Contract**: A semantic-color section rendering `bg-success text-success-foreground`
and the warning/info equivalents, plus the new pairs added to the measured
contrast table on that page.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including new contrast assertions: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- `/dev/design-system` shows the three new swatches legibly in light and dark
- Toggling the theme changes all three; none stays fixed (proves all theme blocks were edited)

---

## Phase 2: Primitives

### Overview

Build the three new components — `Alert`, `FormField`, and the toast system —
with unit tests, without yet migrating any call site.

### Changes Required:

#### 1. Alert primitive

**File**: `src/components/ui/alert.tsx`

**Intent**: One accessible message component replacing `ServerError`'s single
untyped shape, so a not-found state stops announcing as assertively as a failure.

**Contract**: `Alert({ variant = "error", message, children, className })` with
`variant: "error" | "warning" | "info" | "success"`. Renders `role="alert"` for
`error` only and `role="status"` otherwise; colors come from `--destructive` /
`--warning` / `--info` / `--success` tokens via `cva`
(`class-variance-authority` is already a dependency and is the established
variant pattern here). Returns `null` when there is no message and no children,
preserving `ServerError`'s current conditional-render behaviour. Icon per
variant, from `lucide-react`.

#### 2. ServerError alias

**File**: `src/components/auth/ServerError.tsx`

**Intent**: Let Phase 2 land without editing 15 call sites; Phase 3 removes this.

**Contract**: The component body is replaced by a delegation to
`<Alert variant="error" message={message} />`, keeping the exact same props
signature (`{ message?: string | null }`) and export name.

#### 3. Unified form field

**File**: `src/components/ui/form-field.tsx`

**Intent**: Collapse the two parallel field styles into one token-driven field so
the raw-literal `inputBase` disappears and every field gets the same a11y wiring.

**Contract**: Same public props as today's `FormField`
(`id, name, label, type, value, onChange, placeholder, error, hint, icon,
endContent`) so migration is import-only. Internally renders `<Input>` from
`ui/input.tsx` rather than a bare `<input>`, adds `aria-invalid={!!error}` and
`aria-describedby={error ? \`${id}-error\` : undefined}`, and gives the error `<p>`
that id. Label keeps `htmlFor={id}` and the input keeps `id`/`name` exactly as
today. `icon` requires left padding on the input — pass it through `Input`'s
existing `className` merge rather than modifying `Input`'s own contract.

#### 4. Toast store

**File**: `src/lib/toast-store.ts`

**Intent**: Carry a toast raised in one React island to the `Toaster` rendered in
another, which no context provider can do.

**Contract**: A `globalThis`-pinned singleton (created once, guarded against
re-creation on repeat hydration and against SSR access) exposing
`subscribe(listener) => unsubscribe`, `getSnapshot() => Toast[]`,
`toast({ variant, message })`, and `dismiss(id)`. Auto-dismiss after a timeout,
cleared on manual dismiss. Shape: `{ id, variant: "success" | "error" | "info", message }`.
This module must not import React.

#### 5. Toaster island

**File**: `src/components/ui/toaster.tsx`

**Intent**: Render the queue in a fixed overlay, announced politely.

**Contract**: Subscribes via `useSyncExternalStore(subscribe, getSnapshot, () => [])`
— the third argument is required or SSR will throw. Renders a fixed-position
container with `aria-live="polite"` and `aria-atomic="false"` that exists even
when empty (a live region added to the DOM at the same time as its content is not
reliably announced). Each toast is styled from the Phase 1 tokens and carries a
dismiss button with an accessible name.

#### 6. Tests

**File**: `src/components/ui/alert.test.tsx`, `src/components/ui/form-field.test.tsx`, `src/lib/toast-store.test.ts`

**Intent**: Lock the accessibility contract where it is cheapest to assert, since
the E2E suite covers none of it.

**Contract**: `Alert` — `role="alert"` on the error variant, `role="status"` on
the others, `null` render on empty message. `FormField` — `getByLabelText`
resolves the input, `aria-invalid` flips with `error`, `aria-describedby` points
at the rendered error text. `toast-store` — subscribe/notify, auto-dismiss,
manual dismiss, and that a second import of the module observes the same
singleton.

### Success Criteria:

#### Automated Verification:

- New and existing unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes, including `jsx-a11y` rules: `npm run lint`
- Existing E2E suite still green (nothing migrated yet): `npm run test:e2e`

#### Manual Verification:

- No visual change anywhere in the app yet, except `ServerError` now rendering in token colors

---

## Phase 3: Migration

### Overview

Move all call sites onto the new primitives and delete the old ones. Mechanical;
no behaviour change intended.

### Changes Required:

#### 1. Alert call sites

**File**: the 15 importers of `ServerError` — `auth/SignInForm.tsx`,
`auth/SignUpForm.tsx`, `admin/SecurityGroupList.tsx`, `admin/SecurityGroupDetail.tsx`,
`admin/UserSearchPicker.tsx`, `candidates/CandidateProfile.tsx`,
`candidates/CandidateList.tsx`, `recruitments/CreateRecruitmentForm.tsx`,
`recruitments/KanbanBoard.tsx`, `recruitments/StageEditor.tsx`,
`recruitments/AddCandidateDialog.tsx`, `recruitments/MoveCandidateDialog.tsx`,
`recruitments/CandidateDetail.tsx`, `recruitments/RecruitmentList.tsx`

**Intent**: Replace the alias with direct `Alert` use and pick the honest variant
per call site, so not-found and load-failure states stop announcing as errors.

**Contract**: Import `Alert` from `@/components/ui/alert`. Genuine mutation and
fetch failures keep `variant="error"`. Not-found states — notably
`SecurityGroupDetail.tsx:169` ("Security group could not be found.") — become
`variant="info"`. **Message strings change byte-for-byte nowhere**; the E2E suite
asserts on several of them via `getByText`.

#### 2. Delete ServerError

**File**: `src/components/auth/ServerError.tsx`

**Intent**: Remove the transitional alias once nothing imports it.

**Contract**: File deleted. `grep -r "ServerError" src/` must return no hits.

#### 3. FormField call sites

**File**: `auth/SignInForm.tsx`, `auth/SignUpForm.tsx`,
`recruitments/CreateRecruitmentForm.tsx`, `recruitments/StageEditor.tsx`,
`recruitments/AddCandidateDialog.tsx`, `candidates/CandidateProfile.tsx`,
`ui/textarea.tsx`, `ui/file-input.tsx`

**Intent**: Point every field at the unified primitive and remove the duplicate
styling layer.

**Contract**: Import path changes from `@/components/auth/FormField` to
`@/components/ui/form-field`; props are unchanged. `src/components/auth/FormField.tsx`
is deleted along with its `inputBase` literal string. `textarea.tsx` and
`file-input.tsx` reference `FormField` only in comments — update the comment
references, do not restructure those components.

#### 4. Ad-hoc field errors

**File**: `recruitments/CreateRecruitmentForm.tsx:192`, `admin/SecurityGroupList.tsx:45`

**Intent**: Fold the two hand-rolled `<p>` error renders for non-input fields
(checkbox group, inline name) into the shared presentation.

**Contract**: Replace the raw `<p>` with `<Alert variant="error">`, or with
`FormField`'s error slot where the field is an input. Keep the visible strings
identical.

#### 5. Mount the Toaster

**File**: `src/components/AppShell.astro`

**Intent**: Give every non-auth page exactly one toast overlay.

**Contract**: `<Toaster client:load />` rendered once inside the shell's root
`<div>`, outside `<main>`. Auth pages do not use `AppShell` and deliberately get
no `Toaster` (they keep the POST-and-redirect flow).

### Success Criteria:

#### Automated Verification:

- All unit tests pass, including the 10 existing component suites: `npm test`
- Full E2E suite passes with its 53 `getByLabel` locators unmodified: `npm run test:e2e`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- No stale references remain: `grep -r "ServerError\|auth/FormField" src/` returns nothing

#### Manual Verification:

- Sign-in and sign-up render correctly and still submit via full-page POST
- Every form field looks consistent across auth, recruitments, candidates, and admin, in both themes
- A deliberately failed mutation still shows its error inline in the same place as before
- The not-found security group reads as informational, not as a failure

---

## Phase 4: Confirmations and Cleanup

### Overview

Wire success toasts into the data-changing mutations and close out the banner and
duplicate-string cleanups.

### Changes Required:

#### 1. Success toasts

**File**: `recruitments/CreateRecruitmentForm.tsx`, `recruitments/StageEditor.tsx`
(2 sites), `recruitments/AddCandidateDialog.tsx`, `recruitments/MoveCandidateDialog.tsx`,
`recruitments/KanbanBoard.tsx` (status change), `candidates/CandidateProfile.tsx`
(profile edit, CV upload), `recruitments/CandidateDetail.tsx`,
`admin/SecurityGroupList.tsx`, `admin/SecurityGroupDetail.tsx` (rename,
operations, members)

**Intent**: Give each data-changing action a visible, specific confirmation
instead of a silent refetch.

**Contract**: Call `toast({ variant: "success", message })` in each success
handler — beside the existing `onChanged()` / `refetch()` call, not replacing it.
Messages name the action concretely ("Candidate added.", "Recruitment created.",
"Stages saved."), in English, sentence case. Do **not** toast from `useMutation`
itself, and do not toast for `ThemeToggle` or sidebar-collapse fetches.

#### 2. Shared error message

**File**: `src/components/hooks/useMutation.ts`, `src/components/admin/SecurityGroupDetail.tsx`

**Intent**: Stop four copies of the same literal from drifting apart.

**Contract**: `DEFAULT_ERROR_MESSAGE` becomes an exported const from
`useMutation.ts`; `SecurityGroupDetail.tsx` imports it and replaces all four
`"Something went wrong. Please try again."` literals. Behaviour and the visible
string are unchanged.

#### 3. Banner tokens

**File**: `src/components/Banner.astro`

**Intent**: Stop the config banner from being a light-mode insert that the theme
system cannot see.

**Contract**: The three `.banner--*` rules drop their hex literals and read the
Phase 1 tokens (`var(--info)`, `var(--warning)`, `var(--destructive)` and their
foregrounds). The existing `role="alert"`/`role="status"` logic is correct and
must be preserved as-is.

#### 4. Banner strings

**File**: `src/layouts/Layout.astro`

**Intent**: Remove the last Polish strings from the rendered UI, per the standing
English-only lesson.

**Contract**: Line 27 `<strong>Uwaga:</strong>` becomes `<strong>Note:</strong>`;
line 33's `"Dokumentacja"` fallback label becomes `"Documentation"`. Nothing else
in the layout changes.

### Success Criteria:

#### Automated Verification:

- All unit tests pass: `npm test`
- Full E2E suite passes: `npm run test:e2e`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- No Polish strings remain in rendered UI: `grep -rn "Uwaga\|Dokumentacja" src/` returns nothing

#### Manual Verification:

- Creating a recruitment, adding a candidate, and moving a candidate each show a success toast that auto-dismisses
- A toast fires correctly from a dialog that closes on success (proves the cross-island store works)
- Toasts are announced by a screen reader (VoiceOver) without stealing focus
- The config banner renders in token colors and reads correctly in both themes
- Toasts are legible in both light and dark themes

---

## Testing Strategy

### Unit Tests:

- `Alert`: role per variant, null render on empty message, variant class mapping
- `FormField`: `getByLabelText` resolution, `aria-invalid` toggling, `aria-describedby` → error text id
- `toast-store`: subscribe/notify, auto-dismiss timing, manual dismiss, singleton identity across imports
- `contrast`: the three new semantic pairs clear AA in both palettes
- The 10 existing component suites act as the regression net for the migration phase

### Integration Tests:

None new. The existing `src/pages/api/authorization.integration.test.ts` is
unaffected — this slice changes no API route or validation rule.

### Manual Testing Steps:

1. Sign in — verify the restyled fields, and that submitting still does a full-page POST
2. Submit sign-in with a bad password — verify the error renders through `Alert` with `role="alert"`
3. Create a recruitment — verify a success toast appears and auto-dismisses
4. Add a candidate from the kanban dialog — verify the toast fires even though the dialog closes
5. Open a non-existent security group — verify it reads as informational, not as an error
6. Toggle light/dark — verify fields, alerts, toasts, and the banner all follow the theme
7. Navigate with keyboard only through a form with an error — verify the error is associated and announced

## Performance Considerations

The `Toaster` adds one more `client:load` island to every non-auth page. It is
small and renders nothing when the queue is empty. If island count becomes a
concern later, `client:idle` is a safe downgrade — a toast can only be raised
after another island has hydrated and the user has acted.

## Migration Notes

No data migration. The `ServerError` → `Alert` alias in Phase 2 exists purely so
the primitive can land and be tested before 15 files change; it is deleted in
Phase 3 and must not survive into the final state.

## References

- Research: `context/changes/forms-feedback-redesign/research.md`
- Roadmap slice S-13: `context/foundation/roadmap.md`
- Token/contrast precedent: `context/changes/design-system-foundation/plan.md`
- Migration-discipline precedent: `context/changes/list-views-redesign/`
- Standing rules: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Semantic Tokens

#### Automated

- [x] 1.1 Unit tests pass, including new contrast assertions: `npm test` — 27ad6fd
- [x] 1.2 Type checking passes: `npm run typecheck` — 27ad6fd
- [x] 1.3 Linting passes: `npm run lint` — 27ad6fd

#### Manual

- [x] 1.4 `/dev/design-system` shows the three new swatches legibly in light and dark — 27ad6fd
- [x] 1.5 Toggling the theme changes all three; none stays fixed — 27ad6fd

### Phase 2: Primitives

#### Automated

- [x] 2.1 New and existing unit tests pass: `npm test` — 4fc639d
- [x] 2.2 Type checking passes: `npm run typecheck` — 4fc639d
- [x] 2.3 Linting passes, including `jsx-a11y` rules: `npm run lint` — 4fc639d
- [x] 2.4 Existing E2E suite still green: `npm run test:e2e` — 4fc639d

#### Manual

- [x] 2.5 No visual change anywhere yet, except `ServerError` in token colors — 4fc639d

### Phase 3: Migration

#### Automated

- [x] 3.1 All unit tests pass, including the 10 existing component suites: `npm test`
- [x] 3.2 Full E2E suite passes with its 53 `getByLabel` locators unmodified: `npm run test:e2e`
- [x] 3.3 Type checking passes: `npm run typecheck`
- [x] 3.4 Linting passes: `npm run lint`
- [x] 3.5 No stale references remain: `grep -r "ServerError\|auth/FormField" src/`

#### Manual

- [ ] 3.6 Sign-in and sign-up render correctly and still submit via full-page POST
- [ ] 3.7 Fields look consistent across auth, recruitments, candidates, admin, both themes
- [ ] 3.8 A failed mutation still shows its error inline in the same place as before
- [ ] 3.9 The not-found security group reads as informational, not as a failure

### Phase 4: Confirmations and Cleanup

#### Automated

- [ ] 4.1 All unit tests pass: `npm test`
- [ ] 4.2 Full E2E suite passes: `npm run test:e2e`
- [ ] 4.3 Type checking passes: `npm run typecheck`
- [ ] 4.4 Linting passes: `npm run lint`
- [ ] 4.5 No Polish strings remain: `grep -rn "Uwaga\|Dokumentacja" src/`

#### Manual

- [ ] 4.6 Create recruitment, add candidate, move candidate each show an auto-dismissing success toast
- [ ] 4.7 A toast fires correctly from a dialog that closes on success
- [ ] 4.8 Toasts are announced by a screen reader without stealing focus
- [ ] 4.9 The config banner renders in token colors in both themes
- [ ] 4.10 Toasts are legible in both light and dark themes
