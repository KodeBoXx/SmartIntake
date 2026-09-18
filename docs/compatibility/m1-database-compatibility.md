# M1 database compatibility boundary

This is an additive M1 compatibility slice, not an M2 contract migration. Flyway
V1 through V6 remain byte-for-byte immutable. V7 is additive: it registers the
writable M1 current-prototype profile and enforces one submission per session.
It is not application-rollback-compatible by itself: an application binary from
before `d1662ed` must not run against a database whose Flyway history includes
V5--V7 without the coordinated procedure below.
The companion integration test pins V1–V4 SHA-256 values; V5–V6 are not altered.

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
2. Run the preflight transaction below with a role permitted to lock and alter
   these tables. It fails closed for an incomplete/failed V5--V7 application or
   for any later successful migration. Do not substitute `CASCADE`, disable
   Flyway validation, or delete individual submissions to satisfy a check.
3. Commit the drop transaction, run the post-check, then deploy the
   pre-`d1662ed` application. Keep submission traffic serialized or disabled
   while it is rolled back: without V7, concurrent writers can create duplicate
   submissions and a later V7 deployment will correctly refuse to proceed.
4. To return to M1, restore the backup if interpretation history is needed,
   deploy the M1 application, and let Flyway apply V5--V7 normally. Reconcile
   duplicate submissions explicitly before retrying V7; never merge or delete
   them as part of a migration.

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table flyway_schema_history, submissions, sessions, form_releases, forms,
           record_migration_state, compatibility_quarantine_evidence,
           compatibility_profiles in access exclusive mode;

do $$
begin
  if exists (select 1 from flyway_schema_history where not success) then
    raise exception 'Rollback refused: Flyway history contains a failed migration';
  end if;
  if (select count(*) from flyway_schema_history
      where version in ('5', '6', '7') and success) <> 3 then
    raise exception 'Rollback refused: expected successful V5, V6, and V7';
  end if;
  if exists (select 1 from flyway_schema_history
             where success and version ~ '^[0-9]+$' and version::integer > 7) then
    raise exception 'Rollback refused: a migration later than V7 is installed';
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'submissions'::regclass
                   and conname = 'submissions_session_id_unique') then
    raise exception 'Rollback refused: V7 submission uniqueness constraint is absent';
  end if;
end $$;

alter table submissions drop constraint submissions_session_id_unique;
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
delete from flyway_schema_history where version in ('5', '6', '7');
commit;

-- Run after commit. All values must be false/zero before deploying the old binary.
select exists (select 1 from flyway_schema_history where version in ('5', '6', '7')) as m1_history_remains,
       exists (select 1 from pg_constraint
               where conrelid = 'submissions'::regclass
                 and conname = 'submissions_session_id_unique') as uniqueness_remains,
       exists (select 1 from information_schema.columns
               where table_name = 'sessions' and column_name = 'respondent_secret_sha256') as digest_column_remains;
```

The machine-readable inventory is
[`m1-compatibility-manifest.json`](m1-compatibility-manifest.json).
