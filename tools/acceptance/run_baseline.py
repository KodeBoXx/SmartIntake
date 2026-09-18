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
import importlib.metadata
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

SCHEMA_VERSION = "1.1.0"
ATTESTATION_VERSION = "1.1.0"
RECORD_ACCEPTANCE_BOUNDARY = (
    "This record is baseline evidence only. No status, artifact, build, mock, screenshot, "
    "unavailable integration, filtered row, or command retry closes acceptance."
)
ATTESTATION_ACCEPTANCE_BOUNDARY = "Attestation preserves a baseline observation; it grants no acceptance credit."
STATUSES = {"pass", "fail", "blocked", "not-run"}
LEVELS = {"E0", "E1", "E2", "E3", "Human"}
RETAINED_RECORD_STATUSES = {"retained", "finalized"}
MAX_SUMMARY_CHARS = 4_000
DEFAULT_APPLICATION_DATABASE_URL = "jdbc:postgresql://localhost:5432/smartintake"
BASELINE_DATABASE_PREFIX = "smartintake_baseline_"
JDBC_POSTGRES_URL = re.compile(
    r"^jdbc:postgresql://(?P<authority>[^/?#]+)/(?P<database>[A-Za-z0-9_]+)(?:\?[^#]*)?$"
)

ROOT = Path(__file__).resolve().parents[2]
HANDOFF = Path("docs/source-handoff/smart-form-builder-lite-prd-v1.1")
EXPRESSION_CONTRACT = HANDOFF / "expression-contract.json"
EXPRESSION_TEST = Path("backend/src/test/java/com/kodeboxx/smartintake/contract/ExpressionContractVectorTests.java")
SCHEMAS = (
    Path("docs/contracts/smart-form-builder-lite/4.0.0/package.schema.json"),
    Path("docs/contracts/smart-form-builder-lite/4.0.0/typed-answer.schema.json"),
)
OPENAPI = Path("docs/api/openapi.yaml")
EVIDENCE_SCHEMA = Path("docs/acceptance/v1.1/evidence/baseline-record.schema.json")
ATTESTATION_SCHEMA = Path("docs/acceptance/v1.1/evidence/baseline-attestation.schema.json")
BASELINES_DIRECTORY = Path("docs/acceptance/v1.1/evidence/baselines")
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


@dataclass(frozen=True)
class BaselineDatabase:
    """A caller-provisioned database that is the runner's only mutation boundary."""

    url: str
    name: str


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


def baseline_database(url: str | None) -> BaselineDatabase:
    """Require a named disposable database and reject either application database."""
    if not isinstance(url, str) or not url:
        raise ValueError("an explicit --baseline-database-url for a caller-provisioned disposable database is required")
    parsed = JDBC_POSTGRES_URL.fullmatch(url)
    if parsed is None or "@" in parsed.group("authority"):
        raise ValueError("baseline database URL must be a credential-free jdbc:postgresql URL with one database name")
    name = parsed.group("database")
    current_url = os.environ.get("DATABASE_URL", DEFAULT_APPLICATION_DATABASE_URL)
    current = JDBC_POSTGRES_URL.fullmatch(current_url)
    current_name = current.group("database") if current else None
    if name == current_name or name == "smartintake":
        raise ValueError("baseline database must not be the default or current application database")
    if not name.startswith(BASELINE_DATABASE_PREFIX):
        raise ValueError(f"baseline database name must start with {BASELINE_DATABASE_PREFIX!r}")
    return BaselineDatabase(url=url, name=name)


