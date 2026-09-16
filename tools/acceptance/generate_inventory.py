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
import tempfile
from pathlib import Path
from typing import Any, Iterable

EXPECTED = {"requirements": 95, "core": 83, "enhancement": 12,
            "fixtures": 31, "operators": 34, "vectors": 101}
EXPECTED_FIXTURES = [f"T{i:02d}" for i in range(1, 16)] + [f"T{i:02d}" for i in range(17, 33)]
PRD = Path("docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md")
HANDOFF = Path("docs/source-handoff/smart-form-builder-lite-prd-v1.1")
DENIAL_LIST_ADDENDUM = HANDOFF / "formerly-removed-whole-core-id-denial-list.json"
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


def unique_line(lines: list[str], pattern: str, *, label: str) -> int:
    """Return the sole matching line; a changed document must not guess."""
    compiled = re.compile(pattern)
    matches = [number for number, line in enumerate(lines, 1) if compiled.search(line)]
    if len(matches) != 1:
        raise InventoryError(f"{label} anchor is {'missing' if not matches else 'ambiguous'} ({len(matches)} matches)")
    return matches[0]


def table_after_heading(lines: list[str], heading: str, header: str) -> tuple[int, list[tuple[int, str]]]:
    """Locate a uniquely named Markdown table without depending on line slices."""
    heading_line = unique_line(lines, rf"^{re.escape(heading)}$", label=heading)
    heading_level = len(heading) - len(heading.lstrip("#"))
    boundary = len(lines)
    for number in range(heading_line + 1, len(lines) + 1):
        line = lines[number - 1]
        if re.match(rf"^#{{1,{heading_level}}} ", line):
            boundary = number - 1
            break
    header_lines = [number for number in range(heading_line + 1, boundary + 1)
                    if re.match(header, lines[number - 1])]
    if len(header_lines) != 1:
        raise InventoryError(f"{heading} table header is {'missing' if not header_lines else 'ambiguous'} ({len(header_lines)} matches)")
    start = header_lines[0] + 2  # Header separator is mandatory Markdown table syntax.
    die_if(start > boundary or not re.match(r"^\|[-:| ]+\|$", lines[header_lines[0]]),
           f"{heading} table separator is missing or malformed")
    rows: list[tuple[int, str]] = []
    for number in range(start, boundary + 1):
        line = lines[number - 1]
        if not line.startswith("|"):
            break
        rows.append((number, line))
    die_if(not rows, f"{heading} table has no rows")
    return heading_line, rows


def canonical_api_path(raw_path: str) -> str:
    """Normalize only presentation whitespace, never a semantic path segment."""
    path = raw_path.strip()
    die_if(not path.startswith("/v1/"), f"normative API path is not canonical: {raw_path!r}")
    die_if(any(character.isspace() for character in path), f"normative API path contains whitespace: {raw_path!r}")
    return path


def canonical_openapi_path(path: str) -> str:
    """Resolve this repository's relative OpenAPI paths against its `/v1` server."""
    return canonical_api_path(path if path.startswith("/v1/") else "/v1" + path)


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
    operators_line = unique_line(prd_lines, r'^  "operators": \[', label="Appendix D operators")
    vectors_line = unique_line(prd_lines, r'^  "vectors": \[', label="Appendix D vectors")
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


def table_operations(lines: list[str], heading: str, source_path: Path) -> tuple[int, list[dict[str, Any]]]:
    heading_line, rows = table_after_heading(lines, heading, r"^\| (Endpoint|Canonical endpoint) \|")
    operations: list[dict[str, Any]] = []
    for number, line in rows:
        match = re.match(r"^\| `([A-Z]+(?:/[A-Z]+)*)(\s+/v1/[^`? ]+)(?:\?[^`]*)?` \|", line)
        if not match:
            continue
        verbs, raw_path = match.groups()
        path = canonical_api_path(raw_path)
        for method in verbs.split("/"):
            operations.append({"method": method, "path": path,
                               "source": source(source_path, number, "normative API table")})
    die_if(not operations, f"{heading} has no parsable normative API operations")
    return heading_line, operations


