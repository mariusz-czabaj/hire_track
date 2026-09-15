---
change_id: recruitment-edit-details
title: Recruitment edit details
status: implementing
created: 2026-09-15
updated: 2026-09-15
archived_at: null
---

## Notes

S-15 z @context/foundation/roadmap.md

- **Outcome (roadmap):** rekruter z uprawnieniem `recruitment.write` otwiera z menu akcji "…" w nagłówku rekrutacji formularz edycji i zmienia tytuł, lokalizację, dział, typ zatrudnienia, datę otwarcia oraz przypisane grupy bezpieczeństwa; po zapisie nagłówek i lista rekrutacji pokazują nowe wartości bez przeładowania strony.
- **Scope anchors:** MS-10
- **Prerequisites:** S-09 (recruitment-header-metadata) — nagłówek musi już nieść metadane, żeby było co edytować.
- **Parallel with:** S-10, S-11, S-12, S-13
- **Open unknowns:**
  - Czy edycja grup bezpieczeństwa wchodzi w zakres tego wycinka (ryzyko: odebranie sobie dostępu). Owner: user. Nie blokuje.
  - Czy edycja tworzy wpis w historii zmian rekrutacji. Owner: team. Nie blokuje.
