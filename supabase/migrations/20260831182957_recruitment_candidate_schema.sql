-- Recruitment & candidate domain schema: recruitments, which security
-- groups a recruitment is visible to, the kanban stage set (global
-- defaults now, per-recruitment overrides in a future migration),
-- candidates, the candidate<->recruitment link, and its status-change
-- history log.
--
-- RLS is intentionally NOT enabled in this migration -- see the
-- rls_policies migration, which enables it together for every table
-- from this migration and the security_rbac_schema migration.

create extension if not exists pg_trgm with schema extensions;

create table recruitments (
  id bigint generated always as identity primary key,
  title text not null,
  location text,
  department text,
  employment_type text,
  opened_at date,
  status text not null default 'draft' check (status in ('draft', 'live', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recruitment_security_groups (
  id bigint generated always as identity primary key,
  recruitment_id bigint not null references recruitments (id) on delete cascade,
  group_id bigint not null references security_groups (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (recruitment_id, group_id)
);

-- Explicit index on group_id: the unique constraint above only optimizes
-- lookups where recruitment_id is the leading column.
create index recruitment_security_groups_group_id_idx on recruitment_security_groups (group_id);

create table kanban_stages (
  id bigint generated always as identity primary key,
  recruitment_id bigint references recruitments (id) on delete cascade,
  name text not null,
  sort_order int not null,
  created_at timestamptz not null default now()
);

-- Two partial unique indexes instead of one plain unique(recruitment_id,
-- sort_order): Postgres treats every NULL as distinct, so a plain unique
-- constraint would not catch duplicate default (NULL) rows.
create unique index kanban_stages_default_sort_order_key on kanban_stages (sort_order) where recruitment_id is null;
create unique index kanban_stages_recruitment_sort_order_key on kanban_stages (recruitment_id, sort_order) where recruitment_id is not null;

-- Default global kanban stage set -- real product config shipped to every
-- environment (including prod), not test/dev-only data. See seed.sql for
-- the local-only PRD example groups + fixtures.
insert into kanban_stages (name, sort_order) values
  ('Nowy', 1),
  ('Screening', 2),
  ('Rozmowa', 3),
  ('Oferta', 4),
  ('Zatrudniony', 5),
  ('Odrzucony', 6);

create table candidates (
  id bigint generated always as identity primary key,
  full_name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive dedup key: the app-layer "add candidate" flow (S-04)
-- looks up by lowercased email first and links to the existing row on a
-- match, satisfying FR-007's shared-profile requirement.
create unique index candidates_email_key on candidates (lower(email));

-- Trigram search index for name lookup (S-06).
create index candidates_full_name_trgm_idx on candidates using gin (full_name gin_trgm_ops);

create table candidate_recruitments (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references candidates (id) on delete cascade,
  recruitment_id bigint not null references recruitments (id) on delete cascade,
  current_stage_id bigint not null references kanban_stages (id) on delete restrict,
  added_at timestamptz not null default now(),
  unique (candidate_id, recruitment_id)
);

-- Explicit indexes: the unique constraint above only optimizes lookups
-- where candidate_id is the leading column, but the kanban board's primary
-- query pattern is "all candidates for a recruitment".
create index candidate_recruitments_recruitment_id_idx on candidate_recruitments (recruitment_id);
create index candidate_recruitments_current_stage_id_idx on candidate_recruitments (current_stage_id);

create table candidate_recruitment_status_history (
  id bigint generated always as identity primary key,
  candidate_recruitment_id bigint not null references candidate_recruitments (id) on delete cascade,
  from_stage_id bigint references kanban_stages (id),
  to_stage_id bigint not null references kanban_stages (id),
  changed_by uuid references auth.users (id),
  changed_at timestamptz not null default now()
);

-- Append-only log; no UPDATE/DELETE policy will ever be defined on this
-- table (see rls_policies migration).
create index candidate_recruitment_status_history_cr_id_idx on candidate_recruitment_status_history (candidate_recruitment_id);
