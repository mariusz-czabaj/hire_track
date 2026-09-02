-- S-05: RLS on storage.objects for the candidate-cvs bucket. Storage RLS
-- is evaluated when a signed URL is minted and never again -- the
-- upload/download requests that follow carry only a bearer token, not a
-- session. These three policies are therefore the entire authorisation
-- perimeter for the CV lifecycle; without them the bucket rejects
-- everything, and with the wrong ones the mint endpoint becomes
-- decorative in exactly the way S-04's plan warned about.
--
-- Purge needs a DELETE policy that admits both an HR user
-- (candidate.write) and an Administrator (group.manage, who holds no
-- candidate operation at all) -- see the RPCs in
-- 20260902110000_candidate_cv_rpcs.sql for why the disjunction lives
-- here rather than as a new operation.
--
-- Postgres RLS combines the SELECT policy into UPDATE/DELETE row
-- visibility -- a row invisible under SELECT cannot be matched by a
-- DELETE's own USING clause either, confirmed by EXPLAIN during
-- implementation. The same applies to the Storage API's object listing,
-- which the purge uses to find candidates. So the SELECT policy must
-- admit everyone the DELETE policy admits, or an Administrator's DELETE
-- permission would be unreachable in practice.
--
-- No grants: the storage schema ships with them, and access is governed
-- entirely by these policies.
create policy candidate_cvs_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'candidate-cvs'
    and (
      (select private.has_operation('candidate.read'))
      or (select private.has_operation('candidate.write'))
      or (select private.has_operation('group.manage'))
    )
  );

create policy candidate_cvs_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'candidate-cvs'
    and (select private.has_operation('candidate.write'))
  );

create policy candidate_cvs_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'candidate-cvs'
    and (
      (select private.has_operation('candidate.write'))
      or (select private.has_operation('group.manage'))
    )
  );
