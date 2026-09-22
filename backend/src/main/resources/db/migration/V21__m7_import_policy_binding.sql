alter table form_import_candidates add column policy_hash varchar(128) not null default 'sha256:legacy';
