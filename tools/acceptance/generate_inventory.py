#!/usr/bin/env python3
"""Generate and verify the M0 Smart Form Builder Lite v1.1 inventory.

The repository handoff is the sole normative input.  This script deliberately
reports current repository observations without assigning implementation or
acceptance status.  Output is canonical JSON so a review can compare it by
digest instead of trusting a hand-maintained denominator.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

EXPECTED = {"requirements": 95, "core": 83, "enhancement": 12,
            "fixtures": 31, "operators": 34, "vectors": 101}
EXPECTED_FIXTURES = [f"T{i:02d}" for i in range(1, 16)] + [f"T{i:02d}" for i in range(17, 33)]
PRD = Path("docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md")
HANDOFF = Path("docs/source-handoff/smart-form-builder-lite-prd-v1.1")
_ROOT: Path | None = None


class InventoryError(ValueError):
    """Raised when an authoritative denominator cannot be reproduced."""


def die_if(condition: bool, message: str) -> None:
    if condition:
        raise InventoryError(message)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines()


def line_for(lines: list[str], pattern: str, start: int = 0) -> int:
    compiled = re.compile(pattern)
    for number, line in enumerate(lines[start:], start + 1):
        if compiled.search(line):
            return number
    raise InventoryError(f"could not locate source rule {pattern!r}")


def source(path: Path, line: int | None = None, rule: str | None = None) -> dict[str, Any]:
    display_path = path
    if _ROOT is not None:
        try:
            display_path = path.relative_to(_ROOT)
        except ValueError:
            pass
    item: dict[str, Any] = {"path": display_path.as_posix(), "sha256": digest(path)}
    if line is not None:
        item["line"] = line
    if rule is not None:
        item["rule"] = rule
    return item


def parse_requirements(root: Path, prd_lines: list[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    disposition_path = root / HANDOFF / "requirement-dispositions.csv"
    with disposition_path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    required_columns = {"requirementId", "disposition", "baseline", "acceptance", "currentRequirement"}
    die_if(not rows or set(rows[0]) != required_columns, "requirement disposition columns drifted")

    prd_rows: dict[str, tuple[str, str, str, int]] = {}
    matcher = re.compile(r"^\| (SF-[A-Z]+-\d{2}) \| ([CE]) \| (.*?) \| (T\d{2}(?:, T\d{2})*) \|$")
    for number, line in enumerate(prd_lines, 1):
        match = matcher.match(line)
        if not match:
            continue
        requirement_id, requirement_class, story, fixture_text = match.groups()
        if requirement_id in prd_rows:
            die_if(prd_rows[requirement_id][:3] != (requirement_class, story, fixture_text),
                   f"conflicting PRD rows for {requirement_id}")
            continue  # Repeated table rows are allowed only when byte-equivalent.
        prd_rows[requirement_id] = (requirement_class, story, fixture_text, number)

    seen: set[str] = set()
    requirements: list[dict[str, Any]] = []
    fixture_members: dict[str, list[str]] = {fixture: [] for fixture in EXPECTED_FIXTURES}
    for row in rows:
        requirement_id = row["requirementId"]
        die_if(requirement_id in seen, f"duplicate requirement disposition {requirement_id}")
        seen.add(requirement_id)
        die_if(requirement_id not in prd_rows, f"{requirement_id} is absent from a PRD requirement table")
        requirement_class, story, fixture_text, line = prd_rows[requirement_id]
        fixtures = re.findall(r"T\d{2}", row["acceptance"])
        die_if(not fixtures, f"{requirement_id} has no fixture mapping")
        die_if(len(fixtures) != len(set(fixtures)), f"{requirement_id} repeats a fixture mapping")
        die_if(fixture_text != ", ".join(fixtures), f"fixture mapping drift for {requirement_id}")
        die_if(story != row["currentRequirement"], f"requirement text drift for {requirement_id}")
        for fixture in fixtures:
            die_if(fixture not in fixture_members, f"{requirement_id} maps unsupported fixture {fixture}")
            fixture_members[fixture].append(requirement_id)
        requirements.append({
            "id": requirement_id,
            "class": requirement_class,
            "disposition": row["disposition"],
            "baseline": row["baseline"],
            "fixtures": fixtures,
            "source": source(root / PRD, line, "normative requirement table"),
        })

    fixture_rows: dict[str, int] = {}
    for number, line in enumerate(prd_lines, 1):
        match = re.match(r"^\| (T\d{2})(?: [^|]*)? \|", line)
        if match and match.group(1) in fixture_members:
            fixture_rows.setdefault(match.group(1), number)
    fixtures = []
    for fixture in EXPECTED_FIXTURES:
        die_if(not fixture_members[fixture], f"orphan fixture {fixture}")
        die_if(fixture not in fixture_rows, f"fixture {fixture} lacks a PRD fixture-table row")
        fixtures.append({"id": fixture, "requirements": fixture_members[fixture],
                         "source": source(root / PRD, fixture_rows[fixture], "§17 fixture table")})
    return requirements, fixtures


def parse_exclusions(root: Path, prd_lines: list[str]) -> list[dict[str, Any]]:
    exclusions = []
    for number, line in enumerate(prd_lines, 1):
        match = re.match(r"^\| (X0[1-6]) \| (.+) \|$", line)
        if match:
            exclusions.append({"id": match.group(1), "rule": match.group(2),
                               "source": source(root / PRD, number, "§1.2 explicit exclusion")})
    die_if([item["id"] for item in exclusions] != [f"X0{i}" for i in range(1, 7)],
           "X01–X06 exclusion inventory drifted")
    return exclusions


def parse_expression(root: Path, prd_lines: list[str]) -> dict[str, Any]:
    path = root / HANDOFF / "expression-contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    die_if(contract.get("status") != "normative-specification", "expression input is not normative")
    operators = contract.get("operators")
    vectors = contract.get("vectors")
    die_if(not isinstance(operators, list) or not isinstance(vectors, list), "expression contract lacks lists")
    operator_names = [entry.get("name") for entry in operators]
    vector_ids = [entry.get("id") for entry in vectors]
    die_if(None in operator_names or len(operator_names) != len(set(operator_names)), "duplicate/blank operator")
    die_if(None in vector_ids or len(vector_ids) != len(set(vector_ids)), "duplicate/blank expression vector")
    die_if(any("skip" in str(entry.get("status", "")).lower() for entry in vectors),
           "normative expression vector has a skip status")
    operators_line = line_for(prd_lines, r'^  "operators": \[')
    vectors_line = line_for(prd_lines, r'^  "vectors": \[')
    return {
        "contract": {"schemaVersion": contract.get("schemaVersion"),
                     "engineContract": contract.get("engineContract"),
                     "contractVersion": contract.get("contractVersion"),
                     "source": source(path, 1, "matching Appendix D extract")},
        "operators": [{"name": entry["name"], "arity": entry.get("arity"),
                       "resultType": entry.get("resultType"),
                       "source": source(root / PRD, operators_line, "Appendix D operator registry")}
                      for entry in operators],
        "vectors": [{"id": entry["id"], "name": entry.get("name"), "phase": entry.get("phase"),
                     "declaredStatus": entry.get("status"),
                     "source": source(root / PRD, vectors_line, "Appendix D fixed vector list")}
                    for entry in vectors],
    }


def table_operations(lines: list[str], first: int, last: int, source_path: Path) -> list[dict[str, Any]]:
    operations: list[dict[str, Any]] = []
    for number in range(first, last + 1):
        match = re.match(r"^\| `([A-Z]+(?:/[A-Z]+)*)( /v1/[^`? ]+)(?:\?[^`]*)?` \|", lines[number - 1])
        if not match:
            continue
        verbs, path = match.groups()
        for verb in verbs.split("/"):
            operations.append({"verb": verb, "path": path,
                               "source": source(source_path, number, "normative API table")})
    return operations


def parse_normative_operations(root: Path, prd_lines: list[str]) -> dict[str, Any]:
    # Sections 11.2, 11.4, 11.5 and Appendix A are the only named-operation tables.
    operations = (table_operations(prd_lines, 549, 564, root / PRD) +
                  table_operations(prd_lines, 578, 588, root / PRD) +
                  table_operations(prd_lines, 594, 602, root / PRD) +
                  table_operations(prd_lines, 1020, 1040, root / PRD))
    keys = [f"{operation['verb']} {operation['path']}" for operation in operations]
    die_if(len(keys) != len(set(keys)), "duplicate normative verb+path operation")
    die_if(len(keys) != 53, f"normative API operation count drifted: expected 53, got {len(keys)}")
    return {"countingRule": "One operation equals one distinct HTTP verb plus canonical path; query examples are not part of the path.",
            "count": len(keys), "operations": operations,
            "supportingCrudRule": "§11.5 requires supporting CRUD but does not name finite verb+path members; it is intentionally not included in O_named.",
            "source": source(root / PRD, 549, "§11 and Appendix A named operation tables")}


def parse_current_routes(root: Path) -> dict[str, Any]:
    controller = root / "backend/src/main/java/com/kodeboxx/smartintake/SmartIntakeApplication.java"
    lines = read_lines(controller)
    prefix = "/v1"
    routes = []
    annotation = re.compile(r'@(Get|Post|Put|Patch|Delete)Mapping(?:\(value=)?\("([^" ]+)"\)')
    for number, line in enumerate(lines, 1):
        for match in annotation.finditer(line):
            verb = match.group(1).upper()
            suffix = match.group(2)
            routes.append({"verb": verb, "path": prefix + suffix,
                           "source": source(controller, number, "Spring mapping annotation")})
    keys = [f"{item['verb']} {item['path']}" for item in routes]
    die_if(len(keys) != len(set(keys)), "duplicate current controller route")

    openapi = root / "docs/api/openapi.yaml"
    openapi_lines = read_lines(openapi)
    documented = []
    current_path = None
    for number, line in enumerate(openapi_lines, 1):
        path_match = re.match(r"^  (/[^:]+):$", line)
        if path_match:
            current_path = path_match.group(1)
        inline = re.match(r"^  (/[^:]+): \{ (get|post|put|patch|delete):", line)
        if inline:
            documented.append({"verb": inline.group(2).upper(), "path": inline.group(1),
                               "source": source(openapi, number, "OpenAPI inline path")})
        if current_path:
            for verb in re.findall(r"\b(get|post|put|patch|delete):", line):
                documented.append({"verb": verb.upper(), "path": current_path,
                                   "source": source(openapi, number, "OpenAPI operation")})
    document_keys = [f"{item['verb']} {item['path']}" for item in documented]
    die_if(len(document_keys) != len(set(document_keys)), "duplicate documented current OpenAPI operation")
    return {"controller": {"routes": routes, "count": len(routes), "source": source(controller, 10, "current controller")},
            "openapi": {"operations": documented, "count": len(documented), "source": source(openapi, 1, "current OpenAPI document")}}


def current_contract_inventory(root: Path) -> dict[str, Any]:
    contract_dir = root / "docs/contracts/smart-form-builder-lite/4.0.0"
    artifacts = []
    for path in sorted(contract_dir.iterdir()):
        if not path.is_file():
            continue
        item = {"path": path.relative_to(root).as_posix(), "sha256": digest(path),
                "source": source(path, 1, "current versioned contract artifact")}
        if path.suffix == ".json":
            parsed = json.loads(path.read_text(encoding="utf-8"))
            item["declaredSchema"] = parsed.get("$schema")
            item["declaredId"] = parsed.get("$id")
            item["title"] = parsed.get("title")
        artifacts.append(item)
    return {"observedVersionDirectory": "4.0.0", "artifacts": artifacts,
            "normativeExpectation": {"schemaVersion": "4.0.0", "engineContract": "4.0.0",
              "source": source(root / HANDOFF / "expression-contract.json", 2, "Appendix D version declarations")}}


def current_migrations(root: Path) -> list[dict[str, Any]]:
    migration_dir = root / "backend/src/main/resources/db/migration"
    migrations = []
    for version in range(1, 5):
        found = list(migration_dir.glob(f"V{version}__*.sql"))
        die_if(len(found) != 1, f"expected one V{version} migration, found {len(found)}")
        path = found[0]
        migrations.append({"version": f"V{version}", "path": path.relative_to(root).as_posix(),
                           "sha256": digest(path),
                           "source": source(path, 1, "preserved Flyway migration")})
    return migrations


def current_ui_inventory(root: Path) -> dict[str, Any]:
    package = root / "frontend/package.json"
    app = root / "frontend/src/app/app.component.ts"
    angular = root / "frontend/angular.json"
    package_data = json.loads(package.read_text(encoding="utf-8"))
    app_text = app.read_text(encoding="utf-8")
    dependencies = {**package_data.get("dependencies", {}), **package_data.get("devDependencies", {})}
    certinal_dependencies = sorted(name for name in dependencies if "certinal" in name.lower())
    imports = re.findall(r"^import .* from ['\"]([^'\"]+)['\"]", app_text, re.MULTILINE)
    certinal_imports = [entry for entry in imports if "certinal" in entry.lower()]
    asset_refs = [line.strip() for line in app_text.splitlines() if "certinal" in line.lower()]
    return {
        "frontendSources": [source(package, 1, "package dependencies"), source(app, 1, "standalone UI component"), source(angular, 1, "Angular workspace")],
        "routing": {"routerImportPresent": "@angular/router" in app_text or "Router" in app_text,
                    "routeDeclarationPresent": "Routes" in app_text},
        "certinal": {"packageDependencies": certinal_dependencies, "imports": certinal_imports,
                     "cuiTagCount": len(re.findall(r"<cui-[\w-]+", app_text, re.IGNORECASE)),
                     "cuiSymbolCount": len(re.findall(r"\bCui\w+", app_text)),
                     "assetReferences": asset_refs},
        "component": {"standalone": "standalone: true" in app_text,
                      "lineCount": len(app_text.splitlines())},
    }


def denial_list(root: Path) -> dict[str, Any]:
    """Represent exactly what the authoritative inputs say about removed IDs.

    The handoff asserts that seven identifiers exist, but does not enumerate
    them.  Inventing IDs would make the inventory less authoritative.  The
    unresolved identifier list is therefore a hard generation error unless a
    future authoritative handoff adds an enumerated list.
    """
    scope = root / HANDOFF / "Scope-Review.md"
    text = scope.read_text(encoding="utf-8")
    line = line_for(read_lines(scope), r"All seven formerly removed whole Core requirement IDs")
    identifiers = sorted(set(re.findall(r"(?:SF|CORE)-[A-Z]+-\d{2}", text)))
    # Scope-Review currently names no removed ID. Do not treat retained IDs as denial members.
    return {"declaredCount": 7, "identifiers": identifiers,
            "source": source(scope, line, "scope review declaration"),
            "enumerationAvailable": len(identifiers) == 7}


def build(root: Path) -> dict[str, Any]:
    global _ROOT
    _ROOT = root
    prd_path = root / PRD
    prd_lines = read_lines(prd_path)
    requirements, fixtures = parse_requirements(root, prd_lines)
    expression = parse_expression(root, prd_lines)
    denials = denial_list(root)
    counts = {"requirements": len(requirements),
              "core": sum(item["class"] == "C" for item in requirements),
              "enhancement": sum(item["class"] == "E" for item in requirements),
              "fixtures": len(fixtures), "operators": len(expression["operators"]),
              "vectors": len(expression["vectors"])}
    die_if(counts != EXPECTED, f"fixed count drift: {counts!r}")
    return {
        "format": "smart-form-builder-lite-m0-authoritative-inventory/v1",
        "authority": {"prd": source(prd_path, 1, "single-document authority"),
                      "handoffManifest": source(root / HANDOFF / "manifest.json", 1, "handoff manifest")},
        "counts": counts,
        "requirements": requirements,
        "fixtures": fixtures,
        "exclusions": parse_exclusions(root, prd_lines),
        "formerlyRemovedWholeCoreDenialList": denials,
        "expression": expression,
        "normativeApiOperations": parse_normative_operations(root, prd_lines),
        "currentRepository": {"routes": parse_current_routes(root),
                              "contracts": current_contract_inventory(root),
                              "migrationsV1ToV4": current_migrations(root),
                              "ui": current_ui_inventory(root)},
        "generationPolicy": {"deterministic": True,
                              "acceptanceStatusInferred": False,
                              "sourceDriftFailsVerification": True,
                              "duplicatesAndRequiredSkipsFailGeneration": True},
    }


def write_output(root: Path, output: Path, *, require_denial_enumeration: bool) -> None:
    inventory = build(root)
    denials = inventory["formerlyRemovedWholeCoreDenialList"]
    if require_denial_enumeration and not denials["enumerationAvailable"]:
        raise InventoryError("authoritative handoff declares seven formerly removed whole-Core IDs but does not enumerate them; refusing to invent a denial list")
    output.mkdir(parents=True, exist_ok=True)
    inventory_path = output / "inventory.json"
    inventory_path.write_text(canonical(inventory), encoding="utf-8")
    manifest = {
        "format": "smart-form-builder-lite-m0-inventory-manifest/v1",
        "generator": "tools/acceptance/generate_inventory.py",
        "inventory": {"path": "inventory.json", "sha256": digest(inventory_path)},
        "sourceChecksums": {entry["path"]: entry["sha256"] for entry in _walk_sources(inventory)},
        "counts": inventory["counts"],
        "denialListEnumerationAvailable": denials["enumerationAvailable"],
    }
    (output / "manifest.json").write_text(canonical(manifest), encoding="utf-8")
    (output / "README.md").write_text(
        "# M0 authoritative inventory\n\n"
        "Generated from the repository PRD/handoff by `tools/acceptance/generate_inventory.py`. "
        "Run `python3 tools/acceptance/generate_inventory.py --check` for the strict M0 gate. "
        "The current handoff declares seven formerly removed whole-Core IDs but does not enumerate them, "
        "so that strict gate intentionally fails rather than inventing a denial list. "
        "Use `--check --allow-unenumerated-denial-list` only to reproduce the remaining inventory while "
        "the authoritative source is corrected. This is provenance and denominator material only; it assigns "
        "no product acceptance status.\n",
        encoding="utf-8")


def _walk_sources(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        if "path" in value and "sha256" in value and set(value).issuperset({"path", "sha256"}):
            yield value
        for child in value.values():
            yield from _walk_sources(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_sources(child)


def verify(root: Path, output: Path, *, require_denial_enumeration: bool) -> None:
    inventory_path = output / "inventory.json"
    manifest_path = output / "manifest.json"
    die_if(not inventory_path.exists() or not manifest_path.exists(), "generated inventory or manifest is missing")
    expected = build(root)
    actual = json.loads(inventory_path.read_text(encoding="utf-8"))
    die_if(actual != expected, "inventory drift: rerun generator after authoritative/source change")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    die_if(manifest.get("inventory", {}).get("sha256") != digest(inventory_path), "inventory checksum mismatch")
    source_checksums = manifest.get("sourceChecksums", {})
    for item in _walk_sources(expected):
        path = root / item["path"]
        die_if(not path.exists() or source_checksums.get(item["path"]) != digest(path),
               f"source checksum mismatch for {item['path']}")
    die_if(require_denial_enumeration and not expected["formerlyRemovedWholeCoreDenialList"]["enumerationAvailable"],
           "authoritative denial-list IDs remain unenumerated; strict M0 gate cannot pass")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, default=Path("docs/acceptance/v1.1/inventory"))
    parser.add_argument("--check", action="store_true", help="verify checked-in output and strict provenance gates")
    parser.add_argument("--allow-unenumerated-denial-list", action="store_true",
                        help="write provisional inventory only; strict --check still fails")
    args = parser.parse_args(argv)
    root = args.repo_root.resolve()
    output = args.output if args.output.is_absolute() else root / args.output
    try:
        if args.check:
            verify(root, output, require_denial_enumeration=not args.allow_unenumerated_denial_list)
        else:
            write_output(root, output, require_denial_enumeration=not args.allow_unenumerated_denial_list)
    except (InventoryError, OSError, json.JSONDecodeError) as error:
        print(f"inventory error: {error}", file=sys.stderr)
        return 1
    print(f"inventory {'verified' if args.check else 'generated'}: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