def parse_normative_operations(root: Path, prd_lines: list[str]) -> dict[str, Any]:
    # Sections 11.2, 11.4, 11.5 and Appendix A are the only named-operation tables.
    headings = ("### 11.2 Definition and publication endpoints",
                "### 11.4 Respondent session and submission endpoints",
                "### 11.5 Response, export and event APIs",
                "### Application API requirements")
    tables = [table_operations(prd_lines, heading, root / PRD) for heading in headings]
    operations = [operation for _, table in tables for operation in table]
    keys = [f"{operation['method']} {operation['path']}" for operation in operations]
    die_if(len(keys) != len(set(keys)), "duplicate normative verb+path operation")
    die_if(len(keys) != 53, f"normative API operation count drifted: expected 53, got {len(keys)}")
    asset_api_line = unique_line(prd_lines, r"assets are pre-uploaded through an authorized asset API", label="authorized asset API")
    interpretation_line = unique_line(prd_lines, r"^`GET /v1/workspaces/\{w\}/submissions/\{id\}/interpretation`", label="submission interpretation operation")
    supporting = [
        {"name": "authorized asset API", "method": None, "path": None,
         "canonicalPathAvailable": False,
         "reason": "PRD names this API but specifies neither an HTTP method nor a path; neither is inferred.",
         "source": source(root / PRD, asset_api_line, "§11.3 authorized asset API")},
        {"name": "submission interpretation", "method": "GET",
         "path": "/v1/workspaces/{w}/submissions/{id}/interpretation",
         "canonicalPathAvailable": True,
         "source": source(root / PRD, interpretation_line, "Pinned interpretation and consumer access")},
    ]
    return {"operationFieldContract": {
                "method": "Canonical uppercase HTTP method. This replaces the legacy `verb` field.",
                "path": "Canonical leading-slash path without presentation whitespace; null only when the PRD names an API without method/path.",
                "legacyVerbCompatibility": "The generated v1 inventory no longer emits `verb`; consumers must read `method`.",
            },
            "countingRule": "One O_named operation equals one distinct HTTP method plus canonical path from the four explicit endpoint tables; query examples are not part of the path.",
            "count": len(keys), "operations": operations,
            "supportingCrudRule": "§11.5 requires supporting CRUD but does not name finite verb+path members; it is intentionally not included in O_named.",
            "source": source(root / PRD, tables[0][0], "§11 and Appendix A named operation tables"),
            "tableAnchors": [{"heading": heading, "line": table[0]} for heading, table in zip(headings, tables)],
            "namedSupportingOperations": {
                "count": len(supporting),
                "operations": supporting,
                "oTotalNamedCount": len(keys) + len(supporting),
                "countingRule": "O_total named inventory is O_named plus precisely these separately cited PRD-named operations; it does not assign a route to the authorized asset API.",
            }}


def annotation_arguments(line: str, open_paren: int) -> tuple[str, int]:
    """Return annotation arguments and closing-paren index, respecting strings."""
    depth, quoted, escaped = 0, False, False
    for index in range(open_paren, len(line)):
        character = line[index]
        if quoted:
            escaped = character == "\\" and not escaped
            if character == '"' and not escaped:
                quoted = False
            elif character != "\\":
                escaped = False
            continue
        if character == '"':
            quoted = True
        elif character == '(':
            depth += 1
        elif character == ')':
            depth -= 1
            if depth == 0:
                return line[open_paren + 1:index], index
    raise InventoryError("Spring mapping annotation has unclosed arguments")


