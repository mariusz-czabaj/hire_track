<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Candidate Profile and CV Upload Implementation Plan

- **Plan**: context/changes/candidate-profile-and-cv-upload/plan.md
- **Scope**: Full plan (Phases 1-5)
- **Date**: 2026-09-03
- **Verdict**: NEEDS ATTENTION at review time; all 5 findings fixed during triage (see Decisions below) — resolved
- **Findings**: 0 critical, 3 warnings, 2 observations — all 5 FIXED

## Verdicts

| Dimension           | Verdict         |
| -------------------- | ---------------- |
| Plan Adherence       | WARNING ⚠️        |
| Scope Discipline     | PASS ✅           |
| Safety & Quality     | WARNING ⚠️        |
| Architecture         | PASS ✅           |
| Pattern Consistency  | WARNING ⚠️        |
| Success Criteria     | PASS ✅           |

## Findings

### F1 — `confirmCvUpload` never scopes the CV to the URL's candidateId

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/candidates/[candidateId]/cv/confirm.ts:16-45, src/lib/services/candidate-cv.ts:119-127, supabase/migrations/20260902110000_candidate_cv_rpcs.sql:18-57
- **Detail**: `confirm.ts` parses and validates `candidateId` from the URL (`parsedId`, line 17) but never uses it — `confirmCvUpload(supabase, parsed.data.cvId)` is called with only the body's `cvId`. The RPC `confirm_candidate_cv` resolves `candidate_id` purely from `target_cv_id` and checks only the caller's global `candidate.write` operation, never comparing it to the URL segment. Every sibling function in this same service file — `createCvUploadIntent`, `getCvForDownload`, `getLatestCvForProfile` — filters with `.eq("candidate_id", candidateId)`; `confirmCvUpload` is the one exception. Because this app's RLS model on `candidate_cvs` is already org-wide (any `candidate.write` holder can write any candidate's row, per plan.md's Current State Analysis), this is not a privilege escalation — the CV is always confirmed against its true owning candidate, never the wrong one. But the URL's `candidateId` is silently decorative for this one endpoint: a client that (by bug or a guessed/enumerated `cvId`) posts confirm against the wrong candidate's URL gets a 200 with no indication anything was off, rather than a clean 404 the way the download and upload-intent routes would give.
- **Fix**: Resolve the CV's actual `candidate_id` in `confirmCvUpload` (or in the RPC) and throw the existing `P0002` (not-found) error when it doesn't match the `candidateId` argument passed in from the route — mirroring the `.eq("candidate_id", candidateId)` pattern already used by the other three functions in this file.
- **Decision**: FIXED — added a pre-RPC ownership check (`.select("candidate_id").eq("id", cvId).maybeSingle()`) in `confirmCvUpload` that throws `P0002` before calling `confirm_candidate_cv`, not after. An initial post-RPC check was tried first and caught in review by an integration test: the RPC's promotion is already committed by the time it returns, so a post-hoc check let a mismatched call still silently confirm-and-demote the real active row before the error was thrown. Added `candidates-cv.integration.test.ts`'s "confirming a cvId under a different candidate's URL is refused with 404" case, which also asserts the CV still confirms cleanly under its true owner's URL afterward. All 75 integration tests (74 existing + 1 new) pass.

### F2 — CV panel has no "replace" control for an available CV, contradicting the plan's Phase 4 contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/candidates/CandidateProfile.tsx:62-84
- **Detail**: plan.md's Phase 4 contract (line 563-564) specifies the `available` CV panel state shows "filename, size, upload date, download button, **and a replace control**." The implemented `available` branch (lines 68-84) renders only the filename/size/date text and a Download link. `showUploadControl` (line 62) is `cv === null || cv.state === "expired"` — the `FileInput` is explicitly excluded once a CV is `available`. There is currently no way for an HR user to replace a live CV through the UI at all. This is confirmed by `tests/e2e/candidate-profile.spec.ts`'s own inline comment (lines 111-113), which had to bypass the UI and drive the raw `upload-intent` → `PUT` → `confirm` HTTP sequence directly via `page.request` to exercise the "replace" manual-testing step (plan.md step 6, Progress row 4.6) that the UI itself cannot perform. The backend fully supports replace (confirmed correct by the drift and safety reviews); this is a pure frontend gap.
- **Fix A ⭐ Recommended**: Add an explicit "Replace CV" button to the `available` branch that toggles the `FileInput` into view (mirroring the "Edit candidate details" pencil-button pattern already used above in the same component for name/phone).
  - Strength: Matches the plan's literal contract and the file's own existing edit-toggle idiom; an explicit action avoids an accidental overwrite of a live CV.
  - Tradeoff: A few more lines of local component state and one more `CandidateProfile.test.tsx` case for the toggle.
  - Confidence: HIGH — the edit-toggle pattern already exists in the same file for name/phone, so this isn't a new interaction idiom for the codebase.
  - Blind spot: None significant.
- **Fix B**: Always render the `FileInput` under the CV panel regardless of state, so selecting a new file while one is active replaces it directly (no separate toggle).
  - Strength: Smallest possible diff — just widen `showUploadControl` to always `true`.
  - Tradeoff: A misclick or wrong-file selection silently overwrites a live CV with no confirmation step, which is a worse failure mode for a document HR staff may rely on.
  - Confidence: MEDIUM — simpler, but the accidental-overwrite risk is real for a one-CV-per-candidate model with no versioning UI (explicitly ruled out in "What We're Not Doing").
  - Blind spot: Haven't checked whether product intent wants replace to be a deliberate, confirmed action.
