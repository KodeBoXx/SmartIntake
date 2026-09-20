-- M6 catalog administration. V1-V15 remain immutable.
create table catalog_folders (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name varchar(160) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, name)
);

create table catalog_tags (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name varchar(80) not null,
  color varchar(32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, name)
);

create table form_catalog_metadata (
  form_id uuid primary key references forms(id) on delete cascade,
  folder_id uuid references catalog_folders(id) on delete set null,
  owner_account_id uuid references accounts(id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table form_catalog_tags (
  form_id uuid not null references forms(id) on delete cascade,
  tag_id uuid not null references catalog_tags(id) on delete cascade,
  primary key(form_id, tag_id)
);

create table catalog_organization_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  policy_settings jsonb not null default '{}'::jsonb,
  provider_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table catalog_workspace_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  policy_settings jsonb not null default '{}'::jsonb,
  provider_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into form_catalog_metadata(form_id, owner_account_id)
select f.id, (
  select m.account_id from memberships m
  where m.workspace_id = f.workspace_id and m.role in ('OWNER', 'ADMIN', 'AUTHOR')
  order by m.account_id
  limit 1
)
from forms f
where f.workspace_id is not null
on conflict (form_id) do nothing;

create index form_catalog_metadata_workspace_owner_idx on form_catalog_metadata(owner_account_id, folder_id);
create index catalog_folders_workspace_name_idx on catalog_folders(workspace_id, name);
create index catalog_tags_workspace_name_idx on catalog_tags(workspace_id, name);
create index form_catalog_tags_tag_form_idx on form_catalog_tags(tag_id, form_id);
create index forms_workspace_catalog_updated_idx on forms(workspace_id, updated_at desc, id desc);