def spring_mapping_annotations(lines: list[str], controller: Path) -> list[dict[str, Any]]:
    """Extract every mapping annotation, including attributes and shared lines."""
    annotation_start = re.compile(r"@(Get|Post|Put|Patch|Delete)Mapping\s*\(")
    routes = []
    for line_number, line in enumerate(lines, 1):
        starts = list(annotation_start.finditer(line))
        for ordinal, match in enumerate(starts, 1):
            arguments, close = annotation_arguments(line, match.end() - 1)
            path_match = re.search(r'(?:^|,)\s*(?:value\s*=\s*)?"([^"\\]+)"', arguments)
            die_if(path_match is None, f"Spring mapping on line {line_number} has no literal path")
            handler_match = re.search(r"\b([A-Za-z_$][\w$]*)\s*\(", line[close + 1:])
            die_if(handler_match is None, f"Spring mapping on line {line_number} has no following handler")
            suffix = path_match.group(1)
            die_if(not suffix.startswith("/"), f"Spring mapping path is not absolute: {suffix!r}")
            annotation_text = line[match.start():close + 1]
            annotation_source = source(
                controller, line_number,
                f"Spring mapping annotation occurrence {ordinal} of {len(starts)} on physical line")
            routes.append({
                "method": match.group(1).upper(),
                "path": canonical_api_path("/v1" + suffix),
                "annotationEvidence": {
                    "text": annotation_text,
                    "occurrenceOnLine": ordinal,
                    "annotationsOnLine": len(starts),
                    "handlerName": handler_match.group(1),
                    "sharedPhysicalLine": len(starts) > 1,
                    "source": annotation_source,
                },
            })
    return routes


def parse_current_routes(root: Path) -> dict[str, Any]:
    controller = root / "backend/src/main/java/com/kodeboxx/smartintake/SmartIntakeApplication.java"
    lines = read_lines(controller)
    routes = spring_mapping_annotations(lines, controller)
    keys = [f"{item['method']} {item['path']}" for item in routes]
    die_if(len(keys) != len(set(keys)), "duplicate current controller route")
    die_if(len(routes) != 21, f"current Spring mapping count drifted: expected 21, got {len(routes)}")

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
            documented.append({"method": inline.group(2).upper(), "path": canonical_openapi_path(inline.group(1)),
                               "source": source(openapi, number, "OpenAPI inline path")})
        if current_path:
            for method in re.findall(r"\b(get|post|put|patch|delete):", line):
                documented.append({"method": method.upper(), "path": canonical_openapi_path(current_path),
                                   "source": source(openapi, number, "OpenAPI operation")})
    document_keys = [f"{item['method']} {item['path']}" for item in documented]
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


def angular_standalone_metadata(text: str) -> tuple[bool, str]:
    match = re.search(r"\bstandalone\s*:\s*(true|false)\b", text)
    die_if(match is None, "Angular component does not declare standalone metadata")
    return match.group(1) == "true", match.group(0)


STYLE_DIRECTIVE = re.compile(
    r"^\s*@(?P<kind>import|use|forward)\s+(?:url\(\s*)?['\"](?P<reference>[^'\"]+)['\"]",
    re.MULTILINE,
)
TS_IMPORT_SPECIFIER = re.compile(
    r"^\s*import\s+(?:(?:type\s+)?[^'\";\n]+\s+from\s+)?['\"]([^'\"]+)['\"]",
    re.MULTILINE,
)
STYLE_EXTENSIONS = (".css", ".scss", ".sass")


def path_under(path: Path, directory: Path, *, label: str) -> Path:
    """Resolve a local path without permitting it to leave the frontend tree."""
    resolved = path.resolve()
    try:
        resolved.relative_to(directory.resolve())
    except ValueError as error:
        raise InventoryError(f"{label} escapes frontend: {path.as_posix()}") from error
    return resolved


def local_style_path(frontend: Path, reference: str, base: Path) -> Path | None:
    """Resolve local CSS/Sass references; package and URL imports stay external."""
    raw = reference.split("?", 1)[0].split("#", 1)[0]
    if (not raw or raw.startswith(("http:", "https:", "//", "data:", "~", "@"))
            or not raw.startswith((".", ".."))):
        return None
    candidate = path_under(base / raw, frontend, label="local style import")
    candidates = [candidate]
    if not candidate.suffix:
        candidates.extend(candidate.with_suffix(extension) for extension in STYLE_EXTENSIONS)
        candidates.extend(candidate.with_name("_" + candidate.name).with_suffix(extension)
                          for extension in STYLE_EXTENSIONS)
    existing = [path for path in candidates if path.is_file()]
    die_if(not existing, f"local style import is missing: {reference!r} from {base.relative_to(frontend).as_posix()}")
    die_if(len(existing) > 1, f"local style import is ambiguous: {reference!r} from {base.relative_to(frontend).as_posix()}")
    return existing[0]


