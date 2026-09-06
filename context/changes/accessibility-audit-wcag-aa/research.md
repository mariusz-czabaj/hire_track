---
date: 2026-09-06T00:00:00+02:00
researcher: Claude (10x-research)
git_commit: b302468783f09a212502612341b66c6768a8e1ef
branch: main
repository: hire_track
topic: "Accessibility audit against WCAG 2.1 AA (full sweep)"
tags: [research, codebase, accessibility, wcag, forms, kanban, dialogs, contrast, aria]
status: complete
last_updated: 2026-09-06
last_updated_by: Claude (10x-research)
---

# Research: Accessibility audit against WCAG 2.1 AA (full sweep)

**Date**: 2026-09-06
**Researcher**: Claude (10x-research)
**Git Commit**: b302468783f09a212502612341b66c6768a8e1ef
**Branch**: main
**Repository**: hire_track (mariusz-czabaj/hire_track)

## Research Question

What is the codebase's current accessibility posture against WCAG 2.1 AA, swept
across the full app — forms, navigation/dialogs/keyboard, color contrast, and
semantics/ARIA/images?

## Summary

The app is meaningfully better than a typical unaudited codebase: it already has
a skip link, Radix-based dialogs with correct focus trap/restore, a working
`KeyboardSensor` for dnd-kit kanban drag-and-drop with live-region announcements,
consistent `:focus-visible` rings, a shared `FormField` primitive with proper
`aria-invalid`/`aria-describedby` wiring, and a partial design-token contrast
checker (`src/lib/contrast.ts` + `/dev/design-system`). The recent commit
`b302468` ("stop portal keydown bubbling into dnd-kit") is a correct, legitimate
accessibility fix.

Real gaps cluster into four areas, ranked by blast radius:

1. **Forms (serious, systemic)** — no field is ever marked `required`/`aria-required`
   (`noValidate` used everywhere with no ARIA substitute), and no form moves
   focus to the first invalid field or an error summary on failed submit. Two
   shared primitives (`Textarea`, `FileInput`) don't wire `aria-invalid`/
   `aria-describedby` the way `FormField` does, silently breaking screen-reader
   error announcement wherever they're used.
2. **Color contrast (serious, systemic)** — `text-destructive` used directly as
   error-message text color fails AA in dark mode (3.57:1, needs 4.5:1), and
   this specific pair isn't even in the checker's own `tokenPairs` list, so the
   dev tool reports "all green" while a real failure exists. Several auth pages
   still use raw Tailwind literals (undocumented by the token system, matching
   the known lesson in `context/foundation/lessons.md:12-17`).
3. **Kanban drag-and-drop semantics (serious, systemic)** — every card nests a
   real `<a>` and `<Button>` inside a `role="button"` draggable `<div>`
   (WCAG 4.1.2), a structural ARIA violation even though the keyboard/announcement
   behavior itself is correct.
4. **Language of parts (serious, systemic in reach, conditional in trigger)** —
   a hardcoded Polish string in `src/lib/config-status.ts` renders inside the
   shared `Layout.astro` banner on every page whenever Supabase env vars are
   missing, with no `lang="pl"` tag, violating WCAG 3.1.2.

Everything else audited (page titles, `<html lang>`, landmarks, heading order,
skip link, focus-visible styling, live-region toasts, icon-button labeling,
image alt text, div+onClick anti-patterns, keyboard dnd-kit sensor, dialog
focus trap/restore) passed with no material findings.

## Detailed Findings

### 1. Forms and inputs

