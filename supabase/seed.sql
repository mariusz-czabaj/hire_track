-- Local/dev-only seed data: PRD's example security groups (config, not
-- part of the schema -- see plan.md's Key Discoveries) with their
-- operation grants, one test user per group (the S-01 prerequisite's
-- "test user"), one seeded recruitment, and a handful of candidates
-- spread across the default kanban stages. Runs on every local
-- `supabase db reset`; never applied to a real environment via `db push`.
--
-- Authorization test fixtures (testing-authorization-tenancy-contract,
-- Phase 1): a fourth group, three more users, and a second recruitment
-- appended below the PRD's three example groups. Appended, not
-- interleaved, so every pre-existing ordinal group-id reference (e.g.
-- `groupIds: [1]`, `groupIds: [1, 2]` in integration tests and e2e
-- specs) keeps working unchanged -- HR/Rekruter=1, Hiring Manager=2,
-- Administrator=3, the new group=4.

-- Security groups (PRD Access Control: "Przykładowe grupy"), plus one
-- authorization test fixture appended last (see note above).
insert into security_groups (name) values
  ('HR/Rekruter'),
  ('Hiring Manager'),
  ('Administrator'),
  ('Test Fixture -- Tenant B (HR-equivalent)');

-- Operation grants per group. The fixture group holds the *same*
-- operations as HR/Rekruter -- it exists to prove tenancy isolation
-- (same powers, different recruitment), not privilege isolation, which
-- the Administrator's `group.manage`-only grant already covers below.
insert into group_operations (group_id, operation) values
  ((select id from security_groups where name = 'HR/Rekruter'), 'recruitment.read'),
  ((select id from security_groups where name = 'HR/Rekruter'), 'recruitment.write'),
  ((select id from security_groups where name = 'HR/Rekruter'), 'candidate.read'),
  ((select id from security_groups where name = 'HR/Rekruter'), 'candidate.write'),
  ((select id from security_groups where name = 'Hiring Manager'), 'recruitment.read'),
  ((select id from security_groups where name = 'Hiring Manager'), 'candidate.read'),
  ((select id from security_groups where name = 'Administrator'), 'group.manage'),
  ((select id from security_groups where name = 'Test Fixture -- Tenant B (HR-equivalent)'), 'recruitment.read'),
  ((select id from security_groups where name = 'Test Fixture -- Tenant B (HR-equivalent)'), 'recruitment.write'),
  ((select id from security_groups where name = 'Test Fixture -- Tenant B (HR-equivalent)'), 'candidate.read'),
  ((select id from security_groups where name = 'Test Fixture -- Tenant B (HR-equivalent)'), 'candidate.write');

-- Three local test accounts -- one per PRD-example group. The
-- Administrator account holds only `group.manage` and isn't assigned
-- to any recruitment, so it is a *privileged-but-unrelated* non-member
-- fixture: useful for testing that a role lacking recruitment/candidate
-- operations entirely is denied, but every denial it produces is
-- ambiguous between "not a member" and "lacks the operation" -- it
-- cannot prove tenancy isolation on its own (see
-- testing-authorization-tenancy-contract/research.md, "the fixture gap").
-- The three additional accounts below close that gap. Standard Supabase
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
  ),
  -- Tenant-peer principal: same operations as HR/Rekruter, but its only
  -- group membership is the Tenant B fixture group, which is attached
  -- to a *different* recruitment. Denials this principal receives on
  -- the Backend Engineer recruitment are attributable to tenancy alone,
  -- never to lack of privilege -- the property the Administrator
  -- account above cannot provide.
  (
    '00000000-0000-0000-0000-000000000000',
    '44444444-4444-4444-4444-444444444444',
    'authenticated', 'authenticated',
    'tenant-peer.test@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', ''
  ),
  -- No-group principal: authenticated, zero group memberships. The
  -- floor case for "no candidate data is available to an unauthorized
  -- user" (prd.md:117) -- distinct from the Administrator, which is
  -- privileged for group management even though it holds no
  -- recruitment/candidate operation.
  (
    '00000000-0000-0000-0000-000000000000',
    '55555555-5555-5555-5555-555555555555',
    'authenticated', 'authenticated',
    'no-group.test@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', ''
  ),
  -- Multi-group principal: a member of Hiring Manager (recruitment.read,
  -- attached to Backend Engineer) *and* the Tenant B fixture group
  -- (recruitment.write, attached only to the Tenant B recruitment).
  -- Exercises `has_recruitment_operation`'s `go.group_id = rsg.group_id`
  -- conjunct: the write-holding group is not attached to Backend
  -- Engineer, so this principal must get read-only there, never write
  -- by virtue of holding `recruitment.write` in an unrelated group.
  -- This single fixture covers both the general "multi-group user"
  -- need and the specific same-group-conjunct case; no fifth principal
  -- was needed once the two requirements were checked against each
  -- other (see plan.md Phase 1, "Note on the multi-group requirement").
  (
    '00000000-0000-0000-0000-000000000000',
    '66666666-6666-6666-6666-666666666666',
    'authenticated', 'authenticated',
    'multi-group.test@example.com',
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
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    '44444444-4444-4444-4444-444444444444',
    jsonb_build_object('sub', '44444444-4444-4444-4444-444444444444', 'email', 'tenant-peer.test@example.com'),
    'email', now(), now(), now()
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    '55555555-5555-5555-5555-555555555555',
    jsonb_build_object('sub', '55555555-5555-5555-5555-555555555555', 'email', 'no-group.test@example.com'),
    'email', now(), now(), now()
  ),
  (
    '66666666-6666-6666-6666-666666666666',
    '66666666-6666-6666-6666-666666666666',
    jsonb_build_object('sub', '66666666-6666-6666-6666-666666666666', 'email', 'multi-group.test@example.com'),
    'email', now(), now(), now()
  );

