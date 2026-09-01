-- Impl-review follow-up (F3): update_default_stages inserted net
-- additions *before* deleting the verified-unreferenced removals. A
-- freshly inserted row's auto-generated id is never in v_ids (only ids
-- explicitly submitted by the caller are), so the removal-cleanup
-- `delete ... where id <> all(v_ids)` immediately deleted every stage
-- the same call had just inserted -- net additions were silently
-- dropped. Caught by a new rls_verification.sql assertion (18) added
-- during the implementation review, not by any test at the time this
-- function was first written.
--
-- Fix: delete the removals before inserting additions. The removal set
-- was already fully computed and reference-checked earlier in the
-- function, so reordering doesn't change which rows are eligible for
-- removal -- it just stops new rows from transiently colliding with
-- that check.
create or replace function public.update_default_stages(stages jsonb)
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

  -- Delete the now-verified-unreferenced removals *before* inserting
  -- net additions -- see the header comment for why the order matters.
  delete from public.kanban_stages
  where recruitment_id is null
    and id <> all (v_ids);

  -- Insert net additions at their submitted position.
  v_position := 0;
  for v_elem in select * from jsonb_array_elements(stages) loop
    v_position := v_position + 1;
    if not (v_elem ? 'id') or (v_elem ->> 'id') is null then
      insert into public.kanban_stages (recruitment_id, name, sort_order)
      values (null, trim(v_elem ->> 'name'), v_position);
    end if;
  end loop;

  return query
    select * from public.kanban_stages
    where recruitment_id is null
    order by sort_order;
end;
$$;
