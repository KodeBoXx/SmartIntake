#!/usr/bin/env python3
"""Focused tests for the M0 aggregate input checker."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("check_m0.py")
SPEC = importlib.util.spec_from_file_location("check_m0", MODULE_PATH)
assert SPEC and SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)


class M0CheckerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).resolve().parents[2]

    def test_diagnostic_checks_all_other_surfaces_but_keeps_denial_block(self) -> None:
        results = checker.run_all(self.root, diagnostic=True)
        self.assertFalse([result for result in results if result.state == "failed"])
        self.assertTrue(any(result.name == "strict provenance gate" and result.state == "blocked" for result in results))
        self.assertTrue(all(checker.PROVENANCE_BLOCKER in result.detail for result in results if result.state == "blocked"))
        self.assertEqual(0, checker.main(["--repo-root", str(self.root), "--diagnostic"]))

    def test_strict_mode_returns_nonzero_for_the_unpublished_denial_list(self) -> None:
        results = checker.run_all(self.root, diagnostic=False)
        self.assertFalse([result for result in results if result.state == "failed"])
        self.assertTrue(all(checker.PROVENANCE_BLOCKER in result.detail for result in results if result.state == "blocked"))
        self.assertEqual(1, checker.main(["--repo-root", str(self.root)]))

    def test_checksum_parser_rejects_duplicate_and_malformed_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "SHA256SUMS").write_text(
                "0" * 64 + "  member.json\n" + "1" * 64 + "  member.json\n", encoding="utf-8"
            )
            _, error = checker.parse_sha256sums(directory)
            self.assertEqual("duplicate SHA256SUMS entry member.json", error)
            (directory / "SHA256SUMS").write_text("not-a-checksum\n", encoding="utf-8")
            _, error = checker.parse_sha256sums(directory)
            self.assertEqual("malformed SHA256SUMS line 1", error)

    def test_only_m0_paths_are_permitted_in_the_foundation_worktree(self) -> None:
        self.assertTrue(checker.allowed_m0_path("docs/acceptance/v1.1/README.md"))
        self.assertTrue(checker.allowed_m0_path("tools/acceptance/check_m0.py"))
        self.assertTrue(checker.allowed_m0_path(".gitignore"))
        self.assertFalse(checker.allowed_m0_path("backend/src/main/java/App.java"))


if __name__ == "__main__":
    unittest.main()
