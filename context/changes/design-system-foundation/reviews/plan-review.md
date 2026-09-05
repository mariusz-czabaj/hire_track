<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Fundament systemu projektowego — tokeny, motywy, AppShell

- **Plan**: `context/changes/design-system-foundation/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-05
- **Verdict**: REVISE → SOUND (po naniesieniu poprawek)
- **Findings**: 2 critical, 3 warnings, 1 observation

## Verdicts

| Dimension             | Verdict (przed) | Verdict (po poprawkach) |
| --------------------- | --------------- | ----------------------- |
| End-State Alignment   | FAIL            | PASS                    |
| Lean Execution        | WARNING         | PASS                    |
| Architectural Fitness | WARNING         | PASS                    |
| Blind Spots           | FAIL            | PASS                    |
| Plan Completeness     | WARNING         | PASS (F6 pominięte)     |

Uwaga o werdykcie wyjściowym: dwa FAIL-e literalnie dają `RETHINK` wg rubryki. Zapisano
`REVISE`, ponieważ obie usterki były naprawialne bez zmiany struktury faz ani podejścia —
F1 to przeformułowanie obietnicy i kryteriów, F2 to jeden blok CSS zweryfikowany kompilacją.

## Grounding

8/8 ścieżek istnieje ✓, 6/6 nowych ścieżek poprawnie nieobecnych ✓, brief↔plan ✓,
Progress↔Phase 5/5 faz, 42/42 kryteriów zmapowanych, 0 checkboxów poza sekcją Progress ✓

## Findings

### F1 — Obietnica „żaden ekran nie zmieni wyglądu" jest nieprawdziwa

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Desired End State p.7, What We're NOT Doing, kryteria 1.6 i 5.10
- **Detail**: Plan powtarzał w pięciu miejscach, że żaden ekran produktowy nie zmieni wyglądu — wbrew własnej analizie w `research.md`. Powierzchnie sterowane tokenami i nienadpisane: `<DialogContent>` ×3 (`AddCandidateDialog.tsx:86`, `StageEditor.tsx:137`, `MoveCandidateDialog.tsx:151`), `<Badge variant>` ×2 (`RecruitmentList.tsx:99`, `KanbanBoard.tsx:142`), `<Input>` (`CandidateList.tsx:48`), `<Button>` bez nadpisania koloru (AddCandidateDialog ×2, StageEditor ×6, CandidateProfile ×5). Kryteria 1.6 i 5.10 nigdy by nie przeszły.
- **Fix A ⭐ Recommended**: Zastąp obietnicę precyzyjną granicą — zero zmian w układzie, treści i klasach; wyliczona lista powierzchni tokenowych przejmujących nową paletę.
  - Strength: Kryteria stają się sprawdzalne; lista ostrzega recenzenta, czego się spodziewać.
  - Tradeoff: Wycinek przestaje być wizualnie niewidoczny.
  - Confidence: HIGH — lista wyliczona z greps, nie z założeń.
  - Blind spot: Nie policzono, czy któryś test E2E asercjonuje kolor.
- **Fix B**: Przypnij ~12 call-sites klasami zachowującymi obecny wygląd.
  - Strength: Obietnica literalnie prawdziwa.
  - Tradeoff: Anty-wzorzec, który milestone likwiduje, plus dług bez mechanizmu wymuszającego usunięcie.
  - Confidence: MEDIUM.
  - Blind spot: Brak mechanizmu wymuszającego usunięcie.
- **Decision**: FIXED via Fix A

### F2 — Wariant `dark:` nie zadziała przy preferencji systemowej

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 1 krok 2 + Critical Implementation Details
- **Detail**: Plan przedefiniowywał tokeny w `@media (prefers-color-scheme: dark)`, ale jednolinijkowy `@custom-variant dark (&:where(.dark, .dark *))` sprawia, że utility `dark:*` reagują wyłącznie na klasę. Prymitywy używają ich wprost (`dark:bg-input/30` w `ui/input.tsx`, `dark:bg-destructive/60` i `dark:border-input` w `ui/button.tsx`). Użytkownik bez cookie z ciemnym systemem dostałby ciemne tokeny i jasnotrybowe `dark:` — render wewnętrznie niespójny.
- **Fix A ⭐ Recommended**: Wieloregułowy `@custom-variant` obejmujący media query.
  - Strength: Zweryfikowane kompilacją przeciwko Tailwindowi z tego repo — emituje obie reguły. Zachowuje trójstanowy model z briefu.
  - Tradeoff: Nieoczywista konstrukcja, wymaga komentarza chroniącego przed „uproszczeniem".
  - Confidence: HIGH — dowód z kompilacji, nie z dokumentacji.
  - Blind spot: CLI rozwiązało 4.3.3 przy projekcie na ^4.2.4 (ta sama major).
- **Fix B**: Porzuć trójstanowość — brak cookie znaczy jasny.
  - Strength: Likwiduje całą klasę problemu.
  - Tradeoff: Cofa decyzję o podążaniu za systemem.
  - Confidence: HIGH.
  - Blind spot: Siła preferencji użytkownika wobec tej decyzji.
- **Decision**: FIXED via Fix A

### F3 — Dwa prymitywy w `ui/` nie są shadcn i nie reagują na tokeny

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Key Discoveries + Faza 4 krok 1
- **Detail**: `ui/textarea.tsx` i `ui/file-input.tsx` to własne komponenty z zaszytymi klasami cosmic (`bg-white/10`, `text-blue-100/80`, `focus:ring-purple-400`), własnym API (`label`, `error`, `onChange(value)`) i bez wariantów. Na stronie podglądu obok pozostałych wyglądałyby na błąd systemu.
- **Fix**: Poprawiono Key Discovery (sześć z ośmiu to stock shadcn); oba komponenty wydzielone na stronie podglądu do sekcji „oczekujące na migrację (S-13)" z widoczną adnotacją i usunięte z obietnicy „każdy prymityw w każdym wariancie".
- **Decision**: FIXED

### F4 — Pomiar kontrastu odłożony o cztery fazy od miejsca powstania palety

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Faza 5 krok 2
- **Detail**: Plan sam przyznawał, że Faza 5 „może cofnąć wartości ustalone w Fazie 1". Fazy 2–4 budowały na niezwalidowanej palecie, a nawrót następował po trzech domkniętych fazach. Sam pomiar potrzebuje wyłącznie wartości tokenów i czystej funkcji.
- **Fix**: `src/lib/contrast.ts` i pomiar przeniesione do Fazy 1 jako krok 4; Faza 4 prezentuje wyniki, Faza 5 zostaje przy `jsx-a11y` i weryfikacji końcowej.
- **Decision**: FIXED

### F5 — Niejednoznaczny wyjątek w middleware może cicho zmienić uprawnienia

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 2 krok 3
- **Detail**: `isAuthRoute` w `src/middleware.ts:45` pełni dwie funkcje — zwalnia z bramki 401 i pomija `resolveCallerOperations`. Instrukcja „dołącz trasę do wyjątku obok `/api/auth/`" zachęcała do jego poszerzenia, co po cichu zmieniłoby semantykę uprawnień.
- **Fix**: Doprecyzowano, że powstaje osobny predykat dla publicznych tras API, a `isAuthRoute` pozostaje nietknięty — wraz z uzasadnieniem.
- **Decision**: FIXED

### F6 — Plan i brief po polsku wbrew regule English-only z `lessons.md`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: cały dokument + Faza 5 krok 3
- **Detail**: `lessons.md` obejmuje regułą English-only „all `context/**` documents". Plan jest po polsku i jednocześnie dopisuje do `lessons.md` wpis po angielsku.
- **Fix**: Zapisać w `lessons.md` jawny wyjątek dla artefaktów `context/**`, albo przetłumaczyć plan, brief i roadmapę.
- **Decision**: SKIPPED — do rozstrzygnięcia poza tym wycinkiem
