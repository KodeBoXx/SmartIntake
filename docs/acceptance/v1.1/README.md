# Smart Form Builder Lite v1.1 M0 acceptance foundation

M0 freezes acceptance inputs; it does **not** claim product conformance or
approve a release. The protected source candidate is
`66e96756d3e7d00c60e8d974b34a113b9ca60586` on branch
`vorflux/m0-acceptance-foundation`. The aggregate checker verifies that exact
source as a HEAD ancestor, allows only M0 paths since it, and verifies the
handoff before it trusts any generated acceptance input.

## Run the aggregate gate

From the repository root:

```sh
python3 tools/acceptance/check_m0.py
```

Strict mode is intentionally **blocked** today. The latest PRD remains the
scope authority and its bytes, all 95 requirements, 31 fixtures, and X01–X06
exclusions are preserved. A supplemental handoff claim says there are seven
formerly removed whole-Core IDs but supplies none. M0 records that as one
unresolved provenance discrepancy; it does not infer IDs, restore capabilities,
or change scope. The checker propagates this same blocker from both the
inventory generator and independent evaluator validator.

To verify every other M0 surface while that source defect remains open:

```sh
python3 tools/acceptance/check_m0.py --diagnostic
```

Diagnostic mode exits successfully only when all independent non-blocked checks
are sound, and prints that strict M0 remains blocked. It is provisional
provenance verification only: it cannot claim M0 exit, product conformance, or
any acceptance credit. The supplemental claim remains unresolved unless a
future governed provenance decision changes it; do not infer IDs or restore
capabilities.

Focused integration tests:

```sh
python3 tools/acceptance/test_check_m0.py
```

## What the checker covers

- exact protected branch/HEAD, M0-only worktree scope, frozen PRD SHA-256, and
  the 14-file handoff verifier;
- the inventory generator and its fixed counts: 95 requirements (83 Core and
  12 Enhancement), 31 fixtures, X01–X06 exclusions, 34 operators, and 101
  vectors;
- SHA-256 coverage and frozen totals for all denominator manifests;
- the independent evaluator corpus validator and its validator tests;
- baseline evidence schema non-acceptance rules and baseline-tool tests; and
- absence of M0 product-conformance/pass claims. Baseline observations may
  record command outcomes, but every one remains outside acceptance.

The checker uses only the Python standard library and invokes no network
install, service start, or product-code change.

## Artifact ownership and status

| Surface | Owner | Current status |
| --- | --- | --- |
| `inventory/` and `tools/acceptance/generate_inventory.py` | acceptance/inventory | Generated and checksum-verified; the supplemental seven-ID claim is an unresolved provenance blocker, not scope authority. |
| `denominators/` | acceptance/denominators | Generated finite manifests, all members `not-run`; independent review remains required. |
| `evaluator/` | independent evaluator | Frozen expected-outcome corpus; conformance has not run and the denial-list check is blocked. |
| `evidence/` and `tools/acceptance/run_baseline.py` | acceptance/evidence | Reproducible baseline observation tooling only; no observation closes acceptance. |
| `tools/acceptance/check_m0.py` | M0 integration | Aggregates the above checks and reports blockers without waiving them. |

Generated evidence records should be kept in an approved retention-controlled
location, not committed here. Remove Python cache files before review; they are
ignored by the repository.
