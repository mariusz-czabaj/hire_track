<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Core Recruitment Data Foundation Implementation Plan

- **Plan**: context/changes/core-recruitment-data-foundation/plan.md
- **Scope**: Phase 4 of 4 (full plan review)
- **Date**: 2026-08-31
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Findings

### F1 — `changed_by` FK has no ON DELETE action, permanently blocking user deletion

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260831182957_recruitment_candidate_schema.sql:99
- **Detail**: `candidate_recruitment_status_history.changed_by uuid references auth.users (id)` has no explicit `on delete` action, defaulting to `NO ACTION`. The column is nullable, suggesting the intent is to allow anonymization, but the FK as written will hard-block deleting any `auth.users` row referenced by even one status-history entry. In practice: once a user changes any candidate's stage, that account can never be deleted (no offboarding, no GDPR erasure) without first manually clearing history rows.
- **Fix A ⭐ Recommended**: Change the FK to `on delete set null` — preserves the audit row but drops attribution when the user is deleted.
  - Strength: Consistent with the column already being nullable; a small migration-level change with no app-code impact.
  - Tradeoff: Loses "who did it" for deleted users' past actions — the row becomes anonymous.
  - Confidence: HIGH — standard pattern for audit/history tables referencing user accounts.
  - Blind spot: Requires a new migration since Phase 2's migration is already applied; need to check nothing already depends on `changed_by` never being null.
- **Fix B**: Leave as `NO ACTION` and explicitly document it as an intentional "permanent attribution" business rule.
  - Strength: Preserves strict data lineage; forces a conscious decision (reassign/clear history first) before any account can be deleted.
  - Tradeoff: No user can ever be hard-deleted once they have any history — a future "delete user" feature must account for this.
  - Confidence: MEDIUM — plausible only if the business actually wants permanent attribution; nothing in the PRD states this.
  - Blind spot: Whether GDPR/offboarding requirements apply to this app hasn't been confirmed.
- **Decision**: FIXED via Fix A — supabase/migrations/20260831194556_fix_status_history_changed_by_on_delete.sql

### F2 — `updated_at` never bumped on UPDATE (no trigger)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260831182957_recruitment_candidate_schema.sql:22, 68
- **Detail**: `recruitments.updated_at` and `candidates.updated_at` default to `now()` on INSERT only. Both tables have UPDATE policies (Phase 3), but no `BEFORE UPDATE` trigger refreshes the column — it will only stay accurate if every future app-layer UPDATE manually sets it, which is unverified.
- **Fix**: Add a shared `set_updated_at()` trigger function and attach a `BEFORE UPDATE` trigger to `recruitments` and `candidates`.
- **Decision**: FIXED — supabase/migrations/20260831194708_add_updated_at_triggers.sql

### F3 — Helper functions not marked STABLE

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260831183457_rls_policies.sql:19-48
- **Detail**: `private.has_operation` and `private.has_recruitment_operation` are pure read-only SQL functions but default to `volatile` (no `stable` marker), which prevents planner-level caching/optimization — working against the same performance goal the `(select ...)`-wrapping convention elsewhere in this migration was written to achieve.
- **Fix**: Add `stable` to both function definitions (between `language sql` and `security definer`).
- **Decision**: FIXED — supabase/migrations/20260831195143_mark_rls_helpers_stable.sql

### F4 — RLS verification never tests the core cross-group isolation guarantee

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/rls_verification.sql
- **Detail**: All 4 existing assertions pass (verified live), but none test the property the whole `recruitment_security_groups` design exists for: a user in a group NOT assigned to a recruitment should see 0 rows. Current coverage is "full access" (HR, assigned), "read-only access" (Hiring Manager, also assigned), and "anonymous sees nothing" — a user in an unrelated group is never exercised.
- **Fix**: Add a 5th assertion block with a group/user that has no `recruitment_security_groups` row for the seeded recruitment, asserting `select count(*) from recruitments` is 0 for that user.
- **Decision**: FIXED — seeded an Administrator-group test user (supabase/seed.sql) + assertion (5) in supabase/tests/rls_verification.sql

### F5 — `group_operations` has no timestamp columns

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260831181826_security_rbac_schema.sql:36-41
- **Detail**: `security_groups` and `group_memberships` both have `created_at`; `group_operations` (also admin-managed, also mutable via Phase 3 policies) has none, so there's no audit trail for when a permission grant was added/changed/removed.
- **Fix**: Add `created_at timestamptz not null default now()` for consistency with its sibling tables.
- **Decision**: FIXED — supabase/migrations/20260831195552_add_group_operations_created_at.sql

### F6 — Plan's Phase 4 contract text undercounts its own requirements

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/core-recruitment-data-foundation/plan.md (Phase 4 contract) vs. supabase/seed.sql:29-87
- **Detail**: The plan's Phase 4 contract says seed.sql inserts "one row directly into auth.users" and links the recruitment "to HR/Rekruter" (singular). The actual implementation correctly seeds two test users and assigns the recruitment to both HR/Rekruter and Hiring Manager — which is exactly what the same phase's `rls_verification.sql` contract requires for assertion (3) (a Hiring-Manager-only user must be able to see the recruitment). This is a documentation gap in the plan's own contract text, not an implementation defect.
- **Fix**: Update plan.md's Phase 4 contract wording to describe both seeded test users, so the plan accurately reflects what was correctly built.
- **Decision**: FIXED — plan.md's Phase 4 contract text updated to describe all three seeded users/group links and assertion (5)

### F7 — Timestamp column naming varies across tables

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260831182957_recruitment_candidate_schema.sql (`candidate_recruitments.added_at`, `candidate_recruitment_status_history.changed_at`)
- **Detail**: Most tables use `created_at`, but `candidate_recruitments` uses `added_at` and `candidate_recruitment_status_history` uses `changed_at`. Reads as a deliberate, clearer domain-specific naming choice rather than an oversight, but it diverges from the generic `created_at`/`updated_at` convention.
- **Fix**: No change required — accept as-is, or standardize later if it becomes confusing.
- **Decision**: SKIPPED — naming judged intentional and clear
