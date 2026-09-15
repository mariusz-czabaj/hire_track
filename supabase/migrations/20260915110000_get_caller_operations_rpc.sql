-- recruitment-edit-details (Phase 3): `resolveCallerOperations`
-- (src/middleware.ts) queries group_operations directly with the caller's
-- own client to build `Astro.locals.operations`. But group_operations'
-- SELECT policy is admin-only (group.manage), so for every non-admin
-- caller the query returns zero rows and `Astro.locals.operations` is
-- always `[]` -- silently breaking any UI hint (like the recruitment
-- header's "..." menu) gated on it for anyone but an admin. Mirrors the
-- private.has_operation helper's SECURITY DEFINER pattern to bypass that
-- lock-down safely, scoped to the caller's own operations only.
create function public.get_caller_operations()
returns setof operation
language sql
security definer
set search_path = ''
stable
as $$
  select distinct go.operation
  from public.group_memberships gm
  join public.group_operations go on go.group_id = gm.group_id
  where gm.user_id = (select auth.uid());
$$;

revoke execute on function public.get_caller_operations() from public, anon;
grant execute on function public.get_caller_operations() to authenticated;
