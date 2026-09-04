-- S-07 review F1: enforce the "at least one user must retain group.manage"
-- invariant at the database edge rather than only inside the two RPCs.
--
-- 20260904120000 put the PA006 check inside remove_group_member and
-- revoke_group_operation, but 20260831183457_rls_policies.sql grants
-- delete/update on all three RBAC tables directly to `authenticated`, with
-- policies that pass for any group.manage holder. That left four paths to
-- an irreversible lockout that never touch an RPC:
--
--   1. DELETE /rest/v1/group_operations?operation=eq.group.manage
--   2. DELETE /rest/v1/group_memberships (the last admin's membership)
--   3. PATCH  /rest/v1/group_operations flipping group.manage to another value
--   4. DELETE /rest/v1/security_groups, which cascades into both child tables
--
-- Constraint triggers close all four at once, and any future path, because
-- they fire on the table rather than on the code path that reached it. They
-- are DEFERRABLE INITIALLY DEFERRED so the check runs once at commit, after
-- multi-statement work (delete a membership, re-add it elsewhere) has
-- settled -- an immediate check would reject legitimate reshuffles.
--
-- The RPCs keep their own inline `perform private.assert_group_manage_survivor()`.
-- That is deliberate: it raises mid-statement so the existing 422
-- last_admin_required mapping and its integration tests keep their current
-- behaviour, with the trigger acting as the backstop for everything else.

create function private.assert_group_manage_survivor_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_group_manage_survivor();
  return null;
end;
$$;

revoke execute on function private.assert_group_manage_survivor_trigger()
  from public, anon, authenticated;

create constraint trigger group_memberships_last_admin_guard
  after delete or update on public.group_memberships
  deferrable initially deferred
  for each row execute function private.assert_group_manage_survivor_trigger();

create constraint trigger group_operations_last_admin_guard
  after delete or update on public.group_operations
  deferrable initially deferred
  for each row execute function private.assert_group_manage_survivor_trigger();

create constraint trigger security_groups_last_admin_guard
  after delete on public.security_groups
  deferrable initially deferred
  for each row execute function private.assert_group_manage_survivor_trigger();
