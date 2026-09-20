-- M6 identity lifecycle, tenant and authority state. V1-V14 remain immutable.
alter table accounts add column if not exists account_status varchar(16) not null default 'active' check (account_status in ('active','suspended'));
alter table accounts add column if not exists activation_state varchar(16) not null default 'active' check (activation_state in ('active','pending'));
alter table accounts add column if not exists display_name varchar(120);
alter table accounts add column if not exists temporary_password_expires_at timestamptz;
alter table accounts add column if not exists revision bigint not null default 0;
alter table organizations add column if not exists organization_status varchar(16) not null default 'active' check (organization_status in ('active','suspended'));
alter table organizations add column if not exists revision bigint not null default 0;
alter table staff_sessions add column if not exists setup_only boolean not null default false;
alter table staff_sessions add column if not exists current_organization_id uuid references organizations(id);
alter table staff_sessions add column if not exists current_workspace_id uuid references workspaces(id);

create table if not exists platform_roles (account_id uuid not null references accounts(id), role varchar(48) not null, primary key(account_id, role));
create table if not exists organization_memberships (
  account_id uuid not null references accounts(id), organization_id uuid not null references organizations(id),
  roles text[] not null default array[]::text[], membership_status varchar(16) not null default 'active' check (membership_status in ('active','suspended')),
  revision bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(account_id,organization_id));
insert into organization_memberships(account_id,organization_id,roles)
select m.account_id,w.organization_id,
  case when bool_or(m.role = 'OWNER') then array['owner','administrator']::text[]
       when bool_or(m.role in ('ADMIN','ADMINISTRATOR')) then array['administrator']::text[]
       else array['member']::text[] end
from memberships m join workspaces w on w.id=m.workspace_id
group by m.account_id,w.organization_id
on conflict (account_id,organization_id) do nothing;

create table if not exists identity_invitations (
 id uuid primary key, organization_id uuid not null references organizations(id), account_id uuid references accounts(id), email varchar(254) not null,
 organization_roles text[] not null default array[]::text[], workspace_roles jsonb not null default '{}'::jsonb,
 token_hash varchar(64) not null unique, expires_at timestamptz not null, used_at timestamptz, revoked_at timestamptz,
 created_by uuid not null references accounts(id), revision bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists identity_invitations_active_idx on identity_invitations(organization_id,email) where used_at is null and revoked_at is null;
create index if not exists organization_memberships_active_owner_idx on organization_memberships(organization_id,account_id) where membership_status='active' and roles @> array['owner']::text[];
create index if not exists staff_sessions_current_context_idx on staff_sessions(account_id,current_organization_id,current_workspace_id) where revoked_at is null;
create table if not exists identity_secret_actions (
 id uuid primary key, account_id uuid not null references accounts(id), organization_id uuid references organizations(id), action varchar(32) not null,
 token_hash varchar(64) not null unique, expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now());

-- Administration mutations are durable at-least-seven-day replay records. The primary
-- key scopes a client key to the authenticated actor, affected tenant/account resource,
-- and endpoint operation.  The digest prevents a changed request from being replayed.
create table if not exists administration_mutation_replays (
 actor_id uuid not null references accounts(id), scope_id varchar(128) not null, operation varchar(128) not null,
 idempotency_key varchar(200) not null, request_digest varchar(64) not null,
 response_status integer not null, response_body text, response_etag varchar(128),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '7 days',
 primary key(actor_id,scope_id,operation,idempotency_key));
create index if not exists administration_mutation_replays_expiry_idx on administration_mutation_replays(expires_at);

-- A workspace grant is an aggregate resource rather than an individual membership row.
-- Retaining its revision after deletion lets a successful DELETE have a strong ETag.
alter table memberships add column if not exists revision bigint not null default 0;
create table if not exists workspace_role_revisions (
 workspace_id uuid not null references workspaces(id), account_id uuid not null references accounts(id),
 revision bigint not null default 0, primary key(workspace_id,account_id));
insert into workspace_role_revisions(workspace_id,account_id)
select workspace_id,account_id from memberships group by workspace_id,account_id
on conflict do nothing;
