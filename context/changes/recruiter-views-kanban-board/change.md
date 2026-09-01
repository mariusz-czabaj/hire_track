---
change_id: recruiter-views-kanban-board
title: Rekruter przegląda listę rekrutacji i otwiera rekrutację jako kanban kandydatów
status: implemented
created: 2026-09-01
updated: 2026-09-01
archived_at: null
---

## Notes

S-01 z @context/foundation/roadmap.md

- **Outcome (roadmap):** rekruter (i hiring manager, tylko odczyt) loguje się, widzi listę rekrutacji z filtrowaniem po statusie i otwiera rekrutację jako tablicę kanban kandydatów pogrupowanych po etapach, z licznikiem per kolumna i datą dodania na każdej karcie.
- **PRD refs:** US-01, FR-003, FR-004 (tylko domyślny zestaw etapów), FR-005, FR-010
- **Prerequisites:** F-01 (`core-recruitment-data-foundation`, in-progress); external state: zasiane dane testowe (rekrutacja przypisana do grupy bezpieczeństwa, kandydaci na etapach, użytkownik testowy będący członkiem tej grupy).
- **Parallel with:** S-07 (`admin-manages-security-groups`)
- **Open unknown:** zakres widoku dla Hiring Managera (read-only) vs Rekrutera (edycja), zanim S-07 dostarczy pełny model operacja→grupa. Owner: user. Nie blokuje.
- **Dlaczego teraz:** to north star roadmapy — najmniejszy wycinek end-to-end dowodzący wartości produktu.
