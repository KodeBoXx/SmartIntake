# Smart Form Builder Lite v1.1 M0 acceptance foundation

M0 freezes reviewable acceptance inputs; it does **not** claim product
conformance or approve a release. The latest PRD bytes remain the sole scope
authority. The preserved inventory contains 95 requirements, 31 fixtures, and
X01–X06 exclusions. A supplemental claim of seven formerly removed whole-Core
IDs is unresolved provenance only: M0 never infers those IDs, restores a
capability, or changes scope.

## Aggregate checker

Run the reusable artifact-integrity check from the repository root:

```sh
python3 tools/acceptance/check_m0.py
```

The default check intentionally works after M0 is merged or during M1: it does
not require the original M0 branch or source-commit scope. It requires a clean
worktree and prints the current `HEAD` plus a SHA-256 status-path digest (not a
content digest). A dirty checkout fails by default. For a local, precommit-only
provisional check, explicitly opt in:

```sh
python3 tools/acceptance/check_m0.py --diagnostic --allow-dirty
```

`--allow-dirty` is rejected outside diagnostic mode. It does not make the
result reproducible, accepted, or eligible for M0 exit. Diagnostic mode returns
exit code **2** whenever it retains a blocker; it never returns success merely
because independent surfaces were checked. Strict blocked mode is also nonzero.
Once the seven-ID blocker is resolved, a pending independent-review freeze
attestation exits **3** until its required review is completed.

To enforce the historical M0 branch/source scope before the freeze is merged,
add the optional guard:

```sh
python3 tools/acceptance/check_m0.py --freeze-check
```

## Current strict/provisional status

The only accepted provenance blocker is the exact structured sibling signal
`denial-list-unenumerated`. The aggregate checker maps only that signal to the
unresolved supplemental seven-ID provenance discrepancy. Similar words in an
unrelated error remain a failure, never a blocker.

Strict mode invokes the inventory generator and independent evaluator validator
without their provisional options. Diagnostic mode invokes their explicit
provisional modes, still records the same strict blocker, and exits 2. Neither
mode grants M0 exit, product-conformance, or acceptance credit.

Later native-locale review, M2 schema instances, and sealed sentinel execution
remain evaluator execution prerequisites. They are not reclassified as M0
product blockers by this input-integrity gate.

## What is checked

- protected PRD bytes and the 14-file handoff verifier;
- fixed inventory counts (95 total: 83 Core/12 Enhancement), 31 fixtures,
  X01–X06 exclusions, 34 operators, and 101 vectors;
- the inventory generator and independent evaluator validator;
- the denominator generator's non-mutating `--check` mode and v2 transitive
  closure: the index binds the SHA256SUMS digest and member set, SHA256SUMS
  binds every listed artifact byte, and every indexed manifest binds its
  digest, `total`, and `len(members)`. The aggregate rejects extras, omissions,
  malformed closure paths, and every symlink before parsing a member;
- denominator and evaluator independent-review attestations. The aggregate
  consumes `tools/acceptance/denominator_review.py` for denominator authority,
  decision, and reconstructed pre-attestation binding semantics rather than
  reimplementing them. Advisory, rejected, stale, missing, or self-style
  attestations never release the freeze. Independent-agent review is technical
  review only; it is never reported as human sign-off. Pending states are never
  fabricated as approvals or conflated with the seven-ID provenance blocker;
  and
- baseline evidence schema and records. M0 entry evidence requires at least one
  clean `retained` or `finalized` baseline record, exactly one sibling
  `*.attestation.json` pointer/digest for every retained record, matching
  candidate SHA/tree identity, reviewer identity/authority/approval metadata,
  and a `recordValidation.schemaSha256` matching the live baseline schema.
  Absence is pending; provisional, superseded, revoked, orphaned, duplicate, or
  mismatched evidence is rejected. Records
  are JSON-Schema validated whenever the locally available `jsonschema` package is present;
  no package is installed by this checker; and
- non-acceptance boundaries: a baseline observation or checker result can never
  count toward acceptance.

A baseline attestation has this repository-relative shape (the evidence runner
emits this shape beside a retained record):

```json
{
  "attestationVersion": "1.1.0",
  "recordLocation": "docs/acceptance/v1.1/evidence/baselines/baseline-example.json",
  "recordSha256": "64-lowercase-hex-characters",
  "recordStatus": "retained",
  "candidate": { "sha": "40-lowercase-hex-characters", "treeSha": "40-lowercase-hex-characters", "dirty": false },
  "createdAtUtc": "2026-09-14T00:00:00Z",
  "reviewer": "actual reviewer identity",
  "reviewerAuthority": "actual reviewer authority",
  "reviewStatus": "approved",
  "acceptanceBoundary": "Attestation preserves a baseline observation; it grants no acceptance credit."
}
```

The checker does not fabricate reviewer identity, attestations, baseline
records, locale translations, schemas, sentinels, or denial-list IDs.

## Focused tests

```sh
python3 tools/acceptance/test_check_m0.py
```

The focused tests include denominator byte drift at unchanged totals, malformed
closures, symlink injection, advisory/rejected/stale review classifications,
positive acceptance prose, retained-evidence symlink escape, unrelated denial
wording, dirty state, and blocked-over-pending exit precedence. The evaluator
validator remains the authority for corpus C28–C34, including its v1.6
content-bound manifest-signature test; until its sibling update finishes, any
validator failure remains explicit and invalid rather than being downgraded to
pending.

## Artifact ownership and status

| Surface | Owner | Current role |
| --- | --- | --- |
| `inventory/` and `tools/acceptance/generate_inventory.py` | acceptance/inventory | Fixed PRD-derived inventory. Certinal token/typography styles are separate from component use: zero package/import/tag/Cui symbols remains zero component conformance. |
| `denominators/` | acceptance/denominators | Generated finite manifests and checksum/index material; independent-review attestation is a freeze requirement. |
| `evaluator/` | independent evaluator | Frozen expected-outcome corpus and independent signature; no measured conformance result. |
| `evidence/` and `tools/acceptance/run_baseline.py` | acceptance/evidence | Reproducible non-acceptance observations; retained records need pointer/digest attestation. |
| `tools/acceptance/check_m0.py` | M0 integration | Aggregates sibling indexes and reports integrity failures/blockers without waiving them. |
