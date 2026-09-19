#!/usr/bin/env python3
"""Mutation coverage for checksum, denominator, and route-template authority checks."""
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


class DenominatorRouteAuthorityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.corpus = json.loads((ROOT / 'frontend/e2e/m5-route-corpus.json').read_text())
        self.ui_total = json.loads((ROOT / 'docs/acceptance/v1.1/denominators/ui-total.json').read_text())
        self.ui_staff = json.loads((ROOT / 'docs/acceptance/v1.1/denominators/ui-staff-total.json').read_text())
        self.routes = (ROOT / 'frontend/src/app/app.routes.ts').read_text()
        self.states = (ROOT / 'frontend/src/app/core/m5-session.store.ts').read_text()

    def test_rejects_omitted_staff_screen_binding(self) -> None:
        corpus = json.loads(json.dumps(self.corpus))
        del corpus['staffScreenTemplates']['catalog']
        with self.assertRaisesRegex(ValueError, 'does not discover every UI_staff_total screen'):
            checker.validate_route_template_bindings(corpus, self.ui_total, self.ui_staff, self.routes, self.states)

    def test_rejects_wrong_path_against_authoritative_route_template(self) -> None:
        corpus = json.loads(json.dumps(self.corpus))
        corpus['staffScreenTemplates']['catalog'] = '/workspaces/:workspaceId/submissions'
        with self.assertRaisesRegex(ValueError, 'authoritative staff route-template mismatch'):
            checker.validate_route_template_bindings(corpus, self.ui_total, self.ui_staff, self.routes, self.states)

    def test_rejects_wrong_required_staff_state_category(self) -> None:
        ui_staff = json.loads(json.dumps(self.ui_staff))
        ui_staff['members'][0]['required_states'][3] = 'ready'
        with self.assertRaisesRegex(ValueError, 'required state categories mismatch'):
            checker.validate_denominator_semantics(self.ui_total, ui_staff)


if __name__ == '__main__':
    unittest.main()
