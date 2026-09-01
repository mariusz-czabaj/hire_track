# Recruiter Manages Candidate Status — Plan Brief

> Full plan: `context/changes/recruiter-manages-candidate-status/plan.md`
> Research: `context/changes/recruiter-manages-candidate-status/research.md`

## What & Why

Roadmap slice **S-04**. A recruiter adds a candidate to a recruitment and moves them between kanban stages,
and the system refuses the move unless a non-blank interview note exists for the stage being left. Reverting a
status works the same way. This is the PRD's one explicit business rule (§Business Logic, FR-006/008/009/013) —
the point where the board stops being a read-only view of seeded data and becomes the recruiter's actual workflow.

## Starting Point

F-01 built the candidate tables with this slice in mind — `candidates` carries a `lower(email)` unique index whose
own migration comment describes the find-or-create flow, and `candidate_recruitments` plus an append-only status
history already exist. But every write path is missing: no notes storage of any kind, no candidate RPC, service,
or route, and nothing that populates status history (there is no trigger; the seed writes its one row by hand).
The board is read-only.

## Desired End State

A recruiter adds a candidate from the board and the card appears in the first stage. Clicking the card opens a
candidate page listing that candidate's per-stage notes Jira-comment style, with author and timestamp, editable
inline. Moving a card opens a dialog seeded with the note for the stage the candidate is currently in; if it is
blank the server refuses the move, and filling it in the same dialog saves the note and performs the move
atomically. A hiring manager sees the same controls and gets a clean permission message.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Note model | One note per candidate-per-recruitment-**per-stage**, editable | Supersedes the earlier single-note reading; makes the gate strong — each move needs a note for the stage being left | Plan |
| Gate semantics | The **source** stage must have a note | "Note after the interview" means recording the stage you just finished | Plan |
| Where the gate lives | Inside a `SECURITY DEFINER` RPC | RLS already permits a bare PostgREST `UPDATE` of `current_stage_id`, so a route- or UI-level check is decorative | Research |
| Note + move | One RPC takes stage and an optional note | One round trip, and the gate cannot race a concurrent note edit | Plan |
| Email match, different name | Reject with a 422 (`PA003`) | Forces the recruiter to resolve the ambiguity rather than silently renaming or mislinking | Plan |
| Card contents | Unchanged — no note info on the card | Board payload stays small; notes live on the detail page | Plan |
| Detail page scope | Identity + notes only | FR-011/FR-012 belong to S-05; this gives notes a home without pre-empting it | Plan |
| Move targets | Any stage in the resolved set, forward or backward | Satisfies FR-009 with no special case | Plan |
| Note authorship | `created_by` + timestamps; any `recruitment.write` holder may edit | Matches the repo's per-recruitment (never per-row) authorization posture | Plan |
| Note editing path | Plain RLS-covered table upsert, not an RPC | Single-table write, no atomicity need, no gate to enforce | Plan |

## Scope

**In scope:** `candidate_stage_notes` table with RLS; extending the `PA002` stage-deletion guard; two RPCs
(`add_candidate_to_recruitment`, `move_candidate_stage`) with two new errcodes; a candidate service; four API
routes; a textarea primitive; add and move dialogs; a minimal candidate detail page; unit, integration, RLS, and
E2E coverage.

**Out of scope:** CV upload and the full profile (S-05); cross-recruitment search (S-06); candidate removal;
drag-and-drop; revisiting the `PA001` customization lock; client-side capability gating; note deletion or
note-edit history; CSRF; board pagination.

## Architecture / Approach

Bottom-up, because the gate is a database invariant and everything above it is presentation.

```
candidate_stage_notes  ──gate──►  move_candidate_stage (SECURITY DEFINER)
       ▲                                │
       │ upsert (source stage)          ├──► candidate_recruitments.current_stage_id
       │                                └──► candidate_recruitment_status_history
  PUT …/notes                     PATCH …/candidates/[candidateId]
       ▲                                ▲
  CandidateDetail                  MoveCandidateDialog ──onChanged──► board refetch
```

The move RPC captures `current_stage_id` **before** writing, upserts the supplied note against that captured
source stage, evaluates the gate, then updates and logs history. Doing it in the other order would attach the
note to the target stage and unblock the *next* move instead of this one.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Notes schema | `candidate_stage_notes` + RLS + grants; extended `PA002` guard | Forgetting the guard lets a note-referenced stage be deleted, surfacing as an opaque 500 |
| 2. Domain RPCs | Both writes behind `SECURITY DEFINER`; `PA003`/`PA004`; SQL assertions | Assertions that pass vacuously — the exact S-03 impl-review F1 failure |
| 3. Service + API | `candidates.ts`, four routes, `handleCandidateRpcError`, integration tests | An unmapped errcode falling through to a generic 500 (happened twice before) |
| 4. Board interaction | Textarea, add and move dialogs, card links, refetch wiring | Blocked-move UX becoming a dead end instead of fixable in place |
| 5. Detail page | Identity + per-stage note list with inline editing | Drifting into S-05's profile scope |
| 6. E2E | Full path plus a hiring-manager denial; CI readiness probe | New specs polluting fixtures `recruitments.spec.ts` asserts on |

**Prerequisites:** F-01, S-01, S-02, S-03 shipped (all `impl_reviewed`); local Supabase running; seeded test users.
**Estimated effort:** ~4-6 sessions across 6 phases, with a manual-confirmation pause after each.

## Open Risks & Assumptions

- Shipping this makes S-03's `PA001` lock bite for real — any recruitment with a candidate permanently refuses
  stage customization. Flagged in S-03 as needing revisiting; deliberately not revisited here.
- A direct PostgREST `UPDATE` of `current_stage_id` remains possible for `recruitment.write` holders. The RPC is
  the application's only path, but the gate is not a database constraint — closing that would mean removing the
  table's UPDATE policy, which is a broader change than this slice.
- Editing a note overwrites it with no history. A candidate looping through one stage twice loses the first
  write-up.
- The board query is still unpaginated, and this slice is what makes candidate counts grow.
- Two CI flake classes recur when new API routes appear: the dev-server readiness probe (fixed once in `1f3a94f`)
  and PostgREST clock skew after `supabase start` (absorbed in `d7ff36b`). Phase 6 extends the former.

## Success Criteria (Summary)

- A recruiter can add a candidate and move them forward and backward through the board's stages.
- A move out of a stage with no note is refused, and the recruiter can fix it without leaving the dialog.
- Every stage change leaves a history row, and every note carries its author and timestamp.
