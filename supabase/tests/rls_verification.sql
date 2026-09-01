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

select 'RLS verification passed' as result;
