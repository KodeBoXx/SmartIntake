alter table form_authoring_locale_reviews
  add column source_package_hash varchar(64) not null default '';

alter table form_authoring_locale_reviews
  alter column source_package_hash drop default;
