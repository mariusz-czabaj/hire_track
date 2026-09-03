---
date: 2026-09-01T16:49:34+02:00
researcher: Mariusz Czabaj
git_commit: 897e96ac633516e5b56af5c5dd550b7cbfb9f00a
branch: main
repository: mariusz-czabaj/hire_track
topic: "S-03 — recruiter customizes kanban stages per recruitment (FR-004)"
tags: [research, codebase, kanban_stages, rls, migrations, kanban-board]
status: complete
last_updated: 2026-09-01
last_updated_by: Mariusz Czabaj
---

# Research: Recruiter customizes kanban stages per recruitment

**Date**: 2026-09-01T16:49:34+02:00
**Researcher**: Mariusz Czabaj
**Git Commit**: `897e96ac633516e5b56af5c5dd550b7cbfb9f00a`
**Branch**: main
**Repository**: mariusz-czabaj/hire_track

## Research Question

What does the codebase already provide, and what must change, to let a recruiter override the global default kanban stage set with a per-recruitment set (roadmap slice S-03, PRD FR-004)?

## Summary

**The roadmap's characterisation of S-03 as "low risk, purely additive, Unknowns: —" ([roadmap.md:125](../../../context/foundation/roadmap.md:125)) is wrong.** The schema slot for overrides does exist and was designed for this slice, so the _insert_ half is genuinely easy. But three separate blockers sit on the path, and two of them are data-integrity traps that no prior change document has ever discussed:

1. **The board read path ignores override rows entirely**, and the moment overrides exist, candidates silently vanish from the UI. Verified empirically: with a 3-stage override set on the seeded recruitment, **5 of 5 candidates became invisible** with no error. S-03 must change S-01's read path — it is not additive.

2. **A stage row becomes permanently undeletable once any candidate has ever passed through it.** `candidate_recruitments.current_stage_id` is `on delete restrict`, and `candidate_recruitment_status_history.to_stage_id` is `not null` with no on-delete action (so `NO ACTION`) on an append-only table with no DELETE policy. Verified: after moving every candidate off a stage, the delete **still** failed on the history FK. So "replace the stage set" cannot be implemented as delete-and-reinsert on any recruitment with history.

3. **Reordering stages collides with a non-deferrable partial unique index** — including in a single set-based `UPDATE`, which is the workaround the docs would lead you to. Verified: both the set-based swap and the row-by-row renumber fail with `23505`. A two-phase renumber (park in negative space, then assign targets) works and needs no schema change.

Two claims that a reading of the migrations would suggest are **false**, and I verified both against the live stack:

- **S-03 does _not_ need to add `insert`/`delete` grants.** [rls_policies.sql:241](../../../supabase/migrations/20260831183457_rls_policies.sql:241) grants only `select`, and the file's comment implies grants are the gate — but Supabase's bootstrap already grants all DML on public-schema tables to `authenticated`. Adding **only an RLS policy** made the insert succeed. The repo's stated "grant only the verbs with a policy" discipline is not actually load-bearing.
- **A single `UPDATE ... SET sort_order = CASE ...` does not sidestep the unique index.** Unique _indexes_ are enforced per-row and immediately, unlike deferrable unique _constraints_.

The good news: the write-path shape S-03 needs is almost exactly what S-02 shipped last week (atomic multi-row write behind a `security definer` RPC in `public`, errcode→HTTP mapping, `useMutation`, four-layer tests), so there is a fresh, reviewed template to copy. Authorization needs no new `operation` enum value — the scoped `private.has_recruitment_operation(id, 'recruitment.write')` fits, and the existing `candidate_recruitments_update` policy already permits the candidate re-map (verified).

## Detailed Findings

### 1. The override slot exists and was designed for this slice

[recruitment_candidate_schema.sql:37-49](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:37):

```sql
create table kanban_stages (
  id bigint generated always as identity primary key,
  recruitment_id bigint references recruitments (id) on delete cascade,
  name text not null,
  sort_order int not null,
  created_at timestamptz not null default now()
);
create unique index kanban_stages_default_sort_order_key on kanban_stages (sort_order) where recruitment_id is null;
create unique index kanban_stages_recruitment_sort_order_key on kanban_stages (recruitment_id, sort_order) where recruitment_id is not null;
```

`recruitment_id IS NULL` = global default row; non-NULL = per-recruitment override. Two _partial_ indexes rather than one plain `unique(recruitment_id, sort_order)` because Postgres treats every NULL as distinct, so a plain constraint would not catch duplicate default rows.

F-01 named S-03 as the owner of the write side in three places: [rls_policies.sql:163-167](../../../supabase/migrations/20260831183457_rls_policies.sql:163) ("No INSERT/UPDATE/DELETE policy yet -- that's S-03's job"), [F-01 plan.md:28](../../../context/changes/core-recruitment-data-foundation/plan.md:28), and [F-01 plan-brief.md:22](../../../context/changes/core-recruitment-data-foundation/plan-brief.md:22) ("S-03's per-recruitment override becomes a pure insert, not a schema change").

