#!/usr/bin/env python3
"""Mutation coverage for the checksum-only M5 evaluator authority check."""
from __future__ import annotations

import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECKER_PATH = ROOT / 'tools/frontend/check_m5_route_corpus.py'
SPEC = importlib.util.spec_from_file_location('m5_route_corpus_checker', CHECKER_PATH)
assert SPEC and SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


class EvaluatorChecksumAuthorityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.evaluator = Path(self.directory.name) / 'evaluator'
        shutil.copytree(ROOT / 'docs/acceptance/v1.1/evaluator', self.evaluator)
        self.manifest = self.evaluator / 'manifest.json'

    def tearDown(self) -> None:
        self.directory.cleanup()

    def expected_digests(self) -> tuple[str, str]:
        manifest = json.loads(self.manifest.read_text())
        return checker.sha256(self.manifest), manifest['corpusDigest']

    def test_rejects_changed_evaluator_artifact_bytes(self) -> None:
        manifest_digest, corpus_digest = self.expected_digests()
        artifact = self.evaluator / json.loads(self.manifest.read_text())['artifacts'][0]['path']
        artifact.write_bytes(artifact.read_bytes() + b'\nmutation\n')
        with self.assertRaisesRegex(ValueError, 'path-to-SHA map mismatch'):
            checker.verify_evaluator_authority(self.evaluator, self.manifest, manifest_digest, corpus_digest)

    def test_rejects_manifest_artifact_sha_mismatch(self) -> None:
        manifest = json.loads(self.manifest.read_text())
        manifest['artifacts'][0]['sha256'] = '0' * 64
        self.manifest.write_text(json.dumps(manifest, indent=2) + '\n')
        manifest_digest, corpus_digest = self.expected_digests()
        with self.assertRaisesRegex(ValueError, 'path-to-SHA map mismatch'):
            checker.verify_evaluator_authority(self.evaluator, self.manifest, manifest_digest, corpus_digest)


if __name__ == '__main__':
    unittest.main()
