-- Impl-review follow-up (F3): the RPC previously returned only the new
-- id, forcing the client to do a second, untransacted select to build
-- the response DTO -- a narrow window where the recruitment is already
-- committed but a transient failure on that second call surfaces a 500
-- with no id. Returning the full row removes the extra round trip and
-- the window entirely.
drop function if exists public.create_recruitment(text, text, text, text, date, bigint[]);

create function public.create_recruitment(
  p_title text,
  p_department text,
  p_location text,
  p_employment_type text,
  p_opened_at date,
  p_group_ids bigint[]
)
returns public.recruitments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recruitment public.recruitments;
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
  returning * into v_recruitment;

  foreach v_group_id in array p_group_ids loop
    insert into public.recruitment_security_groups (recruitment_id, group_id)
    values (v_recruitment.id, v_group_id);
  end loop;

  return v_recruitment;
end;
$$;

revoke execute on function public.create_recruitment(text, text, text, text, date, bigint[]) from public, anon;
grant execute on function public.create_recruitment(text, text, text, text, date, bigint[]) to authenticated;
