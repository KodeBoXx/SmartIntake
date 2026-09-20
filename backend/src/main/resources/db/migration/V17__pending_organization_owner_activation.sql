alter table organizations drop constraint if exists organizations_organization_status_check;
alter table organizations alter column organization_status type varchar(32);
alter table organizations add constraint organizations_organization_status_check
  check (organization_status in ('awaiting_owner_activation', 'active', 'suspended'));
