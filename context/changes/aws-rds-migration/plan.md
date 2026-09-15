# AWS + RDS Migration Implementation Plan

## Overview

Move the service off Cloudflare Workers and off Supabase, onto AWS compute with an RDS Postgres database, S3 for CV
storage, and a replacement identity provider. Also moves source control and CI from GitHub to Bitbucket. Sequenced as **six independently deployable phases**,
each ending with a running app and a green test suite.

The load-bearing insight: **RDS replaces only one of the four Supabase subsystems this app uses.** Postgres → RDS is
the easy third of the work. PostgREST (the `.from().select()` data layer), GoTrue (auth), and Storage have no
managed AWS drop-in and account for the rest.

## Current State Analysis

**Runtime.** `output: "server"` with `@astrojs/cloudflare`, deployed as a Worker (`wrangler.jsonc`,
`compatibility_flags: ["nodejs_compat"]`). Secrets arrive via `astro:env/server` from a two-key schema
(`SUPABASE_URL`, `SUPABASE_KEY`), both `optional: true`.

**Data access.** A single `createServerClient` factory in `src/lib/supabase.ts` bridges cookies to the Supabase SSR
client; everything else consumes it. 48 `src/` files reference Supabase — ~40 of them issuing PostgREST queries
through services (`src/lib/services/*.ts`) and API routes (`src/pages/api/**`). Types are generated from the live
database into `src/db/database.types.ts` via the `db:types` script.

**Authorisation is genuinely in the database.** `src/middleware.ts` resolves `auth.getUser()`, then reads
`group_memberships` / `group_operations` to populate `context.locals.operations` — but comments there are explicit
that this signal only drives _rendering_, and that "every route and RPC keeps its own server-side gate". Those gates
are RLS policies and `SECURITY DEFINER` functions keyed on `auth.uid()`.

**What is Supabase-shaped, measured:**

- 13 of 25 migrations reference `auth.uid()` / `auth.jwt()` / `auth.users`.
- 13 RPCs invoked from 14 call sites, including the cross-row-invariant writes (`create_recruitment`,
  `move_candidate_stage`, `add_candidate_to_recruitment`, `replace_recruitment_stages`).
- Storage confined to `src/lib/services/candidate-cv.ts` + 3 CV endpoints.
- `supabase/tests/rls_verification.sql`, run via `npm run test:rls` against the local Docker container.

### Key Discoveries

- **`workerd` cannot open ordinary TCP connections to Postgres.** This single fact sets the phase order. Any SQL
  client introduced before leaving Cloudflare needs Hyperdrive or a fetch-based driver purely as scaffolding, to be
  deleted one phase later. **Leave Cloudflare first.**
- **The Supabase client has exactly one construction site** (`src/lib/supabase.ts`). The data-access rewrite can
  therefore proceed service-by-service behind a stable seam rather than as a big-bang cutover.
- **Direct GoTrue/PostgREST test coupling is narrow.** Only 3 of 8 integration suites bypass the app
  (`authorization`, `candidates-cv`, `security-groups`, via `getAccessTokenForRole` / `supabaseRestUrl`). The other
  5 drive the app's own HTTP surface and survive every phase untouched. This was the biggest downside risk in
  initial scoping and it measured smaller than feared.
- **CV bytes never transit the server on _upload_**, by an explicit earlier decision recorded in
  `context/foundation/infrastructure.md` (workerd drops bodies above ~5MB). The browser PUTs to a signed URL, and S3
  presigned PUT preserves that shape exactly — the architecture ports, only the URL minting changes. **Downloads are
  the exception**: `candidate-cv.ts:197` calls `.download()`, pulling the whole blob through the server. The workerd
  limit that motivated the upload design stops applying once Phase 1 lands on Node, so this is not urgent — but 4.5
  should prefer presigned GET for symmetry rather than treating it as a coin flip.
- **`context/deployment/deploy-plan.md` and `context/foundation/infrastructure.md` both encode Cloudflare as the
  target** and will be contradicted by Phase 1. They must be superseded, not silently left stale.

## Desired End State

Astro SSR on AWS Node compute, issuing SQL through a typed query builder to RDS Postgres, with CV objects in S3 and
sessions issued by a non-Supabase identity provider. No `@supabase/*` dependency, no `wrangler`, no `supabase` CLI.
`npm run lint`, `npm run test`, `npm run test:integration`, and `npm run test:e2e` all green.

