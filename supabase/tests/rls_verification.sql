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

-- (19) S-04: moving a candidate with no note for the stage being left
-- is refused (PA004), and the stage does not change.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_cr_id bigint;
  v_stage_before bigint;
  v_stage_after bigint;
  v_offer_stage_id bigint;
begin
  select cr.id, cr.current_stage_id into v_cr_id, v_stage_before
  from candidate_recruitments cr
  join candidates c on c.id = cr.candidate_id
  where c.email = 'piotr.nowak@example.com';

  select id into v_offer_stage_id from kanban_stages where recruitment_id is null and name = 'Offer';

  begin
    perform public.move_candidate_stage(v_cr_id, v_offer_stage_id, null);
    raise exception 'FAIL: move_candidate_stage allowed a move with no source-stage note';
  exception
    when others then
      if sqlstate <> 'PA004' then
        raise exception 'FAIL: move_candidate_stage raised an unexpected error for a missing note (% - %)', sqlstate, sqlerrm;
      end if;
  end;

  select current_stage_id into v_stage_after from candidate_recruitments where id = v_cr_id;
  if v_stage_after is distinct from v_stage_before then
    raise exception 'FAIL: candidate stage changed despite the blocked move';
  end if;
end $$;
rollback;

-- (20) The same move succeeds once a note is supplied, and writes
-- exactly one new history row.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_cr_id bigint;
  v_offer_stage_id bigint;
  v_history_count_before int;
  v_history_count_after int;
  v_stage_after bigint;
begin
  select cr.id into v_cr_id
  from candidate_recruitments cr
  join candidates c on c.id = cr.candidate_id
  where c.email = 'piotr.nowak@example.com';

  select id into v_offer_stage_id from kanban_stages where recruitment_id is null and name = 'Offer';

  select count(*) into v_history_count_before
  from candidate_recruitment_status_history
  where candidate_recruitment_id = v_cr_id;

  perform public.move_candidate_stage(v_cr_id, v_offer_stage_id, 'Strong technical screen, moving forward.');

  select current_stage_id into v_stage_after from candidate_recruitments where id = v_cr_id;
  if v_stage_after is distinct from v_offer_stage_id then
    raise exception 'FAIL: move_candidate_stage did not update current_stage_id, got %', v_stage_after;
  end if;

  select count(*) into v_history_count_after
  from candidate_recruitment_status_history
  where candidate_recruitment_id = v_cr_id;
  if v_history_count_after <> v_history_count_before + 1 then
    raise exception 'FAIL: move_candidate_stage wrote % history rows instead of exactly 1', v_history_count_after - v_history_count_before;
  end if;
end $$;
rollback;

-- (21) A backward move works identically, gated on a note for the
-- stage being left.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_cr_id bigint;
  v_new_stage_id bigint;
  v_stage_after bigint;
begin
  select cr.id into v_cr_id
  from candidate_recruitments cr
  join candidates c on c.id = cr.candidate_id
  where c.email = 'katarzyna.wisniewska@example.com';

  select id into v_new_stage_id from kanban_stages where recruitment_id is null and name = 'New';

  perform public.move_candidate_stage(v_cr_id, v_new_stage_id, 'Reopening -- schedule was cancelled.');

  select current_stage_id into v_stage_after from candidate_recruitments where id = v_cr_id;
  if v_stage_after is distinct from v_new_stage_id then
    raise exception 'FAIL: backward move_candidate_stage did not update current_stage_id, got %', v_stage_after;
  end if;
end $$;
rollback;

-- (22) A Hiring-Manager-only user (recruitment.read but no
-- recruitment.write) is denied by move_candidate_stage (42501).
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_cr_id bigint;
  v_offer_stage_id bigint;
begin
  select cr.id into v_cr_id
  from candidate_recruitments cr
  join candidates c on c.id = cr.candidate_id
  where c.email = 'piotr.nowak@example.com';

  select id into v_offer_stage_id from kanban_stages where recruitment_id is null and name = 'Offer';

  begin
    perform public.move_candidate_stage(v_cr_id, v_offer_stage_id, 'Attempted by a hiring manager.');
    raise exception 'FAIL: Hiring Manager was able to move a candidate (write should be denied)';
  exception
    when others then
      if sqlstate <> '42501' then
        raise exception 'FAIL: move_candidate_stage raised an unexpected error for a HM caller (% - %)', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

