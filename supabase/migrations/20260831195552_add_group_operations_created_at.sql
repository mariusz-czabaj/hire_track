-- group_operations was missing created_at, unlike its sibling
-- security_groups/group_memberships tables, leaving no audit trail for
-- when a permission grant was added.
alter table group_operations
  add column created_at timestamptz not null default now();
