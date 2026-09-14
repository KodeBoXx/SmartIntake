#!/usr/bin/env python3
"""Focused unit tests for the M0 baseline record builder."""
from __future__ import annotations

import importlib.util
import sys
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

    def task_by_id(self, record, identifier):
        return next(item for item in record["tasks"] if item["id"] == identifier)

    def test_complete_record_is_non_acceptance_and_has_fixed_attempt_policy(self):
        fake = FakeExecutor()
        record = baseline.build_record(self.root, fake, "2026-09-14T00:00:00Z")
        baseline.validate_record(record)

        self.assertEqual("m0-baseline-observation", record["recordType"])
        self.assertEqual("0123456789abcdef0123456789abcdef01234567", record["candidate"]["sha"])
        self.assertFalse(record["candidate"]["dirty"])
        self.assertTrue(all(not task["acceptance"]["countsTowardAcceptance"] for task in record["tasks"]))
        self.assertTrue(all(attempt["number"] == 1 and not attempt["retried"]
                            for task in record["tasks"] for attempt in task["attempts"]))

        self.assertEqual({"numerator": 14, "denominator": 14, "unit": "manifested handoff files"},
                         self.task_by_id(record, "handoff-integrity")["denominator"])
        expression = self.task_by_id(record, "expression-execution-discovery")
        self.assertEqual(101, expression["denominator"]["denominator"])
        self.assertEqual(34, expression["denominator"]["numerator"])
        self.assertEqual(67, expression["denominator"]["notExecuted"])
        self.assertEqual("fail", self.task_by_id(record, "frontend-test-target")["status"])
        self.assertEqual("not-run", self.task_by_id(record, "openapi-semantic-validation")["status"])

    def test_postgres_block_is_distinct_and_prevents_maven_execution(self):
        fake = FakeExecutor(postgres_running=False)
        record = baseline.build_record(self.root, fake, "2026-09-14T00:00:00Z")
        prerequisite = self.task_by_id(record, "postgres-prerequisite")
        backend = self.task_by_id(record, "backend-maven-tests")
        flyway = self.task_by_id(record, "flyway-migration-application")

        self.assertEqual("blocked", prerequisite["status"])
        self.assertEqual("blocked", backend["status"])
        self.assertFalse(backend["attempts"][0]["executed"])
        self.assertEqual("not-run", backend["attempts"][0]["result"])
        self.assertEqual("blocked", flyway["status"])
        self.assertNotIn(("mvn", "-q", "test"), fake.commands)

    def test_output_summary_redacts_secret_like_values_and_is_bounded(self):
        result = baseline.CommandResult(("example",), 1, "password=hello token: abc", "x" * 5000,
                                        "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z")
        attempt = baseline.command_attempt(result)
        self.assertNotIn("hello", attempt["outputSummary"])
        self.assertNotIn("abc", attempt["outputSummary"])
        self.assertLessEqual(len(attempt["outputSummary"]), baseline.MAX_SUMMARY_CHARS + len("\n...[truncated]"))


if __name__ == "__main__":
    unittest.main()
