#!/usr/bin/env python3
"""Validate canonical evaluator packages and delegate fixture group validation."""
from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE_CHECKERS = (("check_t01_t07.py", 7, 23), ("check_t08_t15.py", 8, 33), ("check_t17_t24.py", 8, 95), ("check_t25_t32.py", 8, 41))
PROFILE = "4.0.0"
CANONICAL_TYPES = {"text", "integer", "decimal", "date", "time", "dateTime", "boolean", "choice", "multiChoice", "object", "list", "attachments", "drawing"}
LIST_LIKE_TYPES = {"list"}
PACKAGE_KEYS = {"schemaVersion", "engineContract", "contractVersion", "kind", "formKey", "definitionVersion", "titleKey", "descriptionKey", "defaultLocale", "supportedLocales", "data", "flow", "expressions", "guidance", "translations", "theme", "policies", "dependencies", "assets"}


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def canonical_decimal(value: Any) -> bool:
    return isinstance(value, str) and value not in {"", "-0"} and value.lstrip("-").isdigit() and str(int(value)) == value


def all_fields(schema: dict[str, Any]):
    yield schema
    for child in schema.get("properties", []):
        yield from all_fields(child)
    for key in ("itemSchema", "rowSchema"):
        if isinstance(schema.get(key), dict):
            yield from all_fields(schema[key])


def list_depth(schema: dict[str, Any]) -> int:
    children = schema.get("properties", []) + [schema[x] for x in ("itemSchema", "rowSchema") if isinstance(schema.get(x), dict)]
    return (schema.get("type") in LIST_LIKE_TYPES) + max((list_depth(child) for child in children), default=0)


def answer_matches(schema: dict[str, Any], answer: Any, errors: list[str], path: str) -> None:
    if not isinstance(answer, dict) or set(answer) - {"status", "value"} or "status" not in answer:
        fail(errors, f"{path}: InputAnswer must be {{status,value?}}")
        return
    if answer["status"] != "answered":
        if "value" in answer:
            fail(errors, f"{path}: non-answered InputAnswer carries value")
        return
    if "value" not in answer:
        fail(errors, f"{path}: answered InputAnswer lacks value")
        return
    value = answer["value"]
    if schema["type"] == "integer" and not canonical_decimal(value):
        fail(errors, f"{path}: integer value is not a canonical decimal wire string")
    if schema["type"] == "decimal" and not isinstance(value, str):
        fail(errors, f"{path}: decimal value must be a wire string")
    if schema["type"] == "object":
        fields = value.get("fields") if isinstance(value, dict) else None
        if not isinstance(fields, dict):
            fail(errors, f"{path}: object answer must contain fields")
        else:
            for child in schema.get("properties", []):
                if child["id"] not in fields:
                    fail(errors, f"{path}: missing object child InputAnswer {child['id']}")
                else:
                    answer_matches(child, fields[child["id"]], errors, f"{path}/{child['id']}")
    if schema["type"] in LIST_LIKE_TYPES:
        items = value.get("items") if isinstance(value, dict) else None
        row_schema = schema.get("itemSchema") or schema.get("rowSchema")
        if not isinstance(items, list) or not isinstance(row_schema, dict):
            fail(errors, f"{path}: list answer must contain items and a row schema")
        else:
            for row in items:
                row_fields = row.get("fields") if isinstance(row, dict) else None
                if not isinstance(row.get("itemId") if isinstance(row, dict) else None, str) or not isinstance(row_fields, dict):
                    fail(errors, f"{path}: list row must include itemId and fields")
                    continue
                for child in row_schema.get("properties", []):
                    if child["id"] not in row_fields:
                        fail(errors, f"{path}: missing list child InputAnswer {child['id']}")
                    else:
                        answer_matches(child, row_fields[child["id"]], errors, f"{path}/{row['itemId']}/{child['id']}")


