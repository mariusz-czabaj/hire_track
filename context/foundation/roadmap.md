---
project: System wspomagający rekrutację
version: 2
status: draft
created: 2026-08-27
updated: 2026-09-06
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: ui-visual-redesign
milestone_seq: 2
milestone_status: open
---

# Roadmap: System wspomagający rekrutację

> Wygenerowano z `context/foundation/prd.md` (v1) + auto-zbadanego baseline'u kodu.
> Milestone M-2 wywodzi się z opisu wizualnego (referencyjny screenshot ATS) — patrz kotwice `MS-NN` w charterze.
> Edytuj w miejscu; archiwizuj przy pełnej regeneracji.
> Wycinki poniżej są uporządkowane wg kolejności zależności. Tabela "At a glance" to indeks.

## Milestone

**M-2: Spójny język wizualny aplikacji** — Status: open

- **Intent:** Zastąpić odziedziczony po starterze motyw "cosmic" (glass-morphism, wymuszony dark mode, kolory wklepane w ~250 miejscach) własnym systemem projektowym opartym na tokenach, wzorowanym na dostarczonym screenshocie referencyjnym ATS: jasna powierzchnia, stały sidebar z nawigacją, serifowy nagłówek strony, kolorowe kolumny kanbana z akcentem na kartach. Efektem ma być interfejs, w którym zmiana motywu to zmiana jednego pliku, a nie 35.
- **Source materials:** referencyjny screenshot ATS dostarczony przez użytkownika 2026-09-05; `context/changes/ui-redesign-foundation/research.md` (analiza obecnego UI); `context/changes/ui-redesign-foundation/design-brief.md` (wymagania A–G wyprowadzone ze screenshotu)
- **Done when:** każdy F-NN i S-NN poniżej ma status `done`, a poza tym: (a) w kodzie funkcyjnym nie ma literałów palety Tailwind ani `bg-cosmic` — kolory wyłącznie przez tokeny, (b) każdy ekran przechodzi WCAG 2.1 AA w obu motywach, (c) wszystkie 9 kotwic `data-testid` i zestaw testów E2E przechodzą.
- **Scope anchors:**
  - **MS-01:** Warstwa tokenów jest jedynym źródłem kolorów; motyw jasny i ciemny z przełącznikiem i persystencją wyboru.
  - **MS-02:** Powłoka aplikacji — stały sidebar z nawigacją, topbar z menu użytkownika, jeden `AppShell` zamiast powłoki kopiowanej w 7 plikach.
  - **MS-03:** Nagłówek rekrutacji — serifowy tytuł, badge statusu, wiersz metadanych z ikonami, menu akcji.
  - **MS-04:** Kanban — kolorowe pigułki nagłówków kolumn, karty z paskiem akcentu, deterministyczna paleta etapów.
  - **MS-05:** Przenoszenie kandydatów metodą przeciągnij-i-upuść, z zachowaniem wymuszonej notatki (FR-013).
  - **MS-06:** Widoki listowe (rekrutacje, kandydaci, administracja) w nowym języku wizualnym.
  - **MS-07:** Formularze, komunikaty błędów i potwierdzenia akcji na wspólnych prymitywach.
  - **MS-08:** Usunięcie powierzchni odziedziczonych po starterze (landing marketingowy, placeholderowy dashboard).
  - **MS-09:** WCAG 2.1 AA jako twarde kryterium odbioru, weryfikowane w obu motywach.

## Vision recap

Rekruterzy i hiring managerowie prowadzą rekrutacje bez centralnego narzędzia — statusy kandydatów żyją w arkuszach, historia poprzednich rekrutacji jest niedostępna. System ma zastąpić arkusze jednym źródłem prawdy: tablicą kanban per rekrutacja i bazą kandydatów przeszukiwalną przez historię wszystkich rekrutacji.

M-1 dowiózł ten flow funkcjonalnie. M-2 nadaje mu formę: dziś aplikacja wygląda jak starter, na którym została zbudowana, a nie jak narzędzie rekrutacyjne.

## North star

**S-10: Kanban w nowym języku wizualnym** — to najgęstszy ekran produktu i jednocześnie ten, który na screenshocie referencyjnym niesie najwięcej decyzji projektowych (kolory etapów, akcenty kart, rytm kolumn). Jeśli nowy system tokenów obroni się tutaj, obroni się wszędzie.

