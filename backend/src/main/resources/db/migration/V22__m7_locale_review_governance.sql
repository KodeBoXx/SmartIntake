create table form_authoring_locale_reviews (
  form_id uuid not null references forms(id) on delete cascade,
  draft_id uuid not null,
  locale varchar(32) not null,
  source_revision bigint not null,
  status varchar(32) not null,
  reviewed_by uuid not null references accounts(id),
  reviewed_at timestamptz not null,
  primary key (form_id, draft_id, locale)
);
