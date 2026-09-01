---
date: 2026-09-01T08:45:30Z
researcher: Mariusz Czabaj
git_commit: dd758605bae3a9a9e1206500c0171beee7ed5341
branch: main
repository: mariusz-czabaj/hire_track
topic: "S-01 — Rekruter przegląda listę rekrutacji i otwiera rekrutację jako kanban kandydatów"
tags: [research, codebase, kanban, recruitments, astro, supabase, rls, s-01]
status: complete
last_updated: 2026-09-01
last_updated_by: Mariusz Czabaj
---

# Research: S-01 — recruitment list + candidate kanban board

**Date**: 2026-09-01T08:45:30Z
**Researcher**: Mariusz Czabaj
**Git Commit**: `dd758605bae3a9a9e1206500c0171beee7ed5341`
**Branch**: `main` (pushed — permalink base `https://github.com/mariusz-czabaj/hire_track/blob/dd75860/`)
**Repository**: `mariusz-czabaj/hire_track`

## Research Question

What evidence does the codebase provide for planning roadmap slice **S-01 `recruiter-views-kanban-board`** — a recruiter logs in, sees a status-filterable list of recruitments, and opens one as a kanban board of candidates grouped by stage, with per-column counts and a date-added on each card? PRD refs: US-01, FR-003, FR-004 (default stage set only), FR-005, FR-010.

## Summary

**S-01 is greenfield UI on a finished data layer.** F-01 landed a complete, RLS-enforced schema plus working seed data; there is no application code touching it. Not a single `.from()` call exists in `src/`.

Five findings dominate planning:

1. **The data layer is ready and indexed for exactly this query.** `candidate_recruitments` has indexes on `recruitment_id` and `current_stage_id` added specifically for the kanban's access pattern, and seed data includes a live recruitment with 5 candidates across 5 of 6 default stages plus one deliberately empty column.
2. **Generated Supabase `Database` types are a hard prerequisite, not a nicety.** `createServerClient` is called untyped ([src/lib/supabase.ts:9](src/lib/supabase.ts:9)) while ESLint runs `tseslint.configs.strictTypeChecked` ([eslint.config.js:15](eslint.config.js:15)). Every field access on an untyped query result trips `no-unsafe-member-access`/`-assignment`. Typed query code is effectively unwritable until types are generated.
3. **S-01 is read-only.** Moving candidates is FR-008/FR-009 → S-04. Confirmed three ways: the PRD never mentions drag-and-drop in US-01/FR-005/FR-010; the roadmap assigns the move to S-04; and F-01 deliberately ships **no** write policy or write grant on `kanban_stages` and no notes table, so a drag has no server contract to call.
4. **Five conventions CLAUDE.md describes as established do not exist**: `src/types.ts`, generated DB types, `src/lib/services/`, zod (not even a dependency), and any JSON API/response envelope. S-01 will be *defining* these, not following them.
5. **Two product gaps need a decision, not a citation**: the list view's column set is entirely unspecified anywhere, and FR-003's two-bucket filter (`otwarte/zamknięte`) does not map onto the three stored status values (`draft`/`live`/`closed`).

A secondary but visible risk: the existing pages are hand-styled dark glassmorphism, while shadcn/ui is configured for light-mode tokens and nothing ever sets `.dark`. A `Card`-based board dropped onto `bg-cosmic` will look wrong without a deliberate decision.

## Detailed Findings

### 1. Product contract (PRD)

The kanban half is fully specified; the list half is thin.

**US-01** ([context/foundation/prd.md:52-62](context/foundation/prd.md:52)) — given a logged-in recruiter, opening a recruitment shows "tablicę kanban z kandydatami pogrupowanymi po etapach, z licznikiem per kolumna i datą aplikacji na każdej karcie". Its three acceptance criteria: group by current stage, per-column counter, date added on each card.

