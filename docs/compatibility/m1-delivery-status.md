# M1 delivery status

Recorded: 2026-09-18

M1 establishes additive compatibility and modular boundaries while preserving M0 as provisional and unaccepted. It does not claim M0 evidence, signature, baseline, or product acceptance.

## Delivered

- Preserved Flyway V1–V4 byte-for-byte and pinned their SHA-256 hashes in automated tests and the compatibility manifest.
- Added V5–V7 compatibility profiles, durable source/target digest-bound migration state, quarantine evidence, nullable profile seams, supporting indexes, and an additive one-submission-per-session constraint. V7 is not application-rollback-compatible on its own; the compatibility runbook defines the required coordinated database rollback before an older binary can run.
- Added transactionally executed, idempotent startup reconciliation without rewriting source definitions, releases, session answers, mutations, submissions, IDs, timestamps, or respondent hashes; interpretation state and relationship sides are included in source evidence and unsupported state cascades to dependents.
- Quarantined tenantless forms, release-less sessions, session/release form mismatches, and submission/session form mismatches instead of inferring ownership or relationships.
- Classifies only fully validated known current Lite definitions as read-only `legacy-prototype`; every stored source is parsed and validated even when tagged `m1-current-prototype`. `contractVersion: 4.0.0` or `pages[]` alone is not treated as a profile or normative full-profile claim.
- Persists a SHA-256 digest of a newly returned bearer secret while retaining a distinct, unreturned V3 compatibility placeholder; acknowledged V3-only sessions lazily backfill only a null digest after their retained token first matches.
- Split the monolithic Spring controller into focused web controllers with application, authorization, audit-persistence, and compatibility seams while preserving current routes and response behavior.
- Split the Angular root into typed models, pure state/rule helpers, an HTTP facade, and a bounded toolbar component while preserving the current UI journeys; response administration remains in the parent view after live testing exposed unreliable event propagation across its extracted boundary.
- Completed the local usable flow: a stored staff session is validated and recovered through bootstrap/sign-in when expired, and authoring remains fail-closed until form-list lookup and authoritative default-draft rehydration complete. An existing-form draft lookup failure stays blocked with visible retry rather than creating a duplicate. Draft save persists the in-memory definition with revision preconditions, imports reload canonical draft state, and authoring controls and mutation helpers lock during save/publish serialization so the published bytes cannot be superseded by an in-flight edit.
- Response-detail selection tracks request generation, so a delayed older success or failure cannot replace or clear the most recently selected detail; closing or reloading response administration invalidates pending detail requests.
- Fixed the existing CSV export query ambiguity and malformed header line ending; CSV export now returns a valid workspace-scoped response with formula-safe cells.

## Characterization evidence

The 21 observational `N_current` surfaces are covered as follows:

| Surface group | Evidence |
|---|---|
| Authentication and session lifecycle | Backend route characterization and security integration tests |
| Catalog, draft save, definition transfer, and publish | Backend route characterization plus frontend HTTP/journey tests |
| Public session start/read/mutation/validation/submission | Backend lifecycle tests, exact replay assertion, frontend journey tests, and live API flow |
| Response list/detail/JSON/CSV export | Backend authorization/export tests and AppComponent response-administration DOM tests |
| Frontend entry, authoring, preview, respondent, and response admin | Angular unit tests and production build; any public-host browser observation is supporting development evidence, not M1 acceptance evidence |
| Database V1–V4 | Immutable SHA-256 guard plus Flyway validation through V7 |
| Clean startup | Fresh temporary PostgreSQL database migrated through V1–V7 and served a healthy application |

Latest local results:

- Backend: 33 route, compatibility, transactional concurrency, contract, and real closed-context restart tests passed with no failures, errors, or skips.
- Frontend: 30 focused Angular journey, HTTP-contract, toolbar, authentication-retry, rehydration/serialization, and responsive response-administration tests passed; production build passed.
- Live lifecycle: create → publish → start session → mutation → exact replay → submit → CSV export passed; the created session stored a 64-character secret digest.
- Historical public preview check: frontend and proxied API returned HTTP 200 and author/public-preview screens rendered. This is developer verification only and does not claim fresh browser or acceptance evidence.

## Deliberately deferred

- M0 remains provisional for the reasons in `docs/acceptance/v1.1/PROVISIONAL-M0.md`.
- The full normative 4.0.0 profile does not exist until the approved M2 schemas/API/models milestone. Therefore the current legacy prototype remains readable for existing behavior, but it is not relabeled as a full profile. Strictly requiring the future full profile for all new publish/session creation now would make the usable prototype inoperable and is deferred to the M2→M1 integration point.
- V3 plaintext respondent-token storage remains compatibility residue because the original column is `NOT NULL`. Authorization now uses the digest seam; removal of the residue requires a later, separately planned and explicitly rollback-compatible constraint migration after compatibility evidence is retained.
- This milestone does not add M5 routed shell/Certinal migration, M6 production identity administration, or later product capabilities.

## Exit interpretation

The compatibility boundary, route/UI characterization, V1–V4 immutability, additive migration state, reconciliation, quarantine, secret-digest adoption, clean startup, and restart-safe persistence are implemented and tested. The full-profile write gate is explicitly dependency-blocked by M2 rather than fabricated; it affects only promotion to the future normative profile and does not block the demonstrated current application.
