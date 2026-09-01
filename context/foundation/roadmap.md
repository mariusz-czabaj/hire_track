---
project: System wspomagający rekrutację
version: 1
status: draft
created: 2026-08-27
updated: 2026-09-01
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: first-recruiter-workflow-mvp
milestone_seq: 1
milestone_status: open
---

# Roadmap: System wspomagający rekrutację

> Wygenerowano z `context/foundation/prd.md` (v1) + auto-zbadanego baseline'u kodu.
> Edytuj w miejscu; archiwizuj przy pełnej regeneracji.
> Wycinki poniżej są uporządkowane wg kolejności zależności. Tabela "Podsumowanie" to indeks.

## Milestone

**M-1: Pierwszy używalny cykl pracy rekrutera** — Status: open

- **Intent:** Dowieźć cały ścieżkowy must-have flow z PRD — logowanie, przeglądanie i tworzenie rekrutacji, zarządzanie kandydatami na kanbanie z wymuszoną notatką, profil kandydata z CV, wyszukiwanie historii kandydata i administrację grupami bezpieczeństwa — czyli komplet Kryteriów sukcesu (Primary) z PRD.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** każdy F-NN i S-NN poniżej ma status `done`.
- **Scope anchors:** US-01, US-02, FR-001 do FR-018 (w tym FR-001a, FR-013a).

## Vision recap

Rekruterzy i hiring managerowie prowadzą rekrutacje bez centralnego narzędzia — statusy kandydatów żyją w arkuszach, historia poprzednich rekrutacji jest niedostępna. System ma zastąpić arkusze jednym źródłem prawdy: tablicą kanban per rekrutacja i bazą kandydatów przeszukiwalną przez historię wszystkich rekrutacji.

## North star

**S-01: Rekruter przegląda listę rekrutacji i otwiera rekrutację jako tablicę kanban kandydatów** — to najmniejszy kawałek end-to-end, który dowodzi, że produkt rozwiązuje główny ból z PRD (US-01, Kryterium sukcesu Primary).

> "Gwiazda przewodnia" = najmniejszy kompletny wycinek funkcjonalności, który jeśli zadziała, dowodzi, że reszta produktu ma sens budować dalej — dlatego jest sekwencjonowana najwcześniej, jak tylko pozwalają na to jej zależności.

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
|---|---|---|---|---|---|
| F-01 | core-recruitment-data-foundation | (foundation) model danych + RLS dla rekrutacji, kandydatów i grup bezpieczeństwa | — | FR-001a, FR-007, FR-017, FR-018, Access Control, NFR-bezpieczeństwo | in-progress |
| S-01 | recruiter-views-kanban-board | rekruter przegląda listę rekrutacji i otwiera rekrutację jako kanban kandydatów | F-01 | US-01, FR-003, FR-004, FR-005, FR-010 | in-progress |
| S-02 | recruiter-creates-recruitment | rekruter tworzy nową rekrutację przypisaną do grupy bezpieczeństwa i zmienia jej status | F-01, S-01 | FR-001, FR-001a, FR-002 | in-progress |
| S-03 | recruiter-customizes-kanban-stages | rekruter nadpisuje domyślne etapy kanban dla konkretnej rekrutacji | F-01, S-01 | FR-004 | in-progress |
| S-04 | recruiter-manages-candidate-status | rekruter dodaje kandydata i przesuwa go przez etapy z wymaganą notatką (w tym cofnięcie statusu) | S-01, S-02 | FR-006, FR-008, FR-009, FR-013, Business Logic | in-progress |
| S-05 | candidate-profile-and-cv-upload | rekruter otwiera profil kandydata i uploaduje CV z automatycznym usunięciem po 12 miesiącach | S-04 | FR-011, FR-012, FR-013a, NFR-retencja | proposed |
| S-06 | candidate-history-search | użytkownik przeszukuje bazę kandydatów po nazwisku i widzi pełną historię statusów z wszystkich rekrutacji | S-04, F-01 | US-02, FR-014, FR-015, FR-016 | proposed |
| S-07 | admin-manages-security-groups | administrator tworzy grupy bezpieczeństwa, przypisuje operacje i zarządza członkostwem użytkowników | F-01 | FR-017, FR-018 | proposed |

## Streams

Pomoc nawigacyjna — grupuje elementy dzielące ten sam łańcuch zależności. Kanoniczna kolejność wciąż żyje w grafie zależności poniżej; ta tabela to proponowana kolejność czytania po równoległych ścieżkach.

