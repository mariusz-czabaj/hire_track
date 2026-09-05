# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Always write code and artifacts in English, regardless of conversation language

- **Context**: Every artifact produced in this repository, at every phase — source code, identifiers, comments, commit messages, UI strings, SQL migrations and seed data (including domain values such as kanban stage names), and all `context/**` documents (`frame.md`, `research.md`, `plan.md`, reviews, `change.md`, roadmap and foundation docs). Applies whether the request arrives in Polish or English.
- **Problem**: The conversation is often held in Polish, and that language leaks into deliverables. It has already happened: the PRD, roadmap, and F-01 change docs are in Polish, and F-01 seeded Polish kanban stage names (`Nowy`, `Screening`, `Rozmowa`, `Oferta`, `Zatrudniony`, `Odrzucony`) into the database while the application UI is English (`<html lang="en">`). The result is a mixed-language codebase with no i18n layer, unreviewable diffs for non-Polish readers, and rework to rename shipped data later.
- **Rule**: Always write code and artifacts in English, even when the user writes in Polish. Respond to the user in their language if they prefer, but never let a non-English string enter a file — if a source document (PRD, notes) is in Polish, translate its content into English in the artifact you produce rather than copying it through, and quote the original only where a verbatim citation is explicitly required.
- **Applies to**: all

## Colors only through design tokens, never raw Tailwind palette literals

- **Context**: F-02 (`design-system-foundation`) introduced a light-first token palette in `src/styles/global.css` — `--background`, `--foreground`, `--card`, `--primary`, `--muted-foreground`, etc. — resolved server-side into a `light`/`dark` class on `<html>` with no flash. `src/components/ui/*` consumes these tokens exclusively.
- **Problem**: Product screens today reach past the token layer straight for Tailwind palette literals (`bg-white/`, `text-blue-100`, `border-white/`, `text-purple-`, `bg-cosmic`, gradient headers — ~250 occurrences across ~35 files). Every literal is a color the theme system cannot see: it neither respects the light/dark switch nor gets covered by the AA contrast measurement in `src/lib/contrast.ts` / `/dev/design-system`. Each slice that copies this pattern instead of migrating to tokens makes the eventual cleanup bigger and leaves users who prefer light mode looking at a dark-only surface.
- **Rule**: New and migrated UI code must express color exclusively through the token layer (Tailwind utilities backed by `--background`, `--primary`, etc., or `cn()`-merged token-based classes) — never a raw Tailwind palette literal (`bg-purple-600`, `text-blue-100`, hand-picked hex values) and never a new `bg-cosmic`-style utility. If a token needed for a given surface doesn't exist yet, add it to `src/styles/global.css` in both the light and dark blocks (never only one) rather than reaching for a literal.
- **Applies to**: S-08 through S-13 (and any later slice touching `src/components/**` or `src/pages/**`) as they migrate screens off `bg-cosmic` and glass-morphism overrides; not retroactive to code not yet touched by those slices.
