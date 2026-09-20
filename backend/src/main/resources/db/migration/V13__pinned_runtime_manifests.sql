alter table form_releases add column if not exists runtime_manifest jsonb;
alter table submissions add column if not exists runtime_manifest jsonb;
