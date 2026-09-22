create table receipt_capabilities (
  token uuid primary key,
  submission_id uuid not null unique references submissions(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index receipt_capabilities_expiry_idx on receipt_capabilities(expires_at);
