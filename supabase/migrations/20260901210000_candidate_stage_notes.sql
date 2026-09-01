-- S-04: per-stage interview notes. One note per candidate per
-- recruitment per stage, editable, no delete -- mirrors
-- candidate_recruitment_status_history's append-oriented posture but
-- allows UPDATE since a note is edited in place (change.md decision).
-- The blank-note case is made unrepresentable by the CHECK constraint
-- below, so move_candidate_stage's gate only ever tests row existence.
create table candidate_stage_notes (
  id bigint generated always as identity primary key,
  candidate_recruitment_id bigint not null references candidate_recruitments (id) on delete cascade,
  stage_id bigint not null references kanban_stages (id) on delete restrict,
  body text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_recruitment_id, stage_id),
  constraint candidate_stage_notes_body_not_blank check (length(trim(body)) > 0)
);

create index candidate_stage_notes_cr_id_idx on candidate_stage_notes (candidate_recruitment_id);

create trigger set_updated_at before update on candidate_stage_notes
  for each row execute function private.set_updated_at();

alter table candidate_stage_notes enable row level security;

-- Scoped through the parent candidate_recruitments row's recruitment,
-- same shape as candidate_recruitment_status_history's policies.
create policy candidate_stage_notes_select on candidate_stage_notes
  for select to authenticated
  using (
    exists (
      select 1
      from candidate_recruitments cr
      where cr.id = candidate_stage_notes.candidate_recruitment_id
        and (select private.has_recruitment_operation(cr.recruitment_id, 'recruitment.read'))
    )
  );

create policy candidate_stage_notes_insert on candidate_stage_notes
  for insert to authenticated
  with check (
    exists (
      select 1
      from candidate_recruitments cr
      where cr.id = candidate_stage_notes.candidate_recruitment_id
        and (select private.has_recruitment_operation(cr.recruitment_id, 'recruitment.write'))
    )
  );

create policy candidate_stage_notes_update on candidate_stage_notes
  for update to authenticated
  using (
    exists (
      select 1
      from candidate_recruitments cr
      where cr.id = candidate_stage_notes.candidate_recruitment_id
        and (select private.has_recruitment_operation(cr.recruitment_id, 'recruitment.write'))
    )
  )
  with check (
    exists (
      select 1
      from candidate_recruitments cr
      where cr.id = candidate_stage_notes.candidate_recruitment_id
        and (select private.has_recruitment_operation(cr.recruitment_id, 'recruitment.write'))
    )
  );

grant select, insert, update on candidate_stage_notes to authenticated;