- **FR-003** ([prd.md:83](context/foundation/prd.md:83)): list of recruitments with status filtering "(otwarte/zamknięte)". must-have.
- **FR-005** ([prd.md:86](context/foundation/prd.md:86)): open a recruitment, see candidates on a kanban with a per-column counter. must-have.
- **FR-010** ([prd.md:95](context/foundation/prd.md:95)): candidate card shows the date added to the recruitment. must-have.
- **FR-004** ([prd.md:84](context/foundation/prd.md:84)) is narrowed for S-01 to *default stage set only* ([roadmap.md:95](context/foundation/roadmap.md:95)); per-recruitment override is S-03.

**NFRs that bind S-01** ([prd.md:114-118](context/foundation/prd.md:114)): list and kanban views load in under 2 seconds; no candidate data reachable by an unauthenticated or unauthorized user; last two major versions of Chrome, Firefox, Edge. The CV-retention NFR is S-05's.

**Guardrail that binds S-01** ([prd.md:46](context/foundation/prd.md:46)): candidate data available only to logged-in organization users. The other two guardrails (CV reliability, reversible status change) belong to S-05/S-04.

**Non-goals touching this slice** ([prd.md:145-151](context/foundation/prd.md:145)): no public job-posting page (so no unauthenticated view), no offline support (no optimistic cache requirement), single-tenant (no tenant filter in queries).

**Access control** ([prd.md:127-143](context/foundation/prd.md:127)): email+password auth; RBAC where an operation is available if the user belongs to a group holding it. Example groups are explicitly *configuration, not schema*: HR/Rekruter (full management), Hiring Manager (read-only status view + candidate search), Administrator (groups and users). Unauthenticated → redirect to login.

Two documentation slips worth not propagating:
- US-01's Then clause says "datą aplikacji" ([prd.md:56](context/foundation/prd.md:56)) while its own acceptance criterion and FR-010 say "datą dodania do rekrutacji" ([prd.md:62](context/foundation/prd.md:62), [prd.md:95](context/foundation/prd.md:95)). The schema column is `added_at`. **"Data dodania" is canonical.**
- The PRD has no section literally titled "Poza zakresem"; the roadmap's references point at `## Non-Goals` ([prd.md:145](context/foundation/prd.md:145)).

### 2. F-01 delivered schema — what S-01 queries

All 7 migrations applied; all PKs are `bigint generated always as identity`. Nine tables, RLS enabled on all of them.

**`recruitments`** ([supabase/migrations/20260831182957_recruitment_candidate_schema.sql:13-23](supabase/migrations/20260831182957_recruitment_candidate_schema.sql:13))
`id`, `title` NOT NULL, `location`, `department`, `employment_type` (all nullable text), `opened_at` **date** (not timestamptz), `status text not null default 'draft' check (status in ('draft','live','closed'))`, `created_at`, `updated_at` (+ BEFORE UPDATE trigger). **No index beyond the PK. No `created_by`/owner column.** The full FR-001 metadata set already exists, so the list view has every field it could want even though S-02 owns the create form.

**`kanban_stages`** ([...schema.sql:37-49](supabase/migrations/20260831182957_recruitment_candidate_schema.sql:37))
`id`, `recruitment_id` **nullable** (FK → recruitments, ON DELETE CASCADE), `name`, `sort_order int`, `created_at`. Two partial unique indexes separate the default set from per-recruitment sets.

- **`recruitment_id IS NULL` = the global default stage set**, inserted by the migration itself as real product config ([...schema.sql:54-60](supabase/migrations/20260831182957_recruitment_candidate_schema.sql:54)): `Nowy`(1), `Screening`(2), `Rozmowa`(3), `Oferta`(4), `Zatrudniony`(5), `Odrzucony`(6).
- The per-recruitment override slot exists but is **unusable from the app**: no INSERT/UPDATE/DELETE policy and no write grant — `authenticated` has `select` only ([20260831183457_rls_policies.sql:163-173](supabase/migrations/20260831183457_rls_policies.sql:163), grants at [:241](supabase/migrations/20260831183457_rls_policies.sql:241)). Deferred to S-03.
- Board columns for S-01 therefore come from `where recruitment_id is null order by sort_order`. Nothing in the DB coalesces override rows over defaults — if you want override-aware behavior you write it yourself. Per F-01's rationale ([plan-brief.md:22](context/changes/core-recruitment-data-foundation/plan-brief.md:22)), stages must be read from the table, never hardcoded, so S-03 stays a pure insert.

