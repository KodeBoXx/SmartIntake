#!/usr/bin/env python3
"""Verify the pinned Certinal snapshot and its Angular workspace materialization."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROVENANCE = ROOT / "tools/certinal/certinal-ui.provenance.json"


def digest_tree(path: Path) -> tuple[int, str]:
    entries = []
    for candidate in sorted((item for item in path.rglob("*") if item.is_file()), key=lambda item: item.as_posix()):
        rel = candidate.relative_to(ROOT).as_posix()
        entries.append(f"{hashlib.sha256(candidate.read_bytes()).hexdigest()}  {rel}\n")
    return len(entries), hashlib.sha256("".join(entries).encode()).hexdigest()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fail(message: str) -> None:
    print(f"certinal verification failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    provenance = json.loads(PROVENANCE.read_text())
    snapshot = ROOT / provenance["snapshotRoot"]
    library = ROOT / provenance["libraryRoot"]
    materialized = ROOT / provenance["materializedRoot"]

    count, digest = digest_tree(snapshot)
    if (count, digest) != (provenance["snapshotFileCount"], provenance["snapshotDigest"]):
        fail(f"snapshot expected {provenance['snapshotFileCount']}/{provenance['snapshotDigest']}, got {count}/{digest}")

    count, digest = digest_tree(library)
    if (count, digest) != (provenance["libraryFileCount"], provenance["libraryDigest"]):
        fail(f"library expected {provenance['libraryFileCount']}/{provenance['libraryDigest']}, got {count}/{digest}")

    source_files = {item.relative_to(library): item for item in library.rglob("*") if item.is_file()}
    wrapper_files = {Path(item) for item in provenance["materializationWrapperFiles"]}
    materialized_files = {
        item.relative_to(materialized): item
        for item in materialized.rglob("*")
        if item.is_file() and item.relative_to(materialized) not in wrapper_files
    }
    if source_files.keys() != materialized_files.keys():
        missing = sorted(str(path) for path in source_files.keys() - materialized_files.keys())
        unexpected = sorted(str(path) for path in materialized_files.keys() - source_files.keys())
        fail(f"materialization file set differs; missing={missing}, unexpected={unexpected}")
    for relative, source in source_files.items():
        if source.read_bytes() != materialized_files[relative].read_bytes():
            fail(f"materialized file differs from authoritative snapshot: {relative}")

    package = json.loads((library / "package.json").read_text())
    version_source = (library / "src/lib/version.ts").read_text()
    if package.get("name") != "@certinal/ui" or package.get("version") != provenance["version"]:
        fail("package name/version is not @certinal/ui@0.0.1")
    if f"CERTINAL_UI_VERSION = '{provenance['version']}'" not in version_source:
        fail("CERTINAL_UI_VERSION does not match package version")
    for relative, expected in {
        "package.json": provenance["packageJsonSha256"],
        "src/public-api.ts": provenance["publicApiSha256"],
    }.items():
        actual = sha256(library / relative)
        if actual != expected:
            fail(f"{relative} digest expected {expected}, got {actual}")

    generated = subprocess.run(
        [sys.executable, str(snapshot / "scripts/extract-component-api.py"), str(library / "src/lib")],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    reference = (snapshot / "references/component-api.md").read_text()
    if generated != reference:
        fail("generated component API differs from authoritative references/component-api.md")
    if hashlib.sha256(generated.encode()).hexdigest() != provenance["componentApiSha256"]:
        fail("component API digest differs from pinned inventory")
    public_api = (library / "src/public-api.ts").read_text()
    required_exports = [
        "export { CERTINAL_UI_VERSION } from './lib/version';",
        "export * from './lib/primitives';",
        "export * from './lib/blocks';",
        "export * from './lib/sections';",
        "export * from './lib/layouts';",
    ]
    if any(line not in public_api for line in required_exports):
        fail("public-api.ts no longer exports the authoritative barrels")

    root_styles = (ROOT / "frontend/src/styles.css").read_text()
    for style_import in (
        '@import "../projects/certinal-ui/src/styles/tokens.css";',
        '@import "../projects/certinal-ui/src/styles/typography.css";',
    ):
        if root_styles.count(style_import) != 1:
            fail(f"root styles must import {style_import} exactly once")
    if '@import "tailwindcss";' in root_styles:
        fail("root styles duplicate Tailwind; tokens.css owns the single Tailwind import")
    for variable in ("--color-bg-surface", "--color-border-default", "--shadow-sm", "--shadow-md", "--shadow-lg", "--shadow-xl"):
        if variable not in root_styles:
            fail(f"root styles omit required plain :root override {variable}")

    index_html = (ROOT / "frontend/src/index.html").read_text()
    required_font_href = "DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500"
    if required_font_href not in index_html:
        fail("index.html does not load the authoritative DM Sans and DM Mono declaration")

    print(
        "certinal snapshot verified: "
        f"@certinal/ui@{provenance['version']}; {provenance['snapshotFileCount']} snapshot files; "
        "component inventory matches generated authority"
    )


if __name__ == "__main__":
    main()
