alter table submissions add column if not exists review_projection jsonb;
alter table submissions add column if not exists review_digest varchar(71);
alter table submissions add column if not exists attempt_id varchar(200);
alter table submissions add column if not exists runtime_manifest jsonb;

create table if not exists submission_attempts (
  session_id uuid not null,
  attempt_id varchar(200) not null,
  request_digest varchar(71) not null,
  state varchar(20) not null check (state in ('PENDING','SUCCEEDED','FAILED')),
  submission_id uuid,
  error_code varchar(100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, attempt_id),
  constraint submission_attempt_request_digest_format check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint submission_attempt_id_format check (attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$')
);

create index if not exists submission_attempts_latest_idx
  on submission_attempts(session_id, updated_at desc);