def angular_build_styles(frontend: Path, angular_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Read Angular build style entries in the documented string or object form."""
    entries: list[dict[str, Any]] = []
    projects = angular_data.get("projects")
    die_if(not isinstance(projects, dict) or not projects, "Angular workspace has no projects")
    for project_name, project in sorted(projects.items()):
        styles = project.get("architect", {}).get("build", {}).get("options", {}).get("styles", [])
        die_if(not isinstance(styles, list), f"Angular build styles for {project_name} are not a list")
        for index, entry in enumerate(styles):
            if isinstance(entry, str):
                form, raw_path = "string", entry
                record: dict[str, Any] = {"project": project_name, "index": index, "form": form,
                                          "input": raw_path}
            elif isinstance(entry, dict) and isinstance(entry.get("input"), str):
                form, raw_path = "object", entry["input"]
                record = {"project": project_name, "index": index, "form": form, "input": raw_path}
                for key in ("bundleName", "inject"):
                    if key in entry:
                        record[key] = entry[key]
            else:
                raise InventoryError(f"Angular build style {project_name}[{index}] must be a string or object with string input")
            die_if(Path(raw_path).is_absolute(), f"Angular build style is absolute: {raw_path!r}")
            resolved = path_under(frontend / raw_path, frontend, label="Angular build style")
            die_if(not resolved.is_file(), f"Angular build style is missing: {raw_path!r}")
            die_if(resolved.suffix not in STYLE_EXTENSIONS, f"Angular build style has unsupported extension: {raw_path!r}")
            record["source"] = source(resolved, 1, "Angular build style entry")
            entries.append(record)
    die_if(not entries, "Angular workspace has no configured build styles")
    return entries


def scan_local_styles(frontend: Path, entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Traverse local @import/@use/@forward links once, preserving cycle evidence."""
    files: list[Path] = []
    imports: list[dict[str, Any]] = []
    cycles: list[dict[str, str]] = []
    visited: set[Path] = set()
    visiting: set[Path] = set()

    def visit(path: Path) -> None:
        if path in visited:
            return
        visited.add(path)
        visiting.add(path)
        files.append(path)
        content = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.DOTALL)
        for match in STYLE_DIRECTIVE.finditer(content):
            reference = match.group("reference")
            target = local_style_path(frontend, reference, path.parent)
            if target is None:
                continue
            link = {"directive": match.group("kind"), "reference": reference,
                    "from": path.relative_to(frontend).as_posix(),
                    "to": target.relative_to(frontend).as_posix(),
                    "source": source(target, 1, "resolved local style import")}
            imports.append(link)
            if target in visiting:
                cycles.append({"from": link["from"], "to": link["to"]})
                continue
            visit(target)
        visiting.remove(path)

    for entry in entries:
        visit(frontend / entry["input"])
    return {
        "configuredBuildStyles": entries,
        "resolvedLocalStyleFiles": [source(path, 1, "configured style or recursive local style import") for path in files],
        "localImports": imports,
        "cycles": cycles,
        "cycleProtected": True,
    }


def frontend_source_files(frontend: Path) -> list[Path]:
    return sorted(path for path in (frontend / "src").rglob("*")
                  if path.is_file() and path.suffix in {".ts", ".html"})