- **No `required`/`aria-required` anywhere** — every form uses `<form noValidate>`
  and hand-rolled JS validation; the underlying `required` HTML attribute or
  `aria-required` ARIA attribute is never set. WCAG 3.3.2. Serious, systemic.
  - [src/components/ui/form-field.tsx:40-52](src/components/ui/form-field.tsx#L40-L52) — shared primitive never receives/forwards `required`.
  - [src/components/auth/SignInForm.tsx:43](src/components/auth/SignInForm.tsx#L43), [SignUpForm.tsx:66](src/components/auth/SignUpForm.tsx#L66) — `noValidate` forms.
  - [src/components/recruitments/CreateRecruitmentForm.tsx:88](src/components/recruitments/CreateRecruitmentForm.tsx#L88) — same pattern; required fields (`title`, `department`, `location`, `openedAt`, `groupIds`, validated at [lines 38-42](src/components/recruitments/CreateRecruitmentForm.tsx#L38-L42)) are invisible as "required" until submit fails.
- **No focus management on validation failure** — no `.focus()`/`autoFocus` call anywhere in the form-submit paths; error state is set but focus never moves to the first invalid field or a summary. WCAG 3.3.1 / 2.4.3. Serious, systemic.
  - [SignInForm.tsx:36-40](src/components/auth/SignInForm.tsx#L36-L40), [SignUpForm.tsx:51-55](src/components/auth/SignUpForm.tsx#L51-L55), [CreateRecruitmentForm.tsx:70-83](src/components/recruitments/CreateRecruitmentForm.tsx#L70-L83), [StageEditor.tsx:92-99](src/components/recruitments/StageEditor.tsx#L92-L99), [AddCandidateDialog.tsx:54-60](src/components/recruitments/AddCandidateDialog.tsx#L54-L60).
- **`Textarea`/`FileInput` don't wire ARIA error association** the way `FormField` does — visually identical error text, but not programmatically linked. WCAG 1.3.1 / 3.3.1. Serious, systemic (2 shared components, several consumers).
  - [src/components/ui/textarea.tsx:23-42](src/components/ui/textarea.tsx#L23-L42) — used by [MoveCandidateDialog.tsx:108-115](src/components/recruitments/MoveCandidateDialog.tsx#L108-L115), `CandidateDetail.tsx` `NoteCard` (lines 86-92).
  - [src/components/ui/file-input.tsx:21-43](src/components/ui/file-input.tsx#L21-L43) — used by `CandidateProfile.tsx`'s `CvPanel` (lines 130-139).
- **No `<fieldset>`/`<legend>` for checkbox groups** — individually labeled checkboxes but no group semantics. WCAG 1.3.1. Minor, systemic.
  - [CreateRecruitmentForm.tsx:161-195](src/components/recruitments/CreateRecruitmentForm.tsx#L161-L195) (security groups), [SecurityGroupDetail.tsx:206-221](src/components/admin/SecurityGroupDetail.tsx#L206-L221) (operations).
- **Unlabeled rename input** — no `id`, `<label>`, `aria-label`, or even placeholder. WCAG 3.3.2 / 4.1.2. Serious, isolated.
  - [SecurityGroupDetail.tsx:184-194](src/components/admin/SecurityGroupDetail.tsx#L184-L194).
- **Placeholder-only search input** (contrast with `CandidateList.tsx`'s correctly labeled search box). WCAG 3.3.2 / 1.3.1. Serious, isolated.
  - [UserSearchPicker.tsx:81-89](src/components/admin/UserSearchPicker.tsx#L81-L89).
- No shared `useForm`/validation hook exists (`src/components/hooks/*` has `useApiResource`, `useCvUpload`, `useDebouncedValue`, `useMutation` — none centralize field-level validation). Remediation for `required`/focus-to-error must touch ~6 duplicated `validate()`/`handleSubmit` functions individually, unless a shared hook is introduced; the ARIA-wiring fixes (F3) and `required` pass-through (F1) *can* be fixed centrally in `FormField`/`Textarea`/`FileInput`/`Input`.

### 2. Navigation, dialogs, keyboard, focus

- **Interactive elements nested inside a `role="button"` draggable card** — dnd-kit's `useDraggable` attributes give the card `role="button"`/`tabIndex=0`, but it wraps a real `<a>` and `<Button>`. WCAG 4.1.2. Serious, systemic (every kanban card).
  - [KanbanBoard.tsx:85-103](src/components/recruitments/KanbanBoard.tsx#L85-L103) (`DraggableCard`), used at [lines 312-357](src/components/recruitments/KanbanBoard.tsx#L312-L357).
- **Keyboard drag-and-drop — correct.** `KeyboardSensor` registered alongside `PointerSensor` with `activationConstraint`, plus custom `Announcements` wired via `accessibility={{ announcements }}`. WCAG 2.1.1 / 4.1.3 satisfied.
  - [KanbanBoard.tsx:164-167](src/components/recruitments/KanbanBoard.tsx#L164-L167), [lines 219-244, 280](src/components/recruitments/KanbanBoard.tsx#L219-L244).
- **Dialog focus trap/restore — correct via Radix** across `ui/dialog.tsx`, `StageEditor.tsx`, `MoveCandidateDialog.tsx`, `MobileNav.tsx`, `AddCandidateDialog`. Minor stylistic inconsistency: `MoveCandidateDialog.tsx:154-166` triggers via plain `onClick` instead of `DialogTrigger asChild` — works correctly, not a bug.
- **`b302468` fix is correct and scoped** — [ui/dialog.tsx:55-63](src/components/ui/dialog.tsx#L55-L63) stops React-synthetic-event bubbling from a portaled dialog's `<Textarea>` back up to the kanban `KeyboardSensor` ancestor, correctly restoring keyboard operability of dialog textareas (WCAG 2.1.1). Side effect: every dialog's keydown events now stop propagating past `DialogContent`, which is harmless today (Radix's own Escape/Tab handling fires first) but would silently block a future app-wide keyboard shortcut. Minor, systemic, worth a code comment if global shortcuts are ever added.
- **Skip link present and correct** — [AppShell.astro:24-29](src/components/AppShell.astro#L24-L29) → `#main-content` at [line 44](src/components/AppShell.astro#L44). WCAG 2.4.1 pass.
- **Landmarks present** — `<nav aria-label="Primary">`, `<header>`, `<main id="main-content">` in [AppShell.astro:31,35,43](src/components/AppShell.astro#L31-L43); kanban columns use `role="region" aria-labelledby`. Pass.
- **Heading hierarchy logical**, no skipped levels found across audited pages. Pass.
- **Focus-visible styling consistent** — every `outline-none` usage pairs with a `focus-visible:ring-*`/`focus:ring-*` replacement (`ui/button.tsx:8`, `ui/input.tsx:11`, `ui/textarea.tsx:33`, `ui/file-input.tsx:34`). Pass.
- **Toast live region correct** — [ui/toaster.tsx:22](src/components/ui/toaster.tsx#L22) `aria-live="polite" aria-atomic="false"`. Pass (see also §4 for a politeness-level nuance on error toasts).

### 3. Color contrast and design tokens

- **`src/lib/contrast.ts`** only parses `oklch()` strings (OKLab math → WCAG luminance/ratio), exposes `WCAG_AA_NORMAL_TEXT = 4.5` / `WCAG_AA_LARGE_TEXT = 3` / `meetsAA()`. It cannot evaluate hex/rgb/hsl at all, so raw Tailwind literals are invisible to it by construction.
  - [src/lib/contrast.ts](src/lib/contrast.ts)
- **`text-destructive` used as error text fails AA in dark mode**: `oklch(0.55 0.22 25)` on `--background: oklch(0.16 0.01 275)` = **3.57:1** (needs 4.5:1). This exact pair is not in `tokenPairs`, so `/dev/design-system` reports all-green while a real failure exists. WCAG 1.4.3. Serious, systemic (dark-mode error text across `FormField`, `FileInput`, `Textarea`, `CreateRecruitmentForm`).
  - [src/components/ui/form-field.tsx:56](src/components/ui/form-field.tsx#L56), [src/lib/design-tokens.ts](src/lib/design-tokens.ts) (`tokenPairs` array — omits destructive-as-text, muted-foreground/muted, border/input at 3:1, primary-as-link-text).
- **Raw Tailwind literals still present** on auth pages and two components, matching the documented lesson (`context/foundation/lessons.md:12-17`) — smaller footprint than the lesson's original "~250/~35 files" estimate but still real:
  - [src/pages/auth/signup.astro:9-18](src/pages/auth/signup.astro#L9-L18), [signin.astro](src/pages/auth/signin.astro) same pattern, [confirm-email.astro:22-31](src/pages/auth/confirm-email.astro#L22-L31) — `bg-cosmic`, `text-white`, `text-blue-100/60`, `text-purple-300`, gradients. Currently pass AA by accident (~5.97:1) but unmeasured/unenforced.
  - [src/components/auth/SubmitButton.tsx:18](src/components/auth/SubmitButton.tsx#L18) — `bg-purple-600`/`text-white`, 5.38:1, passes but fragile.
  - [src/components/auth/SignUpForm.tsx:59](src/components/auth/SignUpForm.tsx#L59) — `text-blue-100/50` hint text.
  - [src/components/ui/LibBadge.astro:10,12](src/components/ui/LibBadge.astro#L10-L12) — `text-blue-200`/`text-purple-200` on assumed-dark backgrounds; if composited on a light surface computes to **1.91:1 / 1.07:1** (blocker-grade). Currently dead code (no imports found anywhere) — isolated/latent risk, flag for removal or fix before reuse.
- **No color-only information found** — kanban stages and form errors both pair color with text/icon. WCAG 1.4.1 pass.
  - [KanbanBoard.tsx:283-304](src/components/recruitments/KanbanBoard.tsx#L283-L304), [form-field.tsx:49-59](src/components/ui/form-field.tsx#L49-L59).

### 4. Semantics, ARIA, images

- **`<html lang="en">` set correctly and consistently** — single layout file. Pass.
  - [src/layouts/Layout.astro:15](src/layouts/Layout.astro#L15).
- **Every page has a unique, descriptive `<title>`.** Pass.
- **No bare `<img>` tags anywhere**; all icon-only buttons across the app have correct `aria-label`s (`MobileNav`, `SidebarToggle`, `UserMenu`, `StageEditor` row actions, `CandidateProfile` edit, `MoveCandidateDialog` trigger, `CandidateDetail` note edit); decorative icons correctly `aria-hidden`. Pass, systemic.
- **No ARIA misuse found** — no redundant `role="button"` on native buttons, `Banner.astro`/`alert.tsx` use correct `role="alert"`/`role="status"`, kanban's dnd-kit-provided ARIA is non-redundant. Pass.
- **Hardcoded Polish string in shared layout banner, no `lang="pl"` tag** — renders on every page when Supabase env vars are missing. WCAG 3.1.2. Serious, systemic in reach (all pages via shared `Layout.astro`), conditional trigger (only fires in misconfigured-env states).
  - [src/lib/config-status.ts:15,17](src/lib/config-status.ts#L15-L17), rendered via [src/layouts/Layout.astro:24-38](src/layouts/Layout.astro#L24-L38).
- **Error toasts use `aria-live="polite"` rather than `assertive`** — not a strict 4.1.3 violation (programmatic exposure exists) but a UX-parity gap for urgent failures. Minor, systemic.
  - [src/components/ui/toaster.tsx:6-16,22-24](src/components/ui/toaster.tsx#L6-L24).
- **Dev-only design-system tables missing `scope`/`caption`** — minor, isolated (not part of the recruiter-facing app).
  - [src/pages/dev/design-system.astro:288-290,309-311](src/pages/dev/design-system.astro#L288-L311).
- **No div/span+onClick anti-pattern found anywhere** — every clickable surface is a real `<a>` or `<button>`. Pass, systemic.

## Code References

- `src/components/ui/form-field.tsx:40-59` - shared form-field primitive; correct ARIA wiring pattern to replicate, but no `required` pass-through and `text-destructive` fails AA in dark mode
- `src/components/ui/textarea.tsx:23-42` - missing `aria-invalid`/`aria-describedby`
- `src/components/ui/file-input.tsx:21-43` - missing `aria-invalid`/`aria-describedby`
- `src/components/auth/SignInForm.tsx:36-43` - `noValidate`, no focus-to-error
- `src/components/auth/SignUpForm.tsx:51-66` - `noValidate`, no focus-to-error
- `src/components/recruitments/CreateRecruitmentForm.tsx:38-44,70-99,161-195` - required-field validation, no focus-to-error, checkbox group missing fieldset
- `src/components/admin/SecurityGroupDetail.tsx:184-194,206-221` - unlabeled rename input, checkbox group missing fieldset
- `src/components/admin/UserSearchPicker.tsx:81-89` - placeholder-only search input
- `src/components/recruitments/KanbanBoard.tsx:85-103,164-167,219-244,283-357` - draggable card ARIA nesting issue, correct keyboard sensor + announcements, correct color+text stage rendering
- `src/components/ui/dialog.tsx:55-63` - the `b302468` keydown-propagation fix
- `src/components/AppShell.astro:24-44` - skip link + landmarks, correct
- `src/lib/contrast.ts` - oklch-only contrast checker
- `src/lib/design-tokens.ts` - `tokenPairs` list, incomplete coverage
- `src/components/ui/form-field.tsx:56` - `text-destructive` dark-mode contrast failure
- `src/pages/auth/signup.astro:9-18`, `src/pages/auth/signin.astro`, `src/pages/auth/confirm-email.astro:22-31` - raw Tailwind literals
- `src/components/ui/LibBadge.astro:10,12` - dead-code component with latent blocker-grade contrast bug
- `src/lib/config-status.ts:15,17` + `src/layouts/Layout.astro:24-38` - hardcoded Polish banner string, no `lang="pl"`
- `src/components/ui/toaster.tsx:6-24` - live region present, politeness-level nuance on error toasts

## Architecture Insights

- The codebase already has the *right shape* for a systemic remediation: a shared `FormField` primitive, a shared `ui/dialog.tsx`, a design-token layer with a partial contrast checker, and a single `Layout.astro`. Most of the serious findings above can be fixed in one place each rather than per-screen, because the anti-pattern (or the correct pattern) lives in a shared component:
  - `required`/`aria-required` pass-through → fix in `FormField`, `Input`, `Textarea`, `FileInput` once.
  - ARIA error association → fix in `Textarea`/`FileInput` to match `FormField`'s existing pattern.
  - `text-destructive` dark-mode contrast → fix the token value once in `global.css`, and close the `tokenPairs` coverage gap once in `design-tokens.ts`.
  - Kanban card nesting → fix in `DraggableCard` once (e.g., separate a drag-handle region from the card's interactive content).
  - Polish banner string → fix in `config-status.ts` once (translate, since Layout.astro is shared by every page).
- The one place remediation is *not* centralizable: focus-to-first-error on submit, because there is no shared `useForm`/validation hook — each of ~6 forms hand-rolls its own `validate()`/`handleSubmit`. Introducing a shared validation hook would both fix this and prevent the duplication from continuing to grow.
- The `/dev/design-system` contrast page is honest about its own limits (it explicitly documents that `Textarea`/`FileInput` predate token migration and can't be measured), but it does not flag that its `tokenPairs` list is itself incomplete — this is a blind spot worth closing so the tool doesn't give false confidence.

## Historical Context (from prior changes)

- `context/foundation/lessons.md:12-17` ("Colors only through design tokens, never raw Tailwind palette literals") directly predicts and explains most of the §3 contrast findings — the raw-literal auth pages and `LibBadge.astro` are exactly the class of issue this lesson describes, though the lesson notes it applies to slices S-08 through S-13 going forward and is "not retroactive to code not yet touched."
- `context/changes/design-system-foundation/` (F-02) introduced the token system and the `/dev/design-system` contrast page consumed in this audit, but per its own `change.md`, F-02 "provides tools only — it does not restyle any product screen," which is consistent with why the auth pages (predating/outside F-02's scope) still carry raw literals.
- Commit `b302468` ("fix: stop portal keydown bubbling into dnd-kit, guard stale refresh token") is the most recent accessibility-adjacent change in the repo; confirmed correct and scoped in §2 above.

## Related Research

None found — this is the first accessibility-focused research document in `context/changes/**` or `context/archive/**`.

## Open Questions

- Should the focus-to-first-error remediation be done via a new shared `useForm` hook, or patched into each of the ~6 existing `validate()`/`handleSubmit` functions individually?
- Is `LibBadge.astro` intended for future reuse, or should it be deleted as dead code (it has no current imports)?
- Should error toasts move to `aria-live="assertive"`/`role="alert"` per-toast, or is `polite` intentional to avoid interrupting users mid-task?
- Does the Supabase-unconfigured banner (`config-status.ts`) ever actually reach production, or is it a dev/staging-only state? This affects whether the Polish-string fix is urgent or low-priority.
- Should this audit be followed by `/10x-plan` to sequence remediation (token/contrast fixes first since they're pure CSS, then shared-component ARIA fixes, then the kanban card restructure, then the validation-hook introduction)?
