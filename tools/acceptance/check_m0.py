#!/usr/bin/env python3
"""Aggregate integrity checks for Smart Form Builder Lite v1.1 M0 inputs.

This verifies frozen acceptance artifacts, not product conformance. The latest
PRD remains the sole scope authority. A supplemental, unenumerated seven-ID
claim is represented by one structured provenance blocker; diagnostic mode can
check independent surfaces but never grants M0 exit or conformance credit.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

try:  # Support direct script execution and module-oriented focused tests.
    from denominator_review import (
        classify_denominator_review,
        reconstruct_pre_attestation_binding,
        validate_denominator_attestation,
    )
    import run_baseline
except ModuleNotFoundError:  # pragma: no cover - exercised by module discovery.
    from tools.acceptance.denominator_review import (
        classify_denominator_review,
        reconstruct_pre_attestation_binding,
        validate_denominator_attestation,
    )
    from tools.acceptance import run_baseline

PROTECTED_BRANCH = "vorflux/m0-acceptance-foundation"
PROTECTED_HEAD = "66e96756d3e7d00c60e8d974b34a113b9ca60586"
PROTECTED_PRD_SHA256 = "6bb234273705e341ef1c401dd2a7f764b10d834bb95673b71e0f62e4aea2e41e"
EXPECTED_COUNTS = {"requirements": 95, "core": 83, "enhancement": 12, "fixtures": 31, "operators": 34, "vectors": 101}
ALLOWED_M0_PATHS = ("docs/acceptance/v1.1/", "tools/acceptance/", ".gitignore")
AUTHORITATIVE_DENIAL_LIST_ADDENDUM = (
    "docs/source-handoff/smart-form-builder-lite-prd-v1.1/"
    "formerly-removed-whole-core-id-denial-list.json"
)
DENIAL_LIST_FORMAT = "smart-form-builder-lite-formerly-removed-whole-core-id-addendum/v1"
DENIAL_LIST_IDENTIFIER = re.compile(r"(?:SF|CORE)-[A-Z]+-\d{2}")
PROVENANCE_BLOCKER = "unresolved supplemental seven-ID provenance discrepancy"
BLOCKED_EXIT_CODE = 2
PENDING_EXIT_CODE = 3
DIAGNOSTIC_LINE_LIMIT = 20
# The deterministic T22 export proof parses and deep-compares 10,000 responses
# and can exceed the ordinary command budget on shared CI hosts.
DEFAULT_COMMAND_TIMEOUT_SECONDS = 120
EVALUATOR_VALIDATOR_TIMEOUT_SECONDS = 300
EVALUATOR_TEST_SUITE_BUDGET_SECONDS = 600
EVALUATOR_TEST_TIMEOUT_SECONDS = 1800
STRUCTURED_DENIAL_BLOCKER = re.compile(
    r"^(?:C17:\s+blocked:\s+|M0-BLOCKER:\s+|BLOCKER:\s+)denial-list-unenumerated(?:\s.*)?$"
)
EVALUATOR_VALIDATORS: dict[Path, Any] = {}
# Tests may opt into structural asset checks for unrelated copied-corpus
# mutations. The production CLI never changes this default.
AGGREGATE_TEST_STRUCTURAL_ASSETS = False


@dataclass(frozen=True)
class Result:
    """One integrity result; ``checked`` is deliberately not an acceptance pass."""

    name: str
    state: str  # checked, blocked, failed, pending
    detail: str


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def run_command(root: Path, args: Sequence[str], timeout_seconds: int = DEFAULT_COMMAND_TIMEOUT_SECONDS) -> tuple[int, str]:
    """Run an argv directly (never through a shell) with a bounded local timeout."""
    try:
        completed = subprocess.run(
            list(args), cwd=root, text=True, capture_output=True, check=False, shell=False, timeout=timeout_seconds
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return 127, str(error)
    return completed.returncode, completed.stdout + "\n" + completed.stderr


def diagnostic_lines(output: str) -> str:
    """Keep the final diagnostic context without retaining or printing full logs."""
    lines = [line for line in output.splitlines() if line.strip()]
    return "\n".join(lines[-DIAGNOSTIC_LINE_LIMIT:]) or "no diagnostic output"


def git_output(root: Path, *args: str) -> tuple[int, str]:
    code, output = run_command(root, ("git", *args))
    return code, diagnostic_lines(output)


def git_status(root: Path) -> tuple[int, str]:
    return run_command(root, ("git", "status", "--porcelain=v1", "--untracked-files=all"))


def allowed_m0_path(path: str) -> bool:
    return (
        path == ".gitignore"
        or path == AUTHORITATIVE_DENIAL_LIST_ADDENDUM
        or any(path.startswith(prefix) for prefix in ALLOWED_M0_PATHS if prefix != ".gitignore")
    )


def check_worktree(root: Path, allow_dirty: bool) -> Result:
    head_code, head = git_output(root, "rev-parse", "HEAD")
    status_code, status = git_status(root)
    if head_code or status_code:
        return Result("worktree state", "failed", "could not read repository HEAD/worktree state")
    status_path_digest = hashlib.sha256(status.encode("utf-8")).hexdigest()
    if status.strip() and not allow_dirty:
        return Result("worktree state", "failed", f"dirty worktree at HEAD {head}; status-path digest {status_path_digest}; rerun local diagnostics with --allow-dirty")
    state = "dirty worktree explicitly allowed for local diagnostics" if status.strip() else "clean worktree"
    return Result("worktree state", "checked", f"{state}; HEAD {head}; status-path digest {status_path_digest}")


def check_freeze_scope(root: Path) -> Result:
    """Optional M0-era branch/scope guard; not required after merge or in M1."""
    code, branch = git_output(root, "branch", "--show-current")
    if code or branch != PROTECTED_BRANCH:
        return Result("freeze scope", "failed", f"expected branch {PROTECTED_BRANCH}, found {branch!r}")
    code, head = git_output(root, "rev-parse", "HEAD")
    if code:
        return Result("freeze scope", "failed", f"could not resolve HEAD: {head}")
    code, _ = git_output(root, "merge-base", "--is-ancestor", PROTECTED_HEAD, "HEAD")
    if code:
        return Result("freeze scope", "failed", f"HEAD {head!r} is not descended from protected source {PROTECTED_HEAD}")
    code, output = run_command(root, ("git", "diff", "--name-only", f"{PROTECTED_HEAD}..HEAD"))
    if code:
        return Result("freeze scope", "failed", "could not inspect committed changes since protected source")
    disallowed = sorted(path for path in output.splitlines() if path and not allowed_m0_path(path))
    if disallowed:
        return Result("freeze scope", "failed", "non-M0 changes since protected source: " + ", ".join(disallowed))
    return Result("freeze scope", "checked", "protected source ancestry and M0-only committed scope verified")


def check_handoff(root: Path) -> Result:
    prd = root / "docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md"
    if not prd.is_file() or sha256(prd) != PROTECTED_PRD_SHA256:
        return Result("source handoff", "failed", "protected PRD SHA-256 differs from frozen M0 source")
    code, output = run_command(root, (sys.executable, "docs/source-handoff/smart-form-builder-lite-prd-v1.1/verify-handoff.py"))
    if code:
        return Result("source handoff", "failed", "handoff verifier failed:\n" + diagnostic_lines(output))
    return Result("source handoff", "checked", "protected PRD digest and 14-file handoff verifier checked")


def valid_source_reference(source: Any, *, path: str | None = None, rule: str | None = None) -> bool:
    """Require a source reference that is concrete enough to bind inventory bytes."""
    if not isinstance(source, dict) or set(source) != {"line", "path", "rule", "sha256"}:
        return False
    if not isinstance(source["line"], int) or source["line"] < 1:
        return False
    if not isinstance(source["path"], str) or not isinstance(source["rule"], str):
        return False
    if not isinstance(source["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", source["sha256"]):
        return False
    return (path is None or source["path"] == path) and (rule is None or source["rule"] == rule)


def denial_list_state(root: Path, claim: Any) -> tuple[str, str]:
    """Accept only generator-defined unresolved or authoritative resolved C17 states."""
    if not isinstance(claim, dict):
        return "failed", "supplemental denial-list provenance record is not an object"
    contract = {
        "requiredPath": AUTHORITATIVE_DENIAL_LIST_ADDENDUM,
        "requiredFormat": DENIAL_LIST_FORMAT,
        "requiredSourceLabel": "authoritative-addendum",
        "requiredIdentifierCount": 7,
    }
    if claim.get("declaredCount") != 7 or claim.get("enumerationContract") != contract:
        return "failed", "supplemental denial-list declaration/contract drifted"
    identifiers = claim.get("identifiers")
    if claim.get("enumerationAvailable") is False:
        blocker = claim.get("blocker")
        if (
            set(claim) != {"declaredCount", "identifiers", "enumerationAvailable", "enumerationContract", "source", "blocker"}
            or identifiers != []
            or not isinstance(blocker, dict)
            or set(blocker) != {"code", "message", "sourceLabel", "source"}
            or blocker.get("code") != "denial-list-unenumerated"
            or not isinstance(blocker.get("message"), str) or not blocker["message"]
            or blocker.get("sourceLabel") != "scope-review-declaration"
            or not valid_source_reference(claim.get("source"))
            or blocker.get("source") != claim["source"]
        ):
            return "failed", "unresolved denial-list state must contain the exact structured generator blocker"
        return "unresolved", "supplemental denial-list provenance remains explicitly unresolved"
    if claim.get("enumerationAvailable") is True:
        addendum = root / AUTHORITATIVE_DENIAL_LIST_ADDENDUM
        try:
            addendum_payload = load_json(addendum)
        except (OSError, json.JSONDecodeError):
            addendum_payload = None
        if (
            set(claim) != {"declaredCount", "identifiers", "enumerationAvailable", "enumerationContract", "source", "scopeReviewDeclaration"}
            or not isinstance(identifiers, list)
            or len(identifiers) != 7
            or len(set(identifiers)) != 7
            or any(not isinstance(identifier, str) or DENIAL_LIST_IDENTIFIER.fullmatch(identifier) is None for identifier in identifiers)
            or not addendum.is_file()
            or not isinstance(addendum_payload, dict)
            or addendum_payload.get("format") != DENIAL_LIST_FORMAT
            or addendum_payload.get("sourceLabel") != "authoritative-addendum"
            or addendum_payload.get("identifiers") != identifiers
            or not valid_source_reference(
                claim.get("source"), path=AUTHORITATIVE_DENIAL_LIST_ADDENDUM,
                rule="authoritative formerly removed whole-Core ID addendum",
            )
            or claim["source"].get("line") != 1
            or claim["source"].get("sha256") != sha256(addendum)
            or not valid_source_reference(claim.get("scopeReviewDeclaration"))
        ):
            return "failed", "resolved denial-list state must bind exactly seven unique valid IDs to the authoritative addendum"
        return "resolved", "authoritative seven-ID denial-list addendum is source-bound and enumerated"
    return "failed", "denial-list enumerationAvailable must be a boolean generator state"


def check_inventory_counts(root: Path) -> Result:
    try:
        manifest = load_json(root / "docs/acceptance/v1.1/inventory/manifest.json")
        inventory_path = root / "docs/acceptance/v1.1/inventory" / manifest["inventory"]["path"]
        inventory = load_json(inventory_path)
        claim = inventory["formerlyRemovedWholeCoreDenialList"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        return Result("inventory fixed counts", "failed", f"inventory files are unreadable: {error}")
    if manifest.get("inventory", {}).get("sha256") != sha256(inventory_path):
        return Result("inventory fixed counts", "failed", "inventory manifest checksum mismatch")
    if manifest.get("counts") != EXPECTED_COUNTS or inventory.get("counts") != EXPECTED_COUNTS:
        return Result("inventory fixed counts", "failed", "fixed inventory counts drifted")
    if inventory.get("generationPolicy", {}).get("acceptanceStatusInferred") is not False:
        return Result("inventory fixed counts", "failed", "inventory must not infer acceptance status")
    if len(inventory.get("requirements", [])) != 95 or len(inventory.get("fixtures", [])) != 31:
        return Result("inventory fixed counts", "failed", "95 requirement or 31 fixture member list drifted")
    if [item.get("id") for item in inventory.get("exclusions", [])] != [f"X0{number}" for number in range(1, 7)]:
        return Result("inventory fixed counts", "failed", "X01–X06 exclusion inventory drifted")
    if manifest.get("denialListEnumerationAvailable") is not claim.get("enumerationAvailable"):
        return Result("inventory fixed counts", "failed", "inventory manifest denial-list state differs from inventory")
    denial_state, denial_detail = denial_list_state(root, claim)
    if denial_state == "failed":
        return Result("inventory fixed counts", "failed", denial_detail)
    return Result(
        "inventory fixed counts", "checked",
        "95 requirements, 31 fixtures, X01–X06 exclusions, 34 operators, and 101 vectors verified; " + denial_detail,
    )


def parse_sha256sums(directory: Path) -> tuple[dict[str, str], str | None]:
    sums = directory / "SHA256SUMS"
    if not sums.is_file():
        return {}, "SHA256SUMS is missing"
    entries: dict[str, str] = {}
    for number, line in enumerate(sums.read_text(encoding="utf-8").splitlines(), 1):
        parts = line.split("  ", 1)
        if len(parts) != 2 or len(parts[0]) != 64 or not re.fullmatch(r"[0-9a-f]{64}", parts[0]):
            return {}, f"malformed SHA256SUMS line {number}"
        filename = parts[1]
        if Path(filename).name != filename or filename in entries:
            return {}, f"unsafe or duplicate SHA256SUMS entry {filename}"
        entries[filename] = parts[0]
    return entries, None


def check_denominators(root: Path) -> Result:
    """Verify the v2 index/SHA256SUMS closure without rebuilding its semantics."""
    directory = root / "docs/acceptance/v1.1/denominators"
    if not directory.is_dir() or directory.is_symlink():
        return Result("denominator manifests", "failed", "denominator directory is missing or symlinked")
    entries_on_disk = list(directory.iterdir())
    if any(path.is_symlink() or not path.is_file() for path in entries_on_disk):
        return Result("denominator manifests", "failed", "denominator closure forbids symlinks and non-file entries")
    entries, error = parse_sha256sums(directory)
    if error:
        return Result("denominator manifests", "failed", error)
    try:
        index = load_json(directory / "manifest-index.json")
        closure = index["closure"]
        indexed = index["manifests"]
        if index.get("version") != "2.0.0-m0" or closure.get("kind") != "sha256sums-transitive-closure/v1":
            return Result("denominator manifests", "failed", "denominator v2 closure/version is invalid")
        member_paths = closure["memberPaths"]
        if (not isinstance(member_paths, list) or not member_paths or member_paths != sorted(member_paths)
                or len(member_paths) != len(set(member_paths))
                or any(not isinstance(name, str) or Path(name).name != name for name in member_paths)):
            return Result("denominator manifests", "failed", "denominator closure member set is malformed")
        if closure.get("sha256sumsPath") != "docs/acceptance/v1.1/denominators/SHA256SUMS":
            return Result("denominator manifests", "failed", "denominator closure SHA256SUMS path is invalid")
        if closure.get("sha256sumsSha256") != sha256(directory / "SHA256SUMS"):
            return Result("denominator manifests", "failed", "denominator closure SHA256SUMS digest mismatch")
        if set(entries) != set(member_paths):
            return Result("denominator manifests", "failed", "denominator SHA256SUMS member set differs from indexed closure")
        actual = {path.name for path in entries_on_disk}
        optional_attestation = "review-attestation.json"
        expected_actual = set(member_paths) | {"manifest-index.json", "SHA256SUMS"}
        if optional_attestation in actual:
            expected_actual.add(optional_attestation)
        if actual != expected_actual:
            return Result("denominator manifests", "failed", "denominator closure has omitted or extra artifacts")
        for filename, digest in entries.items():
            if sha256(directory / filename) != digest:
                return Result("denominator manifests", "failed", f"denominator closure checksum mismatch for {filename}")
        if not isinstance(indexed, dict) or not indexed:
            return Result("denominator manifests", "failed", "manifest-index has no manifest entries")
        for filename, metadata in indexed.items():
            if (Path(filename).name != filename or not isinstance(metadata, dict)
                    or set(metadata) != {"sha256", "total"} or filename not in entries
                    or metadata["sha256"] != entries[filename] or not isinstance(metadata["total"], int)):
                return Result("denominator manifests", "failed", "manifest-index artifact digest/total metadata is invalid")
            document = load_json(directory / filename)
            members = document.get("members")
            if document.get("total") != metadata["total"] or not isinstance(members, list) or metadata["total"] != len(members):
                return Result("denominator manifests", "failed", f"{filename} total must equal index metadata and len(members)")
            if document.get("current_execution_status") != "not-run" or any(member.get("status") != "not-run" for member in members):
                return Result("denominator manifests", "failed", f"{filename} contains an execution or acceptance claim")
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        return Result("denominator manifests", "failed", f"denominator metadata is invalid: {error}")
    return Result("denominator manifests", "checked", "v2 index, SHA256SUMS transitive closure, artifact digests, and member totals verified")


def repo_path(root: Path, value: str) -> Path | None:
    path = (root / value).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError:
        return None
    return path


def validate_pointer(root: Path, pointer: Any, label: str, expected_keys: frozenset[str] = frozenset({"path", "sha256"})) -> tuple[bool, str]:
    """Validate an exact pointer shape before dereferencing its local artifact."""
    if not isinstance(pointer, dict):
        return False, f"{label} must be an object with path and sha256"
    missing = sorted(expected_keys - set(pointer))
    extra = sorted(set(pointer) - expected_keys)
    if missing or extra:
        parts = []
        if missing:
            parts.append("missing " + ", ".join(missing))
        if extra:
            parts.append("unexpected " + ", ".join(extra))
        return False, f"{label} pointer keys invalid: " + "; ".join(parts)
    if not isinstance(pointer["path"], str) or not isinstance(pointer["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", pointer["sha256"]):
        return False, f"{label} pointer format is invalid"
    target = repo_path(root, pointer["path"])
    if target is None or not target.is_file() or sha256(target) != pointer["sha256"]:
        return False, f"{label} pointer/digest does not match its artifact"
    return True, f"{label} pointer/digest verified"


def denominator_build_function(root: Path) -> Any:
    """Load the denominator generator only to reconstruct its shared review binding."""
    path = root / "docs/acceptance/v1.1/denominators/build_manifests.py"
    spec = importlib.util.spec_from_file_location("m0_denominator_builder", path)
    if spec is None or spec.loader is None:
        raise ValueError("denominator generator cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    write_bytecode = sys.dont_write_bytecode
    try:
        # The denominator closure correctly rejects unexpected directories, so
        # reconstructing a review binding must not leave a __pycache__ behind.
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = write_bytecode
    return module.build


def denominator_technical_review(root: Path, index: dict[str, Any]) -> tuple[str, str]:
    """Classify review using the denominator-owned shared contract, never a copy."""
    pointer = index.get("independentReviewAttestation")
    expected_pointer_keys = {
        "status", "path", "sha256", "authority", "reviewer", "attestedAt", "decision", "preAttestationBinding", "note",
    }
    if not isinstance(pointer, dict) or set(pointer) != expected_pointer_keys:
        return "failed", "denominator independent review pointer shape is invalid"
    if pointer.get("status") == "pending-independent-review":
        if (not isinstance(pointer.get("path"), str) or not isinstance(pointer.get("note"), str)
                or any(pointer.get(key) is not None for key in expected_pointer_keys - {"status", "path", "note"})):
            return "failed", "pending denominator review pointer claims attestation metadata"
        return "pending", "denominator technical independent review is explicitly pending"
    if pointer.get("status") not in {"approved", "rejected"}:
        return "failed", "denominator independent review pointer status is invalid"
    target = repo_path(root, pointer.get("path")) if isinstance(pointer.get("path"), str) else None
    if target is None or target.name != "review-attestation.json" or not target.is_file():
        return "failed", "denominator independent review artifact path is invalid"
    if not isinstance(pointer.get("sha256"), str) or sha256(target) != pointer["sha256"]:
        return "failed", "denominator independent review pointer digest does not match its artifact"
    try:
        record = load_json(target)
        build = denominator_build_function(root)
        binding = reconstruct_pre_attestation_binding(
            root / "docs/acceptance/v1.1/denominators", lambda output: build(output, pending=True)
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return "failed", f"denominator review binding cannot be reconstructed: {error}"
    valid, detail = validate_denominator_attestation(record, version=index.get("version"), binding=binding)
    if not valid:
        return "failed", f"denominator review contract: {detail}"
    if any(pointer.get(key) != record.get(key) for key in ("authority", "reviewer", "attestedAt", "decision", "preAttestationBinding")):
        return "failed", "denominator independent review pointer does not match its attestation"
    classification = classify_denominator_review(record, version=index["version"], binding=binding)
    if classification == "reviewed-by-human-independent":
        return "checked", "denominator human independent technical review is attested and content-bound"
    if classification == "reviewed-by-independent-agent":
        return "checked", "denominator independent-agent technical review is attested and content-bound; human sign-off remains unrecorded"
    return "pending", "denominator review is advisory or rejected and cannot release the technical freeze"


def evaluator_validator(root: Path) -> Any:
    """Load the evaluator-owned validator so signed policy has one authority."""
    root = root.resolve()
    cached = EVALUATOR_VALIDATORS.get(root)
    if cached is not None:
        return cached
    path = root / "docs/acceptance/v1.1/evaluator/tools/validate_corpus.py"
    spec = importlib.util.spec_from_file_location("m0_evaluator_validator", path)
    if spec is None or spec.loader is None:
        raise ValueError("evaluator validator cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    write_bytecode = sys.dont_write_bytecode
    sys.path.insert(0, str(root))
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = write_bytecode
        sys.path.pop(0)
    # Validator cross-scope pins must resolve in the aggregate's requested root,
    # including temporary corpus tests rather than its module-load location.
    module.REPO = root
    EVALUATOR_VALIDATORS[root] = module
    return module


def evaluator_v22_release_state(root: Path, evaluator: dict[str, Any]) -> tuple[str, str]:
    """Delegate C28/C29/C31/C34 signing semantics to the evaluator contract."""
    signature = evaluator.get("signature")
    if not isinstance(signature, dict):
        return "failed", "evaluator v2.2 signature envelope is invalid"
    try:
        validator = evaluator_validator(root)
        errors = validator.validate(
            root / "docs/acceptance/v1.1/evaluator",
            require_denial_list=False,
            test_structural_assets=AGGREGATE_TEST_STRUCTURAL_ASSETS,
        )
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        return "failed", f"evaluator signing contract cannot be evaluated: {error}"
    signing_errors = [(code, detail) for code, detail in errors if code in {"C28", "C29", "C31", "C34"}]
    if signing_errors:
        detail = "; ".join(f"{code}: {detail}" for code, detail in signing_errors)
        return "failed", f"evaluator signed-state contract: {detail}"
    if signature.get("state") == "signed":
        return "checked", "evaluator v2.2+ Ed25519 signed independent-agent freeze validated by C28/C29/C31/C34"
    if signature.get("state") == "unsigned-pending":
        return "pending", "evaluator v2.2+ content-bound signature protocol is explicitly pending; C28/C29/C31/C34 are valid"
    return "failed", "evaluator v2.2 signature state is neither validated signed nor pending"


def evaluator_version_at_least(version: Any, minimum: tuple[int, int]) -> bool:
    """Compare a strict SemVer evaluator version, including M0 prereleases."""
    if not isinstance(version, str):
        return False
    match = re.fullmatch(
        r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
        r"(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?"
        r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?",
        version,
    )
    return bool(match and (int(match.group(1)), int(match.group(2))) >= minimum)


def check_freeze_attestations(root: Path) -> Result:
    try:
        denominator_index = load_json(root / "docs/acceptance/v1.1/denominators/manifest-index.json")
        evaluator = load_json(root / "docs/acceptance/v1.1/evaluator/manifest.json")
        signature = evaluator["signature"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        return Result("freeze attestations", "failed", f"attestation metadata is unreadable: {error}")
    denominator_state, denominator_detail = denominator_technical_review(root, denominator_index)
    if denominator_state == "failed":
        return Result("freeze attestations", "failed", denominator_detail)
    if evaluator.get("corpusVersion") == "1.6.0":
        content_binding = evaluator.get("preSignatureManifestDigest", {})
        if (signature.get("state") != "unsigned-pending" or signature.get("algorithm") != "ed25519"
                or signature.get("signer") is not None or signature.get("value") is not None
                or evaluator.get("reviewState") != "unsigned-pending-independent-evaluator-freeze"
                or content_binding.get("storedValue") is not None
                or content_binding.get("normalization") != "canonical JSON (sort_keys, UTF-8, trailing LF); normalize only signature.value to null"):
            return Result("freeze attestations", "failed", "evaluator v1.6 content-bound signature state is invalid")
        evaluator_detail = "evaluator v1.6 content-bound signature protocol is explicitly pending; validator enforces C28–C34"
        evaluator_state = "pending"
    elif evaluator_version_at_least(evaluator.get("corpusVersion"), (2, 2)):
        evaluator_state, evaluator_detail = evaluator_v22_release_state(root, evaluator)
        if evaluator_state == "failed":
            return Result("freeze attestations", "failed", evaluator_detail)
    elif signature.get("state") == "unsigned-pending-independent-evaluator-freeze":
        if signature.get("role") != "independent evaluator" or any(signature.get(key) is not None for key in ("signedBy", "signedAt", "corpusDigest")):
            return Result("freeze attestations", "failed", "pending evaluator review attestation must not claim identity, time, or digest")
        evaluator_detail = "evaluator independent-review attestation is explicitly pending"
        evaluator_state = "pending"
    else:
        if not all(isinstance(signature.get(key), str) and signature[key] for key in ("signedBy", "signedAt", "role", "corpusDigest")):
            return Result("freeze attestations", "failed", "evaluator independent-review attestation fields are incomplete")
        if signature.get("role") != "independent evaluator" or signature.get("corpusDigest") != evaluator.get("corpusDigest"):
            return Result("freeze attestations", "failed", "evaluator independent-review attestation does not bind the frozen corpus")
        evaluator_detail = "evaluator independent-review signature binds corpus digest"
        evaluator_state = "checked"
    state = "pending" if "pending" in (denominator_state, evaluator_state) else "checked"
    return Result("freeze attestations", state, denominator_detail + "; " + evaluator_detail)


def check_no_pass_claims(root: Path) -> Result:
    try:
        evaluator = load_json(root / "docs/acceptance/v1.1/evaluator/manifest.json")
        status = evaluator["status"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        return Result("non-acceptance status", "failed", f"evaluator status metadata is invalid: {error}")
    if status.get("measuredConformanceExecuted") is not False or status.get("productTestsExecuted") is not False:
        return Result("non-acceptance status", "failed", "evaluator manifest claims measured product conformance")
    return Result("non-acceptance status", "checked", "later locale/schema/sentinel prerequisites remain non-product M0 metadata")


def check_evidence_schema(root: Path) -> Result:
    path = root / "docs/acceptance/v1.1/evidence/baseline-record.schema.json"
    attestation_path = root / "docs/acceptance/v1.1/evidence/baseline-attestation.schema.json"
    try:
        schema = load_json(path)
        attestation_schema = load_json(attestation_path)
    except (OSError, json.JSONDecodeError) as error:
        return Result("evidence schema", "failed", f"evidence schema is unreadable: {error}")
    required = {"schemaVersion", "recordType", "observedAtUtc", "candidate", "environment", "executionPolicy", "acceptanceBoundary", "recordValidation", "tasks"}
    if not required.issubset(set(schema.get("required", []))):
        return Result("evidence schema", "failed", "baseline schema required envelope drifted")
    if schema.get("$defs", {}).get("status", {}).get("enum") != ["pass", "fail", "blocked", "not-run"]:
        return Result("evidence schema", "failed", "baseline schema status vocabulary drifted")
    acceptance = schema.get("$defs", {}).get("task", {}).get("properties", {}).get("acceptance", {}).get("properties", {})
    if acceptance.get("countsTowardAcceptance", {}).get("const") is not False:
        return Result("evidence schema", "failed", "baseline schema may not count observations toward acceptance")
    if schema.get("properties", {}).get("acceptanceBoundary", {}).get("const") != run_baseline.RECORD_ACCEPTANCE_BOUNDARY:
        return Result("evidence schema", "failed", "baseline record acceptance boundary must equal the dependency-free runner constant")
    attestation_required = {
        "attestationVersion", "recordLocation", "recordSha256", "recordStatus", "candidate", "createdAtUtc",
        "reviewer", "reviewerAuthority", "reviewStatus", "acceptanceBoundary",
    }
    if not attestation_required.issubset(set(attestation_schema.get("required", []))):
        return Result("evidence schema", "failed", "baseline attestation schema required envelope drifted")
    attestation_properties = attestation_schema.get("properties", {})
    candidate = attestation_properties.get("candidate", {})
    if (
        attestation_properties.get("attestationVersion", {}).get("const") != run_baseline.ATTESTATION_VERSION
        or not {"sha", "treeSha", "dirty"}.issubset(set(candidate.get("required", [])))
        or attestation_properties.get("reviewStatus", {}).get("const") != "approved"
        or not {"retained", "finalized"}.issubset(set(attestation_properties.get("recordStatus", {}).get("enum", [])))
    ):
        return Result("evidence schema", "failed", "baseline attestation candidate/reviewer/active-status contract drifted")
    if attestation_schema.get("properties", {}).get("acceptanceBoundary", {}).get("const") != run_baseline.ATTESTATION_ACCEPTANCE_BOUNDARY:
        return Result("evidence schema", "failed", "baseline attestation acceptance boundary must equal the dependency-free runner constant")
    return Result("evidence schema", "checked", "baseline record/attestation schemas and non-acceptance contract checked")


def check_baseline_evidence(root: Path) -> Result:
    logical_directory = root / run_baseline.BASELINES_DIRECTORY
    if not logical_directory.exists() and not logical_directory.is_symlink():
        return Result("baseline evidence", "pending", "no retained clean baseline record and sibling final attestation exist yet")
    try:
        records, attestations = run_baseline.retained_baseline_paths(root)
        run_baseline.validate_retained_baselines(root)
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as error:
        return Result("baseline evidence", "failed", f"retained baseline containment/binding failure: {error}")
    return Result("baseline evidence", "checked", f"{len(records)} clean retained/finalized record(s) and exactly one sibling attestation per record verified by the baseline contract")


def is_structured_denial_blocker(output: str) -> bool:
    return any(STRUCTURED_DENIAL_BLOCKER.fullmatch(line.strip()) for line in output.splitlines())


def unresolved_denial_provenance(root: Path) -> bool:
    """Read the sibling inventory record, not command prose, for diagnostic state."""
    try:
        claim = load_json(root / "docs/acceptance/v1.1/inventory/inventory.json")["formerlyRemovedWholeCoreDenialList"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError):
        return False
    return denial_list_state(root, claim)[0] == "unresolved"


def sibling_tool(root: Path, name: str, args: Sequence[str], timeout_seconds: int = DEFAULT_COMMAND_TIMEOUT_SECONDS) -> Result:
    code, output = run_command(root, args, timeout_seconds)
    if code == 0:
        return Result(name, "checked", "tool completed")
    excerpt = diagnostic_lines(output)
    if is_structured_denial_blocker(output):
        return Result(name, "blocked", PROVENANCE_BLOCKER + ";\n" + excerpt)
    return Result(name, "failed", excerpt)


def run_all(root: Path, diagnostic: bool, allow_dirty: bool = False, freeze_check: bool = False) -> list[Result]:
    inventory_args: list[str] = [sys.executable, "tools/acceptance/generate_inventory.py", "--check"]
    evaluator_args: list[str] = [sys.executable, "docs/acceptance/v1.1/evaluator/tools/validate_corpus.py"]
    if diagnostic:
        inventory_args.append("--allow-unenumerated-denial-list")
        evaluator_args.append("--allow-blocked-denial-list")
    results = [check_worktree(root, allow_dirty)]
    if freeze_check:
        results.append(check_freeze_scope(root))
    results.extend([
        check_handoff(root),
        sibling_tool(root, "inventory generator", inventory_args),
        check_inventory_counts(root),
        check_denominators(root),
        sibling_tool(root, "denominator generator check", [sys.executable, "docs/acceptance/v1.1/denominators/build_manifests.py", "--check"]),
        check_freeze_attestations(root),
        sibling_tool(root, "evaluator validator", evaluator_args, timeout_seconds=EVALUATOR_VALIDATOR_TIMEOUT_SECONDS),
        check_no_pass_claims(root),
        check_evidence_schema(root),
        check_baseline_evidence(root),
        sibling_tool(root, "baseline tool tests", [sys.executable, "tools/acceptance/test_run_baseline.py"]),
        sibling_tool(
            root, "evaluator tool tests", [sys.executable, "docs/acceptance/v1.1/evaluator/tools/test_validate_corpus.py"],
            timeout_seconds=EVALUATOR_TEST_TIMEOUT_SECONDS,
        ),
    ])
    if diagnostic and unresolved_denial_provenance(root):
        results.append(Result("strict provenance gate", "blocked", PROVENANCE_BLOCKER + "; diagnostic output grants no M0 exit or conformance credit"))
    return results


def print_results(results: Iterable[Result], diagnostic: bool) -> None:
    results = list(results)
    for result in results:
        print(f"{result.state.upper():7} {result.name}: {result.detail}")
    if any(result.state == "failed" for result in results):
        print("M0 RESULT: INVALID INPUTS OR INTEGRITY FAILURE; no acceptance decision is available.")
    elif any(result.state == "blocked" for result in results):
        if diagnostic:
            print("M0 DIAGNOSTIC: independently checked where possible; BLOCKED exit, no M0 exit or conformance credit.")
        else:
            print("M0 STRICT: BLOCKED by the unresolved supplemental seven-ID provenance discrepancy; no M0 exit or conformance credit.")
    elif any(result.state == "pending" for result in results):
        print("M0 INPUT INTEGRITY: independent-review attestation is pending; exit 3 until it is completed. This is not product conformance or final acceptance.")
    else:
        print("M0 INPUT INTEGRITY: checked. This is not product conformance or final acceptance.")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--diagnostic", action="store_true", help="run provisional independent checks; blockers exit 2 and pending freeze attestations exit 3")
    parser.add_argument("--allow-dirty", action="store_true", help="allow a dirty tree only for local --diagnostic/precommit use")
    parser.add_argument("--freeze-check", action="store_true", help="also enforce original M0 branch/source scope; omit after merge/M1")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2], help="repository root (default: inferred)")
    args = parser.parse_args(argv)
    if args.allow_dirty and not args.diagnostic:
        parser.error("--allow-dirty is only permitted with --diagnostic")
    results = run_all(args.repo_root.resolve(), args.diagnostic, args.allow_dirty, args.freeze_check)
    print_results(results, args.diagnostic)
    if any(result.state == "failed" for result in results):
        return 1
    if any(result.state == "blocked" for result in results):
        return BLOCKED_EXIT_CODE
    if any(result.state == "pending" for result in results):
        return PENDING_EXIT_CODE
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
