#!/usr/bin/env python3
"""Aggregate the Smart Form Builder Lite v1.1 M0 acceptance inputs.

This is an acceptance-input integrity gate, not a product conformance runner.
The latest PRD is the sole scope authority. Strict mode refuses an M0 exit while
the supplemental claim of seven formerly-removed-Core IDs remains an unresolved
provenance discrepancy. ``--diagnostic`` checks every independent surface using
the sibling tools' explicitly provisional modes; it cannot claim M0 exit or
product conformance credit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

PROTECTED_BRANCH = "vorflux/m0-acceptance-foundation"
PROTECTED_HEAD = "66e96756d3e7d00c60e8d974b34a113b9ca60586"
PROTECTED_PRD_SHA256 = "6bb234273705e341ef1c401dd2a7f764b10d834bb95673b71e0f62e4aea2e41e"
EXPECTED_COUNTS = {
    "requirements": 95,
    "core": 83,
    "enhancement": 12,
    "fixtures": 31,
    "operators": 34,
    "vectors": 101,
}
EXPECTED_DENOMINATORS = {
    "a-total.json": 95,
    "o-named.json": 53,
    "o-total.json": 81,
    "s-total.json": 7,
    "sec-total.json": 1344,
    "wcag-total.json": 114,
    "ui-total.json": 14,
    "ui-staff-total.json": 18,
    "c-total.json": 24,
    "h-total.json": 10,
    "i-total.json": 50,
    "f-total.json": 12,
    "n-current.json": 21,
}
ALLOWED_M0_PATHS = ("docs/acceptance/v1.1/", "tools/acceptance/", ".gitignore")
PROVENANCE_BLOCKER = "unresolved supplemental seven-ID provenance discrepancy"


@dataclass(frozen=True)
class Result:
    """One aggregate check result; checked is deliberately not acceptance pass."""

    name: str
    state: str  # checked, blocked, failed
    detail: str


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def command(root: Path, args: Sequence[str]) -> tuple[int, str]:
    """Run a bounded local command without invoking a shell."""
    try:
        completed = subprocess.run(
            list(args), cwd=root, text=True, capture_output=True, check=False, timeout=120
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return 127, str(error)

    return completed.returncode, completed.stdout + "\n" + completed.stderr


def command_output(root: Path, args: Sequence[str]) -> tuple[int, str]:
    """Run a bounded local command and retain only its final diagnostic line."""
    code, combined = command(root, args)
    lines = [line for line in combined.splitlines() if line.strip()]
    return code, lines[-1] if lines else "no diagnostic output"


def git_value(root: Path, *args: str) -> tuple[int, str]:
    return command_output(root, ("git", *args))


def changed_paths(root: Path) -> tuple[int, list[str]]:
    code, output = command(root, ("git", "status", "--porcelain=v1", "--untracked-files=all"))
    if code:
        return code, [output]
    paths: list[str] = []
    for line in output.splitlines():
        if len(line) < 4:
            continue
        # Porcelain paths are repository-relative. Renames use "old -> new";
        # checking both sides catches a product source move as well.
        paths.extend(part.strip() for part in line[3:].split(" -> "))
    return 0, paths


def tracked_paths_since_protected_head(root: Path) -> tuple[int, list[str]]:
    code, output = command(root, ("git", "diff", "--name-only", f"{PROTECTED_HEAD}..HEAD"))
    return code, [line for line in output.splitlines() if line]


def allowed_m0_path(path: str) -> bool:
    return path == ".gitignore" or any(path.startswith(prefix) for prefix in ALLOWED_M0_PATHS[:-1])


def check_repository_guardrails(root: Path) -> Result:
    code, branch = git_value(root, "branch", "--show-current")
    if code or branch != PROTECTED_BRANCH:
        return Result("repository guardrails", "failed", f"expected branch {PROTECTED_BRANCH}, found {branch!r}")
    code, head = git_value(root, "rev-parse", "HEAD")
    if code:
        return Result("repository guardrails", "failed", f"could not resolve HEAD: {head}")
    code, _ = git_value(root, "merge-base", "--is-ancestor", PROTECTED_HEAD, "HEAD")
    if code:
        return Result("repository guardrails", "failed", f"HEAD {head!r} is not descended from protected source {PROTECTED_HEAD}")
    code, committed_paths = tracked_paths_since_protected_head(root)
    if code:
        return Result("repository guardrails", "failed", "could not inspect changes since protected source")
    committed_non_m0 = sorted(path for path in committed_paths if not allowed_m0_path(path))
    if committed_non_m0:
        return Result("repository guardrails", "failed", "non-M0 changes since protected source: " + ", ".join(committed_non_m0))
    code, paths = changed_paths(root)
    if code:
        return Result("repository guardrails", "failed", f"could not read worktree state: {paths[0]}")
    disallowed = sorted(path for path in paths if not allowed_m0_path(path))
    if disallowed:
        return Result("repository guardrails", "failed", "non-M0 worktree paths present: " + ", ".join(disallowed))
    return Result("repository guardrails", "checked", "protected source ancestry and M0-only committed/worktree scope verified")


def check_handoff(root: Path) -> Result:
    prd = root / "docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md"
    if not prd.is_file() or sha256(prd) != PROTECTED_PRD_SHA256:
        return Result("source handoff", "failed", "protected PRD SHA-256 differs from the frozen M0 source")
    code, output = command_output(root, (sys.executable, "docs/source-handoff/smart-form-builder-lite-prd-v1.1/verify-handoff.py"))
    if code:
        return Result("source handoff", "failed", f"handoff verifier failed: {output}")
    return Result("source handoff", "checked", "protected PRD digest and 14-file handoff verifier checked")


def check_inventory_counts(root: Path) -> Result:
    try:
        manifest = load_json(root / "docs/acceptance/v1.1/inventory/manifest.json")
        inventory_path = root / "docs/acceptance/v1.1/inventory" / manifest["inventory"]["path"]
        inventory = load_json(inventory_path)
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        return Result("inventory fixed counts", "failed", f"inventory files are unreadable: {error}")
    if manifest.get("inventory", {}).get("sha256") != sha256(inventory_path):
        return Result("inventory fixed counts", "failed", "inventory manifest checksum mismatch")
    if manifest.get("counts") != EXPECTED_COUNTS or inventory.get("counts") != EXPECTED_COUNTS:
        return Result("inventory fixed counts", "failed", f"expected {EXPECTED_COUNTS}, found manifest={manifest.get('counts')} inventory={inventory.get('counts')}")
    policy = inventory.get("generationPolicy", {})
    if policy.get("acceptanceStatusInferred") is not False:
        return Result("inventory fixed counts", "failed", "inventory must not infer acceptance status")
    if len(inventory.get("requirements", [])) != 95 or len(inventory.get("fixtures", [])) != 31:
        return Result("inventory fixed counts", "failed", "95 requirement or 31 fixture member list drifted")
    if [item.get("id") for item in inventory.get("exclusions", [])] != [f"X0{number}" for number in range(1, 7)]:
        return Result("inventory fixed counts", "failed", "X01–X06 exclusion inventory drifted")
    return Result("inventory fixed counts", "checked", "95 requirements (83 Core/12 Enhancement), 31 fixtures, X01–X06 exclusions, 34 operators, and 101 vectors verified")


def parse_sha256sums(directory: Path) -> tuple[dict[str, str], str | None]:
    sums = directory / "SHA256SUMS"
    if not sums.is_file():
        return {}, "SHA256SUMS is missing"
    entries: dict[str, str] = {}
    for number, line in enumerate(sums.read_text(encoding="utf-8").splitlines(), 1):
        parts = line.split("  ", 1)
        if len(parts) != 2 or len(parts[0]) != 64 or not all(char in "0123456789abcdef" for char in parts[0]):
            return {}, f"malformed SHA256SUMS line {number}"
        if parts[1] in entries:
            return {}, f"duplicate SHA256SUMS entry {parts[1]}"
        entries[parts[1]] = parts[0]
    return entries, None


def check_denominators(root: Path) -> Result:
    directory = root / "docs/acceptance/v1.1/denominators"
    entries, error = parse_sha256sums(directory)
    if error:
        return Result("denominator manifests", "failed", error)
    for filename, expected_digest in entries.items():
        path = directory / filename
        if not path.is_file() or sha256(path) != expected_digest:
            return Result("denominator manifests", "failed", f"checksum mismatch for {filename}")
    if set(EXPECTED_DENOMINATORS) - set(entries):
        return Result("denominator manifests", "failed", "SHA256SUMS omits a required denominator manifest")
    try:
        index = load_json(directory / "manifest-index.json")
        indexed = index["manifests"]
        for filename, expected_total in EXPECTED_DENOMINATORS.items():
            document = load_json(directory / filename)
            if document.get("total") != expected_total or indexed.get(filename) != expected_total:
                return Result("denominator manifests", "failed", f"{filename} expected total {expected_total}")
            if document.get("current_execution_status") != "not-run":
                return Result("denominator manifests", "failed", f"{filename} claims execution status")
            if any(member.get("status") != "not-run" for member in document.get("members", [])):
                return Result("denominator manifests", "failed", f"{filename} contains an execution/pass claim")
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        return Result("denominator manifests", "failed", f"denominator metadata is invalid: {error}")
    return Result("denominator manifests", "checked", "all deterministic manifest checksums and frozen totals verified")


def check_no_pass_claims(root: Path) -> Result:
    try:
        evaluator = load_json(root / "docs/acceptance/v1.1/evaluator/manifest.json")
        status = evaluator["status"]
        if status.get("measuredConformanceExecuted") is not False or status.get("productTestsExecuted") is not False:
            return Result("non-acceptance status", "failed", "evaluator manifest claims measured product conformance")
        baselines = root / "docs/acceptance/v1.1/evidence/baselines"
        for path in sorted(baselines.glob("*.json")) if baselines.is_dir() else []:
            record = load_json(path)
            if record.get("recordType") != "m0-baseline-observation":
                return Result("non-acceptance status", "failed", f"unexpected evidence record {path.name}")
            for task in record.get("tasks", []):
                if task.get("acceptance", {}).get("countsTowardAcceptance") is not False:
                    return Result("non-acceptance status", "failed", f"baseline {path.name} claims acceptance")
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        return Result("non-acceptance status", "failed", f"status metadata is invalid: {error}")
    return Result("non-acceptance status", "checked", "all M0 artifacts remain input/baseline material, not product acceptance")


def denial_list_blocked(root: Path) -> bool:
    try:
        manifest = load_json(root / "docs/acceptance/v1.1/inventory/manifest.json")
        inventory = load_json(root / "docs/acceptance/v1.1/inventory/inventory.json")
        claim = inventory.get("formerlyRemovedWholeCoreDenialList", {})
        return (
            manifest.get("denialListEnumerationAvailable") is False
            and claim.get("declaredCount") == 7
            and claim.get("identifiers") == []
            and claim.get("enumerationAvailable") is False
        )
    except (OSError, TypeError, json.JSONDecodeError):
        return False


def sibling_tool(root: Path, name: str, args: Sequence[str], *, diagnostic: bool) -> Result:
    code, output = command_output(root, args)
    if code == 0:
        return Result(name, "checked", "tool completed")
    if denial_list_blocked(root) and "denial" in output.lower():
        return Result(name, "blocked", PROVENANCE_BLOCKER + "; " + output)
    return Result(name, "failed", output)


def check_evidence_schema(root: Path) -> Result:
    path = root / "docs/acceptance/v1.1/evidence/baseline-record.schema.json"
    try:
        schema = load_json(path)
    except (OSError, json.JSONDecodeError) as error:
        return Result("evidence schema", "failed", f"schema is unreadable: {error}")
    required = {"schemaVersion", "recordType", "observedAtUtc", "candidate", "environment", "executionPolicy", "acceptanceBoundary", "tasks"}
    if schema.get("required") != list(required) and set(schema.get("required", [])) != required:
        return Result("evidence schema", "failed", "baseline schema required envelope drifted")
    if schema.get("$defs", {}).get("status", {}).get("enum") != ["pass", "fail", "blocked", "not-run"]:
        return Result("evidence schema", "failed", "baseline schema status vocabulary drifted")
    if schema.get("$defs", {}).get("task", {}).get("properties", {}).get("acceptance", {}).get("properties", {}).get("countsTowardAcceptance", {}).get("const") is not False:
        return Result("evidence schema", "failed", "baseline schema may not count observations toward acceptance")
    return Result("evidence schema", "checked", "baseline schema JSON and non-acceptance contract checked")


def run_all(root: Path, diagnostic: bool) -> list[Result]:
    inventory_args: list[str] = [sys.executable, "tools/acceptance/generate_inventory.py", "--check"]
    evaluator_args: list[str] = [sys.executable, "docs/acceptance/v1.1/evaluator/tools/validate_corpus.py"]
    if diagnostic:
        inventory_args.append("--allow-unenumerated-denial-list")
        evaluator_args.append("--allow-blocked-denial-list")
    results = [
        check_repository_guardrails(root),
        check_handoff(root),
        sibling_tool(root, "inventory generator", inventory_args, diagnostic=diagnostic),
        check_inventory_counts(root),
        check_denominators(root),
        sibling_tool(root, "evaluator validator", evaluator_args, diagnostic=diagnostic),
        check_no_pass_claims(root),
        check_evidence_schema(root),
        sibling_tool(root, "baseline tool tests", [sys.executable, "tools/acceptance/test_run_baseline.py"], diagnostic=diagnostic),
        sibling_tool(root, "evaluator tool tests", [sys.executable, "docs/acceptance/v1.1/evaluator/tools/test_validate_corpus.py"], diagnostic=diagnostic),
    ]
    if diagnostic and denial_list_blocked(root):
        results.append(Result("strict provenance gate", "blocked", PROVENANCE_BLOCKER + "; provisional diagnostics do not publish, infer, restore, or waive IDs/capabilities"))
    return results


def print_results(results: Iterable[Result], diagnostic: bool) -> None:
    for result in results:
        print(f"{result.state.upper():7} {result.name}: {result.detail}")
    failed = any(result.state == "failed" for result in results)
    blocked = any(result.state == "blocked" for result in results)
    if failed:
        print("M0 RESULT: INVALID INPUTS OR GUARDRAIL FAILURE; no acceptance decision is available.")
    elif blocked:
        if diagnostic:
            print("M0 DIAGNOSTIC: independent inputs checked provisionally; no M0 exit or conformance credit. Strict M0 remains BLOCKED by the unresolved supplemental provenance discrepancy.")
        else:
            print("M0 STRICT: BLOCKED only by the unresolved supplemental seven-ID provenance discrepancy; no M0 exit or conformance credit.")
    else:
        print("M0 INPUT INTEGRITY: checked. This is not product conformance or final acceptance.")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--diagnostic", action="store_true", help="verify all non-blocked surfaces provisionally; strict denial-list block remains visible")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2], help="repository root (default: inferred)")
    args = parser.parse_args(argv)
    results = run_all(args.repo_root.resolve(), args.diagnostic)
    print_results(results, args.diagnostic)
    if any(result.state == "failed" for result in results):
        return 1
    if any(result.state == "blocked" for result in results) and not args.diagnostic:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
