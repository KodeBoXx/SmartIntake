-- M8 is additive: existing form_releases and form UUID share URLs remain readable.
alter table form_releases add column if not exists package_hash varchar(128);
alter table form_releases add column if not exists manifest_hash varchar(128);
alter table form_releases add column if not exists release_state varchar(24) not null default 'PUBLISHED'
  check (release_state in ('PUBLISHED','ACTIVE','ROLLED_BACK','RETIRED','EMERGENCY_CLOSED'));
alter table form_releases add column if not exists activated_at timestamptz;
alter table form_releases add column if not exists retired_at timestamptz;
alter table form_releases add column if not exists emergency_closed_at timestamptz;

-- Hashes are populated by application code using canonical JSON.  Historical releases retain
-- their original bytes and are never reserialized by this migration.
create index if not exists form_releases_form_state_version_idx
  on form_releases(form_id, release_state, version desc);

create table if not exists form_review_requests (
  id uuid primary key,
  form_id uuid not null references forms(id) on delete cascade,
  draft_id uuid not null,
  source_revision bigint not null,
  package_hash varchar(128) not null,
  manifest_hash varchar(128) not null,
  semantic_diff jsonb not null,
  dependency_diff jsonb not null,
  state varchar(20) not null check (state in ('OPEN','APPROVED','INVALIDATED','CANCELLED')),
  requested_by uuid not null references accounts(id),
  requested_at timestamptz not null default now(),
  invalidated_at timestamptz,
  unique(form_id, draft_id, source_revision, package_hash, manifest_hash)
);
create table if not exists form_review_approvals (
  review_request_id uuid not null references form_review_requests(id) on delete cascade,
  reviewer_account_id uuid not null references accounts(id),
  source_revision bigint not null,
  package_hash varchar(128) not null,
  manifest_hash varchar(128) not null,
  approved_at timestamptz not null default now(),
  primary key(review_request_id, reviewer_account_id)
);

create table if not exists form_release_selections (
  form_id uuid primary key references forms(id) on delete cascade,
  active_release_id uuid not null references form_releases(id),
  selected_by uuid not null references accounts(id),
  selected_at timestamptz not null default now()
);

create table if not exists form_share_channels (
  id uuid primary key,
  form_id uuid not null references forms(id) on delete cascade,
  release_id uuid not null references form_releases(id),
  channel_type varchar(16) not null check (channel_type in ('LINK','QR','IFRAME')),
  opens_at timestamptz,
  closes_at timestamptz,
  response_cap bigint,
  starts_count bigint not null default 0 check (starts_count >= 0),
  allowed_origins jsonb not null default '[]'::jsonb,
  state varchar(16) not null default 'ACTIVE' check (state in ('ACTIVE','CLOSED')),
  created_by uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  check (opens_at is null or closes_at is null or opens_at < closes_at),
  check (response_cap is null or response_cap > 0)
);
create index if not exists form_share_channels_form_state_idx
  on form_share_channels(form_id, state, created_at desc);

create table if not exists submission_outbox_events (
  id uuid primary key,
  submission_id uuid not null unique references submissions(id) on delete restrict,
  event_type varchar(80) not null,
  payload jsonb not null,
  payload_hash varchar(128) not null,
  state varchar(20) not null default 'PENDING' check (state in ('PENDING','DISPATCHED','FAILED')),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);
