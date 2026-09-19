#!/usr/bin/env python3
"""Fail unless Java and Chromium execute the frozen M3 corpus with exact parity."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/source-handoff/smart-form-builder-lite-prd-v1.1/expression-contract.json"
JAVA_DEFAULT = ROOT / "backend/target/m3-expression-vectors.json"
BROWSER_DEFAULT = ROOT / "frontend/test-results/m3-expression-vectors.json"
RESULT_KEYS = ("state", "type", "value", "reason", "code")
PINNED_SOURCE_SHA256 = "6fd9cd69b123418209b9ae21d1b7a76af2a7ceb76689f2aad0fbe261d2a00aa7"


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def normalized(result: dict) -> dict:
    return {key: result[key] for key in RESULT_KEYS if key in result and result[key] is not None}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--java", type=Path, default=JAVA_DEFAULT)
    parser.add_argument("--browser", type=Path, default=BROWSER_DEFAULT)
    args = parser.parse_args()

    source_bytes = SOURCE.read_bytes()
    source = json.loads(source_bytes)
    expected_sha = hashlib.sha256(source_bytes).hexdigest()
    assert expected_sha == PINNED_SOURCE_SHA256, "authoritative expression corpus checksum drift"
    expected_ids = [vector["id"] for vector in source["vectors"]]
    expected_operators = [operator["name"] for operator in source["operators"]]
    expected_by_id = {vector["id"]: normalized(vector["expected"]) for vector in source["vectors"]}

    artifacts = {"java": load(args.java), "browser": load(args.browser)}
    actual_by_runtime: dict[str, dict[str, dict]] = {}
    for runtime, artifact in artifacts.items():
        assert artifact["sourceSha256"] == expected_sha, f"{runtime} source checksum drift"
        assert artifact["vectorsDiscovered"] == 101, f"{runtime} vector denominator"
        assert artifact["operatorsDiscovered"] == expected_operators, f"{runtime} operator registry"
        assert artifact["passed"] == 101 and artifact["failed"] == 0, f"{runtime} failures"
        assert [row["id"] for row in artifact["results"]] == expected_ids, f"{runtime} discovery order"
        actual_by_runtime[runtime] = {
            row["id"]: normalized(row["actual"]) for row in artifact["results"]
        }
        assert actual_by_runtime[runtime] == expected_by_id, f"{runtime} expected-result mismatch"

    assert actual_by_runtime["java"] == actual_by_runtime["browser"], "Java/browser result mismatch"
    print(
        "M3 expression parity passed: Java 101/101, browser 101/101, "
        "exact parity 101/101, operators 34/34."
    )


if __name__ == "__main__":
    main()