insert into group_memberships (group_id, user_id) values
  ((select id from security_groups where name = 'HR/Rekruter'), '11111111-1111-1111-1111-111111111111'),
  ((select id from security_groups where name = 'Hiring Manager'), '22222222-2222-2222-2222-222222222222'),
  ((select id from security_groups where name = 'Administrator'), '33333333-3333-3333-3333-333333333333'),
  ((select id from security_groups where name = 'Test Fixture -- Tenant B (HR-equivalent)'), '44444444-4444-4444-4444-444444444444'),
  -- no-group.test@example.com deliberately has no group_memberships row.
  ((select id from security_groups where name = 'Hiring Manager'), '66666666-6666-6666-6666-666666666666'),
  ((select id from security_groups where name = 'Test Fixture -- Tenant B (HR-equivalent)'), '66666666-6666-6666-6666-666666666666');

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

-- Second recruitment, scoped *only* to the Tenant B fixture group --
-- the isolation-proving counterpart to Backend Engineer. Status
-- 'closed' (not 'draft') so it doesn't pollute
-- tests/e2e/recruitments.spec.ts's "no other draft recruitments"
-- filter assertion, same discipline that spec's own beforeAll follows
-- for recruitments it creates at runtime.
insert into recruitments (title, location, department, employment_type, opened_at, status) values
  ('Data Analyst', 'Krakow', 'Analytics', 'full-time', current_date, 'closed');

insert into recruitment_security_groups (recruitment_id, group_id) values
  (
    (select id from recruitments where title = 'Data Analyst'),
    (select id from security_groups where name = 'Test Fixture -- Tenant B (HR-equivalent)')
  );

-- Candidates spread across the default kanban stages.
insert into candidates (full_name, email, phone) values
  ('Anna Kowalska', 'anna.kowalska@example.com', '+48 600 100 200'),
  ('Piotr Nowak', 'piotr.nowak@example.com', '+48 600 100 201'),
  ('Katarzyna Wisniewska', 'katarzyna.wisniewska@example.com', '+48 600 100 202'),
  ('Marek Zielinski', 'marek.zielinski@example.com', '+48 600 100 203'),
  ('Ewa Lewandowska', 'ewa.lewandowska@example.com', '+48 600 100 204'),
  -- Belongs to Data Analyst (Tenant B), not Backend Engineer -- the
  -- risk #1/#4 read-boundary fixture on the other side of the tenancy
  -- split.
  ('Tomasz Kaminski', 'tomasz.kaminski@example.com', '+48 600 100 205'),
  -- Cross-tenant candidate (S-06, plan.md Phase 1): the same person
  -- participates in both Backend Engineer (Tenant A) and Data Analyst
  -- (Tenant B), each with several stage transitions recorded, so
  -- FR-016's multi-recruitment log and the truncation boundary are both
  -- demonstrable against a real database.
  ('Julia Wojcik', 'julia.wojcik@example.com', '+48 600 100 206');

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
  ),
  (
    (select id from candidates where email = 'tomasz.kaminski@example.com'),
    (select id from recruitments where title = 'Data Analyst'),
    (select id from kanban_stages where recruitment_id is null and name = 'New'),
    now()
  ),
  -- Julia Wojcik's two memberships (S-06 cross-tenant fixture). Each
  -- ends on the stage its own transition chain below arrives at:
  -- Backend Engineer -> Interview, Data Analyst -> Offer.
  (
    (select id from candidates where email = 'julia.wojcik@example.com'),
    (select id from recruitments where title = 'Backend Engineer'),
    (select id from kanban_stages where recruitment_id is null and name = 'Interview'),
    now() - interval '3 days'
  ),
  (
    (select id from candidates where email = 'julia.wojcik@example.com'),
    (select id from recruitments where title = 'Data Analyst'),
    (select id from kanban_stages where recruitment_id is null and name = 'Offer'),
    now() - interval '2 days'
  );

