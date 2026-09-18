# Smart Form Builder Lite normative schemas — 4.0.0

This directory contains the seven closed JSON Schema Draft 2020-12 transport
contracts for the Smart Form Builder Lite public profile. They are an additive
M2 contract surface, independent from the current prototype runtime, OpenAPI,
and M0 acceptance evaluator. They are not a product-acceptance claim.

## Stable artifacts

`index.json` is the machine-readable inventory. Every schema has a stable
`https://kodeboxx.example/contracts/smart-form-builder-lite/4.0.0/` `$id`.

| Kind | Artifact | Purpose |
| --- | --- | --- |
| package | `package.schema.json` | Resolved portable definition: recursive fields, guidance/theme, locale bundles, routes, catalog/control metadata, policies, assets, and versioned dependencies. |
| expression | `expression.schema.json` | Closed recursive AST with typed scalars/homogeneous arrays, scoped references, frozen contexts, and all 34 named operations. |
| input answer | `input-answer.schema.json` | Recursive client/default `{status,value?}` wrapper without type, provenance, actor or authority metadata. |
| typed answer | `typed-answer.schema.json` | Server-side resolved cell type, recursive values and server provenance. |
| runtime manifest | `runtime-manifest.schema.json` | Immutable package/policy/component/asset/tzdb interpretation binding. |
| submission envelope | `submission-envelope.schema.json` | Immutable accepted response, trusted authority fields, UTC lifecycle timestamps, recursive answers, sealed attachment metadata and acknowledgments. |
| event | `event.schema.json` | Closed outbound event envelope for `form.published`, `form.retired`, `submission.created`, `submission.deleted`, and `attachment.rejected`. |

All normative named object shapes use `additionalProperties: false`. The only
open maps are explicit identity and locale maps. An `extensions` map accepts
only a namespaced key (`x-<namespace>.<name>`) with a closed scalar descriptor
that identifies its versioned dependency ID, version and digest. The package
compiler rejects a descriptor without an exactly matching `kind: extension`
dependency; extensions are therefore not an unrestricted escape hatch.

## Normative wire rules represented here

- `schemaVersion`, `contractVersion`, and `engineContract` are exactly `4.0.0`.
- Integers use canonical signed-int64 decimal strings. Destination decimal
  storage preserves the declared scale (for example, `"12.50"`); it rejects
  exponent and leading-plus encodings. Exact expression results use the
  distinct canonical-result decimal definition, which rejects redundant
  trailing fractional zeroes. The validator enforces the 34-significant-digit
  bound in both contexts.
- Date and time values are canonical strings; date-time is the explicit
  `{instant,timeZone}` object. UTC server timestamps use RFC 3339 `Z` form.
- The six statuses are `answered`, `unanswered`, `unknown`, `declined`,
  `respondentNotApplicable`, and `notApplicable`; only `answered` carries a
  value. Input answers deliberately omit provenance, while typed envelope cells
  require server provenance.
- Recursive list records use stable `itemId` and fields; row paths are ordered
  `{listFieldId,itemId}` ancestor addresses (maximum supported depth three).
  Identity resolution, uniqueness across a session, option/field-reference
  resolution, and semantic control-to-field binding remain compiler/runtime
  checks rather than JSON Schema assertions.
- Expression references are exactly `{ref:{fieldId,scope,parentDepth?}}`.
  `scope` is `root`, `item`, or `parentItem`; `parentDepth` is 1--3 and only
  appears for `parentItem`. Literals are typed scalar values or homogeneous
  scalar arrays with `itemType`; only `sessionDate` and `sessionTimeZone` are
  contexts.
- Packages require root `guidance` and `theme`, locale-bundle translations,
  route/default-next-page structures, visibility/guidance references, full
  policy fields, and component/extension dependency records. Message parts
  include safe value and cardinal-plural variants.
- Submission envelopes require `startedAt`, `submittedAt`, and `receivedAt` in
  UTC RFC 3339 form. Event types are discriminated; `submission.deleted` is
  reference-only and requires submission/deletion IDs plus `accessRevokedAt`.

The authority is the PRD v1.1, `Lite-Contract-Details.md`, and the frozen
`expression-contract.json`. The harness checks selected authoritative AST
vectors against the source file hash. The compact and rich package fixtures
are PRD-derived contract examples, not evaluator acceptance evidence.

## Validation

The schema harness does not load OpenAPI or application code. It compiles every
indexed schema and validates every checked-in fixture:

```sh
python3 tools/contracts/validate_schemas.py --verbose
# or
sh tools/contracts/test_schemas.sh
```

It uses `jsonschema==4.10.3` (`tools/contracts/requirements.txt`), which is
available in the repository environment. Each schema has an independent
representative positive fixture and a negative fixture under `fixtures/`; the
harness also validates PRD minimal/rich package examples, extension binding,
stored versus result decimal behavior, all five event discriminators, and
frozen expression vectors. Run `git diff --check` after validation when
changing this corpus.
