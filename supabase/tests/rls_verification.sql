-- RLS verification: proves the group-scoped read/write RLS model
-- actually enforces the intended access boundaries, against the fixtures
-- from seed.sql. Simulates a specific user by setting
-- request.jwt.claims + switching role, rather than an actual login --
-- each assertion runs in its own transaction, rolled back so nothing
-- persists. Any failed assertion raises an exception, making this
-- script exit non-zero.
--
-- Run with: npx supabase db query --local -f supabase/tests/rls_verification.sql

-- (1) The seeded HR user can SELECT the seeded recruitment and candidates.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
begin
  if not exists (select 1 from recruitments where title = 'Backend Engineer') then
    raise exception 'FAIL: HR user cannot see the seeded recruitment';
  end if;
  if (select count(*) from candidates) < 5 then
    raise exception 'FAIL: HR user cannot see the seeded candidates';
  end if;
end $$;
rollback;

-- (2) The seeded HR user can INSERT a new candidate.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
begin
  insert into candidates (full_name, email) values ('RLS Test Candidate', 'rls-test-insert@example.com');
exception
  when others then
    raise exception 'FAIL: HR user could not insert a candidate (% - %)', sqlstate, sqlerrm;
end $$;
rollback;

-- (3) A Hiring-Manager-only user can SELECT the same recruitment, but an
-- INSERT on candidates is denied by RLS (insufficient_privilege).
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
begin
  if not exists (select 1 from recruitments where title = 'Backend Engineer') then
    raise exception 'FAIL: Hiring Manager cannot see the seeded recruitment';
  end if;
end $$;
do $$
begin
  begin
    insert into candidates (full_name, email) values ('Should Fail', 'should-fail@example.com');
    raise exception 'FAIL: Hiring Manager was able to insert a candidate (write should be denied)';
  exception
    when insufficient_privilege then
      null; -- expected: RLS denies the write
  end;
end $$;
rollback;

-- (4) An anonymous request (the `anon` role, no JWT claims) sees zero
-- recruitment rows -- mirrors the real REST behavior verified via curl
-- in Phase 3.
begin;
set local role anon;
do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from recruitments;
  if visible_count <> 0 then
    raise exception 'FAIL: anonymous request unexpectedly sees % recruitment row(s)', visible_count;
  end if;
end $$;
rollback;

-- (5) A user whose only group (Administrator) is NOT assigned to the
-- seeded recruitment sees zero recruitment rows -- the actual isolation
-- guarantee recruitment_security_groups exists to enforce, as opposed to
-- assertions (1)/(3) above which only exercise groups that ARE assigned.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  visible_count int;
begin
  select count(*) into visible_count from recruitments;
  if visible_count <> 0 then
    raise exception 'FAIL: user in an unrelated group unexpectedly sees % recruitment row(s)', visible_count;
  end if;
end $$;
rollback;

-- (6) The seeded HR user calls create_recruitment and immediately sees
-- the new row -- proves the atomic RPC solves the invisible-row deadlock
-- (see recruiter-creates-recruitment/research.md): a plain two-statement
-- insert-then-link sequence strands a row the creator can never reach.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_group_id bigint;
  v_recruitment public.recruitments;
begin
  select id into v_group_id from security_groups where name = 'HR/Rekruter';
  select * into v_recruitment from public.create_recruitment(
    'RLS Test Recruitment',
    'Engineering',
    'Remote',
    'full-time',
    current_date,
    array[v_group_id]
  );

  if not exists (select 1 from recruitments where id = v_recruitment.id) then
    raise exception 'FAIL: HR user cannot see the recruitment they just created via create_recruitment';
  end if;
end $$;
rollback;

-- (7) A Hiring-Manager-only user (no recruitment.write) calling
-- create_recruitment is denied -- the RPC re-checks has_operation itself
-- since SECURITY DEFINER bypasses RLS.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_group_id bigint;
begin
  select id into v_group_id from security_groups where name = 'Hiring Manager';
  begin
    perform public.create_recruitment('Should Fail', 'Engineering', 'Remote', 'full-time', current_date, array[v_group_id]);
    raise exception 'FAIL: Hiring Manager was able to call create_recruitment (write should be denied)';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'FAIL: create_recruitment raised an unexpected error for Hiring Manager (% - %)', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

