---
date: 2026-09-03T00:00:00+02:00
researcher: Mariusz Czabaj
git_commit: a37755a78f97bd4d8bc7704a4c740e9e84f7345e
branch: main
repository: mariusz-czabaj/hire_track
topic: "Candidate database — list, search by name, and cross-recruitment status history (S-06)"
tags: [research, codebase, candidates, search, status-history, rls, pagination]
status: complete
last_updated: 2026-09-03
last_updated_by: Mariusz Czabaj
---

# Research: Candidate history search (S-06)

**Date**: 2026-09-03
**Researcher**: Mariusz Czabaj
**Git Commit**: `a37755a78f97bd4d8bc7704a4c740e9e84f7345e` (pushed; permalink base
`https://github.com/mariusz-czabaj/hire_track/blob/a37755a78f97bd4d8bc7704a4c740e9e84f7345e/`)
**Branch**: main
**Repository**: mariusz-czabaj/hire_track

## Research Question

What must slice S-06 (`candidate-history-search`) build to satisfy US-02 / FR-014 / FR-015 /
FR-016 — a "Candidates" view listing all candidates across all recruitments, searchable by
name, where opening a candidate shows every recruitment they took part in together with the
full status-change log per recruitment — and what does the existing codebase already provide,
constrain, or leave unresolved?

## Summary

**S-06 is unusually well prepared for by earlier slices, and the remaining work is narrow but
carries one genuine product decision and two genuine engineering firsts.**

Three things were built ahead of time, explicitly and by name, for this slice:

1. **The history table exists and has never been read.** `candidate_recruitment_status_history`
   has been in the schema since F-01, is append-only, is populated by both S-04 write RPCs, and
   is indexed on `candidate_recruitment_id` with the annotation "(S-06's per-candidate history
   query)". Outside the generated `src/db/database.types.ts`, **no application code touches it**.
   S-06 is its first reader.
2. **The search index exists.** `pg_trgm` is enabled and a GIN trigram index sits on
   `candidates.full_name`, commented "Trigram search index for name lookup (S-06)". F-01
   deliberately pre-committed the project to a trigram/`ILIKE` strategy and explicitly licensed
   S-06 to swap to full-text search instead, at S-06's own cost.
3. **The candidate-scoped route family exists.** S-05 shipped `/candidates/:candidateId`,
   `GET|PATCH /api/candidates/[candidateId]`, `candidate-profile.ts`, and `CandidateProfileDto`
   — and did so partly _so that S-06 would inherit rather than rework it_. `/candidates` is
   already in `PROTECTED_ROUTES`.

Because `getCandidateProfile` already returns each recruitment the candidate is in with its
_current_ stage, **FR-016 is roughly half-built**. The missing half is the per-recruitment
status log.

The three things S-06 must actually resolve:

- **A product decision (blocking):** FR-016 promises "all recruitments they participated in",
  but RLS scopes `candidate_recruitments` and the history table per security group while
  `candidates` is deliberately org-wide. A viewer who is not in every group will silently see a
  _truncated_ list. Whether to truncate silently or disclose a withheld count is unresolved
  anywhere in the docs, and a disclosure is itself a small information leak. This is the same
  boundary as test-plan Risk #4.
- **An engineering first (pagination):** FR-014 is a global, unbounded list. The repo has no
  pagination anywhere, and an unbounded query has been waved through three times before
  ("verified at seed scale only"). PostgREST caps at `max_rows = 1000`, and the NFR is a 2s
  load budget. S-06 is where this finally has to be answered.
- **An engineering first (debounced search UI):** there is no debounce hook or utility in the
  repo, and `useApiResource` refetches on every `url` change — so a naive search box fires one
  request per keystroke.

Two smaller traps: **attribution** ("who moved this candidate") cannot be shown without
touching `get_user_emails_for_candidate`, the RPC that was rewritten after a CRITICAL
email-enumeration finding — and `changed_by` can legitimately be `null`. And **history
completeness is a convention, not a constraint**: a direct PostgREST update of
`candidate_recruitments.current_stage_id` writes no history row. S-06 is the first surface where
that gap becomes visible to a user.

## Detailed Findings

### 1. The status-history table — schema, guarantees, and gaps

