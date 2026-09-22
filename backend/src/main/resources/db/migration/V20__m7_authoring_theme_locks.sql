-- M7 hardening: theme locks govern individual canonical token pointers outside the closed package schema.
create table if not exists form_authoring_theme_locks (
  form_id uuid not null references forms(id) on delete cascade,
  draft_id uuid not null,
  token_path varchar(512) not null,
  locked_by uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  primary key (form_id, draft_id, token_path),
  check (token_path like '/tokens/%')
);
