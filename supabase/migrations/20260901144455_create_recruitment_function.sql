-- Atomic recruitment creation: solves the chicken-and-egg where a
-- freshly inserted recruitment has no recruitment_security_groups row
-- yet, so recruitments_select (scoped through that join table) makes the
-- new row invisible to its own creator before a client can insert the
-- link separately. A SECURITY DEFINER function inserts the recruitment
-- and its group links in one transaction, so the row is never
-- visible-but-unlinked or linked-but-invisible. SECURITY DEFINER bypasses
-- RLS, so the function re-checks has_operation('recruitment.write')
-- itself, mirroring the recruitments_insert policy's own check.
--
-- Lives in the public schema (not private, like the RLS helper
-- functions) because it must be reachable over PostgREST's RPC endpoint
-- via supabase-js's .rpc() call from the client -- only public (and
-- graphql_public) are exposed per supabase/config.toml's [api] section,
-- while the private schema is reachable only from within SQL (e.g. RLS
-- policy expressions), which is how the existing private.* helpers are
-- used.
create or replace function public.create_recruitment(
  p_title text,
  p_department text,
  p_location text,
  p_employment_type text,
  p_opened_at date,
  p_group_ids bigint[]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recruitment_id bigint;
  v_group_id bigint;
begin
  if not (select private.has_operation('recruitment.write')) then
    raise exception 'insufficient_privilege: recruitment.write required' using errcode = '42501';
  end if;

  if p_group_ids is null or array_length(p_group_ids, 1) is null then
    raise exception 'invalid_request: at least one security group is required' using errcode = '22023';
  end if;

  insert into public.recruitments (title, department, location, employment_type, opened_at)
  values (p_title, p_department, p_location, p_employment_type, p_opened_at)
  returning id into v_recruitment_id;

  foreach v_group_id in array p_group_ids loop
    insert into public.recruitment_security_groups (recruitment_id, group_id)
    values (v_recruitment_id, v_group_id);
  end loop;

  return v_recruitment_id;
end;
$$;

revoke execute on function public.create_recruitment(text, text, text, text, date, bigint[]) from public, anon;
grant execute on function public.create_recruitment(text, text, text, text, date, bigint[]) to authenticated;
