-- S-05: CV metadata for the shared candidate profile (FR-011, FR-012,
-- FR-013a). One active CV per candidate, enforced by the partial unique
-- index below -- that index, not application code, is what guarantees
-- the invariant the rest of the model rests on. `status` lets the
-- two-phase upload record an unconfirmed row before the bytes finish
-- landing; `expires_at` is set once at insert time by the trigger below
-- so the download gate and the purge query can never define "12 months"
-- differently. Rows are never deleted, only updated to `superseded` or
-- stamped with `object_deleted_at` -- a tombstone survives byte deletion
-- so the profile can still explain the CV's absence.
--
-- expires_at is NOT a `generated always as` column: `timestamptz +
-- interval` is STABLE, not IMMUTABLE (month/day arithmetic depends on
-- the session TimeZone for DST), and Postgres rejects a non-immutable
-- generation expression. A BEFORE INSERT trigger gives the same
-- single-source-of-truth guarantee -- computed once, from uploaded_at,
-- and never recomputed anywhere else.
create table candidate_cvs (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references candidates (id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'active', 'superseded')),
  uploaded_at timestamptz not null default now(),
  expires_at timestamptz not null,
  object_deleted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.set_candidate_cv_expires_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.expires_at = new.uploaded_at + interval '12 months';
  return new;
end;
$$;

create trigger set_expires_at before insert on candidate_cvs
  for each row execute function private.set_candidate_cv_expires_at();

-- The invariant: at most one active CV per candidate.
create unique index candidate_cvs_one_active_idx on candidate_cvs (candidate_id) where status = 'active';

create index candidate_cvs_candidate_id_idx on candidate_cvs (candidate_id);

-- Supports the purge query: rows not yet purged that are either
-- superseded or past their expiry.
create index candidate_cvs_purgeable_idx on candidate_cvs (status, expires_at) where object_deleted_at is null;

create trigger set_updated_at before update on candidate_cvs
  for each row execute function private.set_updated_at();

alter table candidate_cvs enable row level security;

-- candidate_cvs is gated by the same org-wide candidate.read/write
-- operations as `candidates` itself (rls_policies.sql:175-190) -- the CV
-- is part of the shared profile, not scoped to any one recruitment. No
-- DELETE policy: rows are tombstoned via UPDATE, never removed.
create policy candidate_cvs_select on candidate_cvs
  for select to authenticated
  using ((select private.has_operation('candidate.read')));

create policy candidate_cvs_insert on candidate_cvs
  for insert to authenticated
  with check ((select private.has_operation('candidate.write')));

create policy candidate_cvs_update on candidate_cvs
  for update to authenticated
  using ((select private.has_operation('candidate.write')))
  with check ((select private.has_operation('candidate.write')));

grant select, insert, update on candidate_cvs to authenticated;
