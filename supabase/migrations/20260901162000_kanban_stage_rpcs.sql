-- S-03: SECURITY DEFINER RPCs for editing kanban stage sets, following
-- create_recruitment's hardening contract (permission re-check as the
-- first statement, set search_path = '', schema-qualified identifiers).
--
-- Errcodes used across these RPCs (none collide with the existing
-- 42501/22023/23503 mapping in src/pages/api/recruitments/index.ts):
--   42501  insufficient_privilege -- caller lacks the required operation
--   P0002  not_found             -- caller cannot even read the recruitment
--   22023  invalid_request        -- malformed input
--   PA001  stages_locked          -- recruitment already has candidates
--   PA002  stage_referenced       -- a default stage removal is still referenced

-- Replace a recruitment's override stage set atomically. The
-- zero-candidates gate (see plan.md's Key Discoveries) guarantees no
-- candidate_recruitments/history row references any of the
-- recruitment's current override stages, so a wholesale delete is safe.
create function public.replace_recruitment_stages(
  target_recruitment_id bigint,
  stage_names text[]
)
returns setof public.kanban_stages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_index int;
  v_name text;
begin
  if not (select private.has_recruitment_operation(target_recruitment_id, 'recruitment.read')) then
    raise exception 'not_found: recruitment % not found', target_recruitment_id using errcode = 'P0002';
  end if;

  if not (select private.has_recruitment_operation(target_recruitment_id, 'recruitment.write')) then
    raise exception 'insufficient_privilege: recruitment.write required' using errcode = '42501';
  end if;

  if exists (select 1 from public.candidate_recruitments where recruitment_id = target_recruitment_id) then
    raise exception 'stages_locked: recruitment already has candidates' using errcode = 'PA001';
  end if;

  if stage_names is null or array_length(stage_names, 1) is null then
    raise exception 'invalid_request: at least one stage name is required' using errcode = '22023';
  end if;

  for v_index in 1..array_length(stage_names, 1) loop
    v_name := stage_names[v_index];
    if v_name is null or length(trim(v_name)) = 0 or length(v_name) > 100 then
      raise exception 'invalid_request: stage name at position % is invalid', v_index using errcode = '22023';
    end if;
  end loop;

  delete from public.kanban_stages where recruitment_id = target_recruitment_id;

  for v_index in 1..array_length(stage_names, 1) loop
    insert into public.kanban_stages (recruitment_id, name, sort_order)
    values (target_recruitment_id, trim(stage_names[v_index]), v_index);
  end loop;

  return query
    select * from public.kanban_stages
    where recruitment_id = target_recruitment_id
    order by sort_order;
end;
$$;

revoke execute on function public.replace_recruitment_stages(bigint, text[]) from public, anon;
grant execute on function public.replace_recruitment_stages(bigint, text[]) to authenticated;

-- Drop a recruitment's override rows so it reverts to inheriting the
-- global defaults. Same authorization and candidates-exist gates as
-- replace_recruitment_stages.
create function public.reset_recruitment_stages(target_recruitment_id bigint)
returns setof public.kanban_stages
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.has_recruitment_operation(target_recruitment_id, 'recruitment.read')) then
    raise exception 'not_found: recruitment % not found', target_recruitment_id using errcode = 'P0002';
  end if;

  if not (select private.has_recruitment_operation(target_recruitment_id, 'recruitment.write')) then
    raise exception 'insufficient_privilege: recruitment.write required' using errcode = '42501';
  end if;

  if exists (select 1 from public.candidate_recruitments where recruitment_id = target_recruitment_id) then
    raise exception 'stages_locked: recruitment already has candidates' using errcode = 'PA001';
  end if;

  delete from public.kanban_stages where recruitment_id = target_recruitment_id;

  return query
    select * from public.kanban_stages
    where recruitment_id is null
    order by sort_order;
end;
$$;

revoke execute on function public.reset_recruitment_stages(bigint) from public, anon;
grant execute on function public.reset_recruitment_stages(bigint) to authenticated;

