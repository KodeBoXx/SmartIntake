#!/usr/bin/env python3
"""Validate the closed Smart Form Builder Lite 4.0.0 schema corpus.

This tool is deliberately independent of OpenAPI and product runtime code. It
compiles every indexed JSON Schema Draft 2020-12 artifact and verifies that each
checked-in positive fixture passes while its paired negative fixture fails.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker, RefResolver
from jsonschema.exceptions import SchemaError

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_ROOT = ROOT / "docs/contracts/smart-form-builder-lite/4.0.0"
INDEX_PATH = CONTRACT_ROOT / "index.json"

FORMAT_CHECKER = FormatChecker()


@FORMAT_CHECKER.checks("canonical-int64")
def is_canonical_int64(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        number = int(value)
    except ValueError:
        return False
    return -9223372036854775808 <= number <= 9223372036854775807


@FORMAT_CHECKER.checks("canonical-decimal")
def is_canonical_decimal(value: object) -> bool:
    if not isinstance(value, str):
        return False
    digits = value.removeprefix("-").replace(".", "")
    return 1 <= len(digits) <= 34


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Cannot load {path}: {exc}") from exc


def schema_store(index: dict[str, Any]) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    store: dict[str, Any] = {}
    schemas: dict[str, dict[str, Any]] = {}
    for entry in index["schemas"]:
        path = CONTRACT_ROOT / entry["file"]
        schema = load_json(path)
        if schema.get("$id") != entry["id"]:
            raise RuntimeError(f"{path}: $id does not match index")
        store[entry["id"]] = schema
        store[path.resolve().as_uri()] = schema
        schemas[entry["kind"]] = schema
    return store, schemas


def assert_closed_normative_objects(schema: Any, path: str = "$", parent_key: str = "") -> list[str]:
    """Ensure explicitly declared normative object shapes are closed.

    Maps intentionally use additionalProperties for keys defined by identity,
    locale or extension namespace. All named object contracts use
    additionalProperties:false.
    """
    problems: list[str] = []
    if isinstance(schema, dict):
        if schema.get("type") == "object" and "properties" in schema:
            if schema.get("additionalProperties") is not False:
                problems.append(f"{path}: object with named properties is not closed")
        for key, value in schema.items():
            problems.extend(assert_closed_normative_objects(value, f"{path}/{key}", key))
    elif isinstance(schema, list):
        for i, value in enumerate(schema):
            problems.extend(assert_closed_normative_objects(value, f"{path}/{i}", parent_key))
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    index = load_json(INDEX_PATH)
    expected = [
        "package", "expression", "input-answer", "typed-answer",
        "runtime-manifest", "submission-envelope", "event",
    ]
    actual = [entry["kind"] for entry in index.get("schemas", [])]
    failures: list[str] = []
    if index.get("contractVersion") != "4.0.0" or actual != expected:
        failures.append("index must enumerate exactly the seven 4.0.0 schemas in stable order")

    try:
        store, schemas = schema_store(index)
        validators: dict[str, Draft202012Validator] = {}
        for kind, schema in schemas.items():
            Draft202012Validator.check_schema(schema)
            failures.extend(assert_closed_normative_objects(schema))
            resolver = RefResolver.from_schema(schema, store=store)
            validators[kind] = Draft202012Validator(schema, resolver=resolver, format_checker=FORMAT_CHECKER)
    except (RuntimeError, SchemaError) as exc:
        failures.append(str(exc))
        validators = {}

    fixtures = index.get("fixtures", [])
    if [entry.get("schema") for entry in fixtures] != expected:
        failures.append("index must provide one positive and one negative fixture for every schema")
    for entry in fixtures:
        kind = entry["schema"]
        validator = validators.get(kind)
        if validator is None:
            continue
        positive = load_json(CONTRACT_ROOT / entry["positive"])
        negative = load_json(CONTRACT_ROOT / entry["negative"])
        positive_errors = sorted(validator.iter_errors(positive), key=lambda error: list(error.path))
        negative_errors = sorted(validator.iter_errors(negative), key=lambda error: list(error.path))
        if positive_errors:
            failures.append(f"{entry['positive']} should validate: {positive_errors[0].message}")
        if not negative_errors:
            failures.append(f"{entry['negative']} should be rejected")
        if args.verbose:
            print(f"{kind}: positive={'PASS' if not positive_errors else 'FAIL'}, negative={'PASS' if negative_errors else 'FAIL'}")

    if failures:
        print("Schema validation failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("Validated 7 closed Draft 2020-12 schemas and 14 fixtures.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
