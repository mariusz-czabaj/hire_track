-- Both RLS helper functions are pure reads with no side effects within a
-- single statement, but were left at the default VOLATILE, defeating the
-- planner-level caching the (select ...)-wrapping convention elsewhere in
-- this schema relies on. Mark them STABLE.
create or replace function private.has_operation(check_operation operation)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_memberships gm
    join public.group_operations go on go.group_id = gm.group_id
    where gm.user_id = (select auth.uid())
      and go.operation = check_operation
  );
$$;

create or replace function private.has_recruitment_operation(target_recruitment_id bigint, check_operation operation)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.recruitment_security_groups rsg
    join public.group_memberships gm on gm.group_id = rsg.group_id
    join public.group_operations go on go.group_id = rsg.group_id and go.operation = check_operation
    where rsg.recruitment_id = target_recruitment_id
      and gm.user_id = (select auth.uid())
  );
$$;
