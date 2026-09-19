#!/usr/bin/env python3
"""Mutation checks for the M3 exact-parity result guard."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "tools/frontend/check_m3_expression_parity.py"
JAVA = ROOT / "backend/target/m3-expression-vectors.json"
BROWSER = ROOT / "frontend/test-results/m3-expression-vectors.json"


def run(java: Path, browser: Path, succeeds: bool) -> None:
    result = subprocess.run(
        ["python3", str(CHECKER), "--java", str(java), "--browser", str(browser)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert (result.returncode == 0) is succeeds, result.stdout + result.stderr


def write(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def main() -> None:
    run(JAVA, BROWSER, True)
    java = json.loads(JAVA.read_text(encoding="utf-8"))
    browser = json.loads(BROWSER.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(dir=Path("/var/tmp")) as directory:
        temporary = Path(directory)

        omitted = json.loads(json.dumps(browser))
        omitted["results"].pop()
        omitted_path = temporary / "omitted.json"
        write(omitted_path, omitted)
        run(JAVA, omitted_path, False)

        wrong_result = json.loads(json.dumps(browser))
        wrong_result["results"][0]["actual"]["value"] = "0"
        wrong_result_path = temporary / "wrong-result.json"
        write(wrong_result_path, wrong_result)
        run(JAVA, wrong_result_path, False)

        wrong_operator = json.loads(json.dumps(java))
        wrong_operator["operatorsDiscovered"].pop()
        wrong_operator_path = temporary / "wrong-operator.json"
        write(wrong_operator_path, wrong_operator)
        run(wrong_operator_path, BROWSER, False)

        wrong_checksum = json.loads(json.dumps(java))
        wrong_checksum["sourceSha256"] = "0" * 64
        wrong_checksum_path = temporary / "wrong-checksum.json"
        write(wrong_checksum_path, wrong_checksum)
        run(wrong_checksum_path, BROWSER, False)

    print("M3 parity guard mutation checks passed.")


if __name__ == "__main__":
    main()