> "Gwiazda przewodnia" = najmniejszy kompletny wycinek funkcjonalności, który jeśli zadziała, dowodzi, że reszta produktu ma sens budować dalej — dlatego jest sekwencjonowana najwcześniej, jak tylko pozwalają na to jej zależności.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                                                                       | Prerequisites | Scope anchors | Status      |
| ---- | --------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------- | ------------- | ----------- |
| F-02 | design-system-foundation    | (foundation) warstwa tokenów, motyw jasny/ciemny z przełącznikiem, `AppShell` i skala typografii           | —             | MS-01, MS-02  | in-progress |
| S-08 | app-shell-navigation        | użytkownik porusza się po aplikacji stałym sidebarem i topbarem zamiast linkami "wstecz"                   | F-02          | MS-02, MS-08  | in-progress |
| S-09 | recruitment-header-metadata | rekruter widzi w nagłówku rekrutacji jej lokalizację, dział, typ zatrudnienia i datę otwarcia              | F-02, S-08    | MS-03         | in-progress |
| S-10 | kanban-visual-redesign      | rekruter czyta kanban po kolorze etapu — kolorowe nagłówki kolumn i karty z paskiem akcentu                | F-02, S-09    | MS-04         | new         |
| S-11 | kanban-drag-and-drop        | rekruter przeciąga kartę kandydata między kolumnami, wciąż z wymuszoną notatką                             | S-10          | MS-05         | new         |
| S-12 | list-views-redesign         | użytkownik przegląda listy rekrutacji, kandydatów i grup w nowym języku wizualnym, także na wąskim ekranie | F-02, S-08    | MS-06         | new         |
| S-13 | forms-feedback-redesign     | użytkownik dostaje spójne pola formularzy, komunikaty błędów i potwierdzenia udanych akcji                 | F-02          | MS-07         | new         |
| S-14 | accessibility-audit-wcag-aa | (weryfikacja) każdy ekran spełnia WCAG 2.1 AA w obu motywach                                               | S-08…S-13     | MS-09         | new         |

## Streams

Pomoc nawigacyjna — grupuje elementy dzielące ten sam łańcuch zależności. Kanoniczna kolejność wciąż żyje w grafie zależności poniżej; ta tabela to proponowana kolejność czytania po równoległych ścieżkach.

| Stream | Theme                   | Chain                                      | Note                                                                                                                                                                                     |
| ------ | ----------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Kanban (ścieżka główna) | `F-02` → `S-08` → `S-09` → `S-10` → `S-11` | Dominujący ciąg — prowadzi do north star i dalej do jedynej nowej funkcjonalności w tym milestonie (DnD).                                                                                |
| B      | Pozostałe powierzchnie  | `F-02` → `S-12`, `F-02` → `S-13`           | S-12 i S-13 nie zależą od siebie ani od kanbana — po F-02 (a S-12 dodatkowo po S-08) mogą iść równolegle z ścieżką A, osobnym agentem/branchem. Przy blokerze `time` to realna dźwignia. |
| C      | Domknięcie              | wszystko → `S-14`                          | Audyt dostępności jest z definicji ostatni — mierzy stan końcowy, nie pośredni.                                                                                                          |

## Baseline

Co już jest w kodzie na dzień `2026-09-05` (po domknięciu M-1, potwierdzone przez użytkownika).
Wycinki poniżej zakładają, że to jest obecne i NIE budują tego ponownie.

- **Frontend:** present — komplet ekranów M-1 (rekrutacje, kanban, kandydaci, profil, administracja) w Astro 6 + React 19, wszystkie wyspy `client:load`.
- **Warstwa prezentacji:** present, ale niespójna — tokeny shadcn zdefiniowane w `src/styles/global.css` i nieużywane (~10 wystąpień), nadpisane ręcznymi klasami motywu "cosmic" (~250 wystąpień w ~35 plikach). To jest przedmiot tego milestone'u.
- **Prymitywy UI:** partial — `button`, `card`, `badge`, `input`, `textarea`, `dialog`, `skeleton`, `file-input` (stock shadcn, nietknięte). Brak: `dropdown-menu`, `avatar`, `tooltip`, `separator`, toasty.
- **Nawigacja:** absent — `src/components/Topbar.astro` istnieje, ale jest importowany wyłącznie przez landing `Welcome.astro`; żaden ekran zalogowanego użytkownika nie ma chrome'u nawigacyjnego.
- **Stany asynchroniczne:** present — `useApiResource` daje każdemu ekranowi `loading | success | error | not-found`, skeletony odwzorowują docelowy układ. Brak warstwy potwierdzeń sukcesu.
- **Backend / API:** present — komplet endpointów domenowych z M-1. `KanbanBoardDto.recruitment` niesie tylko `id`, `title`, `status` (rozszerzenie w S-09).
- **Testy:** present — testy jednostkowe obok komponentów, integracyjne przy API, E2E w `tests/e2e/` (54× `getByText`, 44× `getByRole`, 37× `getByLabel`, 16× `getByTestId`, 8× `locator()`) oraz 9 kotwic `data-testid` w `src/`.
- **Dostępność:** partial — ARIA szczątkowa (9 plików), brak live regions, `ServerError` bez `role="alert"`; systemowe ryzyko kontrastu na `text-blue-100/40…/70`.
- **Deploy / infra:** present — bez zmian względem M-1.