**`candidate_recruitments`** ([...schema.sql:79-92](supabase/migrations/20260831182957_recruitment_candidate_schema.sql:79))
`id`, `candidate_id` NOT NULL, `recruitment_id` NOT NULL, `current_stage_id` **NOT NULL** (FK → kanban_stages, ON DELETE RESTRICT), `added_at timestamptz default now()`, `unique (candidate_id, recruitment_id)`. Indexes on `recruitment_id` and `current_stage_id`, added because "the kanban board's primary query pattern is 'all candidates for a recruitment'" ([...schema.sql:88-92](supabase/migrations/20260831182957_recruitment_candidate_schema.sql:88)).

Note: **there is no `status` column here.** Candidate status *is* `current_stage_id`. And `added_at` is FR-010's date. No `updated_at`, no notes, no CV columns.

**`candidates`** ([...schema.sql:62-77](supabase/migrations/20260831182957_recruitment_candidate_schema.sql:62))
`id`, `full_name` NOT NULL, `email` NOT NULL, `phone`, timestamps. Case-insensitive unique index on `lower(email)`; GIN trigram index on `full_name` (for S-06). Card display name is `full_name`.

**`candidate_recruitment_status_history`** ([...schema.sql:94-105](supabase/migrations/20260831182957_recruitment_candidate_schema.sql:94)) — append-only (`select, insert` grants only, no UPDATE/DELETE policy). **Nothing auto-populates it; there is no trigger.** Not S-01's concern (read-only slice), but S-04 must insert alongside every stage change.

**Security tables**: `security_groups`, `group_memberships`, `group_operations` ([20260831181826_security_rbac_schema.sql:18-41](supabase/migrations/20260831181826_security_rbac_schema.sql:18)) and the `recruitment_security_groups` visibility join ([...schema.sql:25-35](supabase/migrations/20260831182957_recruitment_candidate_schema.sql:25)). The `operation` enum is a fixed 5-value catalog ([...rbac_schema.sql:10-16](supabase/migrations/20260831181826_security_rbac_schema.sql:10)): `recruitment.read`, `recruitment.write`, `candidate.read`, `candidate.write`, `group.manage`.

**Recruitment status is plain text + CHECK, not an enum**, with lowercase values. The PRD's capitalized `Draft / Live / Closed` labels are a UI mapping concern.

### 3. RLS — what filtering S-01 gets for free, and one asymmetry

Two `stable security definer` helpers with `set search_path = ''` ([20260831195143_mark_rls_helpers_stable.sql:5-36](supabase/migrations/20260831195143_mark_rls_helpers_stable.sql:5)):
- `private.has_operation(operation)` — does the user belong to *any* group holding this operation?
- `private.has_recruitment_operation(recruitment_id, operation)` — is the operation granted on **the same group** assigned to that recruitment?

Policies relevant to S-01 (all `to authenticated`; `anon` has nothing):

| Table | SELECT USING | ref |
|---|---|---|
| `recruitments` | `has_recruitment_operation(id, 'recruitment.read')` | [rls_policies.sql:133](supabase/migrations/20260831183457_rls_policies.sql:133) |
| `candidate_recruitments` | `has_recruitment_operation(recruitment_id, 'recruitment.read')` | [:194](supabase/migrations/20260831183457_rls_policies.sql:194) |
| `kanban_stages` | `recruitment_id is null or has_recruitment_operation(recruitment_id, 'recruitment.read')` | [:168](supabase/migrations/20260831183457_rls_policies.sql:168) |
| `candidates` | `has_operation('candidate.read')` — **org-wide, NOT recruitment-scoped** | [:179](supabase/migrations/20260831183457_rls_policies.sql:179) |

