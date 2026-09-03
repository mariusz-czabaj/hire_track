# Candidate Profile and CV Upload Implementation Plan

## Overview

Deliver roadmap slice **S-05** (`candidate-profile-and-cv-upload`): a candidate-scoped profile page showing the
shared identity fields (full name and phone editable, email read-only) plus a single CV file held privately in
Supabase Storage. The CV is uploaded **browser-direct via a signed URL** so its bytes never pass through the
Cloudflare Worker, downloaded by **streaming through an authorising API route**, and becomes **unreadable at exactly
12 months** via a generated `expires_at` column. The physical bytes are removed by a **manually triggered purge
endpoint** — no scheduler in this slice.

PRD refs: FR-007, FR-011, FR-012, FR-013a (partially — see "What We're NOT Doing"), §Non-Functional Requirements
(retention, unauthorised access).

## Current State Analysis

The database is already shared-profile ready. Nothing else for this slice exists.

**What exists:**

- `candidates(id, full_name, email, phone, created_at, updated_at)` with a unique index on `lower(email)` and a
  `pg_trgm` GIN index on `full_name` — `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:62-77`.
  **No CV, file, or storage column of any kind.**
- **Org-wide RLS on `candidates`**, gated by `private.has_operation('candidate.read')` / `('candidate.write')` with
  no recruitment predicate — `20260831183457_rls_policies.sql:175-190`. Grant is `select, insert, update`; **no
  DELETE policy** (`:242`). `candidates_update` and its grant already exist and are **completely unused**.
- The email-based dedup that makes FR-007's shared profile real: `add_candidate_to_recruitment` reuses an existing
  `candidates` row on a `lower(email)` match, raising `PA003` on a name mismatch —
  `20260901210500_candidate_write_rpcs.sql:61-75`.
- `[storage] enabled = true` with a global `file_size_limit = "50MiB"` — `supabase/config.toml:109-112`.
- The S-04 candidate detail page, keyed by `candidate_recruitments.id`, rendering identity **read-only** and notes
  per stage — `src/components/recruitments/CandidateDetail.tsx:170-190`.

**What does not exist:**

- Any storage bucket. The `[storage.buckets.*]` block in `config.toml:115-118` is entirely commented out, and grep
  for `storage|bucket|objects` across all migrations returns **zero matches** — so no RLS on `storage.objects`.
- Any route addressing a candidate by `candidates.id`. Nothing under `src/pages/candidates/` or
  `src/pages/api/candidates/`; every existing service call filters `.eq("recruitment_id", …)`
  (`src/lib/services/candidates.ts:58,107,191`).
- Any UPDATE path on `candidates` — no service function calls `.from("candidates")` at all.
- Any file-upload code. The only `formData()` uses are the urlencoded login forms
  (`src/pages/api/auth/signin.ts:5`). No `File`, no `<input type="file">`, no `.storage`.
- Any scheduler, service-role key, or DELETE policy anywhere in the project.

### Key Discoveries:

- **The upload architecture was pre-decided, against the obvious one.** `context/foundation/infrastructure.md:65,84`
  rules out proxying CV bytes through the Worker — `workerd` silently drops bodies above ~5MB — and mandates
  browser → Storage direct upload via signed URL. Flagged there as "decide this before building the upload feature".
- **Storage RLS is enforced at mint time only, never at upload time.** The signed upload token is a standalone bearer
  capability; the upload request carries no session. The mint endpoint is therefore the _entire_ authorisation
  perimeter — structurally the same shape as S-04's critical F1 finding, and it must be treated with the same care.
- **Bucket config is a genuine server-side enforcement boundary.** Per-bucket `file_size_limit` and
  `allowed_mime_types` are enforced by the storage server even on a signed-URL upload the app never sees. Size is
  truncated at the stream; **MIME is taken from the client-declared `Content-Type` and is not sniffed**, so the
  allowlist is a correctness guard, not a security control.
- **Never delete `storage.objects` rows with SQL.** Doing so orphans the binary, and Supabase now rejects DELETE on
  storage tables via trigger unless a session flag is set. Physical deletion **must** go through the Storage API,
  which is why the purge is TypeScript and not a Postgres function.
- **Store-side TTL cannot deliver the access guarantee.** Every object store surveyed expires objects
  asynchronously with no contractual upper bound, and the object stays readable past the deadline (GCS states this
  explicitly). The access cutoff must therefore be application logic regardless of store — which is what makes the
  derived-expiry approach load-bearing rather than a convenience.
- **`PA005` is the next free errcode.** The codebook is documented at `20260901162000_kanban_stage_rpcs.sql:5-11`
  and currently runs `42501`, `P0002`, `22023`, `PA001`–`PA004`.
- Denial semantics are fixed: not visible → 404, visible but no write → 403, produced by a read-then-write two-step
  as an RPC's first statements (`20260901162000:30-36`).

