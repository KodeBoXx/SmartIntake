alter table sessions add column if not exists session_date date;
alter table sessions add column if not exists time_zone varchar(128);
alter table sessions add column if not exists tzdb_version varchar(128);

update sessions
set session_date = coalesce(session_date, (created_at at time zone 'UTC')::date),
    time_zone = coalesce(time_zone, 'UTC'),
    tzdb_version = coalesce(tzdb_version, 'IANA-tzdb-2025b-m3-complete-1')
where session_date is null or time_zone is null or tzdb_version is null;

alter table sessions alter column session_date set not null;
alter table sessions alter column time_zone set not null;
alter table sessions alter column tzdb_version set not null;
