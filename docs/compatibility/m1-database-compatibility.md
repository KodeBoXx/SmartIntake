# M1 database compatibility boundary

This is an additive M1 compatibility slice, not an M2 contract migration. Flyway
V1 through V4 remain byte-for-byte immutable; the companion integration test
pins their SHA-256 values. V5 introduces profiles, durable per-record migration
state, quarantine evidence, nullable profile seams, and the additive
`sessions.respondent_secret_sha256` column. V6 adds only supporting indexes.

## Profile boundary

Current persisted `pages[]` definitions are classified as `legacy-prototype`.
That profile is read-only and cannot be used for new writes. In particular,
`contractVersion: "4.0.0"` alone is an observation from the prototype and is
never evidence of a complete normative 4.0.0 package. The
`LegacyDefinitionAdapter` exposes a deep-copied, read-only source view only.

## Reconciliation and quarantine

`CompatibilityReconciliationService` runs at startup after Flyway. It records a
SHA-256 digest of each stored source value and reconciles forms, releases,
sessions, session mutations, and submissions. It does not update those source
values. Re-running with the same digest/state leaves the durable state and
quarantine timestamps unchanged; a changed digest or classification increments
the record attempt count and refreshes evidence.

No relationship is inferred. A form without `workspace_id` is quarantined as
`TENANT_MISSING`; a session without `release_id` is quarantined as
`RELEASE_MISSING`. Quarantine is evidence, not deletion or denial of an
acknowledged legacy session. Existing V3 `respondent_token` values stay in place
as compatibility residue. New sessions persist the companion digest immediately.
An acknowledged V3-only session must first match its retained token; successful
legacy access then backfills the digest atomically, and all authorization verifies
through `RespondentSecretVerifier`.

The machine-readable inventory is
[`m1-compatibility-manifest.json`](m1-compatibility-manifest.json).
