# Recruitment Edit Details — Plan Brief

> Full plan: `context/changes/recruitment-edit-details/plan.md`
> Research: `context/changes/recruitment-edit-details/research.md`

## What & Why

Recruitment details are currently write-once: a recruiter sets title, department, location, employment type and opened date at creation and can never change them again. A typo in a job title, a department reorg, or a corrected opening date all require creating a new recruitment. This slice (roadmap **S-15 / MS-10**) makes those five fields editable from the recruitment's own detail page.

## Starting Point

`PATCH /api/recruitments/[id]` exists but accepts only `{ status }`. The page header is static Astro markup with no action menu — S-09 explicitly cut the "…" menu from its own scope, so S-15 inherits building it. `dropdown-menu.tsx` is installed and token-styled but has zero consumers anywhere in the codebase. Validation for these five fields already lives in two places (the POST route schema and a hand-rolled `validate()` in the create form) with no length bounds in either.

## Desired End State

A recruiter opens a recruitment, clicks "…" in the header, and picks **Edit details**. A dialog opens pre-filled with current values; saving persists the change, toasts, and repaints the header's title and metadata row in place with no page reload. A caller without `recruitment.write` gets a real 403; one who cannot see the recruitment at all gets a 404.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Write path | SECURITY DEFINER RPC `update_recruitment` | A plain `.update()` blocked by RLS yields zero rows, so it cannot tell "forbidden" from "missing" — the RPC gives a true 403 like the create/stages precedent. | Plan |
| 404 vs 403 ordering | Check read access before write access | Checking existence first would let a caller probe for recruitments they cannot see. | Plan |
| Security groups | Out of scope | Roadmap flagged self-lockout as an open unknown; deferring keeps the slice to RLS-covered scalar fields with no migration risk. | Plan |
| Entry point | "…" dropdown with a single item | Matches S-15's stated entry point and gives S-09's deferred menu a home later slices can extend. | Plan |
| Field semantics | Title required; other four clearable to null | Honours what the schema actually says (only `title` is NOT NULL) and lets a recruiter fix a wrongly-entered field. | Plan |
| Payload shape | Full replace of all five fields | Avoids the "absent means unchanged vs. clear" ambiguity entirely. | Plan |
| Concurrency | Last write wins | Two recruiters editing one recruitment's metadata in the same minute is vanishingly rare in an internal tool. | Plan |
| Validation | One shared module, with new bounds | The roadmap explicitly warns against two divergent rule sets for the same fields. | Research |
| Audit history | None | No schema precedent, no PRD requirement, and `updated_at` is already trigger-maintained. | Plan |
| Live header update | New `recruitment-details-changed` window event | Mirrors the existing `recruitment-status-events.ts` pattern built for exactly this cross-island problem. | Research |

## Scope

**In scope:** shared validation module with length/date bounds (applied to create and edit); `update_recruitment` RPC migration; `updateRecruitmentDetails` service function; two-branch PATCH handler with error-code mapping; `RecruitmentHeader` island absorbing `RecruitmentStatusBadge`; "…" dropdown; `EditRecruitmentDialog`; unit, integration, component and E2E tests; accessibility follow-through.

**Out of scope:** security-group reassignment; edit history/audit trail; concurrency detection; moving `StatusControl` or `StageEditor` into the header menu; any change to the existing status-only PATCH contract; a `ui/select` primitive.

## Architecture / Approach

Bottom-up, so each phase leaves something verifiable. Validation is extracted *first* — doing it after writing the edit schema would leave exactly the divergent rules the roadmap warns about. Then the RPC (real 403), then the route as a two-branch handler (status → existing plain-update path, untouched; details → new RPC path), then the UI against a working contract.

The one structural change: today's `<h1>` and metadata row are static Astro and cannot repaint, so they become a single `RecruitmentHeader` island that also absorbs `RecruitmentStatusBadge` (keeping its status-event listener) and hosts the menu. The dialog notifies it via a new window `CustomEvent`, mirroring the existing status event.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared validation, RPC, service | One validation module used by create + edit, `update_recruitment` RPC, service fn + unit tests | Touches the shipped create path — a regression there surfaces here |
| 2. PATCH endpoint extension | Details branch with 403/404/422 mapping, integration tests | Must leave the status contract and its assertions byte-identical |
| 3. Header island, menu, dialog | `RecruitmentHeader`, "…" menu, `EditRecruitmentDialog`, details event | Header stops being server-rendered HTML; `client:load` hydration race can flake E2E |
| 4. E2E + accessibility | Edit-flow spec, axe scan, contrast measurement | Dropdown + dialog are both new focus-management surfaces |

**Prerequisites:** S-09 (`recruitment-header-metadata`) is done — the header already carries the four metadata fields. Local Supabase running (`npx supabase start`) for the migration and integration tests.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- `Astro.locals.operations` is the **global union** across the user's groups, not recruitment-scoped — so `canEdit` can show the menu on a recruitment the user cannot actually write, producing a 403 on save. The server stays authoritative; this is accepted as a UI hint, not a gate.
- The two PATCH branches will disagree on failure semantics: details returns 403/404 correctly, status keeps its existing 404-on-forbidden. Deliberate, to protect the shipped contract — worth revisiting when status eventually moves into the header menu.
- Converting the header to a `client:load` island subjects its assertions to the hydration race already documented in `tests/e2e/support/auth.ts`; the E2E spec uses the same `toPass` retry wrapper.
- New length bounds (title 200, department/location 120) are a judgement call, not a product requirement; existing over-length rows stay readable and only fail on re-save.

## Success Criteria (Summary)

- A recruiter can correct any of the five details from the recruitment page and see the header update immediately, with the change surviving a reload.
- An optional field can be cleared back to empty and disappears from the metadata row.
- A user without write access never sees the menu, and is refused with a 403 if they call the API directly.