def truncate_and_redact(value: str) -> str:
    """Keep output evidence small without retaining header or URI credentials."""
    # Header values can contain spaces (for example, ``Authorization: Bearer …``),
    # so redact through the line ending rather than stopping at the first word.
    value = re.sub(
        r"(?im)(\b(?:authorization|proxy-authorization|x-api-key|api[-_ ]?key|password|token|secret)\s*[:=]\s*)[^\r\n]*",
        r"\1[REDACTED]",
        value,
    )
    # Command diagnostics sometimes echo separate flag/value pairs. Handle quoted
    # values too, rather than leaving the tail of a quoted secret in the record.
    value = re.sub(
        r"(?i)(--(?:password|token|secret|authorization|access-token|api[-_]?key)\s+)(?:\"[^\r\n\"]*\"|'[^\r\n']*'|\S+)",
        r"\1[REDACTED]",
        value,
    )
    # A bearer token may be emitted without an Authorization header label.
    value = re.sub(r"(?i)\b(Bearer\s+)(?:\"[^\r\n\"]*\"|'[^\r\n']*'|\S+)", r"\1[REDACTED]", value)
    # Credentials in a URI may be emitted by a database/client error. Redact the
    # complete userinfo component, including a username that could itself be PII.
    value = re.sub(r"(?i)\b([a-z][a-z0-9+.-]*://)[^\s/@]+@", r"\1[REDACTED]@", value)
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
    tree = run(executor, root, ("git", "rev-parse", "HEAD^{tree}"))
    state = run(executor, root, ("git", "status", "--porcelain=v1", "--untracked-files=all"))
    state_text = summarize_result(state)
    return {
        "sha": sha.stdout.strip() if sha.exit_code == 0 else None,
        "shaAttempt": command_attempt(sha),
        "treeSha": tree.stdout.strip() if tree.exit_code == 0 else None,
        "treeAttempt": command_attempt(tree),
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


def postgres_prerequisite(root: Path, executor: CommandExecutor, now: str, database: BaselineDatabase) -> tuple[dict[str, Any], bool]:
    status_command = ("docker", "compose", "ps", "postgres")
    status_result = run(executor, root, status_command)
    status_summary = summarize_result(status_result)
    running = status_result.exit_code == 0 and bool(re.search(r"\b(running|up)\b", status_summary, re.IGNORECASE))
    attempts = [command_attempt(status_result)]
    ready_command = ("docker", "compose", "exec", "-T", "postgres", "pg_isready", "-U", "smartintake", "-d", database.name)
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
        f"PostgreSQL is checked only for caller-provisioned disposable database {database.name!r}. The runner never starts, creates, resets, drops, or otherwise mutates a shared service/database outside that declared boundary.",
        attempts,
        prerequisites=(),
    ), ready


def parse_surefire(root: Path, attempt_started_at: str) -> dict[str, int]:
    """Read only reports produced by this ``mvn clean test`` attempt."""
    started = dt.datetime.fromisoformat(attempt_started_at.replace("Z", "+00:00")).timestamp()
    # utc_now intentionally has second precision; allow the filesystem's rounding
    # window while ``clean`` remains the primary stale-report protection.
    earliest_report_time = started - 1
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0, "reports": 0, "staleReports": 0}
    for report in sorted((root / "backend/target/surefire-reports").glob("TEST-*.xml")):
        if report.stat().st_mtime < earliest_report_time:
            totals["staleReports"] += 1
            continue
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


