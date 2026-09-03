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