Defined at [recruitment_candidate_schema.sql:94-105](supabase/migrations/20260831182957_recruitment_candidate_schema.sql:94):

```sql
create table candidate_recruitment_status_history (
  id bigint generated always as identity primary key,
  candidate_recruitment_id bigint not null references candidate_recruitments (id) on delete cascade,
  from_stage_id bigint references kanban_stages (id),      -- NULL = initial add
  to_stage_id bigint not null references kanban_stages (id),
  changed_by uuid references auth.users (id),              -- ON DELETE SET NULL (see below)
  changed_at timestamptz not null default now()
);
create index candidate_recruitment_status_history_cr_id_idx on ... (candidate_recruitment_id);
```

- **It carries no note text.** Notes live in `candidate_stage_notes`, keyed
  `(candidate_recruitment_id, stage_id)` ([candidate_stage_notes.sql:7](supabase/migrations/20260901210000_candidate_stage_notes.sql:7)).
  Because S-04's gate requires a note on the stage _being left_, a history row joins to its note
  by `(candidate_recruitment_id, from_stage_id)` — not `to_stage_id`. Getting this backwards
  would attach the wrong note to every transition.
- **Append-only forever.** No UPDATE/DELETE policy exists or is intended, and the grant is
  `select, insert` only ([rls_policies.sql:244](supabase/migrations/20260831183457_rls_policies.sql:244)).
- **`changed_by` is nullable and becomes null on user deletion** — the FK was changed to
  `ON DELETE SET NULL` by F-01 impl-review finding F1
  ([impl-review.md:41](context/changes/core-recruitment-data-foundation/reviews/impl-review.md:41)).
  The log UI must render an anonymous entry.
- **`from_stage_id` / `to_stage_id` are unindexed.** S-03 declined to index them, and S-04
  recorded that "if history queries appear in S-06 the index decision should be revisited
  there". **That revisit is now due** — though note the per-candidate query drives off the
  already-indexed `candidate_recruitment_id`, so the stage-side indexes may still not be needed.
- **Stage names in history are stable.** Any history row permanently pins its stage against
  deletion via the referenced-stage guard
  ([extend_stage_referenced_guard.sql:63-75](supabase/migrations/20260901210100_extend_stage_referenced_guard.sql:63)).
  **Correctness note:** the log must resolve stage names by joining `kanban_stages` directly on
  `from_stage_id`/`to_stage_id`, _not_ by re-resolving the recruitment's current stage set via
  `resolveKanbanStages` — a recruitment's stages may have been replaced since the transition,
  and the historical rows are what the log is about.

#### History is written only by the RPCs — completeness is a convention

Rows are inserted at exactly two places, both in
[candidate_write_rpcs.sql](supabase/migrations/20260901210500_candidate_write_rpcs.sql):
`add_candidate_to_recruitment` writes `(null → initial stage)` at
[:103](supabase/migrations/20260901210500_candidate_write_rpcs.sql:103), and
`move_candidate_stage` writes `(source → target)` at
[:173](supabase/migrations/20260901210500_candidate_write_rpcs.sql:173). **No trigger backfills
it.** Meanwhile `candidate_recruitments_update` RLS still permits a bare PostgREST update of
`current_stage_id` by any `recruitment.write` holder — such a write leaves no history row. This
was already characterised (not fixed) under test-plan Risk #5. Consequence: the log can, in
principle, disagree with `current_stage_id`, and S-06 is the first place a user would see it.

Seed data does backfill one initial-add row per candidate
([seed.sql:268-278](supabase/seed.sql:268)), so seeded candidates are not history-less.

### 2. The authorization asymmetry — the defining tension of S-06

Authorization lives entirely in Postgres; no API handler performs a group check, and there is no
service-role client anywhere in the repo. Two helper tiers
([mark_rls_helpers_stable.sql:5-36](supabase/migrations/20260831195143_mark_rls_helpers_stable.sql:5)):
`private.has_operation(op)` is org-wide, `private.has_recruitment_operation(id, op)` requires
membership **and** the operation on the _same_ group attached to that recruitment.