## What We're NOT Doing

- **Not changing the schema's shape.** Tables, constraints, indexes, and triggers port as-is; only `auth.*`
  references change.
- **Not rewriting the frontend.** No React component or `.astro` page changes except where a service signature moves.
- **Not introducing an ORM with migrations of its own.** The `supabase/migrations/*.sql` files stay the source of
  truth; only the runner changes in Phase 3.
- **Not adding a scheduler for CV purge.** Still manually triggered, as decided in
  `candidate-profile-and-cv-upload`. The endpoint remains the seam.
- **Not deciding the RLS question up front.** See Phase 4.1.

---

## Phase 0: GitHub → Bitbucket

**Goal:** move source control and CI before anything else changes, so `ci.yml` is ported **once** rather than
rewritten on GitHub in Phase 1 and again on Bitbucket later. Same waste-motion argument that sets the
Cloudflare-first ordering.

0.1 Create the Bitbucket repository; push all branches and tags. Repoint `origin`
(currently `git@github.com:mariusz-czabaj/hire_track.git`).
0.2 Port `.github/workflows/ci.yml` → `bitbucket-pipelines.yml`, **as a like-for-like lift of today's behaviour** —
no ECR/deploy steps yet, those arrive in 1.5. Two jobs become two steps: `ci` (typecheck, test, lint, build)
and `e2e`.
0.3 Translate the GitHub-specific mechanics: - `actions/checkout` + `actions/setup-node` → a `node:22` image plus a `node_modules` cache definition. - `supabase/setup-cli@v1` has **no Bitbucket equivalent** — install the CLI explicitly (it is already a
devDependency, so `npx supabase` may suffice). - `$GITHUB_ENV` has no equivalent. The "Export local Supabase connection info" and "Map local Supabase env"
steps must be collapsed into the same shell step that consumes them, since Pipelines does not persist
exported vars across steps. - `secrets.*` → Bitbucket repository variables, marked **secured**.
0.4 Enable the `docker` service on the e2e step and raise its memory allocation (`size: 2x` on the step, plus an
explicit `memory` on the docker service definition).
0.5 **Preserve the polling bash verbatim.** The route-by-route readiness probes and the sign-in retry loop in the
e2e job encode several separately-diagnosed CI flakes (Vite lazy module-graph reloads per route; GoTrue/PostgREST
clock skew producing `PGRST303`). It is plain shell and ports unchanged — do not "tidy" it.
0.6 Move branch protection / required-checks rules to Bitbucket, and update the CI section of `CLAUDE.md`, which
currently documents GitHub Actions and a `master` branch that no longer matches `main`.

#### Automated Verification:

- A Bitbucket pipeline run is green on both the `ci` and `e2e` steps, matching today's GitHub run.

#### Manual Verification:

- Bitbucket holds the branch-protection and required-checks rules GitHub had.
- `CLAUDE.md`'s CI section names Bitbucket Pipelines and the `main` branch.

**Risk — this is the one thing in Phase 0 that can genuinely fail.** `supabase start` brings up ~10 containers.
Bitbucket Pipelines caps the Docker service's memory far more tightly than a GitHub `ubuntu-latest` runner, and the
full Supabase stack may not fit even at `2x`. **Fallback if it doesn't:** keep the e2e job on GitHub Actions
temporarily, move only the `ci` step to Bitbucket, and collapse e2e onto Bitbucket at **Phase 3** — which replaces
the whole Supabase stack with a single `postgres:17` container and makes the memory problem disappear. Decide this
by spiking 0.4 early rather than discovering it at the end of the phase.

---

## Phase 1: Cloudflare → AWS Node runtime

**Goal:** identical behaviour, different host. Supabase untouched. This is the cheap step that unblocks Phase 2.

