#!/usr/bin/env python3
"""Focused unit tests for the M0 baseline record builder."""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("run_baseline.py")
SPEC = importlib.util.spec_from_file_location("run_baseline", MODULE_PATH)
assert SPEC and SPEC.loader
baseline = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = baseline
SPEC.loader.exec_module(baseline)


class FakeExecutor:
    def __init__(self, postgres_running: bool = True):
        self.postgres_running = postgres_running
        self.commands: list[tuple[str, ...]] = []

    def __call__(self, command, cwd):
        command = tuple(command)
        self.commands.append(command)
        stdout, stderr, code = "", "", 0
        if command[:3] == ("git", "rev-parse", "HEAD"):
            stdout = "0123456789abcdef0123456789abcdef01234567\n"
        elif command[:3] == ("git", "rev-parse", "HEAD^{tree}"):
            stdout = "89abcdef0123456789abcdef0123456789abcdef\n"
        elif command[:2] == ("git", "status"):
            stdout = ""
        elif command[:3] == ("docker", "compose", "ps"):
            stdout, code = ("postgres running\n", 0) if self.postgres_running else ("postgres exited\n", 1)
        elif command[:4] == ("docker", "compose", "exec", "-T") and "pg_isready" in command:
            stdout, code = ("accepting connections\n", 0) if self.postgres_running else ("", 1)
        elif command[:2] == ("mvn", "-q"):
            stdout = "BUILD SUCCESS\n"
        elif command[:4] == ("docker", "compose", "exec", "-T") and "psql" in command:
            stdout = "1|true\n2|true\n3|true\n4|true\n"
        elif command[:2] == ("npm", "test"):
            stderr, code = "Unknown argument: watch\n", 1
        elif command[:2] == ("python3", "-c") and "jsonschema" in command[2]:
            stdout = "compiled\n"
        elif command[:2] == ("python3", "-c") and "yaml" in command[2]:
            stdout = "parsed\n"
        return baseline.CommandResult(command, code, stdout, stderr, "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z")


class BaselineRecordTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[2]
        self.database_url = "jdbc:postgresql://localhost:5432/smartintake_baseline_test"

    def build_record(self, executor=None, root=None):
        return baseline.build_record(root or self.root, executor or FakeExecutor(), "2026-09-14T00:00:00Z", self.database_url)

    def task_by_id(self, record, identifier):
        return next(item for item in record["tasks"] if item["id"] == identifier)

    def test_complete_record_is_non_acceptance_and_has_fixed_attempt_policy(self):
        fake = FakeExecutor()
        record = self.build_record(fake)
        baseline.validate_record(record)

        self.assertEqual("m0-baseline-observation", record["recordType"])
        self.assertEqual("0123456789abcdef0123456789abcdef01234567", record["candidate"]["sha"])
        self.assertEqual("89abcdef0123456789abcdef0123456789abcdef", record["candidate"]["treeSha"])
        self.assertFalse(record["candidate"]["dirty"])
        self.assertTrue(all(not task["acceptance"]["countsTowardAcceptance"] for task in record["tasks"]))
        self.assertTrue(all(attempt["number"] == 1 and not attempt["retried"]
                            for task in record["tasks"] for attempt in task["attempts"]))
        self.assertIn(("mvn", "-q", "clean", "test", f"-Dspring.datasource.url={self.database_url}"), fake.commands)
        self.assertIn("caller-provisioned disposable PostgreSQL database 'smartintake_baseline_test'", record["executionPolicy"]["mutationBoundary"])
        self.assertTrue(record["recordValidation"]["valid"])
        self.assertIn(record["recordValidation"]["mode"], {"full-jsonschema", "structural-fallback"})

        self.assertEqual({"numerator": 14, "denominator": 14, "unit": "manifested handoff files"},
                         self.task_by_id(record, "handoff-integrity")["denominator"])
        expression = self.task_by_id(record, "expression-conformance")
        self.assertEqual("not-run", expression["status"])
        self.assertEqual(101, expression["denominator"]["denominator"])
        self.assertEqual(0, expression["denominator"]["numerator"])
        self.assertEqual(34, expression["denominator"]["discoveredSelectedIds"])
        self.assertEqual(67, expression["denominator"]["notExecuted"])
        self.assertEqual("fail", self.task_by_id(record, "frontend-test-target")["status"])
        self.assertEqual("not-run", self.task_by_id(record, "openapi-semantic-validation")["status"])

    def test_postgres_block_is_distinct_and_prevents_maven_execution(self):
        fake = FakeExecutor(postgres_running=False)
        record = self.build_record(fake)
        prerequisite = self.task_by_id(record, "postgres-prerequisite")
        backend = self.task_by_id(record, "backend-maven-tests")
        flyway = self.task_by_id(record, "flyway-migration-application")

        self.assertEqual("blocked", prerequisite["status"])
        self.assertEqual("blocked", backend["status"])
        self.assertFalse(backend["attempts"][0]["executed"])
        self.assertEqual("not-run", backend["attempts"][0]["result"])
        self.assertEqual("blocked", flyway["status"])
        self.assertNotIn(("mvn", "-q", "clean", "test", f"-Dspring.datasource.url={self.database_url}"), fake.commands)

    def test_baseline_database_is_explicit_disposable_and_fail_closed_before_any_command(self):
        for url, message in (
            (None, "explicit --baseline-database-url"),
            ("jdbc:postgresql://localhost:5432/smartintake", "default or current application database"),
            ("jdbc:postgresql://localhost:5432/smartintake_shared", "must start with"),
            ("jdbc:postgresql://user:password@localhost:5432/smartintake_baseline_test", "credential-free"),
        ):
            with self.subTest(url=url):
                fake = FakeExecutor()
                with self.assertRaisesRegex(ValueError, message):
                    baseline.build_record(self.root, fake, "2026-09-14T00:00:00Z", url)
                self.assertEqual([], fake.commands)

    def test_baseline_database_refuses_the_current_application_database(self):
        original = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = self.database_url
        try:
            with self.assertRaisesRegex(ValueError, "default or current application database"):
                baseline.baseline_database(self.database_url)
        finally:
            if original is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = original

    def test_output_summary_redacts_headers_uri_credentials_and_is_bounded(self):
        result = baseline.CommandResult(("example",), 1, "\n".join((
            "password=hello token: abc",
            "Authorization: Bearer this-must-not-remain",
            "X-API-Key = api-key-must-not-remain",
            "api_key: second-api-key-must-not-remain",
            "command --password space-separated-password --api-key \"quoted api key\" --access-token access-token-value",
            "bare Bearer bearer-token-value",
            "failed postgres://database-user:database-password@example.test:5432/intake",
            "failed https://inline-user:inline-password@example.test/path",
        )), "x" * 5000,
                                        "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z")
        attempt = baseline.command_attempt(result)
        for secret in ("hello", "abc", "this-must-not-remain", "api-key-must-not-remain", "second-api-key-must-not-remain", "space-separated-password", "quoted api key", "access-token-value", "bearer-token-value", "database-user", "database-password", "inline-user", "inline-password"):
            self.assertNotIn(secret, attempt["outputSummary"])
        self.assertIn("Authorization: [REDACTED]", attempt["outputSummary"])
        self.assertIn("X-API-Key = [REDACTED]", attempt["outputSummary"])
        self.assertIn("--password [REDACTED]", attempt["outputSummary"])
        self.assertIn("--api-key [REDACTED]", attempt["outputSummary"])
        self.assertIn("Bearer [REDACTED]", attempt["outputSummary"])
        self.assertIn("postgres://[REDACTED]@example.test", attempt["outputSummary"])
        self.assertLessEqual(len(attempt["outputSummary"]), baseline.MAX_SUMMARY_CHARS + len("\n...[truncated]"))

    def test_stale_surefire_reports_are_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "backend/target/surefire-reports/TEST-example.xml"
            report.parent.mkdir(parents=True)
            report.write_text('<testsuite tests="9" failures="0" errors="0" skipped="0"/>', encoding="utf-8")
            os.utime(report, (0, 0))
            totals = baseline.parse_surefire(root, "2026-09-14T00:00:00Z")
        self.assertEqual(0, totals["tests"])
        self.assertEqual(0, totals["reports"])
        self.assertEqual(1, totals["staleReports"])

    def test_stale_surefire_only_evidence_blocks_instead_of_failing_product_tests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "backend/target/surefire-reports/TEST-example.xml"
            report.parent.mkdir(parents=True)
            report.write_text('<testsuite tests="9" failures="0" errors="0" skipped="0"/>', encoding="utf-8")
            os.utime(report, (0, 0))
            backend, passed = baseline.backend_task(root, FakeExecutor(), "2026-09-14T00:00:00Z", postgres_ready=True, database=baseline.baseline_database(self.database_url))
        self.assertFalse(passed)
        self.assertEqual("blocked", backend["status"])
        self.assertEqual("not-run: mtime/attempt-window skew", backend["denominator"]["reportEvidence"])
        self.assertEqual("pass", backend["attempts"][0]["result"])

    def test_structural_validation_rejects_acceptance_and_schema_metadata_drift(self):
        record = self.build_record()
        record["tasks"][0]["acceptance"]["countsTowardAcceptance"] = True
        with self.assertRaisesRegex(ValueError, "may not count toward acceptance"):
            baseline.validate_record(record, self.root)

        record = self.build_record()
        record["acceptanceBoundary"] = "This record grants acceptance."
        with self.assertRaisesRegex(ValueError, "acceptance boundary"):
            baseline.validate_record(record, self.root)

        record = self.build_record()
        record["executionPolicy"]["mutationBoundary"] = "Maven may use any database."
        with self.assertRaisesRegex(ValueError, "mutation boundary"):
            baseline.validate_record(record, self.root)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            schema_path = root / baseline.EVIDENCE_SCHEMA
            schema_path.parent.mkdir(parents=True)
            schema = json.loads((self.root / baseline.EVIDENCE_SCHEMA).read_text(encoding="utf-8"))
            schema["properties"]["schemaVersion"]["const"] = "0.0.0"
            schema_path.write_text(json.dumps(schema), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "runner/schema drift"):
                baseline.load_baseline_schema(root)

    def test_full_schema_rejects_positive_record_and_attestation_boundaries(self):
        try:
            import jsonschema
        except ImportError:
            self.skipTest("jsonschema is not installed")
        record = self.build_record()
        record_schema = json.loads((self.root / baseline.EVIDENCE_SCHEMA).read_text(encoding="utf-8"))
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(dict(record, acceptanceBoundary="This record grants acceptance."), record_schema)

        attestation_schema = json.loads((self.root / baseline.ATTESTATION_SCHEMA).read_text(encoding="utf-8"))
        attestation = {
            "attestationVersion": baseline.ATTESTATION_VERSION,
            "recordLocation": "docs/acceptance/v1.1/evidence/baselines/baseline.json",
            "recordSha256": "0" * 64,
            "recordStatus": "provisional",
            "candidate": {"sha": record["candidate"]["sha"], "treeSha": record["candidate"]["treeSha"], "dirty": False},
            "createdAtUtc": "2026-09-14T00:00:00Z",
            "reviewer": "test reviewer",
            "reviewerAuthority": "test authority",
            "reviewStatus": "approved",
            "acceptanceBoundary": "This attestation grants acceptance.",
        }
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate(attestation, attestation_schema)

    def test_dependency_free_attestation_validation_rejects_positive_boundary(self):
        record = self.build_record()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for schema_path in (baseline.EVIDENCE_SCHEMA, baseline.ATTESTATION_SCHEMA):
                destination = root / schema_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes((self.root / schema_path).read_bytes())
            record_path = root / baseline.BASELINES_DIRECTORY / "baseline.json"
            record_path.parent.mkdir(parents=True)
            record_path.write_text(json.dumps(record), encoding="utf-8")
            attestation = baseline.build_attestation(record, record_path, root=root, reviewer="test reviewer", reviewer_authority="test authority")
            attestation["acceptanceBoundary"] = "This attestation grants acceptance."
            with self.assertRaisesRegex(ValueError, "may not grant acceptance"):
                baseline.validate_attestation(attestation, root, {attestation["recordLocation"]: record_path.resolve()})

    def test_attestation_binds_retained_record_digest_and_provisional_status(self):
        record = self.build_record()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record_path = root / "docs/acceptance/v1.1/evidence/baselines/baseline.json"
            record_path.parent.mkdir(parents=True)
            record_path.write_text(json.dumps(record, sort_keys=True), encoding="utf-8")
            attestation = baseline.build_attestation(record, record_path, root=root, reviewer="test reviewer", reviewer_authority="test authority")
        self.assertEqual("provisional", attestation["recordStatus"])
        self.assertEqual("docs/acceptance/v1.1/evidence/baselines/baseline.json", attestation["recordLocation"])
        self.assertEqual(baseline.sha256_bytes(json.dumps(record, sort_keys=True).encode()), attestation["recordSha256"])
        self.assertEqual(record["candidate"]["treeSha"], attestation["candidate"]["treeSha"])
        self.assertFalse(attestation["candidate"]["dirty"])
        with self.assertRaisesRegex(ValueError, "invalid attestation status"):
            baseline.build_attestation(record, record_path, "accepted")
        try:
            import jsonschema
        except ImportError:
            pass
        else:
            schema = json.loads((self.root / baseline.ATTESTATION_SCHEMA).read_text(encoding="utf-8"))
            jsonschema.validate(attestation, schema)
            for location in ("/tmp/baseline.json", "./baseline.json", "../baseline.json", "evidence/../baseline.json", "C:\\baseline.json"):
                invalid = dict(attestation, recordLocation=location)
                with self.assertRaises(jsonschema.ValidationError):
                    jsonschema.validate(invalid, schema)

    def test_attestation_rejects_records_outside_repository_root(self):
        record = self.build_record()
        with tempfile.TemporaryDirectory() as repository, tempfile.TemporaryDirectory() as external:
            (Path(repository) / baseline.BASELINES_DIRECTORY).mkdir(parents=True)
            external_record = Path(external) / "baseline.json"
            external_record.write_text(json.dumps(record), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "canonical baseline directory"):
                baseline.build_attestation(record, external_record, root=Path(repository))

    def test_retained_evidence_rejects_external_symlink_before_parsing_or_hashing(self):
        with tempfile.TemporaryDirectory() as repository, tempfile.TemporaryDirectory() as external:
            root = Path(repository)
            baseline_dir = root / baseline.BASELINES_DIRECTORY
            baseline_dir.mkdir(parents=True)
            outside = Path(external) / "not-json.json"
            outside.write_text("not json", encoding="utf-8")
            (baseline_dir / "escaped.json").symlink_to(outside)
            with self.assertRaisesRegex(ValueError, "canonical baseline directory"):
                baseline.validate_retained_baselines(root)

    def test_retained_evidence_rejects_duplicate_resolved_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline_dir = root / baseline.BASELINES_DIRECTORY
            baseline_dir.mkdir(parents=True)
            record = self.build_record()
            target = baseline_dir / "baseline.json"
            target.write_text(json.dumps(record), encoding="utf-8")
            (baseline_dir / "duplicate.json").symlink_to(target.name)
            with self.assertRaisesRegex(ValueError, "duplicate retained baseline"):
                baseline.validate_retained_baselines(root)

    def test_retained_baseline_requires_clean_final_sibling_attestation(self):
        record = self.build_record()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for schema_path in (baseline.EVIDENCE_SCHEMA, baseline.ATTESTATION_SCHEMA):
                destination = root / schema_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes((self.root / schema_path).read_bytes())
            record_path = root / baseline.BASELINES_DIRECTORY / "baseline.json"
            record_path.parent.mkdir(parents=True)
            record_path.write_text(json.dumps(record, sort_keys=True), encoding="utf-8")
            attestation = baseline.build_attestation(
                record, record_path, "retained", root, "independent reviewer", "independent-baseline-review",
            )
            sibling = record_path.with_name("baseline.attestation.json")
            sibling.write_text(json.dumps(attestation, sort_keys=True), encoding="utf-8")
            baseline.validate_retained_baselines(root)

    def test_retained_baseline_rejects_provisional_orphan_duplicate_and_candidate_mismatch(self):
        for mutation, message in (
            ("provisional", "provisional"),
            ("orphan", "exactly one sibling"),
            ("duplicate", "duplicate retained attestations"),
            ("candidate-mismatch", "candidate SHA/tree/status identity"),
        ):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for schema_path in (baseline.EVIDENCE_SCHEMA, baseline.ATTESTATION_SCHEMA):
                    destination = root / schema_path
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes((self.root / schema_path).read_bytes())
                record = self.build_record()
                record_path = root / baseline.BASELINES_DIRECTORY / "baseline.json"
                record_path.parent.mkdir(parents=True)
                record_path.write_text(json.dumps(record, sort_keys=True), encoding="utf-8")
                status = "provisional" if mutation == "provisional" else "retained"
                attestation = baseline.build_attestation(
                    record, record_path, status, root, "independent reviewer", "independent-baseline-review",
                )
                if mutation == "candidate-mismatch":
                    attestation["candidate"]["treeSha"] = "0" * 40
                if mutation != "orphan":
                    sibling = record_path.with_name("baseline.attestation.json")
                    sibling.write_text(json.dumps(attestation, sort_keys=True), encoding="utf-8")
                if mutation == "duplicate":
                    duplicate = record_path.with_name("duplicate.attestation.json")
                    duplicate.write_text(json.dumps(attestation, sort_keys=True), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, message):
                    baseline.validate_retained_baselines(root)


if __name__ == "__main__":
    unittest.main()
