# M1 database compatibility boundary

This is an additive compatibility boundary. Flyway V1 through V10 remain
byte-for-byte immutable. V11 is additive: it registers the writable canonical
4.0.0 profile, adds nullable typed runtime state, and widens mutation replay
keys without rewriting their values. V7 registers the writable M1
current-prototype profile and enforces one submission per session.
It is not application-rollback-compatible by itself: an application binary from
before `d1662ed` must not run against a database whose Flyway history includes
V5--V11 without the coordinated procedure below.
The companion integration test pins the exact successful V1--V11 Flyway history.

## Profiles and write boundary

`legacy-prototype` is a read-only observation of a **fully validated** current
Lite definition. Every classification parses and validates the stored source,
including rows tagged `m1-current-prototype`; a profile tag is never trusted.
The known prototype requires its `formKey`, `title`, nonempty pages with page
IDs/titles, typed and labelled fields, and well-formed unique choice option
objects (`id` and `label`). `contractVersion: "4.0.0"` or `pages[]` alone is not
a profile claim. Existing legacy records remain readable through the current
compatibility path, but that profile cannot publish or start a new respondent
session.

`m1-current-prototype` is an explicit, non-normative writable M1 profile. New
forms receive it, releases inherit it, and new sessions inherit it. It keeps the
current app usable without claiming the M2 full 4.0.0 profile. Quarantined or
unsupported forms/releases cannot publish or start new sessions. Existing
acknowledged sessions are not retroactively closed.

`canonical-4.0.0` is the explicit writable profile for a complete canonical
4.0.0 package. Reconciliation assigns it only when `FormCompiler` accepts the
stored package; a version string or an M1 profile tag cannot promote a package.
Canonical forms, releases, sessions, mutations, and submissions retain their
source bytes and remain reconciliation-readable across restarts. V11's nullable
`sessions.runtime_state` preserves server-only runtime state independently of
the public answer projection. Its `session_mutations.client_mutation_id` is a
200-character OpaqueId-compatible replay key rather than a UUID, while the
existing composite primary key continues to preserve every historical key.

## Reconciliation and secrets

`CompatibilityReconciliationService` runs after Flyway inside a real
`TransactionTemplate` transaction. It records source and target digests for
forms, releases, sessions, mutations, and submissions. Source digests include
the relevant payloads and interpretation state: release version/own profile,
session own profile/revision/status/locale/expiry and both relationship sides,
mutation accepted revision, and submission/session/form/workspace sides.
Relationship mismatches (`session.form_id != release.form_id` and
`submission.form_id != session.form_id`) are explicit quarantine evidence, not
links to repair. Unsupported or quarantined form/release/session state cascades
to dependent records without inferring a tenant or release relationship. A
compiler-valid canonical package is classified before the legacy adapter; only
otherwise-valid Lite definitions remain legacy-readable. A
changed retained token changes migration evidence but never replaces an already
stored distinct digest.

A new session returns a generated bearer secret but stores only its SHA-256
digest in `respondent_secret_sha256`. Its V3 `respondent_token` is a different,
unreturned compatibility placeholder. Reconciliation never writes a respondent
secret digest. Legacy rows with a null digest are verified only when the
presented retained V3 token matches; authorization then uses an atomic null-only
backfill. If another request won that update, it re-reads and verifies the
persisted digest before authorizing. All subsequent authorization verifies the
hash. The V3 column remains compatibility residue.

V7 checks for duplicate historical submissions before adding its uniqueness
constraint. It never deletes or merges receipts: a duplicate deployment fails
with an explicit reconciliation error rather than selecting a record silently.
The application also locks a session for mutation and submission operations, so
concurrent distinct mutation IDs cannot lose updates and concurrent submissions
return the single stored receipt.

## Coordinated rollback to an application before `d1662ed`

