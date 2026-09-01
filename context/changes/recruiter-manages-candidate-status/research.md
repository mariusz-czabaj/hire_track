---
date: 2026-09-01T20:34:47+02:00
researcher: Mariusz Czabaj
git_commit: d7ff36bded542d09f9aee0e164b581258d466c81
branch: main
repository: mariusz-czabaj/hire_track
topic: "S-04 — Recruiter manages candidate status with a required note"
tags: [research, codebase, candidates, kanban, rls, rpc, notes]
status: complete
last_updated: 2026-09-01
last_updated_by: Mariusz Czabaj
---

# Research: S-04 — Recruiter manages candidate status with a required note

**Date**: 2026-09-01T20:34:47+02:00
**Researcher**: Mariusz Czabaj
**Git Commit**: d7ff36bded542d09f9aee0e164b581258d466c81
**Branch**: main
**Repository**: mariusz-czabaj/hire_track

## Research Question

What does the codebase already provide, and what is missing, for slice S-04 `recruiter-manages-candidate-status`: a recruiter adds a candidate to a recruitment and moves them between kanban stages, where the status change is hard-blocked unless an interview note exists for that candidate in that recruitment, and where a status can also be reverted/corrected (FR-006, FR-008, FR-009, FR-013, PRD §Business Logic).

## Summary

The data foundation for candidates is already in place and was deliberately designed with S-04 in mind — but **three things do not exist at all** and are this slice's to build:

1. **No notes storage of any kind.** Zero occurrences of "note" across `supabase/` and `src/types.ts`. The mandatory-note rule has no table, no RLS, no grants, no types, no API.
2. **No write path for candidates.** There is no `add_candidate_to_recruitment` or `move_candidate_stage` RPC, no `src/lib/services/candidates.ts`, and no `/api/recruitments/[id]/candidates*` route. The board is read-only today.
3. **Nothing populates status history.** `candidate_recruitment_status_history` exists and is append-only, but there is no trigger — `supabase/seed.sql` writes the initial row by hand. Every stage change S-04 makes must insert a history row explicitly.

Two structural facts dominate the design:

- **Candidate status *is* `candidate_recruitments.current_stage_id`** — there is no separate status column. A move is a stage re-map, and it is already permitted for `recruitment.write` holders by plain RLS (`candidate_recruitments_update`). That means a direct PostgREST `UPDATE` would **bypass any application-level note gate**. A `SECURITY DEFINER` RPC is the only reliable choke point for a rule the PRD states as a hard block.
- **Adding the first candidate is a one-way door for stage customization.** S-03's `replace_recruitment_stages` / `reset_recruitment_stages` raise `PA001 stages_locked` as soon as any `candidate_recruitments` row exists for that recruitment (`supabase/migrations/20260901162000_kanban_stage_rpcs.sql:38-40`, `:88-90`). S-04 shipping makes that gate real in production.

The backend, service, hook, dialog, and test conventions are strongly established and should be copied verbatim rather than re-invented; they are catalogued below.

## Detailed Findings

### Data model — what exists

All candidate DDL is in [20260831182957_recruitment_candidate_schema.sql](supabase/migrations/20260831182957_recruitment_candidate_schema.sql):

- `candidates(id, full_name, email not null, phone, created_at, updated_at)` (`:62-77`) with `unique index candidates_email_key on candidates (lower(email))` and a `gin_trgm_ops` index on `full_name` (for S-06). The migration comment at `:71-73` **names S-04 explicitly**: the add-candidate flow "looks up by lowercased email first and links to the existing row on a match", satisfying FR-007's shared-profile requirement.
- `candidate_recruitments(id, candidate_id, recruitment_id, current_stage_id not null references kanban_stages on delete restrict, added_at, unique(candidate_id, recruitment_id))` (`:79-92`). `added_at` is FR-010's card date. **No `updated_at` column and no updated_at trigger** — a move leaves no timestamp on the row itself, only `changed_at` on the history row.
- `candidate_recruitment_status_history(id, candidate_recruitment_id, from_stage_id nullable, to_stage_id not null, changed_by uuid, changed_at)` (`:94-105`). `changed_by` was moved to `on delete set null` by [20260831194556](supabase/migrations/20260831194556_fix_status_history_changed_by_on_delete.sql) (F-01 impl-review F1). `from_stage_id`/`to_stage_id` have **no ON DELETE action** and are **not indexed** — both explicitly declined in S-03 (`context/changes/recruiter-customizes-kanban-stages/plan-brief.md:43`).