| Stream | Theme | Chain | Note |
|---|---|---|---|
| A | Główna pętla rekrutera | `F-01` → `S-01` → `S-02` → `S-03` → `S-04` → `S-05` → `S-06` | S-05 i S-06 mogą iść równolegle po S-04 (nie zależą od siebie nawzajem); to dominujący ciąg must-have — sekwencjonowany pierwszy zgodnie z celem `speed`. |
| B | Administracja i uprawnienia | `F-01` → `S-07` | Niezależny od głównej pętli — S-07 potrzebuje tylko F-01, więc może iść równolegle z S-01…S-06 (przy `top_blocker: time` to realna dźwignia — osobny agent/branch może go dowozić równocześnie). |

## Baseline

Co już jest w kodzie na dzień `2026-08-27` (auto-zbadane + potwierdzone przez użytkownika).
Fundamenty poniżej zakładają, że to jest obecne i NIE skafoldują tego ponownie.

- **Frontend:** present — szkielet Astro 6 + React 19 (`src/pages/dashboard.astro`, `src/pages/index.astro`, komponenty UI w `src/components/ui/`).
- **Backend / API:** partial — endpointy auth (`src/pages/api/auth/{signin,signup,signout}.ts`); brak endpointów domenowych (rekrutacje, kandydaci).
- **Data:** absent — brak `supabase/migrations`, brak schematu domenowego.
- **Auth:** partial — logowanie e-mail+hasło działa (`src/lib/supabase.ts`, `src/middleware.ts` chroni `/dashboard`); RBAC z grupami (FR-017/018) niezaimplementowane.
- **Deploy / infra:** present — `wrangler.jsonc` skonfigurowany pod Cloudflare Workers, połączenie z Supabase aktywne (`context/deployment/deploy-plan.md`).
- **Observability:** absent — brak biblioteki logowania/error trackingu poza wbudowanym Cloudflare observability.

## Foundations

### F-01: Fundament danych i RLS — rekrutacje, kandydaci, grupy bezpieczeństwa

- **Outcome:** (foundation) istnieje schemat Postgres (rekrutacje, kandydaci, powiązanie kandydat-rekrutacja ze statusem i datą dodania, grupy bezpieczeństwa, członkostwo użytkownik-grupa, domyślny zestaw etapów kanban) wraz z politykami RLS ograniczającymi widoczność rekrutacji do przypisanych grup bezpieczeństwa.
- **Change ID:** core-recruitment-data-foundation
- **PRD refs:** FR-001a (scoping grupowy), FR-007 (współdzielony profil kandydata), FR-017, FR-018 (model danych pod grupy — UI w S-07), Access Control, NFR (dane kandydatów niedostępne nieuprawnionym)
- **Unlocks:** S-01, S-02, S-04 (model współdzielonego profilu kandydata), S-07 (model grup, na którym stawia UI administracyjne)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sekwencjonowany jako pierwszy, bo praktycznie każdy wycinek zależy od jakiegoś podzbioru tego schematu (Baseline: Data = absent) — zrobienie tego później oznaczałoby przebudowę RLS pod istniejące dane. Zakres celowo minimalny: tylko tabele i polityki potrzebne pod S-01/S-02/S-07, bez pełnej logiki notatek czy CV (te dochodzą wraz z S-04/S-05).
- **Status:** in-progress

## Slices

### S-01: Rekruter przegląda listę rekrutacji i otwiera rekrutację jako kanban kandydatów

- **Outcome:** rekruter (i hiring manager, tylko odczyt) loguje się, widzi listę rekrutacji z filtrowaniem po statusie i otwiera rekrutację jako tablicę kanban kandydatów pogrupowanych po etapach, z licznikiem per kolumna i datą dodania na każdej karcie.
- **Change ID:** recruiter-views-kanban-board
- **PRD refs:** US-01, FR-003, FR-004 (tylko domyślny zestaw etapów), FR-005, FR-010
- **Prerequisites:** F-01; external state: zasiane dane testowe (rekrutacja przypisana do grupy bezpieczeństwa, kandydaci na etapach, użytkownik testowy będący członkiem tej grupy).
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:**
  - Jaki dokładnie zakres ma widzieć Hiring Manager (read-only) vs Rekruter (edycja) na tym samym widoku, zanim S-07 dostarczy pełny model operacja→grupa? — Owner: user. Block: nie (F-01 startuje z grubszym podziałem ról, S-07 doprecyzowuje).
