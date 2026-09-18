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
| package | `package.schema.json` | Resolved portable definition: recursive object/list fields, flow nodes, all 17 catalog rows/control metadata, dependencies, policies, assets and namespaced extensions. |
| expression | `expression.schema.json` | Closed recursive AST with literals, references, contexts and all 34 named operations. |
| input answer | `input-answer.schema.json` | Recursive client/default `{status,value?}` wrapper without type, provenance, actor or authority metadata. |
| typed answer | `typed-answer.schema.json` | Server-side resolved cell type, recursive values and server provenance. |
| runtime manifest | `runtime-manifest.schema.json` | Immutable package/policy/component/asset/tzdb interpretation binding. |
| submission envelope | `submission-envelope.schema.json` | Immutable accepted response, trusted authority fields, recursive answers, sealed attachment metadata and acknowledgments. |
| event | `event.schema.json` | Closed outbound event envelope for `form.published`, `form.retired`, `submission.created`, `submission.deleted`, and `attachment.rejected`. |

All normative named object shapes use `additionalProperties: false`. The only
open maps are explicit identity/locale maps and `extensions`, whose keys must
be an explicit extension namespace (`x-<namespace>.<name>`). Unknown core
properties therefore fail schema validation.

## Normative wire rules represented here

- `schemaVersion`, `contractVersion`, and `engineContract` are exactly `4.0.0`.
- Integers use canonical signed-int64 decimal strings. Decimal strings have no
  exponent, leading plus, negative zero, or noncanonical trailing fractional
  zero. The validator enforces int64 range and the 34-significant-digit bound.
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

The authority is the PRD v1.1 and `Lite-Contract-Details.md`; evaluator
packages/examples are only observational inputs and are not imported as this
contract's authority.

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
harness requires positives to pass and negatives to fail. Run `git diff --check`
after validation when changing this corpus.
