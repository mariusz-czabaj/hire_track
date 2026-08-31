-- Security & RBAC schema: security groups, the operations catalog, group
-- membership, and which operations each group has been granted.
--
-- RLS is intentionally NOT enabled in this migration. The helper functions
-- that drive policy checks need recruitment_security_groups (introduced in
-- the domain-schema migration) to exist first; RLS for every table from
-- this migration is enabled together with the domain schema's tables in the
-- rls_policies migration.

create type operation as enum (
  'recruitment.read',
  'recruitment.write',
  'candidate.read',
  'candidate.write',
  'group.manage'
);

create table security_groups (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table group_memberships (
  id bigint generated always as identity primary key,
  group_id bigint not null references security_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

-- Explicit index on user_id: the unique constraint above only optimizes
-- lookups where group_id is the leading column.
create index group_memberships_user_id_idx on group_memberships (user_id);

create table group_operations (
  id bigint generated always as identity primary key,
  group_id bigint not null references security_groups (id) on delete cascade,
  operation operation not null,
  unique (group_id, operation)
);
