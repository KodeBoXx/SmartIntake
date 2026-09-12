alter table sessions add column if not exists respondent_token uuid;
update sessions set respondent_token=gen_random_uuid() where respondent_token is null;
alter table sessions alter column respondent_token set not null;
create unique index if not exists sessions_respondent_token_idx on sessions(respondent_token);