### Kanban stage model S-04 must respect

Single table `kanban_stages` with `recruitment_id is null` = global default, non-null = per-recruitment override (`20260831182957:37-49`), two **partial** unique indexes on `sort_order`. Resolution is **all-or-nothing per board** and happens in application code, not SQL: [recruitments.ts:131-159](src/lib/services/recruitments.ts) picks overrides when any exist, else defaults, and reports `stagesSource: "custom" | "default"`.

- S-04's move UI must resolve the target stage from **the board's resolved set**, never from the defaults.
- A `before insert or update` trigger on `candidate_recruitments` rejects a `current_stage_id` whose stage belongs to a different recruitment (`20260901161434_kanban_stage_customization.sql:54-79`, errcode `22023`). It fires on moves too. A composite FK was proven impossible in S-03.
- Every history row S-04 writes **permanently pins a stage**: `update_default_stages` refuses to remove any stage referenced by `current_stage_id` or by history, with `PA002` ([20260901180501:67-81](supabase/migrations/20260901180501_fix_update_default_stages_delete_order.sql)).
- The board read path groups candidates **through the stage list**, so a candidate whose `current_stage_id` is not in the resolved set silently vanishes with no error (S-03 research test H).

### RLS and authorization

Two `stable security definer` helpers in schema `private`: `has_operation(op)` and `has_recruitment_operation(recruitment_id, op)` ([20260831183457_rls_policies.sql](supabase/migrations/20260831183457_rls_policies.sql), marked stable by `20260831195143`). Policies relevant to S-04:

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `candidates` (`:179-190`) | `candidate.read` (org-wide) | `candidate.write` | `candidate.write` | none (intentional) |
| `candidate_recruitments` (`:194-205`) | scoped `recruitment.read` | scoped `recruitment.write` | scoped `recruitment.write` | none |
| `candidate_recruitment_status_history` (`:210-230`) | via parent's `recruitment.read` | via parent's `recruitment.write` | none — append-only | none |

Note the asymmetry: **`candidate.write` governs the profile, `recruitment.write` governs the link row and history.** Adding a candidate to a board needs both. A new notes table needs its own policies and grants; the fixed 5-value `operation` enum should not need extending (and `alter type … add value` cannot run in the same transaction anyway — verified in S-03).

Denial semantics, established and mandatory: **not visible → 404; visible but no write → 403.** No client-side capability gating exists anywhere by explicit decision — a Hiring Manager sees the write affordance and must get a *clean* denial, not a crash (`recruiter-creates-recruitment/reviews/impl-review.md` F7). S-04 adds the biggest write affordance yet and must be assertion-tested the same way.

### RPC conventions

`create_recruitment` ([20260901150000](supabase/migrations/20260901150000_create_recruitment_returns_row.sql):9-45) and the three stage RPCs ([20260901162000](supabase/migrations/20260901162000_kanban_stage_rpcs.sql)) all follow one contract:

- live in `public` (PostgREST exposes only `public`/`graphql_public` — S-02 impl-review F1)
- `security definer set search_path = ''`, every identifier schema-qualified
- **permission re-check as the very first statement** (SECURITY DEFINER bypasses RLS), using the read-then-write two-step that produces the 404-vs-403 split (`20260901162000:30-36`)
- `returning` the full row so no second query is needed
- trailing `revoke execute … from public, anon; grant execute … to authenticated;`
- errors as `raise exception '<code_token>: <message>' using errcode = '<sqlstate>'`