def backend_task(root: Path, executor: CommandExecutor, now: str, postgres_ready: bool, database: BaselineDatabase) -> tuple[dict[str, Any], bool]:
    command = ("mvn", "-q", "clean", "test", f"-Dspring.datasource.url={database.url}")
    prerequisite = {"id": "postgres-prerequisite", "status": "pass" if postgres_ready else "blocked"}
    if not postgres_ready:
        return task(
            "backend-maven-tests", "Backend Maven test observation", "blocked", "E2",
            {"numerator": 0, "denominator": 19, "unit": "reported Maven tests", "observedDenominator": "unknown because command did not run"},
            "Maven was not run because the caller-provisioned disposable PostgreSQL prerequisite is blocked. This is not a skipped pass.",
            [unrun_attempt(command, now, "Blocked by postgres-prerequisite.", "backend")], prerequisites=[prerequisite],
        ), False
    result = run(executor, root / "backend", command)
    totals = parse_surefire(root, result.started_at)
    if result.exit_code == 0 and totals["staleReports"] > 0:
        return task(
            "backend-maven-tests", "Backend Maven test observation", "blocked", "E2",
            {"numerator": 0, "denominator": totals["tests"], "unit": "Surefire tests safely bound to this attempt", "failures": totals["failures"], "errors": totals["errors"], "skipped": totals["skipped"], "reportFiles": totals["reports"], "staleReportFiles": totals["staleReports"], "reportEvidence": "not-run: mtime/attempt-window skew"},
            "Maven completed, but one or more Surefire reports fall outside the attempt window. With clean test as the primary control, this timing anomaly blocks result evidence rather than recording a product test failure.",
            [command_attempt(result)], prerequisites=[prerequisite],
        ), False
    passed = (result.exit_code == 0 and totals["tests"] > 0 and totals["staleReports"] == 0
              and totals["failures"] == totals["errors"] == totals["skipped"] == 0)
    return task(
        "backend-maven-tests", "Backend Maven test observation", "pass" if passed else "fail", "E2",
        {"numerator": totals["tests"] if passed else 0, "denominator": totals["tests"], "unit": "Surefire tests", "failures": totals["failures"], "errors": totals["errors"], "skipped": totals["skipped"], "reportFiles": totals["reports"], "staleReportFiles": totals["staleReports"]},
        f"Maven is run with clean test and an explicit Spring datasource URL for disposable database {database.name!r}; report mtimes are bound to this attempt. This runner may mutate only that caller-provisioned database. A passing run remains an integrated baseline observation, not full PRD conformance.",
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


def flyway_application_task(root: Path, executor: CommandExecutor, now: str, backend_passed: bool, database: BaselineDatabase) -> dict[str, Any]:
    command = ("docker", "compose", "exec", "-T", "postgres", "psql", "-At", "-F", "|", "-U", "smartintake", "-d", database.name, "-c", "SELECT version, success FROM flyway_schema_history ORDER BY installed_rank;")
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
                f"This read-only history observation is limited to V1-V4 in declared disposable database {database.name!r} and does not accept later schema scope.",
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
        "expression-conformance", "Expression corpus conformance boundary", "not-run", "E1",
        {"numerator": 0, "denominator": len(vector_ids), "unit": "authoritative expression vectors required for conformance", "discoveredSelectedIds": len(executed), "discoveryDenominator": len(vector_ids), "notExecuted": len(undiscovered), "operatorNumerator": len(operators), "operatorDenominator": 34, "operatorUnit": "normative operators"},
        f"Full corpus conformance is not run: source discovery identifies {len(executed)}/{len(vector_ids)} selected IDs and {len(undiscovered)}/{len(vector_ids)} explicitly not executed by the selected-ID harness. Discovery is not vector execution or conformance.",
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


def load_baseline_schema(root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Load the checked-in schema and reject runner/schema contract drift."""
    schema_path = root / EVIDENCE_SCHEMA
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"baseline evidence schema is unreadable: {exc}") from exc
    if (schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema"
            or schema.get("properties", {}).get("schemaVersion", {}).get("const") != SCHEMA_VERSION
            or schema.get("properties", {}).get("recordType", {}).get("const") != "m0-baseline-observation"
            or schema.get("properties", {}).get("acceptanceBoundary", {}).get("const") != RECORD_ACCEPTANCE_BOUNDARY
            or "mutationBoundary" not in schema.get("properties", {}).get("executionPolicy", {}).get("required", [])
            or schema.get("properties", {}).get("executionPolicy", {}).get("properties", {}).get("mutationBoundary", {}).get("pattern") is None
            or schema.get("$defs", {}).get("task", {}).get("properties", {}).get("acceptance", {}).get("properties", {}).get("countsTowardAcceptance", {}).get("const") is not False):
        raise ValueError("runner/schema drift: baseline schema does not declare the runner record contract")
    try:
        import jsonschema  # type: ignore[import-not-found]
        available = True
        try:
            version = importlib.metadata.version("jsonschema")
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"
    except ImportError:
        jsonschema = None
        available = False
        version = None
    return schema, {
        "schemaPath": EVIDENCE_SCHEMA.as_posix(),
        "schemaSha256": sha256_file(schema_path),
        "mode": "full-jsonschema" if available else "structural-fallback",
        "validatorAvailable": available,
        "validatorVersion": version,
        "valid": True,
    }


def load_attestation_schema(root: Path) -> dict[str, Any]:
    """Load the checked-in attestation schema and verify its fixed boundary."""
    schema_path = root / ATTESTATION_SCHEMA
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"baseline attestation schema is unreadable: {exc}") from exc
    if (schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema"
            or schema.get("properties", {}).get("attestationVersion", {}).get("const") != ATTESTATION_VERSION
            or schema.get("properties", {}).get("acceptanceBoundary", {}).get("const") != ATTESTATION_ACCEPTANCE_BOUNDARY):
        raise ValueError("runner/schema drift: baseline attestation schema does not declare the runner contract")
    return schema


def structural_validate_record(record: dict[str, Any], schema_info: dict[str, Any]) -> None:
    """Dependency-free guard for record shape and the non-acceptance invariant."""
    required_top = {
        "schemaVersion", "recordType", "observedAtUtc", "candidate", "environment",
        "executionPolicy", "acceptanceBoundary", "recordValidation", "tasks",
    }
    if set(record) != required_top:
        raise ValueError("baseline record structural drift: unexpected top-level fields")
    if record["schemaVersion"] != SCHEMA_VERSION or record["recordType"] != "m0-baseline-observation":
        raise ValueError("unexpected record identity")
    if record["acceptanceBoundary"] != RECORD_ACCEPTANCE_BOUNDARY:
        raise ValueError("baseline record acceptance boundary may not grant acceptance")
    mutation_boundary = record.get("executionPolicy", {}).get("mutationBoundary")
    if not isinstance(mutation_boundary, str) or not re.fullmatch(
        r"Only caller-provisioned disposable PostgreSQL database 'smartintake_baseline_[a-z0-9_]+' at the explicit Spring datasource URL; no shared application database may be used, created, reset, or dropped\.",
        mutation_boundary,
    ):
        raise ValueError("baseline record mutation boundary is invalid")
    validation = record["recordValidation"]
    if not isinstance(validation, dict) or validation != schema_info:
        raise ValueError("runner/schema drift: record validation metadata does not match the checked-in schema")
    candidate = record.get("candidate")
    if (
        not isinstance(candidate, dict)
        or set(candidate) != {"sha", "shaAttempt", "treeSha", "treeAttempt", "dirty", "dirtyStateSha256", "dirtyStateSummary", "dirtyStateAttempt"}
        or not isinstance(candidate.get("sha"), str) or re.fullmatch(r"[0-9a-f]{40}", candidate["sha"]) is None
        or not isinstance(candidate.get("treeSha"), str) or re.fullmatch(r"[0-9a-f]{40}", candidate["treeSha"]) is None
        or not isinstance(candidate.get("dirty"), bool)
    ):
        raise ValueError("baseline record candidate SHA/tree identity is invalid")
    if not isinstance(record["tasks"], list) or not record["tasks"]:
        raise ValueError("baseline record must contain at least one task")
    identifiers: set[str] = set()
    for item in record["tasks"]:
        if not isinstance(item, dict) or item.get("id") in identifiers:
            raise ValueError("baseline record task IDs must be unique")
        identifiers.add(item["id"])
        if item.get("status") not in STATUSES or item.get("evidenceLevel") not in LEVELS:
            raise ValueError(f"invalid task values for {item.get('id')}")
        if item.get("acceptance", {}).get("countsTowardAcceptance") is not False:
            raise ValueError(f"baseline task may not count toward acceptance: {item.get('id')}")
        denominator = item.get("denominator", {})
        if not isinstance(denominator.get("numerator"), int) or not isinstance(denominator.get("denominator"), (int, str)):
            raise ValueError(f"task denominator is incomplete: {item.get('id')}")
        for attempt in item.get("attempts", []):
            if (attempt.get("result") not in STATUSES or attempt.get("number") != 1
                    or attempt.get("retried") is not False or not isinstance(attempt.get("command"), list)):
                raise ValueError(f"attempt policy violated for {item.get('id')}")


def validate_record(record: dict[str, Any], root: Path = ROOT) -> dict[str, Any]:
    """Validate against the checked-in full schema when available, else structurally."""
    schema, schema_info = load_baseline_schema(root)
    structural_validate_record(record, schema_info)
    if schema_info["validatorAvailable"]:
        import jsonschema
        try:
            jsonschema.Draft202012Validator.check_schema(schema)
            errors = sorted(jsonschema.Draft202012Validator(schema).iter_errors(record), key=lambda error: list(error.path))
        except jsonschema.SchemaError as exc:
            raise ValueError(f"runner/schema drift: invalid baseline evidence schema: {exc.message}") from exc
        if errors:
            raise ValueError(f"baseline record does not satisfy full JSON Schema: {errors[0].message}")
    return schema_info


def resolved_repository_root(root: Path) -> Path:
    try:
        resolved = root.resolve(strict=True)
    except OSError as exc:
        raise ValueError(f"repository root is unreadable: {exc}") from exc
    if not resolved.is_dir():
        raise ValueError("repository root must be a directory")
    return resolved


def canonical_baselines_directory(root: Path, *, create: bool = False) -> tuple[Path, Path]:
    """Resolve the canonical retained-evidence directory beneath a repository."""
    repository = resolved_repository_root(root)
    logical = repository / BASELINES_DIRECTORY
    if create:
        logical.mkdir(parents=True, exist_ok=True)
    try:
        baselines = logical.resolve(strict=True)
        baselines.relative_to(repository)
    except (OSError, ValueError) as exc:
        raise ValueError("canonical baseline directory must remain under the repository root") from exc
    if not baselines.is_dir():
        raise ValueError("canonical baseline directory must be a directory")
    return repository, baselines


def resolve_retained_baseline_path(path: Path, root: Path, baselines: Path | None = None) -> Path:
    """Resolve a retained record or attestation before it is parsed or hashed."""
    repository, canonical = canonical_baselines_directory(root)
    if baselines is not None and baselines != canonical:
        raise ValueError("retained baseline directory does not match the canonical directory")
    candidate = path if path.is_absolute() else repository / path
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(repository)
        resolved.relative_to(canonical)
    except (OSError, ValueError) as exc:
        raise ValueError("retained baseline path must resolve under the canonical baseline directory") from exc
    if not resolved.is_file():
        raise ValueError("retained baseline path must resolve to a file")
    return resolved


def retained_baseline_output_path(path: Path, root: Path) -> Path:
    """Prepare a contained output path without permitting a symlink escape."""
    repository, baselines = canonical_baselines_directory(root, create=True)
    candidate = path if path.is_absolute() else repository / path
    try:
        candidate.parent.resolve(strict=True).relative_to(baselines)
    except (OSError, ValueError) as exc:
        raise ValueError("retained baseline output must remain under the canonical baseline directory") from exc
    if candidate.exists():
        return resolve_retained_baseline_path(candidate, repository, baselines)
    return candidate


def attestation_record_location(record_path: Path, root: Path) -> str:
    """Return a canonical repository-relative POSIX location for a retained record."""
    repository, _ = canonical_baselines_directory(root)
    resolved = resolve_retained_baseline_path(record_path, repository)
    return resolved.relative_to(repository).as_posix()


def resolve_attested_record_location(location: Any, root: Path, records: dict[str, Path]) -> Path:
    """Resolve a record pointer and require that it names one discovered record."""
    if not isinstance(location, str) or not location or "\\" in location:
        raise ValueError("attestation record location is invalid")
    repository, _ = canonical_baselines_directory(root)
    resolved = resolve_retained_baseline_path(Path(location), repository)
    expected = records.get(location)
    if expected is None or expected != resolved:
        raise ValueError("attestation record location does not correspond exactly to one retained record")
    return resolved


def retained_baseline_paths(root: Path) -> tuple[dict[str, Path], dict[str, Path]]:
    """Discover contained retained records and attestations without parsing either."""
    repository, baselines = canonical_baselines_directory(root)
    records: dict[str, Path] = {}
    attestations: dict[str, Path] = {}
    resolved_targets: set[Path] = set()
    for logical in sorted(baselines.glob("*.json")):
        resolved = resolve_retained_baseline_path(logical, repository, baselines)
        if resolved in resolved_targets:
            raise ValueError("duplicate retained baseline paths resolve to the same target")
        resolved_targets.add(resolved)
        location = logical.relative_to(repository).as_posix()
        if logical.name.endswith(".attestation.json"):
            attestations[location] = resolved
        else:
            records[location] = resolved
    return records, attestations


def validate_retained_baselines(root: Path = ROOT) -> None:
    """Require clean, active retained evidence and exactly one final sibling attestation."""
    repository = resolved_repository_root(root)
    records, attestations = retained_baseline_paths(repository)
    if not records:
        raise ValueError("at least one retained baseline record is required")
    for location, path in records.items():
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"retained record is unreadable: {location}: {exc}") from exc
        validate_record(record, repository)
    attested_locations: set[str] = set()
    for location, path in attestations.items():
        try:
            attestation = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"retained attestation is unreadable: {location}: {exc}") from exc
        validate_attestation(attestation, repository, records)
        record_location = attestation["recordLocation"]
        if record_location in attested_locations:
            raise ValueError("duplicate retained attestations point to the same record")
        expected_sibling = record_location.removesuffix(".json") + ".attestation.json"
        if location != expected_sibling:
            raise ValueError("baseline attestation must be the exact sibling of its record")
        attested_locations.add(record_location)
        record = json.loads(records[record_location].read_text(encoding="utf-8"))
        record_identity = {key: record["candidate"][key] for key in ("sha", "treeSha", "dirty")}
        if record_identity != attestation["candidate"]:
            raise ValueError("baseline attestation candidate SHA/tree/status identity does not match its record")
        if record["candidate"]["dirty"]:
            raise ValueError("retained baseline record must have a clean candidate")
        if attestation["recordStatus"] not in RETAINED_RECORD_STATUSES:
            raise ValueError("provisional, superseded, or revoked baseline attestations cannot satisfy the M0 gate")
    if attested_locations != set(records):
        raise ValueError("each retained baseline record requires exactly one sibling attestation")


def validate_attestation(attestation: dict[str, Any], root: Path, records: dict[str, Path] | None = None) -> None:
    """Validate an attestation's non-acceptance boundary and resolved record binding."""
    schema = load_attestation_schema(root)
    required = {
        "attestationVersion", "recordLocation", "recordSha256", "recordStatus", "candidate", "createdAtUtc",
        "reviewer", "reviewerAuthority", "reviewStatus", "acceptanceBoundary",
    }
    if not isinstance(attestation, dict) or set(attestation) != required:
        raise ValueError("baseline attestation structural drift")
    if (attestation["attestationVersion"] != ATTESTATION_VERSION
            or attestation["acceptanceBoundary"] != ATTESTATION_ACCEPTANCE_BOUNDARY):
        raise ValueError("baseline attestation may not grant acceptance")
    if not isinstance(attestation["recordSha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", attestation["recordSha256"]):
        raise ValueError("baseline attestation record digest is invalid")
    candidate = attestation.get("candidate")
    if (
        not isinstance(candidate, dict) or set(candidate) != {"sha", "treeSha", "dirty"}
        or not isinstance(candidate.get("sha"), str) or re.fullmatch(r"[0-9a-f]{40}", candidate["sha"]) is None
        or not isinstance(candidate.get("treeSha"), str) or re.fullmatch(r"[0-9a-f]{40}", candidate["treeSha"]) is None
        or candidate.get("dirty") is not False
    ):
        raise ValueError("baseline attestation must bind a clean candidate SHA/tree identity")
    if (
        not isinstance(attestation.get("reviewer"), str) or not attestation["reviewer"].strip()
        or not isinstance(attestation.get("reviewerAuthority"), str) or not attestation["reviewerAuthority"].strip()
        or attestation.get("reviewStatus") != "approved"
    ):
        raise ValueError("baseline attestation reviewer identity, authority, and approval status are required")
    if records is None:
        records, _ = retained_baseline_paths(root)
    record_path = resolve_attested_record_location(attestation["recordLocation"], root, records)
    if sha256_file(record_path) != attestation["recordSha256"]:
        raise ValueError("baseline attestation record digest does not match resolved record bytes")
    try:
        import jsonschema
        jsonschema.Draft202012Validator.check_schema(schema)
        errors = sorted(jsonschema.Draft202012Validator(schema).iter_errors(attestation), key=lambda error: list(error.path))
    except ImportError:
        return
    except jsonschema.SchemaError as exc:
        raise ValueError(f"runner/schema drift: invalid baseline attestation schema: {exc.message}") from exc
    if errors:
        raise ValueError(f"baseline attestation does not satisfy full JSON Schema: {errors[0].message}")


def build_attestation(
    record: dict[str, Any], record_path: Path, status: str = "provisional", root: Path = ROOT,
    reviewer: str | None = None, reviewer_authority: str | None = None,
) -> dict[str, Any]:
    """Create metadata for retaining a record without turning it into acceptance."""
    if status not in {"provisional", "retained", "finalized", "superseded", "revoked"}:
        raise ValueError(f"invalid attestation status: {status}")
    repository = resolved_repository_root(root)
    retained_record = resolve_retained_baseline_path(record_path, repository)
    if not isinstance(reviewer, str) or not reviewer.strip() or not isinstance(reviewer_authority, str) or not reviewer_authority.strip():
        raise ValueError("baseline reviewer identity and authority are required; do not invent them")
    return {
        "attestationVersion": ATTESTATION_VERSION,
        "recordLocation": attestation_record_location(retained_record, repository),
        "recordSha256": sha256_file(retained_record),
        "recordStatus": status,
        "candidate": {
            "sha": record["candidate"]["sha"], "treeSha": record["candidate"]["treeSha"],
            "dirty": record["candidate"]["dirty"],
        },
        "createdAtUtc": utc_now(),
        "reviewer": reviewer,
        "reviewerAuthority": reviewer_authority,
        "reviewStatus": "approved",
        "acceptanceBoundary": ATTESTATION_ACCEPTANCE_BOUNDARY,
    }


def build_record(
    root: Path = ROOT,
    executor: CommandExecutor = default_executor,
    now: str | None = None,
    baseline_database_url: str | None = None,
) -> dict[str, Any]:
    root = root.resolve()
    database = baseline_database(baseline_database_url)
    observed_at = now or utc_now()
    _, schema_info = load_baseline_schema(root)
    candidate = git_candidate(root, executor)
    environment = version_record(root, executor)
    tasks: list[dict[str, Any]] = []
    handoff_command = ("python3", (HANDOFF / "verify-handoff.py").as_posix())
    handoff_result = run(executor, root, handoff_command)
    tasks.append(task("handoff-integrity", "Source handoff integrity", "pass" if handoff_result.exit_code == 0 else "fail", "E0",
                      {"numerator": 14 if handoff_result.exit_code == 0 else 0, "denominator": 14, "unit": "manifested handoff files"},
                      "Manifest verification establishes preservation integrity only; it is not product acceptance.", [command_attempt(handoff_result)],
                      artifacts=[file_artifact(root, HANDOFF / "manifest.json"), file_artifact(root, HANDOFF / "verify-handoff.py")]))
    postgres, postgres_ready = postgres_prerequisite(root, executor, observed_at, database)
    tasks.append(postgres)
    backend, backend_passed = backend_task(root, executor, observed_at, postgres_ready, database)
    tasks.extend([backend, migration_inventory_task(root, observed_at), flyway_application_task(root, executor, observed_at, backend_passed, database), expression_task(root, observed_at), frontend_build_task(root, executor), frontend_test_task(root, executor)])
    tasks.extend(json_schema_tasks(root, executor))
    tasks.extend(openapi_tasks(root, executor, observed_at))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "recordType": "m0-baseline-observation",
        "observedAtUtc": observed_at,
        "candidate": candidate,
        "environment": environment,
        "executionPolicy": {
            "maxAttemptsPerCommand": 1,
            "retriesAllowed": False,
            "networkInstallAllowed": False,
            "logsRetained": "summaries only (maximum 4000 characters per command)",
            "mutationBoundary": f"Only caller-provisioned disposable PostgreSQL database {database.name!r} at the explicit Spring datasource URL; no shared application database may be used, created, reset, or dropped.",
        },
        "acceptanceBoundary": RECORD_ACCEPTANCE_BOUNDARY,
        "recordValidation": schema_info,
        "tasks": tasks,
    }
    validate_record(record, root)
    return record


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT, help="repository root (default: inferred from this script)")
    parser.add_argument("--baseline-database-url", required=True, help="caller-provisioned credential-free jdbc:postgresql URL for a disposable smartintake_baseline_* database")
    parser.add_argument("--output", type=Path, help="optional JSON output path; stdout is the default")
    parser.add_argument("--attestation-output", type=Path, help="optional attestation manifest; requires --output")
    parser.add_argument("--attestation-status", default="provisional", choices=("provisional", "retained", "finalized", "superseded", "revoked"), help="retention status for --attestation-output")
    parser.add_argument("--attestation-reviewer", help="reviewer identity for a retained baseline attestation")
    parser.add_argument("--attestation-reviewer-authority", help="reviewer authority for a retained baseline attestation")
    parser.add_argument("--now", help="UTC timestamp override for reproducible fixture tests, e.g. 2026-09-14T00:00:00Z")
    args = parser.parse_args(argv)
    if args.attestation_output and not args.output:
        parser.error("--attestation-output requires --output so its digest has a retained record")
    if args.attestation_output and (not args.attestation_reviewer or not args.attestation_reviewer_authority):
        parser.error("--attestation-reviewer and --attestation-reviewer-authority are required; the tool will not invent a reviewer")
    repository = resolved_repository_root(args.repo)
    record = build_record(repository, now=args.now, baseline_database_url=args.baseline_database_url)
    validate_record(record, repository)
    rendered = json.dumps(record, indent=2, sort_keys=True) + "\n"
    if args.output:
        output = retained_baseline_output_path(args.output, repository)
        output.write_text(rendered, encoding="utf-8")
        if args.attestation_output:
            attestation = build_attestation(
                record, output, args.attestation_status, repository,
                args.attestation_reviewer, args.attestation_reviewer_authority,
            )
            attestation_output = retained_baseline_output_path(args.attestation_output, repository)
            attestation_output.write_text(json.dumps(attestation, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        validate_retained_baselines(repository)
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
