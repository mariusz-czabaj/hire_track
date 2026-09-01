# Recruiter Customizes Kanban Stages — Plan Brief

> Full plan: `context/changes/recruiter-customizes-kanban-stages/plan.md`
> Research: `context/changes/recruiter-customizes-kanban-stages/research.md`

## What & Why

Let a recruiter replace a recruitment's kanban stage set with one that fits its process — different roles (tech vs. sales) run genuinely different pipelines, and a fixed six-column board forces every one of them into the same shape. This is roadmap slice **S-03**, PRD **FR-004**.

## Starting Point

F-01 built the schema slot for this deliberately: `kanban_stages.recruitment_id` is nullable (NULL = global default, non-NULL = per-recruitment override) with two partial unique indexes, and the write policies were withheld with a comment naming S-03 as their owner. The read policy already handles both partitions.

But the roadmap's "low risk, purely additive" call is wrong, and research proved it empirically. The board query is hardcoded to defaults, so the moment an override set exists **every candidate silently disappears** (verified: 0 of 5). A stage becomes **permanently undeletable** once any candidate has passed through it, because append-only history holds a `NO ACTION` FK — moving candidates off first still fails. And reordering hits a non-deferrable partial unique index that defeats both the obvious single-`UPDATE` workaround and a row-by-row renumber.

## Desired End State

A recruiter opens a board, clicks a control beside the status control, and edits the stage list in a dialog — rename, reorder, add, remove, or reset to defaults. Saving replaces the set atomically and the board refetches. If the recruitment already has candidates, the editor explains stages are locked and the server refuses. A Hiring Manager sees the control and gets a clean 403. Administrators can edit the global defaults via API, removing only stages nothing references.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Scope of "customize" | Rename + reorder + add + remove | Anything less doesn't deliver FR-004 — processes differ in which stages exist, not just labels | Plan |
| Existing candidates | Block customization once any candidate exists | Removes the vanishing-candidate bug, the re-map, and the S-03/S-04 boundary question at once; S-04 hasn't shipped so no real recruitment has candidates | Plan |
| Global defaults editable | Yes, gated on `group.manage` | The seeded Administrator group already holds exactly that operation — no enum change, no extra migration | Plan |
| Defaults delete safety | Per-row: refuse if referenced | A blanket zero-candidates gate would ship the feature dead — the seed alone puts candidates on defaults | Plan |
| Admin UI | API + RPC only; screen deferred to S-07 | The hard part is the diff/renumber/refusal logic; a bare CRUD screen belongs with S-07's admin surface | Plan |
| Write algorithm | Delete+reinsert for overrides, diff+renumber for defaults | Overrides are provably unreferenced under the gate; default rows are referenced and cannot be deleted wholesale | Research |
| Reorder mechanism | Two-phase negate-then-assign | Verified: single-statement and row-by-row renumbers both fail with `23505` | Research |
| Stage↔recruitment integrity | Trigger, not composite FK | Both columns are `not null`, so a composite FK would reject every candidate on a global default stage and break the seed | Plan |
| Denial semantics | 404 if not visible, 403 if visible but read-only | Preserves the "forbidden is indistinguishable from missing" posture while telling a Hiring Manager why the control they can see won't work | Plan |
| DTO provenance | Board-level `stagesSource` | Resolution is all-or-nothing, so a per-stage flag would always be uniform | Research |
| Name validation | Trim, non-empty, max length | Closes the `''` hole; no uniqueness within a set, no English-only enforcement | Plan |
| Stage count | Min 1, no maximum | The floor must be enforced in the RPC (schema can't express it); the board scrolls horizontally so a wide set degrades but doesn't break | Plan |
| Endpoint | `PUT /api/recruitments/[id]/stages` | Honest verb for whole-set replacement; needs a one-line widening of `useMutation`'s method union | Plan |
| E2E fixture | Spec creates its own recruitment | A fresh recruitment has zero candidates by construction, and S-01's `STAGE_ORDER` assertions stay untouched | Plan |

## Scope

**In scope:** write policies on `kanban_stages`; stage↔recruitment consistency trigger; name check + defaults-name unique index; three RPCs (replace, reset, update defaults); override-aware board read path; `stagesSource` on the board DTO; `GET`/`PUT` stages endpoint; stage editor dialog; unit, component, integration, RLS and e2e coverage.

**Out of scope:** admin UI for defaults (S-07); candidate re-mapping and the history/no-note question (S-04); soft-delete on stages; `from_stage_id on delete set null` and history FK indexes (declined); per-recruitment name uniqueness; maximum stage count; roadmap status cleanup.

## Architecture / Approach

Database first, in two pieces — policies and integrity (so RLS assertions test them directly, without an RPC's `security definer` bypassing them), then the RPCs that use them. The read path is fixed **before** any UI can create an override set, so there is never a window where a custom board silently drops candidates; this ordering is a hard constraint, not a preference. Endpoint, UI, and e2e layer on top.

All multi-row writes go through `security definer` RPCs in `public` — PostgREST has no cross-call transaction, and only `public` is exposed. Each re-checks permission as its first statement.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema, policies & integrity | Write policies, consistency trigger, constraints, first `kanban_stages` RLS assertions | Getting a policy predicate subtly wrong — grants are already open, so only the policy stands between a recruiter and the global defaults |
| 2. Stage-write RPCs | Replace, reset, and defaults-diff RPCs; regenerated types | The defaults diff carries the renumber and the referenced-row refusal — the most intricate code in the slice |
| 3. Override-aware read path | Resolution in one round trip, `stagesSource` on the DTO | Must land before Phase 5 or custom boards lose every candidate |
| 4. Stages API endpoint | `GET`/`PUT` route, errcode mapping, integration tests | `23503` already means "nonexistent group"; new refusals must not collapse into it |
| 5. Stage editor UI | Dialog, variable-length list form, `fieldErrors` mapping, reset | Three patterns with no precedent here — stable keys, per-row labels, dotted field errors |
| 6. End-to-end coverage | Self-created-recruitment spec | Hydration flake; must not touch S-01's seeded assertions |

**Prerequisites:** F-01, S-01, and S-02 shipped (S-02's create endpoint is used by the e2e fixture). Running local Supabase + Astro for integration tests; `docker exec` access for the RLS script.
**Estimated effort:** ~4-6 sessions across 6 phases.

## Open Risks & Assumptions

- **The zero-candidates gate is a one-way door for the recruiter.** Once candidates are added, the process can never be reshaped. This is cheap today only because S-04 hasn't shipped; it will likely need revisiting once candidates exist in the wild.
- **S-03 and S-04 should not run in parallel**, despite the roadmap marking them as such. Both write `current_stage_id`, and S-04 owns the no-note-no-move contract that a config-driven bulk move would collide with.
- **The English-rename guarantee expires here.** Future migrations can no longer assume the default set holds its shipped names, nor enumerate user-created override rows.
- **The defaults-removal check scans history sequentially** — indexes on the history stage FKs were declined. Acceptable at current volume; first place to look if that RPC feels slow.
- **Nothing stops a non-English stage name at runtime.** The repo's English-only rule binds files, not user input, and enforcing it was explicitly declined.

## Success Criteria (Summary)

- A recruiter can give a new recruitment its own stage set, see the board render it, and reset back to defaults.
- Boards left alone still show the global defaults, and no candidate ever disappears from a board.
- Read-only roles see the control and receive a clean denial rather than a crash or a broken page.
