# Candidate Profile and CV Upload — Plan Brief

> Full plan: `context/changes/candidate-profile-and-cv-upload/plan.md`
> Research: `context/changes/candidate-profile-and-cv-upload/research.md`

## What & Why

Roadmap slice S-05. Recruiters currently have no place to keep a candidate's CV or edit their details — the S-04
detail page shows identity read-only and notes only. This slice adds a candidate-scoped profile with editable
identity and a private CV file (PDF/DOCX), and makes the CV stop being readable exactly 12 months after upload, as
the PRD's retention rule requires (FR-007, FR-011, FR-012, FR-013a).

## Starting Point

The database is already shared-profile ready and nothing else exists. `candidates` RLS is org-wide
(`candidate.read` / `candidate.write`, no recruitment predicate), the `lower(email)` dedup already reuses one
profile across recruitments, and the `candidates` UPDATE policy and grant exist but are **completely unused** — so
editable fields need no migration. Against that: no storage bucket, no RLS on `storage.objects`, no CV column, no
route anywhere addressing a candidate by `candidates.id`, no upload code, and no scheduler, service-role key, or
DELETE policy anywhere in the project.

## Desired End State

A recruiter opens a candidate from the board and reaches `/candidates/:id`, showing identity (name and phone
editable in place, email read-only), the recruitments they appear in, and a CV panel. Uploading sends the file
straight to Supabase Storage without its bytes touching the Worker; downloading streams it back through a route
that re-checks authorisation every time. Twelve months on, the CV stops downloading and the panel shows a tombstone
with the original upload date. An HR user or Administrator can trigger an endpoint that physically deletes expired
and superseded files.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Upload path | Browser-direct via signed URL | Proxying bytes through the Worker silently drops files above ~5MB; pre-decided at platform selection. | Research |
| Object store | Keep Supabase Storage | Store-side TTL cannot deliver the access guarantee anywhere, so switching buys little and costs size enforcement, reviewable config and CI coverage. | Plan |
| Access cutoff | Derived at read time from a generated `expires_at` | Makes the 12-month cutoff exact and automatic, independent of whether any job ever runs. | Plan |
| Byte deletion | Manually triggered endpoint, no scheduler | Explicit scope decision; removes the untestable-scheduler problem and the need for any service-role key. | Plan |
| Privileged identity | None — the logged-in user | A user-triggered purge means RLS and `private.has_operation` remain the only gate throughout. | Plan |
| Purge authorisation | `candidate.write` OR `group.manage` | Lets both HR and Administrator run it using operations that already exist, avoiding an enum change. | Plan |
| Profile route | New candidate-scoped `/candidates/:id` | Matches FR-007's shared semantics and what the DB already permits; S-06 inherits the resource instead of reworking it. | Plan |
| CV cardinality | One active CV per candidate, tombstone retained | Gives the two-phase upload a pending state, a per-file clock, and something to explain the absence after deletion. | Plan |
| Editable fields | Name and phone; email read-only | Email is the `lower(email)` dedup key that the shared profile depends on. | Plan |
| Max file size | 5 MiB, enforced at the bucket | Bucket config is the only server-side enforcement available on a direct upload. | Plan |
| Download | Stream through an API route | Re-authorises every request and creates no shareable bearer URL, unlike a signed URL. | Plan |
| Purge ordering | Delete object, then mark the row | Reversing it loses the storage path while the bytes survive, orphaning the file permanently. | Plan |

## Scope

**In scope:** private `candidate-cvs` bucket with per-bucket MIME and size limits; `candidate_cvs` table with
generated `expires_at`; RLS on `candidate_cvs` and on `storage.objects`; candidate-scoped profile page and API
(GET/PATCH); CV upload-intent / confirm / download / purge endpoints; profile UI with the three CV states;
unit, integration, RLS and e2e coverage.

**Out of scope:** any scheduler (so FR-013a's byte deletion is manual — see Risks); switching object store;
editable email; CV versioning or history UI; candidate deletion; cross-recruitment search or a candidate list
(S-06); restructuring the S-04 notes UI; CSRF work; upload progress or resumable uploads; virus and content
scanning; board pagination.

## Architecture / Approach

Bottom-up. The bucket and the CV table land first, together with RLS on `storage.objects` — that last part is what
makes the mint endpoint a genuine gate rather than a decorative one, since storage RLS is evaluated **when the
signed URL is minted and never again**. Upload is three steps: the route mints a signed URL and records a `pending`
row, the browser PUTs the bytes directly to Storage, then a confirm RPC atomically promotes the row to `active` and
demotes the previous one. Reads derive `state` from `expires_at` and `object_deleted_at`, so an expired CV is
refused with 410 and rendered as a tombstone. The purge lists purgeable rows, deletes each object through the
Storage API, and only then marks the row — making it idempotent and self-healing.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Bucket and CV schema | Private bucket, `candidate_cvs` with generated expiry, RLS on both tables, SQL assertions | Getting `storage.objects` RLS wrong makes the mint endpoint decorative |
| 2. Profile service and routes | `/api/candidates/:id` GET+PATCH, DTO split, `/candidates` protected | Forgetting `PROTECTED_ROUTES` leaves the page unauthenticated |
| 3. CV upload, download, purge | Mint/confirm/stream/purge, `PA005`, full error mapping | Signed-URL TTL is not configurable and differs local vs hosted |
| 4. Profile page UI | Identity editing plus the three-state CV panel | `useMutation` cannot carry bytes, so the upload needs its own hook |
| 5. End-to-end coverage | Playwright spec and CI readiness probe | New specs polluting fixtures other specs assert on |

**Prerequisites:** S-04 shipped (it is); local Docker + `npx supabase start`; a fixture PDF for e2e. The hosted
project needs its bucket created once before the feature works in production.
**Estimated effort:** ~5 sessions, one per phase, with phase 3 the largest.

## Open Risks & Assumptions

- **FR-013a is only partly delivered.** The access cutoff is automatic and exact; physical byte deletion requires
  someone to call the endpoint. This is a knowing deviation from a must-have FR, accepted during planning, with the
  endpoint shaped as the seam a scheduler can call later. Until then, bytes of expired CVs persist until purged.
- The local signed-upload URL TTL is unverified — the storage server's default is 60s while hosted is reported at
  ~2h, and it cannot be configured. Phase 3 measures it; a very short local TTL would make the mint-then-upload
  sequence tight.
- MIME type is client-declared and never sniffed, so the bucket allowlist is a correctness guard, not a security
  control. A determined authenticated user can store a mislabelled file within the 5 MiB cap.
- The download route buffers rather than streams incrementally, which is deliberate at 5 MiB but would need
  revisiting if the cap ever rose.
- No liveness signal exists for the purge, because there is nothing scheduled to be live; if a scheduler is added
  later, a "last successful run" assertion should come with it.

## Success Criteria (Summary)

- A recruiter can upload a PDF or DOCX CV to a candidate profile and download the identical file back, without a
  page reload.
- A CV older than 12 months is not downloadable by anyone and shows as removed on the profile, whether or not the
  purge has run.
- Name and phone edits persist; email cannot be changed; a hiring manager can read the profile and download a live
  CV but is denied cleanly on any write.
