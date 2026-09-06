---
date: 2026-09-06T14:10:00+02:00
researcher: Mariusz Czabaj
git_commit: d66b5e9049fdf14c25a2653059405fcd12e5cf5d
branch: main
repository: hire_track
topic: "forms-feedback-redesign (S-13): consistent form fields, error messages, and action confirmations"
tags: [research, codebase, forms, validation, accessibility, design-tokens, ServerError, FormField, useMutation]
status: complete
last_updated: 2026-09-06
last_updated_by: Mariusz Czabaj
---

# Research: Forms, error messages, and action confirmations (S-13)

**Date**: 2026-09-06T14:10:00+02:00
**Researcher**: Mariusz Czabaj
**Git Commit**: d66b5e9049fdf14c25a2653059405fcd12e5cf5d
**Branch**: main
**Repository**: hire_track

## Research Question

What is the current state of forms, validation, and user feedback (errors,
confirmations) across the app, and what does it take to give it one consistent,
accessible treatment — per roadmap slice S-13 ("Formularze, komunikaty błędów i
potwierdzenia akcji")?

## Summary

The app has **14 forms/form-like surfaces**, all hand-rolled (no `react-hook-form`,
no central schema directory) on top of one shared mutation hook, but the
presentation layer that surrounds them is genuinely split in two:

1. **Auth forms** (`SignInForm`, `SignUpForm`) use a bespoke `FormField` component
   with its own non-token-based `inputBase` styling, native HTML form POST +
   full-page redirect, and client-side-only validation.
2. **Every other form** (recruitments, candidates, admin) uses the stock
   `ui/input.tsx`/`ui/textarea.tsx` shadcn primitives, controlled React state, the
   shared `useMutation` hook, and server-side (zod) validation as the source of
   truth — client-side checks, where present, are UX-only duplicates of server
   rules.

Both worlds converge on exactly **one error-display component**, `ServerError`,
used app-wide for genuine server errors, resource-load failures, and even
not-found states — and it has no `role="alert"`. There is **no toast/notification
system at all**: success today is communicated only by a silent list refetch.
`Banner.astro` (the config-error banner) already has correct ARIA roles but
carries Polish strings and raw hex colors, in violation of both the design-token
rule and the English-only rule in `context/foundation/lessons.md`.

The roadmap (`context/foundation/roadmap.md:171-182`) already scopes this exact
work as **S-13**, prerequisite F-02 (`design-system-foundation`) is done, and it
explicitly defers one decision to `/10x-plan`: **toast vs. inline confirmation**.
It also calls out the two biggest risks: touching `ServerError` touches every
screen at once (E2E regression risk), and consolidating `FormField` into
`ui/input.tsx` must preserve the leading icon, password-visibility toggle, and
`label`/`htmlFor` binding that 37 `getByLabel` E2E locators depend on.

## Detailed Findings

### Form inventory (14 surfaces)

No `react-hook-form` anywhere; the consistent pattern is plain `useState` +
a hand-rolled `validate()` function, paired with the shared `useMutation` hook
that POSTs/PATCHes/PUTs/DELETEs JSON and surfaces `fieldErrors` from the API's
zod `safeParse` failures. All server-side validation is zod, defined locally per
API route file (`find -iname "*schema*"` in `src/` returns nothing — no shared
schema directory).

| # | Form | Location | Astro/React | State pattern | Zod schema | Validation |
|---|------|----------|-------------|----------------|------------|------------|
| 1 | Sign in | [SignInForm.tsx:43](src/components/auth/SignInForm.tsx) | Astro wraps React | useState + manual validate | none | client only |
| 2 | Sign up | [SignUpForm.tsx:66](src/components/auth/SignUpForm.tsx) | Astro wraps React | useState + manual validate | none | client only |
| 3 | Sign out | [UserMenu.tsx:28](src/components/UserMenu.tsx) | pure React | none (empty form) | none | n/a |
| 4 | Create security group | [SecurityGroupList.tsx:35](src/components/admin/SecurityGroupList.tsx) | Astro wraps React | useState + useMutation | [security-groups.ts:11](src/pages/api/security-groups.ts) | server only |
| 5 | Rename security group | [SecurityGroupDetail.tsx:178](src/components/admin/SecurityGroupDetail.tsx) | Astro wraps React | useState + manual fetch (bypasses useMutation) | [security-groups/\[id\].ts:13](src/pages/api/security-groups/%5Bid%5D.ts) | server only |
| 6 | Group operations/members | SecurityGroupDetail.tsx:76,117 | Astro wraps React | useState toggles | operations.ts:14, members.ts:13 | server only |
| 7 | Create recruitment | [CreateRecruitmentForm.tsx:86](src/components/recruitments/CreateRecruitmentForm.tsx) | Astro wraps React | useState + manual validate + useMutation | recruitments/index.ts:12 | client + server |
| 8 | Edit kanban stages | [StageEditor.tsx](src/components/recruitments/StageEditor.tsx) (dialog) | pure React | useState rows + manual validateRows | stages.ts:11 | client + server |
| 9 | Add candidate | [AddCandidateDialog.tsx](src/components/recruitments/AddCandidateDialog.tsx) (dialog) | pure React | useState + manual validate | candidates/index.ts:12 | client + server |
| 10 | Move candidate | [MoveCandidateDialog.tsx](src/components/recruitments/MoveCandidateDialog.tsx) (dialog) | pure React | useState, no client validate | candidates/\[candidateId\]/index.ts:12 | server only |
| 11 | Edit candidate profile | [CandidateProfile.tsx:200](src/components/candidates/CandidateProfile.tsx) | Astro wraps React | useState inline edit | candidates/\[candidateId\]/index.ts:12 | server only |
| 12 | CV upload | CandidateProfile.tsx:65 + [useCvUpload.ts](src/components/hooks/useCvUpload.ts) | Astro wraps React | file picker + hook | upload-intent.ts:22, confirm.ts:12 | server only |
| 13 | Candidate search | [CandidateList.tsx](src/components/candidates/CandidateList.tsx) | Astro wraps React | debounced useState | candidates/index.ts:10 | server only |
| 14 | User search | [UserSearchPicker.tsx](src/components/admin/UserSearchPicker.tsx) | pure React | debounced useState | admin/users.ts:33 | server only |

Notable details:

- Auth forms (#1, #2) are the only ones that are **genuine uncontrolled HTML
  `<form method="POST">` submits** — real browser navigation/reload on submit,
  not a fetch call. Server errors come back via a redirect with `?error=` query
  param, decoded into a `serverError` prop.
- [StageEditor.tsx:36-38](src/components/recruitments/StageEditor.tsx) documents in
  a code comment that its client-side "candidates exist" lock is UX-only, not
  authoritative — the server re-validates and enforces the real rule. This
  matches the project-wide convention that write affordances are always
  rendered and denial is surfaced as a message, never hidden client-side.
- No `dashboard.astro` page exists (removed in `app-shell-navigation`, S-08).
- Simple toggles (`ThemeToggle`, sidebar collapse) are plain `fetch` calls with
  tiny zod schemas, not form submissions — out of scope for form-field styling
  but in scope for "confirmation" semantics if a toast system is introduced.

### Feedback / error-display inventory

- **No toast library installed.** No `sonner`, `react-hot-toast`, or shadcn
  toast component; no dependency in `package.json`; no `<Toaster />` mounted
  anywhere. Confirmed independently by two agents via `grep -rl
  "sonner\|useToast\|toast("` returning zero hits.
- **`src/components/ui/*` inventory**: `button.tsx`, `card.tsx`, `badge.tsx`,
  `dialog.tsx`, `dropdown-menu.tsx`, `input.tsx`, `textarea.tsx`,
  `file-input.tsx`, `skeleton.tsx`, `LibBadge.astro`. No `alert.tsx`, no
  `form.tsx`, no `label.tsx`, no toast/sonner primitive.
- **[`ServerError.tsx:7-16`](src/components/auth/ServerError.tsx)** is the
  single error/alert surface for the entire app: a plain `<p>` with raw color
  literals (`border-red-500/30`, `bg-red-900/30`, `text-red-300`), a
  `CircleAlert` icon, **no `role="alert"`**. Used for genuine server errors, for
  generic "resource failed to load" states, and even for not-found states
  (`SecurityGroupDetail.tsx:169` renders "Security group could not be found."
  through it) — three semantically different conditions through one component.
- **[`FormField.tsx:22-68`](src/components/auth/FormField.tsx)** is a bespoke
  labeled-input component with inline error text (own `CircleAlert` + red text)
  that has become the de-facto app-wide form field despite living under
  `auth/` — imported by `CreateRecruitmentForm`, `CandidateDetail`,
  `AddCandidateDialog`, `CandidateProfile`, `MoveCandidateDialog`,
  `StageEditor`. Its `inputBase` string uses raw literals
  (`bg-white/10`, `text-white`, `focus:ring-purple-400`), parallel to and
  inconsistent with the token-driven `ui/input.tsx`.
- **[`useMutation.ts`](src/components/hooks/useMutation.ts)** (74 lines) is the
  dominant fetch/mutation hook: exposes `status: "idle"|"loading"|"success"|"error"`,
  `error: string | null`, `fieldErrors: Record<string,string>`; redirects to
  `/auth/signin` on HTTP 401.
- **[`useApiResource.ts`](src/components/hooks/useApiResource.ts)** is the
  GET-only counterpart, giving every screen `loading | success | error |
  not-found` plus `refetch()`; also redirects on 401.
- **[`useCvUpload.ts`](src/components/hooks/useCvUpload.ts)** duplicates the
  same status/error/fieldErrors shape independently rather than composing
  `useMutation`.
- **[`SubmitButton.tsx:11-33`](src/components/auth/SubmitButton.tsx)** —
  spinner + disabled state tied to React 19's `useFormStatus()`, used only by
  the two auth forms. Every other form reimplements the same spinner markup
  manually against a `useMutation`-derived boolean instead of reusing it.
- **Inconsistencies found** (feedback agent, cross-checked against roadmap):
  1. Field-error rendering exists in three different shapes: `FormField`'s
     built-in error prop, a raw hand-rolled `<p>` for non-input fields
     (`CreateRecruitmentForm.tsx:192`, `SecurityGroupList.tsx:45`).
  2. `SecurityGroupDetail.tsx` bypasses `useMutation` entirely — three separate
     manual `useState`/fetch/try-catch blocks (`renameError`, `operationError`,
     `memberError`) each repeating the literal string `"Something went wrong.
     Please try again."` instead of the shared `DEFAULT_ERROR_MESSAGE` constant
     pattern used elsewhere.
  3. Two parallel "session expired" UX flows: API-route auth pages redirect
     with `?error=`, while every client hook does a bare
     `window.location.assign("/auth/signin")` on 401 — they never converge.
  4. No `console.log`/`alert()` fallbacks were found anywhere — every consumer
     at least routes errors into `ServerError`/inline text.

### Success confirmation today

There is no confirmation UI at all. Success is communicated only by
`onChanged` → `resource.refetch()` silently updating the underlying list/data —
per `ui-redesign-foundation/research.md:183-185`, explicitly named a redesign
opportunity, not a defect to preserve.

### Design tokens (`src/styles/global.css`, 262 lines)

- Three-state theme model: base `:root` (light default), `@media
  (prefers-color-scheme: dark)` scoped under `:root:not(.light)`, and a `.dark`
  class block — all three must be kept in sync for any new token; this is a
  hard rule reinforced by `context/foundation/lessons.md` and by
  `app-shell-navigation/plan-brief.md:103`.
- Existing token families: core (`--background`, `--foreground`, `--card`,
  `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`,
  `--destructive`, `--border`, `--input`, `--ring`, `--radius`), `--sidebar-*`,
  a purpose-built `--stage-1..6` cyclic hue family for kanban stages (added in
  `kanban-visual-redesign`, S-10) — **the pattern to imitate** if a toast/
  confirmation system needs new semantic hues.
- **No `--success`, `--warning`, or `--info` tokens exist** — only
  `--destructive`. Any toast/inline-confirmation styling needs new tokens added
  to *both* light and dark blocks.
- `src/lib/contrast.ts` + `src/lib/design-tokens.ts` (a manually-synced JS
  mirror of the CSS tokens — flagged by
  `design-system-foundation/reviews/impl-review.md` finding F3 as having no
  automated sync check) plus the dev-only `/dev/design-system` route are the
  established tools for validating any new token's contrast before it's
  consumed — S-10 set the precedent of measuring contrast *before* UI consumes
  a new hue, after `design-system-foundation`'s plan review (F4) forced that
  sequencing as a lesson.

### `Banner.astro`

[`src/components/Banner.astro:15-42`](src/components/Banner.astro) renders the
config-error banner atop every page. It already sets `role="alert"`/
`role="status"` correctly — the model to follow for ARIA semantics — but uses
light-mode literal hex colors (`#dbeafe`, `#fef3c7`, `#fee2e2`) on a
permanently-dark app and contains **Polish strings** ("Uwaga:",
"Dokumentacja"), a direct violation of the English-only rule. Both are
explicitly assigned to this slice by the roadmap.

## Code References

- [src/components/auth/FormField.tsx:22-68](src/components/auth/FormField.tsx) — bespoke labeled-input, non-token `inputBase`, leading icon + password toggle
- [src/components/auth/ServerError.tsx:7-16](src/components/auth/ServerError.tsx) — sole error/alert surface app-wide, no `role="alert"`
- [src/components/auth/SubmitButton.tsx:11-33](src/components/auth/SubmitButton.tsx) — spinner/disabled tied to `useFormStatus`, unused outside auth
- [src/components/hooks/useMutation.ts](src/components/hooks/useMutation.ts) — shared mutation hook (`status`, `error`, `fieldErrors`), 401 redirect
- [src/components/hooks/useApiResource.ts](src/components/hooks/useApiResource.ts) — shared GET hook (`loading|success|error|not-found`)
- [src/components/hooks/useCvUpload.ts](src/components/hooks/useCvUpload.ts) — independent status/error/fieldErrors reimplementation
- [src/components/admin/SecurityGroupDetail.tsx:22-27,39-44,58-156,178-251](src/components/admin/SecurityGroupDetail.tsx) — bypasses `useMutation`, 3 manual error states
- [src/components/recruitments/CreateRecruitmentForm.tsx:86,192,197-209](src/components/recruitments/CreateRecruitmentForm.tsx) — reference "most complete" form; raw `<p>` for checkbox-group error; hand-rolled spinner
- [src/components/recruitments/StageEditor.tsx:30-98](src/components/recruitments/StageEditor.tsx) — client validation documented as UX-only, server authoritative
- [src/components/Banner.astro:15-42](src/components/Banner.astro) — correct ARIA roles, wrong colors + Polish strings
- [src/styles/global.css](src/styles/global.css) — token definitions, three-state theme blocks, `--stage-*` precedent, no `--success/--warning/--info`
- [src/lib/design-tokens.ts](src/lib/design-tokens.ts) / [src/lib/contrast.ts](src/lib/contrast.ts) — manually-synced token mirror + contrast tooling
- [src/pages/auth/signin.astro:5,16](src/pages/auth/signin.astro), [src/pages/api/auth/signin.ts:11,16](src/pages/api/auth/signin.ts) — redirect-with-query-param error flow
- [src/components/ui/input.tsx](src/components/ui/input.tsx), [src/components/ui/textarea.tsx](src/components/ui/textarea.tsx) — token-driven stock primitives used by non-auth forms

## Architecture Insights

- **Validation is server/RLS-authoritative everywhere.** Client-side `validate()`
  functions, where present, always mirror server zod rules for UX speed, never
  gate anything the server doesn't also enforce. This is an established,
  cross-change convention (`recruiter-manages-candidate-status/research.md:72`,
  citing `recruiter-creates-recruitment/reviews/impl-review.md` finding F7) —
  any new client-side validation added during this redesign should follow the
  same rule: presentation only, never authoritative.
- **`useMutation`'s `fieldErrors` map is the wire contract** field-level errors
  travel on. A redesign of error display should build on top of this contract
  rather than inventing a new one.
- **Semantic color mapping precedent exists**: `src/lib/recruitment-status.ts:16-24`
  and `src/lib/stage-palette.ts` map a domain value to a token-based color. If
  a toast/confirmation system needs a variant→color mapping (info/success/
  error/warning), this is the pattern to imitate.
- **`AppShell` slots** (`nav`, `topbar-leading`, `topbar-actions`, `page-title`,
  `page-actions`, default) are the only sanctioned page-chrome mechanism — a
  global toast container, if chosen, likely belongs as a fixed/portal element
  hooked near the shell rather than per-page markup, consistent with how
  `ThemeToggle`/`UserMenu` were added as small islands.
- **E2E locator coupling is a real constraint**: 54× `getByText`, 44×
  `getByRole`, 37× `getByLabel`, 16× `getByTestId` across `tests/e2e/`. Any
  change to `ServerError`'s copy/structure or to `FormField`'s
  `label`/`htmlFor` binding must be paired with the corresponding test updates
  in the same change — this is precisely why the roadmap calls `ServerError`
  the single riskiest touch-point in the app.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:171-182` — S-13 slice definition (already
  quoted in Summary above): outcome, prerequisites (F-02, done), the
  toast-vs-inline confirmation decision explicitly deferred to `/10x-plan`, and
  the two named risks (`ServerError` blast radius, `FormField`/`Input`
  consolidation preserving E2E locators). Roadmap also flags `Banner.astro`'s
  Polish strings as "to fix in this slice."
- `context/changes/ui-redesign-foundation/design-brief.md` — items E4
  (`FormField` → drop own `inputBase`, adopt `ui/input.tsx`), E5 (`ServerError`
  → `destructive` token + `role="alert"`), E6 (`Banner.astro` token/language
  fix), E8 (success confirmations — today only a silent refetch), F4 (live
  regions for async results absent), G4 (toast mechanism listed among
  primitives still to install for milestone MS-07/M-2).
- `context/changes/ui-redesign-foundation/research.md:183-185,195-196,217-223` —
  confirms no toast system exists, confirms absent live regions, and gives the
  E2E locator-count breakdown used above.
- `context/changes/recruiter-creates-recruitment/plan-brief.md:23,50,58` —
  established precedent: extend bespoke `FormField` rather than switch to
  stock `Input` mid-implementation; `ApiErrorBody.fields` keyed by dotted path
  for nested field errors (e.g. `stages.1.name`).
- `context/changes/list-views-redesign/*` — precedent for migration discipline
  applicable here: preserve E2E-guarded strings/`data-testid`s byte-for-byte,
  audit test coverage of a surface *before* restyling it (their admin screen
  had zero tests before its redesign — same audit should be done for
  `ServerError`/`FormField` consumers here), and prefer a narrow styling-helper
  extraction over a broad unifying component when call sites genuinely differ
  in behavior (their `statusPillClasses()` helper) — directly analogous to the
  `FormField`/`Input` consolidation choice this slice faces.
- `context/changes/design-system-foundation/plan.md` — Phase 1
  tokens-before-consumption sequencing (reinforced by that change's plan
  review, finding F4, which forced contrast measurement to happen before any
  UI consumes a new hue) and the note that `file-input.tsx`'s hardcoded
  "cosmic" classes are deferred to this slice.
- `context/changes/design-system-foundation/reviews/impl-review.md` — finding
  F3: `design-tokens.ts` and `global.css` are manually synced with no
  automated check; relevant if this slice adds `--success`/`--warning`/`--info`
  tokens.
- `context/foundation/lessons.md` — two binding, directly relevant rules:
  English-only for all artifacts (violated today by `Banner.astro`), and
  colors only through design tokens, explicitly scoped to include S-13.

## Related Research

- `context/changes/ui-redesign-foundation/research.md` and
  `design-brief.md` — parent design-system research this slice's item list is
  drawn from.
- `context/changes/design-system-foundation/research.md` and `plan.md` —
  token-layer foundation this slice builds on.
- `context/changes/list-views-redesign/research.md` — nearest sibling
  migration-discipline precedent (styling consolidation without regressing
  E2E-guarded structure).

## Open Questions

1. **Toast vs. inline confirmation** — unresolved by design; roadmap defers
   this to `/10x-plan`. Given no toast infra exists at all (no dependency, no
   `Toaster`, no portal), this is a green-field choice for the plan phase.
2. **Which literal strings need a11y/English-only fixes beyond `Banner.astro`** —
   worth a targeted grep during planning (`"Something went wrong"` literal in
   `SecurityGroupDetail.tsx` recurs 4× and should probably become a shared
   constant regardless of the toast decision).
3. **Whether `SecurityGroupDetail.tsx`'s bypass of `useMutation` should be
   fixed as part of this slice or a separate follow-up** — it's a pure
   internal-consistency issue, not directly an error/feedback-presentation
   issue, but it duplicates exactly the string/behavior this slice is trying
   to unify.
4. **New token names for success/warning/info** (if toast path is chosen) —
   need naming + contrast validation via `/dev/design-system` before
   consumption, per the S-10 precedent.
