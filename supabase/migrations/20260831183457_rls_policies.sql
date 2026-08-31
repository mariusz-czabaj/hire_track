-- RLS policies for every table introduced in security_rbac_schema and
-- recruitment_candidate_schema, driven by two SECURITY DEFINER helper
-- functions in a private schema.
--
-- Why SECURITY DEFINER helper functions instead of inline joins in every
-- policy: if a policy on (say) `recruitments` joined group_memberships /
-- group_operations directly, that join would run under the QUERYING
-- user's own RLS on those two tables. Since group_memberships and
-- group_operations are themselves locked down to group.manage-only below,
-- a non-admin user's own permission check would be blocked by their own
-- lack of access to read those tables -- breaking every other table's
-- policy for everyone except admins. A SECURITY DEFINER function bypasses
-- RLS internally (with an explicit auth.uid() check inside), so the two
-- permission tables can stay locked down without breaking the checks that
-- read them internally.

create schema if not exists private;

create or replace function private.has_operation(check_operation operation)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_memberships gm
    join public.group_operations go on go.group_id = gm.group_id
    where gm.user_id = (select auth.uid())
      and go.operation = check_operation
  );
$$;

create or replace function private.has_recruitment_operation(target_recruitment_id bigint, check_operation operation)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.recruitment_security_groups rsg
    join public.group_memberships gm on gm.group_id = rsg.group_id
    join public.group_operations go on go.group_id = rsg.group_id and go.operation = check_operation
    where rsg.recruitment_id = target_recruitment_id
      and gm.user_id = (select auth.uid())
  );
$$;

revoke execute on function private.has_operation(operation) from public, anon;
revoke execute on function private.has_recruitment_operation(bigint, operation) from public, anon;
grant execute on function private.has_operation(operation) to authenticated;
grant execute on function private.has_recruitment_operation(bigint, operation) to authenticated;

-- Enable RLS on every table.
alter table security_groups enable row level security;
alter table group_memberships enable row level security;
alter table group_operations enable row level security;
alter table recruitments enable row level security;
alter table recruitment_security_groups enable row level security;
alter table kanban_stages enable row level security;
alter table candidates enable row level security;
alter table candidate_recruitments enable row level security;
alter table candidate_recruitment_status_history enable row level security;

-- security_groups: every authenticated user needs the group list to
-- assign one at recruitment-creation time (FR-001a); only admins manage
-- the groups themselves.
create policy security_groups_select on security_groups
  for select to authenticated
  using (true);

create policy security_groups_insert on security_groups
  for insert to authenticated
  with check ((select private.has_operation('group.manage')));

create policy security_groups_update on security_groups
  for update to authenticated
  using ((select private.has_operation('group.manage')))
  with check ((select private.has_operation('group.manage')));

create policy security_groups_delete on security_groups
  for delete to authenticated
  using ((select private.has_operation('group.manage')));

-- group_memberships: a user can see their own membership rows (to know
-- what they belong to); only admins see/manage everyone's.
create policy group_memberships_select on group_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_operation('group.manage'))
  );

create policy group_memberships_insert on group_memberships
  for insert to authenticated
  with check ((select private.has_operation('group.manage')));

create policy group_memberships_update on group_memberships
  for update to authenticated
  using ((select private.has_operation('group.manage')))
  with check ((select private.has_operation('group.manage')));

create policy group_memberships_delete on group_memberships
  for delete to authenticated
  using ((select private.has_operation('group.manage')));

-- group_operations: admins-only for every operation. Safe to lock down
-- fully because the helper functions above read this table under
-- SECURITY DEFINER, not under the querying user's own RLS.
create policy group_operations_select on group_operations
  for select to authenticated
  using ((select private.has_operation('group.manage')));

create policy group_operations_insert on group_operations
  for insert to authenticated
  with check ((select private.has_operation('group.manage')));

create policy group_operations_update on group_operations
  for update to authenticated
  using ((select private.has_operation('group.manage')))
  with check ((select private.has_operation('group.manage')));

create policy group_operations_delete on group_operations
  for delete to authenticated
  using ((select private.has_operation('group.manage')));

-- recruitments: SELECT/UPDATE are scoped to the recruitment's assigned
-- groups. INSERT uses the broad check -- a brand-new recruitment has no
-- recruitment_security_groups rows yet, so a recruitment-scoped check
-- would always evaluate false (chicken-and-egg). No DELETE policy: not
-- requested anywhere in the PRD.
create policy recruitments_select on recruitments
  for select to authenticated
  using ((select private.has_recruitment_operation(id, 'recruitment.read')));