-- Edit the global default stage set in place. Default rows are
-- referenced by candidates and history, so this cannot be delete-and-
-- reinsert like the override path -- it diffs submitted rows against
-- existing ones by id, renames, applies the two-phase negate-then-assign
-- renumber (a single-statement reorder fails with 23505 against the
-- non-deferrable partial unique index -- see plan.md's Key Discoveries),
-- inserts net additions, and deletes only rows nothing references.
--
-- `stages` shape: jsonb array of {"id": bigint | null, "name": text},
-- array position gives the new order.
create function public.update_default_stages(stages jsonb)
returns setof public.kanban_stages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_elem jsonb;
  v_id bigint;
  v_name text;
  v_position int;
  v_ids bigint[] := '{}';
  v_submitted_count int;
  v_distinct_name_count int;
  v_removed_id bigint;
  v_removed_name text;
begin
  if not (select private.has_operation('group.manage')) then
    raise exception 'insufficient_privilege: group.manage required' using errcode = '42501';
  end if;

  if stages is null or jsonb_typeof(stages) <> 'array' or jsonb_array_length(stages) < 1 then
    raise exception 'invalid_request: at least one stage is required' using errcode = '22023';
  end if;

  -- Validate every name and id, and collect the submitted ids.
  for v_elem in select * from jsonb_array_elements(stages) loop
    v_name := v_elem ->> 'name';
    if v_name is null or length(trim(v_name)) = 0 or length(v_name) > 100 then
      raise exception 'invalid_request: stage name is invalid' using errcode = '22023';
    end if;

    if (v_elem ? 'id') and (v_elem ->> 'id') is not null then
      v_id := (v_elem ->> 'id')::bigint;
      if not exists (select 1 from public.kanban_stages where id = v_id and recruitment_id is null) then
        raise exception 'invalid_request: stage id % does not exist in the defaults', v_id using errcode = '22023';
      end if;
      v_ids := array_append(v_ids, v_id);
    end if;
  end loop;

  -- No duplicate names in the submitted set -- the unique index would
  -- reject it anyway, but a clean 22023 beats a raw 23505.
  select count(*) into v_submitted_count from jsonb_array_elements(stages);
  select count(distinct trim(elem ->> 'name')) into v_distinct_name_count from jsonb_array_elements(stages) elem;
  if v_submitted_count <> v_distinct_name_count then
    raise exception 'invalid_request: duplicate stage names are not allowed' using errcode = '22023';
  end if;

  -- Removals: existing default rows whose id is not in the submitted
  -- set. Refuse if any candidate or history row still references one.
  for v_removed_id, v_removed_name in
    select id, name from public.kanban_stages
    where recruitment_id is null
      and id <> all (v_ids)
  loop
    if exists (select 1 from public.candidate_recruitments where current_stage_id = v_removed_id)
      or exists (
        select 1 from public.candidate_recruitment_status_history
        where from_stage_id = v_removed_id or to_stage_id = v_removed_id
      )
    then
      raise exception 'stage_referenced: stage "%" is still referenced by candidates and cannot be removed', v_removed_name
        using errcode = 'PA002';
    end if;
  end loop;

  -- Rename in place.
  for v_elem in select * from jsonb_array_elements(stages) loop
    if (v_elem ? 'id') and (v_elem ->> 'id') is not null then
      update public.kanban_stages
      set name = trim(v_elem ->> 'name')
      where id = (v_elem ->> 'id')::bigint and recruitment_id is null;
    end if;
  end loop;

  -- Two-phase renumber: park every default row in negative sort_order
  -- space first, then assign targets -- required by the non-deferrable
  -- partial unique index on (sort_order) where recruitment_id is null.
  update public.kanban_stages set sort_order = -sort_order where recruitment_id is null;

  v_position := 0;
  for v_elem in select * from jsonb_array_elements(stages) loop
    v_position := v_position + 1;
    if (v_elem ? 'id') and (v_elem ->> 'id') is not null then
      update public.kanban_stages
      set sort_order = v_position
      where id = (v_elem ->> 'id')::bigint and recruitment_id is null;
    end if;
  end loop;

  -- Insert net additions at their submitted position.
  v_position := 0;
  for v_elem in select * from jsonb_array_elements(stages) loop
    v_position := v_position + 1;
    if not (v_elem ? 'id') or (v_elem ->> 'id') is null then
      insert into public.kanban_stages (recruitment_id, name, sort_order)
      values (null, trim(v_elem ->> 'name'), v_position);
    end if;
  end loop;

  -- Delete the now-verified-unreferenced removals.
  delete from public.kanban_stages
  where recruitment_id is null
    and id <> all (v_ids);

  return query
    select * from public.kanban_stages
    where recruitment_id is null
    order by sort_order;
end;
$$;

revoke execute on function public.update_default_stages(jsonb) from public, anon;
grant execute on function public.update_default_stages(jsonb) to authenticated;
