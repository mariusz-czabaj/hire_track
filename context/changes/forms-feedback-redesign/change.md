---
change_id: forms-feedback-redesign
title: Forms, error messages, and action confirmations
roadmap_id: S-13
milestone_id: MS-07
status: implementing
created: 2026-09-06
updated: 2026-09-06
prd_refs: []
---

# S-13: Forms, error messages, and action confirmations

## Outcome

A user fills in forms (sign-in, sign-up, new recruitment, dialogs) on one set of
fields built on the `input` primitive; errors are presented by a single, accessible
message component; a successful action gives a visible confirmation instead of a
silent list refresh; the configuration banner stops being a bright insert from a
different visual world.

## Prerequisites

- F-02 (`design-system-foundation`) — token layer, three-state theme model, `AppShell`.

## Unknowns

- Confirmation mechanism choice (global toast vs. inline per-action message) —
  Owner: team. Not blocking — resolved at `/10x-plan` level.

## Artifacts

- `research.md` — codebase research (this change)