The default 6 rows ship in the **migration**, not `seed.sql`, deliberately — [recruitment_candidate_schema.sql:51-53](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:51) calls them "real product config shipped to every environment (including prod), not test/dev-only data." They were seeded in Polish and renamed to English by [20260901000000_rename_default_kanban_stages_to_english.sql](../../../supabase/migrations/20260901000000_rename_default_kanban_stages_to_english.sql) (see §8).

The only existing policy, [rls_policies.sql:168-173](../../../supabase/migrations/20260831183457_rls_policies.sql:168), already handles override rows correctly for reads:

```sql
create policy kanban_stages_select on kanban_stages
  for select to authenticated
  using (
    recruitment_id is null
    or (select private.has_recruitment_operation(recruitment_id, 'recruitment.read'))
  );
```

### 2. The read path ignores overrides, and candidates silently vanish

[recruitments.ts:129-133](../../../src/lib/services/recruitments.ts:129) — `recruitmentId` is never referenced in the stages query:

```ts
const { data: stages, error: stagesError } = await client
  .from("kanban_stages")
  .select("id, name, sort_order")
  .is("recruitment_id", null)
  .order("sort_order", { ascending: true });
```

The board then builds `candidatesByStage` from the candidate rows but only ever _reads_ that map through the stage list ([recruitments.ts:162-171](../../../src/lib/services/recruitments.ts:162), `candidatesByStage.get(stage.id) ?? []`). A candidate whose `current_stage_id` is not in the returned stage list is never looked up: **no column, no card, and `candidateCount` silently under-reports.** This is the exact failure mode S-01 warned about from the other direction — [S-01 plan.md](../../../context/changes/recruiter-views-kanban-board/plan.md) requires grouping be driven by the stage list, not the candidate rows, so that empty stages like `Rejected` still render.

Empirically verified (test D/H below): inserting a 3-stage override set for recruitment 1 left **0 of its 5 candidates** on a stage in the resolved set.

S-01's research already flagged the missing piece: _"Nothing in the DB coalesces override rows over defaults — if you want override-aware behavior you write it yourself"_ ([S-01 research.md:77](../../../context/changes/recruiter-views-kanban-board/research.md:77)).

**Resolution can be done in one round trip** (verified, test D): select both partitions and choose in JS.

```ts
.from("kanban_stages")
.select("id, name, sort_order, recruitment_id")   // recruitment_id is NOT selected today
.or(`recruitment_id.is.null,recruitment_id.eq.${recruitmentId}`)
```

then `overrides.length > 0 ? overrides : defaults`. Notes:

- `recruitment_id` must be added to the `select` to partition on it.
- A single `.order("sort_order")` interleaves both sets — sort per partition after the split.
- RLS-safe: the existing select policy already permits both partitions, and the board's first query has already proven read access to the recruitment.
- The id is `z.coerce.number().int().positive()`-validated at the endpoint ([board.ts:9](../../../src/pages/api/recruitments/[id]/board.ts:9)), but prefer a non-interpolating filter to keep the service safe standalone.

**The DTO carries no provenance.** [types.ts:51-75](../../../src/types.ts:51) defines `KanbanStageDto {id, name, sortOrder}`, `KanbanBoardStageDto`, `KanbanBoardDto` — nothing distinguishes a default from an override. A board-level `stagesSource: "default" | "custom"` fits the all-or-nothing resolution semantics better than a per-stage flag, and would drive both an "inheriting defaults" badge and a "reset to defaults" affordance.

### 3. Write authorization: the policy is the only thing missing (grants are already there)

This corrects what the migration text implies. [rls_policies.sql:241](../../../supabase/migrations/20260831183457_rls_policies.sql:241) is `grant select on kanban_stages to authenticated;`, and the file comments suggest grants are narrowed to "only the DML verbs each table above has a policy for". **The live database disagrees** — Supabase's bootstrap grants all DML on public-schema tables to `anon`, `authenticated`, and `service_role`, and that is never revoked here:

```
authenticated | SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
```

Verified (tests A1/A2): with **only** an RLS policy added and no grant change, an HR insert of an override row succeeded. So S-03 needs policies, not grants. Adding explicit grants would be harmless documentation, but the reasoning "a policy alone yields `permission denied`" is false — the failure mode without a policy is `42501 new row violates row-level security policy`, not a privilege error.

A policy predicated on `recruitment_id is not null` correctly leaves the **global defaults immutable by anyone** (verified, test A2 → blocked), which is likely the desired posture given the defaults are migration-shipped product config. That should be a stated decision, not an accident of `has_recruitment_operation(NULL, ...)` returning false.

