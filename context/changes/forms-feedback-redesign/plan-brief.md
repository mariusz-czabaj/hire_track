# Forms, Error Messages, and Action Confirmations — Plan Brief

> Full plan: `context/changes/forms-feedback-redesign/plan.md`
> Research: `context/changes/forms-feedback-redesign/research.md`

## What & Why

The app has two parallel form-field styles, one overloaded error component doing
three different jobs without `role="alert"`, and no success confirmation at all —
a completed action just refetches a list silently. S-13 gives forms, errors, and
confirmations one consistent, accessible treatment.

## Starting Point

14 hand-rolled form surfaces sit on a shared `useMutation` hook, but the
presentation layer above them is split: auth-era `FormField` (raw literals like
`bg-white/10`, `focus:ring-purple-400`) is imported by 8 files, while
`ui/input.tsx` is token-driven but has no label, icon, or error slot.
`ServerError` — a plain `<p>` in raw reds, no ARIA role — is imported by 15 files
and renders server errors, load failures, and not-found states alike. No toast
infrastructure exists, and no `--success`/`--warning`/`--info` tokens exist.

## Desired End State

Every field renders through one `ui/form-field.tsx` that wraps the token-driven
`Input`, with consistent `label`/`htmlFor`, `aria-invalid`, and `aria-describedby`.
Every message renders through one `ui/alert.tsx` that announces assertively only
when something actually failed. Every data-changing mutation raises a toast naming
what happened, announced politely. The config banner is token-styled and English.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Confirmation mechanism | Hand-rolled global toast | Only a global overlay can confirm actions in dialogs that close on success, and hand-rolling matches how every other `ui/` primitive was built — no new dependency. | Plan |
| Field consolidation | `FormField` wraps `Input` | Preserves the `htmlFor` bindings 53 `getByLabel` locators depend on while killing the duplicate `inputBase`; keeps `Input`'s shadcn upgrade path intact. | Plan |
| Error component | One `Alert` with variants | Lets not-found stop announcing as an error, and a transitional `ServerError` alias keeps the 15-file blast radius out of the phase that builds it. | Plan |
| Token scope | `success` + `warning` + `info` | Covers the toast, all three banner variants, and the alert variants in one contrast-validated pass, following the `--stage-*` precedent. | Plan |
| Auth forms | Restyle only, keep POST | The E2E sign-in fixture underpins every other spec; rewriting the auth entry point risks the whole suite for a cosmetic gain. | Plan |
| Toast triggers | Data-changing mutations only | Per-call-site wiring lets each message name what happened, and keeps toasts off incidental fetches like the theme toggle. | Plan |
| Test approach | RTL unit tests for new primitives | The E2E suite asserts nothing on error markup today, so the a11y contract is cheapest and most durable to lock at the unit level. | Research |
| Adjacent cleanups | Banner + shared error string only | Both are one-line fixes the roadmap already assigned here; the `SecurityGroupDetail` hook refactor and `SubmitButton` reuse are deferred. | Plan |

## Scope

**In scope:** three semantic token pairs; `ui/alert.tsx`; `ui/form-field.tsx`;
toast store + `Toaster` island; migration of 15 `Alert` and 8 `FormField` call
sites; success toasts on ~12 mutations; `Banner.astro` tokens; Polish strings in
`Layout.astro`; exported `DEFAULT_ERROR_MESSAGE`.

**Out of scope:** converting auth forms to fetch; refactoring `SecurityGroupDetail`
onto `useMutation`; generalising `SubmitButton`; a separate `EmptyState` component;
`react-hook-form` or any new runtime dependency; toasting errors; `bg-cosmic`
cleanup outside touched files.

## Architecture / Approach

Tokens first (`global.css` × 3 theme blocks + `@theme` map, mirrored in
`design-tokens.ts`, contrast-asserted). Then three primitives built in isolation
behind a `ServerError` alias. Then a mechanical migration of ~23 call sites and
deletion of the old components. Then toast wiring and cleanup. The toast store is
a `globalThis`-pinned singleton read via `useSyncExternalStore` — necessary
because each page mounts 5–6 *independent* React islands, so a context provider
could never carry a toast from a page island to the `Toaster` in `AppShell`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Semantic tokens | `--success`/`--warning`/`--info`, contrast-validated | Token values live in 4 places with no automated sync check; missing one block ships a theme-blind color |
| 2. Primitives | `Alert`, `FormField`, toast store + `Toaster`, with tests | Cross-island toast delivery — a context-based store fails silently from topbar islands |
| 3. Migration | 23 call sites moved; old components deleted | 53 `getByLabel` locators and several `getByText` error strings must survive byte-for-byte |
| 4. Confirmations & cleanup | Success toasts, banner tokens, English strings | Toast wording drift across ~12 hand-edited call sites |

**Prerequisites:** F-02 (`design-system-foundation`) — done. Vitest + RTL and the
Playwright suite are already in place; no new tooling needed.
**Estimated effort:** ~4 sessions, one per phase; Phase 3 is the largest diff
(~23 files) but is mechanical.

## Open Risks & Assumptions

- The `globalThis`-pinned toast singleton is assumed to survive Astro's per-island
  hydration. If it does not, the fallback is a `window` `CustomEvent` bus — same
  public API, different transport. Phase 2's store test should assert singleton
  identity to catch this early.
- `ServerError`'s strings are assumed to be asserted only via `getByText` in E2E,
  never via structure. Verified by grep; Phase 3 keeps every message byte-identical
  regardless.
- `design-tokens.ts` and `global.css` stay hand-synced (F-02 impl-review finding
  F3). The Phase 1 contrast test is the only guard; an automated sync check
  remains out of scope.

## Success Criteria (Summary)

- A user filling any form — auth, recruitment, dialog, admin — sees the same field
  treatment, and a field error is announced and programmatically associated.
- A successful create, edit, move, or upload produces a visible, specific
  confirmation instead of a silent list refresh.
- Nothing in the UI reaches past the token layer for color, and no Polish strings
  remain; both themes pass AA on every new surface.