## Desired End State

A recruiter opens a candidate from the board and lands on `/candidates/:candidateId` — a profile page showing the
candidate's identity (name and phone editable in place, email read-only), a list of the recruitments they appear in,
and a CV panel. With no CV, the panel offers an upload control that accepts a PDF or DOCX up to 5 MB. Choosing a file
uploads it straight to Supabase Storage without the bytes touching the Worker; the panel then shows the filename,
size and upload date with a download button. Downloading streams the file through an API route that re-checks
authorisation on every request. Twelve months after upload the CV stops being downloadable — the panel shows a
tombstone explaining it was removed after 12 months, with its original upload date, and offers a fresh upload. An HR
user or an Administrator can POST to a purge endpoint that physically removes the bytes of every expired or
superseded CV. A hiring manager sees the profile and can download a live CV, but gets a clean 403 on upload.

### Verification

`npx supabase db reset --local`, then the RLS/RPC assertion script passes, `npm run test`,
`npm run test:integration`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run build` all pass, and
`npm run db:types && git diff --exit-code src/db/database.types.ts` is clean.

## What We're NOT Doing

- **No scheduler, and therefore FR-013a's "automatically" is only partly delivered.** The **access** cutoff is fully
  automatic and exact — a CV becomes unreadable at 12 months whether or not anyone acts. The **physical byte
  deletion** is a manually triggered endpoint, by explicit decision during planning. This is a knowing partial
  delivery of a must-have FR; the endpoint is deliberately shaped as the seam a cron trigger can call later, and the
  gap is recorded in "Open Risks" in the brief. Closing it is a follow-up.
- **No switch to Cloudflare R2 or any other object store.** Evaluated during planning and declined: store-side TTL
  cannot provide the access guarantee, R2 has no server-side size enforcement at all, and its lifecycle and CORS
  config are out-of-band state that no code review would catch.
- **No editable email.** `lower(email)` is the unique key the shared-profile dedup depends on; changing it needs
  conflict handling and could silently re-point a profile several recruitments already share.
- **No CV versioning or history UI.** One active CV per candidate, replaced on re-upload. Superseded rows are
  retained for audit but never surfaced.
- **No candidate deletion.** No DELETE policy or grant exists on `candidates` and no FR asks for it. Retention
  deletes a _file_, never a candidate.
- **No cross-recruitment candidate search or global candidate list** — FR-014..FR-016 belong to S-06. This slice
  creates the candidate-scoped route family S-06 will build on, but no list or search view.
- **No restructuring of the S-04 notes UI.** The per-recruitment page keeps its notes exactly as they are and gains
  a link to the profile.
- **No CSRF work.** A pre-existing gap flagged at S-02 and unchanged since.
- **No upload progress bar or resumable (TUS) uploads.** A 5 MB cap makes a simple pending/complete state adequate.
- **No virus or content scanning**, and no verification that a file declared `application/pdf` really is one.
- **No board pagination.** Pre-existing (S-01 impl-review F3, skipped).

## Implementation Approach

Bottom-up, because the access guarantee is a database invariant and everything above it is presentation. Phase 1
creates the bucket and the CV table and — critically — puts RLS on `storage.objects`, which is what makes the mint
endpoint a real gate rather than a decorative one. Phase 2 exposes the profile as a candidate-scoped resource,
splitting the DTO that S-04 left fused. Phase 3 adds the whole CV lifecycle, where all the novel machinery lives.
Phases 4 and 5 build the UI and prove the path end to end.

**No service-role key is introduced anywhere.** Every operation in this slice — minting an upload URL, streaming a
download, purging bytes — is performed with the caller's own cookie-bound client, and authorisation is enforced by
RLS on `candidate_cvs` and on `storage.objects` using the existing `private.has_operation` helpers. This is only
possible because the purge is user-triggered; it is the main simplification the "no cron" decision bought.

The expiry rule is defined **once**, as a generated column, so the read path and the purge query cannot drift apart.

## Critical Implementation Details

**One definition of expiry.** `candidate_cvs.expires_at` is a `stored generated` column computed as
`uploaded_at + interval '12 months'`. Both the download gate and the purge selection read that column; neither
recomputes the interval. This also makes expiry testable without waiting a year — a test inserts a row with a
backdated `uploaded_at` and the generated column follows.

**Purge ordering is not interchangeable.** For each purgeable row: delete the object through the Storage API
**first**, and only set `object_deleted_at` once that succeeds. Reversing it loses the storage path while the bytes
still exist, orphaning the file permanently with no way to find it again. A failed object delete simply leaves the
row eligible for the next run, which makes the endpoint idempotent and self-healing; a delete that 404s because the
object is already gone counts as success.

**The signed upload URL's lifetime is not configurable and differs between environments.** There is no `expiresIn`
parameter on `createSignedUploadUrl`. The storage server's own default is 60 seconds while hosted Supabase is
widely reported at ~2 hours, so **the implementer must measure the local TTL empirically in Phase 3** rather than
assume it. Consequence for the UI: mint the URL immediately before the upload starts, never ahead of time, and
re-mint rather than reuse on retry.

**Authorisation happens when the URL is minted, not when the bytes arrive.** The upload request carries only the
token. Everything the server wants to constrain — which candidate, which path, which content type — must be fixed
into the object path and the signature at mint time, because there is no second checkpoint.

**Adding `/candidates` to `PROTECTED_ROUTES` is not optional.** `src/middleware.ts:5` matches with `startsWith`, so
a new top-level family is unauthenticated by default until listed. API routes are already covered by the middleware's
separate `/api/*` branch.

## Phase 1: Storage bucket and CV schema

### Overview

Create the private bucket, the CV metadata table with its generated expiry column, RLS on both `candidate_cvs` and
`storage.objects`, and SQL assertions proving the permission matrix.

### Changes Required:

#### 1. Private CV bucket

**File**: `supabase/config.toml`

**Intent**: Declare a private bucket whose per-bucket limits are the only server-side enforcement available on a
browser-direct upload. Declaring it here rather than via the management API keeps local, CI and production in
agreement and makes the limits reviewable in a diff.

**Contract**: A `[storage.buckets.candidate-cvs]` block with `public = false`, `file_size_limit = "5MiB"`, and
`allowed_mime_types` listing exactly `application/pdf` and
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`. The global
`[storage] file_size_limit` stays at 50MiB — a per-bucket limit may not exceed it.

#### 2. CV metadata table

**File**: `supabase/migrations/20260902100000_candidate_cvs.sql`

**Intent**: Hold one active CV per candidate with the timestamps retention needs, a status that lets the two-phase
upload record an unconfirmed row, and a tombstone that survives byte deletion so the profile can explain the
absence. Follows the house migration conventions: header comment naming the slice and FRs, RLS enabled here,
per-operation policies `to authenticated`, every helper call wrapped in `(select …)`, explicit grants last.

**Contract**:

```sql
create table candidate_cvs (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references candidates (id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'active', 'superseded')),
  uploaded_at timestamptz not null default now(),
  expires_at timestamptz not null generated always as (uploaded_at + interval '12 months') stored,
  object_deleted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

A **partial unique index on `(candidate_id) where status = 'active'`** is what guarantees "one active CV per
candidate" — the invariant the whole model rests on. Add a plain index on `candidate_id`, and one supporting the
purge query over `(status, expires_at) where object_deleted_at is null`.

Policies for SELECT / INSERT / UPDATE only — no DELETE, mirroring every other table in the schema, since a tombstone
is an UPDATE and rows are never removed. SELECT gated by `candidate.read`; INSERT and UPDATE by `candidate.write`
(both `using` and `with check`). Grant `select, insert, update` to `authenticated`. Attach the existing
`private.set_updated_at()` trigger.

`uploaded_at` must remain insertable rather than defaulted-only, so tests can backdate a row and exercise expiry.

#### 3. RLS on `storage.objects`

**File**: `supabase/migrations/20260902100100_candidate_cv_storage_policies.sql`

**Intent**: Make the mint endpoint a real authorisation gate. Because storage RLS is evaluated when the signed URL
is minted and never again, these policies — not any application check — are what actually decide who may put a CV
into the bucket, read one back, or remove one. Without them the bucket rejects everything, and with the wrong ones
the mint endpoint becomes decorative in exactly the way S-04's plan warned about.

**Contract**: Three policies on `storage.objects`, each scoped with `bucket_id = 'candidate-cvs'` and
`to authenticated`:

- SELECT — `(select private.has_operation('candidate.read'))`, so the download route can read the object as the
  caller.
- INSERT — `(select private.has_operation('candidate.write'))`, the gate the mint call passes through.
- DELETE — `(select private.has_operation('candidate.write')) or (select private.has_operation('group.manage'))`,
  so both an HR user and an Administrator can run the purge.

No UPDATE policy: replacing a CV creates a new object rather than overwriting one, and `upsert` is deliberately not
used. No grants are needed — the storage schema ships with them and access is governed by these policies.

#### 4. Regenerate types

**File**: `src/db/database.types.ts`

**Intent**: Keep generated types in sync; CI fails on a dirty diff.

**Contract**: Output of `npm run db:types`, committed in the same commit as the migrations.

#### 5. RLS assertions

**File**: `supabase/tests/rls_verification.sql`

**Intent**: Prove the permission matrix at the layer that enforces it. Per S-03 impl-review F1, every assertion must
capture the affected row with `returning … into` and assert the value actually changed — never a predicate that
passes when zero rows match.

**Contract**: New numbered blocks in the file's existing
`begin; select set_config('request.jwt.claims', …); set local role authenticated; do $$ … raise exception 'FAIL: …' … $$; rollback;`
form, covering: HR can insert and select a `candidate_cvs` row; the Hiring Manager (read but no write) is denied
INSERT and denied an INSERT on `storage.objects` in this bucket; the Administrator (holding only `group.manage`) is
denied SELECT on `candidate_cvs` but **allowed** DELETE on `storage.objects` in this bucket; the partial unique
index rejects a second `active` row for the same candidate; and a row inserted with a backdated `uploaded_at`
reports `expires_at` in the past, proving the generated column.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `npx supabase db reset --local`
- The bucket exists after reset with the declared limits (query `storage.buckets`)
- Assertions pass: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_verification.sql`
- Types are in sync: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- Each new assertion has been observed to FAIL when its guard is temporarily removed
- An upload attempt to the bucket by a user without `candidate.write` is rejected at mint time
- A file larger than 5 MiB is rejected by the storage server, and a `.txt` file is rejected on MIME

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation from the human before proceeding.

---

## Phase 2: Candidate profile service and routes

### Overview

Expose the candidate as a first-class, recruitment-independent resource, and split the DTO that S-04 left fused.

### Changes Required:

#### 1. Profile service

**File**: `src/lib/services/candidate-profile.ts`

**Intent**: House the candidate-aggregate data access keyed by `candidates.id`, mirroring the house service
conventions — client first, Supabase errors thrown raw and unwrapped so `.code` reaches the route, absence returned
as `null` via `.maybeSingle()`, inline snake_case→camelCase mapping. A new module rather than an addition to
`candidates.ts`, because every function in that file is recruitment-scoped by construction and mixing the two
scopes in one module is what made the S-04 DTO ambiguous.

**Contract**: `getCandidateProfile(client, candidateId)` reading `candidates` directly and including the
recruitments the candidate appears in (id, title, current stage name) for context; and
`updateCandidateProfile(client, candidateId, command)` performing a plain RLS-covered UPDATE of `full_name` and
`phone` only. No RPC: both are single-table operations with no cross-row invariant to enforce, so an RPC would add a
bypassable surface for nothing — the same reasoning S-04 applied to its note upsert.

#### 2. New types

**File**: `src/types.ts`

**Intent**: Add the profile-scoped commands and DTOs, following the hand-written `…Command` / `…Dto` convention.

**Contract**: `CandidateProfileDto { id; fullName; email; phone; createdAt; recruitments: CandidateRecruitmentSummaryDto[]; cv: CandidateCvDto | null }`,
`CandidateRecruitmentSummaryDto { recruitmentId; candidateRecruitmentId; title; stageName; addedAt }`, and
`UpdateCandidateProfileCommand { fullName; phone? }`. `CandidateCvDto` is added in Phase 3; Phase 2 leaves `cv`
always `null`. The existing `CandidateDetailDto` is unchanged — the per-recruitment page keeps working untouched.

#### 3. Profile routes

**Files**: `src/pages/api/candidates/[candidateId]/index.ts`

**Intent**: Serve and update the profile over HTTP, following the house route skeleton exactly.

**Contract**: `GET` returns `CandidateProfileDto` (404 when the service returns `null`); `PATCH` validates
`{ fullName, phone? }` and returns the updated DTO. `export const prerender = false`, module-local zod schemas,
`z.coerce.number().int().positive()` for the id param, JSON-parse guard, field-error flattening for 422s, per-route
`createClient` with the `supabase_unconfigured` guard, no per-route auth check. Errors map through a shared handler
(Phase 3 extends it); at this phase `42501`→403, `22023`→422, default→`console.error` then 500.

#### 4. Middleware and page shell

**Files**: `src/middleware.ts`, `src/pages/candidates/[candidateId].astro`

**Intent**: Protect the new top-level route family and server-render the page shell.

**Contract**: Add `"/candidates"` to `PROTECTED_ROUTES`. The `.astro` file passes the scalar `candidateId` to a
`client:load` island that fetches its own JSON, uses the same `bg-cosmic` wrapper as the other pages, and carries a
back link. The island itself lands in Phase 4; this phase renders a placeholder so the route is verifiable.

#### 5. Card and detail links

**Files**: `src/components/recruitments/KanbanBoard.tsx`, `src/components/recruitments/CandidateDetail.tsx`

**Intent**: Make the profile reachable without disturbing the existing per-recruitment surfaces.

**Contract**: The S-04 detail page gains a link to `/candidates/{candidateId}` (the value is already on
`CandidateDetailDto.candidateId`). Board card links are left pointing at the per-recruitment page, which remains the
recruiter's working view. No DTO or query changes.

#### 6. Tests

**Files**: `src/lib/services/candidate-profile.test.ts`,
`src/pages/api/candidates/candidates-profile.integration.test.ts`

**Intent**: Cover DTO mapping and error propagation without infrastructure, and the real HTTP contract against a
running stack.

**Contract**: Unit tests extend the hand-rolled `FakeQueryBuilder` pattern — no mocking library. Integration tests
use `src/lib/test-support/integration-client.ts`, create their own candidate per case rather than mutating seeds,
and assert status plus `body.error.code` across the HR-allowed / hiring-manager-403-on-PATCH /
nonexistent-candidate-404 matrix, plus that an attempted `email` change is ignored or rejected rather than applied.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Integration tests pass: `npm run test:integration`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification:

- `/candidates/:id` requires a session and redirects to sign-in when signed out
- Editing name and phone persists after reload; email is not editable
- A hiring manager can read the profile and gets a clean denial on save

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation from the human before proceeding.

---

## Phase 3: CV upload, download, and purge

### Overview

The whole CV lifecycle: mint, confirm, stream, purge. All the novel machinery of this slice lives here.

### Changes Required:

#### 1. Upload-confirmation RPC

**File**: `supabase/migrations/20260902110000_candidate_cv_rpcs.sql`

**Intent**: Promoting a pending row to active must also demote the previous active row, and those two writes have to
be atomic or the partial unique index will either reject the promotion or leave two CVs claiming to be current. The
purge gate is also here, because an Administrator holds neither `candidate.read` nor `candidate.write` and so cannot
select or update `candidate_cvs` directly. Follows the house RPC contract: `security definer set search_path = ''`,
schema-qualified identifiers, read-then-write permission check as the first statements, `returning` the row, and a
trailing `revoke execute … from public, anon; grant execute … to authenticated;`. The header comment documents the
new errcode alongside the existing codebook.

**Contract**: Three functions in `public`.

```
confirm_candidate_cv(target_cv_id bigint) returns public.candidate_cvs
```

Resolves the row, `P0002` if absent or invisible, `42501` without `candidate.write`, `22023` if the row is not
`pending`. Marks any existing `active` row for that candidate as `superseded`, then sets this row `active`. The
superseded row keeps its `storage_path` so the purge can still find its bytes.

```
list_purgeable_candidate_cvs() returns setof public.candidate_cvs
```

Requires `candidate.write` **or** `group.manage` (`42501` otherwise). Returns rows where `object_deleted_at is null`
and (`status = 'superseded'` or `expires_at <= now()`).

```
mark_candidate_cv_object_deleted(target_cv_id bigint) returns public.candidate_cvs
```

Same disjunctive gate. Sets `object_deleted_at = now()`. Separated from the listing because the Storage API call
happens between the two and cannot sit inside a transaction.

**Errcode**: `PA005` = `cv_expired`, raised when a download is attempted past `expires_at`. Add it to the codebook
comment.

#### 2. CV service

**File**: `src/lib/services/candidate-cv.ts`

**Intent**: Own the storage interaction and the two-phase write. Kept separate from the profile service because this
is the only module in the codebase that talks to Storage, and isolating it keeps the storage dependency out of the
profile read path.

**Contract**: `createCvUploadIntent(client, candidateId, command)` reaps stale `pending` rows for that candidate,
inserts a new pending row with a collision-proof `storage_path`, mints a signed upload URL, and returns
`{ cvId, uploadUrl, token, path }`; `confirmCvUpload(client, cvId)` calls the RPC; `getCvForDownload(client, candidateId)`
resolves the active row, throws a `PA005`-coded error when `expires_at <= now()` or `object_deleted_at` is set, and
otherwise returns the object stream plus filename and MIME; `purgeCvObjects(client)` calls
`list_purgeable_candidate_cvs`, removes each object through the Storage API, then calls
`mark_candidate_cv_object_deleted` per row — **object first, mark second** — treating a missing object as success and
leaving genuine failures for the next run. It returns a per-file result summary so the caller can report what
happened.

The storage path is derived server-side as `{candidateId}/{cvId}-{random}.{ext}` and never taken from client input,
since the path is fixed into the signature at mint time and is the only thing constraining where the bytes land.

#### 3. CV routes

**Files**: `src/pages/api/candidates/[candidateId]/cv/upload-intent.ts`,
`src/pages/api/candidates/[candidateId]/cv/confirm.ts`,
`src/pages/api/candidates/[candidateId]/cv/index.ts`,
`src/pages/api/candidates/cv-purge.ts`

**Intent**: Expose the lifecycle, and extend the shared error mapping so no new code can fall through to a 500.

**Contract**: `POST upload-intent` validates `{ filename, mimeType, sizeBytes }`, rejects a MIME outside the
allowlist or a size above 5 MiB with 422 before minting (a friendly pre-check; the bucket remains the real
boundary), and returns the intent. `POST confirm` takes `{ cvId }` and returns `CandidateCvDto`. `GET cv` streams
the file with `Content-Type` and a `Content-Disposition` filename. `POST cv-purge` runs the purge and returns a
summary of files removed and failures.

A shared `handleCandidateCvError`, modelled on `handleCandidateRpcError`
(`src/lib/api/candidate-errors.ts:9-32`), maps `P0002`→404, `42501`→403, `22023`→422 `invalid_request`,
`PA005`→410 `cv_expired`, `23505`→422 `invalid_request` (a defensive branch for the partial unique index), and
default→`console.error` then 500. Every code these RPCs can raise gets an explicit branch — unmapped codes have
fallen through to 500s three times in prior slices.

`410 Gone` is chosen over 404 for an expired CV so the UI can distinguish "expired" from "never existed" and render
the tombstone; the profile DTO carries the same distinction so a download is rarely attempted.

#### 4. Profile DTO gains the CV

**Files**: `src/types.ts`, `src/lib/services/candidate-profile.ts`

**Intent**: Let the profile render the CV panel from one request.

**Contract**: `CandidateCvDto { id; originalFilename; mimeType; sizeBytes; uploadedAt; expiresAt; state }` where
`state` is `'available' | 'expired'`, derived from `expires_at` and `object_deleted_at` — never from a client value.
`getCandidateProfile` populates `cv` from the latest non-pending row for the candidate.

#### 5. Tests

**Files**: `src/lib/services/candidate-cv.test.ts`,
`src/pages/api/candidates/candidates-cv.integration.test.ts`

**Intent**: Cover the two-phase write, the expiry gate, and the purge ordering without waiting a year.

**Contract**: Unit tests assert that `purgeCvObjects` calls the Storage delete **before** the mark, that a
`mark` is not attempted when the delete fails, and that a missing object counts as success. Integration tests upload
a real file through a minted URL against the local stack, confirm it, download it and compare bytes, then insert a
backdated row to prove the download returns 410 and that the purge removes its object and sets `object_deleted_at`.
They also assert the HM-403-on-upload and the Administrator-allowed-purge cases.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `npx supabase db reset --local`
- Assertions pass: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_verification.sql`
- Types are in sync: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Unit tests pass: `npm run test`
- Integration tests pass: `npm run test:integration`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification:

- The local signed-upload URL TTL has been measured and recorded in the change notes
- A file uploaded through a minted URL is downloadable byte-for-byte
- A backdated CV returns 410 on download and is purged by the endpoint, after which the row shows `object_deleted_at`
- Running the purge twice in a row is harmless the second time

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation from the human before proceeding.

---

## Phase 4: Profile page UI

### Overview

The island that renders identity, recruitments and the CV panel, and the upload interaction.

### Changes Required:

#### 1. File input primitive

**File**: `src/components/ui/file-input.tsx`

**Intent**: Provide the file-picker this slice needs; none exists. Mirror `FormField`'s label/id pairing and inline
error markup so `getByLabelText` works in both RTL and Playwright.

**Contract**: shadcn "new-york" styling via `cn()`, `id`/`htmlFor` pairing, an `accept` attribute, optional error
text, and a callback receiving the selected `File`.

#### 2. Upload hook

**File**: `src/components/hooks/useCvUpload.ts`

**Intent**: The existing `useMutation` hard-codes a JSON body and cannot carry bytes, so the three-step upload needs
its own hook. Extracting it keeps the component declarative and the sequencing testable.

**Contract**: Orchestrates pre-validate → POST upload-intent → PUT the file to the signed URL → POST confirm, and
exposes `{ upload(file), status, error, fieldErrors }` matching `useMutation`'s shape so the component treats it
like any other mutation. The signed URL is requested immediately before the PUT, never earlier.

#### 3. Profile island

**File**: `src/components/candidates/CandidateProfile.tsx`

**Intent**: Render the profile and host the CV panel.

**Contract**: `useApiResource<CandidateProfileDto>` with the standard loading / `not-found` / error branches
(skeleton, `NotFoundState`, `ServerError`) matching `KanbanBoard.tsx:110-120`. Identity fields edit in place and
`PATCH`, then refetch — mutations never own data. The recruitments list links back to each per-recruitment page. The
CV panel renders one of three states: no CV (upload control), `available` (filename, size, upload date, download
button, and a replace control), or `expired` (tombstone naming the original upload date, plus an upload control).

#### 4. Component tests

**Files**: `src/components/candidates/CandidateProfile.test.tsx`

**Intent**: Cover the three CV states and the upload sequence.

**Contract**: The local `mockFetch(config)` pattern — throws on any unregistered URL, installed via `vi.stubGlobal`,
torn down in `afterEach`. Cases: the three CV panel states render correctly; a successful upload issues
intent → PUT → confirm in that order and refetches; an oversized or wrong-type file is rejected client-side without
any network call; a 403 on upload renders cleanly; a 410 download renders the tombstone.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification:

- Uploading a real PDF shows the CV panel without a page reload, and downloading returns the same file
- Replacing a CV leaves exactly one downloadable CV
- An oversized file and a `.txt` file are both refused with a clear message
- A hiring manager sees the panel and gets a clean denial on upload, not a crash

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation from the human before proceeding.

---

## Phase 5: End-to-end coverage

### Overview

Prove the whole path through the real application, and keep the CI readiness probe meaningful.

### Changes Required:

#### 1. E2E spec

**File**: `tests/e2e/candidate-profile.spec.ts`

**Intent**: Cover the slice's user-visible contract end to end.

**Contract**: Uses `signInAs(page, "hr")` and seeds its own recruitment and candidate via `page.request.post` in
`beforeAll` — **never** touching the seeded "Backend Engineer" recruitment, whose board other specs assert on, and
`PATCH`ing its own recruitment off `draft` immediately because `recruitments.spec.ts` asserts no other drafts exist.
Every island form fill is wrapped in the `toPass()` hydration-race guard. Cases: open the profile from the
per-recruitment page; edit name and phone and see them persist after reload; upload a fixture PDF and see the CV
panel; download it and assert the response status and content type; replace it and confirm one CV remains. A
hiring-manager case asserts a clean denial on upload followed by a reload proving nothing changed.

A small fixture PDF is committed under `tests/e2e/fixtures/`.

#### 2. CI readiness probe

**File**: `.github/workflows/ci.yml`

**Intent**: Astro dev reloads lazily per route module graph, so probing one route does not prove another is ready —
the exact failure fixed in commit `1f3a94f` and extended again at S-04.

**Contract**: Extend the existing readiness probe to also poll one of the new `/api/candidates/...` routes before
the integration and e2e jobs run. The authenticated warm-up added in `d7ff36b` stays as is.

### Success Criteria:

#### Automated Verification:

- Full suite passes from a clean database: `npx supabase db reset --local`, then `npm run test`, `npm run test:integration`, `npm run test:e2e`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification:

- The e2e suite passes twice in a row without a database reset between runs, confirming the new spec does not
  pollute fixtures other specs assert on
- CI passes on a pushed branch

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual
confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- Profile DTO mapping and raw-error propagation, using the `FakeQueryBuilder` pattern
- Purge ordering: object delete precedes the mark; a failed delete skips the mark; a missing object counts as success
- `useCvUpload` step ordering and client-side pre-validation
- The three CV panel states, and the 403 / 410 renderings

### Integration Tests:

- `GET /api/candidates/[id]` — 200, 404 for a nonexistent candidate
- `PATCH /api/candidates/[id]` — 200, HM 403, email change not applied, invalid input 422
- `POST …/cv/upload-intent` — 200, oversized 422, wrong MIME 422, HM 403
- `POST …/cv/confirm` — 200, non-pending row 422, and exactly one active row after replacing a CV
- `GET …/cv` — 200 with matching bytes, 410 for a backdated row, 404 when no CV
- `POST /api/candidates/cv-purge` — HR 200, Administrator 200, HM 403, idempotent on a second run

### RLS Tests:

- The Phase 1 assertion blocks, each written to fail loudly when its guard is removed — including the
  Administrator-can-delete-storage-object and HM-cannot-insert cases, and the generated-column proof

### Manual Testing Steps:

1. Reset the database, sign in as `hr.test@example.com`, open a recruitment board.
2. Open a candidate's per-recruitment page, then follow the link to the candidate profile.
3. Edit the name and phone; reload and confirm both persisted. Confirm email is not editable.
4. Upload a PDF under 5 MB; confirm the panel shows filename, size and date, and that downloading returns the same file.
5. Upload a 6 MB file and a `.txt` file; confirm both are refused with a clear message.
6. Replace the CV with a different file; confirm exactly one CV is downloadable.
7. Backdate a CV row's `uploaded_at` by 13 months in the SQL editor; reload the profile and confirm the tombstone
   appears and download returns 410.
8. POST to the purge endpoint as HR; confirm the object is gone from the bucket and `object_deleted_at` is set. Run
   it again and confirm it is harmless.
9. Sign in as `admin.test@example.com`; confirm the purge endpoint is allowed.
10. Sign in as `hiring-manager.test@example.com`; confirm the profile is readable, a live CV is downloadable, and
    upload and save are denied cleanly.

## Performance Considerations

The download route buffers the object before responding, which is acceptable and deliberate at a 5 MiB cap; it is
the reason the cap is enforced at the bucket rather than left to the global 50 MiB limit. The profile issues one
query for the candidate, one for its recruitments and one for the CV row — no per-recruitment fan-out. The purge
endpoint is unbounded in principle; at this project's volume that is immaterial, but the service returns a per-file
summary so a future scheduler can batch if it ever matters. `CandidateCardDto` is untouched, so the board payload
does not grow.

## Migration Notes

Three new migrations plus one `config.toml` change, all additive; no existing data is rewritten. Merged migrations
are never edited. `src/db/database.types.ts` must be regenerated and committed in the same commit as the migrations,
since CI fails on a dirty diff. The new bucket is created by `supabase db reset` from `config.toml`, so no manual
bucket provisioning is needed locally or in CI; **the bucket must be created once by hand in the hosted project**,
or by applying the same config, before the feature works in production. Existing candidates simply have no CV row,
which the profile renders as the no-CV state.

## References

- Research: `context/changes/candidate-profile-and-cv-upload/research.md`
- Upload architecture decision: `context/foundation/infrastructure.md:65,77,84,102`
- RPC and errcode template: `supabase/migrations/20260901210500_candidate_write_rpcs.sql`
- Error-mapping template: `src/lib/api/candidate-errors.ts:9-32`
- Route skeleton: `src/pages/api/recruitments/[id]/candidates/index.ts`
- Service conventions: `src/lib/services/candidates.ts`
- Island and resource-hook pattern: `src/components/recruitments/KanbanBoard.tsx:110-120`
- Prior slice this one restructures: `context/changes/recruiter-manages-candidate-status/plan.md:75-76,479`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Storage bucket and CV schema

#### Automated

- [x] 1.1 Migrations apply cleanly — b7e44a1
- [x] 1.2 Bucket exists after reset with declared limits — b7e44a1
- [x] 1.3 RLS/RPC assertions pass — b7e44a1
- [x] 1.4 Types are in sync — b7e44a1
- [x] 1.5 Linting passes — b7e44a1
- [x] 1.6 Type checking passes — b7e44a1

#### Manual

- [x] 1.7 Each new assertion observed to fail when its guard is removed — b7e44a1
- [x] 1.8 Upload without candidate.write rejected at mint time — b7e44a1
- [x] 1.9 Oversized file and wrong MIME rejected by the storage server — b7e44a1

### Phase 2: Candidate profile service and routes

#### Automated

- [x] 2.1 Unit tests pass — 656b484
- [x] 2.2 Integration tests pass — 656b484
- [x] 2.3 Linting passes — 656b484
- [x] 2.4 Type checking passes — 656b484
- [x] 2.5 Build succeeds — 656b484

#### Manual

- [x] 2.6 /candidates/:id requires a session — d5eb3df
- [x] 2.7 Name and phone persist; email not editable — d5eb3df
- [x] 2.8 Hiring manager reads profile, gets clean denial on save — d5eb3df

### Phase 3: CV upload, download, and purge

#### Automated

- [x] 3.1 Migrations apply cleanly — 150c24e
- [x] 3.2 RLS/RPC assertions pass — 150c24e
- [x] 3.3 Types are in sync — 150c24e
- [x] 3.4 Unit tests pass — 150c24e
- [x] 3.5 Integration tests pass — 150c24e
- [x] 3.6 Linting passes — 150c24e
- [x] 3.7 Type checking passes — 150c24e
- [x] 3.8 Build succeeds — 150c24e

#### Manual

- [x] 3.9 Local signed-upload URL TTL measured and recorded — 150c24e
- [x] 3.10 Uploaded file downloadable byte-for-byte — 150c24e
- [x] 3.11 Backdated CV returns 410 and is purged, setting object_deleted_at — 150c24e
- [x] 3.12 Second purge run is harmless — 150c24e

### Phase 4: Profile page UI

#### Automated

- [x] 4.1 Unit tests pass — b27c5cb
- [x] 4.2 Linting passes — b27c5cb
- [x] 4.3 Type checking passes — b27c5cb
- [x] 4.4 Build succeeds — b27c5cb

#### Manual

- [x] 4.5 Upload shows the panel without reload; download matches — b27c5cb
- [x] 4.6 Replacing a CV leaves exactly one downloadable CV — b27c5cb
- [x] 4.7 Oversized and wrong-type files refused with a clear message — b27c5cb
- [x] 4.8 Hiring manager gets a clean denial on upload — b27c5cb

### Phase 5: End-to-end coverage

#### Automated

- [x] 5.1 Full suite passes from a clean database — d5eb3df
- [x] 5.2 Linting passes — d5eb3df
- [x] 5.3 Type checking passes — d5eb3df
- [x] 5.4 Build succeeds — d5eb3df

#### Manual

- [x] 5.5 E2E passes twice without a DB reset between runs — d5eb3df
- [x] 5.6 CI passes on a pushed branch — d5eb3df