**No new `operation` enum value is needed.** The catalog is fixed at 5 values ([security_rbac_schema.sql:10-16](../../../supabase/migrations/20260831181826_security_rbac_schema.sql:10)): `recruitment.read`, `recruitment.write`, `candidate.read`, `candidate.write`, `group.manage`. `recruitment.write` is the natural gate, and the **scoped** helper is the right one here — unlike S-02's create (where a brand-new recruitment has no group links yet, forcing the unscoped `has_operation`), a stage-set change always targets an already-linked recruitment. Adding a bespoke enum value would also incur a real cost: `alter type ... add value` cannot be used in the same transaction that added it, so it would need its own migration file.

Follow the file's convention of wrapping the helper in `(select ...)` so the `stable` function is evaluated once per statement rather than per row ([rls_policies.sql:143-144](../../../supabase/migrations/20260831183457_rls_policies.sql:143)).

### 4. The deletion trap: stages become permanently undeletable

Three FKs point at `kanban_stages`:

| Column                                                                                                                                        | Clause                                  | Effective behavior                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| `candidate_recruitments.current_stage_id` ([:83](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:83))            | `not null ... on delete restrict`       | Blocks delete while any candidate sits on the stage |
| `candidate_recruitment_status_history.from_stage_id` ([:97](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:97)) | nullable, **no clause** → `NO ACTION`   | Blocks delete (does _not_ set null)                 |
| `candidate_recruitment_status_history.to_stage_id` ([:98](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:98))   | `not null`, **no clause** → `NO ACTION` | Blocks delete, forever                              |

History is append-only by design with no UPDATE/DELETE policy ever ([rls_policies.sql:207-209](../../../supabase/migrations/20260831183457_rls_policies.sql:207)). Therefore **once a candidate has ever moved through a stage, that stage row can never be deleted by anyone.** Verified:

- **B1** — delete a stage holding a candidate → `23503`, blocked on `candidate_recruitments_current_stage_id_fkey`.
- **B2** — delete an unreferenced stage (`Rejected`, no candidates, no history) → succeeded.
- **B3** — move every candidate off the stage _first_, then delete → **still blocked**, `23503` on `candidate_recruitment_status_history_to_stage_id_fkey`.

**Consequence for the design.** "Replace this recruitment's stage set" cannot be delete-and-reinsert once history exists. The viable shapes are:

- **Update-in-place** — rename/reorder existing override rows, insert net additions, delete only rows that are provably unreferenced (see §5 for the reorder mechanics).
- **Soft-delete** — add `archived_at`/`is_active`, filter it out of the board. Keeps history intact and is the only shape that supports "remove a stage that has been used".
- **Configure-before-use** — only permit customization while the recruitment has no candidates. Simplest, and see §9 for why the current sequencing makes this cheaper than it sounds.

Note `from_stage_id` lacking `on delete set null` is the same latent inconsistency the repo already fixed for `changed_by` in [20260831194556_fix_status_history_changed_by_on_delete.sql](../../../supabase/migrations/20260831194556_fix_status_history_changed_by_on_delete.sql) — a direct precedent if S-03 wants deletable stages. F-01's own impl review caught that class of bug ([F-01 impl-review.md:23-40](../../../context/changes/core-recruitment-data-foundation/reviews/impl-review.md:23)).

There is also **no index on `from_stage_id`/`to_stage_id`**, so FK enforcement at delete time is a sequential scan on history. `candidate_recruitments_current_stage_id_idx` ([:92](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:92)) does cover the "are any candidates here" pre-check.

### 5. Reordering collides with the unique index — and the obvious workaround doesn't work

`kanban_stages_recruitment_sort_order_key` is a plain (non-deferrable) partial unique **index**. Unique indexes are enforced per-row and immediately, so:

