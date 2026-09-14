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
python3 tools/acceptance/run_baseline.py --output /secure/evidence/baseline.json
```

Use a retention-controlled evidence location for retained observations. Records
contain summarized command output (at most 4,000 characters per command), input
artifact SHA-256 digests, and no environment-variable dump. Do not add secrets
to commands, output paths, or evidence records.

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
| PostgreSQL / Maven / Flyway | PostgreSQL is checked without being started by the tool. Maven is `blocked` rather than skipped if it is unavailable. V1--V4 are separately hashed; read-only Flyway history checks application only after Maven succeeds. |
| Expression harness | 34 discovered selected IDs / 101 authoritative vectors, with 67 explicitly `notExecuted`. Discovery is not vector execution or conformance. |
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