| Table                                  | SELECT policy                                                   | Scope                                                                          |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `candidates`                           | `has_operation('candidate.read')`                               | **org-wide** ([:179](supabase/migrations/20260831183457_rls_policies.sql:179)) |
| `candidate_recruitments`               | `has_recruitment_operation(recruitment_id, 'recruitment.read')` | per group ([:194](supabase/migrations/20260831183457_rls_policies.sql:194))    |
| `candidate_recruitment_status_history` | `EXISTS` → parent `candidate_recruitments` read                 | per group ([:210](supabase/migrations/20260831183457_rls_policies.sql:210))    |
| `candidate_stage_notes`                | `EXISTS` → parent read                                          | per group                                                                      |
| `recruitments`                         | `has_recruitment_operation(id, 'recruitment.read')`             | per group                                                                      |

The org-wide candidate scope is **intentional and was justified by FR-015/FR-016 in F-01's own
plan**: "FR-015/FR-016 and the Access Control guardrail describe candidate visibility as org-wide
for any authenticated user with the read operation — not scoped per-recruitment-group"
([plan.md:22](context/changes/core-recruitment-data-foundation/plan.md:22)), echoed in the
migration comment at
[rls_policies.sql:175-178](supabase/migrations/20260831183457_rls_policies.sql:175).

So the boundary S-06 inherits is: **a viewer with `candidate.read` sees every candidate's
identity (FR-014/FR-015 work as written), but sees only the subset of that candidate's
recruitments, stages, `added_at`, notes, and history that their groups permit (FR-016 is
necessarily partial).**

This is not a defect to fix — it is the guardrail at [prd.md:117](context/foundation/prd.md:117)
("no candidate data available to an unauthorized user") beating the literal wording of FR-016,
and it is exactly what test-plan Risk #4 asserts. **The oracle for any FR-016 test is therefore
"the visible subset", never "every row".**

**Open product decision:** silent truncation, or a "N recruitments not visible to you" hint? The
hint is itself a small disclosure (it reveals that the candidate exists in groups you cannot
see). Nothing in the PRD, roadmap, or any prior change doc resolves this. See Open Questions.

### 3. What S-05 already built that S-06 extends

- Page [candidates/[candidateId].astro](src/pages/candidates/[candidateId].astro) — thin shell,
  passes the raw param to a `client:load` island.
- Endpoint [api/candidates/[candidateId]/index.ts](src/pages/api/candidates/[candidateId]/index.ts)
  — canonical `GET`/`PATCH` template.
- Service [candidate-profile.ts:24-68](src/lib/services/candidate-profile.ts:24) —
  `getCandidateProfile` already issues the "recruitments this candidate is in" query with
  `recruitments(title)` and `kanban_stages(name)` joined, mapping to
  `CandidateRecruitmentSummaryDto { recruitmentId, candidateRecruitmentId, title, stageName, addedAt }`
  ([types.ts:129](src/types.ts:129)).
- Island [CandidateProfile.tsx](src/components/candidates/CandidateProfile.tsx) already renders a
  "Recruitments" card linking each entry to
  `/recruitments/{recruitmentId}/candidates/{candidateRecruitmentId}`.
- `/candidates` is already protected ([middleware.ts:5](src/middleware.ts:5)) — **no middleware
  change is needed**.

**The delta for FR-016 is therefore: add a per-recruitment `history[]` to that existing
summary** (a new `CandidateStatusHistoryEntryDto` — no such type exists today), plus the new
list/search surface for FR-014/FR-015.

Note the two ids in circulation: `candidateId` (`candidates.id`, used by `/candidates/:id`) and
`candidateRecruitmentId` (`candidate_recruitments.id`, used by recruitment-scoped routes). Both
travel on `CandidateCardDto` ([types.ts:57](src/types.ts:57)). Nothing currently links _to_
`/candidates/{candidateId}` from anywhere — the new list is the first such entry point.

### 4. Attribution: showing "who changed the status"

FR-016 requires a "full log of status changes"; it does **not** require the actor. That matters,
because showing the actor is the expensive option:

`auth.users` is not exposed to PostgREST ([config.toml:13](supabase/config.toml:13)). The only
bridge is `get_user_emails_for_candidate(target_candidate_recruitment_id, user_ids)`
([scope_get_user_emails_rpc.sql](supabase/migrations/20260901230000_scope_get_user_emails_rpc.sql)),
which exists **because its predecessor `get_user_emails(uuid[])` was a CRITICAL S-04 impl-review
finding — any authenticated user could enumerate every account's email**. The replacement checks
`recruitment.read` and, crucially, only resolves ids that appear in
`candidate_stage_notes.created_by` **for that one candidate_recruitment**
([:34-38](supabase/migrations/20260901230000_scope_get_user_emails_rpc.sql:34)).

Therefore it will **not** resolve a `changed_by` uuid from status history unless that same person
also authored a note on that same candidate_recruitment. Options for S-06:

- **Omit the actor** (cheapest; satisfies FR-016 as written; avoids reopening the enumeration
  surface). Recommended default.
- **Widen the RPC's allowlist** to also admit ids drawn from
  `candidate_recruitment_status_history.changed_by` for that candidate_recruitment. Still scoped,
  still per-`candidate_recruitment` — but it must be called once per recruitment, N times for a
  candidate in N recruitments, and it re-touches the repo's highest-recurrence pitfall class.

Either way `changed_by` may be `null`, so an anonymous rendering is required regardless.

### 5. Search: strategy, and what the column actually is

- `pg_trgm` enabled at [:11](supabase/migrations/20260831182957_recruitment_candidate_schema.sql:11);
  GIN trigram index on `full_name` at
  [:77](supabase/migrations/20260831182957_recruitment_candidate_schema.sql:77).
- F-01's rationale ([plan.md:250](context/changes/core-recruitment-data-foundation/plan.md:250)):
  the index "commits to a trigram/`ILIKE`-style search strategy now so S-06 doesn't hit a
  sequential scan on day one; if S-06's plan later wants full-text search instead, this index can
  be dropped/replaced without touching any other table."
- **There is no `tsvector`, no FTS index, and no `ILIKE` anywhere in `src/` or `supabase/` today.**
  There is also no trigram index on `email` — only the `lower(email)` btree unique index, which
  supports exact case-insensitive match, not substring search.
- **FR-015 says "by first/last name" but the column is a single `full_name`.** No first/last split
  exists and none is needed: a trigram/`ILIKE '%q%'` over `full_name` matches either token. Worth
  stating explicitly in the plan so it is not read as a gap.

### 6. Conventions the new surfaces must follow

**API route template** (from [board.ts](src/pages/api/recruitments/[id]/board.ts) and
[candidates/[candidateId]/index.ts](src/pages/api/candidates/[candidateId]/index.ts)):
`export const prerender = false`; uppercase method exports typed `APIRoute` taking a single
`context`; module-level zod schemas (`z.coerce.number().int().positive()` for id params); JSON
parse guard → 422; zod issues flattened into `fields` via `fields[key] ??= issue.message`;
`createClient(context.request.headers, context.cookies)` with the `supabase_unconfigured` 500
guard; **no per-route auth check** (middleware owns 401); `null` from a service → 404;
`jsonOk(data)` on success; `catch` → `handleCandidateProfileError`
([candidate-errors.ts](src/lib/api/candidate-errors.ts)). Nested routing —
`[id]/index.ts`, never `[id].ts` beside an `[id]/` directory.

**Query params** — the only precedent is
[recruitments/index.ts:21-29](src/pages/api/recruitments/index.ts:21): read via
`context.url.searchParams.get(...)`, validate with a module-level zod schema, 422 on failure.
A `?q=` param plus any pagination params follow this shape.

**Services** — `client: Client` always first; services never construct a client; Supabase errors
re-thrown raw so `.code` reaches the route mapper; absence returned as `null`; snake_case→camelCase
mapping inline; joined-row shapes declared as a local `interface XRow` applied via
`.overrideTypes<Row[], { merge: false }>()`. **Module split follows scope**: `candidates.ts` is
recruitment-scoped, `candidate-profile.ts` is candidate-scoped — prior docs state that mixing the
two is what made the S-04 DTO ambiguous. **A candidates list/search service belongs in the
candidate-scoped family, not `candidates.ts`.**

**A read-only search needs no RPC.** Prior docs are explicit that RPCs exist for atomicity and
the 404/403 split, not convenience — and every `SECURITY DEFINER` helper shipped so far that
lacked its own authz check became a review finding. Plain RLS-covered `.from()` reads are the
right tool here.

