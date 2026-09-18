#!/usr/bin/env python3
"""Local structural checker for the hand-authored T01--T07 executable oracles."""
import json
import pathlib
import re
import sys
from copy import deepcopy

from check_fixture_routes import check_document


FILE = pathlib.Path(__file__).with_name("t01-t07.json")
EXPECTED = [f"T{i:02d}" for i in range(1, 8)]
FORBIDDEN = ("evaluator://", "fixture-runner", "opaque perform", "must satisfy", "generic completed")
REVISION_KEYS = {"baseRevision", "currentRevision", "draftRevision", "expectedDraftRevision"}
MAX_REVISION = 2147483647


def fail(errors, text):
    errors.append(text)


def pointer_value(value, pointer):
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise ValueError("pointer must be an RFC6901 absolute pointer")
    current = value
    for token in pointer[1:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        current = current[int(token)] if isinstance(current, list) else current[token]
    return current


def is_revision(value):
    return type(value) is int and 0 <= value <= MAX_REVISION


def is_response_binding(value):
    return isinstance(value, str) and re.fullmatch(r"\$\{[A-Za-z0-9-]+\.[A-Za-z0-9_-]+\}", value) is not None


def body_matches_schema(body, schema, schemas):
    if "$ref" in schema:
        prefix = "#/schemas/"
        ref = schema["$ref"]
        if not ref.startswith(prefix):
            return False
        return body_matches_schema(body, schemas.get(ref[len(prefix):], {}), schemas)
    expected_type = schema.get("type")
    if expected_type == "object":
        if not isinstance(body, dict):
            return False
        if any(key not in body for key in schema.get("required", [])):
            return False
        return all(body_matches_schema(body[key], child, schemas)
                   for key, child in schema.get("properties", {}).items() if key in body)
    if expected_type == "array":
        return isinstance(body, list) and len(body) >= schema.get("minItems", 0)
    if expected_type == "integer":
        return is_revision(body) and body >= schema.get("minimum", 0) and body <= schema.get("maximum", MAX_REVISION)
    if expected_type == "string":
        return isinstance(body, str) and len(body) >= schema.get("minLength", 0)
    return False


def action_by_order(case, order):
    return next((item for item in case.get("actions", []) if item.get("order") == order), None)


def revision_locations(value, pointer=""):
    if isinstance(value, dict):
        for key, child in value.items():
            child_pointer = f"{pointer}/{key}"
            if key in REVISION_KEYS:
                yield child_pointer, key, child
            yield from revision_locations(child, child_pointer)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from revision_locations(child, f"{pointer}/{index}")


def verify_revision_semantics(document, errors):
    schemas = document.get("schemas", {})
    if not body_matches_schema(0, schemas.get("revisionInteger", {}), schemas):
        fail(errors, "revisionInteger schema does not accept bounded JSON integer zero")
    if body_matches_schema("1", schemas.get("revisionInteger", {}), schemas):
        fail(errors, "revisionInteger schema accepts a string")
    for fixture in document.get("fixtures", []):
        for case in fixture.get("cases", []):
            actions = case.get("actions", [])
            for action in actions:
                body = action.get("body")
                if action.get("kind") == "api" and action.get("method") == "PATCH" and "bodyRef" in action:
                    materialization = action.get("bodyMaterialization", {})
                    schema_name = materialization.get("schemaRef", "").removeprefix("#/schemas/")
                    if (not is_revision(materialization.get("frozenRevision"))
                            or materialization.get("revisionJsonPointer") != "/baseRevision"
                            or materialization.get("beforeDispatch") is not True
                            or materialization.get("validationMode") != "full-request-body"
                            or schema_name != "sessionPatchBody"):
                        fail(errors, f"{case.get('id')}/{action.get('order')}: referenced PATCH body lacks bounded revision materialization")
                    prior_patch = next((previous for previous in reversed(actions[:action["order"] - 1])
                                        if previous.get("kind") == "api" and previous.get("method") == "PATCH"
                                        and previous.get("route") == action.get("route")), None)
                    bindings = action.get("materializationBindings", [])
                    if prior_patch:
                        binding = bindings[0] if len(bindings) == 1 else {}
                        source = action_by_order(case, binding.get("sourceActionOrder"))
                        source_revision = (source or {}).get("responseContract", {}).get("exactValues", {}).get("currentRevision")
                        if (binding.get("sourceResponseJsonPointer") != "/currentRevision"
                                or binding.get("targetBodyJsonPointer") != "/baseRevision"
                                or binding.get("integerSchema") != {"type": "integer", "minimum": 0, "maximum": MAX_REVISION}
                                or source is not prior_patch
                                or not is_revision(source_revision)
                                or source_revision != materialization.get("frozenRevision")):
                            fail(errors, f"{case.get('id')}/{action.get('order')}: referenced PATCH lacks typed prior-response revision binding")
                if not isinstance(body, dict):
                    continue
                revision_keys = REVISION_KEYS.intersection(body)
                for pointer, key, value in revision_locations(body):
                    if pointer != f"/{key}":
                        fail(errors, f"{case.get('id')}/{action.get('order')}: {key} must be a top-level request revision")
                    if is_response_binding(value):
                        continue
                    if not is_revision(value):
                        fail(errors, f"{case.get('id')}/{action.get('order')}: {key} must be a bounded JSON integer")
                if not revision_keys:
                    continue
                if any(is_response_binding(value) for _, _, value in revision_locations(body)):
                    # Lifecycle revisions are materialized from an earlier typed
                    # response and validated by the global lifecycle guard.
                    continue
                validation = action.get("resolvedBodyValidation", {})
                schema_ref = validation.get("schemaRef", "")
                schema_name = schema_ref.removeprefix("#/schemas/")
                if (validation.get("beforeDispatch") is not True
                        or validation.get("validationMode") != "full-request-body"
                        or schema_name not in schemas
                        or not body_matches_schema(body, schemas.get(schema_name, {}), schemas)):
                    fail(errors, f"{case.get('id')}/{action.get('order')}: revision body lacks valid pre-dispatch schema validation")
                bindings = action.get("materializationBindings", [])
                prior_patch = next((previous for previous in reversed(actions[:action["order"] - 1])
                                    if previous.get("kind") == "api" and previous.get("method") == "PATCH"
                                    and previous.get("route") == action.get("route")), None)
                if prior_patch and "baseRevision" in revision_keys and not bindings:
                    fail(errors, f"{case.get('id')}/{action.get('order')}: sequential PATCH must bind baseRevision from the prior response")
                for binding in bindings:
                    source = action_by_order(case, binding.get("sourceActionOrder"))
                    try:
                        target_value = pointer_value(body, binding.get("targetBodyJsonPointer"))
                    except (KeyError, ValueError, TypeError, IndexError):
                        fail(errors, f"{case.get('id')}/{action.get('order')}: materialization target pointer is invalid")
                        continue
                    integer_schema = binding.get("integerSchema", {})
                    if (binding.get("targetBodyJsonPointer") != "/baseRevision"
                            or not is_revision(target_value)
                            or integer_schema != {"type": "integer", "minimum": 0, "maximum": MAX_REVISION}):
                        fail(errors, f"{case.get('id')}/{action.get('order')}: materialization target/schema is not a bounded integer revision")
                    if not source or source.get("order", 0) >= action.get("order", 0):
                        fail(errors, f"{case.get('id')}/{action.get('order')}: materialization source must be an earlier action")
                        continue
                    response = source.get("responseContract", {})
                    try:
                        source_value = response.get("exactValues", {})[binding.get("sourceResponseJsonPointer", "").removeprefix("/")]
                        source_schema = response.get("schema", {}).get("properties", {})[binding.get("sourceResponseJsonPointer", "").removeprefix("/")]
                    except KeyError:
                        source_value, source_schema = None, None
                    if (binding.get("sourceResponseJsonPointer") != "/currentRevision"
                            or not is_revision(source_value)
                            or source_value != target_value
                            or source_schema != integer_schema):
                        fail(errors, f"{case.get('id')}/{action.get('order')}: materialization source is not an exact typed currentRevision")


def run_revision_negatives(document, errors):
    """Prove the revision guard rejects the failure modes this fixture previously encoded."""
    def expect_rejected(label, mutate):
        candidate = deepcopy(document)
        mutate(candidate)
        candidate_errors = []
        verify_revision_semantics(candidate, candidate_errors)
        if not candidate_errors:
            fail(errors, f"revision negative did not fail: {label}")

    def locate(candidate, fixture_id, case_id, order):
        fixture = next(item for item in candidate["fixtures"] if item["id"] == fixture_id)
        case = next(item for item in fixture["cases"] if item["id"] == case_id)
        return action_by_order(case, order)

    expect_rejected("string baseRevision", lambda candidate: locate(
        candidate, "T06", "T06-01-three-level-add-and-nested-row-paths", 1)["body"].__setitem__("baseRevision", "r1"))
    expect_rejected("missing response binding", lambda candidate: locate(
        candidate, "T06", "T06-01-three-level-add-and-nested-row-paths", 2).pop("materializationBindings"))
    expect_rejected("missing pre-dispatch validation", lambda candidate: locate(
        candidate, "T06", "T06-02-add-delete-reorder-fifty-without-identity-drift", 2)["resolvedBodyValidation"].__setitem__("beforeDispatch", False))
    expect_rejected("wrong binding target", lambda candidate: locate(
        candidate, "T06", "T06-01-three-level-add-and-nested-row-paths", 3)["materializationBindings"][0].__setitem__("targetBodyJsonPointer", "/currentRevision"))
    expect_rejected("direct PATCH revision string", lambda candidate: locate(
        candidate, "T06", "T06-02-add-delete-reorder-fifty-without-identity-drift", 1)["body"].__setitem__("baseRevision", "after-50"))
    expect_rejected("referenced PATCH missing prior-response binding", lambda candidate: locate(
        candidate, "T06", "T06-03-fixed-dynamic-matrices-and-empty-unknown-aggregates", 3).pop("materializationBindings"))


def main():
    document = json.loads(FILE.read_text(encoding="utf-8"))
    errors = check_document(document)
    fixtures = document.get("fixtures")
    if [item.get("id") for item in fixtures or []] != EXPECTED:
        fail(errors, "fixture IDs must be exactly T01 through T07 in order")
    if document.get("executionStatus") != "frozen-not-run":
        fail(errors, "oracle must remain a frozen not-run specification")
    case_count = 0
    for fixture in fixtures or []:
        name = fixture.get("id", "unknown")
        if not fixture.get("requirements") or not fixture.get("sourceRows") or not fixture.get("preState"):
            fail(errors, f"{name}: missing requirement, source, or named pre-state")
        for case in fixture.get("cases", []):
            case_count += 1
            rendered = json.dumps(case, sort_keys=True).lower()
            if any(token in rendered for token in FORBIDDEN):
                fail(errors, f"{case.get('id')}: forbidden generic runner or predicate")
            actions = case.get("actions", [])
            if len(actions) < 3 or [a.get("order") for a in actions] != list(range(1, len(actions) + 1)):
                fail(errors, f"{case.get('id')}: actions must be ordered and finite")
            if not case.get("expected") or not case.get("evidence"):
                fail(errors, f"{case.get('id')}: missing outcome or evidence")
            for action in actions:
                if action.get("kind") == "api":
                    if action.get("method") not in {"GET", "POST", "PUT", "PATCH", "DELETE"} or not str(action.get("route", "")).startswith("/v1/"):
                        fail(errors, f"{case.get('id')}: API action lacks a normative route")
                    expected = action.get("expect", {})
                    if not isinstance(expected.get("httpStatus"), int) or not expected.get("state"):
                        fail(errors, f"{case.get('id')}: API action lacks exact status/state")
                elif action.get("kind") == "manual":
                    if not all(key in action for key in ("surface", "control", "input", "expect")):
                        fail(errors, f"{case.get('id')}: manual action lacks surface/control/input/expectation")
                else:
                    fail(errors, f"{case.get('id')}: action kind is not api or manual")
    verify_revision_semantics(document, errors)
    run_revision_negatives(document, errors)
    if case_count < 20:
        fail(errors, "meaningful finite coverage requires at least 20 cases")
    if errors:
        print("FAIL " + "; ".join(errors))
        return 1
    print(f"PASS {len(fixtures)} fixtures; {case_count} hand-authored executable cases")
    return 0


if __name__ == "__main__":
    sys.exit(main())