Three consequences for the plan:

- **A board query needs two operations**, not one: `recruitment.read` on that recruitment (for the link rows) *and* org-wide `candidate.read` (for names). A user with only `recruitment.read` sees the columns and counts but no candidate identities. The board's row set is bounded by `candidate_recruitments`, not by `candidates` ([plan.md:22](context/changes/core-recruitment-data-foundation/plan.md:22)).
- **RLS makes an unauthorized recruitment indistinguishable from a missing one** — the query returns zero rows, not an error. S-01 must decide deliberately what a recruiter sees when opening an id they cannot access (404 page is the honest answer; a 403 would leak existence).
- **Read-only for Hiring Manager is already enforced in Postgres**, not in the UI ([plan-brief.md:15](context/changes/core-recruitment-data-foundation/plan-brief.md:15)), verified by [supabase/tests/rls_verification.sql](supabase/tests/rls_verification.sql) (5 assertion blocks, run manually via psql, not wired to CI). The `<2s` NFR also inherits F-01's `(select ...)`-wrapped, `stable`-helper posture — evaluated per query, not per row.

### 4. Seed data — S-01 can be verified end-to-end today

[supabase/seed.sql](supabase/seed.sql) (local only, wired via `[db.seed] sql_paths` in [supabase/config.toml:60-65](supabase/config.toml:60)):

- **3 groups** with operations: HR/Rekruter → recruitment.read/write + candidate.read/write; Hiring Manager → recruitment.read + candidate.read; Administrator → `group.manage` **only**.
- **3 users**, all password `password123`, email confirmed, one per group: `hr.test@example.com`, `hiring-manager.test@example.com`, `admin.test@example.com`.
- **1 recruitment**: `Backend Engineer`, Warszawa, Engineering, full-time, status `live` — assigned to **both** HR/Rekruter and Hiring Manager, deliberately not Administrator.
- **5 candidates** mapped 1:1 onto default stages Nowy → Zatrudniony. **`Odrzucony` has zero candidates** — a genuinely empty column for empty-state testing.
- Ids are sequence-assigned and resolved by name/email lookups — **do not hardcode ids** in tests or fixtures.

This gives S-01 three ready-made manual test identities: HR (full board), Hiring Manager (same board, read-only), Administrator (**sees zero recruitments** — a real empty-list case).

Caveat worth noting in the plan: the seeded recruitment's status is `live` only, so the status filter cannot be meaningfully exercised without adding rows.

### 5. Frontend conventions to follow

**Layout and pages.** [src/layouts/Layout.astro](src/layouts/Layout.astro) is the only layout: it takes an optional `title`, imports global CSS, renders config-warning banners above a bare `<slot />`, and provides **no page chrome** — no header, nav, or container. Page shell is each page's own job.

[src/pages/dashboard.astro](src/pages/dashboard.astro) is the protected-page template (27 lines): `const { user } = Astro.locals;` at [:4](src/pages/dashboard.astro:4) with **no auth check in the page** — middleware guarantees it. Pages do not export `prerender` (only API routes need it, per CLAUDE.md).

**Middleware.** [src/middleware.ts](src/middleware.ts) sets `context.locals.user` from `supabase.auth.getUser()` and redirects to a hardcoded `/auth/signin` (no `?redirectTo` round-trip). `PROTECTED_ROUTES = ["/dashboard"]` at [:4](src/middleware.ts:4), matched by `pathname.startsWith`. **New recruiter routes are unprotected unless added here** — or nested under `/dashboard/...` to inherit protection for free. `/api/*` is likewise unprotected.

