create unique index if not exists uq_form_releases_one_active
  on form_releases(form_id)
  where release_state = 'ACTIVE';