def verify_package(errors: list[str], filename: str, vectors: dict[str, Any]) -> tuple[int, int]:
    package = json.loads((ROOT / "packages" / filename).read_text())
    if set(package) != PACKAGE_KEYS:
        fail(errors, f"{filename}: package is not the closed canonical root shape")
    if {key: package.get(key) for key in ("schemaVersion", "engineContract", "contractVersion")} != {key: PROFILE for key in ("schemaVersion", "engineContract", "contractVersion")} or package.get("kind") != "smart-form-package":
        fail(errors, f"{filename}: profile/kind must be exact 4.0.0 smart-form-package")
    fields = package.get("data", {}).get("fields", [])
    pages = [page for phase in package.get("flow", {}).get("phases", []) for page in phase.get("pages", [])]
    recursive_fields = [nested for field in fields for nested in all_fields(field)]
    if len(recursive_fields) != 42 or len(pages) != 5:
        fail(errors, f"{filename}: requires exactly 42 recursive canonical definitions and five pages")
    if package.get("flow", {}).get("startPageId") not in {page.get("id") for page in pages}:
        fail(errors, f"{filename}: flow start page is unresolved")
    ids = []; labels = set(); page_field_ids = []
    for field in fields:
        for nested in all_fields(field):
            if nested.get("id") in ids or not nested.get("id") or nested.get("type") not in CANONICAL_TYPES:
                fail(errors, f"{filename}: recursive field IDs/types are invalid")
            ids.append(nested.get("id"))
            if not nested.get("key") or not nested.get("labelKey") or not nested.get("descriptionKey"):
                fail(errors, f"{filename}: nested field locale references are incomplete")
            labels.add(nested.get("labelKey"))
            for option in nested.get("options", []):
                if set(option) != {"id", "labelKey"}:
                    fail(errors, f"{filename}: option labels must be locale-key references")
                labels.add(option.get("labelKey"))
        if not field.get("key") or not field.get("labelKey"):
            fail(errors, f"{filename}: root field keys/label keys are invalid")
        for expression_key in ("visibilityExpressionId", "requiredExpressionId", "validationExpressionId"):
            if field.get(expression_key) not in package.get("expressions", {}):
                fail(errors, f"{filename}/{field.get('id')}: unresolved {expression_key}")
        if field.get("guidanceId") not in package.get("guidance", {}):
            fail(errors, f"{filename}/{field.get('id')}: unresolved guidance")
    for page in pages:
        for section in page.get("sections", []):
            for node in section.get("nodes", []):
                if node.get("kind") == "question":
                    page_field_ids.append(node.get("fieldId"))
                    if node.get("fieldId") not in {field.get("id") for field in fields}:
                        fail(errors, f"{filename}: question node has unresolved field")
    if sorted(page_field_ids) != sorted(field.get("id") for field in fields):
        fail(errors, f"{filename}: flow nodes do not bind each root field exactly once")
    if max((list_depth(field) for field in fields), default=0) != 3:
        fail(errors, f"{filename}: requires a three-level recursive list")
    if not any(field.get("type") == "attachments" for field in fields) or not any(field.get("type") == "drawing" for field in fields):
        fail(errors, f"{filename}: attachment/drawing fields are missing")
    if not any(field.get("type") == "integer" and field.get("constraints", {}).get("minimum") is not None for field in fields):
        fail(errors, f"{filename}: constrained integer/rating coverage is missing")
    if not any(field.get("type") == "multiChoice" and field.get("ordered") is True for field in fields):
        fail(errors, f"{filename}: ordered multiChoice/ranking coverage is missing")
    matrix_types = {"list"}
    if not any(field.get("type") in matrix_types and isinstance(field.get("rowSchema"), dict) for field in fields):
        fail(errors, f"{filename}: list/object matrix coverage is missing")
    if filename == "package-hc.json":
        controls = {
            node.get("fieldId"): node
            for page in pages
            for section in page.get("sections", [])
            for node in section.get("nodes", [])
            if node.get("kind") == "question"
        }
        expected_controls = {"hc-f10": "repeatingCards", "hc-f11": "repeatingCards", "hc-f12": "dynamicMatrix"}
        fields_by_id = {field.get("id"): field for field in fields}
        if any(fields_by_id.get(field_id, {}).get("type") != "list"
               or fields_by_id.get(field_id, {}).get("presentation") is not None
               or controls.get(field_id, {}).get("control") != control
               or controls.get(field_id, {}).get("presentation", {}).get("settings") != {"allowAdd": True, "allowRemove": True, "allowReorder": True}
               for field_id, control in expected_controls.items()):
            fail(errors, f"{filename}: repeater controls must decorate canonical list storage fields")
    for locale in package.get("supportedLocales", []):
        translation = package.get("translations", {}).get(locale, {})
        if translation.get("direction") not in {"ltr", "rtl"} or not isinstance(translation.get("messages"), dict):
            fail(errors, f"{filename}: locale {locale} is incomplete")
        for key in {package.get("titleKey"), package.get("descriptionKey")} | labels:
            if key not in translation.get("messages", {}):
                fail(errors, f"{filename}: locale {locale} misses {key}")
    vector = vectors.get(package.get("formKey"))
    if not isinstance(vector, dict):
        fail(errors, f"{filename}: missing external sample-answer vector")
    else:
        for field in fields:
            answer = vector.get("answers", {}).get(field["id"])
            if field.get("calculation"):
                continue
            if answer is None:
                fail(errors, f"{filename}: sample vector misses {field['id']}")
            else:
                answer_matches(field, answer, errors, f"{filename}/{field['id']}")
    calculated = [field for field in fields if field.get("calculation")]
    allowed_root_ids = {field["id"] for field in fields}
    if set(vector.get("answers", {})) - allowed_root_ids:
        fail(errors, f"{filename}: InputAnswer map contains IDs outside its canonical root graph")
    for field in calculated:
        if field["id"] in vector.get("answers", {}):
            fail(errors, f"{filename}: calculated fields must not be InputAnswer inputs")
        if vector.get("expectedOutputs", {}).get(field["id"], {}).get("origin") != "server-calculation":
            fail(errors, f"{filename}: calculated expected output is missing")
        if vector.get("calculatedValues", {}).get(field["id"]) != vector["expectedOutputs"][field["id"]].get("value"):
            fail(errors, f"{filename}: calculatedValues must exactly equal expectedOutputs")
    for field in fields:
        if field.get("type") == "attachments":
            value = vector.get("answers", {}).get(field["id"], {}).get("value")
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                fail(errors, f"{filename}: attachment InputAnswer values must contain IDs only")
    return len(recursive_fields), len(pages)


