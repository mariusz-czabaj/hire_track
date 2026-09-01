# Recruiter Customizes Kanban Stages Implementation Plan

## Overview

Let a recruiter replace a recruitment's kanban stage set with a custom one — add, rename, reorder, and remove stages, or reset back to the global defaults — while the recruitment has no candidates. Make the board read path override-aware so custom sets actually render. Ship an admin-gated API for editing the global default set, with per-row delete safety, but no admin UI (that belongs to S-07).

This is roadmap slice **S-03**, PRD **FR-004**.

## Current State Analysis

The schema slot for overrides already exists and was designed for this slice. `kanban_stages` carries a nullable `recruitment_id` (NULL = global default row, non-NULL = per-recruitment override) plus two *partial* unique indexes on `sort_order` — partial rather than plain, because Postgres treats every NULL as distinct and a plain `unique(recruitment_id, sort_order)` would not catch duplicate default rows ([recruitment_candidate_schema.sql:37-58](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:37)). F-01 named S-03 as the owner of the write side in three separate places and deliberately withheld the write policies.

What does **not** exist:

- **No write policy on `kanban_stages`.** The only policy is `kanban_stages_select` ([rls_policies.sql:168-173](../../../supabase/migrations/20260831183457_rls_policies.sql:168)), which already handles both partitions correctly for reads.
- **No override awareness in the read path.** `getKanbanBoard` hardcodes `.is("recruitment_id", null)` ([recruitments.ts:129-133](../../../src/lib/services/recruitments.ts:129)) and never references `recruitmentId` in the stages query.
- **No provenance in the DTO.** `KanbanBoardDto` ([types.ts:51-75](../../../src/types.ts:51)) cannot express "this board is on defaults" vs "this board is customized".
- **No stages endpoint, no stage-write RPC, no stage editor UI.**
- **No `rls_verification.sql` assertion touches `kanban_stages`** — the 9 existing assertions cover other tables entirely.

The research phase verified everything below empirically against the live local stack at commit `897e96a`, each test inside `begin ... rollback`. Three findings invalidate the roadmap's "low risk, purely additive, Unknowns: —" characterisation of this slice, and two correct readings of the migrations that would otherwise have been believed.

### Key Discoveries:

- **The board read path ignores override rows, and candidates silently vanish.** With a 3-stage override set on the seeded recruitment, **0 of its 5 candidates** remained on a stage in the resolved set — no error, no card, and `candidateCount` silently under-reporting. The board reads `candidatesByStage` only *through* the stage list ([recruitments.ts:162-171](../../../src/lib/services/recruitments.ts:162)), so a candidate whose `current_stage_id` is not in the returned list is never looked up. **S-03 must change S-01's read path — it is not additive.** (research test H)
- **A stage becomes permanently undeletable once any candidate has ever passed through it.** `candidate_recruitments.current_stage_id` is `on delete restrict`; `candidate_recruitment_status_history.to_stage_id` is `not null` with no on-delete clause (so `NO ACTION`) on an append-only table with no DELETE policy. Moving every candidate off the stage first and *then* deleting **still fails** on the history FK. (research tests B1/B2/B3)
- **Reordering collides with a non-deferrable partial unique index, and the obvious workaround does not work.** A single set-based `update ... set sort_order = 4 - sort_order` fails with `23505`, as does a row-by-row renumber. Unique *indexes* are enforced per-row and immediately, unlike deferrable unique *constraints*. A **two-phase renumber** — negate every row's `sort_order` to park it, then assign targets — works with no schema change. Negative values are legal; there is no `check (sort_order > 0)`. (research tests E1/E2/F1)
- **Grants are already in place; only a policy is missing.** [rls_policies.sql:241](../../../supabase/migrations/20260831183457_rls_policies.sql:241) reads `grant select on kanban_stages to authenticated` and the file's comments imply grants are the gate, but Supabase's bootstrap already grants all DML on public-schema tables to `authenticated` and it is never revoked. Adding **only** an RLS policy made an HR insert succeed. The failure mode without a policy is `42501 new row violates row-level security policy`, not a privilege error. (research tests A1/A2)
- **A composite FK cannot enforce stage↔recruitment consistency.** `candidate_recruitments.recruitment_id` and `current_stage_id` are both `not null` ([recruitment_candidate_schema.sql:78-85](../../../supabase/migrations/20260831182957_recruitment_candidate_schema.sql:78)), so a composite FK to `kanban_stages(recruitment_id, id)` would be enforced under MATCH SIMPLE and would reject every candidate sitting on a global default stage (`stage.recruitment_id IS NULL ≠ recruitment_id`) — breaking all 5 seeded candidates and the entire default path. **The rule must be a trigger.**
- **No new `operation` enum value is needed.** The catalog is fixed at 5 values ([security_rbac_schema.sql:10-16](../../../supabase/migrations/20260831181826_security_rbac_schema.sql:10)). Scoped `private.has_recruitment_operation(id, 'recruitment.write')` gates the override path; unscoped `private.has_operation('group.manage')` gates the defaults path — the seeded `Administrator` group already holds exactly that one operation and nothing else ([seed.sql:15-21](../../../supabase/seed.sql:15)). Adding a bespoke value would also need its own migration file, since `alter type ... add value` cannot be used in the transaction that added it.
- **`candidate_recruitments_update` already permits the candidate re-map** under existing RLS (research test G) — not needed given the zero-candidates gate, but it means no policy work is blocked on it.
- **S-02 is a fresh, reviewed template for the write path**, shipped a week ago: `security definer` RPC in `public` (not `private` — PostgREST only exposes `public`/`graphql_public`), permission re-check as the first statement, distinct errcodes, returns the full row, four test layers ([20260901150000_create_recruitment_returns_row.sql](../../../supabase/migrations/20260901150000_create_recruitment_returns_row.sql)).
- **No app path creates or moves candidates yet.** S-04 has not shipped, so the only `candidate_recruitments` and history rows are the seeded ones, and every recruitment a user creates today has zero candidates. This is what makes the zero-candidates gate cheap rather than crippling.