**The Supabase client is NOT on `locals`.** Middleware creates one and discards it ([src/middleware.ts:7](src/middleware.ts:7)); `App.Locals` declares only `user` ([src/env.d.ts:1-5](src/env.d.ts:1)). Every consumer calls `createClient(context.request.headers, context.cookies)` itself (e.g. [src/pages/api/auth/signout.ts:5](src/pages/api/auth/signout.ts:5)). A recruitments page must create its own client in frontmatter — or the plan can decide to add `locals.supabase`, which is a change to both `env.d.ts` and `middleware.ts`.

**`createClient` can return `null`.** Both env vars are declared `optional: true` ([astro.config.mjs:17-22](astro.config.mjs:17)), so [src/lib/supabase.ts:6-8](src/lib/supabase.ts:6) returns `null` when unconfigured. Every existing call site null-checks; new code must too.

**React islands are leaves.** Only two `client:*` usages exist in the whole repo, both `client:load` on auth forms ([src/pages/auth/signin.astro:16](src/pages/auth/signin.astro:16), [signup.astro:16](src/pages/auth/signup.astro:16)). The established pattern is: page stays Astro, server state passed in as props, and **filter state via query params + Astro re-render** (`serverError={Astro.url.searchParams.get("error")}` at [signin.astro:5](src/pages/auth/signin.astro:5)). This maps directly onto FR-003's status filter — no client-side state library needed, and `has_realtime: false` ([tech-stack.md](context/foundation/tech-stack.md)) rules out a live-updating board.

**shadcn/ui is nearly empty.** `src/components/ui/` contains exactly `button.tsx` and a bespoke `LibBadge.astro`. **Missing and needed: `card`, `badge`, `select`, `table`/`scroll-area`, `skeleton`.** `select` and `scroll-area` pull in new `@radix-ui/*` deps (only `react-slot` is installed today). `components.json`: new-york, neutral base, cssVariables, lucide icons. One trap: `aliases.hooks` is `"@/hooks"` while CLAUDE.md mandates `src/components/hooks/` — the CLI will scaffold to the wrong place.

**Theme tension (design decision required).** [src/styles/global.css](src/styles/global.css) defines the full shadcn oklch token set on `:root` and `.dark`, with `@custom-variant dark (&:is(.dark *))` — class-based dark mode that **nothing in the repo ever activates**. Meanwhile every page hand-styles dark glassmorphism: `bg-cosmic` (a custom utility at [global.css:113-115](src/styles/global.css:113)) plus `rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl text-white`. shadcn `Card`s will render in light mode against that background. Resolve by either adding `.dark` to `<html>` or restyling via `className`.

**Reusable UI precedents**: field error ([FormField.tsx:58-62](src/components/auth/FormField.tsx:58)), server-error banner returning `null` when empty ([ServerError.tsx:8-14](src/components/auth/ServerError.tsx:8)), loading spinner via `useFormStatus` ([SubmitButton.tsx:20-24](src/components/auth/SubmitButton.tsx:20)). **No empty-state component and no skeletons exist** — the nearest reference is [confirm-email.astro:26-33](src/pages/auth/confirm-email.astro:26) (emoji + heading + description + link). `cn()` usage pattern: module-level base-class constant merged with conditional state classes ([FormField.tsx:51-54](src/components/auth/FormField.tsx:51)). In `.astro` files, `cn()` is never used — conditional classes go through `class:list` ([Banner.astro:11](src/components/Banner.astro:11)).

**Language: the UI is English.** Evidence across dashboard, signin, signup, confirm-email, and validation messages; `<html lang="en">` at [Layout.astro:14](src/layouts/Layout.astro:14). The only Polish strings are developer-facing config warnings ([config-status.ts:15-17](src/lib/config-status.ts:15)). There is no i18n framework, no catalog, no locale switch. **This collides with the seeded stage names, which are Polish** (`Nowy`, `Screening`, …) and with the Polish PRD — a decision the plan must make explicitly. F-01 flagged the names as "low-cost to rename later since it's data, not schema" ([plan-brief.md:55](context/changes/core-recruitment-data-foundation/plan-brief.md:55)).

