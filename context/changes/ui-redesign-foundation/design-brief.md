---
date: 2026-09-05
author: Mariusz Czabaj
topic: "Wymagania UI wyprowadzone z referencyjnego screenshotu ATS"
source: "Screenshot ATS dostarczony przez użytkownika 2026-09-05"
status: accepted
feeds: context/foundation/roadmap.md (milestone M-2: ui-visual-redesign)
---

# Design brief: redesign UI HireTrack

Wymagania wyprowadzone z referencyjnego screenshotu (widok "Floor Manager" — kanban
rekrutacyjny) zestawione ze stanem obecnym opisanym w `research.md`. Zaakceptowane przez
użytkownika 2026-09-05; zdekomponowane na wycinki F-02 i S-08…S-14 w `roadmap.md`.

## A. Fundament wizualny → F-02

| #   | Wymaganie                                                                                                                   | Stan dziś                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| A1  | Motyw jasny jako domyślny: tło chłodny off-white/lawendowy (~`#F1F2F7`), karty czysto białe                                 | `class="dark"` zaszyte w `Layout.astro:14`, tło `bg-cosmic` |
| A2  | Usunąć `bg-cosmic` i wszystkie nadpisania glass-morphism (`bg-white/10`, `border-white/10`, `backdrop-blur`)                | ~250 wystąpień w ~35 plikach                                |
| A3  | Kolory wyłącznie przez tokeny (`--background`, `--card`, `--primary`, `--muted-foreground`, `--border`)                     | tokeny ~10×, literały ~250×                                 |
| A4  | Primary = indigo (jak badge "LIVE" i aktywna pozycja nawigacji)                                                             | primary = neutralna czerń                                   |
| A5  | Usunąć gradientowe nagłówki `from-blue-200 to-purple-200 bg-clip-text`                                                      | 12 wystąpień                                                |
| A6  | Typografia dwupoziomowa: nagłówek strony serif bold ~40px, UI sans, etykiety kolumn uppercase 11–12px bold z letter-spacing | jeden krój, brak skali                                      |
| A7  | Skala promieni: karty ~10px, pigułki i badge pełne zaokrąglenie                                                             | `--radius: 0.625rem` do potwierdzenia                       |
| A8  | Cienie zamiast obramowań na kartach                                                                                         | karty mają border `white/10`                                |

## B. Powłoka aplikacji → F-02 (AppShell), S-08 (nawigacja)

| #   | Wymaganie                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Stały lewy sidebar (~260–280px, białe tło) z nazwą produktu na górze                                                                                                  |
| B2  | Nawigacja jako pigułki: aktywna = jasnolawendowe tło + indigo bold; nieaktywne szare. Pozycje: Recruitments / Candidates / Admin (ostatnia tylko przy `group.manage`) |
| B3  | Topbar: przycisk chowania sidebara, po prawej ikona pomocy i awatar                                                                                                   |
| B4  | Menu użytkownika pod awatarem: e-mail + wylogowanie                                                                                                                   |
| B5  | Jeden `AppShell` zastępujący powłokę kopiowaną w 7 plikach `.astro`; jednolita szerokość kontenera                                                                    |
| B6  | Sidebar w `.astro`, nie React — bez JS na chrome (wyjątek: island na collapse i przełącznik motywu)                                                                   |
| B7  | `Welcome.astro` i placeholderowy `dashboard.astro` usunięte; `/` przekierowuje wg stanu zalogowania                                                                   |

## C. Nagłówek rekrutacji → S-09

| #   | Wymaganie                                                                           | Uwaga                                                                                                                      |
| --- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| C1  | Link powrotny "‹ Job postings" w kolorze primary, nad tytułem                       | dziś szary tekst                                                                                                           |
| C2  | Serifowy tytuł + badge statusu obok                                                 | `STATUS_PRESENTATION` mapuje się 1:1, wystarczy przestylować                                                               |
| C3  | Wiersz metadanych z ikonami: lokalizacja / dział / typ zatrudnienia / data otwarcia | **wymaga rozszerzenia** `/api/recruitments/[id]/board` — `KanbanBoardDto.recruitment` niesie tylko `id`, `title`, `status` |
| C4  | Menu "…" po prawej z akcjami rekrutacji                                             | dziś akcje leżą luzem w jednym flex-row; "Add candidate" zostaje przyciskiem primary                                       |
| C5  | Wymaga instalacji prymitywu `dropdown-menu`                                         | dziś brak                                                                                                                  |

## D. Kanban → S-10 (wygląd), S-11 (przeciąganie)

| #   | Wymaganie                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Nagłówek kolumny jako pełnoszerokościowa kolorowa pigułka: uppercase, bold, biały tekst, licznik w nawiasie                                                                      |
| D2  | Każdy etap ma własny kolor — deterministyczna paleta indeksowana `sortOrder`, cyklicznie zawijana (etapy są konfigurowalne per rekrutacja, więc mapa po nazwach jest wykluczona) |
| D3  | Kolorowy pasek akcentu na lewej krawędzi karty, w kolorze etapu                                                                                                                  |
| D4  | Układ karty: nazwisko bold po lewej, dwuliniowo "Applied" + data po prawej, mniejszą szarą czcionką                                                                              |
| D5  | Kolumny bez tła — same karty na tle strony                                                                                                                                       |
| D6  | Poziomy scroll z widocznym paskiem i podglądem ucinanej kolejnej kolumny                                                                                                         |
| D7  | Skeletony do przepisania (dziś wymuszają `bg-white/10`)                                                                                                                          |
| D8  | Puste kolumny: zachować "No candidates" w przerywanej ramce, przestylowane                                                                                                       |
| D9  | Przeciąganie kart między kolumnami; upuszczenie otwiera `MoveCandidateDialog` — notatka pozostaje wymuszona (FR-013), przeciąganie nigdy nie zapisuje samo                       |