## Desired End State

A recruiter with `recruitment.write` on a recruitment opens its kanban board, clicks a control in the header beside the status control, and edits the recruitment's stage list in a dialog: rename any stage, drag or move stages into a new order, add stages, remove stages, or reset the whole set back to the global defaults. Saving replaces the recruitment's stage set atomically; the board refetches and renders the new columns. If the recruitment already has candidates, the editor explains that stages can no longer be changed and the save path refuses. A Hiring Manager who can see the board sees the control and receives a clean 403, not a crash.

An administrator holding `group.manage` can, via the API, edit the global default set — renaming and reordering freely, adding new stages, and removing only stages no candidate or history row references. Recruitments with no override rows continue to inherit whatever the defaults currently are.

Verify by: opening a freshly created recruitment's board, customizing its stages, and confirming the columns change; confirming a recruitment left alone still shows the 6 defaults; confirming the seeded recruitment (which has candidates) refuses customization.

## What We're NOT Doing

- **No admin UI for the global defaults.** The RPC, its authorization, and its tests ship; the screen belongs to S-07's admin surface.
- **No candidate re-mapping.** Customization is blocked once candidates exist, which removes the re-map entirely — and with it the question of whether a config-driven bulk move writes `candidate_recruitment_status_history` rows and whether it is exempt from the PRD's no-note-no-move rule. **That question is S-04's to answer, not this slice's.**
- **No soft-delete / `archived_at` column on `kanban_stages`.** The zero-candidates gate makes it unnecessary for overrides, and the defaults path refuses rather than archives.
- **No change to the append-only history contract.** No UPDATE or DELETE policy on `candidate_recruitment_status_history`, ever.
- **No `from_stage_id on delete set null` fix and no history stage-FK indexes.** Both were offered and declined; they remain noted pre-existing items.
- **No uniqueness constraint on stage names** beyond the global-defaults case (see Phase 1) — duplicate names within one recruitment's set remain legal.
- **No maximum stage count.** Minimum of 1 only.
- **No changes to `STAGE_ORDER` or S-01's seeded-board e2e assertions.**
- **No roadmap status cleanup** for the stale F-01/S-01/S-02 entries (research open question 9) — worth doing, but independent of this slice.

## Implementation Approach

Six phases, ordered so that each one is independently verifiable and nothing renders a broken board along the way.

The database work lands first and in two pieces: policies and integrity constraints (Phase 1), then the RPCs that use them (Phase 2). Splitting them means the RLS assertions in Phase 1 test the policies directly, without an RPC's `security definer` bypassing them.

Phase 3 fixes the read path **before** any UI can create override rows, so there is never a window where a custom set exists and the board silently drops candidates. This ordering is load-bearing.

Phases 4–6 then layer the endpoint, the UI, and the e2e coverage on top.

Two distinct write algorithms are needed, and they are not interchangeable:

