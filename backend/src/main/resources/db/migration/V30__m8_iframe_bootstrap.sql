create table if not exists form_share_channel_bootstraps (
  id uuid primary key,
  channel_id uuid not null references form_share_channels(id) on delete cascade,
  release_id uuid not null references form_releases(id),
  parent_origin varchar(512) not null,
  nonce varchar(128) not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists form_share_channel_bootstraps_channel_expiry_idx on form_share_channel_bootstraps(channel_id, expires_at);
