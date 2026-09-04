-- S-07 review F8: treat the search term as a literal, not as a LIKE pattern.
--
-- 20260904120000 concatenated the caller's term straight into an ilike
-- pattern. The value was parameterised (so never an injection), but `%` and
-- `_` reached the matcher as wildcards: a term of `%%` clears the two-character
-- minimum and matches every user, and `_a` sweeps the directory 20 rows at a
-- time. That defeats the bounded-lookup intent the function was written for --
-- the narrow replacement for the unscoped enumeration RPC dropped in S-04.
--
-- The length check now runs against the raw term, so escaping cannot be used
-- to pad a one-character search past the minimum.

create or replace function public.search_users_for_group_management(search_term text)
returns table (id uuid, email text)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_term text;
begin
  if not (select private.has_operation('group.manage')) then
    raise exception 'insufficient_privilege: group.manage required' using errcode = '42501';
  end if;

  v_term := trim(coalesce(search_term, ''));

  if length(v_term) < 2 then
    return;
  end if;

  -- Escape the LIKE metacharacters so the term matches literally. Backslash
  -- first, or it would double-escape the escapes added after it.
  v_term := replace(v_term, '\', '\\');
  v_term := replace(v_term, '%', '\%');
  v_term := replace(v_term, '_', '\_');

  return query
    select u.id, u.email::text
    from auth.users u
    where u.email ilike '%' || v_term || '%' escape '\'
    order by u.email
    limit 20;
end;
$$;