- **Overrides — delete-all-then-reinsert.** The zero-candidates gate guarantees no `candidate_recruitments` or history row references any of the recruitment's override stages, so a wholesale delete is safe (research test E3). Fresh inserts get clean `sort_order` values, which sidesteps the `23505` reorder trap entirely.
- **Defaults — diff in place.** Default rows *are* referenced, so they cannot be deleted wholesale. Match submitted rows to existing ones by id, rename in place, apply the two-phase negate-then-assign renumber for order, insert net additions, and delete only rows that no `candidate_recruitments` and no `candidate_recruitment_status_history` row references — refusing with a message naming the stage otherwise.

## Critical Implementation Details

**Ordering.** Phase 3 (override-aware read) must land before Phase 5 (the UI that creates overrides). If a user can create a custom set while the board still reads only defaults, every candidate on that board disappears with no error. There is no partial-credit version of this; treat the ordering as a hard constraint, not a preference.

**The two-phase renumber is not optional in the defaults path.** Any attempt to reorder default rows with a single `UPDATE` — including the set-based `CASE` form that reads as the obvious answer — fails with `23505`. Park every affected row in negative `sort_order` space first, then assign targets in a second statement.

**`security definer` bypasses RLS**, so every RPC must re-check permission as its *first* statement, following [create_recruitment](../../../supabase/migrations/20260901150000_create_recruitment_returns_row.sql)'s shape. `set search_path = ''` means every identifier must be schema-qualified.

**`23503` is already mapped** in the errcode→HTTP block for a different cause (a nonexistent group, [recruitments/index.ts:71-88](../../../src/pages/api/recruitments/index.ts:71)). The defaults path's "stage is still referenced" refusal must not reuse it ambiguously — raise a distinct errcode from the RPC rather than letting a raw FK violation surface.

**Denial semantics.** A recruitment the caller cannot see must fall out as **404** (preserving the established "forbidden is indistinguishable from missing" posture); a recruitment the caller *can* see but lacks `recruitment.write` on must return **403**. Distinguishing these two inside an RPC is new ground — S-02's only ever needed 403.

---

## Phase 1: Schema, Policies & Integrity

### Overview

Add the write policies `kanban_stages` has never had, close the stage↔recruitment integrity hole with a trigger, add the name and defaults-uniqueness constraints, and give this table its first RLS assertions.

### Changes Required:

#### 1. Stage write policies and constraints

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_kanban_stage_customization.sql`

**Intent**: Grant the write access F-01 deliberately withheld, split by partition: recruiters may write their own recruitment's override rows; administrators may write the global defaults. Close the verified-reachable cross-recruitment stage hole, and make the defaults-name assumption that `seed.sql` already depends on structural.

**Contract**:
- `kanban_stages_insert` / `kanban_stages_update` / `kanban_stages_delete` policies `for ... to authenticated`. Each predicate is the disjunction of the two partitions: `recruitment_id is not null and (select private.has_recruitment_operation(recruitment_id, 'recruitment.write'))` **or** `recruitment_id is null and (select private.has_operation('group.manage'))`. Wrap helper calls in `(select ...)` per the file's convention so the `stable` function is evaluated once per statement rather than per row ([rls_policies.sql:143-144](../../../supabase/migrations/20260831183457_rls_policies.sql:143)). `update` needs both `using` and `with check`.
- A trigger function in `private` plus a `before insert or update` trigger on `candidate_recruitments`, raising when `current_stage_id` resolves to a stage whose `recruitment_id` is neither NULL nor equal to the row's `recruitment_id`. **Not** a composite FK — see Key Discoveries for why one cannot work here.
- `check` constraint on `kanban_stages.name`: non-empty after trim, and length within the agreed cap.
- `create unique index kanban_stages_default_name_key on kanban_stages (name) where recruitment_id is null;` — `seed.sql`'s `= (select id from kanban_stages where recruitment_id is null and name = '...')` lookups ([seed.sql:119-143](../../../supabase/seed.sql:119)) fail with "more than one row returned" on a duplicate, and admins can now create one.
- Grants: adding `insert, update, delete on kanban_stages to authenticated` is harmless documentation, but it is **not** what unblocks the write — the policies are. Do not let a passing test be attributed to the grant.

#### 2. RLS assertions for `kanban_stages`

**File**: `supabase/tests/rls_verification.sql`

**Intent**: This table has never been covered. Assert each partition of the new policies, including the two denials that are easy to get silently wrong.

**Contract**: Follow the existing harness shape exactly — `begin` / fake JWT claims / `set local role authenticated` / `do $$ ... raise exception 'FAIL: ...' $$` / `rollback`. Assertions: HR inserts an override row on a recruitment they are linked to (allowed); HR inserts a global default row (denied — defaults stay administrator-only); HR inserts an override row on a recruitment they are *not* linked to (denied); Administrator updates a global default (allowed); Administrator inserts an override row on a recruitment they are not linked to (denied — `group.manage` is not a recruitment scope); the consistency trigger rejects pointing a candidate at another recruitment's stage.

**Run it with** `docker exec -i supabase_db_10x-astro-starter psql ... < file`. `npx supabase db query --local -f` cannot run a multi-statement script — an F-01 lesson restated in [S-02's impl review](../../../context/changes/recruiter-creates-recruitment/reviews/impl-review.md:28). The script's own header comment at [:9](../../../supabase/tests/rls_verification.sql:9) still recommends the broken invocation; ignore it.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh reset: `npx supabase db reset`
- `rls_verification.sql` passes end to end via the `docker exec` invocation
- Linting passes: `npm run lint`
- Existing unit tests still pass: `npm test`

#### Manual Verification:

- Seed data loads unchanged — the seeded board still shows its 6 default stages with 5 candidates distributed across them
- Confirm in psql that an HR insert of a global default row is denied with `42501`, not a privilege error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Stage-Write RPCs

### Overview

Three `security definer` RPCs in `public`, following S-02's hardening contract. The two override RPCs are simple; the defaults RPC carries the diff, the renumber, and the referenced-row refusal.

### Changes Required:

#### 1. Override replace and reset

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_kanban_stage_rpcs.sql`

