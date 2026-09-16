create table compatibility_profiles (
  profile_key varchar(80) primary key,
  display_name varchar(160) not null,
  contract_version varchar(40),
  read_only boolean not null default true,
  new_write_allowed boolean not null default false,
  description text not null,
  created_at timestamptz not null default now()
);

insert into compatibility_profiles(profile_key,display_name,contract_version,read_only,new_write_allowed,description)
values ('legacy-prototype','Legacy prototype','4.0.0',true,false,'The pre-M1 pages[] prototype. A contractVersion value alone is not a normative full-profile claim.')
on conflict (profile_key) do nothing;

create table record_migration_state (
  record_type varchar(40) not null,
  record_key varchar(200) not null,
  profile_key varchar(80) references compatibility_profiles(profile_key),
  source_digest char(64) not null,
  target_digest char(64),
  state varchar(40) not null,
  reason_code varchar(80),
  attempt_count integer not null default 1,
  reconciled_at timestamptz not null default now(),
  primary key (record_type,record_key)
);

create table compatibility_quarantine_evidence (
  record_type varchar(40) not null,
  record_key varchar(200) not null,
  source_digest char(64) not null,
  reason_code varchar(80) not null,
  evidence jsonb not null default '{}'::jsonb,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  primary key (record_type,record_key)
);

alter table forms add column if not exists compatibility_profile_key varchar(80) references compatibility_profiles(profile_key);
alter table form_releases add column if not exists compatibility_profile_key varchar(80) references compatibility_profiles(profile_key);
alter table sessions add column if not exists compatibility_profile_key varchar(80) references compatibility_profiles(profile_key);
alter table sessions add column if not exists respondent_secret_sha256 char(64);