Errcode codebook documented at `20260901162000:5-11`: `42501` insufficient_privilege, `P0002` not_found, `22023` invalid_request, `PA001` stages_locked, `PA002` stage_referenced. `23503` already means "nonexistent group" at the recruitments route — **do not reuse it**. S-04's "note required" refusal needs a **fresh `PAxxx` code**, documented in its migration header. `PA002` is still unmapped in every route.

### API and service layer

Route skeleton, identical in all five existing routes (e.g. [recruitments/index.ts:1-34](src/pages/api/recruitments/index.ts), [stages.ts](src/pages/api/recruitments/[id]/stages.ts)):

```ts
export const prerender = false;
const idParamSchema = z.coerce.number().int().positive();
export const POST: APIRoute = async (context) => { … };
```

- Handlers take the whole `context`, never destructured. Params via `context.params.id` + `safeParse` → 422.
- **Auth is not checked in routes** — [middleware.ts:19-26](src/middleware.ts) 401s every `/api/*` except `/api/auth/*`. Authorization is entirely RLS/RPC; the route only translates Postgres error codes. Do not add per-route auth checks.
- Each handler builds its own client: `createClient(context.request.headers, context.cookies)` + the `supabase_unconfigured` 500 guard.
- Zod schemas are module-local consts; invalid input is **422, never 400**, with a `fields` map built by a repeated 6-line block (`recruitments/index.ts:54-61`).
- [api-response.ts](src/lib/api-response.ts) exports exactly `jsonOk(data, status = 200)` (bare DTO, no envelope) and `jsonError(status, code, message, fields?)` → `{ error: { code, message, fields? } }` (`src/types.ts:87-93`).
- `handleStageRpcError` ([stages.ts:19-42](src/pages/api/recruitments/[id]/stages.ts)) is the model to copy for a `handleCandidateRpcError`.

Services ([recruitments.ts](src/lib/services/recruitments.ts), [security-groups.ts](src/lib/services/security-groups.ts)): one file per aggregate; `async function verbNoun(client: Client, …ids, command?)` with the client always first; **errors throw raw and unwrapped** (so `.code` survives to the route), absence returns `null` via `.maybeSingle()` → 404. Candidates belong in a new `src/lib/services/candidates.ts`.

Types ([src/types.ts](src/types.ts)) are hand-written, not `Row` picks: `…Command` for payloads, `…Dto` for responses. **`CandidateCardDto { id; fullName; addedAt }` already exists** (`:57-61`) — extend it rather than inventing a parallel type. Enums are zod schemas + `z.infer`, with a comment noting the column is `text` + CHECK.

Existing surface, for consistent additions:

```
GET/POST   /api/recruitments            PATCH /api/recruitments/[id]
GET        /api/recruitments/[id]/board
GET/PUT/DELETE /api/recruitments/[id]/stages
```

Consistent new routes: `POST /api/recruitments/[id]/candidates` (201 → `CandidateCardDto`) and `PATCH /api/recruitments/[id]/candidates/[candidateId]` with `{ stageId, note? }`. Astro's file router means the inner param needs a distinct name (`[candidateId]`), since the outer segment must stay `id`.

### Frontend

[KanbanBoard.tsx](src/components/recruitments/KanbanBoard.tsx) receives only `recruitmentId` from Astro (`[id].astro:14`, `client:load`) and fetches `/api/recruitments/{id}/board` itself via `useApiResource<KanbanBoardDto>` (`:107-108`). State branches: loading → skeleton columns, `not-found` → NotFoundState, error → `ServerError`. Columns are `data-testid="kanban-columns"`; cards render `fullName` and `Added {YYYY-MM-DD}`.

