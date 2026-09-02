---
date: 2026-09-01T23:18:33+02:00
researcher: Mariusz Czabaj
git_commit: bda514ecc3d5b060630ac71e2131c8cf4091f6d1
branch: main
repository: hire_track
topic: "S-05: candidate profile page, CV upload, and 12-month CV retention"
tags: [research, codebase, candidates, supabase-storage, retention, scheduling, cloudflare-workers]
status: complete
last_updated: 2026-09-01
last_updated_by: Mariusz Czabaj
---

# Research: S-05 — Candidate profile, CV upload, and 12-month retention

**Date**: 2026-09-01T23:18:33+02:00
**Researcher**: Mariusz Czabaj
**Git Commit**: `bda514ecc3d5b060630ac71e2131c8cf4091f6d1`
**Branch**: `main`
**Repository**: hire_track

## Research Question

What does the existing codebase already provide, and what is missing, for roadmap slice S-05
(`candidate-profile-and-cv-upload`) — a candidate profile page with personal data, CV file upload (PDF/DOCX),
and automatic permanent deletion of the CV file 12 months after upload?

PRD refs: FR-007, FR-011, FR-012, FR-013a, NFR (retention, unauthorised access), and the shaping guardrail
"CV upload must be reliable — file loss is unacceptable".

## Summary

**The data model is ready for a shared profile; nothing else for this slice exists.**

Four findings dominate, in descending order of impact on the plan:

1. **The upload architecture is already decided, and it is not the obvious one.** `context/foundation/infrastructure.md`
   contains a pre-mortem that names this exact feature as the project's top delivery risk and rules out the
   default approach: CV bytes must **not** be proxied through the Cloudflare Worker. The mandated design is a
   browser → Supabase Storage direct upload via presigned URL. This was flagged as "decide this before building
   the upload feature" and it has not yet been actioned. See [Detailed Findings §3](#3-file-storage-capability--absent-but-pre-decided).

2. **Every candidate route today is recruitment-nested, but the profile is org-wide by design.** `candidates` RLS is
   gated by org-wide `candidate.read` / `candidate.write` — *not* per-recruitment — yet no route addresses a
   candidate by `candidates.id`. FR-007 ("profile and CV are shared; notes and status are per-recruitment") and
   FR-011 both point at a candidate-scoped profile resource that does not exist. S-06 will need the same resource.
   This is the slice's main architectural fork. See [§2](#2-the-candidate-profile-surface-today).

