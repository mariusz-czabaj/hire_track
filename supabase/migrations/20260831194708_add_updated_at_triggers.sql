-- recruitments/candidates.updated_at defaulted to now() on INSERT only,
-- with nothing keeping it accurate on UPDATE. Add a shared trigger so it
-- stays correct regardless of what the app layer does.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on recruitments
  for each row execute function private.set_updated_at();

create trigger set_updated_at before update on candidates
  for each row execute function private.set_updated_at();
