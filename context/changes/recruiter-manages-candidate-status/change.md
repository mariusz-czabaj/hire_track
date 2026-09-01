---
change_id: recruiter-manages-candidate-status
title: Recruiter manages candidate status with required note
status: implemented
created: 2026-09-01
updated: 2026-09-01
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### 2026-09-01 — Note model decided (Reading A) — SUPERSEDED, see below

The interview note is **one editable free-text field per candidate per recruitment**, not an
append-only list. The status gate is therefore "the note is non-empty" — once filled, later moves
are unblocked. Chosen because the PRD's Business Logic section (`prd.md:123-125`) is the normative
statement of the rule and is singular, and because it does not foreclose a notes log later (S-05/S-06).
Accepted trade-off: the gate is weak in practice — fill the note once and it never blocks again.
Resolves research.md Open Question 1. Decided by user.

### 2026-09-01 — Note model revised during planning (supersedes Reading A)

Reading A (one note per candidate per recruitment) is **superseded**. The note is **one per candidate per
recruitment per stage**, editable, displayed on the candidate detail page as a Jira-style comment list with
author and timestamp. The gate is therefore stronger than Reading A's: **moving out of stage X requires a
non-blank note on stage X**, so every move needs its own write-up rather than one note unblocking everything.

Table: `candidate_stage_notes` with `unique (candidate_recruitment_id, stage_id)`, `created_by`, `created_at`,
`updated_at`. Any holder of `recruitment.write` on that recruitment may edit, matching the repo's per-recruitment
(never per-row) authorization posture. Decided by user during `/10x-plan`.
