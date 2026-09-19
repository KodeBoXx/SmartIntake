#!/usr/bin/env python3
"""Validate the closed Smart Form Builder Lite 4.0.0 schema corpus.

This tool is deliberately independent of OpenAPI and product runtime code. It
compiles every indexed JSON Schema Draft 2020-12 artifact and verifies that each
checked-in positive fixture passes while its paired negative fixture fails.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
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
    return bool(re.fullmatch(r"(?:0|[1-9][0-9]*(?:\.[0-9]*[1-9])?|-[1-9][0-9]*(?:\.[0-9]*[1-9])?|-0\.[0-9]*[1-9])", value)) and decimal_is_bounded(value)


@FORMAT_CHECKER.checks("stored-decimal")
def is_stored_decimal(value: object) -> bool:
    """Destination values retain declared scale, unlike expression results."""
    if not isinstance(value, str):
        return False
    return bool(re.fullmatch(r"(?:0(?:\.[0-9]+)?|[1-9][0-9]*(?:\.[0-9]+)?|-[1-9][0-9]*(?:\.[0-9]+)?|-0\.[0-9]*[1-9][0-9]*)", value)) and decimal_is_bounded(value)


@FORMAT_CHECKER.checks("expression-decimal-input")
def is_expression_decimal_input(value: object) -> bool:
    """Expression literals may declare negative zero; evaluation normalizes it."""
    if not isinstance(value, str):
        return False
    return bool(re.fullmatch(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?", value)) and decimal_is_bounded(value)


def decimal_is_bounded(value: str) -> bool:
    """Validate the exact decimal coefficient and adjusted-exponent bounds.

    Precision removes insignificant leading and trailing coefficient zeros, so
    expanded exact powers of ten do not consume one significant digit per zero.
    The adjusted exponent is calculated from the wire digits, never a binary
    float. Zero has neither a precision nor an exponent-bound failure.
    """
    unsigned = value.removeprefix("-")
    integer, _, fraction = unsigned.partition(".")
    coefficient = (integer + fraction).lstrip("0")
    if not coefficient:
        return True
    if len(coefficient.rstrip("0")) > 34:
        return False
    integer_without_leading_zeroes = integer.lstrip("0")
    if integer_without_leading_zeroes:
        adjusted_exponent = len(integer_without_leading_zeroes) - 1
    else:
        adjusted_exponent = -(len(fraction) - len(fraction.lstrip("0")) + 1)
    return -6143 <= adjusted_exponent <= 6144


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


def extension_binding_errors(package: dict[str, Any]) -> list[str]:
    """Apply the package compiler rule that JSON Schema cannot cross-reference.

    An extension value is a closed descriptor, but JSON Schema cannot compare its
    id/version/digest to another array item. Treat a mismatch as a compilation
    rejection here, so the source contract has no unbounded extension escape.
    """
    registered = {
        (entry["id"], entry["version"], entry["digest"])
        for entry in package.get("dependencies", [])
        if entry.get("kind") == "extension"
    }
    failures: list[str] = []

    def walk(value: Any, path: str) -> None:
        if isinstance(value, dict):
            if "extensions" in value:
                for namespace, descriptor in value["extensions"].items():
                    binding = tuple(descriptor.get(key) for key in ("dependencyId", "version", "digest"))
                    if binding not in registered:
                        failures.append(f"{path}/extensions/{namespace}: unregistered extension dependency")
            for key, child in value.items():
                if key != "extensions":
                    walk(child, f"{path}/{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, f"{path}/{index}")

    walk(package, "$")
    return failures


def validate_authoritative_expression_vectors(validator: Draft202012Validator) -> list[str]:
    fixture_path = CONTRACT_ROOT / "fixtures/expression-authoritative-vectors.json"
    fixture = load_json(fixture_path)
    source_path = ROOT / fixture["source"]
    expected_hash = fixture["sourceSha256"]
    actual_hash = "sha256:" + hashlib.sha256(source_path.read_bytes()).hexdigest()
    failures: list[str] = []
    if actual_hash != expected_hash:
        return [f"{fixture_path}: source hash does not match authoritative expression contract"]
    source_vector_list = load_json(source_path)["vectors"]
    source_vectors = {vector["id"]: vector for vector in source_vector_list}
    if [vector["id"] for vector in fixture["vectors"]] != [vector["id"] for vector in source_vector_list]:
        failures.append(f"{fixture_path}: must freeze every authoritative vector in source order")
    for vector in fixture["vectors"]:
        source = source_vectors.get(vector["id"])
        if source is None or source.get("expression") != vector["expression"]:
            failures.append(f"{fixture_path}: {vector['id']} is not frozen from the authoritative source")
            continue
        errors = list(validator.iter_errors(vector["expression"]))
        if bool(errors) == vector["schemaValid"]:
            expectation = "validate" if vector["schemaValid"] else "be rejected"
            failures.append(f"{fixture_path}: {vector['id']} should {expectation}")
    return failures


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
        if kind == "package" and not positive_errors:
            failures.extend(extension_binding_errors(positive))
        if not negative_errors:
            failures.append(f"{entry['negative']} should be rejected")
        if args.verbose:
            print(f"{kind}: positive={'PASS' if not positive_errors else 'FAIL'}, negative={'PASS' if negative_errors else 'FAIL'}")

    supplemental = [
        ("package", "fixtures/package-prd-minimal.positive.json", True),
        ("package", "fixtures/package-prd-inline-minimal.positive.json", True),
        ("package", "fixtures/package-prd-rich.positive.json", True),
        ("package", "fixtures/package-extension-binding.negative.json", False),
        ("typed-answer", "fixtures/typed-answer-decimal-storage.positive.json", True),
        ("typed-answer", "fixtures/typed-answer-decimal-storage.negative.json", False),
        ("event", "fixtures/event-submission-deleted.positive.json", True),
        ("event", "fixtures/event-submission-deleted.negative.json", False),
        ("event", "fixtures/event-submission-created-reference.positive.json", True),
        ("event", "fixtures/event-submission-created-reference.negative.json", False),
    ]
    for kind, path, should_validate in supplemental:
        validator = validators.get(kind)
        if validator is None:
            continue
        value = load_json(CONTRACT_ROOT / path)
        errors = list(validator.iter_errors(value))
        if kind == "package" and not errors:
            errors = extension_binding_errors(value)
        if (not errors) != should_validate:
            expectation = "validate" if should_validate else "be rejected"
            failures.append(f"{path} should {expectation}")
        if args.verbose:
            print(f"{path}: {'PASS' if (not errors) == should_validate else 'FAIL'}")
    if validators.get("expression"):
        failures.extend(validate_authoritative_expression_vectors(validators["expression"]))
        decimal_fixture = load_json(CONTRACT_ROOT / "fixtures/expression-result-decimal.json")
        result_validator = Draft202012Validator(
            schemas["expression"]["$defs"]["decimalResult"], format_checker=FORMAT_CHECKER
        )
        if list(result_validator.iter_errors(decimal_fixture["valid"])):
            failures.append("expression result decimal fixture should accept canonical 12.5")
        if not list(result_validator.iter_errors(decimal_fixture["invalid"])):
            failures.append("expression result decimal fixture should reject scale-preserving 12.50")
        decimal_formats = load_json(CONTRACT_ROOT / "fixtures/decimal-formats.json")
        decimal_definitions = {
            "stored": schemas["typed-answer"]["$defs"]["decimalStorage"],
            "expressionInput": schemas["expression"]["$defs"]["expressionDecimalInput"],
            "expressionResult": schemas["expression"]["$defs"]["decimalResult"],
        }
        for name, definition in decimal_definitions.items():
            decimal_validator = Draft202012Validator(definition, format_checker=FORMAT_CHECKER)
            for value in decimal_formats[name]["valid"]:
                if list(decimal_validator.iter_errors(value)):
                    failures.append(f"decimal {name} should accept {value!r}")
            for value in decimal_formats[name]["invalid"]:
                if not list(decimal_validator.iter_errors(value)):
                    failures.append(f"decimal {name} should reject {value!r}")
        timezone_fixture = load_json(CONTRACT_ROOT / "fixtures/timezone-utc.json")
        for kind, schema in schemas.items():
            date_time_validator = Draft202012Validator(
                {"$ref": "#/$defs/dateTime", "$defs": schema["$defs"]}, format_checker=FORMAT_CHECKER
            )
            for time_zone in (timezone_fixture["valid"], timezone_fixture["alsoValid"]):
                if list(date_time_validator.iter_errors({"instant": "2026-09-05T10:00:00Z", "timeZone": time_zone})):
                    failures.append(f"{kind} dateTime should accept time zone {time_zone!r}")
            if not list(date_time_validator.iter_errors({"instant": "2026-09-05T10:00:00Z", "timeZone": timezone_fixture["invalid"]})):
                failures.append(f"{kind} dateTime should reject a non-IANA time zone")
        if schemas["package"].get("x-controlCompatibility", {}).get("shortText") != ["text"]:
            failures.append("package shortText control must declare text compatibility")
        event_coverage = load_json(CONTRACT_ROOT / "fixtures/event-type-coverage.positive.json")
        for event in event_coverage:
            if list(validators["event"].iter_errors(event)):
                failures.append(f"event type coverage should validate {event['type']}")

    if failures:
        print("Schema validation failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("Validated 7 closed Draft 2020-12 schemas, primary fixtures, PRD package examples, and frozen expression vectors.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
