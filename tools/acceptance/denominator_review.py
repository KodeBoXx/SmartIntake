"""Shared, dependency-free denominator technical-review validation.

The functions here intentionally validate release metadata rather than product
behavior.  They are shared so release generation and aggregate checks cannot
silently diverge on attestation semantics.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

SHA256 = re.compile(r"[0-9a-f]{64}\Z")
RFC3339_UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\Z")
AUTHORITIES = frozenset({"independent-agent-review", "human-independent-review", "advisory-non-human"})
SCOPE = "denominator-technical-review"
TYPE = "denominator-technical-review"
BINDING_KIND = "pre-attestation-denominator-release/v2"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _utc_timestamp(value: Any) -> bool:
    """Accept only canonical RFC3339 UTC instants, never a local offset."""
    if not isinstance(value, str) or not RFC3339_UTC.fullmatch(value):
        return False
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
        return parsed.utcoffset() is not None and parsed.utcoffset().total_seconds() == 0
    except ValueError:
        return False


def reconstruct_pre_attestation_binding(
    directory: Path, build_pending: Callable[[Path], None]
) -> dict[str, str]:
    """Rebuild canonical pending bytes and return their non-circular binding."""
    import tempfile

    with tempfile.TemporaryDirectory(prefix="denominator-pre-attestation-") as name:
        pending = Path(name)
        build_pending(pending)
        return {
            "kind": BINDING_KIND,
            "manifestIndexSha256": _sha256(pending / "manifest-index.json"),
            "sha256sumsSha256": _sha256(pending / "SHA256SUMS"),
        }


def validate_denominator_attestation(
    record: Any, *, version: str, binding: dict[str, str]
) -> tuple[bool, str]:
    """Validate the strict, closed attestation contract and its byte binding."""
    expected = {
        "schemaVersion", "attestationType", "authority", "status", "decision", "reviewer",
        "attestedAt", "manifestVersion", "scope", "preAttestationBinding",
    }
    if not isinstance(record, dict) or set(record) != expected:
        return False, "attestation must contain exactly the denominator technical-review fields"
    if record["schemaVersion"] != "1.0.0" or record["attestationType"] != TYPE or record["scope"] != SCOPE:
        return False, "attestation schema/type/scope is invalid"
    if record["authority"] not in AUTHORITIES or record["manifestVersion"] != version:
        return False, "attestation authority or manifest version is invalid"
    if not isinstance(record["reviewer"], str) or not record["reviewer"].strip() or not _utc_timestamp(record["attestedAt"]):
        return False, "attestation reviewer or UTC timestamp is invalid"
    if record["authority"] == "advisory-non-human":
        if (record["status"], record["decision"]) != ("advisory", "advisory"):
            return False, "advisory attestation must remain advisory"
    elif record["status"] != "attested" or record["decision"] not in {"approved", "rejected"}:
        return False, "independent attestation must be attested with approved or rejected decision"
    submitted = record["preAttestationBinding"]
    if not isinstance(submitted, dict) or set(submitted) != set(binding):
        return False, "attestation pre-attestation binding shape is invalid"
    if any(not isinstance(value, str) or not SHA256.fullmatch(value) for key, value in submitted.items() if key != "kind"):
        return False, "attestation pre-attestation hashes are invalid"
    if submitted != binding:
        return False, "attestation pre-attestation binding does not match reconstructed bytes"
    return True, "valid"


def classify_denominator_review(record: Any | None, *, version: str, binding: dict[str, str] | None = None) -> str:
    """Return release status without ever labelling agent review as human review."""
    if record is None:
        return "unreviewed-not-released"
    if binding is None:
        return "unreviewed-not-released"
    valid, _ = validate_denominator_attestation(record, version=version, binding=binding)
    if not valid or record["decision"] != "approved":
        return "unreviewed-not-released"
    if record["authority"] == "independent-agent-review":
        return "reviewed-by-independent-agent"
    if record["authority"] == "human-independent-review":
        return "reviewed-by-human-independent"
    return "unreviewed-not-released"
