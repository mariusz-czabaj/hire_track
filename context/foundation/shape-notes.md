---
project: System wspomagający rekrutację
context_type: greenfield
updated: 2026-05-31
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  product_type: web-app
  target_scale: medium
  quality_check_status: accepted
  frs_drafted: 18
  quality_check_status: pending
---

## Vision & Problem Statement

System wspomagający prowadzenie rekrutacji w organizacji.

**Ból:**
1. Brak widoczności aktualnego statusu rekrutacji na stanowisko — każdy pyta każdego zamiast zobaczyć w jednym miejscu.
2. Dane kandydatów uwięzione w arkuszach kalkulacyjnych — trudne do przeszukiwania, brak synchronizacji, wiele wersji pliku.
3. Brak możliwości podjęcia decyzji o ponownym rozważeniu kandydata z poprzedniej rekrutacji.
4. Powielanie pracy — przy otwieraniu nowego stanowiska nikt nie wie, że dany kandydat był już oceniany w przeszłości.

**Moment odczucia bólu:** otwarcie nowego stanowiska, bieżący tracking kandydatów, przegląd postępu rekrutacji z hiring managerem.

**Koszt dziś:** arkusze Excel/Google Sheets — ręczne aktualizacje, brak jednego źródła prawdy, historia kandydatów rozproszona lub niedostępna.

**Insight:** projekt dydaktyczny (kurs pracy z AI) z realnym zastosowaniem w organizacji — brak gotowego narzędzia w firmie, więc przyniesie wymierną korzyść bez konieczności uzasadniania pełnego business case'u.

## User & Persona

**Persona 1 — Rekruter / HR:**
Prowadzi rekrutacje operacyjnie. Potrzebuje bieżącego statusu każdego kandydata i dostępu do historii poprzednich rekrutacji. Dziś aktualizuje arkusze ręcznie.

**Persona 2 — Hiring Manager:**
Zgłasza zapotrzebowanie na stanowisko i chce wiedzieć co się dzieje z "jego" rekrutacją. Potrzebuje statusu bez konieczności pytania HR. Przy nowym zapotrzebowaniu chciałby wiedzieć, czy są kandydaci z poprzednich rekrutacji wartych ponownego rozważenia.

## Access Control

**Uwierzytelnianie MVP:** e-mail + hasło. Docelowo: OAuth (Google lub Microsoft — do ustalenia przy wyborze stacku).

**Model uprawnień:** RBAC z grupami bezpieczeństwa.
- Administrator tworzy grupy i przypisuje im dozwolone operacje.
- Użytkownicy są przypisywani do grup.
- Operacja jest dostępna dla użytkownika, jeśli należy do grupy mającej tę operację.

**Przykładowe grupy (nie są częścią schematu — do ustalenia przy implementacji):**
- HR/Rekruter — pełne zarządzanie kandydatami, rekrutacjami, stanowiskami.
- Hiring Manager — podgląd statusu swoich rekrutacji, przeszukiwanie bazy kandydatów (tylko odczyt).
- Administrator — zarządzanie grupami i użytkownikami.

## Success Criteria

### Primary
MVP działa gdy rekruter może: zalogować się, zobaczyć listę rekrutacji (filtrowaną po statusie), otworzyć rekrutację jako tablicę kanban kandydatów, zmienić status kandydata, otworzyć profil kandydata z danymi osobowymi, uploadem CV i notatkami rekrutera po rozmowie. Hiring Manager może przejrzeć status swoich rekrutacji i wyszukać kandydata po imieniu/nazwisku przez historię rekrutacji.

### Secondary
*(usunięte — powiadomienia e-mail wyłączone z MVP)*

### Guardrails
- Dane kandydatów dostępne wyłącznie dla zalogowanych użytkowników organizacji.
- Upload CV musi być niezawodny — utrata pliku jest niedopuszczalna.
- Zmiana statusu kandydata musi być odwracalna.

## Timeline Budget
- `mvp_weeks: 2`
- `after_hours_only: true`
- `hard_deadline: null`

## Functional Requirements

### Rekrutacje
- FR-001: Rekruter może utworzyć nową rekrutację ze stanowiskiem i metadanymi (lokalizacja, dział, typ zatrudnienia, data otwarcia). Priority: must-have
- FR-001a: Podczas tworzenia rekrutacji rekruter musi przypisać co najmniej jedną grupę bezpieczeństwa — rekrutacja jest widoczna i edytowalna wyłącznie przez użytkowników należących do przypisanych grup; lista grup zarządzana jest przez administratora i pobierana w momencie tworzenia rekrutacji. Priority: must-have
- FR-002: Rekruter może ustawić/zmienić status rekrutacji (Draft / Live / Closed). Priority: must-have
- FR-003: Użytkownik może przeglądać listę rekrutacji z filtrowaniem po statusie (otwarte/zamknięte). Priority: must-have
- FR-004: Rekruter może definiować etapy kanban per rekrutacja (z globalnym zestawem domyślnym do nadpisania). Priority: must-have
  > Sokrates: Kontrargument rozważony — "per rekrutacja to więcej konfiguracji niż arkusz". Rozwiązanie: globalny domyślny zestaw etapów, który rekruter może nadpisać per rekrutacja. Wartość: różne stanowiska (tech vs. sprzedaż) mają różne procesy.
