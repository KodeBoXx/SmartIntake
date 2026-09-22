-- A governed approval can produce exactly one release, including after a client retry.
alter table form_review_requests add column if not exists published_release_id uuid references form_releases(id);
alter table form_review_requests drop constraint if exists form_review_requests_state_check;
alter table form_review_requests add constraint form_review_requests_state_check
  check (state in ('OPEN','APPROVED','PUBLISHED','INVALIDATED','CANCELLED'));
create unique index if not exists form_review_requests_published_release_idx
  on form_review_requests(published_release_id) where published_release_id is not null;
