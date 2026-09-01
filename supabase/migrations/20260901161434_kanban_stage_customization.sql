-- S-03: write access on kanban_stages, split by partition -- recruiters
-- may write their own recruitment's override rows; administrators may
-- write the global defaults (recruitment_id is null). F-01 deliberately
-- withheld this write access; see plan.md's Key Discoveries for why a
-- composite FK cannot enforce stage<->recruitment consistency and why a
-- trigger is used instead.

create policy kanban_stages_insert on kanban_stages
  for insert to authenticated
  with check (
    (recruitment_id is not null and (select private.has_recruitment_operation(recruitment_id, 'recruitment.write')))
    or (recruitment_id is null and (select private.has_operation('group.manage')))
  );

create policy kanban_stages_update on kanban_stages
  for update to authenticated
  using (
    (recruitment_id is not null and (select private.has_recruitment_operation(recruitment_id, 'recruitment.write')))
    or (recruitment_id is null and (select private.has_operation('group.manage')))
  )
  with check (
    (recruitment_id is not null and (select private.has_recruitment_operation(recruitment_id, 'recruitment.write')))
    or (recruitment_id is null and (select private.has_operation('group.manage')))
  );

create policy kanban_stages_delete on kanban_stages
  for delete to authenticated
  using (
    (recruitment_id is not null and (select private.has_recruitment_operation(recruitment_id, 'recruitment.write')))
    or (recruitment_id is null and (select private.has_operation('group.manage')))
  );

-- Documentation only -- Supabase's bootstrap already grants all DML on
-- public-schema tables to `authenticated` and it is never revoked, so
-- this grant is not what unblocks the write. The policies above are.
grant insert, update, delete on kanban_stages to authenticated;

-- Non-empty (after trim) name, within a generous cap. Applies to both
-- default and override rows.
alter table kanban_stages
  add constraint kanban_stages_name_not_blank check (length(trim(name)) > 0 and length(name) <= 100);

-- seed.sql's `= (select id from kanban_stages where recruitment_id is
-- null and name = '...')` lookups fail with "more than one row returned"
-- on a duplicate default name, and admins can now create one via the
-- kanban_stages_insert policy above.
create unique index kanban_stages_default_name_key on kanban_stages (name) where recruitment_id is null;

-- Stage<->recruitment consistency: a candidate_recruitments row must
-- point at a stage that is either a global default or belongs to the
-- same recruitment. A composite FK cannot express this under MATCH
-- SIMPLE (see plan.md's Key Discoveries), so it is enforced with a
-- trigger instead.
create or replace function private.check_candidate_recruitment_stage_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage_recruitment_id bigint;
begin
  select recruitment_id into v_stage_recruitment_id
  from public.kanban_stages
  where id = new.current_stage_id;

  if v_stage_recruitment_id is not null and v_stage_recruitment_id <> new.recruitment_id then
    raise exception 'invalid_stage: stage % does not belong to recruitment % or the global defaults', new.current_stage_id, new.recruitment_id
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger candidate_recruitments_stage_consistency
  before insert or update on candidate_recruitments
  for each row
  execute function private.check_candidate_recruitment_stage_consistency();