## Foundations

### F-02: Fundament systemu projektowego — tokeny, motywy, powłoka

- **Outcome:** (foundation) istnieje warstwa tokenów będąca jedynym źródłem kolorów, promieni, cieni i skali typograficznej (nagłówek serifowy / UI sans); motyw jasny jest domyślny, ciemny dostępny przez przełącznik w topbarze z persystencją wyboru i poszanowaniem `prefers-color-scheme`; istnieje komponent `AppShell` przyjmujący nawigację, tytuł strony i treść, gotowy do podstawienia pod istniejące trasy.
- **Change ID:** design-system-foundation
- **Scope anchors:** MS-01, MS-02
- **Unlocks:** S-08, S-09, S-10, S-12, S-13 (każdy z nich konsumuje tokeny i/lub `AppShell`)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Konkretna paleta (odcień primary, skala szarości, rodzina serif dla nagłówków) nie jest podana — screenshot jest referencją kierunkową, nie specyfikacją. — Owner: user. Block: nie (propozycja powstaje na poziomie `/10x-plan`, do akceptacji przed implementacją).
- **Risk:** Sekwencjonowany jako pierwszy, bo każdy kolejny wycinek maluje po tych tokenach — zrobienie go później oznaczałoby przemalowanie tych samych 35 plików dwa razy. Zakres celowo ogranicza się do warstwy i powłoki: F-02 **nie** przestylowuje żadnego ekranu funkcyjnego, tylko dostarcza narzędzia. Kluczowe ryzyko to rozjazd dwóch motywów — decyzja o dark mode podnosi koszt każdego kolejnego wycinka o drugi przebieg weryfikacji kontrastu.
- **Status:** in-progress

## Slices

### S-08: Nawigacja aplikacji i usunięcie powierzchni startera

- **Outcome:** zalogowany użytkownik porusza się po aplikacji stałym sidebarem (Rekrutacje / Kandydaci / Administracja — ostatnia pozycja tylko przy operacji `group.manage`) i topbarem z menu użytkownika i wylogowaniem; sidebar chowa się poniżej breakpointu; `/` przekierowuje zalogowanych na `/recruitments`, a niezalogowanych na `/auth/signin`; marketingowy landing startera i placeholderowy `/dashboard` znikają.
- **Change ID:** app-shell-navigation
- **Scope anchors:** MS-02, MS-08
- **Prerequisites:** F-02 (`AppShell` i tokeny muszą istnieć, zanim podstawimy je pod trasy)
- **Parallel with:** S-13
- **Blockers:** —
- **Unknowns:**
  - Pole globalnego wyszukiwania widoczne na screenshocie referencyjnym jest **świadomie poza zakresem tej iteracji** (decyzja użytkownika 2026-09-05) — topbar powstaje bez niego. — Owner: user. Block: nie.
- **Risk:** Największa zmiana strukturalna w milestonie — dotyka wszystkich 7 plików `.astro` z powieloną powłoką naraz i usuwa trasy, więc `PROTECTED_ROUTES` w `src/middleware.ts` oraz nawigacyjne kroki w testach E2E muszą pójść w tym samym change'u. Sidebar zostaje w `.astro` (jak dzisiejszy `Topbar`), żeby nie wysyłać JS na chrome — wyjątkiem jest drobny island na chowanie sidebara i przełącznik motywu.
- **Status:** in-progress

### S-09: Nagłówek rekrutacji z metadanymi i menu akcji

