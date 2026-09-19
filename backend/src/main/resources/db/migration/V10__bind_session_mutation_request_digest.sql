alter table session_mutations
  add column request_digest text;

alter table session_mutations
  add constraint session_mutations_request_digest_format
  check (request_digest is null or request_digest ~ '^sha256:[0-9a-f]{64}$');
