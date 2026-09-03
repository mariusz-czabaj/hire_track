---
change_id: candidate-profile-and-cv-upload
title: Candidate profile page and CV upload with 12-month retention
status: impl_reviewed
created: 2026-09-01
updated: 2026-09-03
archived_at: null
---

## Notes

from @context/foundation/roadmap.md

### 2026-09-01 — Storage and retention design decided during planning

**Supabase Storage retained**; Cloudflare R2 and the S3/GCS/Azure/B2 family were evaluated specifically for native
object TTL and declined. Decisive finding: on every store surveyed, lifecycle deletion is asynchronous with no
contractual upper bound, and the object stays _readable_ past the deadline (GCS states this outright). So store-side
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

### 2026-09-03 — Phase 2 implementation notes

**A hiring manager's denied PATCH surfaces as 404, not 403.** `updateCandidateProfile` is a plain RLS-covered
`UPDATE` (no RPC, per plan.md's stated reasoning: a single-table write with no cross-row invariant to enforce).
Postgres RLS on `UPDATE` filters the row from the `USING` clause rather than raising `42501` the way an RPC's own
read-then-write permission check does — a write-denied caller and a nonexistent candidate are indistinguishable at
the SQL layer, so both surface as `404 not_found`. This mirrors the existing `updateRecruitmentStatus` /
`PATCH /api/recruitments/[id]` pattern (`recruitments/index.integration.test.ts`'s "denied with 404 (scoped-write,
not authorized)" case), not a new gap. Still a clean denial — no crash, no silently-applied write — so it satisfies
the plan's Phase 2 manual item as written; the integration test asserts 404 rather than 403 accordingly.

### 2026-09-03 — Phase 3 implementation notes

**Local signed-upload-URL TTL was already measured in Phase 1** (7200s / 2 hours) and recorded above; Phase 3's own
manual item (3.9) is satisfied by that earlier measurement and was not re-run.

**`candidate_cvs.storage_path` is written twice on insert.** The column is `not null unique`, and the path is
derived from the row's own `id` (`{candidateId}/{cvId}-{random}.{ext}`) per plan.md's Critical Implementation
Details — so `createCvUploadIntent` inserts a placeholder path first, reads back the generated `id`, then updates
`storage_path` to the real derived value before minting the signed URL. This is two round-trips rather than one, a
consequence of the id-in-path design; no cross-row invariant depends on the intermediate placeholder ever being
visible to another caller.

**Stale `pending` rows are reaped by `candidate_id`, not by age.** `createCvUploadIntent` deletes every existing
`pending` row for the candidate before inserting a new one, rather than only rows past some staleness threshold —
simpler than a TTL check, and safe because a `pending` row that never gets confirmed carries no `active`-CV
consequence (the partial unique index only constrains `status = 'active'`).

**Integration coverage exercises the real signed-URL HTTP contract**, not the supabase-js storage client: the test
PUTs raw bytes directly to the minted `uploadUrl` with `fetch`, mirroring what a browser does. All 9 CV-lifecycle
cases and the existing 8 profile cases pass together against a live local stack (`npm run dev` + `supabase start`).

**`getCandidateProfile` now issues one additional query** (`getLatestCvForProfile`) to populate `cv`, replacing the
Phase 2 placeholder that always returned `null`. `candidate-profile.test.ts`'s `FakeQueryBuilder` gained `neq`,
`order`, and `limit` pass-through methods to support this query's chain.
