# M1 delivery status

Recorded: 2026-09-16

M1 establishes additive compatibility and modular boundaries while preserving M0 as provisional and unaccepted. It does not claim M0 evidence, signature, baseline, or product acceptance.

## Delivered

- Preserved Flyway V1–V4 byte-for-byte and pinned their SHA-256 hashes in automated tests and the compatibility manifest.
- Added V5–V6 compatibility profiles, durable digest-bound migration state, quarantine evidence, nullable profile seams, and supporting indexes.
- Added idempotent startup reconciliation without rewriting source definitions, releases, sessions, mutations, submissions, IDs, or timestamps.
- Quarantined tenantless forms and release-less sessions instead of inferring ownership or release relationships.
- Classified the current `pages[]` prototype as read-only `legacy-prototype`; `contractVersion: 4.0.0` alone is not treated as a normative full-profile claim.
- Persisted SHA-256 respondent-secret digests for new sessions and lazily backfilled acknowledged V3-only sessions after their retained token first matches.
- Split the monolithic Spring controller into focused web controllers with application, authorization, audit-persistence, and compatibility seams while preserving current routes and response behavior.
- Split the Angular root into typed models, pure state/rule helpers, an HTTP facade, and bounded toolbar/response-administration components while preserving the current UI journeys.
- Fixed the existing CSV export query ambiguity and malformed header line ending; CSV export now returns a valid workspace-scoped response with formula-safe cells.

## Characterization evidence

The 21 observational `N_current` surfaces are covered as follows:

| Surface group | Evidence |
|---|---|
| Authentication and session lifecycle | Backend route characterization and security integration tests |
| Catalog, draft save, definition transfer, and publish | Backend route characterization plus frontend HTTP/journey tests |
| Public session start/read/mutation/validation/submission | Backend lifecycle tests, exact replay assertion, frontend journey tests, and live API flow |
| Response list/detail/JSON/CSV export | Backend authorization/export tests and response-admin component tests |
| Frontend entry, authoring, preview, respondent, and response admin | Angular unit tests, production build, public-host browser snapshots, and screenshots |
| Database V1–V4 | Immutable SHA-256 guard plus Flyway validation through V6 |
| Clean startup | Fresh temporary PostgreSQL database migrated through V1–V6 and served a healthy application |

Latest local results:

- Backend: 25 tests passed, 0 failed, 0 errors, 0 skipped.
- Frontend: 10 tests passed across 4 files; production build passed.
- Live lifecycle: create → publish → start session → mutation → exact replay → submit → CSV export passed; the created session stored a 64-character secret digest.
- Public preview: frontend and proxied API returned HTTP 200; author and public-preview screens rendered and were interactive.

## Deliberately deferred

- M0 remains provisional for the reasons in `docs/acceptance/v1.1/PROVISIONAL-M0.md`.
- The full normative 4.0.0 profile does not exist until the approved M2 schemas/API/models milestone. Therefore the current legacy prototype remains readable for existing behavior, but it is not relabeled as a full profile. Strictly requiring the future full profile for all new publish/session creation now would make the usable prototype inoperable and is deferred to the M2→M1 integration point.
- V3 plaintext respondent-token storage remains compatibility residue because the original column is `NOT NULL`. Authorization now uses the digest seam; removal of the residue requires a later, separately reversible constraint migration after compatibility evidence is retained.
- This milestone does not add M5 routed shell/Certinal migration, M6 production identity administration, or later product capabilities.

## Exit interpretation

The compatibility boundary, route/UI characterization, V1–V4 immutability, additive migration state, reconciliation, quarantine, secret-digest adoption, clean startup, and restart-safe persistence are implemented and tested. The full-profile write gate is explicitly dependency-blocked by M2 rather than fabricated; it affects only promotion to the future normative profile and does not block the demonstrated current application.
