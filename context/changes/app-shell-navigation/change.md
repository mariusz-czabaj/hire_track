---
change_id: app-shell-navigation
title: Application navigation and removal of the starter surface
status: implementing
created: 2026-09-05
updated: 2026-09-05
archived_at: null
---

## Notes

Slice S-08 from `context/foundation/roadmap.md` (milestone M-2: ui-visual-redesign).
Scope anchors: MS-02 (application shell), MS-08 (removal of the starter surface).

Input material:

- `context/foundation/roadmap.md` — S-08 outcome, risk, and dependency chain
- `context/changes/ui-redesign-foundation/design-brief.md` — requirements B1-B7
- `context/changes/design-system-foundation/plan.md` — F-02, which delivered
  `AppShell.astro`, the token layer, and the theme resolution pattern

Prerequisite F-02 is complete (`status: impl_reviewed`). S-08 consumes `AppShell`
and the token layer; it does not add tokens beyond what a navigation surface needs.
