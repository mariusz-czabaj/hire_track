# Fundament systemu projektowego — tokeny, motywy, AppShell — Plan Brief

> Pełny plan: `context/changes/design-system-foundation/plan.md`
> Wymagania i decyzje: `context/changes/ui-redesign-foundation/design-brief.md`
> Analiza: `context/changes/ui-redesign-foundation/research.md`

## What & Why

Aplikacja ma dwie równoległe warstwy stylowania i wygrywa gorsza: tokeny shadcn są zdefiniowane i praktycznie nieużywane (~10 wystąpień), a kolory żyją jako literały palety Tailwind w ~250 miejscach w ~35 plikach. Skutek jest taki, że **motywu nie da się zmienić z jednego miejsca**. Ten wycinek odwraca tę zależność: dostarcza warstwę tokenową, dwumotywowość rozstrzyganą serwerowo i powłokę `AppShell` — jako narzędzia dla wycinków S-08…S-13.

## Starting Point

Ciemny motyw jest zaszyty w `src/layouts/Layout.astro:14`, jasny zestaw tokenów to martwy kod, a `bg-cosmic` z surowymi hexami stoi poza systemem tokenów. Sześć z ośmiu prymitywów w `src/components/ui/` to stock shadcn oparty na tokenach — przestawienie tokenów przestawia je automatycznie; `textarea` i `file-input` to własne komponenty z zaszytymi klasami cosmic, migrujące dopiero w S-13. W repo nie ma żadnych zasobów fontowych, a `jsx-a11y` mimo obecności w zależnościach **nie sprawdza ani jednego pliku `.tsx`** (potwierdzone empirycznie podczas planowania).

## Desired End State

Kolory, promienie, cienie i typografia pochodzą wyłącznie z tokenów. Użytkownik przełącza motyw jasny/ciemny, wybór przeżywa przeładowanie i nie ma mignięcia niewłaściwego motywu. Istnieje `AppShell` gotowy do podstawienia w S-08 oraz trasa `/dev/design-system`, która pokazuje całą paletę w obu motywach i **wylicza kontrast każdej pary**, oznaczając wynik wobec progu AA. Układ, treść i klasy ekranów produktowych pozostają nietknięte — nową paletę przejmują wyłącznie powierzchnie sterowane tokenami i nienadpisane (trzy dialogi, dwa badge, pole wyszukiwania kandydatów i kilkanaście przycisków), co jest zamierzonym skutkiem uruchomienia warstwy tokenowej.

## Key Decisions Made

| Decyzja               | Wybór                                                                      | Dlaczego                                                                                                     | Źródło         |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------- |
| Motyw                 | Jasny + ciemny z przełącznikiem                                            | Wymóg MS-01; jasny domyślny wg screenshotu referencyjnego                                                    | Design brief   |
| Rozstrzyganie motywu  | Cookie czytane w middleware, klasa renderowana serwerowo                   | `output: "server"` znaczy, że middleware biegnie na każdym żądaniu — zero FOUC i zero blokującego skryptu    | Plan           |
| Brak cookie           | Podążanie za `prefers-color-scheme`                                        | Trzy stany, nie dwa: brak wyboru ≠ motyw jasny                                                               | Plan           |
| Wariant `dark`        | Wieloregułowy `@custom-variant` obejmujący media query                     | Bez tego utility `dark:*` w prymitywach nie zadziałają przy preferencji systemowej; zweryfikowane kompilacją | Przegląd planu |
| Pomiar kontrastu      | W Fazie 1, przy powstawaniu palety                                         | Fazy 2–4 nie mogą budować na niezwalidowanych wartościach                                                    | Przegląd planu |
| Typografia            | Self-hostowany krój zmienny w `public/fonts` (rekomendacja: Fraunces, OFL) | Zero żądań do obcych domen; podzbiór `latin-ext` konieczny przez diakrytyki w danych kandydatów              | Plan           |
| Weryfikacja wycinka   | Trasa `/dev/design-system`, wyłączona w produkcji                          | Jedyny sposób zmierzenia kontrastu całej palety, zanim skonsumuje ją pięć kolejnych wycinków                 | Plan           |
| Stare klasy motywu    | Zostają do migracji ostatniego konsumenta                                  | Aplikacja pozostaje spójna i pokazywalna po każdym wycinku                                                   | Plan           |
| Nowe prymitywy shadcn | Instaluje je konsument, nie F-02                                           | Zero kodu bez konsumenta; każdy prymityw weryfikowany w użyciu                                               | Plan           |
| Poziom `jsx-a11y`     | `warn` teraz, `error` jako bramka S-14                                     | `error` zablokowałby lint na ~35 niezmigrowanych komponentach i zatrzymał cały milestone                     | Plan           |

## Scope