-- (23) A user unrelated to the recruitment (Administrator, not assigned
-- to Backend Engineer) gets not_found (P0002) from move_candidate_stage.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_cr_id bigint;
  v_offer_stage_id bigint;
begin
  select cr.id into v_cr_id
  from candidate_recruitments cr
  join candidates c on c.id = cr.candidate_id
  where c.email = 'piotr.nowak@example.com';

  select id into v_offer_stage_id from kanban_stages where recruitment_id is null and name = 'Offer';

  begin
    perform public.move_candidate_stage(v_cr_id, v_offer_stage_id, 'Attempted by an unrelated user.');
    raise exception 'FAIL: an unrelated user was able to move a candidate (should be not_found)';
  exception
    when others then
      if sqlstate <> 'P0002' then
        raise exception 'FAIL: move_candidate_stage raised an unexpected error for an unrelated caller (% - %)', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

-- (24) S-04: add_candidate_to_recruitment links to an existing profile
-- on an email match instead of duplicating it. The fixture recruitment
-- is created as the unrestricted migration role, before switching to
-- `authenticated`, for the same chicken-and-egg reason as block (15) --
-- recruitments_select has nothing to scope against until the group link
-- exists.
begin;
do $$
declare
  v_new_recruitment_id bigint;
begin
  insert into recruitments (title, location, department, employment_type, opened_at, status)
  values ('Second Recruitment', 'Remote', 'Engineering', 'full-time', current_date, 'draft')
  returning id into v_new_recruitment_id;

  insert into recruitment_security_groups (recruitment_id, group_id)
  values (v_new_recruitment_id, (select id from security_groups where name = 'HR/Rekruter'));

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  declare
    v_existing_candidate_id bigint;
    v_cr public.candidate_recruitments%rowtype;
    v_candidate_count int;
  begin
    select id into v_existing_candidate_id from candidates where email = 'piotr.nowak@example.com';
    select count(*) into v_candidate_count from candidates;

    select * into v_cr from public.add_candidate_to_recruitment(
      v_new_recruitment_id, 'Piotr Nowak', 'piotr.nowak@example.com', null
    );

    if v_cr.candidate_id is distinct from v_existing_candidate_id then
      raise exception 'FAIL: add_candidate_to_recruitment did not link to the existing candidate profile';
    end if;

    if (select count(*) from candidates) <> v_candidate_count then
      raise exception 'FAIL: add_candidate_to_recruitment duplicated the candidate profile on an email match';
    end if;
  end;
end $$;
rollback;

-- (25) add_candidate_to_recruitment refuses an email match under a
-- different name (PA003). Same fixture-before-role-switch ordering as
-- block (24).
begin;
do $$
declare
  v_new_recruitment_id bigint;
begin
  insert into recruitments (title, location, department, employment_type, opened_at, status)
  values ('Third Recruitment', 'Remote', 'Engineering', 'full-time', current_date, 'draft')
  returning id into v_new_recruitment_id;

  insert into recruitment_security_groups (recruitment_id, group_id)
  values (v_new_recruitment_id, (select id from security_groups where name = 'HR/Rekruter'));

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  begin
    perform public.add_candidate_to_recruitment(
      v_new_recruitment_id, 'Somebody Else', 'piotr.nowak@example.com', null
    );
    raise exception 'FAIL: add_candidate_to_recruitment linked an email match under a mismatched name';
  exception
    when others then
      if sqlstate <> 'PA003' then
        raise exception 'FAIL: add_candidate_to_recruitment raised an unexpected error for a name mismatch (% - %)', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

-- (26) S-04: a note insert by a user not linked to the recruitment
-- (Administrator) is denied by RLS on candidate_stage_notes.
begin;
do $$
declare
  v_cr_id bigint;
begin
  select cr.id into v_cr_id
  from candidate_recruitments cr
  join candidates c on c.id = cr.candidate_id
  where c.email = 'piotr.nowak@example.com';

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  begin
    insert into candidate_stage_notes (candidate_recruitment_id, stage_id, body)
    values (v_cr_id, (select current_stage_id from candidate_recruitments where id = v_cr_id), 'Should be denied.');
    raise exception 'FAIL: an unrelated user was able to insert a candidate stage note';
  exception
    when insufficient_privilege then
      null; -- expected: RLS denies the write
  end;
