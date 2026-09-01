# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Always write code and artifacts in English, regardless of conversation language

- **Context**: Every artifact produced in this repository, at every phase — source code, identifiers, comments, commit messages, UI strings, SQL migrations and seed data (including domain values such as kanban stage names), and all `context/**` documents (`frame.md`, `research.md`, `plan.md`, reviews, `change.md`, roadmap and foundation docs). Applies whether the request arrives in Polish or English.
- **Problem**: The conversation is often held in Polish, and that language leaks into deliverables. It has already happened: the PRD, roadmap, and F-01 change docs are in Polish, and F-01 seeded Polish kanban stage names (`Nowy`, `Screening`, `Rozmowa`, `Oferta`, `Zatrudniony`, `Odrzucony`) into the database while the application UI is English (`<html lang="en">`). The result is a mixed-language codebase with no i18n layer, unreviewable diffs for non-Polish readers, and rework to rename shipped data later.
- **Rule**: Always write code and artifacts in English, even when the user writes in Polish. Respond to the user in their language if they prefer, but never let a non-English string enter a file — if a source document (PRD, notes) is in Polish, translate its content into English in the artifact you produce rather than copying it through, and quote the original only where a verbatim citation is explicitly required.
- **Applies to**: all
