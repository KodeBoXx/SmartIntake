create table form_authoring_speech_usage (
  organization_id uuid not null references organizations(id) on delete cascade,
  scope varchar(16) not null check (scope in ('TENANT', 'USER')),
  subject_id uuid not null,
  usage_day date not null,
  request_count integer not null check (request_count >= 0),
  primary key (organization_id, scope, subject_id, usage_day),
  check ((scope = 'TENANT' and subject_id = organization_id) or scope = 'USER')
);