This is an operational rollback runbook, not a Flyway down migration. It is
necessary because V7's `submissions_session_id_unique` guard is additive but an
older application neither installs nor protects that invariant. Do not remove
the constraint while the M1 application is running, and do not deploy the older
application until the transaction below has committed and its post-checks pass.

1. Put the service in maintenance mode, drain request workers, and stop every
   M1 application instance. Take and verify a restore-capable `pg_dump` of the
   target database, including `compatibility_profiles`,
   `record_migration_state`, and `compatibility_quarantine_evidence`; the SQL
   below intentionally removes those M1 interpretation records.
   Before continuing, the responsible change owner must explicitly approve the
   invalidation or expiry of every active M1 bearer session identified by the
   preflight. An M1 bearer digest differs from the retained V3 token digest;
   dropping `respondent_secret_sha256` would otherwise strand that session on
   the older binary. There is no bypass: invalidate those sessions through the
   approved operational process (or wait for their expiry), record the approval,
   and rerun the preflight.
2. Run the preflight transaction below with a role permitted to lock and alter
   these tables. It fails closed for an incomplete/failed V5--V11 application or
   for any later successful migration. Do not substitute `CASCADE`, disable
   Flyway validation, or delete individual submissions to satisfy a check.
3. Commit the drop transaction, run the post-check, then deploy the
   pre-`d1662ed` application. Keep submission traffic serialized or disabled
   while it is rolled back: without V7, concurrent writers can create duplicate
   submissions and a later V7 deployment will correctly refuse to proceed.
