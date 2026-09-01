-- Local/dev-only seed data: PRD's example security groups (config, not
-- part of the schema -- see plan.md's Key Discoveries) with their
-- operation grants, one test user per group (the S-01 prerequisite's
-- "test user"), one seeded recruitment, and a handful of candidates
-- spread across the default kanban stages. Runs on every local
-- `supabase db reset`; never applied to a real environment via `db push`.

-- Security groups (PRD Access Control: "Przykładowe grupy").
insert into security_groups (name) values
  ('HR/Rekruter'),
  ('Hiring Manager'),
  ('Administrator');

-- Operation grants per group.
insert into group_operations (group_id, operation) values
  ((select id from security_groups where name = 'HR/Rekruter'), 'recruitment.read'),
  ((select id from security_groups where name = 'HR/Rekruter'), 'recruitment.write'),
  ((select id from security_groups where name = 'HR/Rekruter'), 'candidate.read'),
  ((select id from security_groups where name = 'HR/Rekruter'), 'candidate.write'),
  ((select id from security_groups where name = 'Hiring Manager'), 'recruitment.read'),
  ((select id from security_groups where name = 'Hiring Manager'), 'candidate.read'),
  ((select id from security_groups where name = 'Administrator'), 'group.manage');

-- Three local test accounts -- one per group. The Administrator account
-- has no recruitment/candidate operations and isn't assigned to the
-- seeded recruitment, so it doubles as the cross-group-isolation fixture
-- rls_verification.sql uses (a user with zero visibility into the
-- HR/Rekruter + Hiring Manager-scoped recruitment). Standard Supabase
-- local-seed pattern: insert directly into auth.users + auth.identities
-- with an encrypted password via pgcrypto.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated',
    'hr.test@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated', 'authenticated',
    'hiring-manager.test@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-3333-3333-333333333333',
    'authenticated', 'authenticated',
    'admin.test@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', ''
  );

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  (
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    jsonb_build_object('sub', '11111111-1111-1111-1111-111111111111', 'email', 'hr.test@example.com'),
    'email', now(), now(), now()
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_object('sub', '22222222-2222-2222-2222-222222222222', 'email', 'hiring-manager.test@example.com'),
    'email', now(), now(), now()
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    '33333333-3333-3333-3333-333333333333',
    jsonb_build_object('sub', '33333333-3333-3333-3333-333333333333', 'email', 'admin.test@example.com'),
    'email', now(), now(), now()
  );

insert into group_memberships (group_id, user_id) values
  ((select id from security_groups where name = 'HR/Rekruter'), '11111111-1111-1111-1111-111111111111'),
  ((select id from security_groups where name = 'Hiring Manager'), '22222222-2222-2222-2222-222222222222'),
  ((select id from security_groups where name = 'Administrator'), '33333333-3333-3333-3333-333333333333');

-- One seeded recruitment, visible to both HR/Rekruter (full access) and
-- Hiring Manager (read-only) -- a hiring manager overseeing an HR-run
-- recruitment is the realistic scenario the RLS verification exercises.
insert into recruitments (title, location, department, employment_type, opened_at, status) values
  ('Backend Engineer', 'Warszawa', 'Engineering', 'full-time', current_date, 'live');

insert into recruitment_security_groups (recruitment_id, group_id) values
  (
    (select id from recruitments where title = 'Backend Engineer'),
    (select id from security_groups where name = 'HR/Rekruter')
  ),
  (
    (select id from recruitments where title = 'Backend Engineer'),
    (select id from security_groups where name = 'Hiring Manager')
  );

-- Candidates spread across the default kanban stages.
insert into candidates (full_name, email, phone) values
  ('Anna Kowalska', 'anna.kowalska@example.com', '+48 600 100 200'),
  ('Piotr Nowak', 'piotr.nowak@example.com', '+48 600 100 201'),
  ('Katarzyna Wisniewska', 'katarzyna.wisniewska@example.com', '+48 600 100 202'),
  ('Marek Zielinski', 'marek.zielinski@example.com', '+48 600 100 203'),
  ('Ewa Lewandowska', 'ewa.lewandowska@example.com', '+48 600 100 204');

insert into candidate_recruitments (candidate_id, recruitment_id, current_stage_id, added_at) values
  (
    (select id from candidates where email = 'anna.kowalska@example.com'),
    (select id from recruitments where title = 'Backend Engineer'),
    (select id from kanban_stages where recruitment_id is null and name = 'New'),
    now()
  ),
  (
    (select id from candidates where email = 'piotr.nowak@example.com'),
    (select id from recruitments where title = 'Backend Engineer'),
    (select id from kanban_stages where recruitment_id is null and name = 'Screening'),
    now()
  ),
  (
    (select id from candidates where email = 'katarzyna.wisniewska@example.com'),
    (select id from recruitments where title = 'Backend Engineer'),
    (select id from kanban_stages where recruitment_id is null and name = 'Interview'),
    now()
  ),
  (
    (select id from candidates where email = 'marek.zielinski@example.com'),
    (select id from recruitments where title = 'Backend Engineer'),
    (select id from kanban_stages where recruitment_id is null and name = 'Offer'),
    now()
  ),
  (
    (select id from candidates where email = 'ewa.lewandowska@example.com'),
    (select id from recruitments where title = 'Backend Engineer'),
    (select id from kanban_stages where recruitment_id is null and name = 'Hired'),
    now()
  );

-- One status-history row per candidate recording the initial add
-- (from_stage_id null -> to_stage_id = the stage they were added on).
insert into candidate_recruitment_status_history (candidate_recruitment_id, from_stage_id, to_stage_id, changed_by, changed_at)
select cr.id, null, cr.current_stage_id, '11111111-1111-1111-1111-111111111111', cr.added_at
from candidate_recruitments cr
join recruitments r on r.id = cr.recruitment_id
where r.title = 'Backend Engineer';
