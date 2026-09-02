---
change_id: candidate-profile-and-cv-upload
title: Candidate profile page and CV upload with 12-month retention
status: implementing
created: 2026-09-01
updated: 2026-09-02
archived_at: null
---

## Notes

from @context/foundation/roadmap.md

### 2026-09-01 — Storage and retention design decided during planning

**Supabase Storage retained**; Cloudflare R2 and the S3/GCS/Azure/B2 family were evaluated specifically for native
object TTL and declined. Decisive finding: on every store surveyed, lifecycle deletion is asynchronous with no
contractual upper bound, and the object stays *readable* past the deadline (GCS states this outright). So store-side
TTL cannot deliver the access half of FR-013a — the app-side check is mandatory regardless of store, and switching
would additionally cost server-side size enforcement (R2 has none), reviewable config (R2 lifecycle and CORS are
out-of-band state), and CI coverage (presigned uploads cannot reach local R2).

**The requirement splits into two guarantees.** Access cutoff is derived at read time from a generated
`expires_at = uploaded_at + interval '12 months'`, so it is exact and automatic. Byte deletion is a separate,
manually triggered endpoint — **no scheduler in this slice, by explicit decision**. This is a knowing partial
delivery of FR-013a's "automatically": access is automatic, byte removal is not. The endpoint is shaped as the seam
a cron trigger can call later.

**No service-role key is introduced.** Because the purge is user-triggered, a logged-in HR or Administrator user is
the privileged identity throughout, and authorisation is enforced by RLS on `candidate_cvs` and on
`storage.objects` via the existing `private.has_operation` helpers. Purge is gated on
`candidate.write OR group.manage`, avoiding an operation-enum change.

Other decisions: profile lives at a new candidate-scoped `/candidates/:candidateId` (S-06 inherits it); one active
CV per candidate enforced by a partial unique index, with tombstone rows retained after byte deletion; name and
phone editable, email read-only (it is the dedup key); 5 MiB cap enforced at the bucket; two-phase upload with
pending rows reaped lazily; download streams through an authorising route rather than a signed URL. Decided by user
during `/10x-plan`.

### 2026-09-02 — Phase 1 implementation notes

**`expires_at` is not a `generated always as` column.** `timestamptz + interval` is STABLE, not IMMUTABLE (month
arithmetic depends on the session `TimeZone` for DST), so Postgres rejects it as a generation expression. Replaced
with a `BEFORE INSERT` trigger (`private.set_candidate_cv_expires_at`) that sets `expires_at` once from the
inserted `uploaded_at` — same single-source-of-truth guarantee, different mechanism.

**The `storage.objects` SELECT policy must admit every actor the DELETE policy admits.** Confirmed via `EXPLAIN`:
Postgres implicitly ANDs the SELECT policy into DELETE (and UPDATE) row visibility — a row invisible under SELECT
cannot be matched by DELETE's own `USING` clause either, and the same applies to the Storage API's object listing
that the purge will use. The plan's original SELECT policy (`candidate.read` only) would have made an
Administrator's DELETE grant unreachable in practice. Fixed by widening SELECT to
`candidate.read OR candidate.write OR group.manage`.

**Local signed-upload-URL TTL measured empirically: exactly 7200 seconds (2 hours)**, matching the widely-reported
hosted behaviour rather than the storage server's 60-second default. Verified via `iat`/`exp` on a minted token
against the local stack. Satisfies plan.md's Phase 3 manual item early; Phase 3 need not re-measure.
