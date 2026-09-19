#!/usr/bin/env python3
"""Fail unless Java and Chromium execute the frozen M3 corpus with exact parity."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/source-handoff/smart-form-builder-lite-prd-v1.1/expression-contract.json"
JAVA_DEFAULT = ROOT / "backend/target/m3-expression-vectors.json"
BROWSER_DEFAULT = ROOT / "frontend/test-results/m3-expression-vectors.json"
RESULT_KEYS = ("state", "type", "value", "reason", "code")
POINTER_KEYS = ("expressionPointer", "fieldPointer", "itemPointer")
PINNED_SOURCE_SHA256 = "6fd9cd69b123418209b9ae21d1b7a76af2a7ceb76689f2aad0fbe261d2a00aa7"
TIMEZONE_REGISTRY = ROOT / "backend/src/main/resources/contracts/m3-timezone-registry.json"


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def normalized(result: dict) -> dict:
    return {key: result[key] for key in RESULT_KEYS if key in result and result[key] is not None}


def diagnostic_pointers(actual: dict, expected: dict, runtime: str, vector_id: str) -> None:
    """Validate safe diagnostic locations without making absent legacy pointers pass as values."""
    for key in POINTER_KEYS:
        value = actual.get(key)
        if value is not None:
            require(isinstance(value, str) and value.startswith("/"), f"{runtime} {vector_id} {key}")
        if key in expected:
            require(value == expected[key], f"{runtime} {vector_id} {key}")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"M3 parity failure: {message}")


def candidate_identity() -> tuple[str, str]:
    return (
        subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=ROOT, text=True).strip(),
    )


def require_clean_candidate() -> None:
    status = subprocess.check_output(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"], cwd=ROOT, text=True
    ).splitlines()
    unexpected = [line for line in status if not line[3:].startswith("frontend/test-results/")]
    require(not unexpected, f"candidate worktree is not clean: {unexpected}")


def artifact_digest(artifact: dict) -> str:
    payload = dict(artifact)
    payload.pop("artifactSha256", None)
    return hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()


def worktree_bytes_sha256() -> str:
    paths = subprocess.check_output(
        ["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=ROOT
    ).decode().split("\0")
    digest = hashlib.sha256()
    for relative in sorted(path for path in paths if path and not path.startswith("frontend/test-results/")):
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update((ROOT / relative).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def timestamp(value: object, runtime: str) -> None:
    require(isinstance(value, str) and value.endswith("Z"), f"{runtime} execution timestamp")
    try:
        parsed = dt.datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
    except ValueError:
        require(False, f"{runtime} execution timestamp")
    require(parsed.tzinfo == dt.timezone.utc, f"{runtime} execution timestamp")


def timezone_registry() -> tuple[str, str]:
    registry = load(TIMEZONE_REGISTRY)
    identifiers = registry.get("zoneIdentifiers")
    require(registry.get("format") == "smart-intake.pinned-timezone-registry.v1", "timezone registry format")
    require(isinstance(identifiers, list) and identifiers == sorted(set(identifiers)), "timezone registry ordering")
    digest = hashlib.sha256(("\n".join(identifiers) + "\n").encode()).hexdigest()
    require(registry.get("zoneIdentifiersSha256") == digest, "timezone registry digest")
    require("Asia/Kathmandu" in identifiers and "Asia/Katmandu" in identifiers, "timezone registry aliases")
    return registry["version"], digest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--java", type=Path, default=JAVA_DEFAULT)
    parser.add_argument("--browser", type=Path, default=BROWSER_DEFAULT)
    args = parser.parse_args()

    source_bytes = SOURCE.read_bytes()
    source = json.loads(source_bytes)
    expected_sha = hashlib.sha256(source_bytes).hexdigest()
    require(expected_sha == PINNED_SOURCE_SHA256, "authoritative expression corpus checksum drift")
    require_clean_candidate()
    commit, tree = candidate_identity()
    worktree = worktree_bytes_sha256()
    timezone_version, timezone_digest = timezone_registry()
    expected_ids = [vector["id"] for vector in source["vectors"]]
    expected_operators = [operator["name"] for operator in source["operators"]]
    expected_by_id = {vector["id"]: normalized(vector["expected"]) for vector in source["vectors"]}
    expected_vectors = {vector["id"]: vector["expected"] for vector in source["vectors"]}

    artifacts = {"java": load(args.java), "browser": load(args.browser)}
    actual_by_runtime: dict[str, dict[str, dict]] = {}
    for runtime, artifact in artifacts.items():
        require(artifact.get("runner") == f"smart-intake-{runtime}-expression-v1", f"{runtime} runner")
        require(artifact.get("sourceSha256") == expected_sha, f"{runtime} source checksum drift")
        require(artifact.get("candidateCommit") == commit and artifact.get("candidateTree") == tree, f"{runtime} candidate binding")
        require(artifact.get("candidateWorktreeSha256") == worktree, f"{runtime} worktree bytes")
        timestamp(artifact.get("executedAtUtc"), runtime)
        require(artifact.get("timezoneDatabase") == timezone_version, f"{runtime} pinned timezone identity")
        require(artifact.get("timezoneRegistryVersion") == timezone_version, f"{runtime} timezone registry version")
        require(artifact.get("timezoneRegistrySha256") == timezone_digest, f"{runtime} timezone registry digest")
        if runtime == "java":
            require(isinstance(artifact.get("runtimeVersion"), str) and artifact["runtimeVersion"], "java runtime version")
            require(artifact.get("invocation") == "mvn -q -Dtest=ExpressionContractVectorTests test", "java invocation")
        else:
            require(artifact.get("browser") == "chromium", "browser runtime")
            require(isinstance(artifact.get("browserVersion"), str) and artifact["browserVersion"], "browser version")
            require(artifact.get("invocation") == "playwright test e2e/expression-vectors.spec.ts", "browser invocation")
        require(artifact.get("artifactSha256") == artifact_digest(artifact), f"{runtime} artifact digest")
        require(artifact.get("vectorsDiscovered") == 101, f"{runtime} vector denominator")
        require(artifact.get("operatorsDiscovered") == expected_operators, f"{runtime} operator registry")
        require(artifact.get("passed") == 101 and artifact.get("failed") == 0, f"{runtime} failures")
        require([row["id"] for row in artifact["results"]] == expected_ids, f"{runtime} discovery order")
        actual_by_runtime[runtime] = {
            row["id"]: normalized(row["actual"]) for row in artifact["results"]
        }
        for row in artifact["results"]:
            diagnostic_pointers(row["actual"], expected_vectors[row["id"]], runtime, row["id"])
        require(actual_by_runtime[runtime] == expected_by_id, f"{runtime} expected-result mismatch")

    require(actual_by_runtime["java"] == actual_by_runtime["browser"], "Java/browser result mismatch")
    print(
        "M3 expression parity passed: Java 101/101, browser 101/101, "
        "exact parity 101/101, operators 34/34."
    )


if __name__ == "__main__":
    main()
