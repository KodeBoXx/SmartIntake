#!/usr/bin/env python3
"""Create a bounded, non-acceptance M0 baseline evidence record.

The runner intentionally executes each command at most once.  A successful build,
mock, report, or partial corpus discovery is recorded as an observation and never
as acceptance.  Use ``--output`` to retain the small JSON record; otherwise the
record is written to stdout.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

SCHEMA_VERSION = "1.0.0"
STATUSES = {"pass", "fail", "blocked", "not-run"}
LEVELS = {"E0", "E1", "E2", "E3", "Human"}
MAX_SUMMARY_CHARS = 4_000

ROOT = Path(__file__).resolve().parents[2]
HANDOFF = Path("docs/source-handoff/smart-form-builder-lite-prd-v1.1")
EXPRESSION_CONTRACT = HANDOFF / "expression-contract.json"
EXPRESSION_TEST = Path("backend/src/test/java/com/kodeboxx/smartintake/contract/ExpressionContractVectorTests.java")
SCHEMAS = (
    Path("docs/contracts/smart-form-builder-lite/4.0.0/package.schema.json"),
    Path("docs/contracts/smart-form-builder-lite/4.0.0/typed-answer.schema.json"),
)
OPENAPI = Path("docs/api/openapi.yaml")
MIGRATIONS = tuple(Path(f"backend/src/main/resources/db/migration/V{number}__{suffix}.sql") for number, suffix in (
    (1, "smart_intake"),
    (2, "identity_workspaces_and_release_binding"),
    (3, "respondent_session_secret"),
    (4, "session_mutation_replay"),
))


@dataclass(frozen=True)
class CommandResult:
    command: tuple[str, ...]
    exit_code: int | None
    stdout: str
    stderr: str
    started_at: str
    finished_at: str
    cwd: str = "."


CommandExecutor = Callable[[Sequence[str], Path], CommandResult]


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def command_text(command: Sequence[str]) -> str:
    # JSON is unambiguous and avoids a shell or shell interpolation.
    return canonical_json(list(command))


def truncate_and_redact(value: str) -> str:
    """Keep output evidence small and avoid retaining obvious credentials."""
    value = re.sub(r"(?i)(password|token|secret|authorization)\s*([=:])\s*\S+", r"\1\2[REDACTED]", value)
    if len(value) > MAX_SUMMARY_CHARS:
        return value[:MAX_SUMMARY_CHARS] + "\n...[truncated]"
    return value


def default_executor(command: Sequence[str], cwd: Path) -> CommandResult:
    started_at = utc_now()
    try:
        completed = subprocess.run(
            list(command), cwd=cwd, text=True, capture_output=True, check=False, timeout=900
        )
        exit_code, stdout, stderr = completed.returncode, completed.stdout, completed.stderr
    except FileNotFoundError as exc:
        exit_code, stdout, stderr = 127, "", str(exc)
    except subprocess.TimeoutExpired as exc:
        exit_code = 124
        stdout = exc.stdout if isinstance(exc.stdout, str) else ""
        stderr = (exc.stderr if isinstance(exc.stderr, str) else "") + "\ncommand timed out after 900 seconds"
    return CommandResult(tuple(command), exit_code, stdout, stderr, started_at, utc_now(), str(cwd))


def file_artifact(root: Path, relative: Path) -> dict[str, Any]:
    path = root / relative
    if not path.is_file():
        return {"path": relative.as_posix(), "present": False, "sha256": None, "bytes": 0}
    return {
        "path": relative.as_posix(),
        "present": True,
        "sha256": sha256_file(path),
        "bytes": path.stat().st_size,
    }


def summarize_result(result: CommandResult) -> str:
    output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
    return truncate_and_redact(output)


def command_attempt(result: CommandResult, result_status: str | None = None) -> dict[str, Any]:
    status = result_status or ("pass" if result.exit_code == 0 else "fail")
    if status not in STATUSES:
        raise ValueError(f"invalid attempt status: {status}")
    summary = summarize_result(result)
    return {
        "number": 1,
        "command": list(result.command),
        "commandDisplay": command_text(result.command),
        "workingDirectory": result.cwd,
        "executed": True,
        "result": status,
        "exitCode": result.exit_code,
        "startedAtUtc": result.started_at,
        "finishedAtUtc": result.finished_at,
        "outputSummary": summary,
        "outputSha256": sha256_bytes(summary.encode()),
        "retried": False,
    }


def unrun_attempt(command: Sequence[str], now: str, reason: str, working_directory: str = ".") -> dict[str, Any]:
    return {
        "number": 1,
        "command": list(command),
        "commandDisplay": command_text(command),
        "workingDirectory": working_directory,
        "executed": False,
        "result": "not-run",
        "exitCode": None,
        "startedAtUtc": now,
        "finishedAtUtc": now,
        "outputSummary": reason,
        "outputSha256": sha256_bytes(reason.encode()),
        "retried": False,
    }


def task(
    identifier: str,
    title: str,
    status: str,
    evidence_level: str,
    denominator: dict[str, Any],
    finding: str,
    attempts: list[dict[str, Any]],
    artifacts: Iterable[dict[str, Any]] = (),
    prerequisites: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    if status not in STATUSES or evidence_level not in LEVELS:
        raise ValueError("invalid task status or evidence level")
    return {
        "id": identifier,
        "title": title,
        "status": status,
        "evidenceLevel": evidence_level,
        "acceptance": {
            "countsTowardAcceptance": False,
            "reason": "M0 baseline observation only; it does not close a requirement, fixture, or acceptance gate.",
        },
        "denominator": denominator,
        "finding": finding,
        "prerequisites": list(prerequisites),
        "attempts": attempts,
        "artifacts": list(artifacts),
    }


def run(executor: CommandExecutor, root: Path, command: Sequence[str]) -> CommandResult:
    return executor(command, root)


def git_candidate(root: Path, executor: CommandExecutor) -> dict[str, Any]:
    sha = run(executor, root, ("git", "rev-parse", "HEAD"))
    state = run(executor, root, ("git", "status", "--porcelain=v1", "--untracked-files=all"))
    state_text = summarize_result(state)
    return {
        "sha": sha.stdout.strip() if sha.exit_code == 0 else None,
        "shaAttempt": command_attempt(sha),
        "dirty": bool(state_text),
        "dirtyStateSha256": sha256_bytes(state_text.encode()),
        "dirtyStateSummary": state_text[:MAX_SUMMARY_CHARS],
        "dirtyStateAttempt": command_attempt(state),
    }


def version_record(root: Path, executor: CommandExecutor) -> dict[str, Any]:
    commands = {
        "python": ("python3", "--version"),
        "git": ("git", "--version"),
        "java": ("java", "-version"),
        "maven": ("mvn", "--version"),
        "node": ("node", "--version"),
        "npm": ("npm", "--version"),
        "docker": ("docker", "--version"),
        "dockerCompose": ("docker", "compose", "version"),
    }
    versions: dict[str, Any] = {"platform": platform.platform(), "pythonImplementation": platform.python_implementation()}
    for name, command in commands.items():
        result = run(executor, root, command)
        versions[name] = {
            "available": result.exit_code == 0,
            "summary": summarize_result(result),
            "attempt": command_attempt(result),
        }
    return versions


def postgres_prerequisite(root: Path, executor: CommandExecutor, now: str) -> tuple[dict[str, Any], bool]:
    status_command = ("docker", "compose", "ps", "postgres")
    status_result = run(executor, root, status_command)
    status_summary = summarize_result(status_result)
    running = status_result.exit_code == 0 and bool(re.search(r"\b(running|up)\b", status_summary, re.IGNORECASE))
    attempts = [command_attempt(status_result)]
    ready_command = ("docker", "compose", "exec", "-T", "postgres", "pg_isready", "-U", "smartintake", "-d", "smartintake")
    if running:
        ready_result = run(executor, root, ready_command)
        attempts.append(command_attempt(ready_result))
        ready = ready_result.exit_code == 0
    else:
        attempts.append(unrun_attempt(ready_command, now, "PostgreSQL service is not reported running; readiness command was not executed."))
        ready = False
    return task(
        "postgres-prerequisite",
        "Repository PostgreSQL prerequisite",
        "pass" if ready else "blocked",
        "E2",
        {"numerator": 1 if ready else 0, "denominator": 1, "unit": "reachable repository PostgreSQL service"},
        "PostgreSQL is a prerequisite for Maven integration and Flyway application observations; the runner never starts, resets, or mutates the service.",
        attempts,
        prerequisites=(),
    ), ready


def parse_surefire(root: Path) -> dict[str, int]:
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0, "reports": 0}
    for report in sorted((root / "backend/target/surefire-reports").glob("TEST-*.xml")):
        try:
            suite = ET.parse(report).getroot()
            totals["tests"] += int(suite.attrib.get("tests", "0"))
            totals["failures"] += int(suite.attrib.get("failures", "0"))
            totals["errors"] += int(suite.attrib.get("errors", "0"))
            totals["skipped"] += int(suite.attrib.get("skipped", "0"))
            totals["reports"] += 1
        except (ET.ParseError, ValueError):
            continue
    return totals


def backend_task(root: Path, executor: CommandExecutor, now: str, postgres_ready: bool) -> tuple[dict[str, Any], bool]:
    command = ("mvn", "-q", "test")
    prerequisite = {"id": "postgres-prerequisite", "status": "pass" if postgres_ready else "blocked"}
    if not postgres_ready:
        return task(
            "backend-maven-tests", "Backend Maven test observation", "blocked", "E2",
            {"numerator": 0, "denominator": 19, "unit": "reported Maven tests", "observedDenominator": "unknown because command did not run"},
            "Maven was not run because the repository PostgreSQL prerequisite is blocked. This is not a skipped pass.",
            [unrun_attempt(command, now, "Blocked by postgres-prerequisite.", "backend")], prerequisites=[prerequisite],
        ), False
    result = run(executor, root / "backend", command)
    totals = parse_surefire(root)
    passed = result.exit_code == 0 and totals["tests"] > 0 and totals["failures"] == totals["errors"] == totals["skipped"] == 0
    return task(
        "backend-maven-tests", "Backend Maven test observation", "pass" if passed else "fail", "E2",
        {"numerator": totals["tests"] if passed else 0, "denominator": totals["tests"], "unit": "Surefire tests", "failures": totals["failures"], "errors": totals["errors"], "skipped": totals["skipped"], "reportFiles": totals["reports"]},
        "A passing Maven run is an integrated baseline observation only; it does not demonstrate full PRD conformance.",
        [command_attempt(result)], prerequisites=[prerequisite],
    ), passed


def migration_inventory_task(root: Path, now: str) -> dict[str, Any]:
    artifacts = [file_artifact(root, item) for item in MIGRATIONS]
    present = sum(artifact["present"] for artifact in artifacts)
    return task(
        "flyway-migration-inventory", "Flyway V1-V4 migration inventory", "pass" if present == 4 else "fail", "E0",
        {"numerator": present, "denominator": 4, "unit": "preserved migration files", "versions": ["V1", "V2", "V3", "V4"]},
        "This hashes the preserved migration inputs. File presence/checksums do not prove database application.",
        [unrun_attempt(("internal", "sha256", "backend/src/main/resources/db/migration/V[1-4]__*.sql"), now, "Internal deterministic file inventory; no external command was required.")],
        artifacts=artifacts,
    )


def flyway_application_task(root: Path, executor: CommandExecutor, now: str, backend_passed: bool) -> dict[str, Any]:
    command = ("docker", "compose", "exec", "-T", "postgres", "psql", "-At", "-F", "|", "-U", "smartintake", "-d", "smartintake", "-c", "SELECT version, success FROM flyway_schema_history ORDER BY installed_rank;")
    prerequisite = {"id": "backend-maven-tests", "status": "pass" if backend_passed else "blocked"}
    if not backend_passed:
        return task("flyway-migration-application", "Flyway migration application observation", "blocked", "E2",
                    {"numerator": 0, "denominator": 4, "unit": "successful Flyway migrations", "versions": ["1", "2", "3", "4"]},
                    "Database history was not queried because Maven integration did not complete successfully.",
                    [unrun_attempt(command, now, "Blocked by backend-maven-tests.")], prerequisites=[prerequisite])
    result = run(executor, root, command)
    applied = {
        line.split("|", 1)[0].strip()
        for line in result.stdout.splitlines()
        if "|" in line and line.split("|", 1)[1].strip().lower() in {"true", "t", "1"}
    }
    expected = {"1", "2", "3", "4"}
    passed = result.exit_code == 0 and expected.issubset(applied)
    return task("flyway-migration-application", "Flyway migration application observation", "pass" if passed else "fail", "E2",
                {"numerator": len(expected & applied), "denominator": 4, "unit": "successful Flyway migrations", "versions": sorted(expected)},
                "This read-only database-history observation is limited to V1-V4 and does not accept later schema scope.",
                [command_attempt(result)], prerequisites=[prerequisite])


def expression_task(root: Path, now: str) -> dict[str, Any]:
    contract = json.loads((root / EXPRESSION_CONTRACT).read_text(encoding="utf-8"))
    vectors = contract.get("vectors", [])
    operators = contract.get("operators", [])
    source = (root / EXPRESSION_TEST).read_text(encoding="utf-8")
    ids = set(re.findall(r'"([A-Z][A-Z0-9]*-[A-Z0-9-]+)"', source))
    vector_ids = {str(item.get("id")) for item in vectors}
    executed = ids & vector_ids
    undiscovered = vector_ids - executed
    return task(
        "expression-execution-discovery", "Expression vector discovery/execution boundary", "pass", "E0",
        {"numerator": len(executed), "denominator": len(vector_ids), "unit": "authoritative expression vectors", "notExecuted": len(undiscovered), "operatorNumerator": len(operators), "operatorDenominator": 34, "operatorUnit": "normative operators"},
        f"Source discovery identifies {len(executed)}/{len(vector_ids)} selected vector IDs and {len(undiscovered)}/{len(vector_ids)} not executed by the selected-ID harness. Discovery is not vector execution or conformance.",
        [unrun_attempt(("internal", "discover-selected-vector-ids", EXPRESSION_TEST.as_posix()), now, "Internal source/corpus discovery; execution is represented separately by Maven." )],
        artifacts=[file_artifact(root, EXPRESSION_CONTRACT), file_artifact(root, EXPRESSION_TEST)],
    )


def frontend_build_task(root: Path, executor: CommandExecutor) -> dict[str, Any]:
    command = ("npm", "run", "build")
    result = run(executor, root / "frontend", command)
    return task("frontend-build", "Frontend build observation", "pass" if result.exit_code == 0 else "fail", "E0",
                {"numerator": 1 if result.exit_code == 0 else 0, "denominator": 1, "unit": "frontend compilation command"},
                "A frontend build supplies compilation evidence only. It is never browser, accessibility, or behavioral acceptance.",
                [command_attempt(result)], artifacts=[file_artifact(root, Path("frontend/package.json")), file_artifact(root, Path("frontend/angular.json"))])


def frontend_test_task(root: Path, executor: CommandExecutor) -> dict[str, Any]:
    command = ("npm", "test")
    result = run(executor, root / "frontend", command)
    angular = json.loads((root / "frontend/angular.json").read_text(encoding="utf-8"))
    architect = angular.get("projects", {}).get("smart-intake-web", {}).get("architect", {})
    has_target = "test" in architect
    status = "pass" if result.exit_code == 0 and has_target else "fail"
    return task("frontend-test-target", "Frontend test target observation", status, "E0",
                {"numerator": 1 if status == "pass" else 0, "denominator": 1, "unit": "configured executable frontend test target", "configuredTarget": has_target},
                "A failing or absent frontend test target is a test-infrastructure defect. A passing command would still require reviewed test cases before it could support acceptance.",
                [command_attempt(result)], artifacts=[file_artifact(root, Path("frontend/package.json")), file_artifact(root, Path("frontend/angular.json"))])


def json_schema_tasks(root: Path, executor: CommandExecutor) -> list[dict[str, Any]]:
    parse_command = ("python3", "-m", "json.tool", *[item.as_posix() for item in SCHEMAS])
    # json.tool accepts one file only, so preserve both attempts in a single bounded task.
    attempts = [command_attempt(run(executor, root, ("python3", "-m", "json.tool", item.as_posix()))) for item in SCHEMAS]
    parse_ok = all(attempt["result"] == "pass" for attempt in attempts)
    parse_task = task("json-schema-parse", "JSON Schema syntax parse observation", "pass" if parse_ok else "fail", "E0",
                      {"numerator": sum(attempt["result"] == "pass" for attempt in attempts), "denominator": len(SCHEMAS), "unit": "JSON Schema documents"},
                      "JSON parsing establishes syntax only, not schema strictness or product conformance.", attempts,
                      artifacts=[file_artifact(root, item) for item in SCHEMAS])
    compiler = ("python3", "-c", "import json, jsonschema; from jsonschema import Draft202012Validator; [Draft202012Validator.check_schema(json.load(open(p))) for p in __import__('sys').argv[1:]]", *[item.as_posix() for item in SCHEMAS])
    result = run(executor, root, compiler)
    unavailable = result.exit_code != 0 and "No module named" in summarize_result(result)
    compile_task = task("json-schema-compile", "JSON Schema meta-schema compile observation", "blocked" if unavailable else ("pass" if result.exit_code == 0 else "fail"), "E1",
                        {"numerator": len(SCHEMAS) if result.exit_code == 0 else 0, "denominator": len(SCHEMAS), "unit": "JSON Schema documents", "validator": "python-jsonschema Draft202012Validator.check_schema"},
                        "Meta-schema compilation does not establish that the current permissive foundation schemas meet the planned seven-schema contract.", [command_attempt(result, "blocked" if unavailable else None)],
                        artifacts=[file_artifact(root, item) for item in SCHEMAS])
    return [parse_task, compile_task]


def openapi_tasks(root: Path, executor: CommandExecutor, now: str) -> list[dict[str, Any]]:
    syntax_command = ("python3", "-c", "import sys, yaml; yaml.safe_load(open(sys.argv[1], encoding='utf-8'))", OPENAPI.as_posix())
    syntax_result = run(executor, root, syntax_command)
    unavailable = syntax_result.exit_code != 0 and "No module named" in summarize_result(syntax_result)
    syntax = task("openapi-yaml-syntax", "OpenAPI YAML syntax observation", "blocked" if unavailable else ("pass" if syntax_result.exit_code == 0 else "fail"), "E0",
                  {"numerator": 1 if syntax_result.exit_code == 0 else 0, "denominator": 1, "unit": "OpenAPI YAML document"},
                  "YAML parse success proves syntax only; it does not prove OpenAPI validity, semantic completeness, or route coverage.", [command_attempt(syntax_result, "blocked" if unavailable else None)],
                  artifacts=[file_artifact(root, OPENAPI)])
    semantic_command = ("npx", "--no-install", "@redocly/cli", "lint", OPENAPI.as_posix())
    semantic = task("openapi-semantic-validation", "OpenAPI semantic-validator boundary", "not-run", "E1",
                    {"numerator": 0, "denominator": 1, "unit": "configured semantic OpenAPI validator"},
                    "No pinned semantic OpenAPI validator is configured by this repository. The runner intentionally does not download a validator or interpret YAML syntax as semantic validation.",
                    [unrun_attempt(semantic_command, now, "Not run: no pinned repository semantic validator target exists; network installation is forbidden.")],
                    artifacts=[file_artifact(root, OPENAPI)])
    return [syntax, semantic]


def build_record(root: Path = ROOT, executor: CommandExecutor = default_executor, now: str | None = None) -> dict[str, Any]:
    root = root.resolve()
    observed_at = now or utc_now()
    candidate = git_candidate(root, executor)
    environment = version_record(root, executor)
    tasks: list[dict[str, Any]] = []
    handoff_command = ("python3", (HANDOFF / "verify-handoff.py").as_posix())
    handoff_result = run(executor, root, handoff_command)
    tasks.append(task("handoff-integrity", "Source handoff integrity", "pass" if handoff_result.exit_code == 0 else "fail", "E0",
                      {"numerator": 14 if handoff_result.exit_code == 0 else 0, "denominator": 14, "unit": "manifested handoff files"},
                      "Manifest verification establishes preservation integrity only; it is not product acceptance.", [command_attempt(handoff_result)],
                      artifacts=[file_artifact(root, HANDOFF / "manifest.json"), file_artifact(root, HANDOFF / "verify-handoff.py")]))
    postgres, postgres_ready = postgres_prerequisite(root, executor, observed_at)
    tasks.append(postgres)
    backend, backend_passed = backend_task(root, executor, observed_at, postgres_ready)
    tasks.extend([backend, migration_inventory_task(root, observed_at), flyway_application_task(root, executor, observed_at, backend_passed), expression_task(root, observed_at), frontend_build_task(root, executor), frontend_test_task(root, executor)])
    tasks.extend(json_schema_tasks(root, executor))
    tasks.extend(openapi_tasks(root, executor, observed_at))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "recordType": "m0-baseline-observation",
        "observedAtUtc": observed_at,
        "candidate": candidate,
        "environment": environment,
        "executionPolicy": {"maxAttemptsPerCommand": 1, "retriesAllowed": False, "networkInstallAllowed": False, "logsRetained": "summaries only (maximum 4000 characters per command)"},
        "acceptanceBoundary": "This record is baseline evidence only. No status, artifact, build, mock, screenshot, unavailable integration, filtered row, or command retry closes acceptance.",
        "tasks": tasks,
    }


def validate_record(record: dict[str, Any]) -> None:
    if record.get("schemaVersion") != SCHEMA_VERSION or record.get("recordType") != "m0-baseline-observation":
        raise ValueError("unexpected record identity")
    for item in record.get("tasks", []):
        if item["status"] not in STATUSES or item["evidenceLevel"] not in LEVELS:
            raise ValueError(f"invalid task values for {item.get('id')}")
        if item["acceptance"]["countsTowardAcceptance"]:
            raise ValueError(f"baseline task may not count toward acceptance: {item.get('id')}")
        for attempt in item["attempts"]:
            if attempt["result"] not in STATUSES or attempt["number"] != 1 or attempt["retried"]:
                raise ValueError(f"attempt policy violated for {item.get('id')}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT, help="repository root (default: inferred from this script)")
    parser.add_argument("--output", type=Path, help="optional JSON output path; stdout is the default")
    parser.add_argument("--now", help="UTC timestamp override for reproducible fixture tests, e.g. 2026-09-14T00:00:00Z")
    args = parser.parse_args(argv)
    record = build_record(args.repo, now=args.now)
    validate_record(record)
    rendered = json.dumps(record, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
