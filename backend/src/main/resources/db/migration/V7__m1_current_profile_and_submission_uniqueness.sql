insert into compatibility_profiles(profile_key,display_name,contract_version,read_only,new_write_allowed,description)
values ('m1-current-prototype','M1 current prototype','4.0.0',false,true,'The writable M1 prototype profile. It preserves the current product behavior but does not claim an M2 normative full 4.0.0 profile.')
on conflict (profile_key) do nothing;

-- This preflight is intentionally deterministic: source submissions are never deleted or merged
-- by a compatibility migration. A deployment with duplicates must reconcile them before applying
-- this schema guard rather than silently choosing a receipt to retain.
do $$
begin
  if exists (select 1 from submissions group by session_id having count(*) > 1) then
    raise exception 'Cannot add one-submission-per-session constraint: duplicate submissions require explicit reconciliation';
  end if;
end $$;

alter table submissions add constraint submissions_session_id_unique unique (session_id);