**Intent**: Replace a recruitment's stage set atomically, or drop its overrides so it reverts to inheriting the defaults. Both refuse when the recruitment already has candidates.

**Contract**:
- `public.replace_recruitment_stages(target_recruitment_id bigint, stage_names text[])` — `language plpgsql`, `security definer`, `set search_path = ''`. First statement re-checks `private.has_recruitment_operation(target_recruitment_id, 'recruitment.write')`. Then: refuse if any `candidate_recruitments` row exists for the recruitment; validate `array_length >= 1` and per-name trim/non-empty/length; delete the recruitment's existing override rows; insert the new set with `sort_order` assigned by array position starting at 1. Returns the resulting stage rows.
- `public.reset_recruitment_stages(target_recruitment_id bigint)` — same gates, deletes all override rows for the recruitment, returns nothing or the now-inherited default set.
- Distinct errcodes per S-02's contract: `42501` for authorization denial, `22023` for invalid input, and a distinct code for the candidates-exist refusal so the endpoint can give it its own message.
- Trailing `revoke ... from public, anon` + `grant execute ... to authenticated`.

#### 2. Defaults diff RPC

**File**: same migration

**Intent**: Let an administrator edit the global default set in place. Default rows are referenced by candidates and history, so this cannot be delete-and-reinsert.

**Contract**: `public.update_default_stages(stages jsonb)` where each element carries an optional `id` (null for a new stage) and a `name`, with array position giving the new order. First statement re-checks `private.has_operation('group.manage')`.

The algorithm, in order:
1. Validate: at least one stage; every name trimmed, non-empty, within the length cap; every supplied `id` must be an existing row with `recruitment_id is null`; no duplicate names in the submitted set (the new unique index would reject it anyway, but a clean `22023` beats a raw `23505`).
2. Determine removals — existing default rows whose id is not in the submitted set. For each, refuse if any `candidate_recruitments.current_stage_id` or any `candidate_recruitment_status_history.from_stage_id`/`to_stage_id` references it, raising a distinct errcode with a message naming the stage. Note the FK check here is a sequential scan on history, since neither history stage column is indexed and indexing them was explicitly declined.
3. Rename in place.
4. **Two-phase renumber**: `update ... set sort_order = -sort_order where recruitment_id is null` to park every default row, then assign each target value. A single-statement reorder fails with `23505` (research tests E1/E2); the negate-then-assign form is verified working (F1).
5. Insert net additions, then delete the (now verified unreferenced) removals.

#### 3. Regenerate database types

**File**: `src/db/database.types.ts`

**Intent**: CI's `e2e` job runs `npm run db:types` and then `git diff --exit-code` on this file, so a stale types file fails the build.

**Contract**: Regenerate and commit in the same commit as the migration.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- `npm run db:types` produces no diff: `git diff --exit-code src/db/database.types.ts`
- Type checking passes: `npm run lint`

#### Manual Verification:

