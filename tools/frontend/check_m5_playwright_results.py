#!/usr/bin/env python3
"""Require complete, successful Chromium evidence for the frozen M5 browser corpus."""
from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterator
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def fail(message: str) -> None:
    print(f'M5 Playwright result guard failed: {message}', file=sys.stderr)
    raise SystemExit(1)


def specs(node: object) -> Iterator[dict[str, object]]:
    if not isinstance(node, dict):
        return
    for spec in node.get('specs', []):
        if isinstance(spec, dict):
            yield spec
    for suite in node.get('suites', []):
        yield from specs(suite)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--results', required=True)
    args = parser.parse_args()
    result_path = Path(args.results)
    if not result_path.is_absolute():
        result_path = Path.cwd() / result_path
    if not result_path.is_file():
        fail(f'missing deterministic result file: {result_path}')
    result = json.loads(result_path.read_text())
    corpus = json.loads((ROOT / 'frontend/e2e/m5-route-corpus.json').read_text())
    route_titles = {f'opens and reloads {item["id"]}' for item in corpus['routes']}
    staff_titles = {f'renders M5 staff screen {screen}' for screen in corpus['staffScreens']}
    axe_titles = {
        'runs axe for sign-in; automated evidence is not human accessibility acceptance',
        'runs axe for catalog; automated evidence is not human accessibility acceptance',
        'runs axe for builder; automated evidence is not human accessibility acceptance',
        'runs axe for denied staff no-access; automated evidence is not human accessibility acceptance',
        'runs axe for public form; automated evidence is not human accessibility acceptance',
        'runs axe for public review; automated evidence is not human accessibility acceptance',
        'runs axe for receipt; automated evidence is not human accessibility acceptance',
    }
    expected = route_titles | staff_titles | axe_titles | {
        'preserves protected deep links through the M5 stub guard',
        'uses a deep-linked right drawer for details',
        'M1 author, save, publish, respondent, and response administration remain reachable',
    }
    observed: dict[str, dict[str, object]] = {}
    for spec in specs(result):
        title = spec.get('title')
        if not isinstance(title, str):
            fail('encountered an unnamed browser spec')
        if title in observed:
            fail(f'duplicate browser spec result: {title}')
        observed[title] = spec
    missing = sorted(expected - observed.keys())
    unexpected = sorted(observed.keys() - expected)
    if missing or unexpected:
        fail(f'expected exact browser test set; missing={missing}, unexpected={unexpected}')
    chromium_runs = 0
    for title, spec in observed.items():
        tests = spec.get('tests')
        if not isinstance(tests, list) or len(tests) != 1:
            fail(f'{title} does not have exactly one project result')
        test = tests[0]
        if not isinstance(test, dict) or test.get('projectName') != 'chromium':
            fail(f'{title} did not run in the real Chromium project')
        results = test.get('results')
        if not isinstance(results, list) or len(results) != 1 or not isinstance(results[0], dict):
            fail(f'{title} does not have exactly one execution result')
        if results[0].get('status') != 'passed' or test.get('status') != 'expected':
            fail(f'{title} did not pass: test={test.get("status")}, result={results[0].get("status")}')
        chromium_runs += 1
    if chromium_runs != len(expected):
        fail('not every expected browser spec ran in Chromium')
    print(f'M5 Playwright result guard verified {len(route_titles)} route IDs, {len(staff_titles)} staff screens, {len(axe_titles)} axe cases, and {chromium_runs} Chromium passes')


if __name__ == '__main__':
    main()
