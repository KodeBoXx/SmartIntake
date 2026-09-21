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

-- A durable revision makes a cursor a snapshot of every catalog-visible input,
-- not just forms.updated_at. Cursors fail closed once the catalog changes.
create table catalog_workspace_revisions (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  revision bigint not null default 0
);

create or replace function catalog_touch_workspace_revision() returns trigger language plpgsql as $$
declare
  ws uuid;
  form uuid;
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'forms' then ws := old.workspace_id;
    elsif tg_table_name in ('catalog_folders', 'catalog_tags') then ws := old.workspace_id;
    else
      form := old.form_id;
      select workspace_id into ws from forms where id=form;
    end if;
  elsif tg_table_name = 'forms' then
    ws := new.workspace_id;
  elsif tg_table_name in ('catalog_folders', 'catalog_tags') then
    ws := new.workspace_id;
  elsif tg_table_name = 'form_catalog_metadata' then
    form := new.form_id;
    select workspace_id into ws from forms where id=form;
  else
    form := new.form_id;
    select workspace_id into ws from forms where id=form;
  end if;
  if ws is not null then
    insert into catalog_workspace_revisions(workspace_id, revision) values(ws, 1)
    on conflict(workspace_id) do update set revision=catalog_workspace_revisions.revision + 1;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

insert into form_catalog_metadata(form_id, owner_account_id)
select f.id, owner.account_id
from forms f
left join lateral (
  -- Backfill only a single authoritative OWNER. Ambiguous/no-owner forms are
  -- deliberately quarantined as unassigned instead of inventing ownership.
  select (array_agg(m.account_id::text order by m.account_id::text))[1]::uuid as account_id
  from memberships m
  where m.workspace_id = f.workspace_id and m.role = 'OWNER'
  having count(*) = 1
) owner on true
where f.workspace_id is not null
on conflict (form_id) do nothing;

insert into catalog_workspace_revisions(workspace_id, revision)
select id, 0 from workspaces on conflict do nothing;

create trigger catalog_forms_revision after insert or update or delete on forms
for each row execute function catalog_touch_workspace_revision();
create trigger catalog_folders_revision after insert or update or delete on catalog_folders
for each row execute function catalog_touch_workspace_revision();
create trigger catalog_tags_revision after insert or update or delete on catalog_tags
for each row execute function catalog_touch_workspace_revision();
create trigger catalog_metadata_revision after insert or update or delete on form_catalog_metadata
for each row execute function catalog_touch_workspace_revision();
create trigger catalog_form_tags_revision after insert or update or delete on form_catalog_tags
for each row execute function catalog_touch_workspace_revision();

create index form_catalog_metadata_workspace_owner_idx on form_catalog_metadata(owner_account_id, folder_id);
create index catalog_folders_workspace_name_idx on catalog_folders(workspace_id, name);
create index catalog_tags_workspace_name_idx on catalog_tags(workspace_id, name);
create index form_catalog_tags_tag_form_idx on form_catalog_tags(tag_id, form_id);
create index if not exists forms_workspace_catalog_updated_idx on forms(workspace_id, updated_at desc, id desc);