create policy recruitments_insert on recruitments
  for insert to authenticated
  with check ((select private.has_operation('recruitment.write')));

create policy recruitments_update on recruitments
  for update to authenticated
  using ((select private.has_recruitment_operation(id, 'recruitment.write')))
  with check ((select private.has_recruitment_operation(id, 'recruitment.write')));

-- recruitment_security_groups: SELECT is scoped to the recruitment's
-- assigned groups. INSERT/DELETE use the broad check for the same
-- chicken-and-egg reason as recruitments INSERT above (assigning the
-- FIRST group to a recruitment has no existing row to scope against).
-- No UPDATE policy: reassignment is delete+insert.
create policy recruitment_security_groups_select on recruitment_security_groups
  for select to authenticated
  using ((select private.has_recruitment_operation(recruitment_id, 'recruitment.read')));

create policy recruitment_security_groups_insert on recruitment_security_groups
  for insert to authenticated
  with check ((select private.has_operation('recruitment.write')));

create policy recruitment_security_groups_delete on recruitment_security_groups
  for delete to authenticated
  using ((select private.has_operation('recruitment.write')));

-- kanban_stages: default (NULL recruitment_id) rows are visible to
-- everyone; per-recruitment override rows are scoped to that
-- recruitment's assigned groups. No INSERT/UPDATE/DELETE policy yet --
-- that's S-03's job; F-01's own default rows were inserted by the
-- recruitment_candidate_schema migration, which runs outside RLS.
create policy kanban_stages_select on kanban_stages
  for select to authenticated
  using (
    recruitment_id is null
    or (select private.has_recruitment_operation(recruitment_id, 'recruitment.read'))
  );

-- candidates: org-wide, not recruitment-scoped -- FR-015/FR-016 and the
-- Access Control guardrail describe candidate visibility as org-wide for
-- any authenticated user with the read/write operation. No DELETE
-- policy: not requested anywhere in the PRD.
create policy candidates_select on candidates
  for select to authenticated
  using ((select private.has_operation('candidate.read')));

create policy candidates_insert on candidates
  for insert to authenticated
  with check ((select private.has_operation('candidate.write')));

create policy candidates_update on candidates
  for update to authenticated
  using ((select private.has_operation('candidate.write')))
  with check ((select private.has_operation('candidate.write')));

-- candidate_recruitments: scoped to the parent recruitment's assigned
-- groups. No DELETE policy: not requested anywhere in the PRD.
create policy candidate_recruitments_select on candidate_recruitments
  for select to authenticated
  using ((select private.has_recruitment_operation(recruitment_id, 'recruitment.read')));

create policy candidate_recruitments_insert on candidate_recruitments
  for insert to authenticated
  with check ((select private.has_recruitment_operation(recruitment_id, 'recruitment.write')));

create policy candidate_recruitments_update on candidate_recruitments
  for update to authenticated
  using ((select private.has_recruitment_operation(recruitment_id, 'recruitment.write')))
  with check ((select private.has_recruitment_operation(recruitment_id, 'recruitment.write')));

-- candidate_recruitment_status_history: append-only log, scoped through
-- the parent candidate_recruitments row's recruitment. No UPDATE/DELETE
-- policy -- history must never be edited or removed.
create policy candidate_recruitment_status_history_select on candidate_recruitment_status_history
  for select to authenticated
  using (
    exists (
      select 1
      from candidate_recruitments cr
      where cr.id = candidate_recruitment_status_history.candidate_recruitment_id
        and (select private.has_recruitment_operation(cr.recruitment_id, 'recruitment.read'))
    )
  );

create policy candidate_recruitment_status_history_insert on candidate_recruitment_status_history
  for insert to authenticated
  with check (
    exists (
      select 1
      from candidate_recruitments cr
      where cr.id = candidate_recruitment_status_history.candidate_recruitment_id
        and (select private.has_recruitment_operation(cr.recruitment_id, 'recruitment.write'))
    )
  );

-- Grants: only the DML verbs each table above has a policy for. Identity
-- primary keys need no separate sequence grants.
grant usage on schema public to authenticated;

grant select, insert, update, delete on security_groups to authenticated;
grant select, insert, update, delete on group_memberships to authenticated;
grant select, insert, update, delete on group_operations to authenticated;
grant select, insert, update on recruitments to authenticated;
grant select, insert, delete on recruitment_security_groups to authenticated;
grant select on kanban_stages to authenticated;
grant select, insert, update on candidates to authenticated;
grant select, insert, update on candidate_recruitments to authenticated;
grant select, insert on candidate_recruitment_status_history to authenticated;