- **Outcome:** rekruter otwierając rekrutację widzi serifowy tytuł z badge'em statusu, pod nim wiersz metadanych z ikonami (lokalizacja, dział, typ zatrudnienia, data otwarcia), link powrotny do listy oraz menu akcji "…" skupiające zmianę statusu i edycję etapów; "Dodaj kandydata" pozostaje wyróżnionym przyciskiem primary.
- **Change ID:** recruitment-header-metadata
- **Scope anchors:** MS-03
- **Prerequisites:** F-02, S-08 (nagłówek strony jest slotem `AppShell`)
- **Parallel with:** S-12, S-13
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Jedyny wycinek redesignu sięgający do backendu: `KanbanBoardDto.recruitment` niesie dziś tylko `id`, `title` i `status`, więc `/api/recruitments/[id]/board` trzeba rozszerzyć o `location`, `department`, `employmentType` i `openedAt` (pola istnieją w bazie i w `RecruitmentDto` — zmiana jest addytywna, ale wymaga testu integracyjnego). Drugie ryzyko to przeniesienie zmiany statusu do menu "…" — dziś to widoczny wprost zestaw pigułek z kotwicą `data-testid="status-control"`, którą trzeba przenieść dosłownie, a testy E2E dopisać o krok otwarcia menu. Wymaga instalacji prymitywu `dropdown-menu`.
- **Status:** in-progress

### S-10: Kanban w nowym języku wizualnym

