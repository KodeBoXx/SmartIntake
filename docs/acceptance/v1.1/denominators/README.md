# M0 derived denominator manifests

This directory freezes the acceptance denominators required by the approved
Smart Form Builder Lite v1.1 plan.  It is an acceptance-input artifact, **not**
evidence that a product behavior has executed.  Every generated member starts
as `not-run`; no current implementation result is used as an expected result.

## Authority and version

* Manifest version: `1.0.0-m0`
* Authoritative source: `docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md`
  and its binding Appendix A and evaluator-protocol companions.
* Source digest: SHA-256 is recorded in `manifest-index.json` when generated.
* Owner: `acceptance/denominators` (M0); execution owners are recorded on each
  member.  An independent acceptance reviewer, who did not implement the
  mapped product surface, must approve each manifest checksum before numerator
  evidence is credited.

`build_manifests.py` is the deterministic, standard-library-only generator.
It reads only the authoritative handoff files plus the plan-selected inventory
embedded in the generator.  It never runs or reads product behavior.

```sh
cd docs/acceptance/v1.1/denominators
python3 build_manifests.py
sha256sum --check SHA256SUMS
```

The generator fails on duplicate IDs, `TBD`, blank/orphan citations, a member
without an owner/status, fixed-count drift, or a malformed named operation. It
also writes `SHA256SUMS`; its own checksum is deliberately excluded to avoid a
self-referential digest.  Review uses the generated `manifest-index.json` and
`SHA256SUMS`, then records reviewer identity/date in the immutable evidence
ledger outside this directory.

## Counting and change policy

* A member is counted once by its stable `id`; aliases, display labels and
  repeated executions do not create members.
* `A_total` (95 requirements), `O_named` (53 distinct verb+path operations),
  and `I_total` (50 identity assertions) have PRD-fixed counts.  The remaining
  inventories are finite M0 selections where the PRD requires a class of
  coverage but does not publish a complete list.  Their `selection` field says
  so explicitly; they are not represented as PRD-fixed counts.
* `O_total` is `O_named` plus the separately frozen supporting CRUD paths.  It
  is intentionally not claimed to be a PRD-fixed count because §11.5 requires
  supporting CRUD without prescribing paths.
* `SEC_total` contains every member of its frozen five-dimensional product.
  A member may expect `allow`, `deny`, or `not-found`; those are all feasible
  security assertions.  The generated exclusion inventory records every
  excluded resource/operation/state combination and why it is impossible,
  rather than silently dropping it.
* `WCAG_total` applies its approved-method rule to every listed WCAG 2.2 A/AA
  criterion.  A criterion is absent only when `wcag-applicability-exclusions`
  contains its explicit product-scope rationale; no scan alone is a pass.
* `N_current` is a characterization-surface inventory.  It asks a later run
  to record an observed pre-refactor result; it defines no desired current
  product outcome and cannot be used as a normative oracle.

No member may be marked pass from a build, screenshot, mock, focused/skip
filter, or an unreviewed checksum.  `blocked`, `unknown`, and `not-run` remain
in the denominator and keep complete acceptance open.  Later-discovered
required cases require a new semantic manifest version, an independent review,
an append-only migration note, and a full rerun of affected results.  Removing
or renumbering a released member is forbidden.
