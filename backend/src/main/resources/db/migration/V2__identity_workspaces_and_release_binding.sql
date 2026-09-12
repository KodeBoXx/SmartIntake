create table accounts (id uuid primary key, email varchar(254) unique not null, password_hash varchar(100) not null, created_at timestamptz not null default now());
create table organizations (id uuid primary key, name varchar(160) not null, created_at timestamptz not null default now());
create table workspaces (id uuid primary key, organization_id uuid not null references organizations(id), workspace_key varchar(100) unique not null, name varchar(160) not null, created_at timestamptz not null default now());
create table memberships (account_id uuid not null references accounts(id), workspace_id uuid not null references workspaces(id), role varchar(30) not null, primary key(account_id,workspace_id,role));
create table staff_sessions (token uuid primary key, account_id uuid not null references accounts(id), expires_at timestamptz not null, created_at timestamptz not null default now());
alter table forms add column workspace_id uuid references workspaces(id);
alter table sessions add column release_id uuid references form_releases(id);
create index forms_workspace_idx on forms(workspace_id); create index sessions_release_idx on sessions(release_id);