1.1 Replace `@astrojs/cloudflare` with `@astrojs/node` (`mode: "standalone"`) in `astro.config.mjs`.
1.2 Choose compute: **App Runner** (least operational surface) or **ECS Fargate** (more control, needed later if
RDS lives in a private subnet — note App Runner reaches RDS only via a VPC connector).
1.3 Delete `wrangler.jsonc`, `.dev.vars`, `.wrangler/`; drop `wrangler` from devDependencies.
1.4 Move `SUPABASE_URL` / `SUPABASE_KEY` to Secrets Manager (or SSM Parameter Store); keep the `astro:env` schema
unchanged so no consuming code moves.
1.5 Extend `bitbucket-pipelines.yml` (from Phase 0) with a deploy step — build container image, push to ECR,
deploy. Use Bitbucket **OIDC** to assume the deploy role rather than storing long-lived AWS keys.
1.6 Supersede `context/deployment/deploy-plan.md` and the `recommended_platform` / `runtime` frontmatter in
`context/foundation/infrastructure.md` — and **record why**, since that document's stated reason for choosing
Cloudflare was that "the Workers free tier covers MVP traffic with no billing required". Overriding it is a
deliberate call and should read as one.

**Cost — price this before 1.2 is decided, not after.** The target stack (compute + RDS + S3 + Secrets Manager, and
a NAT gateway if RDS sits in a private subnet as 1.2 anticipates) has a monthly floor in the tens of dollars against
a current floor of roughly zero. Produce a table of monthly estimates covering: App Runner vs. ECS Fargate;
`db.t4g.micro` vs. the size 3.1 actually settles on; and NAT gateway vs. the no-NAT variant (App Runner reaching a
publicly-addressable RDS locked down by security group). The cheapest viable combination may well change 1.2's
answer, and the RDS figure is the only concrete input 3.1's sizing gate currently has. Expected traffic volume is
not recorded anywhere in `context/` — establish it here.

#### Automated Verification:

- `npm run lint`, `npm run test`, `npm run test:integration`, `npm run test:e2e` green against the Node build.
- `nodejs_compat` and `wrangler` are referenced nowhere in the repo.
- The Bitbucket deploy step builds, pushes to ECR, and deploys via an OIDC-assumed role.

#### Manual Verification:

- AWS account, VPC, and ECR repository provisioned; deploy IAM role scoped to push+deploy only.
- The cost table exists and 1.2's compute choice is recorded against it.
- `deploy-plan.md` and `infrastructure.md` no longer describe Cloudflare as the target.

---

## Phase 2: PostgREST → SQL, still against Supabase's database

**Goal:** remove the `.from().select()` layer while `auth.uid()`, RLS, and all 13 RPCs keep working. This
is the largest phase and the one that carries the real risk.

**Keeping RLS alive is not automatic.** RLS enforces today only because PostgREST connects as `authenticator` and
then, per request, sets `request.jwt.claims` and issues `SET LOCAL ROLE authenticated` — exactly the sequence
`supabase/tests/rls_verification.sql` reproduces by hand. `auth.uid()` reads that GUC and nothing else. A query
builder pointed at the direct connection string authenticates as the **database owner, who has BYPASSRLS**: all 71
`TO authenticated` policies and 11 `SECURITY DEFINER` functions would stop constraining anything — silently, with a
green suite, because only 2.6's denial assertions could see the difference. The GUC work in 2.2 is therefore
load-bearing for this phase, not just preparation for Phase 4.

