-- S-07: SECURITY DEFINER functions backing security-group administration.
-- Every function follows the hardening contract used by the kanban stage
-- RPCs (20260901162000_kanban_stage_rpcs.sql): the permission check is the
-- first statement, search_path is empty, identifiers are schema-qualified,
-- and execute is granted to authenticated only.
--
-- Errcodes used here:
--   42501  insufficient_privilege -- caller lacks group.manage
--   PA006  last_admin_required    -- the write would leave nobody holding
--                                    group.manage; the raise rolls it back

-- Resolve users by email for the group member picker.
--
-- S-04 removed the unscoped get_user_emails(uuid[]) because any
-- authenticated user could enumerate every account
-- (20260901230000_scope_get_user_emails_rpc.sql). This reopens a lookup only
-- for group.manage holders, matches on email alone, stays inert below a
-- two-character term, and caps the result set.
create function public.search_users_for_group_management(search_term text)
returns table (id uuid, email text)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_term text;
begin
  if not (select private.has_operation('group.manage')) then
    raise exception 'insufficient_privilege: group.manage required' using errcode = '42501';
  end if;

  v_term := trim(coalesce(search_term, ''));

  if length(v_term) < 2 then
    return;
  end if;

  return query
    select u.id, u.email::text
    from auth.users u
    where u.email ilike '%' || v_term || '%'
    order by u.email
    limit 20;
end;
$$;

revoke execute on function public.search_users_for_group_management(text) from public, anon;
grant execute on function public.search_users_for_group_management(text) to authenticated;

-- Raise PA006 when no user anywhere in the system still holds
-- group.manage. Called after the write inside the same transaction, so the
-- raise rolls the offending statement back -- a pre-check would be racy and
-- would have to duplicate the write's own semantics.
create function private.assert_group_manage_survivor()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.group_memberships gm
    join public.group_operations go on go.group_id = gm.group_id
    where go.operation = 'group.manage'
  ) then
    raise exception 'last_admin_required: at least one user must retain group.manage'
      using errcode = 'PA006';
  end if;
end;
$$;

revoke execute on function private.assert_group_manage_survivor() from public, anon, authenticated;

-- Remove a user from a group. Removing a membership that does not exist is
-- a no-op rather than an error.
create function public.remove_group_member(target_group_id bigint, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.has_operation('group.manage')) then
    raise exception 'insufficient_privilege: group.manage required' using errcode = '42501';
  end if;

  delete from public.group_memberships
  where group_id = target_group_id
    and user_id = target_user_id;

  perform private.assert_group_manage_survivor();
end;
$$;

revoke execute on function public.remove_group_member(bigint, uuid) from public, anon;
grant execute on function public.remove_group_member(bigint, uuid) to authenticated;

-- Revoke an operation from a group. Same invariant reached from the other
-- direction: revoking group.manage from the only group holding it.
create function public.revoke_group_operation(target_group_id bigint, target_operation public.operation)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.has_operation('group.manage')) then
    raise exception 'insufficient_privilege: group.manage required' using errcode = '42501';
  end if;

  delete from public.group_operations
  where group_id = target_group_id
    and operation = target_operation;

  perform private.assert_group_manage_survivor();
end;
$$;

revoke execute on function public.revoke_group_operation(bigint, public.operation) from public, anon;
grant execute on function public.revoke_group_operation(bigint, public.operation) to authenticated;
