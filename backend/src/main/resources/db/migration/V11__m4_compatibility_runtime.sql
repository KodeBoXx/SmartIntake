insert into compatibility_profiles(profile_key,display_name,contract_version,read_only,new_write_allowed,description)
values ('canonical-4.0.0','Canonical 4.0.0','4.0.0',false,true,'A complete FormCompiler-validated canonical 4.0.0 package. It is writable and distinct from the M1 prototype profile.')
on conflict (profile_key) do nothing;

alter table sessions add column runtime_state jsonb;

alter table session_mutations
  alter column client_mutation_id type varchar(200) using client_mutation_id::text;

alter table session_mutations
  add constraint session_mutations_client_mutation_id_opaque_id
  check (client_mutation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$');