**There is no drag-and-drop library in `package.json`** (no dnd-kit, react-beautiful-dnd, react-dnd, sortablejs). The established precedent for reordering is button-based: `StageEditor`'s ArrowUp/ArrowDown buttons with indexed `aria-label`s, and `StatusControl`'s row of pill buttons. The realistic move interaction is a **per-card control opening a Radix dialog that requires the note**, then `resource.refetch()`. Adding a dnd library would be a new dependency with no precedent and would still need a keyboard fallback.

Hook contracts:

- [useApiResource.ts:27](src/components/hooks/useApiResource.ts) → `{status: "loading"|"success"|"not-found"|"error", data?, message?, refetch}`. 401 redirects to `/auth/signin`; 404 → `not-found`. `refetch()` intentionally duplicates fetch logic to dodge a lint rule (`:69-74`) — do not "clean that up".
- [useMutation.ts:21](src/components/hooks/useMutation.ts) → `{ mutate, status, error, fieldErrors }`. On failure it **both sets state and throws**; callers use `try { await mutate(…); onChanged(); } catch { /* state renders it */ }`. `fieldErrors` is keyed by dotted server path (`stages.1.name`).
- **Mutations never own data.** Children take `onChanged: () => void`; the board passes `() => { void resource.refetch(); }` (`KanbanBoard.tsx:136-146`). Copy this for both new dialogs.

Dialog/form pattern from [StageEditor.tsx](src/components/recruitments/StageEditor.tsx): controlled Radix `Dialog`, `handleOpenChange` **seeds state from props and clears errors on open** (`:50-56`); local synchronous validation before submit; `disabled={saving}` with a label swap; icon-only buttons always carry an `aria-label`. Inputs go through [FormField.tsx](src/components/auth/FormField.tsx) — **there is no textarea component**, so a multi-line note needs a new one mirroring FormField's label/id/error markup.

### Test conventions

- **Unit** (`npm run test`, jsdom, excludes `*.integration.test.ts`): no mocking library. Services use a hand-rolled `FakeQueryBuilder` implementing `PromiseLike` (`recruitments.test.ts:24-65`); components use a local `mockFetch(config)` that **throws on any unregistered URL** and is installed with `vi.stubGlobal`. Coverage shape to mirror: happy path payload, 422 field error on the right row, clean 403, disabled/read-only variant.
- **Integration** (`npm run test:integration`, node env): real HTTP against a running dev server. [integration-client.ts](src/lib/test-support/integration-client.ts) signs in through the real `POST /api/auth/signin` with seeded `hr.test@example.com` / `hiring-manager.test@example.com` / `admin.test@example.com` / `password123`, and must send `Origin` or Astro's CSRF check rejects it (`:44-48`). **No DB reset between tests** — create your own recruitment per case, never mutate seeds. Each test asserts status *and* `body.error.code`, across the HR-allowed / HM-403 / admin-404 matrix.
- **E2E** (Playwright, chromium, `workers: 1`, alphabetical file order against a shared DB): `signInAs(page, "hr")`, seed via `page.request.post("/api/recruitments", …)` in `beforeAll`, and **do not touch the seeded "Backend Engineer" recruitment** — `STAGE_ORDER` in `tests/e2e/recruitments.spec.ts:4` asserts its board and it holds 5 candidates. Every island form fill needs the hydration-race guard:
  ```ts
  await expect(async () => { await field.fill(v); await expect(field).toHaveValue(v); }).toPass({ timeout: 10_000 });
  ```
- **RLS verification**: `supabase/tests/rls_verification.sql`, 18 numbered assertions, each in its own `begin; set_config('request.jwt.claims', …); set local role authenticated; do $$ … raise exception 'FAIL: …' … $$; rollback;` block. Run it with `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_verification.sql` — `npx supabase db query --local -f` cannot run a multi-statement script, and the script's own header comment still recommends the broken invocation.

## Code References

- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:62-105` — candidates, candidate_recruitments, status history DDL
- `supabase/migrations/20260831183457_rls_policies.sql:179-230` — candidate-table RLS policies; `:236-244` grants
- `supabase/migrations/20260901161434_kanban_stage_customization.sql:54-79` — stage/recruitment consistency trigger (fires on moves)
- `supabase/migrations/20260901162000_kanban_stage_rpcs.sql:5-11` — errcode codebook; `:30-40` — read-then-write permission check and `PA001` candidate lock
- `supabase/migrations/20260901180501_fix_update_default_stages_delete_order.sql:67-81` — `PA002` stage-referenced guard (must be extended to any notes table carrying a stage_id)
- `src/pages/api/recruitments/[id]/stages.ts:19-42` — `handleStageRpcError`, the template for candidate RPC error mapping
- `src/lib/services/recruitments.ts:124-159` — stage resolution (default vs custom), the two-query design and its rationale
- `src/components/recruitments/KanbanBoard.tsx:107-172` — board fetch, state branches, column/card markup
- `src/components/recruitments/StageEditor.tsx:50-56, 91-122` — dialog seeding/reset, local validation, pending state
- `src/components/hooks/useMutation.ts:21` / `useApiResource.ts:27` — mutation and resource contracts
- `src/types.ts:57-61` — existing `CandidateCardDto`; `:77-85` — `KanbanBoardDto`
- `src/lib/test-support/integration-client.ts:16-54` — seeded credentials, cookie replay, CSRF Origin header
- `supabase/seed.sql:149-153` — the only place a history row is written today, by hand

## Architecture Insights

- **RLS is the single enforcement boundary; the UI never gates.** Every write affordance is rendered for everyone and denial is surfaced as a clean message. Any rule that must actually hold — including the note gate — therefore has to live in the database, not in the route or the component.
- **RPCs exist for atomicity and for the 404/403 split, not for convenience.** S-02 rejected client-orchestrated multi-call writes because they cannot recover from partial failure. S-04's add-candidate (upsert profile → link → initial history) and move (update stage → insert history) are exactly that shape.
- **The history table is append-only by design and unpopulated by machinery.** Whatever writes a stage change must also write history; nothing enforces it. That is another argument for one RPC being the only write path.
- **Errcodes are a documented codebook, and every code the RPC can raise must have an explicit HTTP branch** — unmapped codes fell through to generic 500s twice already (S-02 F2 on `23503`, S-03 F4 on `PA002`).
- **Migrations are never edited after merge** — behavioral fixes ship as a full `create or replace` in a new file. Types must be regenerated (`npm run db:types`) and committed in the same commit; CI fails on a dirty `git diff` of `src/db/database.types.ts`.
- **English-only**, per `context/foundation/lessons.md` — identifiers, comments, UI strings, seed data, and all `context/**` docs, even when the conversation is in Polish. The rule binds files, not runtime input: a user may type a non-English note; validation is trim/non-empty/length only.

## Historical Context (from prior changes)

- `context/changes/core-recruitment-data-foundation/plan.md:105` — the `lower(email)` lookup-then-link flow is **explicitly assigned to S-04**; `:26` defers notes and the no-note rule to S-04.
- `context/changes/recruiter-views-kanban-board/research.md:82` — candidate status *is* `current_stage_id`, no status column; `:87` — "S-04 must insert [history] alongside every stage change"; `plan.md:50, :404` — the board is deliberately read-only on candidate state.
- `context/changes/recruiter-creates-recruitment/reviews/impl-review.md` — F1 (RPC must be in `public`), F3 (`returning` the full row), F4 (group assignment not scoped to caller's groups — accepted), F7 (Hiring Manager must get a clean denial, and a status click on the already-current value proves nothing).
- `context/changes/recruiter-customizes-kanban-stages/plan.md:46` and `research.md:303` — whether a bulk stage re-map writes history, with what `changed_by`, and whether it is exempt from the note rule is **explicitly handed to S-04**.
- `context/changes/recruiter-customizes-kanban-stages/plan-brief.md:67` — the zero-candidates customization gate is "cheap today only because S-04 hasn't shipped".
- `context/changes/recruiter-customizes-kanban-stages/reviews/impl-review.md` — F1 (tautological RLS assertion that passed whether or not a row matched; assert with `returning … into` and prove the assertion fails for a denied role), F2 (record out-of-band CI fixes in `change.md` Notes), F3 (never edit a merged migration).
- CI history: commit `1f3a94f` — readiness must probe an API route, not `/`, because Astro dev lazily reloads per route module graph; **S-04 adds new API routes, so the same flake class applies**. Commit `d7ff36b` — PostgREST clock skew right after `supabase start` rejects fresh JWTs (PGRST303), absorbed by a retried authenticated warm-up. Commits `e225a54`/`dabcf6a` — integration tests leave real rows behind; run `supabase db reset --local` before e2e.

## Related Research

- `context/changes/core-recruitment-data-foundation/research.md` — schema, RLS helper, and operation-enum groundwork
- `context/changes/recruiter-views-kanban-board/research.md` — board read path and card DTO
- `context/changes/recruiter-creates-recruitment/research.md` — RPC-vs-two-call decision, field-error precedent, CSRF gap
- `context/changes/recruiter-customizes-kanban-stages/research.md` — stage override design, `PA00x` codebook, RLS test invocation

## Open Questions

1. ~~**Is the note one editable free-text field per candidate-per-recruitment, or an append-only list of notes?**~~ — **RESOLVED 2026-09-01 (user): Reading A.** One editable free-text field per candidate per recruitment; the gate is "the note is non-empty", so once filled, subsequent moves are unblocked. Rationale: the Business Logic rule (`prd.md:123-125`) is the normative statement and is singular; FR-013's plural "notes" (`prd.md:99`) is read as the edit affordance, not a log. A notes log stays open as a later addition (S-05/S-06). Accepted trade-off: the gate is weak in practice. See `change.md` Notes.
2. **Is reverting a status (FR-009) also gated by the note rule?** The PRD states a hard block with no stated exemption, but a correction of a mis-click arguably has nothing new to note. — **Owner: user/product. Blocks: no** (default to gating everything, matching the PRD literally).
3. **Does a bulk stage re-map write history rows, with what `changed_by`, and is it exempt from the note gate?** Inherited unanswered from S-03 (`recruiter-customizes-kanban-stages/research.md:303`). — **Owner: user/product. Blocks: no** (no bulk re-map path exists yet).
4. **Should the zero-candidates stage-customization lock (`PA001`) be revisited now that candidates will actually exist?** — **Owner: user/product. Blocks: no** (out of S-04's scope, but S-04 is what makes it bite).
5. **Should a candidate be removable from a recruitment?** No DELETE policy or grant exists on `candidates`, `candidate_recruitments`, or the history table. Not in FR-006..FR-013. — **Owner: plan. Blocks: no** (assume no, unless asked).
6. **Should write affordances be hidden from users who cannot write?** Open since S-01/S-02; S-04 adds the largest write surface yet. — **Owner: user. Blocks: no** (current convention: render and deny cleanly).
7. **No CSRF protection exists anywhere** (`recruiter-creates-recruitment/research.md:121`), flagged at S-02 and never actioned. — **Owner: team. Blocks: no.**
8. **Board query has no pagination or upper bound on candidates** (S-01 impl-review F3, SKIPPED), and the `<2s` NFR has no load target. S-04 is what makes candidate counts grow. — **Owner: team. Blocks: no.**
9. **Roadmap statuses are stale** — F-01/S-01/S-02/S-03 are `impl_reviewed` in their `change.md` but still `in-progress` in `context/foundation/roadmap.md`, flagged three times. — **Owner: user. Blocks: no.**