-- (8) An Administrator user (group.manage only, no recruitment.write) is
-- likewise denied by create_recruitment.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_group_id bigint;
begin
  select id into v_group_id from security_groups where name = 'Administrator';
  begin
    perform public.create_recruitment('Should Fail', 'Engineering', 'Remote', 'full-time', current_date, array[v_group_id]);
    raise exception 'FAIL: Administrator was able to call create_recruitment (write should be denied)';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'FAIL: create_recruitment raised an unexpected error for Administrator (% - %)', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

-- (9) The seeded HR user calling create_recruitment with an empty group
-- array is rejected -- FR-001a's "at least one group" rule, enforced
-- in-transaction since no DB constraint can express it.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
begin
  begin
    perform public.create_recruitment('Should Fail', 'Engineering', 'Remote', 'full-time', current_date, array[]::bigint[]);
    raise exception 'FAIL: create_recruitment accepted an empty group array';
  exception
    when others then
      if sqlstate <> '22023' then
        raise exception 'FAIL: create_recruitment raised an unexpected error for an empty group array (% - %)', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

-- (10) S-03: the seeded HR user inserts an override stage row on the
-- seeded recruitment (which they are linked to via HR/Rekruter) -- allowed.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_recruitment_id bigint;
begin
  select id into v_recruitment_id from recruitments where title = 'Backend Engineer';
  insert into kanban_stages (recruitment_id, name, sort_order) values (v_recruitment_id, 'RLS Test Stage', 100);
exception
  when others then
    raise exception 'FAIL: HR user could not insert an override stage on a linked recruitment (% - %)', sqlstate, sqlerrm;
end $$;
rollback;

-- (11) The seeded HR user attempts to insert a global default stage row
-- -- denied; defaults stay administrator-only.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
begin
  begin
    insert into kanban_stages (recruitment_id, name, sort_order) values (null, 'Should Fail', 100);
    raise exception 'FAIL: HR user was able to insert a global default stage (write should be denied)';
  exception
    when insufficient_privilege then
      null; -- expected: RLS denies the write
  end;
end $$;
rollback;

-- (12) The seeded HR user attempts to insert an override stage row on a
-- recruitment they are NOT linked to -- denied.
begin;
do $$
declare
  v_other_recruitment_id bigint;
begin
  insert into recruitments (title, location, department, employment_type, opened_at, status)
  values ('Unlinked Recruitment', 'Remote', 'Engineering', 'full-time', current_date, 'draft')
  returning id into v_other_recruitment_id;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  begin
    insert into kanban_stages (recruitment_id, name, sort_order) values (v_other_recruitment_id, 'Should Fail', 100);
    raise exception 'FAIL: HR user was able to insert an override stage on a recruitment they are not linked to';
  exception
    when insufficient_privilege then
      null; -- expected: RLS denies the write
  end;
end $$;
rollback;

-- (13) An Administrator user updates a global default stage's name --
-- allowed.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_updated_name text;
begin
  update kanban_stages
  set name = 'RLS Test Renamed Stage'
  where recruitment_id is null and name = 'New'
  returning name into v_updated_name;

  if v_updated_name is distinct from 'RLS Test Renamed Stage' then
    raise exception 'FAIL: Administrator update did not land -- no row matched or the name did not change';
  end if;
end $$;
rollback;

-- (14) An Administrator user (group.manage only) attempts to insert an
-- override stage row on a recruitment they are not linked to -- denied;
-- group.manage is not a recruitment scope. The recruitment id is read as
-- the unrestricted migration role, before switching to `authenticated`,
-- since the Administrator has no recruitment.read scope on it either.
begin;
do $$
declare
  v_recruitment_id bigint;
begin
  select id into v_recruitment_id from recruitments where title = 'Backend Engineer';

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  begin
    insert into kanban_stages (recruitment_id, name, sort_order) values (v_recruitment_id, 'Should Fail', 100);
    raise exception 'FAIL: Administrator was able to insert an override stage on an unlinked recruitment';
  exception
    when insufficient_privilege then
      null; -- expected: RLS denies the write
  end;
end $$;
rollback;