- In psql as HR: replace a candidate-free recruitment's stages, confirm the rows land with contiguous `sort_order` from 1
- In psql as HR: attempt the same on the seeded recruitment (which has candidates) and confirm the candidates-exist refusal
- In psql as Administrator: reorder the default set and confirm the two-phase renumber succeeds where a single `UPDATE` would raise `23505`
- In psql as Administrator: attempt to remove a default stage that has candidates on it and confirm the refusal names the stage

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 3: Override-Aware Read Path

### Overview

Fix the query that would otherwise make every candidate vanish the moment a custom set exists, and give the DTO the provenance the UI needs. **This must land before Phase 5.**

### Changes Required:

#### 1. Resolve overrides over defaults

**File**: `src/lib/services/recruitments.ts`

**Intent**: `getKanbanBoard` currently reads only global defaults. Fetch both partitions in one round trip and pick the override set when one exists, falling back to defaults otherwise — all-or-nothing, matching the resolution semantics the DTO will expose.

**Contract**: The stages query adds `recruitment_id` to its `select` (it is not selected today, and is needed to partition on) and replaces `.is("recruitment_id", null)` with a filter matching either partition. Prefer a non-interpolating filter form over string-interpolating `recruitmentId` into `.or()`, so the service stays safe when called standalone. A single `.order("sort_order")` interleaves the two sets, so sort per partition *after* splitting. RLS-safe: `kanban_stages_select` already permits both partitions, and the board's first query has already proven read access to the recruitment.

The grouping logic below is unchanged and must stay stage-list-driven, not candidate-driven — that is what makes empty stages like `Rejected` still render, and it was an explicit S-01 requirement.

#### 2. Board provenance

**File**: `src/types.ts`

**Intent**: Let the client tell whether a board is inheriting defaults or running a custom set, so the editor can show an "inheriting defaults" state and offer reset only when it applies.

**Contract**: Add `stagesSource: "default" | "custom"` to `KanbanBoardDto`. Board-level, not per-stage — resolution is all-or-nothing, so a per-stage flag would always be uniform within a response.

#### 3. Unit tests

**File**: `src/lib/services/recruitments.test.ts`

**Intent**: Cover both resolution branches and the regression this phase exists to prevent.

**Contract**: The hand-rolled `FakeQueryBuilder` ([recruitments.test.ts:24-65](../../../src/lib/services/recruitments.test.ts:24)) needs whichever filter method the new query uses, and `makeBoardClient` must return mixed default/override rows. Cases: no override rows → defaults returned, `stagesSource: "default"`; override rows present → only overrides returned, sorted, `stagesSource: "custom"`; candidates on override stages appear on the right columns with correct counts. Unit tests must stay infra-free — CI's `ci` job is DB-free.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- The seeded board renders exactly as before (6 default stages, 5 candidates) — no regression
- With an override set inserted manually in psql for a candidate-free recruitment, that board renders the custom columns and reports `stagesSource: "custom"`

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 4: Stages API Endpoint

### Overview

A `GET`/`PUT` endpoint over the recruitment's stage set, wrapping the RPCs with the established validation and errcode→HTTP mapping.

### Changes Required:

#### 1. Service functions

**File**: `src/lib/services/recruitments.ts`

**Intent**: Wrap the RPCs following the module's existing conventions.

**Contract**: Functions taking `client` first, then id, then a command object — mirroring `updateRecruitmentStatus(client, id, command)`. Destructure `{ data, error }` and **throw the raw Supabase error unwrapped**; this is load-bearing, because the endpoint reads `.code` off it. snake_case→camelCase mapping happens only here. Return `null` for not-found.

#### 2. The endpoint

**File**: `src/pages/api/recruitments/[id]/stages.ts`

**Intent**: Read the current stage set and replace it. `PUT` is the honest verb for whole-set replacement and matches the all-or-nothing model. The directory form is already established here — `[id]/` holds `index.ts` and `board.ts`, and a prior plan review ruled that dynamic API routes use it.

**Contract**: Follow the skeleton shared by every existing endpoint: `export const prerender = false` → module-scope zod → JSON-parse guard → `safeParse` → 422 with `fields` built by `issue.path.join(".") || "root"` → `createClient` null-guard → 500 → try/catch → `jsonOk(dto, status)`. Helpers are `jsonOk` / `jsonError` from [api-response.ts](../../../src/lib/api-response.ts).

The body schema validates an array of stage objects, min length 1, each with a trimmed non-empty name within the length cap. This produces **dotted field keys** like `stages.0.name` — new territory; only flat scalar arrays exist today. Reset is expressed as its own request shape or a distinct route on the same file, whichever reads cleaner alongside the replace path.

