create index if not exists record_migration_state_profile_idx on record_migration_state(profile_key);
create index if not exists record_migration_state_state_idx on record_migration_state(state);
create index if not exists compatibility_quarantine_reason_idx on compatibility_quarantine_evidence(reason_code);
create index if not exists forms_compatibility_profile_idx on forms(compatibility_profile_key);
create index if not exists form_releases_compatibility_profile_idx on form_releases(compatibility_profile_key);
create index if not exists sessions_compatibility_profile_idx on sessions(compatibility_profile_key);