3. **No scheduling mechanism exists, and all four candidate mechanisms are individually blocked today.** The most
   decisive blocker: `wrangler.jsonc` points `main` at the Astro adapter's prebuilt entrypoint, which exports only
   `{ fetch }` and no `scheduled` handler — so a Cloudflare Cron Trigger has nowhere to land without introducing a
   project-owned worker entry. And no service-role key exists anywhere in the project, while every existing
   privileged RPC authorises through `auth.uid()` — which a nightly job does not have. See [§4](#4-retention--scheduling-capability--absent).

4. **Presigned direct upload breaks write atomicity, which collides with the "no file loss" guardrail.** Once the
   bytes bypass the Worker, "object exists in Storage" and "database knows about it" become two separate writes
   that can diverge in either direction. Every other write path in this codebase is atomic inside a
   `SECURITY DEFINER` RPC; this one structurally cannot be. See [Architecture Insights](#architecture-insights).

Everything else is favourable: the `candidates` UPDATE policy and grant already exist but are unused (making
identity fields editable needs app code only, no migration), the shared-profile dedup path already works, and the
`pg_trgm` index on `full_name` was already planted for S-06.

## Detailed Findings

### 1. What S-05 must deliver (requirements, translated from the Polish PRD)

| Ref | Requirement | Note |
|---|---|---|
| FR-007 | One candidate participates in many recruitments; **profile (data, CV) is shared**, notes and status are per-recruitment | `context/foundation/prd.md:91` |
| FR-011 | **A user** can open a candidate profile with personal data | `prd.md:96` — "user", broader than recruiter |
| FR-012 | **A recruiter** can upload a CV file (PDF/DOCX) to the candidate profile | `prd.md:97` — narrower actor than FR-011 |
| FR-013a | The CV file is **automatically deleted 12 months after it was added** to the profile | `prd.md:100` |
| NFR | CV files are **permanently** deleted after 12 months; **profile and status history remain intact** | `prd.md:119` |
| NFR | **No candidate data is accessible to an unauthorised or unauthenticated user** | `prd.md:117` |
| Guardrail | "Upload CV musi być niezawodny — utrata pliku jest niedopuszczalna" (upload must be reliable — file loss unacceptable) | `prd.md:47` |

Two requirement details that shape the design and are easy to miss:

- **FR-011 says "user", FR-012 says "recruiter".** Read access to the profile is deliberately broader than upload
  access. This maps cleanly onto the existing org-wide `candidate.read` vs `candidate.write` split
  (`supabase/migrations/20260831183457_rls_policies.sql:179-190`), where the seeded Hiring Manager holds read only
  (`supabase/seed.sql:18-21`).
- **The NFR forbids unauthorised access to candidate data.** A Supabase Storage bucket holding CVs must therefore be
  **private**, and any download URL must be short-lived and minted only after an authorisation check. A public
  bucket would violate the NFR outright.

### 2. The candidate profile surface today

**The `candidates` table** — `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:62-77`:

```
id bigint generated always as identity primary key
full_name text not null
email text not null
phone text
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

- `candidates_email_key` unique index on `lower(email)` (`:74`) — the comment states it exists to satisfy FR-007's
  shared-profile requirement.
- `candidates_full_name_trgm_idx` GIN trigram index on `full_name` (`:77`) — comment says "for S-06".
- **No CV, file, or storage column of any kind.** Grep for `cv|resume|attachment|file_` across all migrations,
  `src/types.ts` and `src/db/database.types.ts` returns zero hits.
- `set_updated_at` trigger attached — `supabase/migrations/20260831194708_add_updated_at_triggers.sql:18`.

**RLS on `candidates` is org-wide, not recruitment-scoped** — `20260831183457_rls_policies.sql:175-190`:

| Policy | Operation | Guard |
|---|---|---|
| `candidates_select` | SELECT | `private.has_operation('candidate.read')` |
| `candidates_insert` | INSERT | `private.has_operation('candidate.write')` |
| `candidates_update` | UPDATE (using + with check) | `private.has_operation('candidate.write')` |

No DELETE policy (explicitly noted at `:177-178`). Grant at `:242` is `select, insert, update` only.
`private.has_operation` (`:19-32`) resolves through `group_memberships ⨝ group_operations` for `auth.uid()` with
**no recruitment scoping** — contrast `private.has_recruitment_operation` (`:34-48`) used by
`candidate_recruitments` (`:194-205`).

**Every route is recruitment-nested.** The four candidate surfaces are:

| File | Verbs | Addressed by |
|---|---|---|
| `src/pages/recruitments/[id]/candidates/[candidateId].astro` | page shell | `candidate_recruitments.id` |
| `src/pages/api/recruitments/[id]/candidates/index.ts` | POST | — |
| `src/pages/api/recruitments/[id]/candidates/[candidateId]/index.ts` | GET, PATCH | `candidate_recruitments.id` |
| `src/pages/api/recruitments/[id]/candidates/[candidateId]/notes.ts` | PUT | `candidate_recruitments.id` |

**No route anywhere addresses a candidate by `candidates.id`.** Nothing exists under `src/pages/candidates/` or
`src/pages/api/candidates/`. `candidates.id` appears only as an output field (`CandidateDetailDto.candidateId`,
`CandidateCardDto.id`). Every service function filters `.eq("recruitment_id", recruitmentId)` —
`src/lib/services/candidates.ts:58`, `:107`, `:191`.

**The detail page** (`src/components/recruitments/CandidateDetail.tsx`, 219 lines) renders identity fields
**read-only** at `:170-190` (`fullName` as `<h1>`, `email`, optional `phone`, `Added {addedAt}`); the only edit
affordance is per-note (`:108-116`). It fetches via `useApiResource<CandidateDetailDto>` at `:124-129`. There is no
CV/file UI. The S-04 plan explicitly deferred restructuring here to S-05
(`context/changes/recruiter-manages-candidate-status/plan.md:75-76`, `:479`).

**`CandidateDetailDto` fuses two concerns** — `src/types.ts:113-122` carries profile fields
(`fullName`, `email`, `phone`) alongside per-recruitment fields (`id` = link-row id, `addedAt`, `currentStageId`,
`notes[]`) in one flat shape. A shared-profile view would need this split.

**No UPDATE path on `candidates` exists** — but the capability does. Grep for `update public.candidates` across
`supabase/` returns zero hits; no service function calls `.from("candidates")` at all. Yet `candidates_update`
(`rls_policies.sql:187-190`) and the UPDATE grant (`:242`) are already in place. **Making identity fields editable
therefore needs application code only — no new migration, policy, or grant.**

**The shared-profile dedup path already works.** `add_candidate_to_recruitment` looks up by `lower(email)` and
reuses the existing `candidates` row rather than inserting, raising `PA003 candidate_name_mismatch` if the name
differs — `supabase/migrations/20260901210500_candidate_write_rpcs.sql:61-75`. One `candidates` row can already be
linked to many recruitments; only the **read surface** is per-recruitment.

### 3. File storage capability — absent, but pre-decided

**What exists:** exactly one fact — `supabase/config.toml:109-112` has `[storage] enabled = true` with
`file_size_limit = "50MiB"`. Also `[storage.s3_protocol] enabled = true` (`:122-123`).

**What is absent:**

- **No buckets.** The `[storage.buckets.images]` block at `config.toml:115-118` is entirely commented out.
- **No storage RLS.** Grep for `storage|bucket|objects` across all 18 migrations, `seed.sql`, and
  `rls_verification.sql` returns **zero matches**.
- **The `storage` schema is not exposed via PostgREST** — `config.toml:13` sets `schemas = ["public", "graphql_public"]`.
  Storage must be reached through the Storage JS API, not through PostgREST queries against `storage.objects`.
- **No service-role client.** `src/lib/supabase.ts` (25 lines) has one factory using `createServerClient` with the
  anon `SUPABASE_KEY` (`:3`, `:10`). Grep for `service_role|SERVICE_ROLE|serviceRole` across the repo returns zero
  matches in any source or config file.
- **No upload code of any kind.** The only `formData()` calls are the urlencoded login forms at
  `src/pages/api/auth/signin.ts:5` and `signup.ts:5`. No `File`, no `<input type="file">`, no `.storage`, no
  `createSignedUploadUrl` / `createSignedUrl`.
- **No R2 binding.** `wrangler.jsonc` (15 lines) declares only `assets` and `observability` — no `r2_buckets`,
  KV, D1, Queues, or Durable Objects. R2 is not an available target without new config.

**The frontend hooks cannot carry a file.** `src/components/hooks/useMutation.ts:36-40` hard-codes
`Content-Type: application/json` and `JSON.stringify(body)`; `useApiResource.ts` is GET-and-`response.json()` only
(`:39`, `:57`). Neither supports a non-JSON body, upload progress, or abort. An upload path cannot reuse them as
written.

**The pre-mortem — a load-bearing prior decision.** `context/foundation/infrastructure.md` names this feature four
separate times as the project's top risk:

- `:65` — "Routing large files through a Worker is fragile — `workerd` has strict request body limits and timeout
  behavior that cause silent failures on files above ~5MB. The correct architecture is direct-to-Supabase presigned
  URL uploads from the browser, bypassing the Worker entirely. **This must be decided before writing the upload
  feature.**"
- `:77` — the narrative failure: an ~8MB upload silently succeeding in the UI while the file never lands, costing
  three days of debugging and a week of schedule.
- `:84` — "browser → Supabase Storage direct upload via presigned URL is the only viable path for files of unknown
  size."
- `:102` — risk register row: likelihood High, impact High.

Related constraints from the same document: `compatibility_date` silently gates runtime APIs (`:85`); the Supabase
client cold-starts per Worker invocation, adding 200–500ms (`:87`); and **rotating a Supabase service-role key is
classified as a human-only operation** (`:96`) — relevant if the retention job needs one.

### 4. Retention / scheduling capability — absent

**Postgres extensions actually enabled by migrations: exactly one** — `pg_trgm`
(`20260831182957_recruitment_candidate_schema.sql:11`). No `pg_cron`, no `pg_net` anywhere in the repo (zero grep
hits across migrations, `config.toml`, `seed.sql`, `tests/`). Postgres major version 17 (`config.toml:36`).
`seed.sql:42,51,60` use `extensions.crypt`/`gen_salt` (pgcrypto, available by default, not created by a migration).

**The Cloudflare cron path is structurally blocked today.** This is the sharpest finding:

- `wrangler.jsonc:4` sets `"main": "@astrojs/cloudflare/entrypoints/server"` — the project **does not own a worker
  entry file**; it points directly at the adapter's prebuilt module.
- That module, in full, is `import { handle } from "../utils/handler.js"; var server_default = { fetch: handle };`
  — it exports **`fetch` and nothing else**. No `scheduled` handler.
- Therefore adding `triggers.crons` to `wrangler.jsonc` would fire a `scheduled` event that the current entry
  cannot receive. There is no `src/worker.ts` or custom `main` in which to add one.

**Supabase Edge Functions:** `supabase/functions/` **does not exist**. `[edge_runtime]` is enabled in config
(`config.toml:357-366`, `deno_version = 2`), and `[edge_runtime.secrets]` is present but commented out (`:368-369`).
There is no `[functions]` section.

**No background work of any kind exists:** zero hits across `src/` and `tests/` for `scheduled`, `ScheduledEvent`,
`waitUntil`, `setInterval`, `setTimeout`, `queue`, `cron`. `.github/workflows/` contains one file whose only
triggers are `push` and `pull_request` on `main` (`ci.yml:4-7`) — no `schedule:` and no `workflow_dispatch`.

**Authentication for a deletion job is the hidden blocker.** The complete set of secrets plumbed today is
**two**, everywhere: `SUPABASE_URL` and `SUPABASE_KEY` (`astro.config.mjs:22-27`, both `context: "server",
access: "secret", optional: true`; `.env.example:1-2`; `ci.yml:24-26`; and in CI's e2e job the key is explicitly
the **publishable/anon-tier** key, `ci.yml:44-46`). No service-role key exists anywhere.

The existing privilege precedent does not extend to an unattended job: both `SECURITY DEFINER` RPCs in
`20260901210500_candidate_write_rpcs.sql` bypass RLS but then re-implement authorisation in the function body via
`private.has_recruitment_operation` / `private.has_operation` (`:37-47`, `:143-149`), and resolve caller identity
through `(select auth.uid())` (`:104`, `:155`, `:174`). Execute is granted to `authenticated` only
(`:110-111`, `:180-181`). **Every privileged path in this codebase presupposes a logged-in user; a nightly
retention job has none.**

**Net position: all four scheduling mechanisms need something that does not exist yet.**

| Mechanism | What it needs that is missing |
|---|---|
| Cloudflare Cron Trigger | A project-owned worker entry exporting `scheduled` (adapter entry exports only `fetch`) |
| `pg_cron` in Postgres | The extension enabled; plus a way to delete the *object* (not just the row) — the `storage` schema is not PostgREST-exposed and SQL deletion of `storage.objects` does not reliably remove the underlying S3 object |
| Supabase Edge Function | The `supabase/functions/` tree, a deploy path (CI runs neither `supabase functions deploy` nor `wrangler`), and a scheduler to invoke it |
| GitHub Actions `schedule:` | A `schedule:` trigger and a service-role secret (neither exists) |

**CI constraints that bear on this slice** (`.github/workflows/ci.yml`, 107 lines, two jobs):

- Job `ci` (`:10-26`): typecheck, vitest unit, lint, build. No database.
- Job `e2e` (`:28-107`): `supabase start` brings up the **full local stack including Storage and Edge Runtime**
  containers (`:37-40`) — so storage-side work is at least startable in CI, though nothing drives it today.
- `:47-50` runs `npm run db:types` then `git diff --exit-code src/db/database.types.ts` — **any new table or RPC
  will fail CI unless the generated types are regenerated and committed in the same commit.**
- `:51-99` backgrounds `npm run dev` (the **Astro dev server**, not workerd) behind three readiness poll loops,
  then runs integration tests. **The workerd runtime is exercised nowhere in CI**, so a Worker `scheduled` handler
  would have no CI execution path.
- `:100-105` runs `npx supabase db reset --local` between integration and e2e, because integration tests create
  rows that cannot be deleted.

### 5. Conventions the plan must follow

**Errcode codebook** — the complete set in use across all migrations, documented at
`20260901162000_kanban_stage_rpcs.sql:5-11`:

| Code | Meaning |
|---|---|
| `42501` | `insufficient_privilege` — caller lacks the required operation |
| `P0002` | `not_found` — caller cannot even read the parent resource |
| `22023` | `invalid_request` — malformed input |
| `PA001` | `stages_locked` — recruitment already has candidates |
| `PA002` | `stage_referenced` — a default stage removal is still referenced |
| `PA003` | `candidate_name_mismatch` — email matches an existing candidate under a different name |
| `PA004` | `note_required` — no note exists for the stage being left |

**`PA005` is the next free code.** Note `23503` (FK violation) is used ad-hoc at the recruitments route to mean
"nonexistent group" and is not part of the formal codebook.

**Route error mapping** — `src/lib/api/candidate-errors.ts:9-32` is the house handler for candidate routes:
`P0002`→404 `not_found`, `42501`→403 `forbidden`, `PA003`→422 `candidate_name_mismatch` (with a `fullName` field
error), `PA004`→422 `note_required` (with a `note` field error), `22023`→422 `invalid_request`, default→
`console.error` then 500 `internal`. Every code an RPC can raise gets an explicit branch — unmapped codes have
fallen through to 500s twice already (S-02 F2, S-03 F4).

**Route skeleton** — `src/pages/api/recruitments/[id]/candidates/index.ts`: `export const prerender = false`,
module-local zod schemas, `z.coerce.number().int().positive()` for id params, JSON-parse try/catch guard, field-error
flattening into a `fields` map for 422s, per-route `createClient(context.request.headers, context.cookies)` with the
`supabase_unconfigured` 500 guard, no per-route auth check (middleware owns 401), whole `context` never destructured.
`src/middleware.ts:5` sets `PROTECTED_ROUTES = ["/dashboard", "/recruitments"]` — **note that a new top-level
`/candidates` route family would need adding here.**

**Service layer** — `src/lib/services/candidates.ts`: client-first argument, Supabase errors thrown **raw and
unwrapped** so `.code` survives to the route, absence returned as `null` via `.maybeSingle()` (route turns it into a
404), inline snake_case→camelCase DTO mapping, and reuse of `resolveKanbanStages` from `recruitments.ts`.

**Migration conventions** — header comment naming the slice and FR, RLS enabled in the same file, per-operation
policies `to authenticated`, every helper call wrapped in `(select …)`, explicit grants at the end,
`security definer set search_path = ''` with schema-qualified identifiers, read-then-write permission check as the
first statements, `returning` the full row, trailing `revoke execute … from public, anon; grant execute … to
authenticated;`. **Merged migrations are never edited** — changes ship as a full `create or replace` in a new file.

**Middleware owns 401 for API routes.** `src/middleware.ts` returns `jsonError(401, "unauthenticated", …)` for any
`/api/*` path outside `/api/auth/*`, so **every route handler may assume a session exists**. Page routes use
`PROTECTED_ROUTES = ["/dashboard", "/recruitments"]` matched with `startsWith` — `/recruitments/**` is already
covered, but a new top-level `/candidates` family would not be. Authentication only; authorization is entirely RLS.

**Five test layers**, all of which a new slice is expected to touch:

1. **Unit/service** — `src/lib/services/candidates.test.ts`, hand-rolled `FakeQueryBuilder` (no mocking library).
   Note the two-query discrimination trick: because `resolveKanbanStages` fires concurrent `kanban_stages` queries,
   a second fake builder distinguishes them by which chain method was called (`is()` → defaults, `eq()` → override).
2. **Component** — local `mockFetch(config)` + `vi.stubGlobal`, **throwing on any unregistered URL**, torn down via
   `afterEach(() => { cleanup(); vi.unstubAllGlobals(); })`. Queries are accessibility-first (`getByRole`, `getByLabelText`).
3. **Integration** — `candidates.integration.test.ts` via `src/lib/test-support/integration-client.ts`. Real HTTP
   against a running dev server. **The harness must send `headers: { Origin: BASE_URL }` on the sign-in form POST** —
   Astro's built-in CSRF origin check rejects it otherwise (`integration-client.ts:44-49`). Each case creates its own
   recruitment and uses collision-proof emails (`ada-${recruitmentId}-${Date.now()}-${random}@example.com`).
   Prerequisites (`npx supabase start`, `npm run dev`) are documented in file headers, not automated. Integration
   runs leave real rows behind — running e2e afterwards without `supabase db reset --local` produces false failures.
4. **SQL RLS assertions** — `supabase/tests/rls_verification.sql` (838 lines, 27 numbered assertions), each a
   self-contained rolled-back transaction:
   `begin; select set_config('request.jwt.claims', …); set local role authenticated; do $$ … raise exception 'FAIL: …' … $$; rollback;`.
   Denial cases nest `begin … exception when insufficient_privilege then null; end;`; errcode-specific denials assert
   `sqlstate`. **Run it with `docker exec … psql`** — `supabase db query --local -f` cannot execute the
   multi-statement script (lesson recorded in S-02's review). Per S-03 impl-review F1, each assertion must capture the
   affected row with `returning … into` and assert the value actually changed — never a predicate that passes when
   zero rows match.
5. **Playwright e2e** — `tests/e2e/`, `signInAs(page, "hr")`, own recruitment via `page.request.post`, and the
   `toPass()` hydration-race guard around **every** form fill (a `client:load` island filled before hydration resets
   the controlled input). Fixture hazards a new spec must respect: `recruitments.spec.ts` asserts on the seeded
   "Backend Engineer" board (its `STAGE_ORDER` and 5-candidate count) **and** that no other draft recruitments exist —
   so a spec-created recruitment must be `PATCH`ed off `draft` immediately. Seeded group ids are `[1, 2]`
   (HR/Recruiter, Hiring Manager) by insertion order.

**Six recurring failure themes across the five prior reviews** — the plan should pre-empt each:

1. **A new RPC ships without an authorization re-check, or without any RLS assertion.** S-04 F1 (critical) plus F6;
   the review noted an assertion would have caught it. Every RPC needs authz as its first statement *and* a numbered
   `rls_verification.sql` block including a denial case.
2. **Unmapped Postgres errcodes falling through to 500.** S-02 F2 (`23503`), S-03 F4 (`PA002`), S-04 F5 (`23503`).
   Every code an RPC or FK can raise needs an explicit branch or a pre-check that prevents it.
3. **Assertions that pass vacuously.** S-03 F1 (tautological UPDATE), F-01 F4 (untested isolation), S-02 F7 (a test
   clicked an already-current status, so no PATCH was ever sent). Prove the negative.
4. **Cross-parent scoping omitted on child-row writes.** S-04 F3 — the `.eq("recruitment_id", …)` guards in
   `candidates.ts` exist because of this class of bug.
5. **Plan text drifting from what shipped.** Four of five reviews raised a documentation-fidelity finding; each needed
   an addendum.
6. **Extra round-trips outside a transaction.** S-02 F3; the fix pattern is `returns <table>` with `returning * into`.

**Known open debt this slice would build on** (findings deliberately SKIPPED in prior reviews, still live):

| Debt | Source | Relevance to S-05 |
|---|---|---|
| **No DELETE policy or grant on any domain table**, and no precedent anywhere for a "deleting actor" | F-01 / S-04 plans | **Highest.** The retention job deletes data; there is no policy path and no precedent for an unattended deleter |
| No CSRF token scheme on the JSON API (Astro's built-in origin check covers form POSTs only) | S-02, re-affirmed S-04 | Moderate — S-05 adds a new write surface |
| `getKanbanBoard` has no upper bound on candidates fetched (no board pagination) | S-01 F3 | Low — S-05 does not touch the board read path |
| `useApiResource.refetch()` duplicates the mount-effect fetch logic | S-02 F6 | Low, but the profile page uses this hook, and a new status branch must be added in **both** copies |
| Hardcoded `password123` in the integration harness and Playwright helper | S-02 F5 | Low — S-05 tests reuse the harness |
| `p_group_ids` not scoped to the caller's own groups | S-02 F4 | None directly |
| `PA002` unmapped in the stages endpoint (dead until S-07) | S-03 F4 | Precedent: map every errcode a new RPC can raise |
| Timestamp column naming varies (`added_at`, `changed_at` vs `created_at`) | F-01 F7 | Minor — pick a name consistent with the neighbouring table |
| S-04's integration + e2e suites were not re-run after its triage fixes | S-04 review `:26-28` | Worth a confirmation pass before S-05 builds on top |

The `lessons.md` register currently holds one accepted rule: **all code and artifacts in English**, even when the
conversation is in Polish, and Polish source documents (PRD, roadmap) must be *translated* into the artifact rather
than copied through (`context/foundation/lessons.md:5-10`). Note the rule binds new artifacts only — the existing
Polish PRD, roadmap, and F-01 documents were left untranslated.

## Code References

- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:62-77` — `candidates` table; no CV column
- `supabase/migrations/20260831183457_rls_policies.sql:175-190` — org-wide `candidates` RLS (select/insert/update, no delete)
- `supabase/migrations/20260831183457_rls_policies.sql:242` — `grant select, insert, update on candidates to authenticated`
- `supabase/migrations/20260831183457_rls_policies.sql:19-32` — `private.has_operation` (org-wide, no recruitment scope)
- `supabase/migrations/20260901210500_candidate_write_rpcs.sql:61-75` — email-based profile dedup (FR-007 in practice)
- `supabase/migrations/20260901210500_candidate_write_rpcs.sql:104,155,174` — every privileged path resolves `auth.uid()`
- `supabase/migrations/20260901162000_kanban_stage_rpcs.sql:5-11` — the errcode codebook
- `supabase/config.toml:109-112` — storage enabled, 50MiB limit; `:115-118` buckets commented out; `:13` schemas exclude `storage`
- `supabase/config.toml:357-366` — `[edge_runtime]` enabled, no `supabase/functions/` tree exists
- `wrangler.jsonc:4` — `main` points at the adapter entry that exports only `fetch` (blocks cron triggers)
- `src/lib/supabase.ts:3,10` — single anon-key client factory; no service-role client anywhere
- `astro.config.mjs:22-27` — the complete env schema: `SUPABASE_URL`, `SUPABASE_KEY`
- `src/components/hooks/useMutation.ts:36-40` — JSON-only body, cannot carry a file
- `src/lib/services/candidates.ts:103-108` — `getCandidateDetail` enters via the link row, embeds `candidates`
- `src/lib/services/candidates.ts:58,107,191` — every service call is recruitment-scoped
- `src/types.ts:113-122` — `CandidateDetailDto` fuses profile and per-recruitment fields
- `src/components/recruitments/CandidateDetail.tsx:170-190` — read-only identity block (the S-05 restructure surface)
- `src/middleware.ts:5` — `PROTECTED_ROUTES = ["/dashboard", "/recruitments"]`
- `src/lib/api/candidate-errors.ts:9-32` — house errcode→HTTP mapping
- `.github/workflows/ci.yml:47-50` — generated-types diff gate; `:100-105` db reset between suites
- `context/foundation/infrastructure.md:65,77,84,102` — the presigned-URL pre-mortem

## Architecture Insights

**The presigned-URL mandate creates an atomicity problem this codebase has not faced before.** Every write path
built so far is atomic inside a single `SECURITY DEFINER` RPC — `create_recruitment`, `add_candidate_to_recruitment`,
`move_candidate_stage` all do their multi-table writes in one transaction, and the S-04 plan chose an RPC over a
route-level gate precisely because "a route- or component-level gate is decorative". A direct browser→Storage upload
cannot be inside that transaction. The object lands in Storage without the database knowing, or the database records
a CV that never finished uploading. Given the PRD's "file loss is unacceptable" guardrail, the plan needs an explicit
answer here — most likely a two-phase write (record a pending row, mint the presigned URL, confirm on completion)
plus a reconciliation story for rows that never get confirmed. This is the single most important design question
the plan must resolve, and it is a direct consequence of a decision already taken in `infrastructure.md`.

**Authorisation must move to URL-minting time.** Because the upload and download bypass the Worker, the only moment
the application can enforce `candidate.write` (upload) or `candidate.read` (download) is when it mints the signed
URL. The signed URL itself is a bearer credential. Combined with the NFR forbidding unauthorised access to candidate
data, this implies: a private bucket, short TTLs, and no long-lived URL ever persisted in the database or the DTO.

**The profile is already org-wide at the database layer; only the application is recruitment-scoped.** This is the
cleanest finding of the research. `candidates` RLS answers to `candidate.read`/`candidate.write` with no recruitment
predicate, so a query addressed purely by `candidates.id` is *already permitted today* — nothing in the schema forces
the profile through `candidate_recruitments`. The nesting is an application-layer artifact of S-01…S-04, which had no
reason to address a candidate directly. FR-007 and FR-011 both describe a candidate-scoped resource, and S-06
(candidate history search) will require one. Building `/candidates/:candidateId` in S-05 costs a route family and a
DTO split now; deferring it means S-06 reworks whatever S-05 bolts onto the nested page.

**Retention is a genuinely new capability class for this project, not a feature.** Every other slice added tables,
RPCs, routes, and components — all request-scoped, all authorised by a logged-in user. FR-013a needs unattended
execution with elevated privilege, and the project has neither an execution surface (the adapter's worker entry has
no `scheduled` export; no functions tree; no scheduled CI) nor a privileged identity (no service-role key; every RPC
gates on `auth.uid()`). It also has no *deletion* precedent at all: there is no DELETE policy or grant on any domain
table in the schema — deletion has been refused by omission everywhere, deliberately, since F-01. FR-013a is the
first requirement in the project that genuinely needs something removed. Whichever mechanism is chosen, it is net-new
infrastructure with a new deploy path and, per `infrastructure.md:96`, service-role key handling is a human-only
operation. The plan should size this honestly rather than treating it as a trailing phase.

**Two things are cheaper than they look.** Making identity fields editable (the S-04 deferral) requires no migration
at all — the UPDATE policy and grant already exist and are simply unused. And the shared-profile semantics of FR-007
are already enforced in the database via the `lower(email)` unique index and the dedup branch in
`add_candidate_to_recruitment`; S-05 inherits a working shared profile rather than having to build one.

## Historical Context (from prior changes)

- `context/changes/recruiter-manages-candidate-status/plan.md:75-76` — S-04 explicitly scoped CV and the full profile
  out: "No CV upload, no full candidate profile — FR-011/FR-012/FR-013a belong to S-05. This slice's detail page
  carries identity fields and notes only, **and S-05 will restructure it**."
- `context/changes/recruiter-manages-candidate-status/plan.md:479` — "Identity fields are read-only in this slice;
  S-05 makes them editable."
- `context/changes/recruiter-manages-candidate-status/plan.md:37-40` — the precedent that a route-level gate is
  "decorative" when RLS already permits the write through bare PostgREST, so invariants belong in a
  `SECURITY DEFINER` RPC. Directly relevant to where the retention and upload-confirmation logic should live.
- `context/changes/recruiter-manages-candidate-status/reviews/impl-review.md` — F1 (critical): an unscoped
  `SECURITY DEFINER` RPC (`get_user_emails`) granted to `authenticated` allowed any user to enumerate any user's
  email. Fixed by scoping it to a caller-visible `candidate_recruitment`. **A cautionary precedent for the new
  signed-URL-minting RPC/route**, which is structurally the same shape: a privileged helper that must authorise
  against the caller's own visibility.
- `context/changes/recruiter-customizes-kanban-stages/plan.md` and its review — established the "never edit a merged
  migration; ship a full `create or replace` in a new file" rule and the `PA0NN` codebook discipline.
- `context/foundation/infrastructure.md:77-84` — the pre-mortem narrative and the presigned-URL conclusion, written
  at platform-selection time (2026-05-31) specifically about this feature.

## Related Research

- `context/changes/recruiter-manages-candidate-status/research.md` — S-04's research; covers the candidate/notes data
  model and the RLS posture this slice builds on.
- `context/changes/recruiter-customizes-kanban-stages/research.md` — the RPC/errcode conventions in depth.
- `context/changes/recruiter-views-kanban-board/research.md` — the original board read path and DTO conventions.
- `context/changes/recruiter-creates-recruitment/research.md` — the first `SECURITY DEFINER` RPC and its hardening
  contract.
- `context/foundation/infrastructure.md` — platform decision, risk register, and the CV-upload pre-mortem.

## Open Questions

**Blocking — the plan must resolve these:**

1. **Profile route shape.** Does S-05 introduce a candidate-scoped `/candidates/:candidateId` (serving FR-007/FR-011
   properly and pre-building what S-06 needs), or bolt the CV onto the existing recruitment-nested page and defer the
   split? This determines the size of the slice and how much S-06 reworks. Note `PROTECTED_ROUTES` would need
   extending for a new top-level family.
2. **Upload atomicity.** What is the two-phase protocol between "mint presigned URL" and "CV is recorded on the
   profile", and how are orphans reconciled in both directions? The "file loss is unacceptable" guardrail makes this
   non-optional.
3. **Retention mechanism.** All four candidates are blocked today (see §4 table). Which one, and what net-new
   infrastructure and deploy path does it bring? Who holds the service-role key, given key rotation is a human-only
   operation (`infrastructure.md:96`)?
4. **CV cardinality.** One current CV per candidate (replaced on re-upload), or a history of uploads? FR-012/FR-013a
   say "plik CV" (singular), but retention deletes per-file with a per-file 12-month clock, and after deletion the
   profile must still render intact. This shapes whether CV metadata is columns on `candidates` or its own table.

**Needs external verification (out of scope for internal research):**

5. **Does deleting a row from `storage.objects` actually remove the underlying object in Supabase Storage?** This
   determines whether a pure-SQL `pg_cron` job can satisfy "permanently deleted", or whether the retention job must
   call the Storage API. Note the `storage` schema is not PostgREST-exposed here (`config.toml:13`).
6. **Does Supabase Storage support native object expiry / TTL?** If so, FR-013a might need no scheduler at all — this
   would collapse the largest unknown in the slice and is worth checking first.
7. **Can `pg_cron` be enabled on this Supabase project, and is `pg_net` needed to reach the Storage API from SQL?**
8. **Bucket-level constraints:** can allowed MIME types (PDF/DOCX) and a per-bucket size limit be declared in
   `supabase/config.toml` so local, CI, and production agree? The global limit is 50MiB (`config.toml:112`); the PRD
   sets no per-file limit (`prd.md:156` records it as an open question owned by the user).

**Product decision:**

9. **Maximum CV file size**, still unspecified in the PRD and flagged in the roadmap (`roadmap.md:149`).