**W zakresie:** warstwa tokenów i paleta light-first; self-hostowany krój serifowy; rozstrzyganie motywu przez cookie + middleware; przełącznik motywu; `AppShell` ze slotami; strona podglądu systemu z miernikiem kontrastu; włączenie `jsx-a11y` dla `.tsx`.

**Poza zakresem:** przestylowanie jakiegokolwiek ekranu produktowego; usuwanie `bg-cosmic` i nadpisań glass-morphism; budowa nawigacji (S-08); instalacja nowych prymitywów shadcn; usunięcie landingu i `/dashboard` (S-08); naprawianie istniejących naruszeń dostępności; tokeny `--chart-*`.

## Architecture / Approach

Warstwa tokenowa dokładana jest **obok** istniejącej, nie zamiast niej — ekrany nadpisują tokeny literałami, więc przestawienie palety ich nie rusza. Dzięki temu każda faza jest wdrażalna niezależnie i nie zostawia aplikacji w stanie połowicznym.

Przepływ motywu: `cookie → src/middleware.ts → Astro.locals.theme → klasa na <html> → tokeny CSS`. Trzy bloki definicji tokenów (`:root` jasny, `@media (prefers-color-scheme: dark)` pod `:root:not(.light)`, oraz `.dark`) obsługują trzy stany: wybór jasny, wybór ciemny, brak wyboru. Zapis wyboru idzie przez `POST /api/preferences/theme`, wyłączony z bramki uwierzytelniania, żeby przełącznik działał na ekranie logowania.

## Phases at a Glance

| Faza                                  | Co dowozi                                                      | Główne ryzyko                                                                                 |
| ------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1. Tokeny, paleta i typografia        | Paleta light-first, tokeny cieni i fontów, self-hostowany krój | Kolor zdefiniowany tylko w jednym bloku motywu → niezdefiniowany token przy pierwszej wizycie |
| 2. Rozstrzyganie motywu i przełącznik | Cookie, odczyt w middleware, klasa serwerowa, kontrolka        | Endpoint pod `/api/` trafi w bramkę 401 i przełącznik przestanie działać dla niezalogowanych  |
| 3. `AppShell`                         | Powłoka ze slotami, skala kontenerów, landmarki                | Zły kontrakt slotów — konsumuje go pięć kolejnych wycinków, poprawka jest droga               |
| 4. Strona podglądu                    | Katalog tokenów i prymitywów + prezentacja wyników kontrastu   | Kod bez konsumenta produkcyjnego, wymaga utrzymania w kolejnych wycinkach                     |
| 5. Bramka dostępności                 | `jsx-a11y` dla `.tsx`, weryfikacja końcowa palety              | Zmiany z Faz 2–4 mogą naruszyć próg ustalony w Fazie 1                                        |

**Prerequisites:** brak — F-02 jest fundamentem M-2 i nie zależy od żadnego innego wycinka. Wymaga wyboru konkretnego kroju serifowego (rekomendacja w planie) i sprawdzenia jego licencji.

**Estimated effort:** ~2–3 sesje na 5 faz; Fazy 1 i 5 są sprzężone (pomiar może cofnąć paletę), więc warto je planować blisko siebie.

## Open Risks & Assumptions

- Pomiar kontrastu odbywa się w Fazie 1, więc paleta jest zwalidowana zanim skonsumują ją kolejne fazy; Faza 5 pozostaje weryfikacją stanu końcowego i wciąż może wykryć dryf.
- Rekomendowany krój (Fraunces) jest propozycją opartą na charakterze nagłówka ze screenshotu; podmiana na inny to zmiana jednego pliku i jednego tokenu, ale wymaga Twojej akceptacji przed wdrożeniem Fazy 1.
- `jsx-a11y` na poziomie `warn` ujawni naruszenia w ~35 niezmigrowanych komponentach. Ten wycinek świadomie ich nie naprawia — jeśli lista okaże się długa, warto to uwzględnić przy szacowaniu S-08…S-13.
- Strona podglądu jest kodem bez konsumenta produkcyjnego. Jeśli kolejne wycinki nie będą jej aktualizować, przestanie być wiarygodnym katalogiem — warto to zapisać jako oczekiwanie wobec S-08…S-13.

## Success Criteria (Summary)

- Użytkownik przełącza motyw, wybór przeżywa przeładowanie, a przy pierwszej wizycie aplikacja podąża za ustawieniem systemu — bez mignięcia niewłaściwego motywu.
- Każda para „tekst na tle" w obu motywach osiąga próg WCAG AA, potwierdzona liczbą, nie oceną wzrokową.
- Układ, treść i klasy ekranów produktowych są nietknięte, zmiany wyglądu mieszczą się w wyliczonej liście powierzchni tokenowych, a cały zestaw testów przechodzi bez zmian w asercjach.
