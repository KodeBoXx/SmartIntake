# Smart Form Builder Lite M2 API contract

`openapi.yaml` is the normative OpenAPI 3.1 contract for Smart Form Builder Lite
4.0.0. It is generated from the frozen M0 machine-readable inventories, not from
the current prototype controller routes:

```bash
python3 tools/openapi/generate_openapi.py
python3 tools/openapi/validate_openapi.py --check-generated
python3 -m unittest tools.openapi.test_validate_openapi
```

## Inventory boundary

- `docs/acceptance/v1.1/denominators/o-named.json` contributes exactly **53**
  PRD-named verb/path operations.
- `docs/acceptance/v1.1/denominators/o-total.json` contributes exactly **82**
  executable operations: the 53 named records, 28 selected supporting CRUD
  records, and the explicit submission-interpretation operation.
- `operationId` is the stable frozen inventory ID. Each counted operation has
  `x-m0-counted: true`, `x-m0-inventory-id`, PRD citation, role/tenant scope,
  replay/concurrency metadata, concrete request/resource/response schemas,
  RFC 9457 problem responses, and validating representative examples. Generic
  envelope/document fallback models are forbidden by the validator.
- The PRD names an authorized asset API but omits its verb and path. M2 freezes
  `GET /v1/workspaces/{w}/assets/{assetId}` as a workspace-bound, staff-only,
  five-minute capability design. It is explicitly `x-m0-counted: false`; it
  does **not** change the frozen O_total denominator.

`legacy-prototype-compatibility.yaml` is an observational compatibility file.
Every operation in it is `x-legacy: true` and `x-m0-counted: false`. It is not
an implementation claim or an alternative normative API. The validator proves
exact verb/path/operation-ID equality against O_total, so replacing a normative
operation with a prototype route fails validation.

## Security and evolution

Staff operations use an opaque HttpOnly cookie plus `X-CSRF-Token` for
mutations. Respondent session operations use a distinct opaque respondent
session authorization and are never staff-cookie endpoints. Mutable definitions
use strong ETags and `If-Match`; session changes use `baseRevision` plus
`clientMutationId`. Tenant/account/platform scope is explicit in every operation
through `x-authorization`; IDs are opaque and never authorization grants.

All operational errors use the shared RFC 9457-style `Problem` schema. The
component document references the seven closed M2 JSON Schema artifacts by
filename. M2 owns the complete payload contract now; only operations explicitly
marked `implemented` claim live behavior. All remaining operations are marked
`contract-published` rather than being deferred to a later payload-design phase.
