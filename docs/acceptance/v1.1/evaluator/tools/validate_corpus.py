#!/usr/bin/env python3
"""Read-only standard-library validation for the versioned evaluator corpus."""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[3]
sys.path.insert(0, str(REPO / "tools" / "acceptance"))
import denominator_review
ID = re.compile(r"^EVAL-[A-Z0-9]{1,12}-[0-9A-Z-]+$")
RANGE = re.compile(r"^[1-9][0-9]*(?:-[1-9][0-9]*)?$")
SHA = re.compile(r"^[0-9a-f]{64}$")
UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
KEY_ID = re.compile(r"^evaluator-[a-z0-9-]+-ed25519-v[1-9][0-9]*$")
ASSERTION_TYPES = {"oracle", "projection", "navigation", "structural", "locale", "sentinel", "predicate", "policy", "coverage", "deterministic-input-oracle", "controlled-receiver-protocol", "hostile-input-protocol", "workload-protocol", "human-study-protocol"}
CHECKER_ENV = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
FORBIDDEN = ("TBD", "TODO", "FIXME", "???")
FIXTURE_GROUPS = (
    ("EVAL-GROUP-T01-T07", "fixtures/t01-t07.json", tuple(f"T{number:02}" for number in range(1, 8)), 23, "check_t01_t07.py"),
    ("EVAL-GROUP-T08-T15", "fixtures/t08-t15.json", tuple(f"T{number:02}" for number in range(8, 16)), 33, "check_t08_t15.py"),
    ("EVAL-GROUP-T17-T24", "fixtures/t17-t24.json", tuple(f"T{number:02}" for number in range(17, 25)), 95, "check_t17_t24.py"),
    ("EVAL-GROUP-T25-T32", "fixtures/t25-t32.json", tuple(f"T{number:02}" for number in range(25, 33)), 41, "check_t25_t32.py"),
)

# Signature-state tests validate cloned corpora repeatedly.  The priority asset
# self-check deterministically regenerates the two 10,000-row T22 datasets and
# is unaffected by manifest/provenance mutations, so cache its result by the
# exact assets that it reads.  A changed asset gets a new key and is rechecked.
PRIORITY_ASSET_CHECK_CACHE: dict[tuple[str, ...], str | None] = {}
FIXTURE_GROUP_BY_ID = {fixture: (artifact_id, path) for artifact_id, path, fixtures, _, _ in FIXTURE_GROUPS for fixture in fixtures}
SIGNED_REVIEW_STATE = "signed-independent-agent-technical-freeze"
SIGNED_ATTESTATION_STATE = (
    "signed-independent-agent-technical-freeze; no product-conformance, M0-exit, human approval, "
    "or native-language approval claim"
)
SIGNED_CLAIMS_NOT_MADE = [
    "no product conformance",
    "no M0 exit",
    "no human approval",
    "no native-language approval",
]
SIGNED_RESOLVED_BLOCKERS = {
    "denial-list-not-published",
    "evaluator-selected-allowlist-pending-approval",
    "semantic-interpretation-review-pending",
}
SOURCE_PATHS = {
    "AUTH": "docs/source-handoff/smart-form-builder-lite-prd-v1.1/Authentication-and-Administration.md",
    "PRD": "docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md",
    "PROTO": "docs/source-handoff/smart-form-builder-lite-prd-v1.1/Lite-Evaluator-Protocol.md",
    "CONTRACT": "docs/source-handoff/smart-form-builder-lite-prd-v1.1/Lite-Contract-Details.md",
    "REG": "docs/source-handoff/smart-form-builder-lite-prd-v1.1/requirement-dispositions.csv",
}


def b64url_decode(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("base64url")
    import base64
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def canonical(value):
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, separators=(",", ": ")) + "\n"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def corpus_files(root=ROOT):
    return sorted(
        (p for p in root.rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.name != "manifest.json"),
        key=lambda p: p.as_posix(),
    )


def corpus_digest(root=ROOT):
    lines = sorted(f"{sha(p)}  ./{p.relative_to(root).as_posix()}\n" for p in corpus_files(root))
    return hashlib.sha256("".join(lines).encode()).hexdigest()


def manifest_pre_signature_bytes(manifest):
    """Canonical pre-signature bytes; values being derived/signature are null."""
    clone = json.loads(json.dumps(manifest))
    clone.setdefault("signature", {})["value"] = None
    clone.setdefault("signature", {})["payloadDigest"] = None
    clone.setdefault("preSignatureManifestDigest", {})["storedValue"] = None
    return canonical(clone).encode()


def canonical_manifest_digest(manifest):
    return hashlib.sha256(manifest_pre_signature_bytes(manifest)).hexdigest()


def signature_payload(kind, digest):
    if kind not in {"evaluator-manifest/v1", "evaluator-selected-allowlist/v1", "interpretation-review/v1"} or not SHA.fullmatch(digest or ""):
        raise ValueError("signature payload")
    return f"smartintake:{kind}\nsha256:{digest}\n".encode("ascii")