Errcode→HTTP mapping, cloning [recruitments/index.ts:71-88](../../../src/pages/api/recruitments/index.ts:71): `42501`→403, `22023`→422 with `fields`, the candidates-exist code→422 with a message explaining stages are locked once candidates are added, the still-referenced code→422 naming the stage, else `console.error` + 500. **Do not collapse the new refusals into the existing `23503`→422 mapping**, which already means "nonexistent group".

Denial split: a recruitment the caller cannot see yields 404 via the existing not-found path; visible-but-no-`recruitment.write` yields 403.

[middleware.ts:5](../../../src/middleware.ts:5) prefix-matches, so this route gets 401 handling for free.

#### 3. Integration tests

**File**: `src/lib/services/` integration suite, following the existing pattern

**Intent**: Prove the authorization matrix end to end against the real stack.

**Contract**: Use [integration-client.ts](../../../src/lib/test-support/integration-client.ts), which signs in through the real `/api/auth/signin` with an explicit `Origin` header (Astro CSRF) and replays the session cookie. **HR is the only seeded role with `recruitment.write`.** Cases: HR replaces a candidate-free recruitment's stages → 200 and the board reflects it; HR targets the seeded recruitment → 422 candidates-exist; Hiring Manager (can see the board) → 403; Administrator on a recruitment they are not linked to → 404; reset restores defaults and flips `stagesSource`. Requires both a running Supabase and a running Astro server.

### Success Criteria:

#### Automated Verification:

- Integration tests pass against the local stack
- Unit tests pass: `npm test`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `curl` a `PUT` as HR against a candidate-free recruitment and confirm 200 plus a changed board response
- Confirm the two new refusal cases return distinguishable messages, not the group-not-found text

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 5: Stage Editor UI

### Overview

A dialog opened from the board header. This phase contains the only genuinely new UI patterns in the slice — a variable-length list form and the first component to actually consume `fieldErrors`.

### Changes Required:

#### 1. Widen the mutation hook

**File**: `src/components/hooks/useMutation.ts`

**Intent**: The hook types `method` as `"POST" | "PATCH"` ([useMutation.ts:23](../../../src/components/hooks/useMutation.ts:23)); the stages endpoint is `PUT`.

**Contract**: Widen the union to include `"PUT"`. No behavioral change — the method is passed straight through to `fetch`.

#### 2. The stage editor

**File**: `src/components/recruitments/StageEditor.tsx` (new)

**Intent**: Let the recruiter edit the stage list and save it as one replacement, or reset to defaults.

**Contract**: A dialog holding an ordered, variable-length list of stage rows with add, remove, move-up/move-down, and per-row name input; a save action calling `useMutation<..., ...>(url, "PUT")`; a reset action shown only when `stagesSource === "custom"`.

Three things have **no precedent in this codebase** and need deliberate handling:
- **Stable React keys for unsaved rows.** Every existing form has a fixed field set; the only variable-length UI is a read-only checkbox list. Index-based keys will corrupt state on reorder and removal.
- **Distinct accessible labels per row.** `FormField` requires a unique `id` that doubles as `name`, and tests select by label — so each row needs `Stage 1 name`, not a repeated `Stage name`.
- **Mapping `fieldErrors` onto inputs.** `CreateRecruitmentForm` renders only `error` and never reads `fieldErrors`, so nothing maps dotted keys like `stages.0.name` back to a row yet.

`sortOrder` is recomputed from list position on submit; the client never sends explicit sort values.

When the board reports that candidates exist, the editor renders read-only with an explanation rather than letting the user compose a save that the server will reject. The server-side gate remains authoritative — this is UX, not enforcement.

#### 3. Wire it into the board

**File**: `src/components/recruitments/KanbanBoard.tsx`

**Intent**: Place the affordance where the existing mutate→refetch pattern already lives.

**Contract**: Add the editor to the header flex row ([KanbanBoard.tsx:125-139](../../../src/components/recruitments/KanbanBoard.tsx:125)) as a sibling to `StatusControl`, passing the same `onChanged={() => void resource.refetch()}` callback. Do not "clean up" `useApiResource`'s duplicated `refetch` body — the comment at [useApiResource.ts:69-74](../../../src/components/hooks/useApiResource.ts:69) explains the `react-hooks/set-state-in-effect` reason and an impl review has already ruled on it.

There is **no client-side capability gating anywhere in this app, by explicit decision** — the middleware `/api` guard is authentication, not authorization. A Hiring Manager will therefore see this control and must receive a clean denial, not a crash. This exact behavior was verified for the status control in S-02's review (F7).

