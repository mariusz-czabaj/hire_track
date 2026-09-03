-- S-05: SECURITY DEFINER RPCs for the CV lifecycle -- confirming a
-- pending upload as active (demoting the previous active row in the
-- same transaction, since the partial unique index would otherwise
-- reject the promotion), and the two purge-support functions an
-- Administrator needs because they hold neither candidate.read nor
-- candidate.write and so cannot select or update candidate_cvs
-- directly through RLS.
--
-- New errcode, added to the existing codebook
-- (20260901162000_kanban_stage_rpcs.sql, 20260901210500_candidate_write_rpcs.sql):
--   PA005  cv_expired -- a download was attempted past expires_at

-- Promote a pending CV row to active, demoting any existing active row
-- for the same candidate first so the partial unique index
-- (candidate_cvs_one_active_idx) never sees two active rows at once.
-- The superseded row keeps its storage_path so the purge can still find
-- its bytes.
create function public.confirm_candidate_cv(target_cv_id bigint)
returns public.candidate_cvs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate_id bigint;
  v_status text;
  v_row public.candidate_cvs%rowtype;
begin
  select candidate_id, status into v_candidate_id, v_status
  from public.candidate_cvs
  where id = target_cv_id;

  if v_candidate_id is null then
    raise exception 'not_found: candidate CV % not found', target_cv_id using errcode = 'P0002';
  end if;

  if not (select private.has_operation('candidate.write')) then
    raise exception 'insufficient_privilege: candidate.write required' using errcode = '42501';
  end if;

  if v_status <> 'pending' then
    raise exception 'invalid_request: candidate CV % is not pending', target_cv_id using errcode = '22023';
  end if;

  update public.candidate_cvs
  set status = 'superseded'
  where candidate_id = v_candidate_id
    and status = 'active';

  update public.candidate_cvs
  set status = 'active'
  where id = target_cv_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.confirm_candidate_cv(bigint) from public, anon;
grant execute on function public.confirm_candidate_cv(bigint) to authenticated;

-- List every CV row whose bytes are eligible for physical deletion:
-- superseded, or past expires_at, and not already marked deleted.
-- Gated on candidate.write OR group.manage so both an HR user and an
-- Administrator can drive the purge -- mirrors the disjunctive DELETE
-- policy on storage.objects (20260902100100_candidate_cv_storage_policies.sql).
create function public.list_purgeable_candidate_cvs()
returns setof public.candidate_cvs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    (select private.has_operation('candidate.write'))
    or (select private.has_operation('group.manage'))
  ) then
    raise exception 'insufficient_privilege: candidate.write or group.manage required' using errcode = '42501';
  end if;

  return query
  select *
  from public.candidate_cvs
  where object_deleted_at is null
    and (status = 'superseded' or expires_at <= now());
end;
$$;

revoke execute on function public.list_purgeable_candidate_cvs() from public, anon;
grant execute on function public.list_purgeable_candidate_cvs() to authenticated;

-- Record that a row's Storage object has been removed. Separated from
-- the listing above because the Storage API call the purge makes
-- between the two cannot sit inside a transaction -- object deletion
-- must be observed to succeed before this is called (see plan.md's
-- Critical Implementation Details: object first, mark second).
create function public.mark_candidate_cv_object_deleted(target_cv_id bigint)
returns public.candidate_cvs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.candidate_cvs%rowtype;
begin
  if not (
    (select private.has_operation('candidate.write'))
    or (select private.has_operation('group.manage'))
  ) then
    raise exception 'insufficient_privilege: candidate.write or group.manage required' using errcode = '42501';
  end if;

  update public.candidate_cvs
  set object_deleted_at = now()
  where id = target_cv_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'not_found: candidate CV % not found', target_cv_id using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.mark_candidate_cv_object_deleted(bigint) from public, anon;
grant execute on function public.mark_candidate_cv_object_deleted(bigint) to authenticated;
