-- M6 staff identity/session security. Earlier migrations are intentionally immutable.
alter table staff_sessions add column if not exists csrf_token_hash varchar(64);
alter table staff_sessions add column if not exists last_seen_at timestamptz not null default now();
alter table staff_sessions add column if not exists absolute_expires_at timestamptz not null default now() + interval '12 hours';
alter table staff_sessions add column if not exists revoked_at timestamptz;
alter table staff_sessions add column if not exists updated_at timestamptz not null default now();
update staff_sessions
set last_seen_at = coalesce(last_seen_at, created_at),
    absolute_expires_at = coalesce(absolute_expires_at, expires_at),
    updated_at = coalesce(updated_at, created_at);
alter table staff_sessions alter column last_seen_at set not null;
alter table staff_sessions alter column absolute_expires_at set not null;
create index if not exists staff_sessions_account_active_idx
  on staff_sessions(account_id, absolute_expires_at) where revoked_at is null;

create table if not exists identity_bootstrap_state (
  singleton boolean primary key default true check (singleton),
  completed_at timestamptz
);
insert into identity_bootstrap_state(singleton) values (true) on conflict do nothing;

create table if not exists login_csrf_challenges (
  token_hash varchar(64) primary key,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists login_csrf_challenges_expiry_idx on login_csrf_challenges(expires_at);

create table if not exists sign_in_throttles (
  subject_hash varchar(64) primary key,
  failure_count integer not null check (failure_count >= 0),
  window_started_at timestamptz not null,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
