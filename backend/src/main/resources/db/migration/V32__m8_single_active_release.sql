with ranked as (
  select id, row_number() over (partition by form_id order by activated_at desc nulls last, version desc, id) as position
  from form_releases
  where release_state = 'ACTIVE'
)
update form_releases
set release_state = 'ROLLED_BACK'
where id in (select id from ranked where position > 1);

create unique index if not exists uq_form_releases_one_active
  on form_releases(form_id)
  where release_state = 'ACTIVE';