- **Outcome:** rekruter widzi kolumny kanbana z pełnoszerokościowymi kolorowymi pigułkami nagłówków (nazwa etapu wersalikami + licznik), karty kandydatów na białym tle z paskiem akcentu w kolorze etapu, nazwiskiem i datą dodania; kolory etapów przydzielane są deterministycznie po `sortOrder` z cyklicznie zawijanej palety, więc działają także dla etapów zdefiniowanych własnoręcznie w S-03.
- **Change ID:** kanban-visual-redesign
- **Scope anchors:** MS-04
- **Prerequisites:** F-02, S-09 (kanban i jego nagłówek to jeden ekran — rozdzielenie ich na dwa change'y wymaga, żeby nagłówek był pierwszy)
- **Parallel with:** S-12, S-13
- **Blockers:** —
- **Unknowns:**
  - Zachowanie kanbana na wąskim ekranie: poziomy scroll (jak dziś i jak na screenshocie) czy widok listowy per etap. — Owner: user. Block: nie (rozstrzygane na poziomie `/10x-plan`).
- **Risk:** To gwiazda przewodnia M-2 — najgęstszy ekran, najwięcej decyzji projektowych. Główne ryzyko jest kontrastowe: biały tekst na pigułkach nagłówków musi przejść AA dla **każdego** koloru palety w **obu** motywach; odcienie bursztynowe i cyjanowe są tu najbardziej zagrożone i mogą wymusić ciemniejsze warianty lub ciemny tekst. Drugie ryzyko: kolor nie może być jedynym nośnikiem informacji o etapie — nazwa etapu na pigułce to zapewnia, ale pasek akcentu na karcie potrzebuje tekstowego odpowiednika dostępnego dla czytnika ekranu. Kotwice `data-testid="kanban-columns"` przenoszone dosłownie.
- **Status:** new

### S-11: Przeciąganie kart kandydatów między etapami

- **Outcome:** rekruter przenosi kandydata na inny etap przeciągając kartę myszą; upuszczenie otwiera dialog z notatką i dopiero jego potwierdzenie utrwala zmianę, więc reguła "brak notatki blokuje zmianę statusu" pozostaje nienaruszona; ta sama operacja jest wykonalna z klawiatury bez użycia przeciągania.
- **Change ID:** kanban-drag-and-drop
- **Scope anchors:** MS-05
- **Prerequisites:** S-10 (przeciąganie ma sens dopiero na docelowym układzie kolumn i kart)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy po nieudanym zapisie karta wraca na miejsce z komunikatem, czy zostaje w stanie optymistycznym do ponowienia. — Owner: team. Block: nie (rozstrzygane na poziomie `/10x-plan`).
- **Risk:** Jedyny wycinek M-2 wprowadzający nową funkcjonalność, a nie zmieniający wygląd — i jedyny dotykający reguły biznesowej z PRD (FR-013). Przeciąganie **nie może** stać się drogą na skróty omijającą notatkę: upuszczenie jest wyłącznie skrótem do otwarcia istniejącego `MoveCandidateDialog`, nigdy samodzielnym zapisem. Wymaga biblioteki DnD z obsługą klawiatury (przeciąganie samą myszą wykluczyłoby część użytkowników i złamałoby kryterium MS-09) oraz zachowania dotychczasowej ścieżki przez przycisk na karcie jako równorzędnej, nie zapasowej. Kotwica `data-testid="move-candidate-dialog"` i istniejące testy E2E ruchu kandydata muszą przejść bez zmian w warstwie asercji.
- **Status:** new

### S-12: Widoki listowe w nowym języku wizualnym

- **Outcome:** użytkownik przegląda listę rekrutacji (karty z metadanymi i badge'em statusu, wspólny komponent filtrów statusu), listę kandydatów (pole wyszukiwania w nowym stylu, zachowana podpowiedź zawężenia zamiast paginacji) oraz ekrany administracyjne — wszystkie na tokenach, wszystkie składające się poprawnie na wąskim ekranie.
- **Change ID:** list-views-redesign
- **Scope anchors:** MS-06
- **Prerequisites:** F-02, S-08 (listy renderują się wewnątrz `AppShell`)
- **Parallel with:** S-09, S-10, S-13
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Niskie ryzyko techniczne, wysokie ryzyko regresji testowej — to ekrany z największą liczbą asercji tekstowych w E2E, a kotwice `data-testid="candidate-list"` i stany puste (`No recruitments match this filter.`, `No recruitments are visible to you.`) muszą przetrwać co do znaku, jeśli nie zmieniamy ich świadomie. Dwie rzeczy do zachowania mimo restylingu: świadoma decyzja z S-06 o "cap-plus-hint" zamiast paginacji (nie wolno dorobić pagera) oraz duplikacja logiki filtrów w dwóch miejscach, którą ten wycinek ma skonsolidować w jeden komponent, a nie powielić po raz trzeci.
- **Status:** new

### S-13: Formularze, komunikaty błędów i potwierdzenia akcji

- **Outcome:** użytkownik wypełnia formularze (logowanie, rejestracja, nowa rekrutacja, dialogi) na jednym zestawie pól opartym o prymityw `input`; błędy prezentuje jeden, dostępny komponent komunikatu; udana akcja daje widoczne potwierdzenie zamiast cichego odświeżenia listy; banner konfiguracyjny przestaje być jasną wstawką z osobnego świata.
- **Change ID:** forms-feedback-redesign
- **Scope anchors:** MS-07
- **Prerequisites:** F-02
- **Parallel with:** S-08, S-09, S-10, S-12
- **Blockers:** —
- **Unknowns:**
  - Wybór mechanizmu potwierdzeń (toast globalny vs. komunikat inline przy akcji). — Owner: team. Block: nie (rozstrzygane na poziomie `/10x-plan`).
- **Risk:** `ServerError` jest **jedyną** powierzchnią błędu w całej aplikacji — jego zmiana dotyka każdego ekranu naraz, więc jest to jednocześnie najtańszy moment na dodanie `role="alert"` (dziś nieobecnego) i największe ryzyko regresji, jeśli asercje E2E opierają się na jego strukturze. Drugie: `FormField` ma własne stylowanie pola równoległe do `ui/input.tsx` — konsolidacja musi zachować ikonę wiodącą, przełącznik widoczności hasła i powiązanie `label`/`htmlFor`, na których stoi 37 lokatorów `getByLabel`. Przy okazji: `Banner.astro` zawiera polskie stringi ("Uwaga:", "Dokumentacja") łamiące regułę English-only z `context/foundation/lessons.md` — do naprawy w tym wycinku.
- **Status:** new

### S-14: Audyt dostępności WCAG 2.1 AA

- **Outcome:** (weryfikacja) każdy ekran aplikacji spełnia WCAG 2.1 AA w motywie jasnym i ciemnym: zmierzony kontrast tekstu i pigułek etapów, pełna obsługa z klawiatury (w tym przenoszenie kandydata), widoczny stan focus, komunikaty asynchroniczne ogłaszane czytnikowi ekranu; wynik audytu i ewentualne odstępstwa spisane w artefaktach change'u.
- **Change ID:** accessibility-audit-wcag-aa
- **Scope anchors:** MS-09
- **Prerequisites:** S-08, S-09, S-10, S-11, S-12, S-13 (audyt mierzy stan końcowy, nie pośredni)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** WCAG AA jest twardym kryterium odbioru M-2 (decyzja użytkownika 2026-09-05), więc ten wycinek może **cofnąć** decyzje kolorystyczne podjęte w F-02 i S-10 — dlatego każdy wcześniejszy wycinek ma mierzyć kontrast u siebie, a nie odkładać go tutaj. S-14 jest siecią bezpieczeństwa, nie jedyną bramką; jeśli wykryje systemowy problem palety, koszt poprawki rośnie z każdym już domkniętym wycinkiem. `eslint-plugin-jsx-a11y` jest w zależnościach — do potwierdzenia, czy jest faktycznie włączony w `eslint.config.js`, zanim się na nim oprzemy.
- **Status:** new

## Backlog Handoff

| Roadmap ID | Change ID                   | Suggested issue title                                    | Ready for `/10x-plan` | Notes                                                                      |
| ---------- | --------------------------- | -------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| F-02       | design-system-foundation    | Fundament systemu projektowego: tokeny, motywy, AppShell | yes                   | Uruchom `/10x-plan design-system-foundation` — rekomendowany następny krok |
| S-08       | app-shell-navigation        | Nawigacja aplikacji i usunięcie powierzchni startera     | no                    | Czeka na F-02                                                              |
| S-09       | recruitment-header-metadata | Nagłówek rekrutacji z metadanymi i menu akcji            | no                    | Czeka na F-02, S-08; obejmuje rozszerzenie `/api/recruitments/[id]/board`  |
| S-10       | kanban-visual-redesign      | Kanban w nowym języku wizualnym                          | no                    | Czeka na F-02, S-09 — north star M-2                                       |
| S-11       | kanban-drag-and-drop        | Przeciąganie kart kandydatów między etapami              | no                    | Czeka na S-10; jedyna nowa funkcjonalność w milestonie                     |
| S-12       | list-views-redesign         | Widoki listowe w nowym języku wizualnym                  | no                    | Czeka na F-02, S-08; może iść równolegle ze ścieżką kanbana                |
| S-13       | forms-feedback-redesign     | Formularze, komunikaty błędów i potwierdzenia akcji      | no                    | Czeka na F-02; może iść równolegle ze ścieżką kanbana                      |
| S-14       | accessibility-audit-wcag-aa | Audyt dostępności WCAG 2.1 AA                            | no                    | Czeka na wszystkie pozostałe wycinki M-2                                   |

## Open Roadmap Questions

1. **Jaka dokładnie paleta i jaki krój serifowy dla nagłówków?** — Owner: użytkownik. Block: nie (screenshot jest referencją kierunkową; konkretna propozycja powstaje w `/10x-plan design-system-foundation` i wymaga akceptacji przed implementacją — dotyczy F-02 i pośrednio S-10).
2. **Zachowanie kanbana poniżej breakpointu — poziomy scroll czy widok listowy per etap?** — Owner: użytkownik. Block: nie (dotyczy S-10; domyślnie poziomy scroll, zgodnie ze screenshotem i stanem obecnym).
3. **Czy globalne wyszukiwanie w topbarze wraca w kolejnym milestonie?** — Owner: użytkownik. Block: nie (świadomie wyłączone z M-2; endpoint `/api/candidates?q=` już istnieje, więc koszt późniejszego dołożenia jest niski).
4. **Jaki jest szacunkowy QPS systemu?** — Owner: użytkownik. Block: nie (przeniesione z M-1, wciąż informacyjne — dotyczy indeksów, nie gates żadnego wycinka M-2).
5. **Jaki jest szacunkowy wolumen danych (liczba kandydatów, rekrutacji, rozmiar plików CV)?** — Owner: użytkownik. Block: nie (przeniesione z M-1, informacyjne).
6. **Który zewnętrzny dostawca tożsamości dla docelowego OAuth (Google Workspace vs Microsoft 365)?** — Owner: poza zakresem tego milestone'u. Block: nie.

## Parked

- **Globalne wyszukiwanie w topbarze** — Why parked: świadoma decyzja użytkownika z 2026-09-05 — pole widoczne na screenshocie referencyjnym zostaje poza M-2; wyszukiwanie pozostaje na ekranie `/candidates`. Kandydat do kolejnego milestone'u.
- **Kolory etapów wybierane przez użytkownika** — Why parked: wymagałoby kolumny `color` w tabeli etapów, migracji, walidacji w API i color-pickera w `StageEditor` — to slice funkcjonalny, nie redesign. M-2 przydziela kolory deterministycznie po `sortOrder`.
- **`/dashboard` jako realny home rekrutera (moje rekrutacje, ostatnia aktywność)** — Why parked: to nowa funkcjonalność wymagająca własnych zapytań i decyzji produktowych; M-2 tylko usuwa placeholder i przekierowuje `/` na `/recruitments`.
- **Regresja wizualna (snapshot testing)** — Why parked: sensowna dopiero po ustabilizowaniu nowego języka wizualnego, czyli po domknięciu M-2.
- **Integracja z zewnętrznymi systemami ATS (Workable, Greenhouse, itp.)** — Why parked: PRD §Poza zakresem — system autonomiczny, świadoma redukcja złożoności dla narzędzia wewnętrznego.
- **Multi-tenancy (obsługa wielu organizacji)** — Why parked: PRD §Poza zakresem — single-tenant w MVP, skalowanie do SaaS to osobna decyzja produktowa.
- **Publiczna strona ogłoszenia o pracę** — Why parked: PRD §Poza zakresem — kandydaci dodawani przez rekrutera, nie aplikują samodzielnie.
- **Powiadomienia e-mail** — Why parked: PRD §Poza zakresem — świadomie wyłączone podczas shapowania.
- **Wsparcie offline** — Why parked: PRD §Poza zakresem — system wymaga aktywnego połączenia sieciowego.
- **Migracja do OAuth / logowania przez zewnętrznego dostawcę tożsamości** — Why parked: PRD §Access Control "Docelowo" — poza zakresem MVP, obecnie e-mail+hasło.

## Milestone History

- **M-1: Pierwszy używalny cykl pracy rekrutera** — opened 2026-08-27, closed 2026-09-05. Dowieziono komplet must-have flow z PRD v1: fundament danych i RLS (F-01), przeglądanie rekrutacji i kanban (S-01), tworzenie i status rekrutacji (S-02), własne etapy kanban (S-03), zarządzanie statusem kandydata z wymuszoną notatką (S-04), profil kandydata i CV z retencją (S-05), wyszukiwanie historii kandydata (S-06), administracja grupami bezpieczeństwa (S-07). Pokrycie: US-01, US-02, FR-001…FR-018 (w tym FR-001a, FR-013a). Zamknięte na 8/8 elementów `done`.

## Done

### M-1: Pierwszy używalny cykl pracy rekrutera (zamknięty 2026-09-05)

| ID   | Change ID                          | Outcome                                                                                                    | PRD refs                                                            | Status |
| ---- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| F-01 | core-recruitment-data-foundation   | (foundation) model danych + RLS dla rekrutacji, kandydatów i grup bezpieczeństwa                           | FR-001a, FR-007, FR-017, FR-018, Access Control, NFR-bezpieczeństwo | done   |
| S-01 | recruiter-views-kanban-board       | rekruter przegląda listę rekrutacji i otwiera rekrutację jako kanban kandydatów                            | US-01, FR-003, FR-004, FR-005, FR-010                               | done   |
| S-02 | recruiter-creates-recruitment      | rekruter tworzy nową rekrutację przypisaną do grupy bezpieczeństwa i zmienia jej status                    | FR-001, FR-001a, FR-002                                             | done   |
| S-03 | recruiter-customizes-kanban-stages | rekruter nadpisuje domyślne etapy kanban dla konkretnej rekrutacji                                         | FR-004                                                              | done   |
| S-04 | recruiter-manages-candidate-status | rekruter dodaje kandydata i przesuwa go przez etapy z wymaganą notatką (w tym cofnięcie statusu)           | FR-006, FR-008, FR-009, FR-013, Business Logic                      | done   |
| S-05 | candidate-profile-and-cv-upload    | rekruter otwiera profil kandydata i uploaduje CV z automatycznym usunięciem po 12 miesiącach               | FR-011, FR-012, FR-013a, NFR-retencja                               | done   |
| S-06 | candidate-history-search           | użytkownik przeszukuje bazę kandydatów po nazwisku i widzi pełną historię statusów z wszystkich rekrutacji | US-02, FR-014, FR-015, FR-016                                       | done   |
| S-07 | admin-manages-security-groups      | administrator tworzy grupy bezpieczeństwa, przypisuje operacje i zarządza członkostwem użytkowników        | FR-017, FR-018                                                      | done   |