def current_ui_inventory(root: Path) -> dict[str, Any]:
    package = root / "frontend/package.json"
    app = root / "frontend/src/app/app.component.ts"
    angular = root / "frontend/angular.json"
    package_data = json.loads(package.read_text(encoding="utf-8"))
    angular_data = json.loads(angular.read_text(encoding="utf-8"))
    app_text = app.read_text(encoding="utf-8")
    dependencies = {**package_data.get("dependencies", {}), **package_data.get("devDependencies", {})}
    style_entries = angular_build_styles(root / "frontend", angular_data)
    style_inventory = scan_local_styles(root / "frontend", style_entries)
    style_paths = {item["path"] for item in style_inventory["resolvedLocalStyleFiles"]}
    token_path = "frontend/src/assets/certinal/styles/tokens.css"
    typography_path = "frontend/src/assets/certinal/styles/typography.css"
    source_files = frontend_source_files(root / "frontend")
    source_text = {path: path.read_text(encoding="utf-8") for path in source_files}
    component_dependencies = sorted(name for name in dependencies if name == "@certinal/ui")
    component_imports = [
        {"path": path.relative_to(root).as_posix(), "specifier": specifier}
        for path, text in source_text.items()
        for specifier in TS_IMPORT_SPECIFIER.findall(text)
        if specifier == "@certinal/ui" or specifier.startswith("@certinal/ui/")
    ]
    cui_tags = [
        {"path": path.relative_to(root).as_posix(), "count": len(re.findall(r"<cui-[\w-]+", text, re.IGNORECASE))}
        for path, text in source_text.items() if re.search(r"<cui-[\w-]+", text, re.IGNORECASE)
    ]
    cui_symbols = [
        {"path": path.relative_to(root).as_posix(), "count": len(re.findall(r"\bCui\w+", text))}
        for path, text in source_text.items() if re.search(r"\bCui\w+", text)
    ]
    cui_tag_count = sum(item["count"] for item in cui_tags)
    cui_symbol_count = sum(item["count"] for item in cui_symbols)
    standalone, standalone_metadata = angular_standalone_metadata(app_text)
    return {
        "frontendSources": [source(package, 1, "package dependencies"), source(app, 1, "standalone UI component"), source(angular, 1, "Angular workspace")],
        "routing": {"routerImportPresent": "@angular/router" in app_text or "Router" in app_text,
                    "routeDeclarationPresent": "Routes" in app_text},
        "certinal": {
            "tokenStylesIntegrated": token_path in style_paths,
            "typographyStylesIntegrated": typography_path in style_paths,
            "styleIntegration": style_inventory,
            "componentLibrary": {
                "packagePresent": bool(component_dependencies),
                "packageDependencies": component_dependencies,
                "imports": component_imports,
                "cuiTagCount": cui_tag_count,
                "cuiTags": cui_tags,
                "cuiSymbolCount": cui_symbol_count,
                "cuiSymbols": cui_symbols,
                "componentUsePresent": bool(component_imports or cui_tag_count or cui_symbol_count),
            },
            "componentConformanceClaimed": False,
            "componentConformanceRule": "Token or typography style integration does not establish component-library use or conformance.",
        },
        "component": {"standalone": standalone,
                      "standaloneMetadata": standalone_metadata,
                      "lineCount": len(app_text.splitlines())},
    }


