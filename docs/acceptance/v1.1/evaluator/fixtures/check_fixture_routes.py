#!/usr/bin/env python3
"""Shared route and outcome guard for the hand-authored fixture groups.

The PRD only defines a finite operation inventory.  Fixture API actions must use an
O_total verb/path template; a route outside that inventory is allowed only when the
fixture identifies it as a separately source-cited supporting operation.  A journey
whose endpoint is not defined must be represented as a precise manual/UI action,
not a guessed HTTP route.
"""
from __future__ import annotations

import json
import pathlib
import re
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[2]
OPERATIONS = ROOT / "denominators" / "o-total.json"
BROAD_DELIVERY_OUTCOMES = {
    "sent-or-failed-visible",
    "queued-or-sent",
    "provider-accepted-or-failed",
}


def _operation_templates() -> set[tuple[str, str]]:
    document = json.loads(OPERATIONS.read_text(encoding="utf-8"))
    return {(member["method"], member["path"]) for member in document["members"]}


def _matches_template(path: str, template: str) -> bool:
    pattern = re.sub(r"\{[^}]+\}", r"[^/?]+", template)
    return re.fullmatch(pattern, path.split("?", 1)[0]) is not None


def _is_total_operation(method: str, path: str, templates: set[tuple[str, str]]) -> bool:
    return any(method == expected_method and _matches_template(path, expected_path)
               for expected_method, expected_path in templates)


def _supporting_operation_is_cited(node: dict[str, Any]) -> bool:
    citation = node.get("supportingOperation")
    if not isinstance(citation, dict):
        return False
    source = citation.get("sourceCitation")
    return (
        isinstance(source, str)
        and re.fullmatch(r"(?:PRD|AUTH|CONTRACT|PROTO):\d+(?:-\d+)?", source) is not None
        and isinstance(citation.get("reason"), str)
        and bool(citation["reason"].strip())
    )


def check_document(document: Any) -> list[str]:
    """Return route/outcome errors for one fixture-group document."""
    errors: list[str] = []
    templates = _operation_templates()

    def walk(value: Any, pointer: str = "$")->None:
        if isinstance(value, dict):
            method = value.get("method")
            path = value.get("route", value.get("path"))
            if isinstance(method, str) and isinstance(path, str):
                if not _is_total_operation(method, path, templates) and not _supporting_operation_is_cited(value):
                    errors.append(
                        f"{pointer}: {method} {path} is not in O_total and lacks a source-cited supportingOperation"
                    )
            materialization = value.get("materializationState")
            if materialization == "m2-endpoint-unspecified" and value.get("kind") in {"api", "http", "http-concurrent"}:
                errors.append(f"{pointer}: endpoint-unspecified action must be manual/UI, not HTTP")
            for key, child in value.items():
                walk(child, f"{pointer}/{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, f"{pointer}/{index}")
        elif isinstance(value, str) and value in BROAD_DELIVERY_OUTCOMES:
            errors.append(f"{pointer}: contradictory broad delivery outcome {value!r} is forbidden")

    walk(document)
    return errors
