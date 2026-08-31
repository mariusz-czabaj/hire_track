-- candidate_recruitment_status_history.changed_by had no explicit ON DELETE
-- action, defaulting to NO ACTION -- since the column is nullable, the
-- intent is to allow anonymizing history when a user account is deleted,
-- not to permanently block that user's deletion. Switch to SET NULL so an
-- auth.users row can be removed (offboarding/erasure) while the append-only
-- history row itself is preserved, just unattributed.
alter table candidate_recruitment_status_history
  drop constraint candidate_recruitment_status_history_changed_by_fkey,
  add constraint candidate_recruitment_status_history_changed_by_fkey
    foreign key (changed_by) references auth.users (id) on delete set null;