Stage names render raw from the DB — `{stage.name}` at [KanbanBoard.tsx:145](../../../src/components/recruitments/KanbanBoard.tsx:145) is the only render site, and there is no hardcoded presentation map for stages to update.

#### 4. Component tests

**File**: `src/components/recruitments/StageEditor.test.tsx` (new)

**Intent**: Cover the new interaction patterns and the denial path.

**Contract**: `@testing-library/react` + `user-event`, `vi.stubGlobal("fetch", mockFetch({...}))`. Note `mockFetch` **throws on any unexpected URL** ([CreateRecruitmentForm.test.tsx:11-26](../../../src/components/recruitments/CreateRecruitmentForm.test.tsx:11)), so the new endpoint must be registered there. Cases: add/remove/reorder rows and assert submitted order; a 422 with `stages.0.name` renders against the right row; a 403 renders a clean message; the candidates-exist state renders read-only; reset appears only when `stagesSource` is `"custom"`.

### Success Criteria:

#### Automated Verification:

- Component and unit tests pass: `npm test`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- As HR: create a recruitment, open its board, customize stages, and confirm the board re-renders with the new columns
- As HR: reset to defaults and confirm the 6 defaults return
- As HR: open the seeded recruitment's editor and confirm the read-only explanation appears
- As Hiring Manager: open the editor on a visible board and confirm a clean 403 message, no crash
- Reorder and removal behave correctly across several edits without row state bleeding between rows

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 6: End-to-End Coverage

### Overview

One e2e spec that creates its own recruitment, customizes it, and asserts the board — leaving S-01's seeded-board assertions untouched.

### Changes Required:

#### 1. Stage customization spec

**File**: `tests/e2e/kanban-stages.spec.ts` (new)

**Intent**: Prove the whole path works in a real browser, on a recruitment that is in the right state by construction.

**Contract**: `test.beforeAll` creates a recruitment via the API (as `tests/e2e/recruitments.spec.ts` already discovers ids via the API rather than hardcoding them) — a freshly created recruitment has zero candidates, which is exactly the state the gate requires, so no fixture setup is needed. Sign in with `signInAs(page, "hr")`, and use the hydration-race `toPass()` retry ([support/auth.ts:26-31](../../../tests/e2e/support/auth.ts:26)) that any island form fill must use. Then: open the board, open the editor, rename/add/reorder/remove, save, and assert the board's `h2` headings match the new set; reset and assert the defaults return.

**`STAGE_ORDER` at [recruitments.spec.ts:4](../../../tests/e2e/recruitments.spec.ts:4) is left unchanged**, and this spec must not customize the seeded recruitment — doing so would break S-01's assertions, and the gate would refuse anyway since it has candidates.

CI resets the DB before e2e (integration tests leave real rows behind), so this spec starts from a clean seed.

### Success Criteria:

#### Automated Verification:

- E2E suite passes: `npm run test:e2e`
- Full CI pipeline passes: lint, build, `db:types` drift check, integration tests, e2e
- `git diff --exit-code src/db/database.types.ts` is clean

#### Manual Verification:

- The e2e run is stable across at least two consecutive runs (no hydration flake)
- S-01's `recruitments.spec.ts` still passes unmodified

**Implementation Note**: This is the final phase. After it passes, confirm the whole slice with the human before closing out.

---

## Testing Strategy

### Unit Tests:

- Override resolution: defaults-only, overrides-present, and correct per-partition sorting
- `stagesSource` correctness in both branches
- Candidates land on the correct override columns with accurate counts
- Service functions throw the raw Supabase error so `.code` survives to the endpoint

### Integration Tests:

- The full authorization matrix: HR allowed, Hiring Manager 403, unlinked user 404
- The candidates-exist refusal on the seeded recruitment
- Replace-then-read round trip, and reset restoring defaults

### RLS Tests:

- First-ever `kanban_stages` assertions: each partition allowed for the right role, denied for the wrong one, plus the consistency trigger

### Manual Testing Steps:

1. Create a recruitment as HR; open its board — confirm 6 default columns
2. Open the stage editor; confirm it reports inheriting defaults and offers no reset
3. Rename a stage, add one, remove one, reorder; save — confirm the board matches
4. Reopen the editor; confirm it now reports a custom set and offers reset
5. Reset; confirm the 6 defaults return
6. Open the seeded recruitment's board; confirm the editor is read-only and explains why
7. Sign in as Hiring Manager; open a visible board's editor and attempt a save — confirm a clean 403 message
8. In psql as Administrator: rename and reorder defaults, confirm every recruitment inheriting defaults reflects it
9. In psql as Administrator: attempt to remove a default stage that has candidates — confirm the refusal names the stage

