#!/usr/bin/env python3
"""Fail closed when the frozen M4 denominator or executable evidence map drifts."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DENOMINATOR = ROOT / "docs/acceptance/v1.1/denominators/c-total.json"
CORPUS = ROOT / "tools/runtime/m4-runtime-corpus.json"
TEST_ROOT = ROOT / "backend/src/test/java/com/kodeboxx/smartintake/contract"


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    denominator = json.loads(DENOMINATOR.read_text())
    corpus = json.loads(CORPUS.read_text())
    expected = [record["id"] for record in denominator["members"]]
    actual = [record["id"] for record in corpus["records"]]
    if len(expected) != 24 or corpus["compilerGraphDenominator"] != 24:
        fail("M4 compiler/graph denominator must remain exactly 24")
    if len(actual) != len(set(actual)) or set(actual) != set(expected):
        fail("M4 compiler/graph evidence must cover every frozen C_total ID exactly once")
    if corpus["fieldCatalogRows"] != 17 or corpus["answerStatuses"] != 6:
        fail("M4 field/status denominators changed")
    if corpus["nestedRepeaterLevels"] != 3 or corpus["forgedProtectedValuesAccepted"] != 0:
        fail("M4 nesting/protected-value acceptance changed")
    sources = "\n".join(path.read_text() for path in TEST_ROOT.rglob("*Tests.java"))
    for record in corpus["records"]:
        method = record["evidence"].split(".", 1)[1]
        if f"void {method}(" not in sources and f"Stream<DynamicTest> {method}(" not in sources:
            fail(f"M4 evidence method is absent: {record['evidence']}")
    print("M4 corpus guard passed: C_total=24, field rows=17, statuses=6, nesting=3, forged=0")


if __name__ == "__main__":
    main()