def verify_ed25519(public_key, signature, payload):
    """Verify raw Ed25519 signature bytes using cryptography or safe OpenSSL."""
    if len(public_key) != 32 or len(signature) != 64:
        return False
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        Ed25519PublicKey.from_public_bytes(public_key).verify(signature, payload)
        return True
    except ImportError:
        pass
    except Exception:
        return False
    # OpenSSL expects SubjectPublicKeyInfo DER for a raw Ed25519 public key.
    spki = bytes.fromhex("302a300506032b6570032100") + public_key
    pem = "-----BEGIN PUBLIC KEY-----\n" + __import__("base64").b64encode(spki).decode() + "\n-----END PUBLIC KEY-----\n"
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        key, signed, message = directory / "key.pem", directory / "signature.bin", directory / "payload.bin"
        key.write_text(pem, encoding="ascii")
        signed.write_bytes(signature)
        message.write_bytes(payload)
        result = subprocess.run(
            ["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", str(key), "-rawin", "-in", str(message), "-sigfile", str(signed)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=5,
        )
        return result.returncode == 0


def signature_valid(signature, authority, kind, digest):
    required = {"algorithm", "keyId", "payloadDigest", "value"}
    if not isinstance(signature, dict) or not required <= set(signature):
        return False
    if signature.get("algorithm") != "ed25519" or signature.get("keyId") != authority.get("keyId") or signature.get("payloadDigest") != digest:
        return False
    try:
        return verify_ed25519(b64url_decode(authority["publicKey"]), b64url_decode(signature["value"]), signature_payload(kind, digest))
    except (KeyError, ValueError):
        return False


def record_walk(value):
    if isinstance(value, dict):
        if "id" in value and "prdCitations" in value:
            yield value
            return
        for child in value.values():
            yield from record_walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from record_walk(child)


def valid_provenance(prov):
    if not isinstance(prov, dict): return False
    mode = prov.get("mode")
    allowed = {
        "source-literal": {"mode"},
        "source-computed": {"mode", "ruleId", "registryPath", "inputs", "outputs"},
        "evaluator-selected": {"mode", "allowlistId", "allowlistPath"},
        "independently-reviewed-interpretation": {"mode", "reviewId", "reviewPath", "description"},
    }
    required = {
        "source-literal": {"mode"}, "source-computed": allowed["source-computed"],
        "evaluator-selected": allowed["evaluator-selected"],
        "independently-reviewed-interpretation": {"mode", "reviewId", "reviewPath"},
    }
    return mode in allowed and set(prov) <= allowed[mode] and required[mode] <= set(prov)

def valid_record_schema(record, required):
    return (required <= set(record) and isinstance(record.get("id"), str) and ID.fullmatch(record["id"])
        and record.get("assertionType") in ASSERTION_TYPES and record.get("status") == "not-run"
        and isinstance(record.get("expected"), dict) and isinstance(record.get("fixtures"), list) and record["fixtures"]
        and isinstance(record.get("milestoneGates"), list) and record["milestoneGates"]
        and record.get("expectedSource") in {"prd", "evaluator-derived"}
        and valid_provenance(record.get("oracleProvenance")))


def json_schema_errors(schema, record):
    """Use Draft 2020-12 validation when available; never silently skip it."""
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        # Equivalent closed critical checks cover the environment fallback.
        return [] if valid_record_schema(record, set(schema.get("required", []))) else ["stdlib critical schema"]
    try:
        return [error.message for error in Draft202012Validator(schema).iter_errors(record)]
    except Exception as exc:
        return [f"schema unavailable: {exc}"]


def approval_document_schema_errors(document, schema, kind):
    """Apply the published approval schema with a stdlib parity fallback."""
    try:
        from jsonschema import Draft202012Validator
        errors = [error.message for error in Draft202012Validator(schema).iter_errors(document)]
    except ImportError:
        errors = []
    except Exception as exc:
        errors = [f"schema unavailable: {exc}"]
    if kind == "allowlist":
        allowed = {"allowlistId", "approvalStatus", "corpusVersion", "purpose", "recordIds", "approval"}
        required = {"allowlistId", "approvalStatus", "corpusVersion", "purpose", "recordIds"}
    else:
        allowed = {"contentBindings", "corpusVersion", "interpretationIds", "reviewStatus", "approval"}
        required = allowed - {"approval"}
    if not required <= set(document) or not set(document) <= allowed:
        errors.append("stdlib root contract")
    if "approval" in document:
        approval = document["approval"]
        time_key = "approvedAt" if kind == "allowlist" else "reviewedAt"
        if not isinstance(approval, dict) or set(approval) != {"decision", "reviewer", time_key, "signature"}:
            errors.append("stdlib approval contract")
    return errors

def authority_ok(authority):
    try:
        return (
        isinstance(authority, dict)
        and set(authority) == {"authority", "provider", "keyId", "publicKey"}
        and authority["authority"] in {"independent-agent-review", "human-independent-review"}
        and authority["provider"] == "codex-gpt"
        and KEY_ID.fullmatch(authority["keyId"] or "") is not None
        and len(b64url_decode(authority["publicKey"])) == 32
        )
    except (KeyError, ValueError, TypeError):
        return False


def approval_payload_digest(document):
    clone = json.loads(json.dumps(document))
    approval = clone.setdefault("approval", {})
    approval["signature"] = {"algorithm": None, "keyId": None, "payloadDigest": None, "value": None}
    return hashlib.sha256(canonical(clone).encode()).hexdigest()


def signed_approval_ok(document, authority, status_key, approved_value, time_key):
    approval = document.get("approval", {})
    if not isinstance(approval, dict) or set(approval) != {"decision", "reviewer", time_key, "signature"}:
        return False
    if document.get(status_key) != approved_value or approval.get("decision") != "approved" or not isinstance(approval.get("reviewer"), str) or not approval["reviewer"]:
        return False
    if UTC.fullmatch(approval.get(time_key, "")) is None:
        return False
    return signature_valid(approval["signature"], authority, "evaluator-selected-allowlist/v1" if status_key == "approvalStatus" else "interpretation-review/v1", approval_payload_digest(document))


def lineage_approval_ok(approval):
    return (
        isinstance(approval, dict)
        and approval.get("authority") in {"independent-agent-review", "human-independent-review"}
        and approval.get("provider") == "codex-gpt" and approval.get("reviewStatus") == "approved"
        and approval.get("decision") == "approved" and isinstance(approval.get("reviewer"), str) and bool(approval["reviewer"])
        and UTC.fullmatch(approval.get("reviewedAt", "")) is not None
    )

def source_lines(file_name, lines):
    path = REPO / SOURCE_PATHS[file_name]
    first, last = map(int, (lines.split("-") if "-" in lines else (lines, lines)))
    return "\n".join(path.read_text(encoding="utf-8").splitlines()[first - 1:last])


def add(errors, key, message):
    errors.append((key, message))


def pointer(ref):
    path, fragment = ref.split("#", 1)
    value = json.loads((REPO / path).read_text(encoding="utf-8"))
    for token in fragment.removeprefix("/").split("/") if fragment else []:
        token = token.replace("~1", "/").replace("~0", "~")
        value = value[int(token)] if isinstance(value, list) else value[token]
    return value


def valid_source_citation(citation):
    if not isinstance(citation, dict) or citation.get("file") not in SOURCE_PATHS or not isinstance(citation.get("lines"), str) or not RANGE.fullmatch(citation["lines"]):
        return False
    try:
        text = source_lines(citation["file"], citation["lines"])
        return (
            isinstance(citation.get("quote"), str) and bool(citation["quote"])
            and citation["quote"] in text
            and citation.get("sourceSha256") == sha(REPO / SOURCE_PATHS[citation["file"]])
            and citation.get("rangeSha256") == hashlib.sha256(text.encode()).hexdigest()
        )
    except Exception:
        return False


def valid_governing_citations(citations):
    """Validate canonical full-fixture governing-source citations exactly."""
    if not isinstance(citations, list) or not citations:
        return False
    for citation in citations:
        if not isinstance(citation, dict) or set(citation) != {"sourceId", "startLine", "endLine", "textSha256"}:
            return False
        source_id, start, end = citation.get("sourceId"), citation.get("startLine"), citation.get("endLine")
        if source_id not in SOURCE_PATHS or not isinstance(start, int) or not isinstance(end, int) or start < 1 or end < start:
            return False
        try:
            if end > len((REPO / SOURCE_PATHS[source_id]).read_text(encoding="utf-8").splitlines()):
                return False
            text = source_lines(source_id, str(start) if start == end else f"{start}-{end}")
        except Exception:
            return False
        if citation.get("textSha256") != hashlib.sha256(text.encode()).hexdigest():
            return False
    return True


def fixture_records(document, path):
    """Return the group-specific fixture list without flattening its contract."""
    if path.endswith("t01-t07.json") or path.endswith("t25-t32.json"):
        return document.get("fixtures", [])
    return document.get("records", [])


def fixture_id(record):
    return record.get("fixture") or record.get("id")


def fixture_cases(record, path):
    return record.get("actions", []) if path.endswith("t08-t15.json") else record.get("cases", [])


def validate_group_fixture_oracles(docs, errors, root=ROOT):
    """Validate the four release fixture groups and reject generic runner cases."""
    all_fixture_ids, all_case_ids = [], set()
    for artifact_id, path, expected_ids, expected_cases, checker_name in FIXTURE_GROUPS:
        document = docs.get(path, {})
        records = fixture_records(document, path) if isinstance(document, dict) else []
        ids = [fixture_id(record) for record in records if isinstance(record, dict)]
        if ids != list(expected_ids):
            add(errors, "C33", f"{artifact_id}: fixture denominator/order")
            continue
        count = 0
        for record in records:
            cases = fixture_cases(record, path)
            if not isinstance(cases, list) or not cases:
                add(errors, "C33", f"{fixture_id(record)}: concrete cases")
                continue
            for case in cases:
                if not isinstance(case, dict):
                    add(errors, "C33", f"{fixture_id(record)}: malformed case")
                    continue
                count += 1
                case_id = case.get("id") or case.get("caseId")
                if not isinstance(case_id, str) or not case_id or case_id in all_case_ids:
                    add(errors, "C33", f"{fixture_id(record)}: missing/duplicate case ID")
                all_case_ids.add(case_id)
                rendered = json.dumps(case, ensure_ascii=False, sort_keys=True).lower()
                if "evaluator://" in rendered or '"status": "completed"' in rendered:
                    add(errors, "C33", f"{case_id}: generic runner/completed predicate")
                if not (case.get("preState") or case.get("prestate") or record.get("preState") or record.get("assetPreState")):
                    add(errors, "C33", f"{case_id}: missing preState")
                if not (case.get("actions") or case.get("manualAction") or case.get("request")):
                    add(errors, "C33", f"{case_id}: missing action")
                if not (case.get("expected") or case.get("expect") or case.get("expectedOutcome")):
                    add(errors, "C33", f"{case_id}: missing exact expected result")
                if not (case.get("evidence") or case.get("evidenceMethod") or case.get("expected", {}).get("evidence") or record.get("evidence")):
                    add(errors, "C33", f"{case_id}: missing evidence")
        if count != expected_cases:
            add(errors, "C33", f"{artifact_id}: {count}/{expected_cases} concrete cases")
        checker = root / "fixtures" / checker_name
        try:
            result = subprocess.run([sys.executable, str(checker)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False, timeout=120, env=CHECKER_ENV)
            if result.returncode:
                raise ValueError(result.stdout.strip() or result.stderr.strip() or "group fixture self-check")
        except Exception as exc:
            add(errors, "C33", f"{artifact_id}: {exc}")
        all_fixture_ids.extend(ids)
    expected = [fixture for _, _, fixtures, _, _ in FIXTURE_GROUPS for fixture in fixtures]
    if all_fixture_ids != expected or len(all_case_ids) != 192:
        add(errors, "C33", "31 fixture IDs / 192 concrete case universe")


def validate_frozen_assets(docs, actual, errors, root=ROOT, structural_assets=False):
    """Validate detailed deterministic content rather than only asset existence."""
    checker = root / "assets" / "priority_asset_selfcheck.py"
    asset_paths = (
        "t08-validation-errors.json", "t19-webhooks.json", "t21-hostile-imports.json",
        "t22-scale-limits.json", "t25-usability-protocol.json", "t22_dataset_generator.py",
        "t22_workload_runner.py", "priority_asset_selfcheck.py",
    )
    def run_cached(key, arguments):
        cached = PRIORITY_ASSET_CHECK_CACHE.get(key)
        if cached is None and key not in PRIORITY_ASSET_CHECK_CACHE:
            try:
                # The deterministic 10,000-response export proof parses and
                # mutates real JSON/CSV bytes.  Keep ordinary structural checks
                # at the standard bound while allowing its documented deep
                # budget on shared CI hosts.
                timeout = 360 if arguments == ["--t22-deep-only"] else 120
                result = subprocess.run([sys.executable, str(checker), *arguments], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False, timeout=timeout, env=CHECKER_ENV)
                cached = None if result.returncode == 0 else (result.stdout.strip() or result.stderr.strip() or "asset self-check")
            except Exception as exc:
                cached = str(exc)
            PRIORITY_ASSET_CHECK_CACHE[key] = cached
        return cached

    structural_key = ("structural",) + tuple(sha(root / "assets" / name) for name in asset_paths)
    structural_error = run_cached(structural_key, ["--structural-only"])
    if structural_error is not None:
        add(errors, "C33", f"priority asset structural check: {structural_error}")
    if not structural_assets:
        # Full production validation still proves all frozen structures and
        # materializes T22 deterministically. Isolated mutation trees reuse
        # only this byte-keyed T22 proof, never a production CLI flag.
        deep_paths = ("t22-scale-limits.json", "t22_dataset_generator.py", "t22_workload_runner.py", "priority_asset_selfcheck.py")
        deep_error = run_cached(("t22-deep",) + tuple(sha(root / "assets" / name) for name in deep_paths), ["--t22-deep-only"])
        if deep_error is not None:
            add(errors, "C33", f"priority asset T22 deep check: {deep_error}")
    t22 = docs.get("assets/t22-scale-limits.json", {}).get("frozenInputProtocol", {})
    t22_datasets = t22.get("datasets", [])
    t22_commands = t22.get("commands", [])
    expected_datasets = {
        "catalog-10000", "complex-1000", "runtime-100-and-complex", "sessions-200",
        "compile-1000", "responses-10000", "durability-acknowledged-writes", "browser-at-matrix",
    }
    operation_inventory = t22.get("operationInventory", {})
    inventory_path = (root / ".." / "denominators" / "o-named.json").resolve()
    commands_by_workload = {item.get("workloadId"): item for item in t22_commands if isinstance(item, dict)}
    expected_workloads = {
        "large-catalog", "complex-form", "respondent-runtime", "save-submit",
        "import-compile", "api-export", "durability", "accessibility-browser",
    }
    if (
        t22.get("protocolVersion") != "t22-scale-v5"
        or t22.get("generatorTool", {}).get("version") != "t22-dataset/v3"
        or t22.get("runnerTool", {}).get("version") != "t22-runner/v6"
        or {item.get("id") for item in t22_datasets if isinstance(item, dict)} != expected_datasets
        or any(item.get("generatorVersion") != "t22-dataset/v3" for item in t22_datasets if isinstance(item, dict))
        or set(commands_by_workload) != expected_workloads
        or any(
            "--adapter" not in item.get("executionCommand", "")
            or "--adapter" not in item.get("warmExecutionCommand", "")
            or "--dry-run" not in item.get("dryRunCommand", "")
            for item in commands_by_workload.values()
        )
        or t22.get("runnerTool", {}).get("runtimeEnvironment", {}).get("required") != ["T22_BASE_URL", "T22_RUNTIME_ADAPTER"]
        or t22.get("browserDiscoveryProbe", {}).get("schemaVersion") != "t22-browser-discovery-probe/v3"
        or t22.get("browserDiscoveryProbe", {}).get("ownedProbe") != {
            "repoRelativePath": "assets/t22_browser_discovery_probe.py",
            "sha256": "230e9061eff59895286d11d1f2ee3d2100320df6856395b9a0bda8afb4d4c9d2",
            "invocation": ["{ownedProbePath}", "--config-id", "{configId}"],
            "mode": 755,
        }
        or sha(root / "assets" / "t22_browser_discovery_probe.py") != t22.get("browserDiscoveryProbe", {}).get("ownedProbe", {}).get("sha256")
        or int(f"{stat.S_IMODE((root / 'assets' / 't22_browser_discovery_probe.py').stat().st_mode):o}") != t22.get("browserDiscoveryProbe", {}).get("ownedProbe", {}).get("mode")
        or t22.get("rawResultSchema", {}).get("schemaVersion") != "t22-raw-result/v4"
        or not {"stageExecution", "setupSamples", "measurementSamples", "latencyBuckets", "exportJobChains", "thresholdFailures", "blockers"}.issubset(set(t22.get("rawResultSchema", {}).get("required", [])))
        or {"browserEvidence", "browserChannelDiscovery", "browserChannelDiscoveryRaw", "browserChannelDiscoveryArtifactSha256"}.intersection(set(t22.get("rawResultSchema", {}).get("required", [])))
        or t22.get("rawResultSchema", {}).get("requiredNonNull") != ["runId", "startedAtUtc", "endedAtUtc"]
        or t22.get("rawResultSchema", {}).get("browserDiscoveryConditional") != {"workloads": ["complex-form", "respondent-runtime", "accessibility-browser"], "whenExecutionStatus": "executed", "fields": ["browserEvidence", "browserChannelDiscovery", "browserChannelDiscoveryRaw", "browserChannelDiscoveryArtifactSha256", "browserReleaseAuthorities"], "nonBrowser": "allowed-null-or-absent"}
        or t22.get("rawResultSchema", {}).get("saveSubmitSampleRequired") != ["sessionId"]
        or len(t22.get("limits", [])) != 11
        or any(
            not isinstance(limit.get("limit"), int)
            or limit.get("plusOne") != limit["limit"] + 1
            or limit.get("expected", {}).get("httpStatus") != 422
            or limit.get("expected", {}).get("code") != "LIMIT_EXCEEDED"
            for limit in t22.get("limits", []) if isinstance(limit, dict)
        )
        or {control.get("id") for control in t22.get("rateControls", []) if isinstance(control, dict)} != {"administrative", "draft", "tenant-aggregate"}
        or t22.get("rateExecution", {}).get("draftMutationsPerSecond") != 20
        or t22.get("rateExecution", {}).get("durationSeconds") != 10
        or t22.get("browserInstrumentation", {}).get("requiredHook") != "browser_instrument"
        or t22.get("browserInstrumentation", {}).get("metrics") != ["localRenderMilliseconds", "firstUsableMilliseconds"]
        or t22.get("durabilityProtocol", {}).get("writesBeforeRestart") != 10
        or t22.get("durabilityProtocol", {}).get("writesAfterRestart") != 10
        or t22.get("durabilityProtocol", {}).get("backupRpoMaximumHours") != 24
        or t22.get("durabilityProtocol", {}).get("restoreRtoMaximumHours") != 4
        or {fault.get("kind") for fault in t22.get("durabilityProtocol", {}).get("faults", []) if isinstance(fault, dict)} != {"network", "service"}
        or operation_inventory.get("sha256") != sha(inventory_path)
    ):
        add(errors, "C33", "T22 O_named/adapter/dry-run protocol")
    return

    # Retained below as a readable legacy v1.8 protocol reference. The v1.9
    # checker is authoritative because it validates all exact frozen byte and
    # generator cases, including the expanded delivery/workload protocols.
    required_assets = {
        "assets/t08-validation-errors.json", "assets/t19-webhooks.json", "assets/t21-hostile-imports.json",
        "assets/t22-scale-limits.json", "assets/t25-usability-protocol.json",
    }
    if not required_assets <= set(actual):
        add(errors, "C33", "required frozen asset files")
        return
    t08 = docs["assets/t08-validation-errors.json"].get("frozenInputProtocol", {})
    addresses, expectations, request_bytes = t08.get("addresses", []), t08.get("caseExpectations", []), t08.get("requestBytes", {})
    t08_ids = {"whitespace-required-text", "invalid-date", "invalid-type-or-option", "forged-calculated-value", "read-only-edit", "out-of-range-decimal", "invalid-nested-row"}
    if (
        {item.get("caseId") for item in addresses if isinstance(item, dict)} != t08_ids
        or {item.get("caseId") for item in expectations if isinstance(item, dict)} != t08_ids
        or set(request_bytes) != t08_ids or len(addresses) != len(expectations) != len(request_bytes) != 7
        or any(item.get("failureCode") != "validation.invalid" or item.get("reject") is not True for item in expectations)
        or any(not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]+", value) for value in request_bytes.values())
    ):
        add(errors, "C33", "T08 detailed byte/address/failure cases")
    t19 = docs["assets/t19-webhooks.json"].get("frozenInputProtocol", {})
    t19_ids = {"valid-signature", "tampered-body", "old-timestamp", "duplicate", "out-of-order", "retry-429", "retry-exhaustion", "pause-401", "disable-410", "rotation", "replay", "reference-full", "deletion"}
    cases, events = t19.get("deterministicCases", []), t19.get("events", [])
    if (
        len(cases) != 13 or {item.get("id") for item in cases if isinstance(item, dict)} != t19_ids
        or len(events) != 3 or {item.get("eventId") for item in events if isinstance(item, dict)} != {"evt-0001", "evt-0002", "evt-0003"}
        or [item.get("responseStatus") for item in t19.get("faultHandles", []) if isinstance(item, dict)] != [429, 500, 401, 410, None]
        or t19.get("retryOffsetsSeconds") != [60, 300, 1800, 7200, 21600, 43200, 86400]
        or t19.get("receiverHandle", {}).get("secretValueMaterialized") is not False
    ):
        add(errors, "C33", "T19 detailed receiver/fault/event cases")
    t21 = docs["assets/t21-hostile-imports.json"].get("frozenInputProtocol", {})
    t21_ids = {"duplicate-keys", "executable-property", "unsupported-component-url", "unknown-operator", "unknown-field-type", "depth-bomb", "size-bomb", "invalid-unicode", "cross-tenant-candidate", "expired-candidate", "forged-approval"}
    cases, payloads = t21.get("cases", []), t21.get("payloadBytes", {})
    if (
        len(cases) != 11 or {item.get("id") for item in cases if isinstance(item, dict)} != t21_ids or set(payloads) != t21_ids
        or any(item.get("expect") != "reject before persistence" or item.get("boundedResourceMeasurementRequired") is not True for item in cases)
        or any(not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]+", value) for value in payloads.values())
    ):
        add(errors, "C33", "T21 detailed hostile byte cases")
    t22 = docs["assets/t22-scale-limits.json"]
    protocol, record = t22.get("frozenInputProtocol", {}), t22.get("records", [{}])[0]
    datasets = {item.get("id"): item for item in protocol.get("datasets", []) if isinstance(item, dict)}
    if (
        protocol.get("executionStatus") != "not-run" or set(datasets) != {"forms-10000", "fields-1000", "sessions-200"}
        or datasets["forms-10000"] != {"id": "forms-10000", "count": 10000, "fieldsPerForm": 1}
        or datasets["fields-1000"] != {"id": "fields-1000", "count": 1000, "fieldsPerForm": 1000}
        or datasets["sessions-200"] != {"id": "sessions-200", "count": 200, "answersPerSession": 10}
        or len(protocol.get("datasetSeeds", {})) != 4 or len(protocol.get("commands", [])) != 4 or len(protocol.get("workloadCommands", [])) != 4
        or protocol.get("measurements") != ["p50", "p95", "p99", "memoryBytes", "errorCount", "cost"]
        or record.get("expected", {}).get("rawBenchmarkDataRequired") is not True
        or "Durability" not in "\n".join(citation.get("quote", "") for citation in record.get("prdCitations", []))
    ):
        add(errors, "C33", "T22 dataset/workload/limit/durability checklist")
    t25 = docs["assets/t25-usability-protocol.json"]
    protocol, record = t25.get("frozenInputProtocol", {}), t25.get("records", [{}])[0]
    participants, tasks, matrix = protocol.get("participants", []), protocol.get("tasks", []), protocol.get("browserDeviceATMatrix", [])
    if (
        protocol.get("executionStatus") != "not-run" or len(participants) != 10
        or [participant.get("id") for participant in participants if isinstance(participant, dict)] != [f"A{n}" for n in range(1, 6)] + [f"R{n}" for n in range(1, 6)]
        or len(tasks) != 4 or len(matrix) != 4
        or not {"orientation", "counterbalance", "observation", "anonymization", "scoring", "participantPolicy", "browserAccessibilityPolicy"} <= set(protocol)
        or record.get("expected", {}).get("authorsPerTool") != 5 or record.get("expected", {}).get("respondentsPerTool") != 5
    ):
        add(errors, "C33", "T25 participant/task/browser/protocol checklist")


def validate_fixture_packages(errors, root=ROOT):
    """Run the frozen full-fixture/package structural checker as C11/C33 input."""
    checker = root / "fixtures" / "check_full_fixture_oracles.py"
    try:
        result = subprocess.run([sys.executable, str(checker)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False, timeout=120, env=CHECKER_ENV)
        if result.returncode:
            raise ValueError(result.stdout.strip() or result.stderr.strip() or "fixture/package self-check")
    except Exception as exc:
        add(errors, "C33", f"fixture/package self-check: {exc}")


def check_denominator_closure(manifest, errors):
    closure_ref = manifest.get("crossScopeRefs", {}).get("denominatorClosure", {})
    index_path = REPO / closure_ref.get("manifestIndexPath", "")
    sums_path = REPO / closure_ref.get("sha256sumsPath", "")
    if not index_path.exists() or not sums_path.exists() or closure_ref.get("manifestIndexSha256") != sha(index_path) or closure_ref.get("sha256sumsSha256") != sha(sums_path):
        add(errors, "C28", "denominator index/SHA256SUMS pin")
        return
    try:
        index = json.loads(index_path.read_text())
        closure = index["closure"]
        if index.get("version") != "2.0.0-m0" or closure.get("sha256sumsSha256") != sha(sums_path):
            raise ValueError("version or sums pin")
        rows = [line.split(None, 1) for line in sums_path.read_text().splitlines() if line.strip()]
        sums = {name: value for value, name in rows if len(value) == 64}
        members = set(closure["memberPaths"])
        if set(sums) != members or len(sums) != len(rows):
            raise ValueError("member set")
        denominator_dir = index_path.parent
        for name in members:
            if not (denominator_dir / name).is_file() or sums[name] != sha(denominator_dir / name):
                raise ValueError(f"member {name}")
        for name, detail in index["manifests"].items():
            if detail.get("sha256") != sums.get(name) or detail.get("sha256") != sha(denominator_dir / name):
                raise ValueError(f"indexed manifest {name}")
        if index.get("exclusions", {}).get("sec-total.json", {}).get("sha256") != sums.get("sec-total.json"):
            raise ValueError("SEC exclusion pin")
        review_ref_path = closure_ref.get("reviewAttestationPath")
        review_ref_sha = closure_ref.get("reviewAttestationSha256")
        review_pointer = index.get("independentReviewAttestation", {})
        review_path = REPO / review_ref_path
        if (
            review_ref_path != review_pointer.get("path")
            or review_ref_sha != review_pointer.get("sha256")
            or not review_path.is_file()
            or sha(review_path) != review_ref_sha
        ):
            raise ValueError("review attestation pin")
    except Exception as exc:
        add(errors, "C28", f"invalid denominator transitive closure: {exc}")
        return
    if manifest.get("signature", {}).get("state") != "signed":
        return
    pointer = index.get("independentReviewAttestation")
    expected_pointer = {
        "status", "path", "sha256", "authority", "reviewer", "attestedAt", "decision", "preAttestationBinding", "note",
    }
    if not isinstance(pointer, dict) or set(pointer) != expected_pointer:
        add(errors, "C28", "evaluator signing requires a complete denominator review pointer")
        return
    try:
        attestation_path = (REPO / pointer["path"]).resolve()
        if not attestation_path.is_relative_to(index_path.parent.resolve()) or attestation_path.name != "review-attestation.json":
            raise ValueError("attestation path")
        if not isinstance(pointer["sha256"], str) or sha(attestation_path) != pointer["sha256"]:
            raise ValueError("attestation digest")
        attestation_member = attestation_path.relative_to(index_path.parent).as_posix()
        if attestation_member not in members or sums.get(attestation_member) != pointer["sha256"]:
            raise ValueError("attestation is not bound into the denominator closure")
        attestation = json.loads(attestation_path.read_text(encoding="utf-8"))
        build_path = REPO / "docs/acceptance/v1.1/denominators/build_manifests.py"
        spec = importlib.util.spec_from_file_location("evaluator_denominator_builder", build_path)
        if spec is None or spec.loader is None:
            raise ValueError("denominator builder")
        module = importlib.util.module_from_spec(spec)
        write_bytecode = sys.dont_write_bytecode
        sys.path.insert(0, str(REPO))
        try:
            sys.dont_write_bytecode = True
            spec.loader.exec_module(module)
        finally:
            sys.dont_write_bytecode = write_bytecode
            sys.path.pop(0)
        binding = denominator_review.reconstruct_pre_attestation_binding(
            index_path.parent, lambda output: module.build(output, pending=True)
        )
        valid, detail = denominator_review.validate_denominator_attestation(
            attestation, version=index["version"], binding=binding
        )
        if not valid:
            raise ValueError(detail)
        if any(pointer[key] != attestation.get(key) for key in ("authority", "reviewer", "attestedAt", "decision", "preAttestationBinding")):
            raise ValueError("attestation pointer metadata")
        if denominator_review.classify_denominator_review(attestation, version=index["version"], binding=binding) not in {
            "reviewed-by-independent-agent", "reviewed-by-human-independent",
        }:
            raise ValueError("attestation is not independently approved")
    except Exception as exc:
        add(errors, "C28", f"evaluator signing requires approved denominator technical review: {exc}")


def signed_state_policy_ok(manifest, signature):
    """Keep signed metadata coherent without granting product/human approval."""
    lineage = manifest.get("reviewLineage", {})
    status = manifest.get("status", {})
    blocked_reasons = {
        entry.get("reason") for entry in manifest.get("blocked", []) if isinstance(entry, dict)
    }
    return (
        manifest.get("attestationState") == SIGNED_ATTESTATION_STATE
        and manifest.get("reviewState") == SIGNED_REVIEW_STATE
        and manifest.get("frozenAt") == signature.get("signedAt")
        and lineage.get("status") == "approved-independent-review"
        and lineage.get("claimsNotMade") == SIGNED_CLAIMS_NOT_MADE
        and not any(
            isinstance(entry, dict) and entry.get("status") in {"pending", "unsigned-pending"}
            for entry in lineage.get("entries", [])
        )
        and not (blocked_reasons & SIGNED_RESOLVED_BLOCKERS)
        and status.get("measuredConformanceExecuted") is False
        and status.get("productTestsExecuted") is False
        and status.get("localePacksNativeReviewed") is False
    )


def validate(root=ROOT, require_denial_list=True, test_structural_assets=False):
    errors, docs = [], {}
    for path in corpus_files(root):
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf") or b"\r" in raw or b"\t" in raw or not raw.endswith(b"\n") or raw.endswith(b"\n\n"):
            add(errors, "C01", f"{path}: byte hygiene")
        if path.suffix == ".json":
            try:
                value = json.loads(raw.decode("utf-8"))
                if raw.decode("utf-8") != canonical(value):
                    add(errors, "C01", f"{path}: noncanonical JSON")
                docs[path.relative_to(root).as_posix()] = value
            except Exception as exc:
                add(errors, "C01", f"{path}: {exc}")
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    docs["manifest.json"] = manifest
    schema = docs.get("conventions/record-schema.json", {})
    required = set(schema.get("required", []))
    all_records = [(name, record) for name, value in docs.items() if name not in {"manifest.json", "conventions/record-schema.json"} for record in record_walk(value)]
    seen, expected_seen = set(), set()
    for name, record in all_records:
        rid = record.get("id")
        if not valid_record_schema(record, required) or json_schema_errors(schema, record):
            add(errors, "C02", f"{name}: schema violation {rid}")
        if not isinstance(rid, str) or rid in seen:
            add(errors, "C03", f"{name}: invalid/duplicate id {rid}")
        seen.add(rid)
        citations = record.get("prdCitations")
        if not isinstance(citations, list) or not citations:
            add(errors, "C04", f"{rid}: missing citation")
        if record.get("status") != "not-run":
            add(errors, "C05", f"{rid}: status is not not-run")
        if any(word in json.dumps(record, ensure_ascii=False) for word in FORBIDDEN):
            add(errors, "C06", f"{rid}: placeholder")
        if not record.get("fixtures") and not record.get("milestoneGates"):
            add(errors, "C07", f"{rid}: orphan")
        marker = (record.get("assertionType"), json.dumps(record.get("expected"), sort_keys=True, ensure_ascii=False))
        if marker in expected_seen:
            add(errors, "C07", f"{rid}: duplicate expected outcome")
        expected_seen.add(marker)
        if record.get("evidenceLevel") in {"E3", "human"} and not (record.get("blockedReason") or record.get("accessPrerequisite")):
            add(errors, "C20", f"{rid}: missing external/human blocker")

    # C04/C30/C32: exact source-set, exact source hashes, and exact range bytes.
    source_set = manifest.get("sourceSet", {})
    declared = {s.get("name"): s for s in manifest.get("sources", []) if isinstance(s, dict)}
    if source_set.get("names") != ["PRD", "PROTO", "CONTRACT", "AUTH", "REG"] or set(declared) != set(SOURCE_PATHS):
        add(errors, "C30", "exact source-set names")
    for name, rel in SOURCE_PATHS.items():
        item = declared.get(name, {})
        path = REPO / rel
        if item.get("path") != rel or item.get("sha256") != sha(path):
            add(errors, "C22", f"source pin {name}")
        if source_set.get("sourcePaths", {}).get(name) != rel:
            add(errors, "C30", f"source path {name}")
    for _, record in all_records:
        for citation in record.get("prdCitations", []):
            if not isinstance(citation, dict) or citation.get("file") not in SOURCE_PATHS or not isinstance(citation.get("lines"), str) or not RANGE.fullmatch(citation["lines"]):
                add(errors, "C04", f"{record.get('id')}: malformed citation")
                continue
            try:
                text = source_lines(citation["file"], citation["lines"])
                if not citation.get("quote") or citation["quote"] not in text:
                    add(errors, "C04", f"{record.get('id')}: quote absent")
                    raise ValueError("quote absent")
                if citation.get("sourceSha256") != sha(REPO / SOURCE_PATHS[citation["file"]]) or citation.get("rangeSha256") != hashlib.sha256(text.encode()).hexdigest():
                    raise ValueError("source/range hash")
            except Exception as exc:
                add(errors, "C32", f"{record.get('id')}: {exc}")

    # Retained deterministic corpus shape checks.
    nav = docs.get("navigation/navigation-oracle.json", {})
    frozen = ["Answer steps complete. Review and submit remain.", "An answer added a step.", "Remaining steps may change.", "No answer steps. Review and submit remain."]
    if nav.get("frozenStrings") != frozen:
        add(errors, "C08", "frozen navigation strings")
    nav_ids = {r.get("id") for r in nav.get("records", [])}
    if nav_ids != {"EVAL-NAV-BASE", *(f"EVAL-NAV-{n:02}" for n in range(1, 6))}:
        add(errors, "C09", "navigation records")
    status_map = docs.get("review/status-label-map.json", {})
    if status_map.get("statusVocabulary") != ["answered", "unanswered", "unknown", "declined", "respondentNotApplicable", "notApplicable"]:
        add(errors, "C10", "status map")
    def package_complete(package):
        """Require the authoritative 4.0.0 wire package, not legacy wrappers."""
        required_root = {
            "schemaVersion", "engineContract", "contractVersion", "kind", "formKey", "definitionVersion",
            "titleKey", "descriptionKey", "defaultLocale", "supportedLocales", "data", "flow",
            "expressions", "guidance", "translations", "theme", "policies", "dependencies", "assets",
        }
        fields = package.get("data", {}).get("fields", [])
        phases = package.get("flow", {}).get("phases", [])
        pages = [page for phase in phases if isinstance(phase, dict) for page in phase.get("pages", [])]
        field_ids = [field.get("id") for field in fields if isinstance(field, dict)]
        node_field_ids = [
            node.get("fieldId")
            for page in pages if isinstance(page, dict)
            for section in page.get("sections", []) if isinstance(section, dict)
            for node in section.get("nodes", []) if isinstance(node, dict) and node.get("kind") == "question"
        ]
        translations = package.get("translations", {})
        metadata_ok = all(isinstance(package.get(key), str) and package[key] for key in ("formKey", "definitionVersion", "titleKey", "descriptionKey"))
        locales_ok = (
            package.get("defaultLocale") == "en"
            and package.get("supportedLocales") == ["en", "hi", "ar"]
            and set(translations) == {"en", "hi", "ar"}
            and all(
                isinstance(translations[locale], dict)
                and translations[locale].get("direction") == ("rtl" if locale == "ar" else "ltr")
                and isinstance(translations[locale].get("messages"), dict)
                for locale in translations
            )
        )
        return (
            set(package) == required_root
            and {key: package.get(key) for key in ("schemaVersion", "engineContract", "contractVersion")} == {
                "schemaVersion": "4.0.0", "engineContract": "4.0.0", "contractVersion": "4.0.0",
            }
            and package.get("kind") == "smart-form-package"
            and metadata_ok and locales_ok
            and isinstance(package.get("expressions"), dict) and package["expressions"]
            and isinstance(package.get("guidance"), dict) and package["guidance"]
            and len(fields) == 32 and len(pages) == 5
            and len(field_ids) == len(set(field_ids)) == 32
            and len(node_field_ids) == len(set(node_field_ids)) == 32 and set(node_field_ids) == set(field_ids)
            and package.get("flow", {}).get("startPageId") in {page.get("id") for page in pages if isinstance(page, dict)}
            and all(
                isinstance(field.get("labelKey"), str) and field["labelKey"]
                and field.get("visibilityExpressionId") in package["expressions"]
                and field.get("requiredExpressionId") in package["expressions"]
                and field.get("validationExpressionId") in package["expressions"]
                and field.get("guidanceId") in package["guidance"]
                for field in fields if isinstance(field, dict)
            )
            and package.get("emptyAggregateCases") is None
            and not any("observed" in key.lower() or key == "parityActual" for key in package)
        )
    if not all(package_complete(package) for package in (docs.get("packages/package-hc.json", {}), docs.get("packages/package-nhc.json", {}))):
        add(errors, "C11", "frozen package definition")
    validate_fixture_packages(errors, root)
    matrix = docs.get("packages/catalog-coverage-matrix.json", {}).get("records", [])
    if len(matrix) != 17:
        add(errors, "C11", "catalog matrix")
    oracle = docs.get("oracles/respondent-oracle.json", {})
    outcomes = {r.get("expected", {}).get("canonicalKey"): r.get("expected", {}) for r in record_walk(oracle) if str(r.get("id", "")).startswith("EVAL-RESP-O")}
    if outcomes.get("total", {}).get("value") != "44.75" or outcomes.get("extraAttendees", {}).get("value") != "0" or outcomes.get("equipmentA", {}).get("quantity") != "3" or outcomes.get("equipmentB", {}).get("quantity") != "1":
        add(errors, "C12", "respondent arithmetic/typing")
    attachment = outcomes.get("supportingFiles", {})
    if attachment.get("bytes") != 8 or hashlib.sha256(attachment.get("fixtureBytesUtf8", "").encode()).hexdigest() != attachment.get("sha256"):
        add(errors, "C13", "attachment digest")
    packs = docs.get("locales/key-inventory.json", {}).get("localePacks", {})
    en_values = packs.get("en", {}).get("messageValues")
    if not isinstance(en_values, dict) or len(en_values) != 277:
        add(errors, "C14", "277-key exact recursive locale closure")
    checker = root / "locales" / "check_locale_closure.py"
    try:
        result = subprocess.run([sys.executable, str(checker)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False, timeout=120, env=CHECKER_ENV)
        if result.returncode:
            raise ValueError(result.stdout.strip() or result.stderr.strip() or "locale closure self-check")
    except Exception as exc:
        add(errors, "C14", f"locale closure checker: {exc}")
    if docs.get("locales/plural-map.json", {}).get("grammar") != "smartforms-cardinal-1":
        add(errors, "C15", "plural map")
    sent = docs.get("sentinels/public-catalog.json", {}).get("records", [])
    commitment = docs.get("sentinels/commitments.json", {}).get("rounds", [{}])[0]
    if len(sent) != 7 or any(r.get("expected", {}).get("payloadCommitted") is not False for r in sent) or commitment.get("slotCount") != len(commitment.get("scheduledSentinelIds", [])) + commitment.get("nullSlots", 0) or commitment.get("commitments") != [] or commitment.get("sealed") is not False:
        add(errors, "C16", "sentinel catalog/commitment")
    denial_path = REPO / "docs/acceptance/v1.1/inventory/inventory.json"
    denial = json.loads(denial_path.read_text()).get("formerlyRemovedWholeCoreDenialList", {})
    if require_denial_list and (denial.get("declaredCount") != 7 or denial.get("enumerationAvailable") is not True or len(denial.get("identifiers", [])) != 7):
        add(errors, "C17", "blocked: denial-list-unenumerated at inventory.json#/formerlyRemovedWholeCoreDenialList/identifiers")

    listed = {item.get("path"): item.get("sha256") for item in manifest.get("artifacts", [])}
    actual = {p.relative_to(root).as_posix(): sha(p) for p in corpus_files(root)}
    if manifest.get("corpusDigest") != corpus_digest(root) or listed != actual:
        add(errors, "C18", "aggregate or per-file digest")
    refs = manifest.get("crossScopeRefs", {})
    for key in ("inventoryManifest", "denominatorManifest"):
        ref = refs.get(key, {})
        path = REPO / ref.get("path", "")
        if not path.exists() or ref.get("sha256") != sha(path):
            add(errors, "C18", f"cross-scope pin {key}")
    status = manifest.get("status", {})
    if status.get("measuredConformanceExecuted") is not False or status.get("productTestsExecuted") is not False:
        add(errors, "C19", "conformance claim")

    # C21/C23/C24/C26/C27 retain complete traceability and embedded-version checks.
    with (REPO / SOURCE_PATHS["REG"]).open(encoding="utf-8") as handle:
        reg_rows = list(csv.DictReader(handle))
    accepted = {row["requirementId"]: {x.strip() for x in row["acceptance"].split(",")} for row in reg_rows}
    for _, record in all_records:
        reqs, fixtures = record.get("requirements", []), record.get("fixtures", [])
        if not reqs or not fixtures or any(req not in accepted or not (set(fixtures) & accepted[req]) for req in reqs):
            add(errors, "C21", str(record.get("id")))
    cov = docs.get("coverage/fixture-coverage.json", {})
    cov_rows = cov.get("records", [])
    expected_fixtures = {f"T{n:02}" for n in range(1, 16)} | {f"T{n:02}" for n in range(17, 33)}
    validate_group_fixture_oracles(docs, errors, root)
    if len(cov_rows) != 31 or {r.get("expected", {}).get("fixture") for r in cov_rows} != expected_fixtures or any(
        r.get("expected", {}).get("corpusCoverage") != "oracle-encoded"
        or r.get("expected", {}).get("canonicalGroupArtifactId") != FIXTURE_GROUP_BY_ID.get(r.get("expected", {}).get("fixture"), (None, None))[0]
        or r.get("expected", {}).get("canonicalGroupArtifactPath") != FIXTURE_GROUP_BY_ID.get(r.get("expected", {}).get("fixture"), (None, None))[1]
        or r.get("expected", {}).get("canonicalFixtureId") != r.get("expected", {}).get("fixture")
        or not {FIXTURE_GROUP_BY_ID.get(r.get("expected", {}).get("fixture"), (None, None))[0], r.get("expected", {}).get("fixture")} <= set(r.get("expected", {}).get("coveringRecordIds", []))
        for r in cov_rows
    ):
        add(errors, "C23", "canonical grouped fixture coverage")
    for key, value in refs.items():
        if key.endswith("Ref") and isinstance(value, str) and "#" in value and value.split("#", 1)[0].endswith(".json"):
            try:
                pointer(value)
            except Exception:
                add(errors, "C24", key)
    if any(value.get("corpusVersion") != manifest.get("corpusVersion") for value in docs.values() if isinstance(value, dict) and "corpusVersion" in value):
        add(errors, "C26", "embedded version")
    cited = {citation.get("lines") for _, record in all_records for citation in record.get("prdCitations", []) if isinstance(citation, dict) and citation.get("file") == "PRD"}
    if not {"1445", "1446", "1447", "1448", "1449", "1450", "1451", "1453", "1458", "1460", "1462", "1464"} <= cited:
        add(errors, "C27", "Appendix C section 8/9 coverage")

    # C25/C31: no per-scalar claims; record-level modes are closed and executable where computed.
    if any("scalarProvenance" in record for _, record in all_records):
        add(errors, "C25", "per-scalar provenance is forbidden")
    registry = docs.get("provenance/rule-registry.json", {})
    rules = {rule.get("id"): rule for rule in registry.get("rules", [])}
    allowlist = docs.get("provenance/evaluator-selected-allowlist.json", {})
    review = docs.get("provenance/interpretation-review.json", {})
    if approval_document_schema_errors(allowlist, docs.get("provenance/allowlist-approval.schema.json", {}), "allowlist"):
        add(errors, "C31", "allowlist approval schema")
    if approval_document_schema_errors(review, docs.get("provenance/interpretation-review.schema.json", {}), "interpretation"):
        add(errors, "C31", "interpretation approval schema")
    selected_ids = {"EVAL-PKG-BUDGET"}
    interpreted_ids = {entry.get("recordId") for entry in review.get("contentBindings", [])}
    expected_interpreted_ids = {record.get("id") for value in docs.values() for record in record_walk(value) if record.get("oracleProvenance", {}).get("mode") == "independently-reviewed-interpretation"}
    if set(allowlist.get("recordIds", [])) != selected_ids or interpreted_ids != expected_interpreted_ids:
        add(errors, "C31", "exact allowlist/interpreted record-ID equality")
    for _, record in all_records:
        prov = record.get("oracleProvenance", {})
        mode = prov.get("mode")
        if mode == "source-literal":
            if not record.get("prdCitations"):
                add(errors, "C31", f"literal without citation {record.get('id')}")
        elif mode == "source-computed":
            rule = rules.get(prov.get("ruleId"))
            if not rule:
                add(errors, "C31", f"unknown rule {record.get('id')}")
            elif prov.get("ruleId") == "cap-plus-one/v1":
                try:
                    if [int(v) + 1 for v in prov["inputs"]["limits"]] != prov["outputs"]["capPlusOne"]:
                        raise ValueError()
                except Exception:
                    add(errors, "C31", f"rule result {record.get('id')}")
        elif mode == "evaluator-selected":
            if (
                record.get("id") not in allowlist.get("recordIds", [])
                or prov.get("allowlistPath") != "provenance/evaluator-selected-allowlist.json"
                or prov.get("allowlistId") not in {allowlist.get("allowlistId"), record.get("id")}
            ):
                add(errors, "C31", f"unlisted evaluator selection {record.get('id')}")
        elif mode == "independently-reviewed-interpretation":
            if prov.get("reviewId") not in review.get("interpretationIds", []) or prov.get("reviewPath") != "provenance/interpretation-review.json":
                add(errors, "C31", f"untracked interpretation {record.get('id')}")
        else:
            add(errors, "C31", f"unknown provenance mode {record.get('id')}")
    expected_bindings = []
    for path, record in all_records:
        provenance = record.get("oracleProvenance", {})
        if provenance.get("mode") == "independently-reviewed-interpretation":
            expected_bindings.append({
                "reviewId": provenance.get("reviewId"), "recordId": record.get("id"), "sourcePath": path,
                "recordCanonicalSha256": hashlib.sha256(canonical(record).encode()).hexdigest(),
            })
    if (
        review.get("reviewStatus") not in {"pending-independent-review", "approved"}
        or review.get("contentBindings") != expected_bindings
        or review.get("interpretationIds") != sorted({binding["reviewId"] for binding in expected_bindings})
    ):
        add(errors, "C31", "content-bound interpretation ledger")

    # C28-C34: transitive denominator closure, content-bound manifest, assets, and honest lineage.
    check_denominator_closure(manifest, errors)
    signature = manifest.get("signature", {})
    authority = manifest.get("signatureAuthority", {})
    unsigned = signature.get("state") == "unsigned-pending" and signature.get("value") is None and signature.get("signer") is None
    pre_signature = manifest.get("preSignatureManifestDigest", {})
    digest = canonical_manifest_digest(manifest)
    signed = (
        signature.get("state") == "signed" and authority_ok(authority)
        and signature.get("authority") == authority.get("authority") and signature.get("provider") == authority.get("provider")
        and signature.get("decision") == "approved" and isinstance(signature.get("signer"), str) and bool(signature["signer"])
        and UTC.fullmatch(signature.get("signedAt", "")) is not None
        and signature_valid(signature, authority, "evaluator-manifest/v1", digest)
    )
    if (
        not (unsigned or signed)
        or not authority_ok(authority)
        or pre_signature.get("algorithm") != "SHA-256"
        or pre_signature.get("normalization") != "canonical JSON (sort_keys, UTF-8, trailing LF); normalize signature.value, signature.payloadDigest, and preSignatureManifestDigest.storedValue to null"
        or pre_signature.get("storedValue") != digest
    ):
        add(errors, "C29", "invalid pre-signature manifest state/digest protocol")
    validate_frozen_assets(docs, actual, errors, root, structural_assets=test_structural_assets)
    if signature.get("state") == "signed":
        if not signed_approval_ok(allowlist, authority, "approvalStatus", "approved", "approvedAt") or not signed_approval_ok(review, authority, "reviewStatus", "approved", "reviewedAt"):
            add(errors, "C31", "signed corpus requires approved allowlist and semantic ledger")
        lineage = manifest.get("reviewLineage", {})
        if lineage.get("status") != "approved-independent-review" or not lineage_approval_ok(lineage.get("approval")):
            add(errors, "C34", "signed corpus requires approved independent review lineage")
        if not signed_state_policy_ok(manifest, signature):
            add(errors, "C34", "signed corpus has stale unsigned/pending freeze state")
    else:
        if (
            allowlist.get("approvalStatus") != "pending-independent-review" or "approval" in allowlist
            or review.get("reviewStatus") != "pending-independent-review" or "approval" in review
        ):
            add(errors, "C31", "unsigned corpus has fabricated approval")
        lineage = manifest.get("reviewLineage", {})
        if lineage.get("status") != "pending-independent-review" or any(key in manifest.get("attestation", {}) for key in ("reviewedBy", "preparedBy")):
            add(errors, "C34", "stale or fabricated review lineage")
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-blocked-denial-list", action="store_true")
    args = parser.parse_args()
    errors = validate(require_denial_list=not args.allow_blocked_denial_list)
    for key, message in errors:
        print(f"{key}: {message}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
