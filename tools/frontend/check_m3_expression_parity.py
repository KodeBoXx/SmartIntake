#!/usr/bin/env python3
"""Fail unless Java and Chromium execute the frozen M3 corpus with exact parity."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
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


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"M3 parity failure: {message}")


def candidate_identity() -> tuple[str, str]:
    return (
        subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=ROOT, text=True).strip(),
    )


def artifact_digest(artifact: dict) -> str:
    payload = dict(artifact)
    payload.pop("artifactSha256", None)
    return hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--java", type=Path, default=JAVA_DEFAULT)
    parser.add_argument("--browser", type=Path, default=BROWSER_DEFAULT)
    args = parser.parse_args()

    source_bytes = SOURCE.read_bytes()
    source = json.loads(source_bytes)
    expected_sha = hashlib.sha256(source_bytes).hexdigest()
    require(expected_sha == PINNED_SOURCE_SHA256, "authoritative expression corpus checksum drift")
    commit, tree = candidate_identity()
    expected_ids = [vector["id"] for vector in source["vectors"]]
    expected_operators = [operator["name"] for operator in source["operators"]]
    expected_by_id = {vector["id"]: normalized(vector["expected"]) for vector in source["vectors"]}

    artifacts = {"java": load(args.java), "browser": load(args.browser)}
    actual_by_runtime: dict[str, dict[str, dict]] = {}
    for runtime, artifact in artifacts.items():
        require(artifact.get("sourceSha256") == expected_sha, f"{runtime} source checksum drift")
        require(artifact.get("candidateCommit") == commit and artifact.get("candidateTree") == tree, f"{runtime} candidate binding")
        require(isinstance(artifact.get("executedAtUtc"), str) and artifact["executedAtUtc"].endswith("Z"), f"{runtime} execution timestamp")
        require(artifact.get("timezoneDatabase") == "IANA-tzdb-2025b-m3-subset-1", f"{runtime} pinned timezone identity")
        require(artifact.get("artifactSha256") == artifact_digest(artifact), f"{runtime} artifact digest")
        require(artifact.get("vectorsDiscovered") == 101, f"{runtime} vector denominator")
        require(artifact.get("operatorsDiscovered") == expected_operators, f"{runtime} operator registry")
        require(artifact.get("passed") == 101 and artifact.get("failed") == 0, f"{runtime} failures")
        require([row["id"] for row in artifact["results"]] == expected_ids, f"{runtime} discovery order")
        actual_by_runtime[runtime] = {
            row["id"]: normalized(row["actual"]) for row in artifact["results"]
        }
        require(actual_by_runtime[runtime] == expected_by_id, f"{runtime} expected-result mismatch")

    require(actual_by_runtime["java"] == actual_by_runtime["browser"], "Java/browser result mismatch")
    print(
        "M3 expression parity passed: Java 101/101, browser 101/101, "
        "exact parity 101/101, operators 34/34."
    )


if __name__ == "__main__":
    main()
