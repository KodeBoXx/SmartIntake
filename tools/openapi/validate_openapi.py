#!/usr/bin/env python3
"""Validate the M2 OpenAPI inventory, references, examples, and generator drift."""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator, RefResolver

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "docs/api/openapi.yaml"
COMPONENTS = ROOT / "docs/contracts/smart-form-builder-lite/4.0.0/openapi-components.yaml"
NAMED = ROOT / "docs/acceptance/v1.1/denominators/o-named.json"
TOTAL = ROOT / "docs/acceptance/v1.1/denominators/o-total.json"
LEGACY = ROOT / "docs/api/legacy-prototype-compatibility.yaml"
SCHEMA_FILES = {
    "package.schema.json", "expression.schema.json", "input-answer.schema.json",
    "typed-answer.schema.json", "runtime-manifest.schema.json",
    "submission-envelope.schema.json", "event.schema.json",
}
REQUIRED_PROBLEMS = {"400", "401", "403", "404", "429", "500"}
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}
FORBIDDEN_FALLBACKS = {"RequestEnvelope", "ApiDocument"}


def load_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = yaml.safe_load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path.relative_to(ROOT)} must contain an object")
    return value


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def ops(document: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    result = []
    for path, path_item in document.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue
        for method, value in path_item.items():
            if method.lower() in HTTP_METHODS and isinstance(value, dict):
                result.append((method.upper(), path, value))
    return result


def external_refs(value: Any) -> set[str]:
    if isinstance(value, dict):
        refs = {item for key, item in value.items() if key == "$ref" and isinstance(item, str)}
        for child in value.values():
            refs.update(external_refs(child))
        return refs
    if isinstance(value, list):
        return set().union(*(external_refs(child) for child in value)) if value else set()
    return set()


def pointer(document: dict[str, Any], fragment: str) -> Any:
    """Resolve the small JSON Pointer subset used by generated component refs."""
    value: Any = document
    for part in fragment.lstrip("#/").split("/"):
        if not part:
            continue
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value


def schema_for(ref_value: dict[str, Any], components: dict[str, Any]) -> tuple[str | None, Any | None]:
    reference = ref_value.get("$ref") if isinstance(ref_value, dict) else None
    if not isinstance(reference, str):
        return None, None
    marker = "#/components/schemas/"
    if marker not in reference:
        return None, None
    name = reference.rsplit(marker, 1)[1]
    return name, components["components"]["schemas"].get(name)


def validate_example(schema: dict[str, Any], value: Any, components: dict[str, Any]) -> str | None:
    """Validate generated examples with local/external refs rooted at components."""
    def expand(value: Any) -> Any:
        if isinstance(value, dict):
            reference = value.get("$ref")
            if isinstance(reference, str) and reference.startswith("#/components/schemas/"):
                name = reference.rsplit("/", 1)[1]
                return expand(components["components"]["schemas"][name])
            if isinstance(reference, str) and ".schema.json" in reference:
                filename = reference.split("#", 1)[0].rsplit("/", 1)[-1]
                local = COMPONENTS.parent / filename
                if local.is_file():
                    return expand(json.loads(local.read_text(encoding="utf-8")))
            return {key: expand(child) for key, child in value.items()}
        if isinstance(value, list):
            return [expand(child) for child in value]
        return value
    try:
        expanded = expand(schema)
        store: dict[str, Any] = {}
        for filename in SCHEMA_FILES:
            candidate = COMPONENTS.parent / filename
            if candidate.is_file():
                external = json.loads(candidate.read_text(encoding="utf-8"))
                if isinstance(external.get("$id"), str):
                    store[external["$id"]] = external
        resolver = RefResolver(base_uri=COMPONENTS.as_uri(), referrer=expanded, store=store)
        error = next(iter(Draft202012Validator(expanded, resolver=resolver).iter_errors(value)), None)
        return None if error is None else error.message
    except Exception as exc:  # pragma: no cover - dependency-specific resolver failures
        return f"schema example resolution failed: {exc}"


def content_examples(content: dict[str, Any], components: dict[str, Any]) -> list[Any]:
    examples = content.get("examples", {})
    values = []
    for example in examples.values():
        if isinstance(example, dict) and "value" in example:
            values.append(example["value"])
        elif isinstance(example, dict) and isinstance(example.get("$ref"), str) and "#/components/examples/" in example["$ref"]:
            name = example["$ref"].rsplit("/", 1)[1]
            resolved = components.get("components", {}).get("examples", {}).get(name, {})
            if "value" in resolved:
                values.append(resolved["value"])
    if "example" in content:
        values.append(content["example"])
    return values


def validate_success_examples(operation_id: str, responses: dict[str, Any], components: dict[str, Any], errors: list[str]) -> None:
    """Require every published supplemental response example to match its concrete schema."""
    for code, response in responses.items():
        if not str(code).startswith("2") or not isinstance(response, dict):
            continue
        for media_type, media in response.get("content", {}).items():
            if not isinstance(media, dict):
                errors.append(f"supplemental success response {operation_id} has malformed {media_type} content")
                continue
            if media_type == "application/octet-stream":
                if media.get("schema", {}).get("format") != "binary":
                    errors.append(f"supplemental binary response {operation_id} must declare binary body")
                continue
            name, schema = schema_for(media.get("schema", {}), components)
            if name in FORBIDDEN_FALLBACKS or schema is None:
                errors.append(f"supplemental success response {operation_id} must select a concrete component response schema")
                continue
            values = content_examples(media, components)
            if not values:
                errors.append(f"supplemental success response {operation_id} lacks a representative example")
            for value in values:
                example_error = validate_example(schema, value, components)
                if example_error:
                    errors.append(f"supplemental success response {operation_id} example is invalid: {example_error}")


def validate(check_generated: bool) -> list[str]:
    errors: list[str] = []
    document, components = load_yaml(API), load_yaml(COMPONENTS)
    named, total = load_json(NAMED), load_json(TOTAL)
    if document.get("openapi") != "3.1.0":
        errors.append("openapi.yaml must declare OpenAPI 3.1.0")
    if components.get("openapi") != "3.1.0":
        errors.append("openapi-components.yaml must declare OpenAPI 3.1.0")
    inventory_by_id = {member["id"]: member for member in total["members"]}
    named_ids = {member["id"] for member in named["members"]}
    schemas = components.get("components", {}).get("schemas", {})
    published_schema = schemas.get("PublishedSchema", {})
    if published_schema.get("additionalProperties") is not True:
        errors.append("PublishedSchema must explicitly accept complete Draft 2020-12 documents, including $defs and extension annotations")
    for filename in sorted(SCHEMA_FILES):
        document_schema = json.loads((COMPONENTS.parent / filename).read_text(encoding="utf-8"))
        error = validate_example(published_schema, document_schema, components)
        if error:
            errors.append(f"PublishedSchema must accept served {filename}: {error}")
    capability = schemas.get("CapabilityRegistry", {})
    if not {"fieldTypes", "operators"}.issubset(set(capability.get("required", []))):
        errors.append("CapabilityRegistry must retain deprecated fieldTypes and operators aliases")
    for fallback in FORBIDDEN_FALLBACKS:
        if fallback in schemas:
            errors.append(f"forbidden generic fallback schema {fallback} is declared")
    counted: list[tuple[str, str, dict[str, Any]]] = []
    seen_ids: set[str] = set()
    for method, path, op in ops(document):
        if op.get("x-legacy") is True:
            errors.append(f"normative OpenAPI contains legacy operation {method} {path}")
        if op.get("x-m0-counted") is True:
            counted.append((method, path, op))
            operation_id = op.get("operationId")
            if operation_id in seen_ids:
                errors.append(f"duplicate counted operationId {operation_id}")
            seen_ids.add(operation_id)
            member = inventory_by_id.get(operation_id)
            if member is None:
                errors.append(f"counted operation {method} {path} is not in frozen O_total")
            elif (member["method"], member["path"]) != (method, path):
                errors.append(f"prototype or substituted key for {operation_id}: expected {member['method']} {member['path']}, got {method} {path}")
            if op.get("x-m0-inventory-id") != operation_id:
                errors.append(f"counted operation {operation_id} lacks matching x-m0-inventory-id")
            if not isinstance(op.get("x-authorization"), dict) or not op["x-authorization"].get("roles") or not op["x-authorization"].get("tenantScope"):
                errors.append(f"counted operation {operation_id} lacks roles/tenant scope")
            responses = op.get("responses", {})
            if not responses:
                errors.append(f"counted operation {operation_id} has no responses")
                continue
            success = next((code for code in responses if str(code).startswith("2")), None)
            if success is None:
                errors.append(f"counted operation {operation_id} has no 2xx response")
            if not REQUIRED_PROBLEMS.issubset(set(map(str, responses))):
                errors.append(f"counted operation {operation_id} lacks shared RFC 9457 responses")
            if method not in {"GET", "HEAD", "OPTIONS"}:
                if "requestBody" not in op and op.get("x-request-body") != "none":
                    errors.append(f"mutation {operation_id} has no concrete request body or explicit no-content body")
                else:
                    if "requestBody" in op:
                        media = op["requestBody"].get("content", {}).get("application/json", {})
                        name, schema = schema_for(media.get("schema", {}), components)
                        if name in FORBIDDEN_FALLBACKS or schema is None:
                            errors.append(f"mutation {operation_id} must select a concrete component request schema")
                        elif schema.get("type") == "object" and schema.get("additionalProperties") is not False:
                            errors.append(f"mutation {operation_id} request schema {name} is permissive")
                        examples = media.get("examples", {})
                        if not {"valid", "invalid"}.issubset(examples):
                            errors.append(f"mutation {operation_id} lacks positive/negative request examples")
                        elif schema is not None:
                            valid_error = validate_example(schema, examples["valid"].get("value"), components)
                            invalid_error = validate_example(schema, examples["invalid"].get("value"), components)
                            if valid_error:
                                errors.append(f"mutation {operation_id} positive request example is invalid: {valid_error}")
                            if not invalid_error:
                                errors.append(f"mutation {operation_id} negative request example unexpectedly validates")
                if not op.get("x-replay"):
                    errors.append(f"mutation {operation_id} lacks replay contract")
            if method in {"PUT", "PATCH"} or path.endswith("/activation") or path.endswith("/commit"):
                if not {"412", "428"}.issubset(set(map(str, responses))):
                    errors.append(f"conditional mutation {operation_id} lacks 412/428 responses")
                if not op.get("x-concurrency"):
                    errors.append(f"conditional mutation {operation_id} lacks ETag contract")
            security = op.get("security", [])
            if path.startswith("/v1/sessions/") and security != [{"respondentSession": []}]:
                errors.append(f"respondent operation {operation_id} must use respondentSession, not staff cookie/CSRF")
            if security == [{"staffCookie": [], "csrfHeader": []}] and method not in {"GET", "HEAD", "OPTIONS"} and not path.startswith("/v1/auth/"):
                if not any(p.get("$ref", "").endswith("#/components/parameters/IdempotencyKey") for p in op.get("parameters", []) if isinstance(p, dict)):
                    errors.append(f"staff mutation {operation_id} lacks Idempotency-Key")
            if op.get("x-implementation-status") not in {"implemented", "contract-published"}:
                errors.append(f"counted operation {operation_id} lacks implementation publication status")
            if path.startswith("/v1/auth/") or path == "/v1/invitations/accept":
                replay = op.get("x-replay", "")
                if not isinstance(replay, str) or "never replay credentials" not in replay or "Idempotency-Key" in replay:
                    errors.append(f"auth operation {operation_id} must use credential-safe operation-specific replay semantics")
            if path == "/v1/auth/sign-in":
                parameter_refs = {parameter.get("$ref") for parameter in op.get("parameters", []) if isinstance(parameter, dict)}
                if not {"LoginCsrfToken", "LoginCsrfCookie"}.issubset({reference.rsplit("/", 1)[-1] for reference in parameter_refs if isinstance(reference, str)}):
                    errors.append("sign-in must require the bound login-CSRF header and cookie parameters")
            if path == "/v1/auth/session":
                response = responses.get("200", {})
                content = response.get("content", {}).get("application/json", {}) if isinstance(response, dict) else {}
                response_name, _ = schema_for(content.get("schema", {}), components)
                if op.get("security") != [{"staffCookie": []}] or op.get("x-authorization", {}).get("roles") != ["staff.session.self"]:
                    errors.append("GET /v1/auth/session must require its authenticated staff session")
                if response_name != "AuthenticatedSessionResponse":
                    errors.append("GET /v1/auth/session 200 must publish authenticated safe identity, activation state and permitted choices")
                session_schema = components.get("components", {}).get("schemas", {}).get("AuthenticatedSession", {})
                setup_with_private_choice = {
                    "safeIdentity": {"accountId": "account-01J2W5RFR3K24SFWDX2C0N9VW3", "username": "setup@example.test", "displayName": "Setup user"},
                    "activationState": "awaiting-setup",
                    "accountStatus": "active",
                    "organizations": [{"organizationId": "organization-01J2W5RFR3K24SFWDX2C0N9VW3", "name": "Private organization", "membershipState": "active", "workspaces": []}],
                    "currentOrganizationId": "organization-01J2W5RFR3K24SFWDX2C0N9VW3",
                }
                if not isinstance(session_schema, dict) or not session_schema.get("if") or not session_schema.get("then") or not validate_example(session_schema, setup_with_private_choice, components):
                    errors.append("GET /v1/auth/session setup-only state must conceal private organization/workspace choices")
                unauthenticated = responses.get("401", {})
                unauthenticated_ref = unauthenticated.get("$ref") if isinstance(unauthenticated, dict) else None
                if not isinstance(unauthenticated_ref, str) or not unauthenticated_ref.endswith("/responses/UnauthenticatedLoginCsrf"):
                    errors.append("GET /v1/auth/session 401 must be the login-CSRF bootstrap response")
                login_csrf = components.get("components", {}).get("responses", {}).get("UnauthenticatedLoginCsrf", {})
                csrf_headers = login_csrf.get("headers", {}) if isinstance(login_csrf, dict) else {}
                token_ref = csrf_headers.get("X-Login-CSRF-Token", {}).get("$ref", "") if isinstance(csrf_headers.get("X-Login-CSRF-Token", {}), dict) else ""
                cookie_ref = csrf_headers.get("Set-Cookie", {}).get("$ref", "") if isinstance(csrf_headers.get("Set-Cookie", {}), dict) else ""
                csrf_content = login_csrf.get("content", {}).get("application/problem+json", {}) if isinstance(login_csrf, dict) else {}
                csrf_name, csrf_schema = schema_for(csrf_content.get("schema", {}), components) if isinstance(csrf_content, dict) else (None, None)
                csrf_examples = content_examples(csrf_content, components) if isinstance(csrf_content, dict) else []
                if not (isinstance(token_ref, str) and token_ref.endswith("/headers/LoginCsrfToken") and isinstance(cookie_ref, str) and cookie_ref.endswith("/headers/LoginCsrfSetCookie")):
                    errors.append("GET /v1/auth/session 401 must issue explicit one-time login-CSRF header and bound Set-Cookie contract")
                if csrf_name != "Problem" or not csrf_examples or csrf_schema is None:
                    errors.append("GET /v1/auth/session 401 must include a representative anonymous login-CSRF problem example")
                else:
                    for csrf_example in csrf_examples:
                        example_error = validate_example(csrf_schema, csrf_example, components)
                        if example_error:
                            errors.append(f"GET /v1/auth/session 401 login-CSRF example is invalid: {example_error}")
            for code, response in responses.items():
                if not str(code).startswith("2") or not isinstance(response, dict):
                    continue
                for media_type, media in response.get("content", {}).items():
                    if not isinstance(media, dict):
                        errors.append(f"success response {operation_id} has malformed {media_type} content")
                        continue
                    if media_type == "application/octet-stream":
                        if media.get("schema", {}).get("format") != "binary":
                            errors.append(f"binary response {operation_id} must declare binary body")
                        continue
                    name, schema = schema_for(media.get("schema", {}), components)
                    if name in FORBIDDEN_FALLBACKS or schema is None:
                        errors.append(f"success response {operation_id} must select a concrete component response schema")
                        continue
                    if name != "PublishedSchema" and schema.get("type") == "object" and schema.get("additionalProperties") is not False:
                        errors.append(f"success response {operation_id} schema {name} is permissive")
                    values = content_examples(media, components)
                    if not values:
                        errors.append(f"success response {operation_id} lacks a representative example")
                    for value in values:
                        example_error = validate_example(schema, value, components)
                        if example_error:
                            errors.append(f"success response {operation_id} example is invalid: {example_error}")
    expected_keys = {(member["method"], member["path"], member["id"]) for member in total["members"]}
    actual_keys = {(method, path, op.get("operationId")) for method, path, op in counted}
    if actual_keys != expected_keys:
        errors.append(f"counted O_total mismatch: expected {len(expected_keys)} exact keys, found {len(actual_keys)}")
    categories = {"prd-named": 0, "supporting-crud": 0, "submission-interpretation": 0}
    for _, _, op in counted:
        category = op.get("x-m0-category")
        if category not in categories:
            errors.append(f"counted operation {op.get('operationId')} has invalid M0 category {category!r}")
        else:
            categories[category] += 1
    supporting = [member for member in total["members"] if member["id"] not in named_ids]
    expected_interpretation = [member for member in supporting if member["path"] == "/v1/workspaces/{w}/submissions/{id}/interpretation"]
    if len(supporting) != 29 or len(expected_interpretation) != 1 or categories != {"prd-named": 53, "supporting-crud": 28, "submission-interpretation": 1}:
        errors.append("frozen category split must be 53 PRD-named + 28 supporting CRUD + 1 submission interpretation")
    if len(counted) != 82 or total.get("total") != 82 or len(named_ids) != 53 or named.get("total") != 53:
        errors.append("frozen inventory counts must remain O_named=53 and O_total=82")
    indexed = document.get("x-m0-operation-inventory", {}).get("countedOperationIds")
    if indexed != [member["id"] for member in total["members"]]:
        errors.append("x-m0-operation-inventory must preserve total inventory order and IDs")
    supplemental = [op for _, _, op in ops(document) if op.get("x-m0-counted") is False]
    if len(supplemental) != 1 or supplemental[0].get("operationId") != "M2-get-v1-workspaces-w-assets-assetid-authorized-asset":
        errors.append("authorized asset endpoint must be exactly one uncounted M2 supplemental operation")
    elif "x-m2-endpoint-design" not in supplemental[0] or supplemental[0].get("x-m0-source-id") != "ONS-authorized-asset-api-prd-568-c6c3e1e8e1":
        errors.append("authorized asset supplemental operation lacks its M0 source/rationale")
    elif schema_for(supplemental[0]["responses"]["200"]["content"]["application/json"]["schema"], components)[0] != "AuthorizedAssetResponse":
        errors.append("authorized asset supplement must return AuthorizedAssetResponse")
    for operation in supplemental:
        validate_success_examples(str(operation.get("operationId")), operation.get("responses", {}), components, errors)
    refs = external_refs(document) | external_refs(components)
    referenced_names = {ref.rsplit("/", 1)[-1].split("#", 1)[0] for ref in refs if ".schema.json" in ref}
    if not SCHEMA_FILES.issubset(referenced_names):
        errors.append("OpenAPI components must reference all seven M2 JSON Schema filenames")
    for reference in refs:
        if reference.startswith("#/"):
            try:
                pointer(components, reference)
            except (KeyError, TypeError):
                errors.append(f"unresolvable local component reference {reference}")
        elif ".schema.json" in reference:
            filename = reference.split("#", 1)[0].rsplit("/", 1)[-1]
            if filename not in SCHEMA_FILES or not (COMPONENTS.parent / filename).is_file():
                errors.append(f"unresolvable external schema reference {reference}")
    legacy = load_yaml(LEGACY)
    for method, path, op in ops(legacy):
        if op.get("x-legacy") is not True or op.get("x-m0-counted") is not False:
            errors.append(f"legacy operation {method} {path} must explicitly be x-legacy and uncounted")
        if (method, path, op.get("operationId")) in actual_keys:
            errors.append(f"legacy operation {method} {path} is duplicated as a normative operation")
    if check_generated:
        before_api, before_components = API.read_bytes(), COMPONENTS.read_bytes()
        spec = importlib.util.spec_from_file_location("m2_generator", ROOT / "tools/openapi/generate_openapi.py")
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        module.main()
        if API.read_bytes() != before_api or COMPONENTS.read_bytes() != before_components:
            errors.append("generated OpenAPI files are stale; run python3 tools/openapi/generate_openapi.py")
            API.write_bytes(before_api)
            COMPONENTS.write_bytes(before_components)
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-generated", action="store_true", help="regenerate in-memory-equivalent files and reject byte drift")
    args = parser.parse_args()
    errors = validate(args.check_generated)
    if errors:
        print("OpenAPI validation failed:", file=sys.stderr)
        print("\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    print("OpenAPI validation passed: O_named=53, O_total=82, supplemental=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
