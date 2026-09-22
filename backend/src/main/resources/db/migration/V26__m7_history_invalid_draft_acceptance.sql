-- The accepted removed-field allowlist is history metadata, never canonical package data.
alter table form_authoring_history
  add column invalid_draft_acceptance jsonb;