end $$;
rollback;

-- (27) S-04 impl-review F1/F6: get_user_emails_for_candidate only
-- resolves emails for note authors on a candidate_recruitment the
-- caller has recruitment.read on. HR (has recruitment.read/write on
-- Backend Engineer) gets the author's email back for a note on that
-- candidate; an unrelated user (Administrator, no access to Backend
-- Engineer) is denied with P0002.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_cr_id bigint;
  v_source_stage_id bigint;
  v_resolved_email text;
begin
  select cr.id, cr.current_stage_id into v_cr_id, v_source_stage_id
  from candidate_recruitments cr
  join candidates c on c.id = cr.candidate_id
  where c.email = 'piotr.nowak@example.com';

  insert into candidate_stage_notes (candidate_recruitment_id, stage_id, body, created_by)
  values (v_cr_id, v_source_stage_id, 'Note for email-resolution assertion.', '11111111-1111-1111-1111-111111111111')
  on conflict (candidate_recruitment_id, stage_id) do update set body = excluded.body, created_by = excluded.created_by;

  select email into v_resolved_email
  from public.get_user_emails_for_candidate(v_cr_id, array['11111111-1111-1111-1111-111111111111']::uuid[]);

  if v_resolved_email is distinct from 'hr.test@example.com' then
    raise exception 'FAIL: get_user_emails_for_candidate did not resolve the HR caller''s own visible note author, got %', v_resolved_email;
  end if;
end $$;
rollback;

begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_cr_id bigint;
begin
  select cr.id into v_cr_id
  from candidate_recruitments cr
  join candidates c on c.id = cr.candidate_id
  where c.email = 'piotr.nowak@example.com';

  begin
    perform public.get_user_emails_for_candidate(v_cr_id, array['11111111-1111-1111-1111-111111111111']::uuid[]);
    raise exception 'FAIL: an unrelated user resolved emails for a candidate_recruitment they cannot read';
  exception
    when others then
      if sqlstate <> 'P0002' then
        raise exception 'FAIL: get_user_emails_for_candidate raised an unexpected error for an unrelated caller (% - %)', sqlstate, sqlerrm;
      end if;
  end;
end $$;
rollback;

-- (28) S-05: HR can INSERT and SELECT a candidate_cvs row for a
-- candidate they have candidate.write on.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_candidate_id bigint;
  v_cv_id bigint;
begin
  select id into v_candidate_id from candidates where email = 'piotr.nowak@example.com';

  insert into candidate_cvs (candidate_id, storage_path, original_filename, mime_type, size_bytes, created_by)
  values (v_candidate_id, v_candidate_id || '/rls-test-28.pdf', 'cv.pdf', 'application/pdf', 1024, '11111111-1111-1111-1111-111111111111')
  returning id into v_cv_id;

  if v_cv_id is null then
    raise exception 'FAIL: HR insert into candidate_cvs did not return an id';
  end if;

  if not exists (select 1 from candidate_cvs where id = v_cv_id) then
    raise exception 'FAIL: HR cannot select the candidate_cvs row it just inserted';
  end if;
end $$;
rollback;

-- (29) S-05: the Hiring Manager (candidate.read but no candidate.write)
-- is denied INSERT on candidate_cvs.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_candidate_id bigint;
begin
  select id into v_candidate_id from candidates where email = 'piotr.nowak@example.com';

  begin
    insert into candidate_cvs (candidate_id, storage_path, original_filename, mime_type, size_bytes)
    values (v_candidate_id, v_candidate_id || '/rls-test-29.pdf', 'cv.pdf', 'application/pdf', 1024);
    raise exception 'FAIL: Hiring Manager was able to insert a candidate_cvs row';
  exception
    when insufficient_privilege then
      null; -- expected: RLS denies the write
  end;
end $$;
rollback;

-- (30) S-05: the Hiring Manager is denied INSERT on storage.objects in
-- the candidate-cvs bucket -- the actual gate a signed-upload mint would
-- pass through.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
begin
  begin
    insert into storage.objects (bucket_id, name) values ('candidate-cvs', 'rls-test-30.pdf');
    raise exception 'FAIL: Hiring Manager was able to insert a storage object in candidate-cvs';
  exception
    when insufficient_privilege then
      null; -- expected: RLS denies the write
  end;