## Performance Considerations

The defaults-removal safety check scans `candidate_recruitment_status_history` sequentially per candidate removal, since neither `from_stage_id` nor `to_stage_id` is indexed and adding those indexes was explicitly declined. History is small today and the defaults path is administrator-only and rare, so this is acceptable — but it is the first place to look if the defaults RPC ever feels slow.

The board's stage query now returns both partitions instead of one, at most doubling a handful of rows. Negligible.

## Migration Notes

**The English-rename guarantee expires with this slice.** S-01's migration notes justified [20260901000000_rename_default_kanban_stages_to_english.sql](../../../supabase/migrations/20260901000000_rename_default_kanban_stages_to_english.sql) as safe because "no per-recruitment override rows can exist (no write grant)". After S-03 that is false: any future rename migration cannot enumerate user-created override rows, and administrators can now rename the defaults themselves. Future migrations must not assume the default set still holds its shipped names.

Note also that the repo's English-only rule ([lessons.md](../../../context/foundation/lessons.md)) binds **files**, not runtime input. Nothing prevents a user typing a non-English stage name into the editor, and enforcing otherwise was explicitly declined — the constraint is trim/non-empty/length only.

## References

- Related research: `context/changes/recruiter-customizes-kanban-stages/research.md` — including the empirical verification log (tests A1–H) that grounds every claim in this plan
- S-02's write-path template: `supabase/migrations/20260901150000_create_recruitment_returns_row.sql`
- S-02's errcode→HTTP mapping: `src/pages/api/recruitments/index.ts:71-88`
- S-01's board read path: `src/lib/services/recruitments.ts:129-171`
- RLS harness: `supabase/tests/rls_verification.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, Policies & Integrity

#### Automated

- [x] 1.1 Migration applies cleanly on a fresh reset — 373759a
- [x] 1.2 rls_verification.sql passes end to end via the docker exec invocation — 373759a
- [x] 1.3 Linting passes — 373759a
- [x] 1.4 Existing unit tests still pass — 373759a

#### Manual

- [x] 1.5 Seed data loads unchanged — 373759a
- [x] 1.6 HR insert of a global default row is denied with 42501 — 373759a

### Phase 2: Stage-Write RPCs

#### Automated

- [x] 2.1 Migration applies cleanly
- [x] 2.2 npm run db:types produces no diff
- [x] 2.3 Type checking passes

#### Manual

- [x] 2.4 HR replaces a candidate-free recruitment's stages with contiguous sort_order
- [x] 2.5 Candidates-exist refusal fires on the seeded recruitment
- [x] 2.6 Two-phase renumber succeeds on the default set
- [x] 2.7 Removing a referenced default stage is refused, naming the stage

### Phase 3: Override-Aware Read Path

#### Automated

- [ ] 3.1 Unit tests pass
- [ ] 3.2 Linting passes
- [ ] 3.3 Build passes

#### Manual

- [ ] 3.4 Seeded board renders exactly as before
- [ ] 3.5 A manually inserted override set renders with stagesSource "custom"

### Phase 4: Stages API Endpoint

#### Automated

- [ ] 4.1 Integration tests pass against the local stack
- [ ] 4.2 Unit tests pass
- [ ] 4.3 Linting passes
- [ ] 4.4 Build passes

#### Manual

- [ ] 4.5 PUT as HR returns 200 and a changed board response
- [ ] 4.6 The two new refusal cases return distinguishable messages

### Phase 5: Stage Editor UI

#### Automated

- [ ] 5.1 Component and unit tests pass
- [ ] 5.2 Linting passes
- [ ] 5.3 Build passes

#### Manual

- [ ] 5.4 HR customizes stages and the board re-renders
- [ ] 5.5 Reset restores the 6 defaults
- [ ] 5.6 Seeded recruitment's editor is read-only with an explanation
- [ ] 5.7 Hiring Manager gets a clean 403, no crash
- [ ] 5.8 Reorder and removal behave correctly across several edits

### Phase 6: End-to-End Coverage

#### Automated

- [ ] 6.1 E2E suite passes
- [ ] 6.2 Full CI pipeline passes
- [ ] 6.3 database.types.ts diff is clean

#### Manual

- [ ] 6.4 E2E run is stable across two consecutive runs
- [ ] 6.5 S-01's recruitments.spec.ts still passes unmodified