2.1 Add a query builder — **Drizzle** or **Kysely** — connecting to Supabase's direct connection string (now
possible: Node runtime). Introduce it behind the existing `src/lib/supabase.ts` seam. **Connect as a non-owner
login role** (an `authenticator` equivalent that can `SET ROLE authenticated` but has no BYPASSRLS). Spike this
first: whether Supabase exposes such a role on the direct, non-pooler connection string is unverified, and the
whole phase's safety rests on it.
2.2 **Set three things per request, inside one transaction on one connection:** `SET LOCAL ROLE authenticated`,
`request.jwt.claims` (so today's `auth.uid()` policies and `SECURITY DEFINER` functions keep resolving), and
`app.user_id` (read by nothing yet, but it makes Phase 4.4 a policy-only change with the plumbing already proven).
The first two keep this phase safe; the third prepares the next one.

**The seam has to change shape to carry this.** `SET LOCAL` survives only inside a transaction, and only on the
connection that ran it. Today's seam hands back a stateless client and 20 call sites each construct one
independently (`createClient(context.request.headers, context.cookies)` across services, API routes, and
`src/pages/recruitments/[id].astro`); it cannot express "hold this connection for the duration of the request".
So 2.2's **first deliverable is the seam itself** — a `withUserTx(locals, cb)` that checks out one connection, opens
a transaction, sets the three GUCs, and passes a bound query builder to the callback — resolved in
`src/middleware.ts` and reached through `context.locals`. Port exactly one service against it (2.3's
`security-groups`) and review the shape before the other five follow; getting this wrong means porting all six
twice.
2.3 Port services one at a time, each with its unit tests, in ascending order of difficulty:
`security-groups` → `candidate-list` → `candidate-profile` → `candidates` → `recruitments` → `candidate-cv`.
2.4 Port the 14 `.rpc()` call sites to plain `select * from fn(...)`. The functions themselves do not change.
2.5 Rewrite `src/middleware.ts`'s `resolveCallerOperations` as a single join.
2.6 Rewrite the 3 bypass tests (`authorization`, `candidates-cv`, `security-groups`) to assert via direct SQL
instead of `supabaseRestUrl` / `getAccessTokenForRole`. **Do this first, not last** — they are the assertions
that prove RLS still denies what it should, and they must stay meaningful throughout the port.
2.7 Replace the `db:types` script with the query builder's own type generation; retire `src/db/database.types.ts`.

This phase is explicitly incremental and should be shippable at any point within it.

#### Automated Verification:

- After each ported service, the full suite is green — not only at the end of the phase.
- `npm run test:rls` stays green throughout.
- `src/db/database.types.ts` is gone and types come from the query builder.

#### Manual Verification:

- 2.6's denial assertions are observed to **fail** against a deliberately owner-connected client at least once —
  proof they can detect a BYPASSRLS regression rather than passing vacuously.
- The `withUserTx` seam shape is reviewed after `security-groups` and before the other five services follow.

---

## Phase 3: Supabase Postgres → RDS

**Goal:** move the bytes. Small, because Phases 1–2 removed everything that made the database special.

3.1 Provision RDS Postgres **17** (matching `supabase/config.toml`'s `major_version = 17`).
3.2 `pg_dump` the `public` schema + data, **and `auth.users` separately** (it is needed by 3.2a and Supabase is torn
down after this phase); restore `public` to RDS.
3.2a **Build the `auth.*` compatibility shim before the restore can succeed.** RDS is a plain Postgres instance: it
has no `authenticated` / `anon` / `service_role` roles and no `auth` schema, so `public`'s own DDL does not stand up
without them — 71 policies name `TO authenticated` and 13 migrations call `auth.uid()`. As a new migration:
create the three roles; create `public.users` and backfill it from the `auth.users` dump (this is 4.3, moved forward
because Phase 3 cannot be green without it); repoint the `auth.users` foreign keys at it; and define
`auth.uid()` as `current_setting('request.jwt.claims', true)::json->>'sub'`, matching the GUC that Phase 2.2 is
already setting per request. Phase 4.4 then narrows to deleting this shim rather than inventing the replacement.
3.3 Replace the Supabase migration runner. Options: a plain `psql`-driven runner, or Drizzle's. `supabase/` becomes
`db/`.
3.4 Repoint the connection string at RDS; delete the `supabase` CLI dependency and `config.toml`.
3.5 Replace the local Docker dev stack — a plain `postgres:17` container plus `seed.sql`. The `test:rls` script
currently hardcodes `docker exec -i supabase_db_10x-astro-starter`; rewrite it to take a **connection string** so it
can run against the new local container and against RDS.

3.6 **Cutover runbook.** 3.2's dump and 3.4's connection-string flip are separated in time, and the app is live
against Supabase in between — every write in that window is lost. This is the only irreversible step in the plan, so
it gets a written sequence rather than being improvised on the day:

1. Announce a maintenance window.
2. Freeze writes at the source — revoke write grants on Supabase, or scale the app to zero. Verify the freeze took.
3. `pg_dump` (3.2), restore, apply the 3.2a shim.
4. **Reconcile row counts per table as a gate, not as verification.** A mismatch stops the cutover here, with
   Supabase still intact and still the source of truth.
5. Flip the connection string (3.4) and unfreeze.
6. Keep the Supabase project alive, read-only, for an agreed retention period as the rollback target. **Rollback is
   "revert the connection string and lift the read-only flag"** — which stays true only for as long as no writes
   have landed in RDS, so name the point after which rollback means a reverse migration instead.

Only after that retention window expires do 3.4's deletions (`supabase` CLI, `config.toml`) actually run.

#### Automated Verification:

- `npm run test:rls` passes against RDS, unchanged apart from its connection (3.2a is what makes this possible).
- Full suite green against RDS.
- Local dev comes up on a plain `postgres:17` container plus `seed.sql`.

#### Manual Verification:

- RDS instance sizing, backup/PITR retention, and subnet placement decided and provisioned.
- Per-table row counts reconcile against the Supabase source **before** the connection string is flipped.
- The rollback target (read-only Supabase) is confirmed reachable, and its retention expiry date is recorded.

---

## Phase 4: Auth and Storage

**Goal:** the last vendor dependency. Deliberately last, because it is the only phase that changes the security
model rather than relocating it.

**4.1 — Open with the RLS decision.** Keep RLS via the `app.user_id` GUC already plumbed in 2.2 (recommended), or
move authorisation into the service layer. This choice determines 4.4's size and must be settled before any code
moves.

4.2 Replace GoTrue: **Cognito** (managed, more integration friction) or **self-hosted sessions** (e.g. Lucia —
fewer moving parts, more code owned). Only 4 call sites change (`signin`, `signup`, `signout`, middleware's
`getUser`), but the _session cookie format_ changes, which is what `integration-client.ts` depends on.
4.3 _(Moved to 3.2a — `public.users` and the FK repointing land in Phase 3, since the RDS restore cannot be green
without them.)_
4.4 Retire the 3.2a shim: rewrite the 13 migrations' `auth.uid()` references as
`current_setting('app.user_id', true)::uuid` (the GUC plumbed in 2.2), then drop the shim's `auth.uid()` and the
`auth` schema. Ship as new migrations, not edits to historical ones. Decide at this point whether the
`authenticated` role stays as the RLS-bearing role or is renamed.
4.5 Migrate Storage → S3: `createSignedUploadUrl` → presigned PUT, `download` → **presigned GET** (preferred, so
downloads stop transiting the server as uploads already don't) with streamed `GetObject` as the fallback if the
response must be gated per-request, `remove` → `DeleteObject`. Confined to `src/lib/services/candidate-cv.ts`.
4.6 **Storage RLS has no S3 equivalent.** The `storage.objects` policies from
`20260902100100_candidate_cv_storage_policies.sql` become application-layer checks at the minting endpoint —
which, per that change's own notes, was already the entire authorisation perimeter for uploads. Bucket-level
`file_size_limit` and `allowed_mime_types` become explicit server-side checks; S3 enforces neither.
4.7 Remove `@supabase/ssr` and `@supabase/supabase-js`.

#### Automated Verification:

- `rls_verification.sql`, rewritten for the `app.user_id` GUC, is green.
- All 8 integration suites green; `npm run test:e2e` green.
- No `@supabase/*` package remains in `package.json`.

#### Manual Verification:

- The 4.1 RLS decision is recorded in `change.md` before any 4.4 code moves.
- CV upload, download, and remove each exercised by hand against S3.
- Size and MIME limits are rejected server-side at the minting endpoint.

---

## Risks

| Risk                                                    | Mitigation                                                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 2 is long enough to stall mid-way                 | It is incremental by service and shippable throughout; 2.6 keeps the denial assertions honest the whole time                                  |
| Query builder connects as owner → RLS silently bypassed | 2.1 uses a non-owner role; 2.2 sets `ROLE` + `request.jwt.claims` per request; Phase 2 verification proves the denial tests can actually fail |
| Losing the DB-level authz backstop                      | 4.1 is an explicit decision gate, not a default; recommendation is to keep RLS                                                                |
| `auth.users` FKs discovered late                        | Resolved in 3.2a, not deferred; the dump in 3.2 explicitly captures `auth.users` before Supabase is torn down                                 |
| Writes lost during the dump→flip window                 | 3.6 freezes writes at the source first and gates the flip on a per-table row-count reconciliation                                             |
| RDS misbehaves after cutover                            | 3.6 keeps Supabase read-only as a rollback target; rollback is a connection-string revert until first RDS write                               |
| S3 has no size/MIME enforcement                         | 4.6 makes these explicit app-side checks; MIME was never sniffed even on Supabase                                                             |
| e2e suite churn across 3 phases                         | `tests/e2e/*` drive the browser only; they should survive Phases 1–3 and break only at 4.2's cookie change                                    |

## Rough sizing

| Phase              | Estimate                                                     |
| ------------------ | ------------------------------------------------------------ |
| 0 — Bitbucket      | ~1 day, open-ended if the e2e Docker spike (0.4) doesn't fit |
| 1 — runtime        | ~1 day                                                       |
| 2 — data access    | ~2 weeks                                                     |
| 3 — RDS            | ~3 days                                                      |
| 4 — auth + storage | ~1–2 weeks                                                   |

**Stopping early is viable.** After Phase 0 you are on Bitbucket. After Phase 1 you are on AWS. After Phase 2 you are portable — the remaining Supabase
dependency is a connection string, an auth call, and a storage call.

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 0: GitHub → Bitbucket

#### Automated

- [ ] 0.2 Port ci.yml to bitbucket-pipelines.yml as a like-for-like lift
- [ ] 0.3 Translate checkout/setup-node, supabase CLI install, $GITHUB_ENV, secrets
- [ ] 0.4 Enable the docker service on the e2e step and raise its memory (spike first)
- [ ] 0.5 Preserve the e2e polling bash verbatim

#### Manual

- [ ] 0.1 Create the Bitbucket repository, push branches and tags, repoint origin
- [ ] 0.6 Move branch protection to Bitbucket and correct CLAUDE.md's CI section

### Phase 1: Cloudflare → AWS Node runtime

#### Automated

- [ ] 1.1 Replace @astrojs/cloudflare with @astrojs/node (standalone)
- [ ] 1.3 Delete wrangler.jsonc, .dev.vars, .wrangler/, and the wrangler devDependency
- [ ] 1.5 Extend bitbucket-pipelines.yml with an ECR build/push/deploy step via OIDC

#### Manual

- [ ] 1.2 Price the options, then choose compute (App Runner vs ECS Fargate)
- [ ] 1.4 Move SUPABASE_URL / SUPABASE_KEY to Secrets Manager or SSM
- [ ] 1.6 Supersede deploy-plan.md and infrastructure.md, recording the cost override

### Phase 2: PostgREST → SQL, still against Supabase's database

#### Automated

- [ ] 2.1 Add the query builder on a non-owner login role (spike the role first)
- [ ] 2.2 Build the withUserTx seam setting ROLE, request.jwt.claims, and app.user_id
- [ ] 2.6 Rewrite the 3 bypass tests to assert via direct SQL — do this first
- [ ] 2.3 Port the six services in ascending order of difficulty
- [ ] 2.4 Port the 14 .rpc() call sites to select \* from fn(...)
- [ ] 2.5 Rewrite resolveCallerOperations as a single join
- [ ] 2.7 Replace db:types with the query builder's type generation

#### Manual

- [ ] 2.8 Review the withUserTx shape after security-groups, before the other five

### Phase 3: Supabase Postgres → RDS

#### Automated

- [ ] 3.2a Build the auth.\* compatibility shim: roles, public.users, FK repoint, auth.uid()
- [ ] 3.3 Replace the Supabase migration runner; supabase/ becomes db/
- [ ] 3.5 Replace the local Docker stack with postgres:17 + seed.sql; reconnect test:rls

#### Manual

- [ ] 3.1 Provision RDS Postgres 17 (sizing, backup/PITR, subnet placement)
- [ ] 3.2 pg_dump public + auth.users; restore public to RDS
- [ ] 3.6 Execute the cutover runbook: freeze, dump, restore, reconcile, flip, retain
- [ ] 3.4 Repoint the connection string; delete the supabase CLI and config.toml

### Phase 4: Auth and Storage

#### Automated

- [ ] 4.4 Retire the 3.2a shim: auth.uid() → current_setting('app.user_id')
- [ ] 4.5 Migrate Storage to S3: presigned PUT, presigned GET, DeleteObject
- [ ] 4.6 Move storage.objects policies, size, and MIME limits to app-layer checks
- [ ] 4.7 Remove @supabase/ssr and @supabase/supabase-js

#### Manual

- [ ] 4.1 Decide the RLS question before any code moves
- [ ] 4.2 Replace GoTrue (Cognito vs self-hosted sessions); session cookie format changes