**Frontend** — Astro shell + one `client:load` island fetching its own JSON via `useApiResource`
(hand-rolled `fetch` in a component is a repeat review finding: S-01 plan-review F4, S-04
impl-review F4). Filter state syncs to the query string via `window.history.replaceState` so the
view is shareable — [RecruitmentList.tsx:28-46](src/components/recruitments/RecruitmentList.tsx:28)
is the exact template for the search box (`initialX` prop → `useState` → `useMemo` URL →
`syncUrl`). Dates render `en-CA` for locale stability. States: loading → `Skeleton`; `not-found`
→ local `NotFoundState`; `error` → `ServerError`; empty success → the centered
`rounded-xl border border-white/10 bg-white/5 …` paragraph.

**shadcn/ui inventory** ([src/components/ui/](src/components/ui/)): `badge`, `button`, `card`,
`dialog`, `skeleton`, plus hand-rolled `textarea` and `file-input`. **There is no `input`,
`table`, `select`, or `pagination` component**, and no table anywhere — lists are `<a>`-wrapped
`<Card>` rows. A search input needs either `FormField`
([FormField.tsx:22](src/components/auth/FormField.tsx:22), requires an `icon` prop) or
`npx shadcn@latest add input`.

**No debounce exists anywhere in the repo** (zero grep hits), and
[useApiResource.ts:67](src/components/hooks/useApiResource.ts:67) refetches on every `url` change
— so a search box without a new debounce hook in `src/components/hooks/` fires one request per
keystroke.

**Migrations** — never edit a merged migration; ship `create or replace` in a new file. RPCs must
be `security definer`, `set search_path = ''`, fully schema-qualified, re-check the operation
themselves, live in `public`, and grant execute to `authenticated` only. **`PA006` is the next
free application errcode**; every new code must be mapped in `candidate-errors.ts` in the same
phase that raises it (unmapped codes falling through to a raw 500 is a twice-repeated finding).

**Testing** ([test-plan.md](context/foundation/test-plan.md) §6) — unit beside the unit with the
hand-rolled `FakeQueryBuilder` (each service test file keeps its own copy; there is no shared
stub helper); integration as `<route>.integration.test.ts` beside the route against a live local
Supabase, never mocking the DB, creating its own fixtures, **no global-count assertions and no
`beforeEach` truncation** — the last point directly forbids "the list returns exactly N
candidates" as an assertion, which is the obvious wrong instinct for FR-014. Cross-cutting
authorization assertions go in the single
[authorization.integration.test.ts](src/pages/api/authorization.integration.test.ts), not beside
the route, with the **paired-read-back rule** (never assert a status code alone) and the
**symmetry rule** (test both directions; a one-directional isolation test passes when a bug hides
everything from everyone — this tautology already shipped once). Use the `tenantPeer` principal
(same operations, different group). Every new read surface also owes a numbered assertion in
[supabase/tests/rls_verification.sql](supabase/tests/rls_verification.sql).

Standard verification block ending every plan: `npx supabase db reset --local`, `npm run test:rls`,
`test`, `test:integration`, `test:e2e`, `lint`, `typecheck`, `build`, and
`npm run db:types && git diff --exit-code src/db/database.types.ts`.

### 7. Seed fixtures are insufficient to demonstrate FR-016

[seed.sql:215-278](supabase/seed.sql:215) creates six candidates. **Every one belongs to exactly
one recruitment and has exactly one history row** (the initial add). Five are in "Backend
Engineer" (Tenant A), one — Tomasz Kaminski — is in "Data Analyst" (Tenant B), deliberately as the
Risk #1/#4 read-boundary fixture.

So **no fixture demonstrates the thing FR-016 exists for**: a candidate in _multiple_
recruitments with a _multi-step_ log. S-06 must extend the seed. The highest-value fixture is a
single candidate present in both Backend Engineer _and_ Data Analyst with several moves in each —
that one row simultaneously proves FR-016's multi-recruitment log and serves as the Risk #4
truncation fixture (the `tenantPeer` principal must see the candidate, one recruitment, and
exactly the history of that one).

## Code References

- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:11` — `pg_trgm` extension
- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:62-77` — `candidates`, `lower(email)` unique index, trigram index tagged for S-06
- `supabase/migrations/20260831182957_recruitment_candidate_schema.sql:79-105` — `candidate_recruitments` and the history table + its index
- `supabase/migrations/20260831183457_rls_policies.sql:175-231` — the candidates / candidate_recruitments / history SELECT policies (the asymmetry)
- `supabase/migrations/20260831183457_rls_policies.sql:244` — history grant is `select, insert` only
- `supabase/migrations/20260901210500_candidate_write_rpcs.sql:103,173` — the only two history writers
- `supabase/migrations/20260901210100_extend_stage_referenced_guard.sql:63-75` — history pins stages against deletion
- `supabase/migrations/20260901230000_scope_get_user_emails_rpc.sql:34-38` — the note-only allowlist that blocks `changed_by` resolution
- `supabase/seed.sql:215-278` — candidate/history fixtures (one recruitment, one history row each)
- `src/types.ts:129-155` — `CandidateRecruitmentSummaryDto`, `CandidateProfileDto` (no history DTO exists)
- `src/lib/services/candidate-profile.ts:24-68` — the query S-06 extends with `history[]`
- `src/lib/services/candidates.ts:132-145` — the per-`candidate_recruitment` email-resolution pattern
- `src/pages/api/candidates/[candidateId]/index.ts` — canonical endpoint template
- `src/pages/api/recruitments/index.ts:21-29` — the only query-param precedent
- `src/middleware.ts:5` — `/candidates` already protected
- `src/components/hooks/useApiResource.ts:67` — refetch-on-url-change (why debounce is needed)
- `src/components/recruitments/RecruitmentList.tsx:24-46` — `buildUrl` / `syncUrl` template for the search box
- `supabase/config.toml:18` — PostgREST `max_rows = 1000`

## Architecture Insights

- **Authorization is a database property, not an application one.** Every S-06 read is safe by
  construction _provided_ it goes through the caller's RLS-scoped client and adds no
  `SECURITY DEFINER` shortcut. The single highest-recurrence defect class in this repo is a
  definer function shipped without its own authz re-check.
- **The write path owns the audit trail.** Because no trigger writes history, "the log is
  complete" is a property of the application always calling the RPCs — not of the schema. S-06
  makes that invariant user-visible for the first time.
- **Scope determines module placement.** `candidates.ts` (recruitment-scoped) vs
  `candidate-profile.ts` (candidate-scoped) is an enforced boundary, and a prior DTO ambiguity is
  attributed to blurring it.
- **Deliberate forward-building.** F-01 planted the history table, its index, the trigram index,
  and the email dedup key specifically for S-06, and S-05 shaped its route family so S-06 would
  inherit it. S-06 should extend those, not parallel them.
- **Unbounded queries have been deferred three times** (S-01 F3, S-03, S-04) on the grounds that
  each list was recruitment-scoped. FR-014 is the first genuinely global list, so the deferral
  chain ends here.

## Historical Context (from prior changes)

- `context/changes/core-recruitment-data-foundation/plan-brief.md:21` — the history table was
  created at F-01 because "S-06 needs a full log; adding it later means a migration + a decision
  about unrecoverable pre-existing history".
- `context/changes/core-recruitment-data-foundation/plan-brief.md:25` — the `lower(email)` dedup
  key exists because without it "S-06's history search silently fragments".
- `context/changes/core-recruitment-data-foundation/plan.md:22` — org-wide `candidates` visibility
  justified by FR-015/FR-016.
- `context/changes/core-recruitment-data-foundation/plan.md:250` — trigram index rationale and the
  explicit licence for S-06 to switch to FTS.
- `context/changes/core-recruitment-data-foundation/reviews/impl-review.md:24-41` — F1:
  `changed_by` FK changed to `ON DELETE SET NULL`, so history authors can be null.
- `context/changes/recruiter-manages-candidate-status/reviews/impl-review.md:33-45` — the CRITICAL
  `get_user_emails` email-enumeration finding and its scoped replacement.
- `context/changes/recruiter-manages-candidate-status/plan.md:77` and
  `recruiter-views-kanban-board/plan.md:57` — cross-recruitment search explicitly fenced off "— S-06".