end $$;
rollback;

-- (31) S-05: the Administrator (group.manage only, no candidate
-- operation) is denied SELECT on candidate_cvs but IS allowed DELETE on
-- storage.objects in the candidate-cvs bucket -- this is the disjunctive
-- purge gate (candidate.write OR group.manage) that lets an
-- Administrator run the purge endpoint despite holding no candidate
-- operation at all. storage.allow_delete_query is set because
-- storage.objects has a statement-level guard trigger rejecting raw SQL
-- DELETE outright; the app's purge code goes through the Storage API,
-- which sets this the same way -- setting it here isolates the RLS
-- policy from that separate guard.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_candidate_id bigint;
begin
  select id into v_candidate_id from candidates where email = 'piotr.nowak@example.com';

  insert into candidate_cvs (candidate_id, storage_path, original_filename, mime_type, size_bytes, created_by)
  values (v_candidate_id, v_candidate_id || '/rls-test-31.pdf', 'cv.pdf', 'application/pdf', 1024, '11111111-1111-1111-1111-111111111111');

  -- Insert the storage object as HR (candidate.write) -- the
  -- Administrator holds no candidate operation and could not insert
  -- one; only the DELETE side of the disjunctive gate is under test.
  insert into storage.objects (bucket_id, name) values ('candidate-cvs', 'rls-test-31.pdf');
end $$;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
set local storage.allow_delete_query = 'true';
do $$
declare
  v_deleted_name text;
begin
  -- SELECT-side RLS denial is silent (rows are filtered, not an
  -- exception) -- so the proof is that the row HR just inserted, above,
  -- is invisible to the Administrator.
  if (select count(*) from candidate_cvs) <> 0 then
    raise exception 'FAIL: Administrator can see candidate_cvs rows it should not';
  end if;

  delete from storage.objects
  where bucket_id = 'candidate-cvs' and name = 'rls-test-31.pdf'
  returning name into v_deleted_name;

  if v_deleted_name is distinct from 'rls-test-31.pdf' then
    raise exception 'FAIL: Administrator delete on storage.objects did not remove the row it inserted';
  end if;
end $$;
rollback;

-- (32) S-05: the partial unique index rejects a second 'active' CV for
-- the same candidate.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_candidate_id bigint;
begin
  select id into v_candidate_id from candidates where email = 'piotr.nowak@example.com';

  insert into candidate_cvs (candidate_id, storage_path, original_filename, mime_type, size_bytes, status, created_by)
  values (v_candidate_id, v_candidate_id || '/rls-test-32a.pdf', 'cv.pdf', 'application/pdf', 1024, 'active', '11111111-1111-1111-1111-111111111111');

  begin
    insert into candidate_cvs (candidate_id, storage_path, original_filename, mime_type, size_bytes, status, created_by)
    values (v_candidate_id, v_candidate_id || '/rls-test-32b.pdf', 'cv.pdf', 'application/pdf', 1024, 'active', '11111111-1111-1111-1111-111111111111');
    raise exception 'FAIL: a second active CV was inserted for the same candidate';
  exception
    when unique_violation then
      null; -- expected: candidate_cvs_one_active_idx rejects it
  end;
end $$;
rollback;

-- (33) S-05: a backdated uploaded_at produces an expires_at in the past,
-- proving the set_candidate_cv_expires_at trigger -- and that it derives
-- from the *inserted* uploaded_at, not from now(), which is what lets
-- tests exercise 12-month expiry without waiting a year.
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_candidate_id bigint;
  v_expires_at timestamptz;
begin
  select id into v_candidate_id from candidates where email = 'piotr.nowak@example.com';

  insert into candidate_cvs (candidate_id, storage_path, original_filename, mime_type, size_bytes, uploaded_at, created_by)
  values (v_candidate_id, v_candidate_id || '/rls-test-33.pdf', 'cv.pdf', 'application/pdf', 1024, now() - interval '13 months', '11111111-1111-1111-1111-111111111111')
  returning expires_at into v_expires_at;

  if v_expires_at >= now() then
    raise exception 'FAIL: a CV backdated 13 months did not produce a past expires_at, got %', v_expires_at;
  end if;
end $$;
rollback;

select 'RLS verification passed' as result;
