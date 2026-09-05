# Fundament systemu projektowego — tokeny, motywy, AppShell — Implementation Plan

## Overview

Zastąpić odziedziczoną po starterze warstwę prezentacji własnym systemem projektowym: tokenami będącymi jedynym źródłem kolorów, promieni, cieni i typografii, motywem jasnym i ciemnym rozstrzyganym serwerowo z persystencją wyboru, oraz komponentem `AppShell` definiującym powłokę strony. F-02 dostarcza **wyłącznie narzędzia** — nie przestylowuje żadnego ekranu produktowego. Konsumują je wycinki S-08…S-13.

## Current State Analysis

Aplikacja ma dziś dwie równoległe warstwy stylowania i wygrywa ta gorsza.

- **Tokeny istnieją i są nieużywane.** `src/styles/global.css:1-120` definiuje komplet tokenów shadcn (`--background`, `--card`, `--primary`, `--muted-foreground`, `--border`, plus rodziny `--chart-*` i `--sidebar-*`) dla `:root` i `.dark`, wpięty w Tailwind 4 przez `@theme inline`. W kodzie funkcyjnym tokeny pojawiają się ~10 razy.
- **Kolory są literałami.** Ekrany nadpisują tokeny ręcznymi klasami: `bg-white/` ×81, `text-blue-100` ×72, `border-white/` ×56, `text-purple-` ×23, `bg-purple-` ×17, `bg-cosmic` ×14, gradientowy nagłówek ×12 — łącznie ~250 wystąpień w ~35 plikach.
- **Ciemny motyw jest wymuszony.** `src/layouts/Layout.astro:14` renderuje `<html lang="en" class="dark">`. Jasny zestaw tokenów jest martwym kodem, przełącznika nie ma.
- **`bg-cosmic` stoi poza systemem.** `src/styles/global.css:121-124` definiuje `@utility bg-cosmic` z surowymi hexami (`#0a0e1a`, `#0f1529`) — nie jest świadomy motywu i nie da się go przetematyzować.
- **Wariant `dark` jest wyłącznie klasowy.** `@custom-variant dark (&:is(.dark *))` reaguje tylko na klasę; preferencja systemowa nie ma dziś żadnego wpływu.
- **Brak jakiejkolwiek typografii.** W `src/` nie ma ani jednego `@font-face`, `font-family` czy `--font-*`. `public/` zawiera tylko `favicon.png` i `template.png`.
- **`jsx-a11y` nie sprawdza Reacta.** `eslint.config.js` ładuje `eslintPluginAstro.configs["flat/jsx-a11y-recommended"]`, którego 34 reguły żyją w namespace `astro/jsx-a11y/*`. Empirycznie potwierdzone: plik `.tsx` z `<img>` bez `alt` i linkiem „click here" przechodzi lint czysto; `npx eslint --print-config src/components/recruitments/KanbanBoard.tsx` raportuje **0** aktywnych reguł `jsx-a11y`. Cała warstwa UI żyje w `.tsx`, więc obecna konfiguracja nie chroni niczego.
- **Powłoka strony jest kopiowana ręcznie** w 7 plikach `.astro`, ze zdryfowanymi szerokościami kontenera (`max-w-sm` / `max-w-xl` / `max-w-4xl` / `max-w-6xl`).
- **Runtime sprzyja rozwiązaniu serwerowemu.** Astro 6 `output: "server"` na Cloudflare Workers, bez prerenderu; `src/middleware.ts` już czyta cookies (przez klienta Supabase) i wypełnia `context.locals`.
- **Zero sprzężenia testów z motywem.** Żaden test jednostkowy ani E2E nie odwołuje się do `dark`, `bg-cosmic`, motywu ani domyślnego tytułu `10x Astro Starter`.

## Desired End State

Po zakończeniu planu:

1. `src/styles/global.css` definiuje paletę **light-first** z primary w indygo, zmierzoną skalą szarości, promieniami, cieniami i tokenami typografii; ciemny motyw jest przedefiniowaniem tych samych tokenów, nie osobnym systemem.
2. Nagłówki stron mają do dyspozycji self-hostowany krój serifowy ładowany z `public/fonts`, bez żądań do obcych domen.
3. Wybór motywu utrwala się w cookie, jest odczytywany w `src/middleware.ts` i renderowany serwerowo jako klasa na `<html>` — **bez mignięcia złego motywu**. Brak cookie oznacza podążanie za preferencją systemu.
4. Istnieje `AppShell` przyjmujący nawigację, tytuł, akcje i treść, ze zdefiniowaną skalą kontenerów — gotowy do podstawienia w S-08.
5. Trasa `/dev/design-system` prezentuje tokeny, istniejące prymitywy i `AppShell` w obu motywach i **wylicza kontrast każdej pary token-na-tle**, oznaczając wynik wobec progu AA. W produkcji trasa zwraca 404.
6. `jsx-a11y` faktycznie sprawdza pliki `.tsx` (poziom `warn`; zaostrzenie do `error` należy do S-14).
7. **Układ i treść żadnego ekranu produktowego się nie zmieniają.** `bg-cosmic` i nadpisania glass-morphism zostają nietknięte do czasu migracji swoich ostatnich konsumentów w S-08/S-12. Zmieni się natomiast wygląd **powierzchni sterowanych tokenami, które nie są nadpisane w kodzie produktowym** — to zamierzone, bo właśnie na tym polega uruchomienie warstwy tokenowej. Wyliczona lista:
   - `<DialogContent>` ×3 bez `className` — `AddCandidateDialog.tsx:86`, `StageEditor.tsx:137`, `MoveCandidateDialog.tsx:151` (`bg-background`, `border`)
   - `<Badge variant>` ×2 — `RecruitmentList.tsx:99`, `KanbanBoard.tsx:142` (`bg-primary` / `bg-secondary`)
   - `<Input>` — `CandidateList.tsx:48` (`border-input`, `dark:bg-input/30`, `placeholder:text-muted-foreground`)
   - `<Button>` bez nadpisania koloru — `AddCandidateDialog.tsx:81,133`, `StageEditor.tsx:127,170,182,194,211,221`, `CandidateProfile.tsx:100,139,222,230,260` (`bg-primary`)

   Poza tą listą nic nie zmienia wyglądu. `SubmitButton` (`bg-purple-600`), `Textarea` i `FileInput` mają własne klasy, więc pozostają nietknięte.