def denial_list(root: Path) -> dict[str, Any]:
    """Load only the explicitly named addendum contract, never prose IDs."""
    scope = root / HANDOFF / "Scope-Review.md"
    declaration_line = unique_line(
        read_lines(scope), r"All seven formerly removed whole Core requirement IDs remain absent and are not reused\.",
        label="scope-review denial-list declaration")
    contract = {
        "requiredPath": DENIAL_LIST_ADDENDUM.as_posix(),
        "requiredFormat": "smart-form-builder-lite-formerly-removed-whole-core-id-addendum/v1",
        "requiredSourceLabel": "authoritative-addendum",
        "requiredIdentifierCount": 7,
    }
    addendum = root / DENIAL_LIST_ADDENDUM
    declaration = source(scope, declaration_line, "scope review declaration; identifiers are not enumerated here")
    if not addendum.exists():
        return {
            "declaredCount": 7,
            "identifiers": [],
            "enumerationAvailable": False,
            "enumerationContract": contract,
            "source": declaration,
            "blocker": {"code": "denial-list-unenumerated",
                        "message": "The scope review declares seven IDs but the required authoritative addendum is absent.",
                        "sourceLabel": "scope-review-declaration",
                        "source": declaration},
        }

    payload = json.loads(addendum.read_text(encoding="utf-8"))
    die_if(payload.get("format") != contract["requiredFormat"], "denial-list addendum format drifted")
    die_if(payload.get("sourceLabel") != contract["requiredSourceLabel"], "denial-list addendum source label is not authoritative-addendum")
    identifiers = payload.get("identifiers")
    die_if(not isinstance(identifiers, list) or len(identifiers) != 7, "denial-list addendum must enumerate exactly seven IDs")
    die_if(any(not isinstance(item, str) or not re.fullmatch(r"(?:SF|CORE)-[A-Z]+-\d{2}", item) for item in identifiers),
           "denial-list addendum contains an invalid ID")
    die_if(len(set(identifiers)) != 7, "denial-list addendum contains duplicate IDs")
    return {
        "declaredCount": 7,
        "identifiers": identifiers,
        "enumerationAvailable": True,
        "enumerationContract": contract,
        "source": source(addendum, 1, "authoritative formerly removed whole-Core ID addendum"),
        "scopeReviewDeclaration": declaration,
    }


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
        raise InventoryError("denial-list-unenumerated: refusing to invent formerly removed whole-Core IDs")
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
        "Run `python3 tools/acceptance/check_m0.py` for the overall strict M0 gate; "
        "`python3 tools/acceptance/generate_inventory.py --check` verifies this inventory surface only. "
        "The current handoff has no explicitly labelled authoritative denial-list addendum, so the overall strict M0 "
        "gate remains blocked with `M0-BLOCKER: denial-list-unenumerated` rather than scanning arbitrary prose "
        "for IDs. "
        "Use `--check --allow-unenumerated-denial-list` only to reproduce the remaining inventory while "
        "the authoritative source is corrected. Run `--self-check` for focused negative anchor, path, style traversal, and "
        "denial-source tests. Operation records use `method` and canonical `path`; O_named remains 53 explicit "
        "table operations and its separately cited named-supporting inventory totals 55. This is provenance and "
        "denominator material only; it assigns no product acceptance status.\n",
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
           "denial-list-unenumerated: strict M0 gate cannot pass")


def expect_inventory_error(action: Any, required_text: str) -> None:
    try:
        action()
    except InventoryError as error:
        die_if(required_text not in str(error), f"self-check expected {required_text!r}, got {error!s}")
        return
    raise InventoryError(f"self-check expected InventoryError containing {required_text!r}")


