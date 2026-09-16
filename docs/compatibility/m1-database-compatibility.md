# M1 database compatibility boundary

This is an additive M1 compatibility slice, not an M2 contract migration. Flyway
V1 through V6 remain byte-for-byte immutable. V7 is additive: it registers the
writable M1 current-prototype profile and enforces one submission per session.
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

The machine-readable inventory is
[`m1-compatibility-manifest.json`](m1-compatibility-manifest.json).