- **Risk:** To jest gwiazda przewodnia — sekwencjonowana najwcześniej jak pozwala F-01, mimo że tworzenie rekrutacji (FR-001) jest osobnym wycinkiem (S-02); używa zasianych danych, żeby nie czekać na S-02.
- **Status:** in-progress

### S-02: Rekruter tworzy i zarządza statusem rekrutacji

- **Outcome:** rekruter tworzy nową rekrutację ze stanowiskiem i metadanymi (lokalizacja, dział, typ zatrudnienia, data otwarcia), przypisuje co najmniej jedną grupę bezpieczeństwa, oraz ustawia/zmienia jej status (Draft / Live / Closed).
- **Change ID:** recruiter-creates-recruitment
- **PRD refs:** FR-001, FR-001a, FR-002
- **Prerequisites:** F-01, S-01 (współdzieli widok listy/szczegółu rekrutacji)
- **Parallel with:** S-03, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Bez tego wycinka S-01 działa tylko na zasianych danych — to jest krok, który czyni produkt realnie używalnym (rekruter sam zakłada rekrutacje), stąd sekwencjonowany zaraz po north star.
- **Status:** in-progress

### S-03: Rekruter dostosowuje etapy kanban per rekrutacja

- **Outcome:** rekruter nadpisuje globalny domyślny zestaw etapów kanban własnym zestawem dla konkretnej rekrutacji (różne stanowiska — np. tech vs. sprzedaż — mają różne procesy).
- **Change ID:** recruiter-customizes-kanban-stages
- **PRD refs:** FR-004 (część "nadpisanie per rekrutacja")
- **Prerequisites:** F-01, S-01 (kanban musi już renderować się z domyślnych etapów)
- **Parallel with:** S-02, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Niski — czysto addytywna zmiana nad istniejącym mechanizmem etapów z F-01/S-01; sekwencjonowana po S-01, bo bez renderowania kanbana nie ma czego nadpisywać.
- **Status:** in-progress

### S-04: Rekruter zarządza statusem kandydata z wymaganą notatką

- **Outcome:** rekruter dodaje kandydata do rekrutacji i przesuwa go między etapami na kanbanie; system blokuje zmianę statusu, jeśli notatka po rozmowie z tym kandydatem w tej rekrutacji jest pusta; rekruter może też cofnąć/poprawić status.
- **Change ID:** recruiter-manages-candidate-status
- **PRD refs:** FR-006, FR-008, FR-009, FR-013, Business Logic (blokada zmiany statusu bez notatki)
- **Prerequisites:** S-01 (kanban do przesuwania kart), S-02 (realna rekrutacja do której dodaje się kandydatów)
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Reguła biznesowa (blokada bez notatki) jest w PRD w pełni deterministyczna — niskie ryzyko niejednoznaczności; główne ryzyko to UX blokady (jak komunikować brak notatki), do rozstrzygnięcia na poziomie `/10x-plan`.
- **Status:** in-progress

### S-05: Profil kandydata i upload CV z retencją

- **Outcome:** użytkownik otwiera profil kandydata z danymi osobowymi; rekruter uploaduje plik CV (PDF/DOCX) do profilu; plik CV jest automatycznie i trwale usuwany 12 miesięcy po dodaniu, bez naruszenia profilu ani historii statusów.
- **Change ID:** candidate-profile-and-cv-upload
- **PRD refs:** FR-011, FR-012, FR-013a, NFR (retencja danych / niezawodność uploadu)
- **Prerequisites:** S-04 (kandydat musi już istnieć w kontekście rekrutacji)
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:**
  - Maksymalny rozmiar pliku CV i dokładny mechanizm harmonogramowania usuwania (np. scheduled job / cron) nie są określone w PRD — decyzja implementacyjna. — Owner: team. Block: nie (rozstrzygane na poziomie `/10x-plan`).
- **Risk:** Guardrail PRD "upload CV musi być niezawodny — utrata pliku jest niedopuszczalna" podnosi poprzeczkę weryfikacji tego wycinka; retencja (FR-013a) dodaje wymóg schedulera, którego dotąd nie ma w Baseline (Observability/infra absent dla tego typu zadań).
- **Status:** proposed

### S-06: Wyszukiwanie historii kandydata w bazie

- **Outcome:** użytkownik przechodzi do widoku "Kandydaci", wyszukuje po imieniu/nazwisku i widzi kandydata wraz z listą wszystkich rekrutacji, w których brał udział, z pełnym logiem zmian statusów per rekrutacja.
- **Change ID:** candidate-history-search
- **PRD refs:** US-02, FR-014, FR-015, FR-016
- **Prerequisites:** S-04 (potrzebne realne zmiany statusów do zalogowania historii), F-01 (współdzielony profil kandydata między rekrutacjami)
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** To drugi filar Kryterium sukcesu (Primary) obok north star — udowadnia wartość współdzielonego profilu kandydata (FR-007); sekwencjonowany zaraz po tym, jak S-04 zacznie generować realną historię statusów do przeszukania.
- **Status:** proposed

