---
change_id: recruitment-header-metadata
title: Recruitment header shows location, department, employment type, opened date
status: implemented
created: 2026-09-06
updated: 2026-09-06
archived_at: null
---

## Notes

Slice S-09 from `context/foundation/roadmap.md` (milestone M-2: ui-visual-redesign).
Outcome: "rekruter widzi w nagłówku rekrutacji jej lokalizację, dział, typ
zatrudnienia i datę otwarcia" (recruiter sees the recruitment's location,
department, employment type, and opened date in the header).

Dependencies: F-02 (design-system-foundation, done), S-08
(`app-shell-navigation`, done — `impl_reviewed`). S-08 explicitly deferred this
work: "No recruitment header metadata, status badge or '…' actions menu. That
is S-09, which builds on the `page-title` / `page-actions` slots this change
starts using."

Unlocks: S-10 (`kanban-visual-redesign`).
