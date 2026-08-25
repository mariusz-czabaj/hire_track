---
project: System wspomagający rekrutację
version: 1
status: draft
created: 2026-05-31
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: "# TODO: qps — see Open Questions"
  data_volume: "# TODO: data_volume — see Open Questions"
timeline_budget:
  mvp_weeks: 2
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Rekruterzy i hiring managerowie w organizacji prowadzą rekrutacje bez centralnego narzędzia: statusy kandydatów żyją w arkuszach kalkulacyjnych, historia poprzednich rekrutacji jest niedostępna lub rozproszona w wielu plikach. Ból objawia się w trzech momentach — otwarcie nowego stanowiska (brak dostępu do historii kandydatów), bieżący tracking (każdy pyta każdego zamiast zobaczyć w jednym miejscu), przegląd postępu z hiring managerem (brak jednego źródła prawdy).

Organizacja nie ma gotowego narzędzia do zarządzania rekrutacjami; nikt nie zna historii kandydatów między rekrutacjami, co prowadzi do powielania pracy i utraty potencjalnych kandydatów. Projekt łączy realne zapotrzebowanie organizacji z celem dydaktycznym (kurs pracy z AI), co eliminuje konieczność pełnego business case'u dla wdrożenia.

## User & Persona

### Primary persona — Rekruter / HR

Prowadzi rekrutacje operacyjnie. Codziennie aktualizuje statusy kandydatów, dodaje notatki po rozmowach, i odpowiada na pytania hiring managerów o postęp rekrutacji. Dziś robi to ręcznie w arkuszu. Ból: brak jednego miejsca z aktualnym statusem każdego kandydata i historią poprzednich rekrutacji.

### Secondary persona — Hiring Manager

Zgłasza zapotrzebowanie na stanowisko i chce śledzić postęp bez pytania HR o każdą aktualizację. Przy otwieraniu nowego stanowiska chce wiedzieć, czy są kandydaci z poprzednich rekrutacji wartych ponownego rozważenia. Potrzebuje dostępu tylko do odczytu.

## Success Criteria

### Primary

MVP jest gotowy, gdy rekruter może: zalogować się, zobaczyć listę rekrutacji z filtrowaniem po statusie, otworzyć rekrutację jako tablicę kanban kandydatów, zmienić status kandydata (z wymaganą notatką), otworzyć profil kandydata z danymi osobowymi, plikiem CV i notatkami rekrutera. Hiring Manager może przejrzeć status swoich rekrutacji i wyszukać kandydata po imieniu/nazwisku przez historię wszystkich rekrutacji.

### Secondary

*(usunięte — powiadomienia e-mail wyłączone z MVP)*

### Guardrails

- Dane kandydatów dostępne wyłącznie dla zalogowanych użytkowników organizacji.
- Upload CV musi być niezawodny — utrata pliku jest niedopuszczalna.
- Zmiana statusu kandydata musi być odwracalna.

## User Stories

### US-01: Rekruter przegląda aktualny status rekrutacji

- **Given** rekruter jest zalogowany
- **When** otwiera listę rekrutacji i klika w rekrutację "Floor Manager"
- **Then** widzi tablicę kanban z kandydatami pogrupowanymi po etapach, z licznikiem per kolumna i datą aplikacji na każdej karcie

#### Acceptance Criteria

- Tablica kanban wyświetla kandydatów pogrupowanych według bieżącego etapu rekrutacji.
- Każda kolumna kanban pokazuje licznik kandydatów w tym etapie.
- Każda karta kandydata wyświetla datę dodania do rekrutacji.

### US-02: Rekruter wyszukuje historię kandydata

- **Given** rekruter jest zalogowany
- **When** przechodzi do sekcji "Kandydaci" i wyszukuje po nazwisku "Kowalski"
- **Then** widzi kandydata Kowalski oraz listę wszystkich rekrutacji, w których brał udział, z pełnym logiem zmian statusów

#### Acceptance Criteria

- Wyniki wyszukiwania zawierają pasującego kandydata.
- Dla każdego kandydata wyświetlana jest lista wszystkich rekrutacji, w których uczestniczył.
- Dla każdej rekrutacji widoczny jest pełny log zmian statusów kandydata.

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
  > Sokrates: Złożoność danych rozważona — profil współdzielony + notatki per rekrutacja to świadomy wybór. Utrata tego wymogu uniemożliwia wyszukiwanie historii kandydata.
- FR-008: Rekruter może zmienić status kandydata w danej rekrutacji (zmiana kolumny na kanbanie). Priority: must-have
- FR-009: Rekruter może cofnąć/poprawić status kandydata. Priority: must-have
- FR-010: Karta kandydata na kanbanie wyświetla datę dodania do rekrutacji. Priority: must-have
- FR-011: Użytkownik może otworzyć profil kandydata z danymi osobowymi. Priority: must-have
- FR-012: Rekruter może uploadować plik CV (PDF/DOCX) do profilu kandydata. Priority: must-have
  > Sokrates: Kontrargument "link zamiast uploadu" rozważony i odrzucony — kandydaci wysyłają CV mailem, rekruter musi móc zapisać plik w systemie.