4. This rollback is permitted only when no canonical M4 record or runtime state
   exists. To return forward, restore the verified pre-rollback backup before
   deploying the current application. Reapplying V5--V11 to the destructively
   rolled-back database is not a lossless recovery procedure. Reconcile
   duplicate submissions explicitly before retrying V7; never merge or delete
   them as part of a migration.

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table flyway_schema_history, session_mutations, submissions, sessions, form_releases, forms,
           record_migration_state, compatibility_quarantine_evidence,
           compatibility_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from flyway_schema_history where not success) then
    raise exception 'Rollback refused: Flyway history contains a failed migration';
  end if;
  if exists (
      select 1
      from flyway_schema_history
      where success
        and not coalesce(
          (version = '1' and type = 'SQL' and script = 'V1__smart_intake.sql' and checksum = 1285295916)
          or (version = '2' and type = 'SQL' and script = 'V2__identity_workspaces_and_release_binding.sql' and checksum = -906896927)
          or (version = '3' and type = 'SQL' and script = 'V3__respondent_session_secret.sql' and checksum = -549079748)
          or (version = '4' and type = 'SQL' and script = 'V4__session_mutation_replay.sql' and checksum = -758059602)
          or (version = '5' and type = 'SQL' and script = 'V5__compatibility_profiles_and_reconciliation_state.sql' and checksum = 125753238)
          or (version = '6' and type = 'SQL' and script = 'V6__compatibility_reconciliation_indexes.sql' and checksum = -848544773)
          or (version = '7' and type = 'SQL' and script = 'V7__m1_current_profile_and_submission_uniqueness.sql' and checksum = -648692813)
          or (version = '8' and type = 'SQL' and script = 'V8__freeze_expression_session_context.sql' and checksum = 874801699)
          or (version = '9' and type = 'SQL' and script = 'V9__default_frozen_session_context.sql' and checksum = 1901026173)
          or (version = '10' and type = 'SQL' and script = 'V10__bind_session_mutation_request_digest.sql' and checksum = 1365084057)
          or (version = '11' and type = 'SQL' and script = 'V11__m4_compatibility_runtime.sql' and checksum = 1780789261),
          false)
  )
  or (select count(*) from flyway_schema_history where success) <> 11
  or (select count(distinct (version, type, script, checksum))
      from flyway_schema_history where success) <> 11 then
    raise exception 'Rollback refused: successful Flyway history is not the exact V1-V11 SQL allowlist';
  end if;
  if exists (
      select 1
      from sessions
      where expires_at > transaction_timestamp()
        and respondent_secret_sha256 is not null
        and respondent_secret_sha256 <> encode(digest(respondent_token::text, 'sha256'), 'hex')
  ) then
    raise exception 'Rollback refused: active M1 bearer sessions require approved invalidation or expiry';
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'submissions'::regclass
                   and conname = 'submissions_session_id_unique') then
    raise exception 'Rollback refused: V7 submission uniqueness constraint is absent';
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'session_mutations'::regclass
                   and conname = 'session_mutations_client_mutation_id_opaque_id') then
    raise exception 'Rollback refused: V11 OpaqueId constraint is absent';
  end if;
  if exists (
      select 1 from session_mutations
      where client_mutation_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Rollback refused: V11 contains replay keys that cannot be represented as V4 UUIDs';
  end if;
  if exists (select 1 from forms where compatibility_profile_key = 'canonical-4.0.0')
     or exists (select 1 from form_releases where compatibility_profile_key = 'canonical-4.0.0')
     or exists (select 1 from sessions where compatibility_profile_key = 'canonical-4.0.0')
     or exists (select 1 from sessions where runtime_state is not null) then
    raise exception 'Rollback refused: canonical M4 records or runtime state require verified backup restoration or approved retirement/export';
  end if;
end $$;

alter table submissions drop constraint submissions_session_id_unique;
alter table session_mutations drop constraint session_mutations_client_mutation_id_opaque_id;
alter table session_mutations alter column client_mutation_id type uuid using client_mutation_id::uuid;
alter table session_mutations drop constraint session_mutations_request_digest_format;
alter table session_mutations drop column request_digest;
alter table sessions drop column session_date,
                     drop column time_zone,
                     drop column tzdb_version,
                     drop column runtime_state;
drop index if exists record_migration_state_state_idx;
drop index if exists compatibility_quarantine_reason_idx;
drop index if exists forms_compatibility_profile_idx;
drop index if exists form_releases_compatibility_profile_idx;
drop index if exists sessions_compatibility_profile_idx;
alter table sessions drop column respondent_secret_sha256,
                     drop column compatibility_profile_key;
alter table form_releases drop column compatibility_profile_key;
alter table forms drop column compatibility_profile_key;
drop table compatibility_quarantine_evidence;
drop table record_migration_state;
drop table compatibility_profiles;
delete from flyway_schema_history where version in ('5', '6', '7', '8', '9', '10', '11');
commit;

-- Run after commit. Every *_remains value must be false and mutation_key_uuid_restored true
-- before deploying the old binary.
select exists (select 1 from flyway_schema_history where version in ('5', '6', '7', '8', '9', '10', '11')) as compatibility_history_remains,
       exists (select 1 from pg_constraint
               where conrelid = 'submissions'::regclass
                   and conname = 'submissions_session_id_unique') as uniqueness_remains,
       exists (select 1 from information_schema.columns
               where table_name = 'sessions' and column_name = 'respondent_secret_sha256') as digest_column_remains,
       exists (select 1 from information_schema.columns
               where table_name = 'sessions' and column_name = 'runtime_state') as runtime_state_remains,
       exists (select 1 from information_schema.columns
               where table_name = 'session_mutations' and column_name = 'request_digest') as request_digest_remains,
       exists (select 1 from pg_constraint
               where conrelid = 'session_mutations'::regclass
                 and conname in ('session_mutations_request_digest_format',
                                 'session_mutations_client_mutation_id_opaque_id')) as mutation_constraint_remains,
       coalesce((select data_type = 'uuid' from information_schema.columns
                 where table_name = 'session_mutations' and column_name = 'client_mutation_id'), false)
                 as mutation_key_uuid_restored;
```

The machine-readable inventory is
[`m1-compatibility-manifest.json`](m1-compatibility-manifest.json).
