-- S-04: candidate_stage_notes.created_by (and status history's
-- changed_by) are auth.users ids, but `auth` is not in PostgREST's
-- exposed schemas (supabase/config.toml [api]), so the service layer
-- has no way to resolve a note's author email for display. A small
-- SECURITY DEFINER lookup RPC bridges that gap without exposing the
-- whole auth.users table.
create function public.get_user_emails(user_ids uuid[])
returns table (id uuid, email text)
language sql
security definer
set search_path = ''
stable
as $$
  select u.id, u.email::text
  from auth.users u
  where u.id = any (user_ids);
$$;

revoke execute on function public.get_user_emails(uuid[]) from public, anon;
grant execute on function public.get_user_emails(uuid[]) to authenticated;