- FR-013: Rekruter może dodać/edytować notatki po rozmowie per kandydat per rekrutacja. Priority: must-have
- FR-013a: Plik CV jest automatycznie usuwany 12 miesięcy po jego dodaniu do profilu kandydata. Priority: must-have

### Baza kandydatów

- FR-014: Użytkownik może przejść do widoku "Kandydaci" — listy wszystkich kandydatów ze wszystkich rekrutacji. Priority: must-have
- FR-015: Użytkownik może wyszukać kandydata po imieniu/nazwisku przez historię wszystkich rekrutacji. Priority: must-have
- FR-016: Widok kandydata pokazuje wszystkie rekrutacje, w których brał udział, z pełnym logiem zmian statusów per rekrutacja. Priority: must-have
  > Sokrates: "Tylko aktualny etap" rozważone i odrzucone — pełny log jest potrzebny do oceny historii kandydata (kiedy przez jakie etapy przechodził).

### Administracja

- FR-017: Administrator może tworzyć grupy bezpieczeństwa i przypisywać operacje do grup. Priority: must-have
- FR-018: Administrator może dodawać/usuwać użytkowników z grup. Priority: must-have

## Non-Functional Requirements

- Widoki listy rekrutacji i tablicy kanban ładują się w czasie poniżej 2 sekund w normalnych warunkach działania systemu.
- Żadne dane kandydatów nie są dostępne nieuprawnionemu lub niezalogowanemu użytkownikowi.
- Aplikacja działa poprawnie na dwóch ostatnich wersjach głównych przeglądarek Chrome, Firefox i Edge.
- Retencja danych: pliki CV są trwale usuwane automatycznie po 12 miesiącach od daty dodania (FR-013a); profil kandydata i historia statusów pozostają nienaruszone po usunięciu pliku.

## Business Logic

System blokuje zmianę statusu kandydata w rekrutacji, jeśli rekruter nie wypełnił notatki po rozmowie z tym kandydatem w tej rekrutacji.

Wejście reguły: bieżący status kandydata w rekrutacji oraz treść notatki rekrutera przypisanej do tego kandydata w tej rekrutacji. Wyjście: zmiana statusu jest dozwolona, gdy notatka jest wypełniona; blokowana, gdy notatka jest pusta. Reguła wyzwalana jest, gdy rekruter próbuje przesunąć kandydata do innego etapu na tablicy kanban — blokada jest twarda (operacja nie zostaje zapisana bez notatki).

## Access Control

**Uwierzytelnianie MVP:** użytkownik loguje się za pomocą adresu e-mail i hasła. Dostęp do jakichkolwiek danych systemu bez aktywnej sesji jest niedozwolony.

**Model uprawnień — RBAC z grupami bezpieczeństwa:**
- Administrator tworzy grupy bezpieczeństwa i przypisuje im dozwolone operacje.
- Użytkownicy są przypisywani do grup przez administratora.
- Operacja jest dostępna dla użytkownika, gdy należy do grupy posiadającej tę operację.

**Przykładowe grupy (konfiguracja — nie część schematu):**
- HR/Rekruter — pełne zarządzanie kandydatami, rekrutacjami i stanowiskami.
- Hiring Manager — podgląd statusu rekrutacji i przeszukiwanie bazy kandydatów (tylko odczyt).
- Administrator — zarządzanie grupami i użytkownikami.

**Niezalogowany użytkownik:** przekierowanie do ekranu logowania; żadne dane systemu nie są dostępne.

**Docelowo:** migracja do OAuth / logowania przez zewnętrznego dostawcę tożsamości (dostawca do ustalenia na etapie wyboru stosu technologicznego).

## Non-Goals

- **Brak integracji z zewnętrznymi systemami ATS** (Workable, Greenhouse, itp.) — system autonomiczny, bez importu/eksportu danych. Rationale: dodałoby znaczącą złożoność niepotrzebną dla wewnętrznego narzędzia organizacji.
- **Single-tenant** — system obsługuje jedną organizację. Brak multi-tenancy w MVP. Rationale: skalowanie do SaaS to osobna decyzja produktowa.
- **Brak publicznej strony ogłoszenia o pracę** — system nie generuje publicznych job postingów. Kandydaci są dodawani przez rekrutera, nie aplikują samodzielnie.
- **Brak powiadomień e-mail** — wyłączone z MVP świadomą decyzją podczas shapowania.
- **Brak wsparcia offline** — system wymaga aktywnego połączenia sieciowego.

## Open Questions

1. **Jaki jest szacunkowy QPS systemu?** — Nie określono podczas shapowania. Owner: użytkownik. Potrzebne do potwierdzenia wymogów infrastrukturalnych. Block: nie (PRD ważny bez tej wartości dla MVP w skali medium).
2. **Jaki jest szacunkowy wolumen danych?** — Nie określono podczas shapowania (liczba kandydatów, rekrutacji, rozmiar plików CV). Owner: użytkownik. Block: nie.
3. **Który zewnętrzny dostawca tożsamości dla OAuth?** — Opcje: Google Workspace lub Microsoft 365 (do ustalenia przy wyborze stosu technologicznego). Owner: etap 10x-tech-stack-selector. Block: nie (dotyczy roadmapy, nie MVP).
