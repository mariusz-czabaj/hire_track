# Core Recruitment Data Foundation Implementation Plan

## Overview

Build the Postgres schema, seed data, and Row-Level Security (RLS) policies that every recruiting slice (S-01 through S-07) will build on: recruitments, candidates, the candidate↔recruitment link (current status + status history), security groups with an operations catalog, group membership, and the default kanban stage set. This is F-01 on the roadmap — a pure data/security foundation with no UI or API endpoints.

## Current State Analysis

- `supabase/` has `config.toml` (local dev configured, `[db.seed] sql_paths = ["./seed.sql"]`, `extra_search_path = ["public", "extensions"]`) but no `migrations/` directory and no domain schema — confirmed via `find supabase -type f`.
- Auth is Supabase-managed email+password (`src/lib/supabase.ts`, `src/pages/api/auth/{signin,signup,signout}.ts`); there is no app-level `profiles` table, so group membership can reference `auth.users(id)` directly.
- `src/middleware.ts` already resolves `context.locals.user` and protects `/dashboard`; this plan does not touch middleware or any app code.
- No `src/types.ts` exists yet; this plan is DB-only and does not introduce one (a future slice that queries these tables will add the shared types then).

## Desired End State

Running `npx supabase db reset` against a clean database produces: all domain + security tables with RLS enabled and enforced, the default global kanban stage set, and local seed data (one example security group per PRD's "Przykładowe grupy," one test user membership, one seeded recruitment with candidates across default stages). A SQL verification script proves that a user in a read-only group can see but not write recruitment/candidate data, and that an unauthenticated request sees nothing.

### Key Discoveries:

- PRD's "Przykładowe grupy" (HR/Rekruter, Hiring Manager, Administrator) are explicitly "konfiguracja — nie część schematu" (`context/foundation/prd.md` Access Control section) — they belong in seed data, not in a migration, since S-07 lets real admins create arbitrary groups later.
- The default kanban stage set, by contrast, **is** part of the schema per F-01's stated outcome ("domyślny zestaw etapów kanban") — those rows must exist in every environment (including prod), so they belong in a migration's data statements, not in `seed.sql` (which only runs on local `db reset`, never on `db push` to a real environment).
- FR-015/FR-016 and the Access Control guardrail describe candidate visibility as org-wide for any authenticated user with the read operation — not scoped per-recruitment-group like recruitment visibility is. This matches S-06's requirement to search "wszystkich rekrutacji" regardless of which security groups the searcher belongs to.

## What We're NOT Doing

- No candidate notes or the "no note → can't change status" business rule (S-04).
- No CV upload/storage or its 12-month retention job (S-05).
- No per-recruitment kanban stage customization UI or write policies — the schema slot (`kanban_stages.recruitment_id` nullable) exists, but only the global default rows (`recruitment_id IS NULL`) are populated, and there is no INSERT/UPDATE/DELETE policy on `kanban_stages` yet (S-03).
- No recruitment create/edit UI or API endpoints (S-02) — the table and columns exist, nothing calls them yet.
- No kanban board UI (S-01).
- No admin UI for managing groups, operations, or membership (S-07) — schema + RLS exist; there is no app surface to drive them yet.
- No candidate or recruitment deletion — not requested anywhere in the PRD, so no DELETE policy is defined for those tables (RLS with no policy for an operation denies it by default).
- No OAuth/external identity provider migration (parked in the roadmap).

## Implementation Approach

Four migrations in dependency order — security/RBAC schema, then domain schema, then RLS (which needs both), then seed + verification (which needs a database to test against). Every table gets `bigint generated always as identity` primary keys (Supabase's Postgres best practices flag random UUIDv4 PKs as causing index fragmentation) except where a column is a foreign key into Supabase-managed `auth.users(id)`, which is `uuid` and can't be changed. Permission checks run through two `SECURITY DEFINER` helper functions in a `private` schema (not exposed to PostgREST, per `supabase/config.toml`'s `schemas = ["public", "graphql_public"]`) rather than inline joins in every policy — this is the standard Supabase RLS pattern and it sidesteps a real gotcha: if policies joined `group_memberships`/`group_operations` directly under the querying user's own RLS, those two tables' own restrictive SELECT policies would block the permission check for everyone except admins. A `SECURITY DEFINER` function bypasses RLS internally (with an explicit `auth.uid()` check inside), so the two permission tables can stay locked down to `group.manage` only.

## Critical Implementation Details

**RLS write-policy sequencing (chicken-and-egg on INSERT).** A brand-new `recruitments` row has no `recruitment_security_groups` rows yet, so a recruitment-scoped write check (`private.has_recruitment_operation(id, ...)`) would always evaluate false on INSERT — there's nothing to scope against. Both `recruitments` INSERT and `recruitment_security_groups` INSERT/DELETE therefore use the **broad** check (`private.has_operation('recruitment.write')` — "does this user have write access in *any* group they belong to") rather than a recruitment-scoped one. Only SELECT/UPDATE on `recruitments` (and SELECT on `recruitment_security_groups`) are scoped to the specific recruitment's assigned groups. This means a user can assign *any* existing security group to a recruitment they create, not only groups they personally belong to — an accepted simplification; the PRD has no requirement that group assignment be restricted to the assigner's own groups.

**RLS performance.** Every policy wraps `auth.uid()` as `(select auth.uid())` and every helper function call as `(select private.has_operation(...))` — per Supabase's Postgres best practices, this lets Postgres evaluate the call once per query instead of once per row (5-10x+ difference at scale). Both helper functions must also have their `execute` privilege revoked from `PUBLIC`, `anon`, and `authenticated`... actually granted only to `authenticated` (never revoked-and-left-inaccessible, since policies call them as the querying user) — see Phase 3's exact grants.

## Phase 1: Security & RBAC Schema

### Overview

Introduces the entities admins will manage in S-07: named security groups, the fixed catalog of operations a group can be granted, which operations each group has, and which users belong to which group. Nothing here yet depends on recruitments/candidates existing.

### Changes Required:

#### 1. Security & RBAC migration

**File**: `supabase/migrations/<timestamp>_security_rbac_schema.sql` (run `npx supabase migration new security_rbac_schema` to get the real timestamp)

**Intent**: Create the tables and enum that back RBAC, with every foreign key indexed per Supabase's schema best practices.

**Contract**:
- `create type operation as enum ('recruitment.read', 'recruitment.write', 'candidate.read', 'candidate.write', 'group.manage');` — a fixed, app-defined catalog (not admin-extensible), sized to the three example groups the PRD describes (HR/Rekruter: full recruitment+candidate write; Hiring Manager: read-only both; Administrator: `group.manage` only).
- `security_groups(id bigint identity pk, name text not null unique, created_at timestamptz not null default now())`.
- `group_memberships(id bigint identity pk, group_id bigint not null references security_groups(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now(), unique(group_id, user_id))` — explicit index on `user_id` in addition to the unique constraint (which only optimizes lookups by `group_id` as the leading column).
- `group_operations(id bigint identity pk, group_id bigint not null references security_groups(id) on delete cascade, operation operation not null, unique(group_id, operation))`.
- RLS is **not** enabled in this migration — Phase 3 enables it repo-wide once the helper functions it depends on can be created (they need `recruitment_security_groups` from Phase 2).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Lint is clean: `npx supabase db lint --local`
- Migration is tracked: `npx supabase migration list --local` shows the new file as applied locally

#### Manual Verification:

- Supabase Studio (`http://127.0.0.1:54323`) → Table Editor shows `security_groups`, `group_memberships`, `group_operations` with the columns above, and `operation` appears as an enum type with the 5 expected values

---

## Phase 2: Recruitment & Candidate Domain Schema

### Overview

Introduces the recruiting domain itself: recruitments, which security groups a recruitment is visible to, the kanban stage set (default + future per-recruitment override slot), candidates, the candidate↔recruitment link, and its status-change history log.

### Changes Required:

#### 1. Domain schema migration

**File**: `supabase/migrations/<timestamp>_recruitment_candidate_schema.sql`

**Intent**: Create every table F-01's outcome calls for, insert the real default kanban stages (product config, not test data — see Key Discoveries), and add the search index candidate lookup will need in S-06.

**Contract**:
- `create extension if not exists pg_trgm with schema extensions;` — matches `supabase/config.toml`'s existing `extra_search_path = ["public", "extensions"]`.
- `recruitments(id bigint identity pk, title text not null, location text, department text, employment_type text, opened_at date, status text not null default 'draft' check (status in ('draft','live','closed')), created_at timestamptz not null default now(), updated_at timestamptz not null default now())` — full FR-001/FR-002 metadata + status, even though the create/edit UI is S-02's job; F-01 owns the complete table shape.
- `recruitment_security_groups(id bigint identity pk, recruitment_id bigint not null references recruitments(id) on delete cascade, group_id bigint not null references security_groups(id) on delete restrict, created_at timestamptz not null default now(), unique(recruitment_id, group_id))` — `on delete restrict` on `group_id` per the group-deletion decision: deleting a group still assigned to a recruitment fails rather than silently orphaning that recruitment (making it invisible to everyone). Explicit index on `group_id`.
- `kanban_stages(id bigint identity pk, recruitment_id bigint references recruitments(id) on delete cascade, name text not null, sort_order int not null, created_at timestamptz not null default now())` — `recruitment_id` nullable: `NULL` rows are the global default set S-01 renders; non-null rows are a future per-recruitment override (S-03). Two partial unique indexes, since a plain `unique(recruitment_id, sort_order)` wouldn't catch duplicate default rows (Postgres treats each `NULL` as distinct):
  ```sql
  create unique index kanban_stages_default_sort_order_key on kanban_stages (sort_order) where recruitment_id is null;
  create unique index kanban_stages_recruitment_sort_order_key on kanban_stages (recruitment_id, sort_order) where recruitment_id is not null;
  ```
  Seed the 6 default stages in this same migration (real product config, ships to every environment):
  `insert into kanban_stages (name, sort_order) values ('Nowy', 1), ('Screening', 2), ('Rozmowa', 3), ('Oferta', 4), ('Zatrudniony', 5), ('Odrzucony', 6);`
- `candidates(id bigint identity pk, full_name text not null, email text not null, phone text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`. Dedup key: `create unique index candidates_email_key on candidates (lower(email));` — the app-layer "add candidate" flow (S-04) looks up by lowercased email first and links to the existing row on a match, satisfying FR-007's shared-profile requirement. Search index: `create index candidates_full_name_trgm_idx on candidates using gin (full_name gin_trgm_ops);`.
- `candidate_recruitments(id bigint identity pk, candidate_id bigint not null references candidates(id) on delete cascade, recruitment_id bigint not null references recruitments(id) on delete cascade, current_stage_id bigint not null references kanban_stages(id) on delete restrict, added_at timestamptz not null default now(), unique(candidate_id, recruitment_id))` — explicit indexes on `recruitment_id` (the kanban board's primary query pattern) and `current_stage_id`, in addition to the unique constraint.
- `candidate_recruitment_status_history(id bigint identity pk, candidate_recruitment_id bigint not null references candidate_recruitments(id) on delete cascade, from_stage_id bigint references kanban_stages(id), to_stage_id bigint not null references kanban_stages(id), changed_by uuid references auth.users(id), changed_at timestamptz not null default now())` — append-only; no UPDATE/DELETE policy will ever be defined on it (Phase 3). Explicit index on `candidate_recruitment_id` (S-06's per-candidate history query).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Lint is clean: `npx supabase db lint --local`
- Migration is tracked: `npx supabase migration list --local` shows the new file as applied locally

#### Manual Verification:

- Supabase Studio → Table Editor shows all six tables with the columns above
- `kanban_stages` has exactly 6 rows with `recruitment_id IS NULL`, named and ordered as specified

---

## Phase 3: RLS Policies

### Overview

Enables RLS on every table from Phases 1-2 and defines per-operation policies gated by the RBAC model, via two `SECURITY DEFINER` helper functions in a new `private` schema.

### Changes Required:

#### 1. RLS migration

**File**: `supabase/migrations/<timestamp>_rls_policies.sql`

**Intent**: Lock down every table to the `authenticated` role via policies driven by group membership + granted operations; grant only the privileges each table's policies actually support (no blanket `ALL`), per the least-privilege guidance in Supabase's Postgres best practices.

**Contract**:
- `create schema if not exists private;` (already excluded from the API by `config.toml`'s `schemas = ["public", "graphql_public"]`).
- Helper functions, both `security definer`, `set search_path = ''`, granted `execute` to `authenticated` only:
  ```sql
  create or replace function private.has_operation(check_operation operation)
  returns boolean language sql security definer set search_path = '' as $$
    select exists (
      select 1 from public.group_memberships gm
      join public.group_operations go on go.group_id = gm.group_id
      where gm.user_id = (select auth.uid()) and go.operation = check_operation
    );
  $$;

  create or replace function private.has_recruitment_operation(target_recruitment_id bigint, check_operation operation)
  returns boolean language sql security definer set search_path = '' as $$
    select exists (
      select 1 from public.recruitment_security_groups rsg
      join public.group_memberships gm on gm.group_id = rsg.group_id
      join public.group_operations go on go.group_id = rsg.group_id and go.operation = check_operation
      where rsg.recruitment_id = target_recruitment_id and gm.user_id = (select auth.uid())
    );
  $$;
  ```
- `alter table <t> enable row level security;` for all nine tables (`security_groups`, `group_memberships`, `group_operations`, `recruitments`, `recruitment_security_groups`, `kanban_stages`, `candidates`, `candidate_recruitments`, `candidate_recruitment_status_history`).
- Policies (all `to authenticated`, all wrapping `auth.uid()`/helper calls in `(select ...)` per the RLS performance rule — see Critical Implementation Details):
  - `security_groups`: SELECT `using (true)` — every authenticated user needs the group list to assign one at recruitment-creation time (FR-001a); INSERT/UPDATE/DELETE gated by `private.has_operation('group.manage')`.
  - `group_memberships`: SELECT `using (user_id = (select auth.uid()) or (select private.has_operation('group.manage')))`; INSERT/UPDATE/DELETE gated by `group.manage`.
  - `group_operations`: SELECT/INSERT/UPDATE/DELETE all gated by `group.manage` only — safe to lock down fully because the helper functions above read it under `security definer`, not under the querying user's own RLS.
  - `recruitments`: SELECT via `private.has_recruitment_operation(id, 'recruitment.read')`; INSERT via the broad `private.has_operation('recruitment.write')` (see Critical Implementation Details); UPDATE via `private.has_recruitment_operation(id, 'recruitment.write')` on both `using` and `with check`. No DELETE policy.
  - `recruitment_security_groups`: SELECT via `private.has_recruitment_operation(recruitment_id, 'recruitment.read')`; INSERT and DELETE both via the broad `private.has_operation('recruitment.write')`. No UPDATE policy (reassignment is delete+insert).
  - `kanban_stages`: SELECT `using (recruitment_id is null or (select private.has_recruitment_operation(recruitment_id, 'recruitment.read')))`. No INSERT/UPDATE/DELETE policy (S-03's job; F-01's own default rows are inserted by the Phase 2 migration, which runs outside RLS).
  - `candidates`: SELECT via `private.has_operation('candidate.read')`; INSERT via `private.has_operation('candidate.write')`; UPDATE via `private.has_operation('candidate.write')` on both `using` and `with check`. No DELETE policy. (Org-wide, not recruitment-scoped — see Key Discoveries.)
  - `candidate_recruitments`: SELECT via `private.has_recruitment_operation(recruitment_id, 'recruitment.read')`; INSERT and UPDATE via `private.has_recruitment_operation(recruitment_id, 'recruitment.write')`. No DELETE policy.
  - `candidate_recruitment_status_history`: SELECT and INSERT both via a subquery to the parent `candidate_recruitments` row's `private.has_recruitment_operation(recruitment_id, 'recruitment.{read,write}')`. No UPDATE/DELETE policy (append-only).
- Grants: `grant usage on schema public to authenticated;` plus, per table, exactly the DML verbs that table has a policy for (e.g. `grant select, insert, update on recruitments to authenticated;` — no `delete`). Identity-column primary keys need no separate sequence grants.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Lint is clean: `npx supabase db lint --local`
- Every table has RLS enabled — this query returns zero rows: `npx supabase db query --local "select tablename from pg_tables where schemaname = 'public' and rowsecurity = false and tablename not like 'pg_%'"`

#### Manual Verification:

- Anonymous REST request returns no rows: `curl -s "http://127.0.0.1:54321/rest/v1/recruitments" -H "apikey: <anon key from \`npx supabase status\`>"` returns `[]`, confirming an unauthenticated request sees nothing

---

## Phase 4: Seed Data + RLS Verification

### Overview

Populates local/dev fixtures matching PRD's example groups and S-01's stated prerequisite ("zasiane dane testowe"), then proves the RLS model actually enforces the intended access boundaries.

### Changes Required:

#### 1. Seed script

**File**: `supabase/seed.sql` (already wired via `config.toml`'s `[db.seed] sql_paths = ["./seed.sql"]`, runs on every local `db reset` — never applied to a real environment via `db push`)

**Intent**: Seed the three example groups from the PRD's Access Control section with their operation grants, one auth user linked into the HR group (the S-01 prerequisite's "test user"), one recruitment assigned to that group, and a handful of candidates spread across the default kanban stages.

**Contract**: Inserts, in order: `security_groups` rows named `HR/Rekruter`, `Hiring Manager`, `Administrator`; `group_operations` rows granting HR both `recruitment.*`/`candidate.*` operations, Hiring Manager only the two `*.read` operations, Administrator only `group.manage`; one row directly into `auth.users` for a local test account (standard Supabase local-seed pattern — encrypted password via `extensions.crypt`) plus its `group_memberships` row into `HR/Rekruter`; one `recruitments` row + its `recruitment_security_groups` link to `HR/Rekruter`; 4-5 `candidates` rows linked via `candidate_recruitments` across several of the 6 default `kanban_stages`, each with one `candidate_recruitment_status_history` row recording the initial add.

#### 2. RLS verification script

**File**: `supabase/tests/rls_verification.sql`

**Intent**: Assert, per seeded user, that visibility and write access match the operations their group was granted — the concrete check for the "Full operation-gated RLS" decision.

**Contract**: A sequence of `begin; select set_config('request.jwt.claims', ..., true); set local role authenticated; ...; rollback;` blocks (RLS as a specific user is simulated by setting `request.jwt.claims` and switching to the `authenticated` role, not by an actual login) — one block per assertion, each wrapped in `do $$ ... raise exception 'FAIL: <what was expected>' ... $$` so any failed assertion makes the script exit non-zero. Minimum assertions: (1) the seeded HR user can SELECT the seeded recruitment and candidates; (2) the seeded HR user can INSERT a new candidate; (3) a Hiring-Manager-only user can SELECT the same recruitment but an INSERT on `candidates` raises `insufficient_privilege`; (4) with no `request.jwt.claims` set (simulating anonymous), SELECT on `recruitments` returns zero rows.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` runs `seed.sql` without error
- Verification script passes with no raised exceptions: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_verification.sql` (note: `npx supabase db query --local -f` cannot run a multi-statement script — it errors with "cannot insert multiple commands into a prepared statement"; the local Postgres container's own `psql` is used instead, since no `psql` client is installed on this machine)

#### Manual Verification:

- Supabase Studio → Table Editor shows the 3 seeded groups, 1 test recruitment, and 4-5 seeded candidates distributed across default stages, matching what S-01 expects as its starting fixture

---

## Testing Strategy

### Unit Tests:

- N/A — this change has no application code, only SQL.

### Integration Tests:

- Phase 4's `supabase/tests/rls_verification.sql` is the integration test for this change: it runs against a real local Postgres instance with real RLS enforcement, simulating multiple users in one script.

### Manual Testing Steps:

1. `npx supabase db reset` and confirm it completes without error.
2. Open Supabase Studio (`http://127.0.0.1:54323`), inspect each table's columns/constraints against Phases 1-2's contracts.
3. Run the anonymous `curl` check from Phase 3's manual verification.
4. Run `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_verification.sql` and confirm no exceptions.

## Performance Considerations

- Every FK column gets an explicit index (Postgres does not auto-index them), since the missing-index pattern is the single most common cause of slow JOINs/cascades per Supabase's Postgres best practices.
- The `candidates_full_name_trgm_idx` GIN index commits to a trigram/`ILIKE`-style search strategy now so S-06 doesn't hit a sequential scan on day one; if S-06's plan later wants full-text search instead, this index can be dropped/replaced without touching any other table.
- All RLS policy checks wrap `auth.uid()`/helper-function calls in `(select ...)` so Postgres caches the result once per query instead of re-evaluating per row.

## Migration Notes

Greenfield schema — no existing production data to migrate or backfill.

## References

- Roadmap: `context/foundation/roadmap.md` (F-01)
- PRD: `context/foundation/prd.md` (FR-001, FR-001a, FR-002, FR-004, FR-006-FR-018, Access Control, Business Logic)
- Existing auth: `src/lib/supabase.ts`, `src/middleware.ts`, `src/pages/api/auth/{signin,signup}.ts`
- Local Supabase config: `supabase/config.toml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Security & RBAC Schema

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 17263ca
- [x] 1.2 Lint is clean: `npx supabase db lint --local` — 17263ca
- [x] 1.3 Migration is tracked: `npx supabase migration list --local` shows the new file as applied locally — 17263ca

#### Manual

- [x] 1.4 Supabase Studio Table Editor shows `security_groups`, `group_memberships`, `group_operations` with expected columns and the `operation` enum — 17263ca

### Phase 2: Recruitment & Candidate Domain Schema

#### Automated

- [x] 2.1 Migration applies cleanly: `npx supabase db reset` — ec3ce70
- [x] 2.2 Lint is clean: `npx supabase db lint --local` — ec3ce70
- [x] 2.3 Migration is tracked: `npx supabase migration list --local` shows the new file as applied locally — ec3ce70

#### Manual

- [x] 2.4 Supabase Studio shows all six domain tables with expected columns — ec3ce70
- [x] 2.5 `kanban_stages` has exactly 6 default rows (`recruitment_id IS NULL`), correctly named and ordered — ec3ce70

### Phase 3: RLS Policies

#### Automated

- [x] 3.1 Migration applies cleanly: `npx supabase db reset` — 97e61e8
- [x] 3.2 Lint is clean: `npx supabase db lint --local` — 97e61e8
- [x] 3.3 RLS enabled on every public table: verification query returns zero rows — 97e61e8

#### Manual

- [x] 3.4 Anonymous REST request to `/rest/v1/recruitments` returns `[]` — 97e61e8

### Phase 4: Seed Data + RLS Verification

#### Automated

- [x] 4.1 `npx supabase db reset` runs `seed.sql` without error
- [x] 4.2 `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_verification.sql` passes with no raised exceptions

#### Manual

- [x] 4.3 Supabase Studio shows seeded groups/recruitment/candidates matching S-01's expected starting fixture
