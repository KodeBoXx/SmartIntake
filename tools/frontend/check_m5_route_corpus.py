#!/usr/bin/env python3
"""Fail closed if the M5 browser corpus diverges from frozen authority."""
from __future__ import annotations
import hashlib, importlib.util, json, pathlib, re, subprocess, sys

root = pathlib.Path(__file__).resolve().parents[2]


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evaluator_digest_helper():
    helper_path = root / 'docs/acceptance/v1.1/evaluator/tools/validate_corpus.py'
    spec = importlib.util.spec_from_file_location('m5_evaluator_digest_helper', helper_path)
    if spec is None or spec.loader is None:
        raise RuntimeError('cannot import evaluator corpus digest helper')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def artifact_map(manifest: dict[str, object]) -> dict[str, str]:
    artifacts = manifest.get('artifacts')
    if not isinstance(artifacts, list):
        raise ValueError('evaluator manifest artifacts must be a list')
    listed: dict[str, str] = {}
    for artifact in artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get('path'), str) or not isinstance(artifact.get('sha256'), str):
            raise ValueError('evaluator manifest artifact must contain path and sha256 strings')
        path, digest = artifact['path'], artifact['sha256']
        if pathlib.PurePosixPath(path).is_absolute() or '..' in pathlib.PurePosixPath(path).parts or not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise ValueError(f'invalid evaluator manifest artifact: {path!r}')
        if path in listed:
            raise ValueError(f'duplicate evaluator manifest artifact: {path}')
        listed[path] = digest
    return listed


def verify_evaluator_authority(evaluator_root: pathlib.Path, manifest_path: pathlib.Path, expected_manifest_digest: str, expected_corpus_digest: str) -> None:
    if manifest_path.parent != evaluator_root:
        raise ValueError('evaluator manifest must be rooted in the evaluator directory')
    if sha256(manifest_path) != expected_manifest_digest:
        raise ValueError('M5 evaluator manifest digest mismatch')
    manifest = json.loads(manifest_path.read_text())
    listed = artifact_map(manifest)
    helper = evaluator_digest_helper()
    actual = {file.relative_to(evaluator_root).as_posix(): sha256(file) for file in helper.corpus_files(evaluator_root)}
    if listed != actual:
        raise ValueError('M5 evaluator artifact path-to-SHA map mismatch')
    digest = helper.corpus_digest(evaluator_root)
    if manifest.get('corpusDigest') != digest or digest != expected_corpus_digest:
        raise ValueError('M5 evaluator corpus digest mismatch')


def main() -> None:
    corpus = json.loads((root / 'frontend/e2e/m5-route-corpus.json').read_text())
    for key in ('uiTotal', 'uiStaffTotal'):
        source = root / corpus['authority'][key]
        actual = sha256(source)
        expected = corpus['authority'][f'{key}Sha256']
        if actual != expected:
            raise SystemExit(f'M5 corpus authority digest mismatch for {key}: {actual} != {expected}')
    ui_total = json.loads((root / corpus['authority']['uiTotal']).read_text())
    ui_staff = json.loads((root / corpus['authority']['uiStaffTotal']).read_text())
    if len(corpus['routes']) != ui_total['total'] or {case['id'] for case in corpus['routes']} != {member['title'] for member in ui_total['members']}:
        raise SystemExit('M5 route corpus does not discover every UI_total member exactly once')
    if len(corpus['staffScreens']) != ui_staff['total'] or set(corpus['staffScreens']) != {member['screen'] for member in ui_staff['members']}:
        raise SystemExit('M5 staff corpus does not discover every UI_staff_total member exactly once')
    authority = corpus['authority']
    manifest = root / authority['evaluatorManifest']
    try:
        verify_evaluator_authority(manifest.parent, manifest, authority['evaluatorManifestSha256'], authority['corpusDigest'])
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f'M5 evaluator checksum authority validation failed: {error}') from error
    for path in ('frontend/e2e', 'frontend/playwright.config.ts'):
        for file in (root / path).rglob('*') if (root / path).is_dir() else [root / path]:
            if file.is_file() and re.search(r'\b(test\.(?:skip|only)|describe\.(?:skip|only)|quarantine)\b', file.read_text()):
                raise SystemExit(f'Forbidden skipped/focused/quarantined browser test marker in {file.relative_to(root)}')
    source_guard = subprocess.run([sys.executable, 'tools/frontend/check_m5_cui_source.py'], cwd=root, text=True, capture_output=True)
    if source_guard.returncode:
        raise SystemExit(f'M5 Cui source guard failed:\n{source_guard.stdout}{source_guard.stderr}')
    print(f'M5 browser corpus verified: UI_total={ui_total["total"]}, UI_staff_total={ui_staff["total"]}, evaluator={authority["corpusDigest"]}, zero skip/focus/quarantine markers')


if __name__ == '__main__':
    main()
