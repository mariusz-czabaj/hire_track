---
change_id: candidate-history-search
title: Candidate database — list, search by name, and cross-recruitment status history
status: implementing
created: 2026-09-03
updated: 2026-09-03
archived_at: null
---

## Notes

from @context/foundation/roadmap.md — slice S-06.

Scope anchors: US-02, FR-014 (Candidates list view across all recruitments), FR-015 (search by
first/last name), FR-016 (candidate view shows every recruitment they took part in, with the full
status-change log per recruitment).

Prerequisites per roadmap: S-04 (real status changes to log) and F-01 (shared candidate profile
across recruitments). Runs in parallel with S-05, which already shipped the candidate-scoped route
`/candidates/:candidateId` that this slice extends.

## Planning decisions (2026-09-03)

- **Silent truncation.** A viewer without visibility into a recruitment sees neither the
  recruitment nor any hint that one was withheld — no count, no notice. RLS already enforces
  this at the query level; the application adds no disclosure layer on top of it.
- **Cap-plus-hint bounding on the candidates list**, not offset or cursor pagination. The
  service fetches `cap + 1` rows to detect truncation and returns at most `cap`; the UI shows
  a refine hint when the flag is set. No pagination component was built.
- **Substring search with a two-character floor.** `?q=` shorter than two characters after
  trimming is treated as absent rather than rejected, so the search box behaves sensibly on
  the first keystroke. `%` and `_` are escaped before interpolation to prevent wildcard
  injection turning a search into a full scan.
- **Attribution deferred.** FR-016 asks for the log, not who made each change. Showing
  `changed_by` would require widening `get_user_emails_for_candidate`, whose predecessor was
  a CRITICAL email-enumeration finding (S-04 F1/F6). Deliberately out of scope here.
  **Follow-up, stated concretely for a later slice**: widen `get_user_emails_for_candidate`
  to also admit ids drawn from `candidate_recruitment_status_history.changed_by` for that same
  `candidate_recruitment`, keeping the per-`candidate_recruitment` scoping that finding F1
  introduced — do not widen it to accept an arbitrary id list.
- **History delivered on the existing profile GET**, not a separate endpoint. `getCandidateProfile`
  already fetches the candidate's visible `candidate_recruitments`; the history is one further
  query filtered by `in (candidateRecruitmentIds)` and grouped in TypeScript, keeping the
  candidate-scoped read in one round trip.
- **Cross-tenant fixture (Julia Wojcik) added to `supabase/seed.sql`.** One candidate seeded
  into recruitments in two different security groups, each with a multi-step status-history
  chain, so FR-016 and the truncation boundary are both demonstrable and assertable against a
  real database without inventing per-test fixtures.
