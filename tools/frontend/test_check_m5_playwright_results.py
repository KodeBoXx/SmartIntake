#!/usr/bin/env python3
"""Mutation coverage for denominator-derived Playwright result enforcement."""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('m5_playwright_result_checker', ROOT / 'tools/frontend/check_m5_playwright_results.py')
assert SPEC and SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


def passing_result() -> dict[str, object]:
    titles, _, _ = checker.expected_titles()
    return {
        'suites': [{
            'specs': [{
                'title': title,
                'tests': [{
                    'projectName': 'chromium',
                    'status': 'expected',
                    'results': [{'status': 'passed'}],
                }],
            } for title in sorted(titles)],
        }],
    }


class PlaywrightResultMutationTests(unittest.TestCase):
    def test_accepts_complete_denominator_derived_results(self) -> None:
        checker.verify_result(passing_result())

    def test_rejects_result_with_mutated_state_case(self) -> None:
        result = passing_result()
        spec = result['suites'][0]['specs'][0]
        spec['title'] = 'renders M5 staff screen catalog in ready'
        with self.assertRaises(SystemExit):
            checker.verify_result(result)

    def test_rejects_result_with_mutated_execution_status(self) -> None:
        result = passing_result()
        spec = result['suites'][0]['specs'][0]
        spec['tests'][0]['results'][0]['status'] = 'skipped'
        with self.assertRaises(SystemExit):
            checker.verify_result(result)


if __name__ == '__main__':
    unittest.main()