## E. Pozostałe ekrany → S-12 (listy), S-13 (formularze i komunikaty)

| #   | Wymaganie                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------ |
| E1  | Lista rekrutacji: białe karty, wiersz metadanych z ikonami, badge po prawej; **dodać składanie na mobile**               |
| E2  | Filtry statusu: jeden komponent segmentowany zamiast powielonej logiki `cn()` w dwóch miejscach                          |
| E3  | Lista kandydatów: pole wyszukiwania w nowym stylu; zachować "cap-plus-hint" zamiast paginacji (decyzja z S-06)           |
| E4  | `FormField`: porzucić własny `inputBase` na rzecz `ui/input.tsx` — jeden styl pola dla auth i aplikacji                  |
| E5  | `ServerError`: token `destructive` + `role="alert"`                                                                      |
| E6  | `Banner.astro`: literalne jasne hexy i polskie stringi ("Uwaga:", "Dokumentacja") — do przepisania na tokeny i angielski |
| E7  | Ekrany auth: biała karta na jasnym tle zamiast glass-morphism                                                            |
| E8  | Potwierdzenia udanych akcji — dziś sukces daje wyłącznie cichy refetch                                                   |

## F. Dostępność i responsywność → kryterium każdego wycinka, weryfikacja w S-14

| #   | Wymaganie                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------- |
| F1  | Nowa skala szarości mierzona raz, na poziomie tokenu `--muted-foreground` (dziś systemowe ryzyko na `text-blue-100/40…/70`) |
| F2  | Kolory etapów muszą dawać wystarczający kontrast dla tekstu na pigułce nagłówka — bursztyn i cyjan najbardziej zagrożone    |
| F3  | Kolor nie może być jedynym nośnikiem informacji o etapie — pasek akcentu karty potrzebuje tekstowego odpowiednika           |
| F4  | Live regions dla wyników asynchronicznych (dziś brak)                                                                       |
| F5  | Kanban poniżej breakpointu: poziomy scroll (domyślnie) vs widok listowy — otwarte                                           |
| F6  | Sidebar chowa się poniżej breakpointu                                                                                       |
| F7  | Pełna obsługa z klawiatury, w tym przenoszenie kandydata bez przeciągania                                                   |

## G. Ograniczenia, które implementacja musi uszanować

1. **9 kotwic `data-testid`** w `src/` (`kanban-columns`, `status-control`, `add-candidate-trigger`, `add-candidate-dialog`, `move-candidate-dialog`, `stage-editor-trigger`, `stage-editor-dialog`, `stages-locked-message`, `candidate-list`) — przenieść dosłownie do nowego markupu.
2. **Testy E2E**: 54× `getByText`, 44× `getByRole`, 37× `getByLabel`, 16× `getByTestId`, 8× `locator()`. Każda zmiana widocznego tekstu wymaga aktualizacji testów w tym samym change'u; to samo dotyczy `*.test.tsx` obok komponentów.
3. **English-only** (`context/foundation/lessons.md`) — wszystkie nowe stringi UI po angielsku.
4. **Nowe prymitywy do instalacji**: `dropdown-menu`, `avatar`, `tooltip`, `separator`, mechanizm toastów.
5. **Reguła biznesowa FR-013** (brak notatki blokuje zmianę statusu) jest nienaruszalna — dotyczy w szczególności przeciągania kart.

## Decyzje podjęte 2026-09-05

| Pytanie                 | Decyzja                             | Konsekwencja                                                                                                            |
| ----------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Motyw                   | **Jasny + ciemny z przełącznikiem** | Przełącznik w topbarze, persystencja wyboru, `prefers-color-scheme`; każdy wycinek weryfikuje kontrast w dwóch paletach |
| Wyszukiwarka w topbarze | **Poza tą iteracją**                | Topbar bez pola wyszukiwania; wyszukiwanie zostaje na `/candidates`. Zaparkowane                                        |
| Kolory etapów           | **Auto po `sortOrder`**             | Zero zmian w schemacie bazy i `StageEditor`; wybór koloru przez użytkownika zaparkowany                                 |
| Metadane na `/board`    | **W zakresie redesignu (S-09)**     | Rozszerzenie `KanbanBoardDto` o `location`, `department`, `employmentType`, `openedAt`                                  |
| Przeciąganie kart       | **Tak, dodajemy (S-11)**            | Wymaga biblioteki DnD z obsługą klawiatury; upuszczenie otwiera dialog z notatką, nie zapisuje samo                     |
| Landing i `/dashboard`  | **Usuwamy oba**                     | `/` przekierowuje wg stanu zalogowania; aktualizacja `PROTECTED_ROUTES` i testów                                        |
| WCAG 2.1 AA             | **Twarde kryterium odbioru**        | Mierzone w każdym wycinku, zweryfikowane całościowo w S-14                                                              |
| Kolejność               | **Cały M-1 jest `done`**            | Redesign jako osobny milestone M-2; brak konfliktów z trwającą pracą                                                    |
