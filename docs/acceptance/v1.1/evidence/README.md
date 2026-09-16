# M0 baseline evidence records

`tools/acceptance/run_baseline.py` produces a small, reproducible observation of
this repository's protected-baseline checks. The record is governed by
[`baseline-record.schema.json`](baseline-record.schema.json). It is deliberately
an **observation**, not an acceptance ledger or a release decision.

## Run

From the repository root:

```bash
python3 tools/acceptance/run_baseline.py \
  --output docs/acceptance/v1.1/evidence/baselines/baseline-$(date -u +%Y%m%dT%H%M%SZ).json
```

Without `--output`, the JSON is written to stdout. `--now 2026-09-14T00:00:00Z`
is available only to make fixture/unit-test output reproducible. It does not
replace the real UTC observation time in retained evidence.

The runner never starts, resets, or stops PostgreSQL. Start the repository
service separately when an integrated baseline is intended:

```bash
docker compose up -d postgres
python3 tools/acceptance/run_baseline.py --output docs/acceptance/v1.1/evidence/baselines/baseline.json
```

Use a retention-controlled evidence location for retained observations. Records
contain summarized command output (at most 4,000 characters per command), input
artifact SHA-256 digests, and no environment-variable dump. Authorization,
API-key, password/token/secret header values and URI userinfo are redacted before
output is retained. Do not add secrets to commands, output paths, or evidence
records.

The runner validates each produced record against the full JSON Schema whenever
`python-jsonschema` is already installed, and records validator availability,
version, schema digest, and validation mode in `recordValidation`. It never
installs a validator. Without that optional package it performs a dependency-free
structural validation, including the non-acceptance and no-retry invariants. A
schema version/contract mismatch is a runner failure rather than a best-effort
record.

## Attesting a retained record

[`baseline-attestation.schema.json`](baseline-attestation.schema.json) defines a
small retention manifest that binds a record location, SHA-256 digest, clean
candidate SHA/tree identity, reviewer identity/authority, review status, and
lifecycle status (`provisional`, `retained`, `finalized`, `superseded`, or
`revoked`). It grants no acceptance credit. For repository-retained records,
`recordLocation` is normalized to a repository-relative POSIX path; absolute,
`./`, and traversal paths are rejected. Records and attestations must remain in
`docs/acceptance/v1.1/evidence/baselines/`; their resolved targets are checked
before parsing or hashing, so external symlinks and duplicate resolved targets
are rejected. The attestation CLI therefore requires both outputs to remain in
that canonical directory beneath `--repo`.

The strict M0 input gate requires at least one clean `retained` or `finalized`
record and exactly one final sibling attestation for each retained record.
Provisional, superseded, revoked, orphaned, duplicate, or SHA/tree/digest-mismatched
evidence is rejected. The reviewer fields are required and must be supplied by
the actual reviewer; the tool will not invent an identity or authority. After a
final candidate SHA/tree exists, create an attestation alongside a retained
repository record:

```bash
python3 tools/acceptance/run_baseline.py \
  --output docs/acceptance/v1.1/evidence/baselines/baseline-final.json \
  --attestation-output docs/acceptance/v1.1/evidence/baselines/baseline-final.attestation.json \
  --attestation-status retained \
  --attestation-reviewer "actual reviewer identity" \
  --attestation-reviewer-authority "actual reviewer authority"
```

Do **not** commit a live baseline record or its attestation before the final
candidate SHA is fixed. The checked-in schemas are formats only.

## What the record makes explicit

Every task records a candidate SHA and dirty-state digest, UTC timestamp, exact
argument-vector command, one attempt only, result, evidence level, explicit
numerator/denominator, prerequisites, input artifact digests, and a bounded
summary. The only permitted statuses are `pass`, `fail`, `blocked`, and
`not-run`.

The baseline includes these bounded observations:

| Observation | Denominator and boundary |
| --- | --- |
| Handoff integrity | 14 manifested files; integrity only. |
| PostgreSQL / Maven / Flyway | PostgreSQL is checked without being started by the tool. Maven is `blocked` rather than skipped if it is unavailable, runs as `mvn -q clean test`, and only consumes reports from that attempt. V1--V4 are separately hashed; read-only Flyway history checks application only after Maven succeeds. |
| Expression corpus | The conformance task is always `not-run` until all 101 vectors execute. It separately records the 34 selected IDs discovered in the source and 67 explicitly unexecuted vectors; discovery is not conformance. |
| Frontend build/test | A build is compilation evidence only. `npm test` plus the Angular target configuration identifies a broken or missing test target; it never becomes a pass through a build. |
| JSON Schema / OpenAPI | JSON parsing, optional Draft 2020-12 meta-schema compilation, and YAML parsing are separate. Missing validator tooling is `blocked`; absent pinned OpenAPI semantic validation is `not-run`, never inferred from YAML syntax. |

## Non-acceptance rules

`acceptance.countsTowardAcceptance` is hard-coded to `false` for every task.
The runner performs no retries and does not install validators over the network.
A build, screenshot, mock, unavailable integration, filtered or undiscovered
corpus row, command retry, or a `pass` status in this record cannot close a
requirement, fixture, operator, vector, or final-acceptance gate. Prerequisite
failures remain `blocked`, and commands withheld by those failures are retained
as explicit `not-run` attempts.
