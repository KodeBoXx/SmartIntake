#!/usr/bin/env python3
"""Check frozen SmartIntake intent mappings against the authoritative Cui API."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "assets/certinal/certinal-ui/references/component-api.md"
MAPPING = ROOT / "docs/certinal/intent-to-cui.json"
DOCUMENT = ROOT / "docs/certinal/intent-to-cui.md"
VALID_CONTAINERS = {
    "route-shell", "main-page", "right-drawer-lg", "route-page", "route-page-action",
    "inline-edit-page-section", "danger-confirm-dialog", "anchored-dropdown-or-popover",
    "inline-alert", "toast", "frozen-existing-screen",
}
VALID_STATUSES = {"m5-shell-stub", "planned-later-milestone", "preserved-not-migrated"}


def fail(message: str) -> None:
    print(f"intent mapping verification failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    mapping = json.loads(MAPPING.read_text())
    api = API.read_text()
    available = set(re.findall(r"— (Cui[A-Za-z]+(?:Component|Service|Directive))$", api, re.MULTILINE))
    ids: set[str] = set()
    for item in mapping.get("mappings", []):
        identifier = item.get("id")
        if not isinstance(identifier, str) or not identifier or identifier in ids:
            fail(f"mapping IDs must be unique and non-empty: {identifier!r}")
        ids.add(identifier)
        if item.get("container") not in VALID_CONTAINERS:
            fail(f"{identifier} uses an unknown container {item.get('container')!r}")
        if item.get("status") not in VALID_STATUSES:
            fail(f"{identifier} uses an unknown status {item.get('status')!r}")
        components = item.get("components")
        if not isinstance(components, list):
            fail(f"{identifier} components must be a list")
        unknown = set(components) - available
        if unknown:
            fail(f"{identifier} names APIs absent from generated component API: {sorted(unknown)}")
    if len(ids) < 14 or "m1-current-ui" not in ids:
        fail("mapping must retain all frozen intents including m1-current-ui")
    if not any(item.get("status") == "m5-shell-stub" for item in mapping["mappings"]):
        fail("mapping must identify the implemented M5 shell stubs")
    if not any(item.get("status") == "planned-later-milestone" for item in mapping["mappings"]):
        fail("mapping must retain later-milestone migrations as planned")
    document = DOCUMENT.read_text()
    for item in mapping["mappings"]:
        identifier = item["id"]
        row = next((line for line in document.splitlines() if line.startswith(f"| {identifier} |")), None)
        if row is None:
            fail(f"review document does not contain mapping row {identifier}")
        if f"| {item['status']} |" not in row:
            fail(f"review document status differs from mapping for {identifier}")
    print(f"intent mapping verified: {len(ids)} intents against {len(available)} exported Cui APIs")


if __name__ == "__main__":
    main()
