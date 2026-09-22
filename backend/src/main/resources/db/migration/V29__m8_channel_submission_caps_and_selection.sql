-- Starts are not responses. Bind a session to its channel and account accepted responses only.
alter table sessions add column if not exists share_channel_id uuid references form_share_channels(id);
alter table form_share_channels add column if not exists accepted_count bigint not null default 0 check (accepted_count >= 0);
alter table form_release_selections alter column active_release_id drop not null;