-- (15) The stage<->recruitment consistency trigger rejects pointing a
-- candidate at another recruitment's override stage.
begin;
do $$
declare
  v_recruitment_id bigint;
  v_other_recruitment_id bigint;
  v_other_stage_id bigint;
  v_candidate_id bigint;
begin
  select id into v_recruitment_id from recruitments where title = 'Backend Engineer';

  insert into recruitments (title, location, department, employment_type, opened_at, status)
  values ('Other Recruitment', 'Remote', 'Engineering', 'full-time', current_date, 'draft')
  returning id into v_other_recruitment_id;

  insert into kanban_stages (recruitment_id, name, sort_order)
  values (v_other_recruitment_id, 'Other Stage', 1)
  returning id into v_other_stage_id;

  select id into v_candidate_id from candidates where email = 'anna.kowalska@example.com';

  begin
    insert into candidate_recruitments (candidate_id, recruitment_id, current_stage_id)
    values (v_candidate_id, v_recruitment_id, v_other_stage_id);
    raise exception 'FAIL: candidate_recruitments accepted a stage belonging to a different recruitment';
  exception
    when others then
      if sqlstate <> '22023' then
        raise exception 'FAIL: consistency trigger raised an unexpected error (% - %)', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

-- (16) S-03: Administrator renames and reorders the default set via
-- update_default_stages -- proves the RPC's rename-in-place and
-- two-phase negate-then-assign renumber (see
-- 20260901162000_kanban_stage_rpcs.sql) actually work end to end, not
-- just via the ad hoc psql checks done during implementation.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_names text[];
begin
  select array_agg(name order by sort_order) into v_names
  from public.update_default_stages(
    jsonb_build_array(
      jsonb_build_object('id', 6, 'name', 'Rejected'),
      jsonb_build_object('id', 1, 'name', 'Renamed New'),
      jsonb_build_object('id', 2, 'name', 'Screening'),
      jsonb_build_object('id', 3, 'name', 'Interview'),
      jsonb_build_object('id', 4, 'name', 'Offer'),
      jsonb_build_object('id', 5, 'name', 'Hired')
    )
  );

  if v_names is distinct from array['Rejected', 'Renamed New', 'Screening', 'Interview', 'Offer', 'Hired'] then
    raise exception 'FAIL: update_default_stages did not rename/reorder as submitted, got %', v_names;
  end if;
end $$;
rollback;

-- (17) update_default_stages refuses to remove a default stage that
-- candidates or history still reference, naming the stage (PA002).
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
begin
  begin
    -- Omits stage 1 ("New"), which the seeded HR candidate Anna Kowalska
    -- currently occupies -- must be refused, not silently dropped.
    perform public.update_default_stages(
      jsonb_build_array(
        jsonb_build_object('id', 2, 'name', 'Screening'),
        jsonb_build_object('id', 3, 'name', 'Interview'),
        jsonb_build_object('id', 4, 'name', 'Offer'),
        jsonb_build_object('id', 5, 'name', 'Hired'),
        jsonb_build_object('id', 6, 'name', 'Rejected')
      )
    );
    raise exception 'FAIL: update_default_stages removed a stage still referenced by a candidate';
  exception
    when others then
      if sqlstate <> 'PA002' then
        raise exception 'FAIL: update_default_stages raised an unexpected error for a referenced removal (% - %)', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

-- (18) update_default_stages successfully removes an unreferenced
-- default stage ("Rejected" -- no seeded candidate or history row
-- points at it) and inserts a net addition in the same call.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_names text[];
begin
  select array_agg(name order by sort_order) into v_names
  from public.update_default_stages(
    jsonb_build_array(
      jsonb_build_object('id', 1, 'name', 'New'),
      jsonb_build_object('id', 2, 'name', 'Screening'),
      jsonb_build_object('id', 3, 'name', 'Interview'),
      jsonb_build_object('id', 4, 'name', 'Offer'),
      jsonb_build_object('id', 5, 'name', 'Hired'),
      jsonb_build_object('name', 'Onboarding')
    )
  );

  if v_names is distinct from array['New', 'Screening', 'Interview', 'Offer', 'Hired', 'Onboarding'] then
    raise exception 'FAIL: update_default_stages did not apply the net removal + addition as submitted, got %', v_names;
  end if;
end $$;
rollback;

select 'RLS verification passed' as result;
