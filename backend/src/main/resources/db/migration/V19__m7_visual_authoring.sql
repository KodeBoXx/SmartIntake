-- M7 authoring metadata is deliberately separate from the canonical package in forms.definition.
create table form_authoring_history (
  id uuid primary key,
  form_id uuid not null references forms(id) on delete cascade,
  draft_id uuid not null,
  revision bigint not null,
  command_id varchar(128) not null,
  actor_account_id uuid not null references accounts(id),
  operation varchar(64) not null,
  command jsonb not null,
  inverse_command jsonb not null,
  before_hash varchar(128) not null,
  after_hash varchar(128) not null,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  unique(form_id, draft_id, command_id)
);
create index form_authoring_history_form_cursor_idx on form_authoring_history(form_id, draft_id, created_at desc);

create table form_authoring_conflicts (
  id uuid primary key,
  form_id uuid not null references forms(id) on delete cascade,
  draft_id uuid not null,
  expected_revision bigint not null,
  actual_revision bigint not null,
  client_hash varchar(128) not null,
  server_hash varchar(128) not null,
  client_package jsonb not null,
  server_package jsonb not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table form_import_candidates (
  id uuid primary key,
  form_id uuid not null references forms(id) on delete cascade,
  draft_id uuid not null,
  base_revision bigint not null,
  candidate_digest varchar(128) not null,
  candidate jsonb not null,
  diagnostics jsonb not null default '[]'::jsonb,
  state varchar(24) not null,
  created_by uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index form_import_candidates_form_idx on form_import_candidates(form_id, draft_id, created_at desc);

create table reusable_components (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  component_key varchar(120) not null,
  name varchar(200) not null,
  version integer not null,
  status varchar(24) not null default 'ACTIVE',
  fragment jsonb not null,
  fragment_hash varchar(128) not null,
  created_by uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, component_key, version)
);

create table form_authoring_comments (
  id uuid primary key,
  form_id uuid not null references forms(id) on delete cascade,
  draft_id uuid not null,
  pointer varchar(1000) not null,
  body varchar(4000) not null,
  author_account_id uuid not null references accounts(id),
  created_at timestamptz not null default now()
);
create index form_authoring_comments_form_idx on form_authoring_comments(form_id, draft_id, created_at);

create table form_authoring_presence (
  form_id uuid not null references forms(id) on delete cascade,
  draft_id uuid not null,
  account_id uuid not null references accounts(id),
  cursor_pointer varchar(1000),
  display_name varchar(200),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key(form_id, draft_id, account_id)
);