Weryfikacja: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` przechodzą; `npm run test:e2e` przechodzi bez zmian w asercjach; `/dev/design-system` pokazuje obie palety z wynikami kontrastu; przełączenie motywu i przeładowanie strony zachowuje wybór bez mignięcia.

### Key Discoveries:

- `src/styles/global.css:1-124` — komplet tokenów plus `@utility bg-cosmic`; `@custom-variant dark (&:is(.dark *))` w linii 4 to punkt, w którym trzeba dopuścić preferencję systemową.
- `src/layouts/Layout.astro:14` — jedyne miejsce, gdzie ustawiana jest klasa motywu; `:20-33` renderuje banner konfiguracyjny nad slotem.
- `src/middleware.ts:44-77` — `onRequest` już czyta cookies i wypełnia `context.locals.user` / `context.locals.operations`; `src/env.d.ts` deklaruje kształt `App.Locals`, więc dołożenie `theme` jest zmianą typu w jednym miejscu.
- `src/components/ui/*` — **sześć z ośmiu** prymitywów (`button`, `card`, `badge`, `input`, `dialog`, `skeleton`) to stock shadcn oparty w całości na tokenach: przestawienie tokenów przestawia je samo, bez modyfikacji. **Dwa nie są shadcn**: `textarea.tsx` i `file-input.tsx` to własne komponenty z zaszytymi klasami cosmic (`bg-white/10`, `text-blue-100/80`, `border-white/20`, `focus:ring-purple-400`, `text-red-300`), własnym API (`label`, `error`, `onChange(value)`) i bez wariantów. Nie reagują na tokeny i migrują dopiero w S-13.
- `src/lib/recruitment-status.ts:16-24` — jedyny istniejący przykład mapowania domena→wariant tokenowy; wzorzec do naśladowania, nie do zmiany w tym wycinku.
- `astro.config.mjs` — `output: "server"`, `devToolbar` wyłączony, adapter Cloudflare; `env.schema` pokazuje konwencję deklarowania zmiennych środowiskowych.
- `playwright.config.ts` — E2E biegnie na `npm run dev` pod `localhost:4321`, `workers: 1`; testy nie dotykają motywu.

## What We're NOT Doing

- **Nie przestylowujemy żadnego ekranu produktowego** — nie zmieniamy układu, treści ani klas w kodzie ekranów. Powierzchnie sterowane tokenami i nienadpisane (wyliczone w Desired End State p.7) przejmą nową paletę automatycznie; nie jest to zmiana ekranu, tylko skutek uruchomienia warstwy tokenowej.
- **Nie usuwamy `bg-cosmic` ani nadpisań glass-morphism** — giną wraz z migracją swoich ostatnich konsumentów w S-08/S-12.
- **Nie budujemy nawigacji** — `AppShell` dostarcza sloty, nie ich zawartość. Sidebar, topbar i menu użytkownika to S-08.
- **Nie instalujemy nowych prymitywów shadcn** — `dropdown-menu`, `avatar`, `tooltip`, `separator` i toasty przychodzą wraz ze swoimi pierwszymi konsumentami (S-08, S-09, S-13).
- **Nie usuwamy landingu ani `/dashboard`** — to S-08.
- **Nie zaostrzamy `jsx-a11y` do `error`** — na niezmigrowanych ekranach dałoby to ścianę błędów blokującą lint. Zaostrzenie to bramka S-14.
- **Nie naprawiamy istniejących naruszeń dostępności** w komponentach — ten wycinek włącza narzędzie, nie sprząta po nim.
- **Nie dotykamy `--chart-*`** — tokeny wykresów zostają nieużywane; nie planujemy wykresów w M-2.

## Implementation Approach

Kolejność wynika z kierunku zależności: paleta jest fundamentem dla rozstrzygania motywu (nie ma czego przełączać bez dwóch zestawów tokenów), rozstrzyganie motywu jest fundamentem dla `AppShell` (powłoka osadza przełącznik), a wszystkie trzy są fundamentem dla strony podglądu, która z kolei jest przyrządem pomiarowym dla bramki dostępności.

Warstwa tokenowa dokładana jest **obok** istniejącej, nie zamiast niej. To celowe: ekrany nadpisują tokeny literałami, więc przestawienie palety nie zmienia ich wyglądu — a to znaczy, że każda faza tego wycinka jest wdrażalna niezależnie i nie zostawia aplikacji w stanie połowicznym.

Rozstrzyganie motywu idzie przez cookie czytane w middleware, a nie przez blokujący skrypt w `<head>`. Powód: `output: "server"` znaczy, że każde żądanie i tak przechodzi przez middleware, więc klasa motywu może wylądować w HTML-u przed wysłaniem odpowiedzi — bez skryptu, bez mignięcia i bez stanu niewidocznego dla serwera.

## Critical Implementation Details

**Rozstrzyganie motywu — trzy stany, nie dwa.** Cookie ma trzy możliwe sytuacje: `dark`, `light` i brak. Brak **nie oznacza jasnego** — oznacza „podążaj za systemem". To wymusza, żeby CSS obsługiwał preferencję systemową niezależnie od klasy, a klasa nadpisywała ją w obie strony. Wariant `dark` musi więc uwzględniać zarówno klasę `.dark`, jak i `prefers-color-scheme: dark` przy nieobecnej klasie `.light`:

```css
@custom-variant dark {
  &:where(.dark, .dark *) {
    @slot;
  }
  @media (prefers-color-scheme: dark) {
    &:where(:not(.light *)) {
      @slot;
    }
  }
}
```

plus blok `@media (prefers-color-scheme: dark)` przedefiniowujący tokeny pod selektorem `:root:not(.light)`. Zdefiniowanie któregokolwiek koloru **wyłącznie** wewnątrz bloku media lub wyłącznie pod `.dark` jest błędem — pierwsza wizyta użytkownika z systemowym jasnym motywem trafi wtedy na niezdefiniowany token.

**Dlaczego wariant musi być wieloregułowy, a nie jednolinijkowy.** Przedefiniowanie samych tokenów w bloku media nie wystarcza, bo utility `dark:*` reagują wyłącznie na selektor wariantu. Prymitywy używają ich wprost — `dark:bg-input/30` (`ui/input.tsx`), `dark:bg-destructive/60` i `dark:border-input` (`ui/button.tsx`), `dark:aria-invalid:ring-destructive/40`. Przy jednolinijkowym wariancie użytkownik bez cookie z ciemnym motywem systemu dostałby ciemne tokeny i jednocześnie jasnotrybowe `dark:` — render wewnętrznie niespójny dla całej kohorty „pierwsza wizyta + system dark". Powyższa konstrukcja została **zweryfikowana kompilacją** przeciwko Tailwindowi z tego repo: emituje zarówno regułę klasową (`.dark\:bg-black:where(.dark, .dark *)`), jak i blok `@media (prefers-color-scheme: dark)` z `:where(:not(.light *))`. Nie upraszczaj jej z powrotem do jednej linijki.

**Kolejność w `<head>`.** `@font-face` z `font-display: swap` musi być w arkuszu ładowanym synchronicznie, a plik kroju wskazany przez `<link rel="preload">` w `Layout.astro` — inaczej serifowy nagłówek mignie krojem zastępczym mimo poprawnego rozstrzygnięcia motywu. Podmiana kroju na inny jest wtedy zmianą jednego tokenu i jednego pliku.

## Phase 1: Warstwa tokenów, paleta i typografia

### Overview

Przepisać `src/styles/global.css` na paletę light-first z primary w indygo, dołożyć tokeny typografii i cieni, oraz osadzić self-hostowany krój serifowy. Żaden konsument nie jest modyfikowany.

### Changes Required:

#### 1. Paleta i tokeny

**File**: `src/styles/global.css`

**Intent**: Uczynić warstwę tokenów jedynym źródłem kolorów, promieni, cieni i typografii, z motywem jasnym jako domyślnym i ciemnym jako przedefiniowaniem tych samych nazw. Primary przechodzi z neutralnej czerni na indygo, skala szarości jest dobierana pod próg kontrastu AA (patrz Faza 5).

**Contract**: Zachowane bez zmian nazw wszystkie tokeny konsumowane dziś przez `src/components/ui/*` — `--background`, `--foreground`, `--card(-foreground)`, `--popover(-foreground)`, `--primary(-foreground)`, `--secondary(-foreground)`, `--muted(-foreground)`, `--accent(-foreground)`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`, rodzina `--sidebar-*`. Dołożone: `--font-sans`, `--font-serif`, `--shadow-sm|md|lg`. Rodzina `--chart-*` zostaje nietknięta. Wszystkie nowe tokeny eksponowane przez istniejący blok `@theme inline`. `@utility bg-cosmic` **pozostaje bez zmian** — ma 14 żywych konsumentów.

#### 2. Wariant ciemny reagujący na preferencję systemową

**File**: `src/styles/global.css`

**Intent**: Dopuścić, by motyw wynikał z ustawienia systemu, gdy użytkownik nie dokonał jeszcze wyboru, a jednocześnie by jawny wybór nadpisywał system w obie strony.

**Contract**: Trzy bloki definicji tokenów — bazowy `:root` (jasny), `@media (prefers-color-scheme: dark)` pod selektorem `:root:not(.light)`, oraz `.dark`. Wariant `dark` Tailwinda przedefiniowany tak, by obejmował klasę; szczegóły i pułapka w sekcji „Critical Implementation Details" powyżej.

#### 3. Krój serifowy

**File**: `public/fonts/` (nowy katalog), `src/styles/global.css`, `src/layouts/Layout.astro`

**Intent**: Udostępnić nagłówkom stron krój serifowy bez żądań do obcych domen. Rekomendacja: **Fraunces** w wariancie zmiennym (licencja OFL), podzbiór `latin` + `latin-ext` — ten drugi jest konieczny, bo dane kandydatów zawierają diakrytyki (np. seedowana `Julia Wojcik`). Podmiana kroju to później zmiana jednego pliku i jednego tokenu.

**Contract**: Plik `.woff2` w `public/fonts/`; `@font-face` z `font-display: swap` w `global.css`; token `--font-serif` wskazujący na rodzinę ze stackiem zapasowym (`ui-serif, Georgia, serif`); `<link rel="preload" as="font" type="font/woff2" crossorigin>` w `<head>` w `Layout.astro`.

#### 4. Miernik kontrastu i pomiar palety

**File**: `src/lib/contrast.ts` (nowy), `src/styles/global.css`

**Intent**: Zamienić „paleta wygląda dobrze" na liczbę **w momencie jej powstawania**, a nie cztery fazy później. Pomiar potrzebuje wyłącznie wartości tokenów i czystej funkcji — nie wymaga strony podglądu ani `AppShell`, więc odkładanie go oznaczałoby budowanie Faz 2–4 na niezwalidowanej palecie i nawrót do tego pliku po trzech domkniętych fazach.

**Contract**: Czysta funkcja licząca współczynnik kontrastu dwóch kolorów wg definicji WCAG 2.1 (luminancja względna), pokryta testem jednostkowym na znanych parach (biel/czerń = 21:1, kolory identyczne = 1:1, para tuż powyżej i tuż poniżej progu 4.5:1). Wartości tokenów z Kroku 1 są nią zmierzone dla każdej pary „token tekstu na tokenie tła" w obu motywach i korygowane do progu przed zamknięciem fazy. Prezentacja wyników na stronie podglądu to Faza 4 — tutaj liczy się sam pomiar.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npm run typecheck`
- Testy jednostkowe przechodzą, w tym miernik kontrastu na parach skrajnych i granicznych: `npm test`
- Build produkcyjny przechodzi: `npm run build`
- Testy E2E przechodzą bez zmian w asercjach: `npm run test:e2e`

#### Manual Verification:

- Układ, treść i klasy żadnego ekranu produktowego się nie zmieniły; zmiany wyglądu ograniczają się do powierzchni wyliczonych w Desired End State p.7
- Każda para „token tekstu na tokenie tła" osiąga próg AA w obu motywach — potwierdzone liczbą z miernika, nie oceną wzrokową
- Plik kroju ładuje się z własnej domeny — w zakładce Network brak żądań do `fonts.googleapis.com` i `fonts.gstatic.com`
- Nagłówek renderowany krojem serifowym nie miga krojem zastępczym przy przeładowaniu

**Implementation Note**: Po zakończeniu tej fazy i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie weryfikacji manualnej, zanim przejdziesz do następnej fazy.

---

## Phase 2: Rozstrzyganie motywu i przełącznik

### Overview

Utrwalić wybór motywu w cookie, odczytać go w middleware i wyrenderować klasę na `<html>` po stronie serwera. Dostarczyć samodzielny przełącznik gotowy do osadzenia przez topbar z S-08.

### Changes Required:

#### 1. Funkcja rozstrzygająca motyw

**File**: `src/lib/theme.ts` (nowy)

**Intent**: Wydzielić czystą funkcję mapującą wartość cookie na klasę motywu, żeby dała się przetestować jednostkowo w oderwaniu od Astro i żeby middleware oraz endpoint korzystały z jednej definicji dozwolonych wartości.

**Contract**: Schemat zod dopuszczający `"light" | "dark"`; stała z nazwą cookie; funkcja przyjmująca wartość cookie (możliwie `undefined` lub nieznaną) i zwracająca `"light" | "dark" | null`, gdzie `null` oznacza „podążaj za systemem" i przekłada się na brak klasy na `<html>`. Nieznana wartość cookie traktowana jak brak — nigdy nie rzuca.

#### 2. Odczyt motywu w middleware

**File**: `src/middleware.ts`, `src/env.d.ts`

**Intent**: Udostępnić rozstrzygnięty motyw warstwie renderującej, tą samą drogą, którą już płyną `user` i `operations`.

**Contract**: `App.Locals` rozszerzone o `theme: "light" | "dark" | null`. `onRequest` ustawia je z cookie przed wywołaniem `next()`. Odczyt nie może zależeć od klienta Supabase ani od stanu zalogowania — motyw działa również na ekranach auth i przy nieskonfigurowanym Supabase.

#### 3. Endpoint zapisu preferencji

**File**: `src/pages/api/preferences/theme.ts` (nowy)

**Intent**: Utrwalić wybór użytkownika w cookie. Preferencja prezentacji nie jest danymi chronionymi, więc endpoint nie wymaga zalogowania — ale musi zostać wyłączony z bramki uwierzytelniania, która obejmuje dziś wszystkie trasy `/api/`.

**Contract**: `POST` walidujący ciało schematem z `src/lib/theme.ts`, ustawiający cookie (`path: "/"`, `sameSite: "lax"`, `httpOnly: true` — cookie czyta wyłącznie serwer), `export const prerender = false`. W `src/middleware.ts` powstaje **osobny predykat** dla publicznych tras API, obejmujący tę trasę; `isAuthRoute` **pozostaje nietknięty**. Powód: `isAuthRoute` pełni dziś dwie funkcje naraz — zwalnia z bramki 401 (`isApiRoute`) **oraz** pomija `resolveCallerOperations`. Poszerzenie go po cichu zmieniłoby semantykę rozwiązywania uprawnień. Bez tego wyjątku bramka `isApiRoute` zwróci 401 niezalogowanemu użytkownikowi na ekranie logowania.

#### 4. Klasa motywu na `<html>`

**File**: `src/layouts/Layout.astro`

**Intent**: Zastąpić zaszyte `class="dark"` wartością rozstrzygniętą w middleware, tak by właściwy motyw był w HTML-u już w pierwszej odpowiedzi.

**Contract**: `class` na `<html>` przyjmuje `"light"`, `"dark"` albo nie występuje wcale (gdy `Astro.locals.theme` jest `null`). Brak jakiegokolwiek skryptu w `<head>` rozstrzygającego motyw.

#### 5. Przełącznik

**File**: `src/components/ThemeToggle.tsx` (nowy)

**Intent**: Dać użytkownikowi kontrolkę zmiany motywu. W tej fazie komponent nie jest nigdzie osadzony poza stroną podglądu z Fazy 4 — jego docelowym miejscem jest topbar z S-08.

**Contract**: Komponent React przyjmujący aktualny motyw jako props (stan pochodzi z serwera, nie z `localStorage`), wysyłający `POST` na endpoint z Kroku 3 i przeładowujący dokument po sukcesie. Kontrolka o jawnej, tekstowej nazwie dostępnej dla czytnika ekranu i obsługiwana z klawiatury; stan bieżącego motywu komunikowany nie samym kolorem ikony.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe funkcji rozstrzygającej motyw przechodzą, w tym przypadki `undefined` i nieznanej wartości cookie: `npm test`
- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npm run typecheck`
- Build produkcyjny przechodzi: `npm run build`
- Testy E2E przechodzą bez zmian w asercjach: `npm run test:e2e`

#### Manual Verification:

- Przełączenie motywu i przeładowanie strony zachowuje wybór
- Przy pierwszej wizycie (wyczyszczone cookies) aplikacja podąża za ustawieniem motywu w systemie
- Przy ładowaniu nie widać mignięcia niewłaściwego motywu — również przy wymuszonym wolnym łączu
- Przełącznik działa na ekranie logowania, czyli dla niezalogowanego użytkownika
- Przełącznik da się obsłużyć samą klawiaturą i ma czytelną nazwę w czytniku ekranu

**Implementation Note**: Po zakończeniu tej fazy i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie weryfikacji manualnej, zanim przejdziesz do następnej fazy.

---

## Phase 3: AppShell — powłoka ze slotami

### Overview

Wydzielić powłokę strony, dziś kopiowaną ręcznie w siedmiu plikach `.astro`, do jednego komponentu ze slotami i zdefiniowaną skalą kontenerów. Sloty pozostają puste — wypełnia je S-08.

### Changes Required:

#### 1. Komponent powłoki

**File**: `src/components/AppShell.astro` (nowy)

**Intent**: Dać kolejnym wycinkom jeden punkt, w którym żyje układ strony: obszar nawigacji, pasek górny, tytuł strony z akcjami oraz treść. Komponent pozostaje w `.astro`, żeby powłoka nie kosztowała JavaScriptu po stronie klienta — wyjątkiem są osadzane w niej wyspy (przełącznik motywu, później chowanie nawigacji).

**Contract**: Nazwane sloty `nav`, `topbar-actions`, `page-title`, `page-actions` oraz slot domyślny na treść. Prop wyboru szerokości kontenera z jawnie nazwanym zestawem wariantów (wąski dla formularzy, standardowy dla list, szeroki dla kanbana) — zastępuje dzisiejszy dryf `max-w-sm`/`xl`/`4xl`/`6xl`. Wszystkie kolory wyłącznie przez tokeny; żadnych literałów palety. Obszar nawigacji chowany poniżej breakpointu, z zachowaniem dostępu do treści.

#### 2. Semantyka i punkty zaczepienia dostępności

**File**: `src/components/AppShell.astro`

**Intent**: Osadzić w powłoce strukturę nawigacyjną raz, żeby żaden konsument nie musiał jej odtwarzać ani zgadywać.

**Contract**: Landmarki `header`, `nav` i `main` z `main` jako celem pominięcia nawigacji; odsyłacz „przejdź do treści" jako pierwszy fokusowalny element strony; widoczny stan focus oparty o token `--ring`.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi, w tym reguły `astro/jsx-a11y/*` na nowym pliku: `npm run lint`
- Typy przechodzą: `npm run typecheck`
- Build produkcyjny przechodzi: `npm run build`
- Testy E2E przechodzą bez zmian w asercjach: `npm run test:e2e`

#### Manual Verification:

- Żadna istniejąca trasa nie renderuje `AppShell` — ekrany produktowe pozostają nietknięte
- Powłoka poprawnie chowa obszar nawigacji poniżej breakpointu i nie powoduje przewijania w poziomie
- Odsyłacz „przejdź do treści" jest pierwszym elementem po `Tab` i faktycznie przenosi fokus do `main`

**Implementation Note**: Po zakończeniu tej fazy i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie weryfikacji manualnej, zanim przejdziesz do następnej fazy.

---

## Phase 4: Strona podglądu systemu projektowego

### Overview

Dostarczyć jedno miejsce prezentujące tokeny, istniejące prymitywy i `AppShell` w obu motywach — służące jednocześnie jako katalog dla kolejnych wycinków i jako przyrząd pomiarowy dla bramki dostępności z Fazy 5.

### Changes Required:

#### 1. Trasa podglądu

**File**: `src/pages/dev/design-system.astro` (nowy)

**Intent**: Pokazać całą warstwę tokenową i wszystkie prymitywy naraz, żeby błąd w palecie był widoczny w jednym miejscu, zanim skonsumuje ją pięć kolejnych wycinków.

**Contract**: Trasa dostępna wyłącznie w trybie deweloperskim — w produkcji zwraca 404, sprawdzane przez `import.meta.env.DEV`. Prezentuje: wszystkie tokeny kolorystyczne z ich nazwami, skalę typografii (serif + sans), skalę promieni i cieni, oraz każdy prymityw **sterowany tokenami** w każdym wariancie (`button` ×6 wariantów ×4 rozmiary, `badge` ×6, `card`, `input`, `dialog`, `skeleton`). `textarea` i `file-input` trafiają do **osobnej sekcji „oczekujące na migrację (S-13)"** z widoczną adnotacją — mają zaszyte klasy cosmic i nie reagują na tokeny, więc pokazane obok pozostałych wyglądałyby na błąd systemu, a nie na niezmigrowany komponent. Osadza `ThemeToggle` z Fazy 2 i renderuje się wewnątrz `AppShell` z Fazy 3. **Nie** prezentuje prymitywów, których jeszcze nie ma w repo.

#### 2. Prezentacja wyników pomiaru kontrastu

**File**: `src/pages/dev/design-system.astro`

**Intent**: Wyświetlić na stronie podglądu wyniki miernika dostarczonego w Fazie 1, żeby stan palety był czytelny bez uruchamiania testów — i żeby kolejne wycinki miały gdzie sprawdzić skutek swoich zmian.

**Contract**: Dla każdej pary „token tekstu na tokenie tła" strona pokazuje wyliczony współczynnik i oznaczenie „spełnia / nie spełnia AA", osobno dla motywu jasnego i ciemnego. Oznaczenie nie może opierać się wyłącznie na kolorze — wynik musi być czytelny również jako tekst.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npm run typecheck`
- Build produkcyjny przechodzi: `npm run build`

#### Manual Verification:

- `/dev/design-system` renderuje wszystkie tokeny i prymitywy w obu motywach
- `textarea` i `file-input` są pokazane w osobnej sekcji „oczekujące na migrację (S-13)" z widoczną adnotacją, że nie reagują na tokeny
- Przełącznik motywu na stronie podglądu działa i utrwala wybór
- Trasa `/dev/design-system` zwraca 404 w buildzie produkcyjnym (`npm run preview`)

**Implementation Note**: Po zakończeniu tej fazy i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj na potwierdzenie weryfikacji manualnej, zanim przejdziesz do następnej fazy.

---

## Phase 5: Bramka dostępności

### Overview

Włączyć `jsx-a11y` dla plików `.tsx`, gdzie żyje cała warstwa UI, oraz zamknąć paletę pomiarem kontrastu wykonanym na stronie podglądu.

### Changes Required:

#### 1. Włączenie `jsx-a11y` dla React

**File**: `eslint.config.js`

**Intent**: Naprawić lukę potwierdzoną empirycznie podczas planowania: `eslint-plugin-jsx-a11y` jest w zależnościach, ale konfiguracja ładuje wyłącznie wariant z `eslint-plugin-astro`, którego reguły żyją w namespace `astro/jsx-a11y/*` i nie obejmują `.tsx`. Efektywnie żaden komponent React nie jest dziś sprawdzany.

**Intent (poziom)**: Reguły wchodzą jako `warn`, nie `error`. Powód jest konkretny: ~35 niezmigrowanych komponentów zawiera naruszenia, których ten wycinek świadomie nie naprawia (patrz „What We're NOT Doing"), a `error` zablokowałby `npm run lint` i tym samym każdy kolejny wycinek. Zaostrzenie do `error` po posprzątaniu to bramka S-14.

**Contract**: Blok konfiguracji dla `**/*.{jsx,tsx}` ładujący zalecany zestaw `eslint-plugin-jsx-a11y` z poziomem `warn`. Weryfikacja kontraktu: `npx eslint --print-config src/components/recruitments/KanbanBoard.tsx` raportuje niezerową liczbę aktywnych reguł `jsx-a11y/*` (dziś: 0).

#### 2. Weryfikacja końcowa palety

**File**: `src/styles/global.css`

**Intent**: Potwierdzić, że paleta zmierzona i skorygowana w Fazie 1 nadal spełnia próg po wszystkich zmianach z Faz 2–4, i domknąć ewentualne odstępstwa. To weryfikacja stanu końcowego, nie pierwszy pomiar — ten odbył się tam, gdzie paleta powstała.

**Contract**: Każda para token-tekstu na tokenie-tła prezentowana na stronie podglądu osiąga co najmniej 4.5:1 dla tekstu podstawowego i 3:1 dla tekstu dużego oraz elementów interfejsu, **w obu motywach**. Odstępstwa, jeśli okażą się konieczne, wymienione z uzasadnieniem w artefaktach change'u — nie zostawione po cichu.

#### 3. Zapis dla kolejnych wycinków

**File**: `context/foundation/lessons.md`

**Intent**: Utrwalić regułę, która ma obowiązywać S-08…S-13: kolory wyłącznie przez tokeny, żadnych literałów palety Tailwind w kodzie funkcyjnym. Bez tego zapisu kolejne wycinki będą powielać wzorzec, który ten milestone likwiduje.

**Contract**: Nowy wpis w rejestrze zgodny z jego dotychczasową strukturą (kontekst, problem, reguła, zakres obowiązywania), po angielsku, zgodnie z regułą już zapisaną w tym pliku.

### Success Criteria:

#### Automated Verification:

- `npx eslint --print-config src/components/recruitments/KanbanBoard.tsx` raportuje niezerową liczbę aktywnych reguł `jsx-a11y/*`
- Lint przechodzi (ostrzeżenia dopuszczalne, błędy nie): `npm run lint`
- Testy jednostkowe przechodzą: `npm test`
- Typy przechodzą: `npm run typecheck`
- Build produkcyjny przechodzi: `npm run build`
- Testy E2E przechodzą bez zmian w asercjach: `npm run test:e2e`

#### Manual Verification:

- Strona podglądu nie raportuje ani jednej pary poniżej progu AA w motywie jasnym
- Strona podglądu nie raportuje ani jednej pary poniżej progu AA w motywie ciemnym
- Ewentualne odstępstwa od progu są spisane wraz z uzasadnieniem
- Układ, treść i klasy żadnego ekranu produktowego nadal się nie zmieniły; lista zmienionych powierzchni tokenowych jest nadal tożsama z tą z Desired End State p.7

**Implementation Note**: To ostatnia faza. Po jej zakończeniu wycinek F-02 jest gotowy do przeglądu implementacji.

---

## Testing Strategy

### Unit Tests:

- Rozstrzyganie motywu z cookie: wartość `"light"`, wartość `"dark"`, brak cookie, wartość nieznana (musi zachować się jak brak, nie rzucić)
- Miernik kontrastu: pary skrajne (biel/czerń = 21:1, identyczne kolory = 1:1), para tuż powyżej i tuż poniżej progu 4.5:1

### Integration Tests:

- Brak nowych testów integracyjnych. Endpoint preferencji motywu nie dotyka bazy ani RLS — cała jego logika to walidacja schematem i ustawienie cookie, pokryta testem jednostkowym schematu. Dokładanie testu integracyjnego wymagającego działającego Supabase dałoby koszt bez pokrycia.

### Manual Testing Steps:

1. Wyczyścić cookies, ustawić w systemie motyw ciemny, otworzyć aplikację — powinna być ciemna
2. Zmienić ustawienie systemu na jasny, przeładować — aplikacja powinna być jasna
3. Przełączyć motyw kontrolką na ciemny, przeładować — wybór ma przetrwać niezależnie od ustawienia systemu
4. Przy wymuszonym wolnym łączu przeładować stronę — nie powinno być mignięcia niewłaściwego motywu ani mignięcia krojem zastępczym
5. Przejść przez `/recruitments`, `/recruitments/:id`, `/candidates`, `/admin/groups` i ekrany auth — wygląd ma być identyczny jak przed wycinkiem
6. Obsłużyć przełącznik motywu samą klawiaturą; sprawdzić jego nazwę w czytniku ekranu
7. Otworzyć `/dev/design-system` w obu motywach i przejrzeć wyniki kontrastu
8. Uruchomić `npm run preview` i potwierdzić, że `/dev/design-system` zwraca 404

## Performance Considerations

Krój serifowy to jedyny nowy zasób na ścieżce krytycznej. Podzbiór `latin` + `latin-ext` w wariancie zmiennym mieści się w kilkudziesięciu kilobajtach; `preload` plus `font-display: swap` sprawiają, że jego pobranie nie blokuje pierwszego malowania. Rozstrzyganie motywu nie dokłada żądań ani skryptów — odczyt cookie dzieje się w middleware, które i tak biegnie na każdym żądaniu. Strona podglądu i miernik kontrastu nie trafiają do bundla produkcyjnego.

## Migration Notes

Wycinek jest addytywny i odwracalny. Warstwa tokenowa dokładana jest obok istniejącej, `bg-cosmic` i nadpisania glass-morphism zostają nietknięte, żadna trasa nie zmienia zachowania. Cofnięcie sprowadza się do rewertu — nie ma danych do zmigrowania ani stanu do odtworzenia. Jedyny trwały ślad po stronie użytkownika to cookie preferencji motywu, którego brak jest obsługiwany jako stan poprawny.

## References

- Analiza obecnego UI: `context/changes/ui-redesign-foundation/research.md`
- Wymagania i decyzje: `context/changes/ui-redesign-foundation/design-brief.md`
- Pozycja w roadmapie: `context/foundation/roadmap.md` (F-02, milestone M-2)
- Wzorzec mapowania domena→wariant tokenowy: `src/lib/recruitment-status.ts:16-24`
- Wzorzec endpointu API (walidacja zod, `prerender = false`): `src/pages/api/auth/signin.ts`
- Reguła językowa artefaktów: `context/foundation/lessons.md`

## Progress

> Konwencja: `- [ ]` oczekuje, `- [x]` zrobione. Dopisz ` — <commit sha>`, gdy krok wyląduje. Nie zmieniaj tytułów kroków. Patrz `references/progress-format.md`.

### Phase 1: Warstwa tokenów, paleta i typografia

#### Automated

- [x] 1.1 Lint przechodzi: `npm run lint` — ea48ddc
- [x] 1.2 Typy przechodzą: `npm run typecheck` — ea48ddc
- [x] 1.3 Testy jednostkowe przechodzą, w tym miernik kontrastu na parach skrajnych i granicznych: `npm test` — ea48ddc
- [x] 1.4 Build produkcyjny przechodzi: `npm run build` — ea48ddc
- [x] 1.5 Testy E2E przechodzą bez zmian w asercjach: `npm run test:e2e` — ea48ddc

#### Manual

- [x] 1.6 Układ, treść i klasy żadnego ekranu produktowego się nie zmieniły; zmiany wyglądu ograniczają się do powierzchni wyliczonych w Desired End State p.7
- [x] 1.7 Każda para „token tekstu na tokenie tła" osiąga próg AA w obu motywach — potwierdzone liczbą z miernika, nie oceną wzrokową
- [x] 1.8 Plik kroju ładuje się z własnej domeny — w zakładce Network brak żądań do `fonts.googleapis.com` i `fonts.gstatic.com`
- [x] 1.9 Nagłówek renderowany krojem serifowym nie miga krojem zastępczym przy przeładowaniu

### Phase 2: Rozstrzyganie motywu i przełącznik

#### Automated

- [x] 2.1 Testy jednostkowe funkcji rozstrzygającej motyw przechodzą, w tym przypadki `undefined` i nieznanej wartości cookie: `npm test` — fdcc95a
- [x] 2.2 Lint przechodzi: `npm run lint` — fdcc95a
- [x] 2.3 Typy przechodzą: `npm run typecheck` — fdcc95a
- [x] 2.4 Build produkcyjny przechodzi: `npm run build` — fdcc95a
- [x] 2.5 Testy E2E przechodzą bez zmian w asercjach: `npm run test:e2e` — fdcc95a

#### Manual

- [x] 2.6 Przełączenie motywu i przeładowanie strony zachowuje wybór
- [x] 2.7 Przy pierwszej wizycie (wyczyszczone cookies) aplikacja podąża za ustawieniem motywu w systemie
- [x] 2.8 Przy ładowaniu nie widać mignięcia niewłaściwego motywu — również przy wymuszonym wolnym łączu
- [x] 2.9 Przełącznik działa na ekranie logowania, czyli dla niezalogowanego użytkownika
- [x] 2.10 Przełącznik da się obsłużyć samą klawiaturą i ma czytelną nazwę w czytniku ekranu

### Phase 3: AppShell — powłoka ze slotami

#### Automated

- [x] 3.1 Lint przechodzi, w tym reguły `astro/jsx-a11y/*` na nowym pliku: `npm run lint`
- [x] 3.2 Typy przechodzą: `npm run typecheck`
- [x] 3.3 Build produkcyjny przechodzi: `npm run build`
- [x] 3.4 Testy E2E przechodzą bez zmian w asercjach: `npm run test:e2e`

#### Manual

- [x] 3.5 Żadna istniejąca trasa nie renderuje `AppShell` — ekrany produktowe pozostają nietknięte
- [x] 3.6 Powłoka poprawnie chowa obszar nawigacji poniżej breakpointu i nie powoduje przewijania w poziomie
- [x] 3.7 Odsyłacz „przejdź do treści" jest pierwszym elementem po `Tab` i faktycznie przenosi fokus do `main`

### Phase 4: Strona podglądu systemu projektowego

#### Automated

- [ ] 4.1 Lint przechodzi: `npm run lint`
- [ ] 4.2 Typy przechodzą: `npm run typecheck`
- [ ] 4.3 Build produkcyjny przechodzi: `npm run build`

#### Manual

- [ ] 4.4 `/dev/design-system` renderuje wszystkie tokeny i prymitywy w obu motywach
- [ ] 4.5 `textarea` i `file-input` są pokazane w osobnej sekcji „oczekujące na migrację (S-13)" z widoczną adnotacją, że nie reagują na tokeny
- [ ] 4.6 Przełącznik motywu na stronie podglądu działa i utrwala wybór
- [ ] 4.7 Trasa `/dev/design-system` zwraca 404 w buildzie produkcyjnym (`npm run preview`)

### Phase 5: Bramka dostępności

#### Automated

- [ ] 5.1 `npx eslint --print-config src/components/recruitments/KanbanBoard.tsx` raportuje niezerową liczbę aktywnych reguł `jsx-a11y/*`
- [ ] 5.2 Lint przechodzi (ostrzeżenia dopuszczalne, błędy nie): `npm run lint`
- [ ] 5.3 Testy jednostkowe przechodzą: `npm test`
- [ ] 5.4 Typy przechodzą: `npm run typecheck`
- [ ] 5.5 Build produkcyjny przechodzi: `npm run build`
- [ ] 5.6 Testy E2E przechodzą bez zmian w asercjach: `npm run test:e2e`

#### Manual

- [ ] 5.7 Strona podglądu nie raportuje ani jednej pary poniżej progu AA w motywie jasnym
- [ ] 5.8 Strona podglądu nie raportuje ani jednej pary poniżej progu AA w motywie ciemnym
- [ ] 5.9 Ewentualne odstępstwa od progu są spisane wraz z uzasadnieniem
- [ ] 5.10 Układ, treść i klasy żadnego ekranu produktowego nadal się nie zmieniły; lista zmienionych powierzchni tokenowych jest nadal tożsama z tą z Desired End State p.7