- **E1** — a single set-based swap, `update ... set sort_order = 4 - sort_order where sort_order in (1,3)` → **`23505` duplicate key**. This is the workaround the accumulated docs would suggest ([C5 in the prior-decision digest](#historical-context-from-prior-changes)) and it does not work.
- **E2** — row-by-row renumber, first statement already → `23505`.
- **F1** — **two-phase renumber works**: `update ... set sort_order = -sort_order` to park every row in negative space, then assign each target value. No schema change required. (Negative values are legal — there is no `check (sort_order > 0)`.)
- **F2** — a `deferrable initially deferred` unique **constraint** _can_ be added, but Postgres unique constraints cannot be partial, so `unique(recruitment_id, sort_order)` would cover NULL rows too — and since NULLs compare distinct, it would silently **lose** the duplicate-default protection the two partial indexes exist to provide. Swapping to it is a downgrade.
- **E3** — delete-all-then-reinsert works fine _when no candidate or history references the override rows_, which is the common case for a recruitment being customised before use.

### 6. Missing constraints and two open integrity holes

Absent from `kanban_stages` (confirmed — no `check` and no other index on this table anywhere in the migration set):

- No unique on `(recruitment_id, name)`, and none on `name where recruitment_id is null` → **duplicate stage names are legal**, globally and per recruitment.
- No length, format, or non-empty check on `name` (`not null` only — `''` is accepted).
- No `check (sort_order > 0)`, no contiguity, no upper bound on stage count.
- No way to express "a recruitment has either zero override rows or a complete set" — must be enforced in the RPC, exactly as `create_recruitment` enforces "at least one group" in-transaction ([20260901150000:30-32](../../../supabase/migrations/20260901150000_create_recruitment_returns_row.sql:30)).

The duplicate-name gap has a live coupling: [seed.sql:119-143](../../../supabase/seed.sql:119) looks stages up **by name**, e.g. `(select id from kanban_stages where recruitment_id is null and name = 'New')`. Every lookup correctly includes `recruitment_id is null`, so per-recruitment rows sharing a name are harmless — but a duplicated _global_ name would make these `= (select ...)` subqueries fail with "more than one row returned". A unique index on `name where recruitment_id is null` would make that structural.

**Integrity hole (verified, test C): nothing ties `current_stage_id` to the candidate's own recruitment.** I successfully pointed a candidate in recruitment 1 at recruitment 2's override stage. No constraint prevents it, and the board would then drop that candidate. S-03 is the first slice where this becomes reachable, so it may be worth closing (a composite FK or a trigger) or at least documenting.

### 7. The write path has a fresh template: S-02

S-02 shipped an atomic multi-row write one week ago and it survived plan review and impl review — copy it rather than inventing.

**RPC hardening contract**, [20260901150000_create_recruitment_returns_row.sql](../../../supabase/migrations/20260901150000_create_recruitment_returns_row.sql):

- Lives in **`public`, not `private`** — PostgREST only exposes `public`/`graphql_public` ([config.toml:13](../../../supabase/config.toml:13)), so a `private` function is unreachable from `.rpc()`. This was an impl-review finding on S-02 ([S-02 impl-review.md F1](../../../context/changes/recruiter-creates-recruitment/reviews/impl-review.md:33)).
- `language plpgsql` / `security definer` / `set search_path = ''`, therefore **every** identifier schema-qualified.
- **Permission re-check as the first statement**, because `security definer` bypasses RLS.
- Business-rule violations raised with distinct errcodes: `42501` for denial, `22023` for invalid input.
- **Returns the full row**, not a bare id — S-02's impl review (F3) removed a second untransacted `select` that left a window where the row was committed but the client got a 500 with no id.
- `drop function if exists` with the full signature first when the return type changes; trailing `revoke ... from public, anon` + `grant execute ... to authenticated`.

**Errcode → HTTP mapping** to clone, [recruitments/index.ts:71-88](../../../src/pages/api/recruitments/index.ts:71): `42501`→403, `22023`→422 with `fields`, `23503`→422 with `fields`, else `console.error` + 500. Note `23503` is _already_ mapped for a different cause (nonexistent group) — S-03's stage-delete-blocked case raises the same code and needs a different message, so the mapping must disambiguate.

**Endpoint skeleton** (identical across [index.ts](../../../src/pages/api/recruitments/index.ts), [[id]/index.ts](../../../src/pages/api/recruitments/[id]/index.ts), [security-groups.ts](../../../src/pages/api/security-groups.ts)): `export const prerender = false` → module-scope zod → JSON-parse guard → `safeParse` → 422 with `fields` built by `issue.path.join(".") || "root"` → `createClient` null-guard → 500 → try/catch → `jsonOk(dto, status)`. Helpers: `jsonOk(data, status = 200)` / `jsonError(status, code, message, fields?)` ([api-response.ts:3,10](../../../src/lib/api-response.ts:3)).

**Service conventions** ([recruitments.ts](../../../src/lib/services/recruitments.ts)): `type Client = SupabaseClient<Database>` redeclared per module; client first arg; destructure `{data, error}` and **throw the raw Supabase error unwrapped** (load-bearing — the endpoint reads `.code` off it); snake_case→camelCase mapping only in the service; `null` for not-found. `updateRecruitmentStatus(client, id, command)` is the precedent for mixing an id with a command object.

**Authorization nuance:** S-02's RPC only ever needed 403; distinguishing **404 (recruitment not visible) from 403 (visible but read-only)** inside an RPC is new ground. The inherited rule is 404 for both on scoped writes ([S-02 research.md:103](../../../context/changes/recruiter-creates-recruitment/research.md:103)), so the simplest consistent choice is to let a non-visible recruitment fall out as 404 and reserve 403 for the unscoped denial — but it needs an explicit decision.

### 8. Frontend: mostly precedent, one genuinely new thing

Where the affordance goes: the header flex row of [KanbanBoard.tsx:125-139](../../../src/components/recruitments/KanbanBoard.tsx:125), as a sibling to `StatusControl` — it already owns `onChanged={() => void resource.refetch()}`, so a stage editor given the same callback reuses the established mutate→refetch pattern verbatim.

Hooks: `useApiResource<T>(url)` returns a `loading | success | not-found | error` union plus `refetch()` ([useApiResource.ts:27](../../../src/components/hooks/useApiResource.ts:27)); its `refetch` deliberately duplicates the fetch body (comment at [:69-74](../../../src/components/hooks/useApiResource.ts:69) explains the `react-hooks/set-state-in-effect` reason — don't "clean it up", and an impl review already ruled on this). `useMutation<TBody,TResponse>(url, method)` returns `{mutate, status, error, fieldErrors}` and **types `method` as only `"POST" | "PATCH"`** ([useMutation.ts:23](../../../src/components/hooks/useMutation.ts:23)) — a `PUT`/`DELETE` stage endpoint requires widening that union.

Routing: `src/pages/recruitments/` holds a **flat** `[id].astro`, so a `[id]/stages.astro` page would first require converting it to `[id]/index.astro` (Astro rejects both). A dialog inside the existing board avoids that migration and matches the in-place `StatusControl` precedent. API side, `src/pages/api/recruitments/[id]/` already contains `index.ts` and `board.ts`, so a sibling `stages.ts` is the natural shape — and a prior plan review established that dynamic API routes use the directory form ([S-02 plan-review.md F4](../../../context/changes/recruiter-creates-recruitment/reviews/plan-review.md:65)). [middleware.ts:5](../../../src/middleware.ts:5) prefix-matches `/recruitments`, so any new page is auto-protected and any new `/api/**` route gets 401 handling free.

Stage names are rendered **raw** from the DB — `{stage.name}` at [KanbanBoard.tsx:145](../../../src/components/recruitments/KanbanBoard.tsx:145) is the only render site. [recruitment-status.ts](../../../src/lib/recruitment-status.ts) maps only _recruitment status_ (`draft|live|closed`), not stages, so there is no hardcoded presentation map to update; free-text names already flow through correctly.

**What's new in this codebase** (no precedent — worth planning explicitly):

1. **A variable-length list form** (add/remove/reorder rows). Every existing form has a fixed field set; the only variable-length UI is the read-only group checkbox list. Needs stable React keys for unsaved rows, per-row `sortOrder` recomputation, and — because `FormField` requires a unique `id` that doubles as `name`, and tests select by label — **distinct accessible labels per row** (`Stage 1 name`, not a repeated `Stage name`).
2. **Zod validation of an array of objects**, producing dotted field keys like `stages.0.name`. Only flat scalar arrays exist today (`z.array(z.number().int().positive()).min(1)`).
3. **Actually consuming `useMutation`'s `fieldErrors`** — `CreateRecruitmentForm` renders only `error` and never reads `fieldErrors`, so no component maps 422 field errors onto inputs yet.
4. **An RPC that DELETEs** (S-02's only inserts), and the first write policy on `kanban_stages`.

### 9. Tests, CI, and a sequencing opportunity

Four layers, all with templates:

- **Unit** — hand-rolled `FakeQueryBuilder` in [recruitments.test.ts:24-65](../../../src/lib/services/recruitments.test.ts:24); `makeBoardClient` maps table name → fake. If the read path switches to `.or()`, the fake needs that method and must return mixed default/override rows. An RPC-only write needs no new fake methods beyond the `makeCreateClient` `{rpc: () => Promise.resolve(...)}` shape (note its fake error carries `code?: string` so errcode propagation is asserted).
- **Component** — `@testing-library/react` + `user-event`, `vi.stubGlobal("fetch", mockFetch({...}))` where `mockFetch` **throws on any unexpected URL** ([CreateRecruitmentForm.test.tsx:11-26](../../../src/components/recruitments/CreateRecruitmentForm.test.tsx:11)) — a new endpoint must be registered there.
- **Integration** — [integration-client.ts](../../../src/lib/test-support/integration-client.ts) signs in through the real `/api/auth/signin` with an explicit `Origin` header (Astro CSRF) and replays the session cookie. Roles `hr | hiringManager | admin`; **HR is the only role with `recruitment.write`** ([seed.sql:15-21](../../../supabase/seed.sql:15)). Requires a running Supabase **and** Astro server — documented in the file header.
- **E2E** — `signInAs(page, role)` with the hydration-race `toPass()` retry ([support/auth.ts:26-31](../../../tests/e2e/support/auth.ts:26)) that any island form fill must use. `test.beforeAll` discovers the recruitment id via the API rather than hardcoding it. **`STAGE_ORDER` at [recruitments.spec.ts:4](../../../tests/e2e/recruitments.spec.ts:4) is asserted as the board's `h2` headings** — S-03 changes what that means for a customised recruitment, so expect to touch this constant and its assertions.
- **RLS** — [rls_verification.sql](../../../supabase/tests/rls_verification.sql), 9 assertions, `begin` / fake JWT claims / `set local role authenticated` / `do $$ raise exception 'FAIL: ...' $$` / `rollback`. **No existing assertion touches `kanban_stages`.** Must be run via `docker exec -i supabase_db_10x-astro-starter psql ... < file` — `npx supabase db query --local -f` cannot run a multi-statement script (F-01 lesson, restated in [S-02 impl-review.md:28](../../../context/changes/recruiter-creates-recruitment/reviews/impl-review.md:28)); note the script's own header comment at [:9](../../../supabase/tests/rls_verification.sql:9) still recommends the broken invocation.

CI ([ci.yml](../../../.github/workflows/ci.yml)): the `ci` job is DB-free (unit tests must stay infra-free); the `e2e` job enforces **`db:types` drift** (`npm run db:types` then `git diff --exit-code src/db/database.types.ts`), then runs integration tests, then **resets the DB before e2e** because integration tests leave real rows behind. S-03 adds a migration, so the types file must be regenerated and committed in the same commit.

**Sequencing opportunity.** S-04 (add/move candidates) has not shipped, so there is currently **no way in the app to create or move a candidate** — the only `candidate_recruitments` and history rows are the 5+5 from `seed.sql`, and `override_stages = 0`. If S-03 lands before S-04, every real recruitment a user creates has zero candidates, which makes "configure stages before use" (§4, option 3) far cheaper than it sounds and defers the whole re-map/history question. The roadmap places S-03 before S-04 in Stream A ([roadmap.md:59](../../../context/foundation/roadmap.md:59)) but _also_ marks them "parallel with" each other ([roadmap.md:134](../../../context/foundation/roadmap.md:134)) — that parallelism is the risky reading, since both slices write `current_stage_id` and S-04 owns the note-gate contract.

## Empirical Verification Log

Everything below was run against the live local stack at commit `897e96a`, each inside `begin ... rollback`. This section exists because a prior plan review noted that findings which "read as plausible under inspection alone" were sometimes wrong ([S-01 plan-review.md:116](../../../context/changes/recruiter-views-kanban-board/reviews/plan-review.md:116)).

| #   | Test                                                                                                           | Result                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Effective grants on `kanban_stages`                                                                            | `authenticated` holds SELECT, **INSERT, UPDATE, DELETE**, REFERENCES, TRIGGER, TRUNCATE — contradicting the `grant select`-only reading |
| —   | HR inserts an override row, **no** policy added                                                                | Blocked, `42501 new row violates row-level security policy` (a _policy_ error, not a privilege error)                                   |
| A1  | HR inserts an override row with **only a policy** added, no grant change                                       | **Succeeded** → the grant was never the blocker                                                                                         |
| A2  | HR inserts a **global default** row (`recruitment_id = null`) under a `recruitment_id is not null` policy      | Blocked, `42501` → defaults stay immutable, as desired                                                                                  |
| B1  | Delete a stage that has a candidate on it                                                                      | Blocked, `23503` on `candidate_recruitments_current_stage_id_fkey`                                                                      |
| B2  | Delete an unreferenced stage (`Rejected`)                                                                      | Succeeded                                                                                                                               |
| B3  | Move all candidates off a stage, **then** delete it                                                            | **Still blocked**, `23503` on `candidate_recruitment_status_history_to_stage_id_fkey` → used stages are permanently undeletable         |
| C   | Point a candidate in recruitment 1 at recruitment 2's override stage                                           | **Allowed** → no constraint ties `current_stage_id` to the candidate's own recruitment                                                  |
| D   | One-query override resolution (`recruitment_id is null or recruitment_id = 1`)                                 | Returns 8 rows with overrides present, 6 with none → partitioning in JS works                                                           |
| H   | With a 3-stage override set on recruitment 1, how many of its 5 candidates sit on a stage in the resolved set? | **0 of 5** → all candidates silently vanish from the board                                                                              |
| E1  | Reorder via a single set-based `update ... set sort_order = 4 - sort_order`                                    | Failed, `23505` → the "single UPDATE" workaround does **not** work                                                                      |
| E2  | Reorder row-by-row                                                                                             | Failed, `23505` on the first statement                                                                                                  |
| E3  | Delete-all-then-reinsert an override set with no candidate/history references                                  | Succeeded                                                                                                                               |
| F1  | Two-phase renumber (negate all, then assign targets)                                                           | **Succeeded**, no schema change needed                                                                                                  |
| F2  | Add a `deferrable initially deferred` unique constraint                                                        | Succeeded — but cannot be partial, so it would cover NULL rows and lose duplicate-default protection                                    |
| G   | HR re-maps all 5 candidates onto a new override stage under **existing** RLS                                   | **Succeeded** (5 rows) → `candidate_recruitments_update` already suffices; no new policy needed for the re-map                          |

## Code References

- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:37-49` — `kanban_stages` table + the two partial unique indexes
- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:51-60` — default stage rows shipped as product config
- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:83,97,98` — the three FKs that pin stage rows
- `supabase/migrations/20260831183457_rls_policies.sql:163-173` — the select-only policy and the "S-03's job" comment
- `supabase/migrations/20260831183457_rls_policies.sql:241` — the `grant select` line (misleading; see §3)
- `supabase/migrations/20260831181826_security_rbac_schema.sql:10-16` — the fixed 5-value `operation` enum
- `supabase/migrations/20260831195143_mark_rls_helpers_stable.sql:5-36` — `has_operation` / `has_recruitment_operation`
- `supabase/migrations/20260901150000_create_recruitment_returns_row.sql` — the RPC hardening template to copy
- `supabase/migrations/20260831194556_fix_status_history_changed_by_on_delete.sql` — precedent for fixing a missing `on delete` clause
- `src/lib/services/recruitments.ts:129-133` — the defaults-only stages query that must change
- `src/lib/services/recruitments.ts:162-171` — stage-driven grouping (where candidates silently vanish)
- `src/lib/services/recruitments.ts:60-86` — `createRecruitment`, the RPC-calling service template
- `src/pages/api/recruitments/index.ts:71-88` — the errcode→HTTP mapping block
- `src/pages/api/recruitments/[id]/board.ts` — endpoint template for a `[id]/stages.ts` sibling
- `src/types.ts:51-75` — the kanban DTOs (no provenance field)
- `src/components/recruitments/KanbanBoard.tsx:125-139` — the header row where a stage-editor affordance belongs
- `src/components/hooks/useMutation.ts:23` — the `"POST" | "PATCH"` method union to widen
- `supabase/tests/rls_verification.sql` — RLS assertion harness (nothing covers `kanban_stages` yet)
- `tests/e2e/recruitments.spec.ts:4` — `STAGE_ORDER`, which S-03 changes the meaning of

## Architecture Insights

- **Stages are data, not schema** — the guiding principle from F-01, restated in [S-01 research.md:202](../../../context/changes/recruiter-views-kanban-board/research.md:202). It made the schema side of S-03 free, and its corollary obligation (read stages from the table, key candidates by `current_stage_id`, never by name or position) was honoured by S-01, which is why only one query needs changing.
- **Authorization lives entirely in Postgres.** No client-side capability gating anywhere, by explicit decision — the middleware `/api` guard is authentication, not authorization. S-03's consequence: a Hiring Manager **will** see the stage-editor affordance and must get a clean denial, not a crash. This exact behavior was verified for the status control in S-02's review (F7).
- **Forbidden is indistinguishable from missing, by design** — RLS returns zero rows for both and both surface as 404, rather than probing existence with elevated privileges and leaking it. Accepted cost, revisit at S-07.
- **PostgREST has no cross-call transaction**, so any multi-statement write must be a single `security definer` RPC in `public`. S-02 proved this the hard way; S-03's "replace a stage set (+ possibly re-map candidates)" is the same shape.
- **Append-only history is a one-way ratchet on referenced rows.** The design choice that makes history trustworthy (no UPDATE/DELETE, ever) is exactly what makes stages undeletable. This tension is new with S-03 and is the slice's central design constraint — the team's established instinct is to prefer a hard block over silent corruption ([F-01 plan-brief.md:27](../../../context/changes/core-recruitment-data-foundation/plan-brief.md:27)), which argues for soft-delete over any scheme that quietly drops data.
- **Empirical verification beats inspection** for this codebase's RLS/constraint questions — two confident readings of the migrations (grants, single-statement reorder) were both wrong, and a third (the deadlock in S-02) was only found by running it.

## Historical Context (from prior changes)

- [F-01 plan.md:98-101](../../../context/changes/core-recruitment-data-foundation/plan.md:98) — designed the nullable `recruitment_id` override slot and the two partial indexes, naming S-03 as owner.
- [F-01 plan.md:28](../../../context/changes/core-recruitment-data-foundation/plan.md:28) / [:168](../../../context/changes/core-recruitment-data-foundation/plan.md:168) — deliberately withheld write policies on `kanban_stages`.
- [S-01 research.md:77](../../../context/changes/recruiter-views-kanban-board/research.md:77) — **"Nothing in the DB coalesces override rows over defaults — if you want override-aware behavior you write it yourself."** The single most load-bearing prior finding for this slice.
- [S-01 plan.md:40](../../../context/changes/recruiter-views-kanban-board/plan.md:40) — "Read stages from the table regardless, never hardcode, so S-03 stays a pure insert." Honoured, but the query itself was still hardcoded to defaults.
- [S-02 research.md:49](../../../context/changes/recruiter-creates-recruitment/research.md:49) / [:154](../../../context/changes/recruiter-creates-recruitment/research.md:154) — re-verified the boundary and stayed out of `kanban_stages`.
- [S-02 impl-review.md](../../../context/changes/recruiter-creates-recruitment/reviews/impl-review.md) — F1 (RPCs must live in `public`), F3 (return the full row, not a bare id), F7 (no client-side gating; read-only roles see affordances and must get a clean denial). All three apply directly.
- [lessons.md:5-10](../../../context/foundation/lessons.md:5) — the English-only-artifacts rule, whose _Problem_ paragraph is literally the Polish-kanban-stage-names incident. Relevant twist for S-03: the rule binds **files**, not runtime input. Nothing currently prohibits a user typing a Polish stage name into the editor, and no prior doc addresses whether that's acceptable.
- **The rename-migration guarantee expires with S-03.** S-01's Migration Notes justified the English rename as safe because "no per-recruitment override rows can exist (no write grant)". After S-03 that is false: a future rename migration cannot enumerate user-created override rows.
- **No prior document has ever discussed** stage deletion, stage migration, re-mapping candidates between stages, or what happens when a stage set changes while candidates exist. I grepped all of `context/` for each. S-03 is the first slice to face it.
- `context/archive/` is empty; the archived `shape-notes-2026-05-27-1200.md` describes a **superseded product concept** — [S-01 research.md:224](../../../context/changes/recruiter-views-kanban-board/research.md:224) warns explicitly not to mine it for requirements.

## Related Research

- [context/changes/recruiter-views-kanban-board/research.md](../../../context/changes/recruiter-views-kanban-board/research.md) — S-01's board read path; §"Architecture Insights" and the coalescing gap at `:77`
- [context/changes/recruiter-creates-recruitment/research.md](../../../context/changes/recruiter-creates-recruitment/research.md) — S-02's write path, the PostgREST no-transaction finding, and the RLS-deadlock discovery
- [context/changes/core-recruitment-data-foundation/plan.md](../../../context/changes/core-recruitment-data-foundation/plan.md) — the schema and RLS contract

## Open Questions

Decisions the plan must make explicitly. None are answered by the PRD, which says nothing about stage limits, renaming vs reordering vs deleting, or whether the default set itself is editable.

1. **What operations does "customize" include?** Rename only? Reorder? Add? Remove? Removal is the expensive one (§4) and the only one that forces a soft-delete column or a "before first use" restriction. _Owner: user/product._
2. **What happens to candidates already on default stages when overrides are first adopted?** Verified: they vanish from the board unless re-mapped (test H). Options: block customization once candidates exist; auto-map by position/name; require the recruiter to choose a target stage per candidate. _Owner: user/product._
3. **Does an S-03-driven re-map write `candidate_recruitment_status_history` rows, and with what `changed_by`?** And is it exempt from the PRD's hard "no note, no move" rule ([prd.md:123-125](../../../context/foundation/prd.md:123)), which S-04 owns? Nothing in either slice's docs addresses a config-driven bulk move. _Owner: user/product._ **This is the S-03/S-04 boundary question and the strongest argument against running them in parallel.**
4. **Is the global default set itself editable, and by whom?** FR-004 says only that it can be overridden; the roadmap narrows S-03 to the override part; the defaults ship as migration-managed product config with no write policy. Leaving them immutable (§3) is the low-risk default but should be a stated choice, and may belong to S-07's admin surface. _Owner: user/product._
5. **Validation rules for user-entered stage names** — max length, trimming, empty rejection, duplicates within a recruitment (currently all legal, §6), and whether non-English names are acceptable at runtime. No prior guidance exists for free-text domain strings; the repo's zod-enum precedent doesn't apply. _Owner: team, at plan time._
6. **Minimum and maximum stage count.** The RPC must enforce ≥1 in-transaction (nothing in the schema can). Is there an upper bound? The board is a horizontal scroll container, so a very wide set degrades but does not break. _Owner: team, at plan time._
7. **Should the two integrity holes be closed in this slice?** (a) `current_stage_id` not tied to the candidate's own recruitment (verified reachable, test C); (b) `from_stage_id` missing `on delete set null`, the same bug class already fixed for `changed_by`. Both are pre-existing, neither is strictly S-03's, but S-03 is what makes (a) reachable. _Owner: team, at plan time._
8. **`STAGE_ORDER` in the e2e suite** ([recruitments.spec.ts:4](../../../tests/e2e/recruitments.spec.ts:4)) currently asserts the seeded board's headings. Does S-03's e2e customise the seeded recruitment (breaking S-01's assertions) or create its own? _Owner: team, at plan time._
9. **Stale roadmap statuses.** F-01/S-01/S-02 are all `impl_reviewed` in their own `change.md`, while [roadmap.md:44-46](../../../context/foundation/roadmap.md:44) still shows them `in-progress`, [:184](../../../context/foundation/roadmap.md:184) gates S-03 on them, and "Done" is empty. Flagged twice before and still unfixed — worth a cleanup pass independent of this slice.