- `context/changes/candidate-profile-and-cv-upload/plan.md:104-105` and `change.md:34` — S-05
  created the candidate-scoped route family with no list/search "so S-06 inherits the resource
  instead of reworking it".
- `context/changes/candidate-profile-and-cv-upload/change.md:60-67` — for plain RLS-covered
  (non-RPC) reads and updates, a denied caller and a nonexistent row are indistinguishable and
  both surface as 404. Relevant to how the new endpoints report tenancy denial.
- `context/changes/recruiter-customizes-kanban-stages/reviews/impl-review.md:29` — the
  one-directional isolation-test tautology that became the cookbook's symmetry rule.
- `context/foundation/lessons.md:5-10` — all artifacts in English, including `context/**`; the PRD
  and roadmap are pre-lesson Polish, so PRD lines must be translated when quoted, not copied.
- `context/archive/` is empty — nothing has been archived yet.

## Related Research

- `context/changes/core-recruitment-data-foundation/plan.md` — schema and RLS rationale
- `context/changes/recruiter-manages-candidate-status/research.md` — status/stage model, history
  write path, note gate
- `context/changes/testing-authorization-tenancy-contract/research.md` — the tenancy model and
  Risk #4/#5 framing this slice must satisfy
- `context/changes/candidate-profile-and-cv-upload/research.md` — the candidate-scoped route
  family S-06 extends

## Open Questions

1. **(Blocking — product) FR-016 truncation disclosure.** When a viewer's groups do not cover
   every recruitment a candidate appears in, does the profile show only the visible ones
   silently, or disclose "N further recruitments not visible to you"? A count is itself a small
   disclosure. Owner: user. Recommendation if unanswered: **silent truncation**, since it is the
   strictly more conservative reading of the guardrail at `prd.md:117` — but this must be an
   explicit decision recorded in the plan, not a default, because it changes the FR-016 test
   oracle.
2. **(Blocking — engineering) Pagination shape for FR-014.** The global candidates list is the
   first unbounded list in the repo; PostgREST caps at 1000 rows and the NFR is a 2s budget. Are
   we shipping offset pagination, a "load more" cursor, or a hard result cap with a
   "refine your search" hint? No precedent exists. Owner: team, at `/10x-plan`.
3. **(Non-blocking) Show the actor on each history entry?** FR-016 does not require it. Showing it
   means widening `get_user_emails_for_candidate`'s allowlist to `changed_by` — a scoped, safe
   change, but one that re-touches the repo's most-repeated defect class and costs one RPC call
   per recruitment. Recommendation: **omit in S-06**, note it as a follow-up.
4. **(Non-blocking) Trigram/`ILIKE` vs full-text search.** F-01 pre-committed to trigram and
   licensed a swap. Recommendation: **keep trigram** — FR-015 is substring name matching, which is
   exactly what the existing index serves; FTS would add a migration and stemming semantics nobody
   asked for. Minimum query length (to avoid a 1-character scan) should be decided in the plan.
5. **(Non-blocking) Revisit indexing `from_stage_id`/`to_stage_id`?** S-04 flagged this as due at
   S-06. Likely still unnecessary: the per-candidate log drives off the indexed
   `candidate_recruitment_id`, and the stage join is a PK lookup. Confirm against the query plan
   rather than adding indexes speculatively.
6. **(Non-blocking) Does `updated_at` matter for the list?** `candidate_recruitments` has
   `added_at` but no `updated_at`, so "last activity" for a candidate can only come from
   `max(changed_at)` over history. If the list is to be sorted by recency rather than name, that
   is an extra aggregate — decide the default sort order in the plan.
7. **(Inherited, non-blocking) History completeness.** Direct PostgREST updates of
   `current_stage_id` write no history row (test-plan Risk #5, deferred to test-plan Phase 2).
   S-06 does not have to close this, but should not assume the log and `current_stage_id` always
   agree.
8. **(Inherited, informational)** Roadmap Open Questions 1 & 2 — QPS and data volume — remain
   unanswered and bear directly on questions 2 and 4 above.
9. **(Process) Test-plan §7 caveat.** §7 currently excludes status-change reversibility with the
   note "Re-evaluate if the status history schema changes." If S-06 alters that schema (it should
   not need to), §7 must be revisited.
