create temporary table m8_active_release_survivors on commit drop as
select distinct on (releases.form_id) releases.form_id, releases.id as release_id
from form_releases releases
left join form_release_selections selection on selection.form_id = releases.form_id
where releases.release_state = 'ACTIVE'
order by releases.form_id,
  case when releases.id = selection.active_release_id then 0 else 1 end,
  releases.activated_at desc nulls last,
  releases.version desc,
  releases.id;

update form_releases releases
set release_state = 'ROLLED_BACK'
from m8_active_release_survivors survivor
where releases.form_id = survivor.form_id
  and releases.release_state = 'ACTIVE'
  and releases.id <> survivor.release_id;

update form_release_selections selection
set active_release_id = survivor.release_id, selected_at = now()
from m8_active_release_survivors survivor
where selection.form_id = survivor.form_id
  and selection.active_release_id is distinct from survivor.release_id;

update form_share_channels channel
set release_id = survivor.release_id
from m8_active_release_survivors survivor
where channel.form_id = survivor.form_id
  and channel.state = 'ACTIVE'
  and channel.release_id is distinct from survivor.release_id;

create unique index if not exists uq_form_releases_one_active
  on form_releases(form_id)
  where release_state = 'ACTIVE';
