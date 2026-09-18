# M0 derived denominator manifests

This directory freezes the acceptance denominators required by the approved
Smart Form Builder Lite v1.1 plan.  It is an acceptance-input artifact, **not**
evidence that a product behavior has executed.  Every generated member starts
as `not-run`; no current implementation result is used as an expected result.

## Authority and version

* Manifest version: `2.0.0-m0`
* Authoritative source: `docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md`
  and its binding Appendix A and evaluator-protocol companions.
* Source digests: SHA-256 for the PRD and every generator input is recorded in
  `manifest-index.json` when generated.
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
# Non-mutating: regenerates in a temporary directory and byte-compares all artifacts.
python3 build_manifests.py --check
```

The generator fails on duplicate IDs, `TBD`, blank/orphan citations, a member
without an owner/status, fixed-count drift, malformed named operation, or
`total != len(members)`. `--check` additionally rejects a stale/unexpected live
artifact, a mismatched source hash, or a byte difference from a temporary
regeneration without writing the live directory. It also writes `SHA256SUMS`;
its own checksum is deliberately excluded to avoid a self-referential digest.
Review uses the generated `manifest-index.json` and
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
* `O_named=53` is the PRD explicit-table count. `named_supporting_total=55`
  adds the PRD-named interpretation operation and authorized asset API. The
  executable `O_total=82` is `O_named` plus frozen supporting CRUD and the
  interpretation GET; the authorized asset API remains awaiting M2 method/path
  design and is not an executable O_total member.
* `SEC_total=10,452` is the feasible product of 17 principal profiles, 39 resource-specific surfaces, four relationship contexts, and the applicable five-state model. It records exact `allow`, `401`, `403`, `404`, or `410` results with deterministic precedence. `SECX_total=2,808` contains only staff/respondent credential-state structural impossibilities; every denial, tombstone, webhook-policy conjunction, foreign/missing resource, same-tenant unassigned resource, and other-respondent case remains an SEC assertion.
* The 17 profiles preserve all 12 authoritative singleton roles, four M0-selected additive-role probes, and an authenticated no-workspace-role profile. Compound grants are unions except full webhook payload, which requires organization-owner + response-exporter + approved organization policy. Definition-asset security actions are deliberately abstract until M2 selects endpoint methods and paths.
* `WCAG_total` contains exactly the 55 WCAG 2.2 A/AA criteria, each with its
  real A or AA level, multiplied by the two approved methods. A criterion is
  absent only when `wcag-applicability-exclusions.json` contains its explicit
  rationale; that auxiliary inventory records the two prior mistaken AAA
  inclusions (2.4.12 and 2.4.13), not a general inventory of non-A/AA
  criteria. No scan alone is a pass.
* `N_current` is a characterization-surface inventory.  It asks a later run
  to record an observed pre-refactor result; it defines no desired current
  product outcome and cannot be used as a normative oracle.

## Migration note

`1.4.0-m0` (2,808 SEC / 1,080 SECX) was withdrawn before release. It represented scalar roles, generic operations, three tenant contexts, and a collapsed state model; it therefore omitted assignment/ownership, compound-role, review-decision, definition-asset, webhook-policy, staff-authentication, and authorized-410 cases. `2.0.0-m0` replaces it without a compatibility alias: it publishes the corrected profile/surface/context/state model (`SEC=10,452`, `SECX=2,808`), a transitive release closure, and a new technical-review schema. No prior review attestation carries forward.

## Release closure and review

`manifest-index.json` pins each generated manifest digest and total and the SHA-256 of `SHA256SUMS`. `SHA256SUMS` pins every release member except itself and the index, avoiding a digest cycle; together an evaluator pin to the index binds every denominator byte. The schema `review-attestation.schema.json` defines the sole technical-review contract. The shared standard-library validator is `tools/acceptance/denominator_review.py`. The attestation remains pending in this release.

No member may be marked pass from a build, screenshot, mock, focused/skip
filter, or an unreviewed checksum.  `blocked`, `unknown`, and `not-run` remain
in the denominator and keep complete acceptance open.  Later-discovered
required cases require a new semantic manifest version, an independent review,
an append-only migration note, and a full rerun of affected results.  Removing
or renumbering a released member is forbidden. This corpus is explicitly
`unreviewed-not-released`: the pending attestation pointer in
`manifest-index.json` is not an approval and no no-renumber-after-release claim
starts until an independent reviewer supplies the referenced attestation. The
attestation file is intentionally absent-tolerant: if absent it remains pending;
if supplied it must be valid, manifest-version-bound, indexed, and checksummed.
Its authority must be `independent-agent-review`, `human-independent-review`,
or `advisory-non-human`. Only the first two can change the release label, and
they remain explicitly distinct; advisory material stays pending. An
attestation binds the preserved pre-attestation `manifest-index.json` and
`SHA256SUMS` hashes, not the impossible post-inclusion index digest.
