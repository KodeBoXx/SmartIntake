#!/usr/bin/env python3
"""Require complete, denominator-derived Chromium evidence for the M5 browser corpus."""
from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterator
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AXE_TITLES = {
    'runs axe for sign-in; automated evidence is not human accessibility acceptance',
    'runs axe for catalog; automated evidence is not human accessibility acceptance',
    'runs axe for builder; automated evidence is not human accessibility acceptance',
    'runs axe for denied staff no-access; automated evidence is not human accessibility acceptance',
    'runs axe for public form; automated evidence is not human accessibility acceptance',
    'runs axe for public review; automated evidence is not human accessibility acceptance',
    'runs axe for receipt; automated evidence is not human accessibility acceptance',
}


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


def expected_titles(root: Path = ROOT) -> tuple[set[str], int, int]:
    corpus = json.loads((root / 'frontend/e2e/m5-route-corpus.json').read_text())
    ui_total = json.loads((root / corpus['authority']['uiTotal']).read_text())
    ui_staff = json.loads((root / corpus['authority']['uiStaffTotal']).read_text())
    route_titles = {
        f'opens and reloads {member["title"]} in {state}'
        for member in ui_total['members']
        for state in member['states'].split('/')
    }
    staff_titles = {
        f'renders M5 staff screen {member["screen"]} in {state}'
        for member in ui_staff['members']
        for state in member['required_states']
    }
    expected = route_titles | staff_titles | AXE_TITLES | {
        'preserves protected deep links through the M5 stub guard',
        'synchronizes every detail drawer close path and restores focus',
        'preserves a single staff banner at the 900px breakpoint',
        'keeps guarded M1 compatibility shell-less with its own viewport landmarks',
        'M1 author, save, publish, respondent, and response administration remain reachable',
    }
    return expected, len(route_titles), len(staff_titles)


def verify_result(result: dict[str, object], root: Path = ROOT) -> None:
    expected, route_case_count, staff_case_count = expected_titles(root)
    source = (root / 'frontend/e2e/m5-shell.spec.ts').read_text()
    for required in ('uiTotal.members.flatMap', 'uiStaffTotal.members.flatMap', 'opens and reloads ${route.id} in ${route.state}', 'renders M5 staff screen ${staffCase.screen} in ${staffCase.state}'):
        if required not in source:
            fail(f'browser source no longer derives semantic test cases from authority: {required}')
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
        fail(f'expected exact denominator-derived browser test set; missing={missing}, unexpected={unexpected}')
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
        fail('not every expected route/state/browser spec ran in Chromium')
    print(f'M5 Playwright result guard verified {route_case_count} denominator route-state cases, {staff_case_count} denominator staff-state cases, {len(AXE_TITLES)} narrowly scoped axe cases, and {chromium_runs} Chromium passes')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--results', required=True)
    args = parser.parse_args()
    result_path = Path(args.results)
    if not result_path.is_absolute():
        result_path = Path.cwd() / result_path
    if not result_path.is_file():
        fail(f'missing deterministic result file: {result_path}')
    verify_result(json.loads(result_path.read_text()))


if __name__ == '__main__':
    main()