### S-07: Administrator zarządza grupami bezpieczeństwa i użytkownikami

- **Outcome:** administrator tworzy grupy bezpieczeństwa, przypisuje im dozwolone operacje, oraz dodaje/usuwa użytkowników z grup.
- **Change ID:** admin-manages-security-groups
- **PRD refs:** FR-017, FR-018
- **Prerequisites:** F-01 (model grup i członkostwa musi już istnieć)
- **Parallel with:** S-01, S-02, S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Nie blokuje głównej pętli rekrutera (S-01…S-06 działają na grupach zasianych ręcznie/manualnie przez F-01), więc przy celu `speed` i blokerze `time` jest sekwencjonowany później — ale to wciąż wycinek must-have, nie Parked, i może być dowożony równolegle przez osobnego agenta/branch od razu po F-01.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
|---|---|---|---|---|
| F-01 | core-recruitment-data-foundation | Fundament danych i RLS: rekrutacje, kandydaci, grupy bezpieczeństwa | yes | Uruchom `/10x-plan core-recruitment-data-foundation` — rekomendowany następny krok |
| S-01 | recruiter-views-kanban-board | Rekruter przegląda listę rekrutacji i kanban kandydatów | no | Czeka na F-01 |
| S-02 | recruiter-creates-recruitment | Rekruter tworzy i zarządza statusem rekrutacji | no | Czeka na F-01, S-01 |
| S-03 | recruiter-customizes-kanban-stages | Rekruter nadpisuje etapy kanban per rekrutacja | no | Czeka na F-01, S-01 |
| S-04 | recruiter-manages-candidate-status | Rekruter zarządza statusem kandydata z wymaganą notatką | no | Czeka na S-01, S-02 |
| S-05 | candidate-profile-and-cv-upload | Profil kandydata i upload CV z retencją 12 miesięcy | no | Czeka na S-04 |
| S-06 | candidate-history-search | Wyszukiwanie historii kandydata w bazie | no | Czeka na S-04, F-01 |
| S-07 | admin-manages-security-groups | Administrator zarządza grupami bezpieczeństwa i użytkownikami | no | Czeka na F-01; może iść równolegle z S-01…S-06 |

## Open Roadmap Questions

1. **Jaki jest szacunkowy QPS systemu?** — Owner: użytkownik. Block: brak (informacyjne — dotyczy F-01 przy projektowaniu indeksów, nie blokuje żadnego S-NN).
2. **Jaki jest szacunkowy wolumen danych (liczba kandydatów, rekrutacji, rozmiar plików CV)?** — Owner: użytkownik. Block: brak (informacyjne — dotyczy F-01 i limitu rozmiaru pliku w S-05).
3. **Który zewnętrzny dostawca tożsamości dla docelowego OAuth (Google Workspace vs Microsoft 365)?** — Owner: poza zakresem tego milestone'u (dotyczy przyszłej migracji z e-mail+hasło). Block: brak — nie gates żadnego S-NN w tym milestone.

## Parked

- **Integracja z zewnętrznymi systemami ATS (Workable, Greenhouse, itp.)** — Why parked: PRD §Poza zakresem — system autonomiczny, świadoma redukcja złożoności dla narzędzia wewnętrznego.
- **Multi-tenancy (obsługa wielu organizacji)** — Why parked: PRD §Poza zakresem — single-tenant w MVP, skalowanie do SaaS to osobna decyzja produktowa.
- **Publiczna strona ogłoszenia o pracę** — Why parked: PRD §Poza zakresem — kandydaci dodawani przez rekrutera, nie aplikują samodzielnie.
- **Powiadomienia e-mail** — Why parked: PRD §Poza zakresem — świadomie wyłączone podczas shapowania.
- **Wsparcie offline** — Why parked: PRD §Poza zakresem — system wymaga aktywnego połączenia sieciowego.
- **Migracja do OAuth / logowania przez zewnętrznego dostawcę tożsamości** — Why parked: PRD §Access Control "Docelowo" — poza zakresem MVP, obecnie e-mail+hasło.

## Milestone History

(brak — to pierwszy milestone)

## Done

(brak jeszcze ukończonych wycinków)
