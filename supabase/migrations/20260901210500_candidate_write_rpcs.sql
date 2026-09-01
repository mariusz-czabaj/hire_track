-- S-04: SECURITY DEFINER RPCs for the two candidate write paths --
-- adding a candidate to a recruitment, and moving one between stages.
-- move_candidate_stage is the sole sanctioned path for changing
-- current_stage_id: candidate_recruitments_update (rls_policies
-- migration) already lets any recruitment.write holder UPDATE the
-- column through bare PostgREST, so the note-required gate only holds
-- if the application never issues that update directly.
--
-- Two new errcodes, added to the existing codebook
-- (20260901162000_kanban_stage_rpcs.sql):
--   PA003  candidate_name_mismatch -- email matches an existing candidate under a different name
--   PA004  note_required           -- no note exists for the stage being left

-- Find-or-create a candidate by email and link them to a recruitment in
-- its lowest-sort-order stage, atomically with the initial history row.
create function public.add_candidate_to_recruitment(
  target_recruitment_id bigint,
  full_name text,
  email text,
  phone text default null
)
returns public.candidate_recruitments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text;
  v_email text;
  v_phone text;
  v_existing_id bigint;
  v_existing_name text;
  v_candidate_id bigint;
  v_stage_id bigint;
  v_cr public.candidate_recruitments%rowtype;
begin
  if not (select private.has_recruitment_operation(target_recruitment_id, 'recruitment.read')) then
    raise exception 'not_found: recruitment % not found', target_recruitment_id using errcode = 'P0002';
  end if;

  if not (select private.has_recruitment_operation(target_recruitment_id, 'recruitment.write')) then
    raise exception 'insufficient_privilege: recruitment.write required' using errcode = '42501';
  end if;

  if not (select private.has_operation('candidate.write')) then
    raise exception 'insufficient_privilege: candidate.write required' using errcode = '42501';
  end if;

  v_full_name := trim(full_name);
  v_email := trim(email);
  v_phone := nullif(trim(phone), '');

  if v_full_name is null or length(v_full_name) = 0 or length(v_full_name) > 200 then
    raise exception 'invalid_request: full name is invalid' using errcode = '22023';
  end if;

  if v_email is null or length(v_email) = 0 or length(v_email) > 255 then
    raise exception 'invalid_request: email is invalid' using errcode = '22023';
  end if;

  select c.id, c.full_name into v_existing_id, v_existing_name
  from public.candidates c
  where lower(c.email) = lower(v_email);

  if v_existing_id is not null then
    if v_existing_name <> v_full_name then
      raise exception 'candidate_name_mismatch: a candidate with email % already exists as "%"', v_email, v_existing_name
        using errcode = 'PA003';
    end if;
    v_candidate_id := v_existing_id;
  else
    insert into public.candidates (full_name, email, phone)
    values (v_full_name, v_email, v_phone)
    returning id into v_candidate_id;
  end if;

  -- Resolved stage set: the recruitment's override stages if any exist,
  -- else the global defaults -- same rule as
  -- src/lib/services/recruitments.ts's resolveKanbanStages.
  select id into v_stage_id
  from public.kanban_stages
  where recruitment_id = target_recruitment_id
  order by sort_order asc
  limit 1;

  if v_stage_id is null then
    select id into v_stage_id
    from public.kanban_stages
    where recruitment_id is null
    order by sort_order asc
    limit 1;
  end if;

  begin
    insert into public.candidate_recruitments (candidate_id, recruitment_id, current_stage_id)
    values (v_candidate_id, target_recruitment_id, v_stage_id)
    returning * into v_cr;
  exception
    when unique_violation then
      raise exception 'invalid_request: candidate is already added to this recruitment' using errcode = '22023';
  end;

  insert into public.candidate_recruitment_status_history (candidate_recruitment_id, from_stage_id, to_stage_id, changed_by)
  values (v_cr.id, null, v_stage_id, (select auth.uid()));

  return v_cr;
end;
$$;

revoke execute on function public.add_candidate_to_recruitment(bigint, text, text, text) from public, anon;
grant execute on function public.add_candidate_to_recruitment(bigint, text, text, text) to authenticated;

-- Move a candidate to another stage, hard-gated on a non-blank note
-- existing for the stage being left. The source stage is captured
-- before any write, and the note (when supplied) is upserted against
-- that captured stage -- upserting after the update would attach it to
-- the target stage and silently unblock the next move instead of this
-- one (see plan.md's Critical Implementation Details).
create function public.move_candidate_stage(
  target_candidate_recruitment_id bigint,
  to_stage_id bigint,
  note text default null
)
returns public.candidate_recruitments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recruitment_id bigint;
  v_source_stage_id bigint;
  v_note text;
  v_cr public.candidate_recruitments%rowtype;
begin
  select recruitment_id, current_stage_id into v_recruitment_id, v_source_stage_id
  from public.candidate_recruitments
  where id = target_candidate_recruitment_id;

  if v_recruitment_id is null then
    raise exception 'not_found: candidate_recruitment % not found', target_candidate_recruitment_id using errcode = 'P0002';
  end if;

  if not (select private.has_recruitment_operation(v_recruitment_id, 'recruitment.read')) then
    raise exception 'not_found: candidate_recruitment % not found', target_candidate_recruitment_id using errcode = 'P0002';
  end if;

  if not (select private.has_recruitment_operation(v_recruitment_id, 'recruitment.write')) then
    raise exception 'insufficient_privilege: recruitment.write required' using errcode = '42501';
  end if;

  v_note := nullif(trim(note), '');

  if v_note is not null then
    insert into public.candidate_stage_notes (candidate_recruitment_id, stage_id, body, created_by)
    values (target_candidate_recruitment_id, v_source_stage_id, v_note, (select auth.uid()))
    on conflict (candidate_recruitment_id, stage_id)
    do update set body = excluded.body, created_by = excluded.created_by;
  end if;

  if not exists (
    select 1 from public.candidate_stage_notes
    where candidate_recruitment_id = target_candidate_recruitment_id
      and stage_id = v_source_stage_id
  ) then
    raise exception 'note_required: a note for the stage being left is required before moving' using errcode = 'PA004';
  end if;

  update public.candidate_recruitments
  set current_stage_id = to_stage_id
  where id = target_candidate_recruitment_id
  returning * into v_cr;

  insert into public.candidate_recruitment_status_history (candidate_recruitment_id, from_stage_id, to_stage_id, changed_by)
  values (target_candidate_recruitment_id, v_source_stage_id, to_stage_id, (select auth.uid()));

  return v_cr;
end;
$$;

revoke execute on function public.move_candidate_stage(bigint, bigint, text) from public, anon;
grant execute on function public.move_candidate_stage(bigint, bigint, text) to authenticated;
