-- S-04 impl-review F1: get_user_emails(uuid[]) took an arbitrary array of
-- ids with no authorization check, so any authenticated user could
-- enumerate any other user's email via PostgREST. Replace it with a
-- recruitment-scoped variant that only resolves author ids drawn from
-- candidate_stage_notes rows the caller already has recruitment.read on.
drop function if exists public.get_user_emails(uuid[]);

create function public.get_user_emails_for_candidate(target_candidate_recruitment_id bigint, user_ids uuid[])
returns table (id uuid, email text)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_recruitment_id bigint;
begin
  select cr.recruitment_id into v_recruitment_id
  from public.candidate_recruitments cr
  where cr.id = target_candidate_recruitment_id;

  if v_recruitment_id is null then
    raise exception 'not_found: candidate_recruitment % not found', target_candidate_recruitment_id using errcode = 'P0002';
  end if;

  if not (select private.has_recruitment_operation(v_recruitment_id, 'recruitment.read')) then
    raise exception 'not_found: candidate_recruitment % not found', target_candidate_recruitment_id using errcode = 'P0002';
  end if;

  return query
    select u.id, u.email::text
    from auth.users u
    where u.id = any (user_ids)
      and u.id in (
        select csn.created_by
        from public.candidate_stage_notes csn
        where csn.candidate_recruitment_id = target_candidate_recruitment_id
      );
end;
$$;

revoke execute on function public.get_user_emails_for_candidate(bigint, uuid[]) from public, anon;
grant execute on function public.get_user_emails_for_candidate(bigint, uuid[]) to authenticated;