- FR-005: Użytkownik może otworzyć rekrutację i zobaczyć kandydatów na tablicy kanban z licznikiem per kolumna. Priority: must-have

### Kandydaci
- FR-006: Rekruter może dodać kandydata do rekrutacji (kandydat to niezależny profil powiązany z wieloma rekrutacjami). Priority: must-have
- FR-007: Jeden kandydat może brać udział w wielu rekrutacjach jednocześnie lub kolejno; profil (dane, CV) jest współdzielony, notatki i status są osobne per rekrutacja. Priority: must-have
  > Sokrates: Złożoność danych rozważona — profil wsp. + notatki per rekrutacja to świadomy wybór. Utrata tego wymogu uniemożliwia wyszukiwanie historii kandydata.
- FR-008: Rekruter może zmienić status kandydata w danej rekrutacji (zmiana kolumny na kanbanie). Priority: must-have
- FR-009: Rekruter może cofnąć/poprawić status kandydata. Priority: must-have
- FR-010: Karta kandydata na kanbanie wyświetla datę dodania do rekrutacji. Priority: must-have
- FR-011: Użytkownik może otworzyć profil kandydata z danymi osobowymi. Priority: must-have
- FR-012: Rekruter może uploadować plik CV (PDF/DOCX) do profilu kandydata. Priority: must-have
  > Sokrates: Kontrargument "link zamiast uploadu" rozważony i odrzucony — kandydaci wysyłają CV mailem, rekruter musi móc zapisać plik w systemie.
- FR-013: Rekruter może dodać/edytować notatki po rozmowie per kandydat per rekrutacja. Priority: must-have

### Baza kandydatów
- FR-014: Użytkownik może przejść do widoku "Kandydaci" — listy wszystkich kandydatów ze wszystkich rekrutacji. Priority: must-have
- FR-015: Użytkownik może wyszukać kandydata po imieniu/nazwisku przez historię wszystkich rekrutacji. Priority: must-have
- FR-016: Widok kandydata pokazuje wszystkie rekrutacje, w których brał udział, z pełnym logiem zmian statusów per rekrutacja. Priority: must-have
  > Sokrates: "Tylko aktualny etap" rozważone i odrzucone — pełny log jest potrzebny do oceny historii kandydata (kiedy przez jakie etapy przechodził).

### Administracja
- FR-017: Administrator może tworzyć grupy bezpieczeństwa i przypisywać operacje do grup. Priority: must-have
- FR-018: Administrator może dodawać/usuwać użytkowników z grup. Priority: must-have

## Non-Goals

- **Brak integracji z zewnętrznymi ATS** (Workable, Greenhouse, itp.) — system autonomiczny, bez importu/eksportu danych. Rationale: dodałoby znaczącą złożoność, niepotrzebną dla wewnętrznego narzędzia organizacji.
- **Single-tenant** — system obsługuje jedną organizację. Brak multi-tenancy w MVP. Rationale: skalowanie do SaaS to osobna decyzja produktowa.
- **Brak publicznej strony ogłoszenia o pracę** — system nie generuje publicznych job postingów dla kandydatów zewnętrznych. Rationale: kandydaci są dodawani przez rekrutera, nie aplikują samodzielnie.

## Forward: tech-stack
- Sugestie pytań rekrutacyjnych AI (poza MVP) — będzie wymagać modelu kompetencji i integracji z LLM.
- Docelowo OAuth (Google lub Microsoft) zamiast email+hasło.

## Business Logic

**Reguła domenowa:** System wymaga wypełnienia notatki przed każdą zmianą statusu kandydata — twarda blokada uniemożliwia zapisanie zmiany bez notatki.

Dane wejściowe reguły: aktualny status kandydata w rekrutacji, treść notatki rekrutera po rozmowie.
Wyjście: zmiana statusu jest dozwolona (notatka wypełniona) lub zablokowana (brak notatki).
Miejsce w flow: rekruter próbuje przesunąć kandydata na kanbanie — system sprawdza notatkę przed zapisem.

**Planowana funkcja poza MVP:** system sugeruje pytania rekrutacyjne na podstawie zestawu wymaganych umiejętności dla danego stanowiska. Odłożone świadomie — wymaga modelu kompetencji i integracji z AI.

## Non-Functional Requirements

- Czas odpowiedzi: widoki listy rekrutacji i kanbanu ładują się w czasie odczuwalnym przez użytkownika poniżej 2 sekund.
- Prywatność: żadne dane kandydatów nie są dostępne bez uwierzytelnienia — każdy endpoint weryfikuje sesję.
- Wsparcie przeglądarek: aplikacja działa poprawnie w Chrome, Firefox i Edge (ostatnie 2 wersje każdej).

## User Stories

### US-01: Rekruter przegląda aktualny status rekrutacji
Given rekruter jest zalogowany,
When otwiera listę rekrutacji i klika w rekrutację "Floor Manager",
Then widzi tablicę kanban z kandydatami pogrupowanymi po etapach, z licznikiem per kolumna i datą aplikacji na każdej karcie.

### US-02: Rekruter wyszukuje historię kandydata
Given rekruter jest zalogowany,
When przechodzi do sekcji "Kandydaci" i wyszukuje po nazwisku "Kowalski",
Then widzi kandydata Kowalski oraz listę wszystkich rekrutacji, w których brał udział, z pełnym logiem zmian statusów.