-- One status-history row per candidate recording the initial add
-- (from_stage_id null -> to_stage_id = the stage they were added on).
-- changed_by uses each recruitment's own HR-equivalent principal so the
-- history row's author is a real member, not a cross-tenant reference.
insert into candidate_recruitment_status_history (candidate_recruitment_id, from_stage_id, to_stage_id, changed_by, changed_at)
select cr.id, null, cr.current_stage_id, '11111111-1111-1111-1111-111111111111', cr.added_at
from candidate_recruitments cr
join recruitments r on r.id = cr.recruitment_id
where r.title = 'Backend Engineer';

insert into candidate_recruitment_status_history (candidate_recruitment_id, from_stage_id, to_stage_id, changed_by, changed_at)
select cr.id, null, cr.current_stage_id, '44444444-4444-4444-4444-444444444444', cr.added_at
from candidate_recruitments cr
join recruitments r on r.id = cr.recruitment_id
where r.title = 'Data Analyst';

-- Julia Wojcik's multi-step transition chains (S-06, plan.md Phase 1).
-- Written directly rather than through `move_candidate_stage`, same
-- precedent as the rows above: the RPC's note gate is not being
-- exercised here. `changed_by` uses each recruitment's own tenant
-- principal, matching the existing convention.
--
-- Backend Engineer (Tenant A): added on New, then New -> Screening ->
-- Interview.
insert into candidate_recruitment_status_history (candidate_recruitment_id, from_stage_id, to_stage_id, changed_by, changed_at)
select
  cr.id,
  null,
  (select id from kanban_stages where recruitment_id is null and name = 'New'),
  '11111111-1111-1111-1111-111111111111',
  cr.added_at
from candidate_recruitments cr
join recruitments r on r.id = cr.recruitment_id
join candidates c on c.id = cr.candidate_id
where r.title = 'Backend Engineer' and c.email = 'julia.wojcik@example.com';

insert into candidate_recruitment_status_history (candidate_recruitment_id, from_stage_id, to_stage_id, changed_by, changed_at)
select
  cr.id,
  (select id from kanban_stages where recruitment_id is null and name = 'New'),
  (select id from kanban_stages where recruitment_id is null and name = 'Screening'),
  '11111111-1111-1111-1111-111111111111',
  cr.added_at + interval '1 day'
from candidate_recruitments cr
join recruitments r on r.id = cr.recruitment_id
join candidates c on c.id = cr.candidate_id
where r.title = 'Backend Engineer' and c.email = 'julia.wojcik@example.com';

insert into candidate_recruitment_status_history (candidate_recruitment_id, from_stage_id, to_stage_id, changed_by, changed_at)
select
  cr.id,
  (select id from kanban_stages where recruitment_id is null and name = 'Screening'),
  (select id from kanban_stages where recruitment_id is null and name = 'Interview'),
  '11111111-1111-1111-1111-111111111111',
  cr.added_at + interval '2 days'
from candidate_recruitments cr
join recruitments r on r.id = cr.recruitment_id
join candidates c on c.id = cr.candidate_id
where r.title = 'Backend Engineer' and c.email = 'julia.wojcik@example.com';

-- Data Analyst (Tenant B): added on New, then New -> Screening -> Offer.
insert into candidate_recruitment_status_history (candidate_recruitment_id, from_stage_id, to_stage_id, changed_by, changed_at)
select
  cr.id,
  null,
  (select id from kanban_stages where recruitment_id is null and name = 'New'),
  '44444444-4444-4444-4444-444444444444',
  cr.added_at
from candidate_recruitments cr
join recruitments r on r.id = cr.recruitment_id
join candidates c on c.id = cr.candidate_id
where r.title = 'Data Analyst' and c.email = 'julia.wojcik@example.com';

insert into candidate_recruitment_status_history (candidate_recruitment_id, from_stage_id, to_stage_id, changed_by, changed_at)
select
  cr.id,
  (select id from kanban_stages where recruitment_id is null and name = 'New'),
  (select id from kanban_stages where recruitment_id is null and name = 'Screening'),
  '44444444-4444-4444-4444-444444444444',
  cr.added_at + interval '1 day'
from candidate_recruitments cr
join recruitments r on r.id = cr.recruitment_id
join candidates c on c.id = cr.candidate_id
where r.title = 'Data Analyst' and c.email = 'julia.wojcik@example.com';

insert into candidate_recruitment_status_history (candidate_recruitment_id, from_stage_id, to_stage_id, changed_by, changed_at)
select
  cr.id,
  (select id from kanban_stages where recruitment_id is null and name = 'Screening'),
  (select id from kanban_stages where recruitment_id is null and name = 'Offer'),
  '44444444-4444-4444-4444-444444444444',
  cr.added_at + interval '2 days'
from candidate_recruitments cr
join recruitments r on r.id = cr.recruitment_id
join candidates c on c.id = cr.candidate_id
where r.title = 'Data Analyst' and c.email = 'julia.wojcik@example.com';