### 6. Server-side conventions — mostly absent

**There is no JSON API convention.** All three endpoints under `src/pages/api/auth/` are HTML-form handlers that redirect with `?error=`; there is **no `Response`/`new Response` construction anywhere in the repo**, no status codes, no envelope, no try/catch. A read-only S-01 could avoid the question entirely by querying in Astro page frontmatter (SSR) rather than adding endpoints — that also matches the query-param filter pattern. If endpoints are added, the plan must invent and document the envelope.

Also note: no endpoint exports `prerender = false` (it works because `output: "server"`), contradicting CLAUDE.md's stated rule. Following the rule is still the safe choice.

**What CLAUDE.md claims exists but does not:**

| Convention (CLAUDE.md) | Reality |
|---|---|
| `src/types.ts` for shared entities/DTOs | **File does not exist** |
| Generated Supabase `Database` types | **None** — zero hits for `Database`/`database.types`; no npm script generates them; `createServerClient` is untyped at [src/lib/supabase.ts:9](src/lib/supabase.ts:9) |
| `src/lib/services/` for business logic | **Directory does not exist**; `src/lib/` holds only `supabase.ts`, `utils.ts`, `config-status.ts` |
| zod input validation | **Not a dependency** (transitive only); zero imports in `src/` |
| `src/components/hooks/` | **Directory does not exist** |
| Any `.from()` query | **Zero** — only `auth.*` calls exist |

**The lint gate is the sharpest constraint.** [eslint.config.js:15](eslint.config.js:15) extends `strictTypeChecked` + `stylisticTypeChecked` with `projectService: true`. Rules that will bite:

- `no-unsafe-assignment` / `-member-access` / `-call` / `-return` / `-argument` — all **error**. Against an untyped Supabase client, essentially every field access on query results fires. **This is why generating `Database` types is a blocker, not a preference.**
- `no-floating-promises`, `no-misused-promises` (only the JSX-attribute escape hatch is configured, [:36](eslint.config.js:36)), `no-non-null-assertion`, `no-unnecessary-condition`, `prefer-nullish-coalescing`, `restrict-template-expressions` (`allowNumber: true` only).
- `eslint-plugin-prettier/recommended` is last ([:78](eslint.config.js:78)) — **formatting violations are lint errors.** Prettier: 120 cols, double quotes, semicolons, trailing commas.

