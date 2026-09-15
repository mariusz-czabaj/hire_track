-- S-15: SECURITY DEFINER RPC for editing a recruitment's scalar details,
-- following replace_recruitment_stages' hardening contract (read check
-- before write check, so a caller can never probe for the existence of a
-- recruitment they cannot see; see plan.md's Critical Implementation
-- Details).
--
-- Errcodes:
--   P0002  not_found             -- caller cannot even read the recruitment
--   42501  insufficient_privilege -- caller can read but lacks recruitment.write
create function public.update_recruitment(
  p_id bigint,
  p_title text,
  p_department text,
  p_location text,
  p_employment_type text,
  p_opened_at date
)
returns public.recruitments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recruitment public.recruitments;
begin
  if not (select private.has_recruitment_operation(p_id, 'recruitment.read')) then
    raise exception 'not_found: recruitment % not found', p_id using errcode = 'P0002';
  end if;

  if not (select private.has_recruitment_operation(p_id, 'recruitment.write')) then
    raise exception 'insufficient_privilege: recruitment.write required' using errcode = '42501';
  end if;

  update public.recruitments
  set
    title = p_title,
    department = p_department,
    location = p_location,
    employment_type = p_employment_type,
    opened_at = p_opened_at
  where id = p_id
  returning * into v_recruitment;

  return v_recruitment;
end;
$$;

revoke execute on function public.update_recruitment(bigint, text, text, text, text, date) from public, anon;
grant execute on function public.update_recruitment(bigint, text, text, text, text, date) to authenticated;
