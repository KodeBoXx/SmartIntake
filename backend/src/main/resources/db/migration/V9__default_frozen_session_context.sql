alter table sessions alter column session_date set default ((now() at time zone 'UTC')::date);
alter table sessions alter column time_zone set default 'UTC';
alter table sessions alter column tzdb_version set default 'IANA-tzdb-2025b-m3-complete-1';
