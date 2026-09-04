-- S-07 Phase 3: resolve email addresses for a group's existing members.
--
-- search_users_for_group_management (20260904120000) only matches on an
-- email search term, so it cannot resolve the emails of users already known
-- by id -- the group detail view needs exactly that. This is the
-- "member-scoped lookup" alternative named in the S-07 plan: gated the same
-- way, but scoped to members of one group rather than an open search.
create function public.get_group_member_emails(target_group_id bigint)
returns table (id uuid, email text)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not (select private.has_operation('group.manage')) then
    raise exception 'insufficient_privilege: group.manage required' using errcode = '42501';
  end if;

  return query
    select u.id, u.email::text
    from auth.users u
    join public.group_memberships gm on gm.user_id = u.id
    where gm.group_id = target_group_id
    order by u.email;
end;
$$;

revoke execute on function public.get_group_member_emails(bigint) from public, anon;
grant execute on function public.get_group_member_emails(bigint) to authenticated;