def self_check() -> None:
    """Focused standard-library negatives for the failure-prone input rules."""
    expect_inventory_error(lambda: unique_line(["# heading", "# heading"], r"^# heading$", label="test"), "ambiguous")
    die_if(canonical_api_path(" /v1/forms ") != "/v1/forms", "self-check path normalization failed")
    expect_inventory_error(lambda: canonical_api_path(" /v2/forms"), "not canonical")
    die_if(canonical_openapi_path("/health") != "/v1/health", "self-check OpenAPI path resolution failed")
    die_if(angular_standalone_metadata("@Component({standalone:true})") != (True, "standalone:true"),
           "self-check Angular standalone:true detection failed")
    die_if(angular_standalone_metadata("@Component({ standalone : false })")[0],
           "self-check Angular standalone:false detection failed")
    die_if(TS_IMPORT_SPECIFIER.findall("import '@certinal/ui';\nimport { CuiButton } from '@certinal/ui/button';\n")
           != ["@certinal/ui", "@certinal/ui/button"],
           "self-check TypeScript component import detection failed")

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        scope = root / HANDOFF / "Scope-Review.md"
        scope.parent.mkdir(parents=True)
        scope.write_text(
            "All seven formerly removed whole Core requirement IDs remain absent and are not reused. SF-FAKE-01\n",
            encoding="utf-8")
        global _ROOT
        _ROOT = root
        controller = root / "Api.java"
        controller.write_text(
            '@GetMapping(value="/items",produces="application/json") List<String> list(){} '
            '@PostMapping("/items") void create(){}\n', encoding="utf-8")
        routes = spring_mapping_annotations(read_lines(controller), controller)
        die_if([(item["method"], item["path"]) for item in routes] !=
               [("GET", "/v1/items"), ("POST", "/v1/items")],
               "self-check Spring mapping attribute/multi-annotation parsing failed")
        die_if(routes[1]["annotationEvidence"]["occurrenceOnLine"] != 2 or
               not routes[1]["annotationEvidence"]["sharedPhysicalLine"] or
               "verb" in routes[1],
               "self-check Spring mapping evidence/field normalization failed")
        absent = denial_list(root)
        die_if(absent.get("blocker", {}).get("code") != "denial-list-unenumerated",
               "self-check absent denial addendum was not blocked")
        die_if(absent.get("blocker", {}).get("sourceLabel") != "scope-review-declaration",
               "self-check denial blocker source label drifted")
        die_if(absent["identifiers"], "self-check prose ID unexpectedly unblocked denial list")
        addendum = root / DENIAL_LIST_ADDENDUM
        addendum.write_text(canonical({
            "format": "smart-form-builder-lite-formerly-removed-whole-core-id-addendum/v1",
            "sourceLabel": "untrusted-prose",
            "identifiers": [f"SF-TEST-{number:02d}" for number in range(1, 8)],
        }), encoding="utf-8")
        expect_inventory_error(lambda: denial_list(root), "not authoritative-addendum")

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        frontend = root / "frontend"
        styles = frontend / "src"
        styles.mkdir(parents=True)
        (styles / "root.css").write_text('@use "./cycle";\n', encoding="utf-8")
        (styles / "_cycle.scss").write_text('@forward "./root.css";\n', encoding="utf-8")
        (styles / "object.scss").write_text("$accent: teal;\n", encoding="utf-8")
        _ROOT = root
        entries = angular_build_styles(frontend, {
            "projects": {"test": {"architect": {"build": {"options": {"styles": [
                "src/root.css", {"input": "src/object.scss", "bundleName": "test", "inject": False},
            ]}}}}},
        })
        die_if([entry["form"] for entry in entries] != ["string", "object"],
               "self-check Angular string/object style forms failed")
        scanned = scan_local_styles(frontend, entries)
        die_if(not scanned["cycles"] or not scanned["cycleProtected"],
               "self-check recursive style cycle protection failed")
        expect_inventory_error(lambda: local_style_path(frontend, "./missing.css", styles), "is missing")
        outside = root / "outside.css"
        outside.write_text("", encoding="utf-8")
        expect_inventory_error(lambda: local_style_path(frontend, "../../outside.css", styles), "escapes frontend")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, default=Path("docs/acceptance/v1.1/inventory"))
    parser.add_argument("--check", action="store_true", help="verify checked-in output and strict provenance gates")
    parser.add_argument("--self-check", action="store_true", help="run focused generator negative checks")
    parser.add_argument("--allow-unenumerated-denial-list", action="store_true",
                        help="write provisional inventory only; strict --check still fails")
    args = parser.parse_args(argv)
    root = args.repo_root.resolve()
    output = args.output if args.output.is_absolute() else root / args.output
    try:
        if args.self_check:
            self_check()
        if args.check:
            verify(root, output, require_denial_enumeration=not args.allow_unenumerated_denial_list)
        elif not args.self_check:
            write_output(root, output, require_denial_enumeration=not args.allow_unenumerated_denial_list)
    except (InventoryError, OSError, json.JSONDecodeError) as error:
        if str(error).startswith("denial-list-unenumerated:"):
            # Kept deliberately terse for the aggregate M0 gate; never infer IDs from prose.
            print("M0-BLOCKER: denial-list-unenumerated", file=sys.stderr)
        print(f"inventory error: {error}", file=sys.stderr)
        return 1
    print(f"inventory {'verified' if args.check else 'self-checked' if args.self_check else 'generated'}: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