- **Decision**: FIXED via Fix A — added an explicit "Replace" button (with a `Repeat` icon, matching the existing pencil-icon edit-toggle idiom) to the `available` CV panel state in `CandidateProfile.tsx`. Clicking it reveals the `FileInput` (plus a Cancel button to back out); a successful upload resets the toggle and refetches. Added a new `CandidateProfile.test.tsx` case covering the toggle-then-upload sequence, and rewrote `candidate-profile.spec.ts`'s replace test to drive the real "Replace" button instead of the raw `upload-intent`/PUT/confirm HTTP sequence. Full re-verification after this fix: unit 73/73, integration 75/75, e2e 12/12, lint/typecheck/build clean.

### F3 — Concurrent upload attempts race on the stale-`pending` reap

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/candidate-cv.ts:61-69
- **Detail**: `createCvUploadIntent` unconditionally deletes every existing `pending` row for the candidate (`.eq("candidate_id", candidateId).eq("status", "pending")`) before inserting a new one. Two near-simultaneous upload attempts for the same candidate (a double-click on the file input, or two open tabs) race: the second call's reap deletes the first call's still-in-flight pending row before its `confirm` runs, so the first upload's `confirm` fails with a generic `P0002` (not-found) rather than a message that explains it was superseded by a second attempt.
- **Fix**: Only reap `pending` rows older than a short threshold (e.g. a few minutes) rather than every pending row unconditionally, so a genuinely in-flight upload from the last few seconds survives a second concurrent attempt.
- **Decision**: FIXED — added a `STALE_PENDING_THRESHOLD_MS` (5 minutes) constant and an `.lt("created_at", staleCutoff)` clause to the reap query in `createCvUploadIntent`, so only pending rows older than the threshold are deleted. Re-verified: integration 75/75, build clean.

### F4 — `candidate_cvs` insert omits `created_by`

- **Severity**: OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/candidate-cv.ts:71-86
- **Detail**: The insert in `createCvUploadIntent` doesn't set `created_by`, unlike `upsertCandidateNote` in `candidates.ts`, which derives it from the caller's session. The column is nullable, so nothing breaks, but it silently drops the upload audit trail the column exists for (and the RLS test fixtures do populate it).
- **Fix**: Set `created_by` from `(await client.auth.getUser()).data.user?.id` on insert, matching `upsertCandidateNote`'s pattern.
- **Decision**: FIXED — added the same `client.auth.getUser()` + `created_by: user?.id ?? null` pattern to `createCvUploadIntent`'s insert.

### F5 — Raw storage/DB error messages returned verbatim from the purge endpoint

- **Severity**: OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/candidate-cv.ts:187,194 (surfaced via src/pages/api/candidates/cv-purge.ts)
- **Detail**: `purgeCvObjects`'s per-row failure summary includes the raw Supabase Storage/Postgres error message text in the JSON response. Low risk since only `candidate.write`/`group.manage` callers can reach this endpoint, but it's a minor internal-detail leak (schema/implementation specifics) into an API response.
- **Fix**: Log the raw error server-side and return a generic per-row reason string in the response instead.
- **Decision**: FIXED — both failure branches in `purgeCvObjects` now `console.error` the raw Storage/RPC error and push a generic reason string ("Failed to remove file" / "Failed to record deletion") into the per-row result instead. Updated `candidate-cv.test.ts`'s two assertions that had pinned the raw message text. Full re-verification after F1-F5: unit 73/73, integration 75/75, RLS assertions pass, types in sync, build clean.

## Notes

- All automated success criteria across all 5 phases were re-verified fresh against a clean database as part of this review: `npx supabase db reset --local`, the RLS/RPC assertion script, `npm run db:types` (clean diff), `npm run test` (72/72), `npm run test:integration` (74/74), `npm run test:e2e` (12/12, including twice-in-a-row without a reset), `npm run lint` (0 errors), `npm run typecheck` (0 errors), `npm run build` — all pass.
- Two deliberate, documented deviations from the plan's literal text were confirmed sound and are **not** findings: `expires_at` is a `BEFORE INSERT` trigger rather than a `generated always as` column (STABLE-vs-IMMUTABLE constraint forced this; change.md documents it), and the `storage.objects` SELECT policy was widened to `candidate.read OR candidate.write OR group.manage` rather than `candidate.read` alone (otherwise an Administrator's DELETE grant would be unreachable, since Postgres implicitly ANDs SELECT visibility into DELETE).
- The Hiring-Manager PATCH denial surfacing as 404 rather than 403 (also change.md-documented) was confirmed to be a faithful consequence of the plan's own "no RPC, plain RLS-covered UPDATE" design choice, not a new gap — RLS filters the row out of the `UPDATE`'s own `USING` clause rather than raising an explicit `42501`. This mirrors the existing `PATCH /api/recruitments/[id]` pattern elsewhere in the codebase.
- "What We're NOT Doing" boundaries were all respected: no service-role key, no scheduler/cron, email stays non-editable everywhere, no CV versioning/history UI, no candidate-deletion code.