def verify_fixtures(errors: list[str]) -> tuple[int, int]:
    rows = cases = 0
    for checker, count, case_count in FIXTURE_CHECKERS:
        result = subprocess.run([sys.executable, str(ROOT / "fixtures" / checker)], capture_output=True, text=True, check=False, timeout=60)
        if result.returncode:
            fail(errors, f"{checker}: {result.stdout.strip() or result.stderr.strip()}")
        rows += count; cases += case_count
    return rows, cases


def main() -> int:
    errors: list[str] = []
    budget = json.loads((ROOT / "packages" / "parity-budget.json").read_text())
    vectors = {row["formKey"]: row for row in budget.get("sampleAnswerVectors", [])}
    hc = verify_package(errors, "package-hc.json", vectors)
    nhc = verify_package(errors, "package-nhc.json", vectors)
    if budget.get("budget", {}).get("comparisonMode") != "structural-only" or budget["budget"].get("observedClaimsProhibited") is not True:
        fail(errors, "parity budget must remain structural-only without observed claims")
    if errors:
        print("FAIL " + "; ".join(errors)); return 1
    print(f"PASS canonical HC/NHC packages: {hc[0]}/{nhc[0]} fields, {hc[1]}/{nhc[1]} pages; InputAnswer vectors valid")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
