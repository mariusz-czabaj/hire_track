# Recruitment List & Candidate Kanban Board (S-01) — Plan Brief

> Full plan: `context/changes/recruiter-views-kanban-board/plan.md`
> Research: `context/changes/recruiter-views-kanban-board/research.md`

## What & Why

Deliver the roadmap's north star: a recruiter signs in, sees a status-filterable list of recruitments, and opens one as a read-only kanban board of candidates grouped by stage, with a per-column count and the date added on each card. This is the smallest end-to-end slice that proves the product replaces the spreadsheets recruiters use today (US-01, FR-003, FR-004 default stages only, FR-005, FR-010).

## Starting Point

F-01 landed a complete, RLS-enforced schema plus seed data — and **no application code touches it**. There is not a single `.from()` call in `src/`. The app is an Astro 6 SSR skeleton with working email/password auth, one layout, one protected page, and `button.tsx` as the only shadcn component. Five conventions CLAUDE.md describes as established do not exist yet: `src/types.ts`, generated `Database` types, `src/lib/services/`, zod, and any test framework.

## Desired End State

`/recruitments` lists recruitments with Draft/Live/Closed/All filtering and a candidate count per row; `/recruitments/<id>` renders a kanban board with one column per default stage, counts in the headers, and a card per candidate showing name and date added. A Hiring Manager sees the identical read-only views; an Administrator (no `recruitment.read`) sees an empty list; unauthenticated visitors are redirected, and unauthenticated API calls get 401 JSON. Unit and E2E suites run in CI.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Status filter semantics | Three filters (Draft/Live/Closed) + All | FR-003's two buckets don't map onto three stored values; keeps drafts reachable for S-02 | Plan |
| List row contents | Title, dept, location, status, opened date, candidate count | The count makes the list scannable and is cheap given the existing index | Plan |
| Data access shape | JSON endpoints + client-side fetch | Establishes the API contract S-04's mutations need | Plan |
| Polish stage names | Rename to English via migration in this slice | Required by the new `lessons.md` rule; safe now — data only, nothing references the names | Plan |
| Routing & protection | `/recruitments` pages; `/api` guarded centrally with 401 JSON | Closes a blanket hole for all six later slices rather than per endpoint | Plan |
| Error contract | Bare payload on success; `{ error: { code, message } }` + real status codes | No envelope unwrapping on every read; machine-readable codes | Plan |
| Forbidden vs missing | 404 for both | RLS hides them identically; distinguishing them would need an RLS-bypass credential and would leak existence | Plan |
| Theming | Activate `.dark` on `<html>` | One line makes the existing shadcn token set match the established dark glassmorphism | Plan |
| Testing | Vitest (services) + Playwright (E2E), plus CI branch fix | Locks in logic six slices reuse and verifies US-01's actual acceptance criteria | Plan |
| Typed DB access | Generate and commit `Database` types first | `strictTypeChecked` makes `no-unsafe-*` fire on every untyped query field — a blocker, not a preference | Research |
| Stage source | Always read `kanban_stages`, never hardcode | Keeps S-03's per-recruitment override a pure insert | Research |
| `RecruitmentStatus` type | Hand-written zod enum, parsed at the service boundary | Verified: the generator emits `status: string` because the column is text+CHECK, not an enum — it cannot be derived | Plan review |
| Island fetch state | Shared `useApiResource` hook in `src/components/hooks/` | One home for the `res.ok` branch, error parse and 401-redirect across two islands and four later slices | Plan review |
| Candidate count query | Single query via PostgREST embedded aggregate | Verified working and RLS-scoped; prevents a per-row N+1 the plan would otherwise invite | Plan review |

## Scope

**In scope:** English stage rename migration; generated DB types + typed client; `src/types.ts` DTOs; zod; `/api` auth gating; error-contract helpers; recruitments service layer; two GET endpoints; `.dark` activation + four shadcn components; list page and island with filtering; board page and island; Vitest service tests; Playwright E2E; CI typecheck/test/e2e steps and branch-filter fix.

**Out of scope:** drag-and-drop and any stage mutation (S-04); per-recruitment stage customization (S-03); recruitment create/edit (S-02); candidate profile and CV upload (S-05); candidate search (S-06); admin group UI (S-07); notes; any delete affordance; Realtime; 403 handling; translating the existing Polish `context/**` docs.

## Architecture / Approach

Typed path first, then endpoints, then UI. Generated `Database` types unblock everything else. Astro pages are thin protected shells that pass URL state to a single `client:load` React island — the one hydration pattern already in the repo. Islands fetch from `/api/recruitments` and `/api/recruitments/[id]/board`; those endpoints validate input with zod, delegate queries and row-to-DTO mapping to `src/lib/services/recruitments.ts`, and return bare payloads or coded errors.

Authorization stays in the database: endpoints run as the signed-in user via the anon key plus session cookie, and RLS does the scoping. The middleware `/api` guard is authentication only. Board columns are driven by the ordered stage list, not by the candidate rows, so empty stages still render.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data & type foundation | English stages, generated types, DTOs, zod, typecheck + CI fix | Generated types drifting from migrations; committed output must stay in sync |
| 2. API endpoints & service layer | `/api` gating, error helpers, two GET endpoints | The `/api` guard must not break `/api/auth/*`, and must return JSON not a redirect |
| 3. Vitest & service tests | Unit coverage of mapping and grouping | `strictTypeChecked` fighting test stubs; resist disabling rules repo-wide |
| 4. UI foundation & list | `.dark`, shadcn primitives, filterable list | `.dark` activation changing existing pages' appearance |
| 5. Kanban board view | The north-star board screen | Empty `Rejected` column silently omitted if grouping is candidate-driven |
| 6. Playwright E2E | Role-based end-to-end coverage | Provisioning Supabase in CI; documented fallback if unreliable |

**Prerequisites:** F-01 migrations applied (done); local Supabase running (confirmed, CLI v2.98.2); seed data loaded, providing `hr.test@`, `hiring-manager.test@` and `admin.test@` (all `password123`).
**Estimated effort:** ~4-6 sessions across 6 phases. Phases 1-2 are foundation-heavy; 4-5 are the visible feature; 3 and 6 add the two test frameworks.

## Open Risks & Assumptions

- **The `<2s` NFR has no load target** — roadmap open questions on QPS and data volume are unanswered, so it is verified at seed scale only. `recruitments` has no index beyond its PK; `(status, opened_at desc)` is the obvious first move if the list slows.
- **Client-side fetch adds a round-trip after hydration**, so perceived load is hydration + fetch rather than one server render. Accepted to establish the API contract early; skeletons cover the gap.
- **A user with `recruitment.read` but not `candidate.read`** sees correct counts but no candidate names — `candidates` SELECT is org-wide, not recruitment-scoped. Handled by omitting unnamed cards rather than rendering blanks.
- **A recruiter genuinely lacking group access sees "not found"** with no hint to request access. Revisit when S-07 makes such guidance actionable.
- **Provisioning Supabase for Playwright in CI may prove unreliable**; the fallback is a documented condition on the CI job, never deleting the specs.
- Firefox and Edge coverage (NFR line 118) stays manual — CI runs Chromium only.

## Success Criteria (Summary)

- A recruiter can sign in, filter recruitments by status, open one, and see candidates grouped into ordered stage columns with counts and dates added — including a visibly empty `Rejected` column.
- A Hiring Manager sees the same board read-only; an Administrator sees an empty list; signed-out access is refused at both the page and API layers.
- `lint`, `typecheck`, `test` and `test:e2e` all pass, and CI actually runs them on `main`.
