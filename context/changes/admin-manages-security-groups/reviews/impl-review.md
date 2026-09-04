<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: S-07 Administrator Manages Security Groups and Users

- **Plan**: context/changes/admin-manages-security-groups/plan.md
- **Scope**: Phases 1-6 of 6 (full plan)
- **Date**: 2026-09-04
- **Verdict**: REJECTED at review; all findings triaged — 9 fixed, 1 skipped (see Triage outcome below)
- **Findings**: 1 critical, 6 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | FAIL    |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | FAIL    |

## Triage outcome (2026-09-04)

All ten findings triaged. **Fixed:** F1, F2, F3, F4, F5, F6, F7, F8, F9. **Skipped:** F10 (cosmetic).

Post-fix verification on a clean database: `npm run typecheck` 0 errors (124 files), `npm run lint` 0 errors, `npm run test` 128 passed (15 files), `npm run test:integration` 107 passed (8 files), `npm run test:rls` passed, `npm run build` succeeded.

Post-triage dimension verdicts: Plan Adherence PASS, Scope Discipline WARNING (justified extra migration), Safety & Quality PASS, Architecture PASS, Pattern Consistency WARNING (F10 skipped by choice), Success Criteria PASS.

## Findings

### F1 — Lockout invariant is bypassable through direct table writes

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260904120000_admin_group_management_rpcs.sql:55-72; supabase/migrations/20260831183457_rls_policies.sql:104-127,236-238
- **Detail**: The `PA006` / `last_admin_required` guard exists only inside `remove_group_member` and `revoke_group_operation`. But `rls_policies.sql:236-238` grants `select, insert, update, delete` on all three RBAC tables directly to `authenticated`, and every delete/update policy passes for any `group.manage` holder. An admin with any REST client reaches lockout on at least four paths that never touch the RPCs:
  1. `DELETE /rest/v1/group_operations?group_id=eq.N&operation=eq.group.manage`
  2. `DELETE /rest/v1/group_memberships?group_id=eq.N` (the last admin's membership)
  3. `PATCH /rest/v1/group_operations` flipping `group.manage` to another enum value (`group_operations_update`, rls_policies.sql:119-122)
  4. `DELETE /rest/v1/security_groups?id=eq.N` — verified: `security_rbac_schema.sql:26,38` cascade both child tables, and there is no RPC or guard on this path at all. Only groups referenced by `recruitment_security_groups` (on delete restrict) are incidentally protected; a group created through the new admin UI is not.
     The RPCs are a UI convention, not an invariant. This is the same mistake class the plan itself calls out at line 108 ("Gating only at the route leaves the function callable directly through PostgREST") — caught for the route layer, missed for the table layer. Result is irreversible RBAC bricking, recoverable only with direct database access.
- **Fix A ⭐ Recommended**: Enforce at the database edge — add a deferrable statement-level `constraint trigger` on `group_memberships`, `group_operations` and `security_groups` invoking `private.assert_group_manage_survivor()` after delete/update.
  - Strength: Closes all four paths at once, including any future path, and reuses the helper function that already exists and is correctly revoked from `authenticated`.
  - Tradeoff: One more migration; deferred constraint triggers need care so the existing RPCs do not double-raise.
  - Confidence: HIGH — the invariant is already written and tested; this only relocates where it fires.
  - Blind spot: Not verified whether a deferred trigger changes the errcode surfaced to the existing 422 mapping.
- **Fix B**: Revoke `delete`/`update` on the three tables from `authenticated` and drop the matching policies, forcing all destructive writes through guarded RPCs (adds a `delete_security_group` RPC).
  - Strength: Smallest possible privileged surface; makes the RPCs genuinely the only door.
  - Tradeoff: Group delete is explicitly out of scope this slice, so this expands scope; also needs a rename path since `update` on `security_groups` is revoked.
  - Confidence: MEDIUM — depends on nothing else relying on those table grants.
  - Blind spot: `renameSecurityGroup` currently writes the table directly and would have to move to an RPC.
- **Decision**: FIXED via Fix A — `supabase/migrations/20260904140000_enforce_last_admin_invariant.sql` adds deferrable constraint triggers on all three tables. Verified: all four bypass paths raise `last_admin_required` at commit, a legitimate membership reshuffle still commits, `npm run test:rls` passes, and all 107 integration tests pass (RPCs keep raising mid-statement, so the existing 422 mapping is unchanged).

### F2 — API routes carry no explicit `group.manage` gate; detail 403 is incidental

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/lib/services/security-groups.ts:73-79,158; src/pages/api/security-groups/[id].ts:28
- **Detail**: `security_groups_select` returns `true` for every authenticated user (rls_policies.sql:69-71), so a non-admin passes the `!group` check in `getSecurityGroupDetail`; authorization only fails later when `get_group_member_emails` raises `42501`. The 403 is correct today but depends on read ordering — moving the `group_operations` select first (it returns `[]` rather than raising) would silently hand a non-admin a 200 with an empty payload. None of the five API routes consults `Astro.locals.operations`, which middleware computes on every request.
- **Fix**: Add `if (!locals.operations.includes("group.manage")) return <403>` as the first statement of each `/api/security-groups*` and `/api/admin/users` handler, keeping the DB checks as the authority (defense in depth, mirroring the RPCs' first-statement guard).
  - Strength: Makes the gate explicit and order-independent; the signal is already resolved in middleware at zero extra cost.
  - Tradeoff: Duplicates authorization in two layers, which must stay in sync.
  - Confidence: HIGH — `locals.operations` is already typed and populated.
  - Blind spot: None significant.
- **Decision**: FIXED — new `src/lib/api/group-manage-guard.ts` exports `requireGroupManage(locals)`; wired as the first statement of all 7 admin handlers. `GET /api/security-groups` deliberately left open for the FR-001a picker. All 107 integration tests still pass, including the 12-case 403 denial matrix.

### F3 — All four planned unit tests are missing

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: N/A (src/lib/api/security-group-errors.test.ts, src/components/admin/*.test.tsx — none exist)
- **Detail**: The plan's Testing Strategy > Unit Tests names four: `handleSecurityGroupError` errcode mapping incl. the logging 500 fallback; zod rejection of empty / whitespace-only / over-length / out-of-catalog input; `SecurityGroupDetail` checkbox revert on failed write; `UserSearchPicker` below-minimum / loading / empty / error states. None were written — `src/lib/api/` and `src/components/admin/` contain no test files, and `npm run test` passes 92 tests across 12 files, none of them from this slice. The component branching in F4 and F5 has no coverage at any layer; the integration suite exercises the API only. Phases 2-4 checked off "Unit tests pass" truthfully but vacuously.
- **Fix**: Write the four planned unit tests, prioritising the two component ones since F4 and F5 are live bugs in exactly that logic.
  - Strength: Restores the plan's stated two-layer strategy and would have caught F4/F5 before review.
  - Tradeoff: Real work — roughly four test files against components with async state.
  - Confidence: HIGH — the repo already has close precedents in `src/components/recruitments/*.test.tsx`.
  - Blind spot: None significant.
- **Decision**: FIXED — added `src/lib/api/security-group-errors.test.ts` (22 tests: full errcode matrix, both 500-fallback logging branches, name/operation zod rejection, and a guard on the five-value catalog), `src/components/admin/UserSearchPicker.test.tsx` (8 tests) and `src/components/admin/SecurityGroupDetail.test.tsx` (6 tests). Unit suite is now 128 tests across 15 files.

### F4 — Optimistic operation toggle races on concurrent checkbox writes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/admin/SecurityGroupDetail.tsx:76-101
- **Detail**: `previous` is captured from the render-scoped `operations` value and `pendingOperation` is a single slot, not a set. Two rapid toggles on different checkboxes are both enabled (only the pending one is disabled); whichever settles second overwrites state derived from a stale `previous`, so a failed second request reverts the first's successful change. The first request's `finally` also clears `pendingOperation` while the second is still in flight, re-enabling its checkbox. `handleAddMember` sets no pending state at all.
- **Fix**: Use functional updates (`setOperations(prev => ...)`) for both the optimistic apply and the revert, and track pending operations in a `Set<Operation>` so each checkbox disables independently.
- **Decision**: FIXED — `pendingOperation` is now `pendingOperations: ReadonlySet<Operation>`, and both the optimistic apply and the revert use functional updates. Pinned by "disables each in-flight checkbox independently", verified to fail against the single-slot version.

### F5 — `UserSearchPicker` renders stale search results out of order

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/admin/UserSearchPicker.tsx:28-54
- **Detail**: `ignoreRef` is a single ref shared across effect runs and line 31 resets it to `false` at the start of each run. Cleanup sets it to `true`, but the next effect immediately sets it back, so an in-flight request from the previous query resolves against `ignoreRef.current === false` and overwrites newer results. The 300 ms debounce masks this most of the time; it is a genuine out-of-order render on slow responses.
- **Fix**: Use a per-run local (`let ignore = false;` inside the effect, `return () => { ignore = true; };`) — the standard React pattern — or an `AbortController` per request.
- **Decision**: FIXED — replaced the shared ref with a per-run `AbortController` (the `let ignore` variant tripped `no-unnecessary-condition`, and aborting also cancels the superseded request rather than merely ignoring it). Pinned by "does not let a slow earlier query overwrite the latest results", verified to fail when `controller.abort()` is removed.

### F6 — Middleware operations lookup throws, 500-ing every route

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:17,31,47
- **Detail**: `resolveCallerOperations` is awaited with no `try`/`catch` and both helpers `throw` on Supabase error. A transient DB error on either query rejects the middleware for every request in the app — `/`, `/auth/*`, static pages included — producing an unhandled 500 rather than a degraded page. It also adds two unconditional round-trips per authenticated request on every route, where the plan's Performance Considerations budgeted "one query per authenticated request".
- **Fix**: Wrap in `try`/`catch`, fall back to `[]` (fails closed for permissions, open for rendering), and log.
- **Decision**: FIXED — `resolveCallerOperations` is wrapped in try/catch with a `[]` fallback and a `console.error`. The two round-trips were left as-is (not flagged as the fix).

### F7 — Integration tests never clean up the groups they create

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/pages/api/security-groups/security-groups.integration.test.ts
- **Detail**: Phase 5's contract says "Tests create and clean up their own groups". There is no `afterAll`/`afterEach` and no delete anywhere in the 327-line file, so `lifecycle-group-*`, `duplicate-name-probe-*` and `duplicate-membership-probe-*` rows accumulate on every run. Progress step 5.4 ("leaves no residual test groups behind") is checked `[x]` but cannot be true as the slice is scoped — group delete is explicitly out of scope, so the suite has no mechanism to clean up. Either the criterion or the scope boundary was wrong, and the checkbox papered over it.
- **Fix A ⭐ Recommended**: Correct step 5.4 in the plan to state that groups persist until `db reset`, and note the cleanup dependency on a future delete capability.
  - Strength: Honest about state; the suite is otherwise thorough and its 12-case denial matrix is the strongest part of this slice.
  - Tradeoff: Repeated local runs slowly accumulate rows until a reset.
  - Confidence: HIGH — matches the plan's own out-of-scope decision.
  - Blind spot: Not measured whether accumulation eventually skews the search-result cap of 20.
- **Fix B**: Add a service-role cleanup hook that deletes test groups directly, bypassing the app's scope boundary.
  - Strength: Genuinely satisfies the written criterion.
  - Tradeoff: Introduces a service-role path into the test suite purely for teardown.
  - Confidence: MEDIUM — depends on whether the integration harness already exposes a service-role client.
  - Blind spot: Haven't checked `integration-client.ts` for an existing service-role export.
- **Decision**: FIXED via Fix A — plan step 5.4 reworded to "test groups persist until the next reset", with a note that `npx supabase db reset` must precede `npm run test:rls`. This was confirmed live during the review: running the integration suite before the RLS suite made `test:rls` fail, and it passed after a reset.

### F8 — Search term passes LIKE metacharacters and skips zod validation

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260904120000_admin_group_management_rpcs.sql:42; src/pages/api/admin/users.ts:12
- **Detail**: `u.email ilike '%' || v_term || '%'` passes `%` and `_` through unescaped, so a `group.manage` holder can pass `%%` (length 2, clears the minimum) or `_a` to sweep the directory 20 rows at a time — defeating the "matches on email alone, capped" intent the migration header claims. Not SQL injection (the value is parameterised) and the caller is already an admin, so the blast radius is small. `users.ts` is also the only new route with no zod schema.
- **Fix**: Escape `%`, `_` and `\` in `v_term` before concatenating (or use `ilike ... escape`), and add `z.string().trim().min(2).max(100)` in `users.ts` to match the house validation convention.
- **Decision**: FIXED — `supabase/migrations/20260904150000_escape_user_search_wildcards.sql` escapes `\`, `%` and `_` (backslash first) and adds `escape '\'`; the length check still runs on the raw term so escaping cannot pad a short search past the minimum. `users.ts` now caps the term at 100 chars via zod. Verified against a live database: `'%%'` and `'_a'` each return 0 rows, `'admin'` still returns its match.

### F9 — Repository typecheck currently fails

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/candidates/candidates-profile.integration.test.ts:135
- **Detail**: `npm run typecheck` fails with 2 errors (ts(18048), ts(2532) — `backendEngineer` possibly undefined). Verified pre-existing: the file's last commit is `5fb6263 feat(candidate-history-search)`, and it is absent from this slice's diff. Not caused by S-07, but it means Progress steps 1.2, 2.1, 3.1 and 4.1 ("Type checking passes") do not hold on the current tree, and the next slice inherits a red gate. `npm run test` (92 passed), `npm run build` and `npm run lint` (0 errors, 14 pre-existing warnings) all pass.
- **Fix**: Add the missing optional-chain guards on line 135 of the candidate-history-search test, or track it as a follow-up against that change.
- **Decision**: FIXED — replaced the inconsistent optional chaining with an explicit narrowing guard. `npm run typecheck` now reports 0 errors across 124 files.

### F10 — Minor deviations: DELETE-with-body, unvalidated route id, undocumented second migration

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/security-groups/[id]/{members,operations}.ts:47-63; src/pages/admin/groups/[id].astro:6; supabase/migrations/20260904130000_group_member_emails_rpc.sql
- **Detail**: Three small items consolidated. (a) `DELETE` with a required JSON body is a new shape here — every other delete-ish route under `src/pages/api/recruitments/` uses path segments; bodies on `DELETE` are legal but dropped by some proxies. (b) Plan §4.3 says the detail page "passes the validated route id"; line 6 is `Astro.params.id ?? ""`, the raw string, interpolated straight into fetch URLs — harmless in practice since the API returns 422, but the contract is unmet. (c) The second migration is sound and explicitly anticipated by Phase 3's "or a member-scoped lookup" — it is guard-first, `search_path`-pinned, joins `group_memberships` so it cannot enumerate beyond one group, and does not reopen the S-04 hole — but the plan's Migration Notes still say "one forward migration".
- **Fix**: Move the delete payloads to path segments (`DELETE .../members/:userId`), validate the id in `[id].astro` with the same `z.coerce.number().int().positive()` used server-side, and correct the Migration Notes to name both migrations.
- **Decision**: SKIPPED — user declined; all three are cosmetic and the API route validates the id server-side regardless.

## Notes

Verified strengths worth preserving: `prerender = false` on all five API routes; every new `SECURITY DEFINER` function has `set search_path = ''` with the permission check as its first statement, matching the `kanban_stage_rpcs.sql:29-45` pattern; grants are `revoke ... from public, anon` + `grant ... to authenticated` throughout; `private.assert_group_manage_survivor` is revoked from `authenticated` and lives in the non-exposed `private` schema; the post-write placement of the invariant check is correct (a pre-check would be racy); no N+1 in member email resolution. The Phase 6 English rename is complete — `grep -r "Rekruter" supabase src` returns nothing, and group id ordering is preserved. No "What We're NOT Doing" boundary was violated. The integration suite's 12-case `it.each` denial matrix (6 write paths × hr/noGroup, asserting 403 **and** unchanged state) and the direct-PostgREST guard test are the strongest work in this slice.