`tsconfig.json` extends `astro/tsconfigs/strict` — note this is `strict`, not `strictest`, so `noUncheckedIndexedAccess` is **off** (grouping candidates into a stage-keyed map won't be forced to null-check lookups; do it anyway).

**No tests, anywhere.** No vitest/playwright/jest, no config, no test dirs, no `test` script, no typecheck script (`@astrojs/check` is a dependency but nothing invokes it). CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs `npm ci` → `astro sync` → `lint` → `build`. **Its branch filter is `master` while this repo's branch is `main`** — CI likely never runs on these pushes. Any S-01 test means introducing framework + config + CI step from scratch: a scope decision to surface, not to assume.

## Code References

- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:13-23` — `recruitments` (status CHECK, `opened_at date`, no owner column)
- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:37-60` — `kanban_stages` + the 6 seeded Polish global defaults
- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:79-92` — `candidate_recruitments` (`current_stage_id`, `added_at`, kanban indexes)
- `supabase/migrations/20260831183457_rls_policies.sql:133,168,179,194` — the four SELECT policies S-01 depends on
- `supabase/migrations/20260831183457_rls_policies.sql:234-244` — per-verb grants (`kanban_stages` is `select` only)
- `supabase/migrations/20260831195143_mark_rls_helpers_stable.sql:5-36` — `has_operation` / `has_recruitment_operation`
- `supabase/seed.sql` — 3 groups, 3 users, 1 live recruitment, 5 candidates, 1 empty stage
- `supabase/tests/rls_verification.sql` — manual RLS assertions (not in CI)
- `src/middleware.ts:4,7,20` — `PROTECTED_ROUTES`, discarded client, hardcoded redirect
- `src/lib/supabase.ts:6-8,9` — null return when unconfigured; untyped `createServerClient`
- `src/env.d.ts:1-5` — `App.Locals` carries only `user`
- `src/pages/dashboard.astro:4-10` — protected-page template + glass-panel idiom
- `src/pages/auth/signin.astro:5,16` — query-param server state → `client:load` island
- `src/styles/global.css:4,113-115` — unused class-based dark variant; `bg-cosmic`
- `src/components/ui/` — `button.tsx` only
- `eslint.config.js:15,36,78` — `strictTypeChecked`, misused-promises config, prettier-as-error
- `astro.config.mjs:11,16,17-22` — `output: "server"`, cloudflare adapter, optional secret env schema
- `.github/workflows/ci.yml` — lint + build; branch filter `master` vs actual `main`

## Architecture Insights

- **Authorization lives in the database, not the app.** Every visibility rule is an RLS policy over group membership. S-01 writes plain queries and gets scoping for free — but must treat "empty result" as the authorization signal, and must not attempt UI-level permission logic that would drift from the policies.
- **Astro-first, islands-as-leaves.** The one established interactivity pattern is: server-render in frontmatter, pass state as props, put filter state in query params, hydrate only the interactive leaf with `client:load`. S-01's status filter fits this exactly; a read-only board needs no hydration at all.
- **Stages are data, not schema.** The nullable `recruitment_id` design makes S-03 a pure insert. The corollary obligation on S-01: read stages from the table and key candidates by `current_stage_id`, never by hardcoded names or positions.
- **Reference-table modeling over enums for domain state.** Candidate status is a FK row; only the fixed `operation` catalog is a real enum. Recruitment status is text+CHECK — a middle ground that puts label mapping in the UI.
- **The repo's stated conventions run ahead of its code.** CLAUDE.md documents a services/types/zod/DTO architecture that has never been built. S-01 is the first slice to actually establish it, which raises its architectural weight beyond "one screen".

## Historical Context (from prior changes)

- [context/changes/core-recruitment-data-foundation/plan.md:24-33](context/changes/core-recruitment-data-foundation/plan.md:24) — "What We're NOT Doing": no UI, no API endpoints, no `src/types.ts`, no kanban board (S-01's job), no per-recruitment stages (S-03), no notes (S-04), no CV (S-05), no admin UI (S-07).
- [context/changes/core-recruitment-data-foundation/plan.md:41](context/changes/core-recruitment-data-foundation/plan.md:41) — accepted simplification: group assignment is not restricted to the assigner's own groups, so group assignment is not a trustworthy signal of the assigner's membership (an S-02 concern).
- **Sharpest inherited constraint** (F-01 plan): a newly created recruitment is invisible to its creator until a `recruitment_security_groups` row exists, because `recruitments_select` is recruitment-scoped. `insert ... returning *` will fail the SELECT-side check. S-02's problem, but it shapes the shared list/detail views S-01 builds.
- [context/changes/core-recruitment-data-foundation/plan-brief.md:26](context/changes/core-recruitment-data-foundation/plan-brief.md:26) — seed data was shipped in F-01 precisely because "S-01's plan already assumes seeded test data exists". S-01's roadmap prerequisite on external seeded state is **already satisfied**.
- [context/changes/core-recruitment-data-foundation/plan-brief.md:55](context/changes/core-recruitment-data-foundation/plan-brief.md:55) — the Polish default stage names are an F-01 invention, not PRD-derived, and cheap to rename (data, not schema).
- F-01 impl review verdict was NEEDS ATTENTION; all 4 warnings and 2 of 3 observations were fixed in migrations M4–M7 (commit `dd75860`). Finding F7 (timestamp naming `added_at`/`changed_at` rather than `created_at`) was deliberately **skipped** — expect those column names.
- **Roadmap status is stale**: F-01 is `impl_reviewed` in its own `change.md` but still `in-progress` in [roadmap.md:44](context/foundation/roadmap.md:44).

### Documentation discrepancies found (worth correcting separately)

- `context/foundation/tech-stack.md:9` says `ci_provider: github-actions`; `context/changes/bootstrap-verification/verification.md:24` says `bitbucket-pipelines`.
- `tech-stack.md` records `deployment_target: cloudflare-pages`, but [context/foundation/infrastructure.md:18](context/foundation/infrastructure.md:18) notes `@astrojs/cloudflare` v13+ dropped Pages support — the deploy command must be `wrangler deploy`.
- CI's branch filter is `master`; the working branch is `main`.

## Related Research

**None exists.** No `research.md` or `frame.md` anywhere in `context/`; `context/archive/` holds only a README stub. `context/foundation/archive/shape-notes-2026-05-27-1200.md` is a **superseded, different product concept** ("HireTrack": hiring-manager-centric, competence areas, per-skill numeric scores) — none of it survives into the current PRD; **do not mine it for requirements.** The live shaping doc is `context/foundation/shape-notes.md` (2026-05-31), substantively identical to the PRD on kanban wording and adding no extra UI detail.

`context/foundation/lessons.md` does not exist — there are no accepted team priors to narrow this research.

## Open Questions

Ordered by how much they change the plan.

1. **Status filter mapping (product decision, blocks the list view).** FR-003 names two buckets ("otwarte/zamknięte") but the column stores three values (`draft`/`live`/`closed`) with no PRD mapping for `draft`. Options: filter on the three raw values; map `draft`+`live` → "otwarte"; or hide drafts from the list entirely. Also: default filter state, and whether "all" is an option.
2. **List view column set (product decision, unspecified anywhere).** The PRD mandates nothing beyond "a list, filterable by status, rows clickable by title". Every field is available (`title`, `location`, `department`, `employment_type`, `opened_at`, `status`) plus a derivable candidate count. Needs a call.
3. **Generate `Database` types — how (technical, blocks all query code).** `supabase gen types typescript` output location (`src/db/database.types.ts`?), whether it becomes an npm script, and whether it's committed. Without it, `strictTypeChecked` blocks typed queries.
4. **Routing and protection.** `/recruitments` + `/recruitments/[id]` (requires adding the prefix to `PROTECTED_ROUTES`) versus `/dashboard/recruitments/...` (inherits protection). Related: whether to add `locals.supabase` in middleware rather than creating a client per page.
5. **UI language.** English UI vs Polish PRD and Polish seeded stage names. Either rename the stage rows to English or accept mixed-language UI. No i18n framework exists.
6. **Theme.** Activate `.dark` on `<html>` so shadcn tokens match the existing `bg-cosmic` glassmorphism, or hand-style the board with `className` overrides. This decision precedes installing `card`/`badge`/`select`.
7. **Unauthorized/missing recruitment.** RLS returns zero rows for both. Confirm 404-style handling (recommended — a 403 leaks existence).
8. **Hiring Manager vs Recruiter view scope** (inherited open question, [roadmap.md:100](context/foundation/roadmap.md:100), owner: user, non-blocking). Since S-01 is read-only for both roles, this reduces to: does S-01 need *any* role-conditional UI, or is identical chrome acceptable until S-02/S-04 introduce write affordances? Note the Administrator seed user sees zero recruitments — the empty-list state is reachable in practice.
9. **Two-second NFR has no load target.** Roadmap open questions 1–2 (QPS, data volume) are unanswered and marked non-blocking, so `<2s` is untestable beyond seed-scale. Also: `recruitments` has no index beyond its PK — fine at seed scale, worth noting for the list query's sort/filter.
10. **Test infrastructure (scope decision).** None exists. Introducing vitest or Playwright for S-01 means framework + config + CI step, and CI's branch filter is wrong anyway. Surface rather than assume.
