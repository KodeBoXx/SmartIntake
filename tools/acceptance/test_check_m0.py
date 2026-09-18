#!/usr/bin/env python3
"""Focused negative tests for the M0 aggregate integrity checker."""
from __future__ import annotations

import contextlib
import base64
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

MODULE_PATH = Path(__file__).with_name("check_m0.py")
SPEC = importlib.util.spec_from_file_location("check_m0", MODULE_PATH)
assert SPEC and SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)


class M0CheckerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).resolve().parents[2]
        # Aggregate mutations alter freeze metadata, not priority assets. Keep
        # the deep generation assertion in the evaluator suite and isolate
        # these copied trees structurally.
        checker.AGGREGATE_TEST_STRUCTURAL_ASSETS = True

    def copied_denominators(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        target = root / "docs/acceptance/v1.1/denominators"
        target.parent.mkdir(parents=True)
        shutil.copytree(self.root / "docs/acceptance/v1.1/denominators", target)
        return temporary, root

    def copied_inventory(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        target = root / "docs/acceptance/v1.1/inventory"
        target.parent.mkdir(parents=True)
        shutil.copytree(self.root / "docs/acceptance/v1.1/inventory", target)
        return temporary, root

    def denominator_index(self, root: Path) -> tuple[Path, dict[str, object]]:
        path = root / "docs/acceptance/v1.1/denominators/manifest-index.json"
        return path, json.loads(path.read_text(encoding="utf-8"))

    def copied_evaluator_repository(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        shutil.copytree(self.root / "docs", root / "docs")
        (root / "tools/acceptance").mkdir(parents=True)
        shutil.copyfile(self.root / "tools/acceptance/denominator_review.py",
                        root / "tools/acceptance/denominator_review.py")
        return temporary, root

    @staticmethod
    def write_json(path: Path, value: object) -> None:
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, separators=(",", ": ")) + "\n",
                        encoding="utf-8")

    def make_signed_evaluator(self, root: Path) -> tuple[object, object, dict[str, object]]:
        """Create a real Ed25519-signed evaluator corpus in an isolated tree."""
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

        validator = checker.evaluator_validator(root)
        private_key = Ed25519PrivateKey.generate()
        authority = {
            "authority": "independent-agent-review", "provider": "codex-gpt", "keyId": "evaluator-aggregate-test-ed25519-v1",
            "publicKey": base64.urlsafe_b64encode(private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)).decode().rstrip("="),
        }

        def sign(kind: str, digest: str) -> str:
            return base64.urlsafe_b64encode(private_key.sign(validator.signature_payload(kind, digest))).decode().rstrip("=")

        def approve(path: Path, status_key: str, time_key: str, kind: str) -> None:
            document = json.loads(path.read_text(encoding="utf-8"))
            document[status_key] = "approved"
            document["approval"] = {
                "decision": "approved", "reviewer": "aggregate-independent-agent", time_key: "2026-09-14T16:10:00Z",
                "signature": {"algorithm": "ed25519", "keyId": authority["keyId"], "payloadDigest": None, "value": None},
            }
            digest = validator.approval_payload_digest(document)
            document["approval"]["signature"].update({"payloadDigest": digest, "value": sign(kind, digest)})
            self.write_json(path, document)

        evaluator = root / "docs/acceptance/v1.1/evaluator"
        approve(evaluator / "provenance/evaluator-selected-allowlist.json", "approvalStatus", "approvedAt", "evaluator-selected-allowlist/v1")
        approve(evaluator / "provenance/interpretation-review.json", "reviewStatus", "reviewedAt", "interpretation-review/v1")
        manifest_path = evaluator / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        signed_at = "2026-09-14T16:10:00Z"
        manifest.update({
            "signatureAuthority": authority,
            "signature": {"algorithm": "ed25519", "authority": authority["authority"], "decision": "approved", "keyId": authority["keyId"],
                          "payloadDigest": None, "provider": authority["provider"], "signedAt": signed_at,
                          "signer": "aggregate-independent-agent", "state": "signed", "value": None},
            "attestationState": validator.SIGNED_ATTESTATION_STATE,
            "reviewState": validator.SIGNED_REVIEW_STATE,
            "frozenAt": signed_at,
            "reviewLineage": {
                "status": "approved-independent-review", "claimsNotMade": validator.SIGNED_CLAIMS_NOT_MADE,
                "approval": {"authority": authority["authority"], "provider": authority["provider"],
                             "reviewer": "aggregate-independent-agent", "reviewedAt": signed_at,
                             "decision": "approved", "reviewStatus": "approved"},
            },
        })
        manifest["blocked"] = [entry for entry in manifest.get("blocked", []) if entry.get("reason") not in validator.SIGNED_RESOLVED_BLOCKERS]
        actual = {path.relative_to(evaluator).as_posix(): validator.sha(path) for path in validator.corpus_files(evaluator)}
        manifest["artifacts"] = [{"path": path, "sha256": digest} for path, digest in sorted(actual.items())]
        manifest["corpusDigest"] = validator.corpus_digest(evaluator)
        manifest["preSignatureManifestDigest"]["storedValue"] = None
        digest = validator.canonical_manifest_digest(manifest)
        manifest["preSignatureManifestDigest"]["storedValue"] = digest
        manifest["signature"].update({"payloadDigest": digest, "value": sign("evaluator-manifest/v1", digest)})
        self.write_json(manifest_path, manifest)
        return validator, private_key, manifest

    def resign_manifest(self, root: Path, validator: object, private_key: object) -> None:
        evaluator = root / "docs/acceptance/v1.1/evaluator"
        manifest_path = evaluator / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["preSignatureManifestDigest"]["storedValue"] = None
        digest = validator.canonical_manifest_digest(manifest)
        manifest["preSignatureManifestDigest"]["storedValue"] = digest
        manifest["signature"]["payloadDigest"] = digest
        manifest["signature"]["value"] = base64.urlsafe_b64encode(
            private_key.sign(validator.signature_payload("evaluator-manifest/v1", digest))
        ).decode().rstrip("=")
        self.write_json(manifest_path, manifest)

    def test_denominator_byte_drift_at_unchanged_count_is_failed(self) -> None:
        temporary, root = self.copied_denominators()
        self.addCleanup(temporary.cleanup)
        path = root / "docs/acceptance/v1.1/denominators/a-total.json"
        document = json.loads(path.read_text(encoding="utf-8"))
        document["members"][0]["title"] += " byte drift"
        self.assertEqual(document["total"], len(document["members"]))
        path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        result = checker.check_denominators(root)
        self.assertEqual("failed", result.state)
        self.assertIn("checksum mismatch", result.detail)

    def test_resolved_c17_inventory_state_is_checked(self) -> None:
        temporary, root = self.copied_inventory()
        self.addCleanup(temporary.cleanup)
        inventory_path = root / "docs/acceptance/v1.1/inventory/inventory.json"
        manifest_path = root / "docs/acceptance/v1.1/inventory/manifest.json"
        inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
        original = inventory["formerlyRemovedWholeCoreDenialList"]
        addendum_path = root / checker.AUTHORITATIVE_DENIAL_LIST_ADDENDUM
        addendum_path.parent.mkdir(parents=True)
        identifiers = [f"SF-TEST-{number:02d}" for number in range(1, 8)]
        self.write_json(addendum_path, {
            "format": checker.DENIAL_LIST_FORMAT,
            "sourceLabel": "authoritative-addendum",
            "identifiers": identifiers,
        })
        inventory["formerlyRemovedWholeCoreDenialList"] = {
            "declaredCount": 7,
            "identifiers": identifiers,
            "enumerationAvailable": True,
            "enumerationContract": original["enumerationContract"],
            "source": {
                "line": 1,
                "path": checker.AUTHORITATIVE_DENIAL_LIST_ADDENDUM,
                "rule": "authoritative formerly removed whole-Core ID addendum",
                "sha256": checker.sha256(addendum_path),
            },
            "scopeReviewDeclaration": original["source"],
        }
        self.write_json(inventory_path, inventory)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["inventory"]["sha256"] = checker.sha256(inventory_path)
        manifest["denialListEnumerationAvailable"] = True
        self.write_json(manifest_path, manifest)
        result = checker.check_inventory_counts(root)
        self.assertEqual("checked", result.state, result.detail)
        self.assertFalse(checker.unresolved_denial_provenance(root))

    def test_malformed_resolved_c17_inventory_states_fail(self) -> None:
        for mutation in (
            lambda claim: claim["identifiers"].__setitem__(1, claim["identifiers"][0]),
            lambda claim: claim["source"].__setitem__("path", checker.AUTHORITATIVE_DENIAL_LIST_ADDENDUM + ".bak"),
            lambda claim: claim.__setitem__("blocker", {"code": "denial-list-unenumerated"}),
        ):
            with self.subTest(mutation=mutation):
                temporary, root = self.copied_inventory()
                self.addCleanup(temporary.cleanup)
                inventory_path = root / "docs/acceptance/v1.1/inventory/inventory.json"
                manifest_path = root / "docs/acceptance/v1.1/inventory/manifest.json"
                inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
                original = inventory["formerlyRemovedWholeCoreDenialList"]
                addendum_path = root / checker.AUTHORITATIVE_DENIAL_LIST_ADDENDUM
                addendum_path.parent.mkdir(parents=True)
                identifiers = [f"SF-TEST-{number:02d}" for number in range(1, 8)]
                self.write_json(addendum_path, {
                    "format": checker.DENIAL_LIST_FORMAT,
                    "sourceLabel": "authoritative-addendum",
                    "identifiers": identifiers,
                })
                claim = {
                    "declaredCount": 7, "identifiers": identifiers, "enumerationAvailable": True,
                    "enumerationContract": original["enumerationContract"],
                    "source": {"line": 1, "path": checker.AUTHORITATIVE_DENIAL_LIST_ADDENDUM,
                               "rule": "authoritative formerly removed whole-Core ID addendum", "sha256": checker.sha256(addendum_path)},
                    "scopeReviewDeclaration": original["source"],
                }
                mutation(claim)
                inventory["formerlyRemovedWholeCoreDenialList"] = claim
                self.write_json(inventory_path, inventory)
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                manifest["inventory"]["sha256"] = checker.sha256(inventory_path)
                manifest["denialListEnumerationAvailable"] = True
                self.write_json(manifest_path, manifest)
                self.assertEqual("failed", checker.check_inventory_counts(root).state)

    def test_freeze_scope_allows_only_the_exact_c17_addendum_source_path(self) -> None:
        self.assertTrue(checker.allowed_m0_path(checker.AUTHORITATIVE_DENIAL_LIST_ADDENDUM))
        self.assertFalse(checker.allowed_m0_path(checker.AUTHORITATIVE_DENIAL_LIST_ADDENDUM + ".bak"))
        self.assertFalse(checker.allowed_m0_path(
            "docs/source-handoff/smart-form-builder-lite-prd-v1.1/nearby-source.json"
        ))

    def test_malformed_denominator_closure_is_failed(self) -> None:
        temporary, root = self.copied_denominators()
        self.addCleanup(temporary.cleanup)
        path, index = self.denominator_index(root)
        closure = index["closure"]
        assert isinstance(closure, dict)
        closure["memberPaths"].append("a-total.json")
        path.write_text(json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        result = checker.check_denominators(root)
        self.assertEqual("failed", result.state)
        self.assertIn("member set is malformed", result.detail)

    def test_denominator_symlink_is_failed_even_when_its_target_is_valid(self) -> None:
        temporary, root = self.copied_denominators()
        self.addCleanup(temporary.cleanup)
        directory = root / "docs/acceptance/v1.1/denominators"
        target = root / "outside.json"
        shutil.copyfile(directory / "a-total.json", target)
        (directory / "a-total.json").unlink()
        os.symlink(target, directory / "a-total.json")
        result = checker.check_denominators(root)
        self.assertEqual("failed", result.state)
        self.assertIn("forbids symlinks", result.detail)

    def test_finalized_denominator_attestation_is_checked(self) -> None:
        index = json.loads((self.root / "docs/acceptance/v1.1/denominators/manifest-index.json").read_text(encoding="utf-8"))
        state, detail = checker.denominator_technical_review(self.root, index)
        self.assertEqual("checked", state)
        self.assertIn("attested and content-bound", detail)

    def test_advisory_and_rejected_attestations_remain_pending(self) -> None:
        for authority, record_status, decision in (
            ("advisory-non-human", "advisory", "advisory"),
            ("independent-agent-review", "attested", "rejected"),
        ):
            with self.subTest(decision=decision), tempfile.TemporaryDirectory() as name:
                index = {"version": "2.0.0-m0", "independentReviewAttestation": {
                    "status": "approved", "path": "review-attestation.json", "sha256": "", "authority": authority,
                    "reviewer": "reviewer", "attestedAt": "2026-09-14T00:00:00Z", "decision": decision,
                    "preAttestationBinding": {}, "note": "not releaseable",
                }}
                root = Path(name)
                artifact = root / "review-attestation.json"
                artifact.write_text(json.dumps({
                    "authority": authority, "status": record_status, "decision": decision,
                    "reviewer": "reviewer", "attestedAt": "2026-09-14T00:00:00Z", "preAttestationBinding": {},
                }) + "\n", encoding="utf-8")
                index["independentReviewAttestation"]["sha256"] = checker.sha256(artifact)
                with mock.patch.object(checker, "denominator_build_function", return_value=mock.Mock()), \
                        mock.patch.object(checker, "reconstruct_pre_attestation_binding", return_value={}), \
                        mock.patch.object(checker, "validate_denominator_attestation", return_value=(True, "valid")), \
                        mock.patch.object(checker, "classify_denominator_review", return_value="unreviewed-not-released"):
                    state, detail = checker.denominator_technical_review(root, index)
                self.assertEqual("pending", state)
                self.assertIn("advisory or rejected", detail)

    def test_stale_attestation_binding_is_failed(self) -> None:
        index = {"version": "2.0.0-m0", "independentReviewAttestation": {
            "status": "approved", "path": "review-attestation.json", "sha256": "", "authority": "independent-agent-review",
            "reviewer": "reviewer", "attestedAt": "2026-09-14T00:00:00Z", "decision": "approved",
            "preAttestationBinding": {}, "note": "bound",
        }}
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            artifact = root / "review-attestation.json"
            artifact.write_text("{}\n", encoding="utf-8")
            index["independentReviewAttestation"]["sha256"] = checker.sha256(artifact)
            with mock.patch.object(checker, "denominator_build_function", return_value=mock.Mock()), \
                    mock.patch.object(checker, "reconstruct_pre_attestation_binding", return_value={}), \
                    mock.patch.object(checker, "validate_denominator_attestation", return_value=(False, "attestation pre-attestation binding does not match reconstructed bytes")):
                state, detail = checker.denominator_technical_review(root, index)
        self.assertEqual("failed", state)
        self.assertIn("binding", detail)

    def test_finalized_denominator_directory_validates_end_to_end(self) -> None:
        """Generate a real approved release and validate it without mocked bytes."""
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            denominator_directory = root / "docs/acceptance/v1.1/denominators"
            (root / "docs/acceptance/v1.1").mkdir(parents=True)
            shutil.copytree(self.root / "docs/source-handoff", root / "docs/source-handoff")
            shutil.copytree(self.root / "docs/acceptance/v1.1/denominators", denominator_directory)
            (root / "tools/acceptance").mkdir(parents=True)
            shutil.copyfile(self.root / "tools/acceptance/denominator_review.py",
                            root / "tools/acceptance/denominator_review.py")

            build = checker.denominator_build_function(root)
            binding = checker.reconstruct_pre_attestation_binding(
                denominator_directory, lambda target: build(target, pending=True)
            )
            attestation = {
                "schemaVersion": "1.0.0",
                "attestationType": "denominator-technical-review",
                "authority": "independent-agent-review",
                "status": "attested",
                "decision": "approved",
                "reviewer": "independent-agent-reviewer",
                "attestedAt": "2026-09-14T13:00:00Z",
                "manifestVersion": "2.0.0-m0",
                "scope": "denominator-technical-review",
                "preAttestationBinding": binding,
            }
            (denominator_directory / "review-attestation.json").write_text(
                json.dumps(attestation, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
            build(denominator_directory)

            index = json.loads((denominator_directory / "manifest-index.json").read_text(encoding="utf-8"))
            self.assertEqual("approved", index["independentReviewAttestation"]["status"])
            self.assertEqual("attested", attestation["status"])
            self.assertEqual("approved", attestation["decision"])
            self.assertEqual("checked", checker.check_denominators(root).state)
            reloaded_build = checker.denominator_build_function(root)
            self.assertEqual(binding, checker.reconstruct_pre_attestation_binding(
                denominator_directory, lambda target: reloaded_build(target, pending=True)
            ))
            state, detail = checker.denominator_technical_review(root, index)
            self.assertEqual("checked", state, detail)
            self.assertIn("independent-agent", detail)

    def test_fully_signed_v22_evaluator_freeze_is_checked(self) -> None:
        temporary, root = self.copied_evaluator_repository()
        self.addCleanup(temporary.cleanup)
        validator, _, _ = self.make_signed_evaluator(root)
        signing_errors = [error for error in validator.validate(root / "docs/acceptance/v1.1/evaluator", require_denial_list=False)
                          if error[0] in {"C28", "C29", "C31", "C34"}]
        self.assertEqual([], signing_errors)
        result = checker.check_freeze_attestations(root)
        self.assertEqual("checked", result.state, result.detail)
        self.assertIn("Ed25519 signed", result.detail)

    def test_unsigned_v22_evaluator_remains_pending_without_acceptance(self) -> None:
        # The live evaluator closure is independently regenerated; assert this
        # aggregate's pending-state handling without coupling the focused gate
        # test to unrelated in-flight corpus artifact bytes.
        with mock.patch.object(checker, "evaluator_v22_release_state", return_value=("pending", "unsigned pending")):
            result = checker.check_freeze_attestations(self.root)
        self.assertEqual("pending", result.state, result.detail)
        self.assertIn("pending", result.detail)

    def test_evaluator_semver_prerelease_is_accepted_and_malformed_versions_fail(self) -> None:
        for version in ("2.4.0-m0", "2.4.2-m0", "2.4.3-m0", "2.4.4-m0", "2.4.2-m0.1", "2.4.2+build.7"):
            with self.subTest(version=version):
                self.assertTrue(checker.evaluator_version_at_least(version, (2, 2)))
        for version in ("2.4", "2.04.2", "2.4.2-", "2.4.2-m0..1", "v2.4.2", "2.4.2 m0"):
            with self.subTest(version=version):
                self.assertFalse(checker.evaluator_version_at_least(version, (2, 2)))

    def test_suffixed_v24_pending_and_signed_freeze_states_use_v22_contract(self) -> None:
        temporary, root = self.copied_evaluator_repository()
        self.addCleanup(temporary.cleanup)
        manifest_path = root / "docs/acceptance/v1.1/evaluator/manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["corpusVersion"] = "2.4.2-m0"
        self.write_json(manifest_path, manifest)
        with mock.patch.object(checker, "evaluator_v22_release_state", return_value=("pending", "suffixed pending")) as state:
            result = checker.check_freeze_attestations(root)
        self.assertEqual("pending", result.state)
        state.assert_called_once()
        manifest["corpusVersion"] = "2.4.4-m0"
        self.write_json(manifest_path, manifest)
        with mock.patch.object(checker, "evaluator_v22_release_state", return_value=("checked", "suffixed signed")):
            result = checker.check_freeze_attestations(root)
        self.assertEqual("checked", result.state)

    def test_signed_v22_stale_state_and_signature_drift_are_failed(self) -> None:
        cases = {
            "attestation-state": lambda manifest: manifest.__setitem__("attestationState", "unsigned; stale"),
            "review-state": lambda manifest: manifest.__setitem__("reviewState", "unsigned-pending-independent-evaluator-freeze"),
            "frozen-at": lambda manifest: manifest.__setitem__("frozenAt", None),
            "lineage-status": lambda manifest: manifest["reviewLineage"].__setitem__("status", "pending-independent-review"),
            "lineage-claims": lambda manifest: manifest["reviewLineage"].__setitem__("claimsNotMade", ["no signature"]),
            "allowlist-blocker": lambda manifest: manifest["blocked"].append({"reason": "evaluator-selected-allowlist-pending-approval", "scope": "stale"}),
            "interpretation-blocker": lambda manifest: manifest["blocked"].append({"reason": "semantic-interpretation-review-pending", "scope": "stale"}),
            "denial-list-blocker": lambda manifest: manifest["blocked"].append({"reason": "denial-list-not-published", "scope": "stale"}),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                temporary, root = self.copied_evaluator_repository()
                self.addCleanup(temporary.cleanup)
                validator, private_key, _ = self.make_signed_evaluator(root)
                path = root / "docs/acceptance/v1.1/evaluator/manifest.json"
                manifest = json.loads(path.read_text(encoding="utf-8"))
                mutate(manifest)
                self.write_json(path, manifest)
                self.resign_manifest(root, validator, private_key)
                result = checker.check_freeze_attestations(root)
                self.assertEqual("failed", result.state, f"{name}: {result.detail}")
                self.assertIn("C34", result.detail)

        for name, mutate in {
            "signature-byte": lambda manifest: manifest["signature"].__setitem__("value", "A" * 86),
            "signature-provider": lambda manifest: manifest["signature"].__setitem__("provider", "other"),
            "signature-payload": lambda manifest: manifest["signature"].__setitem__("payloadDigest", "0" * 64),
        }.items():
            with self.subTest(name=name):
                temporary, root = self.copied_evaluator_repository()
                self.addCleanup(temporary.cleanup)
                self.make_signed_evaluator(root)
                path = root / "docs/acceptance/v1.1/evaluator/manifest.json"
                manifest = json.loads(path.read_text(encoding="utf-8"))
                mutate(manifest)
                self.write_json(path, manifest)
                result = checker.check_freeze_attestations(root)
                self.assertEqual("failed", result.state, f"{name}: {result.detail}")
                self.assertIn("C29", result.detail)

    def test_acceptance_prose_is_failed(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        manifest = root / "docs/acceptance/v1.1/evaluator/manifest.json"
        manifest.parent.mkdir(parents=True)
        data = json.loads((self.root / "docs/acceptance/v1.1/evaluator/manifest.json").read_text(encoding="utf-8"))
        data["status"]["productTestsExecuted"] = True
        manifest.write_text(json.dumps(data), encoding="utf-8")
        result = checker.check_no_pass_claims(root)
        self.assertEqual("failed", result.state)
        self.assertIn("conformance", result.detail)

    def test_external_baseline_symlink_is_failed_before_parsing(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            baselines = root / "docs/acceptance/v1.1/evidence/baselines"
            baselines.mkdir(parents=True)
            outside = root / "outside.json"
            outside.write_text("{}\n", encoding="utf-8")
            os.symlink(outside, baselines / "baseline.json")
            result = checker.check_baseline_evidence(root)
        self.assertEqual("failed", result.state)
        self.assertIn("containment", result.detail)

    def test_missing_baseline_evidence_is_pending_not_checked(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            result = checker.check_baseline_evidence(Path(name))
        self.assertEqual("pending", result.state)

    def test_schema_drift_is_failed(self) -> None:
        schema = json.loads((self.root / "docs/acceptance/v1.1/evidence/baseline-record.schema.json").read_text(encoding="utf-8"))
        attestation_schema = json.loads((self.root / "docs/acceptance/v1.1/evidence/baseline-attestation.schema.json").read_text(encoding="utf-8"))
        schema["properties"]["acceptanceBoundary"]["const"] = "positive acceptance prose"
        with mock.patch.object(checker, "load_json", side_effect=[schema, attestation_schema]):
            result = checker.check_evidence_schema(self.root)
        self.assertEqual("failed", result.state)
        self.assertIn("boundary", result.detail)

    def test_baseline_attestation_identity_schema_drift_is_failed(self) -> None:
        schema = json.loads((self.root / "docs/acceptance/v1.1/evidence/baseline-record.schema.json").read_text(encoding="utf-8"))
        attestation_schema = json.loads((self.root / "docs/acceptance/v1.1/evidence/baseline-attestation.schema.json").read_text(encoding="utf-8"))
        attestation_schema["properties"]["candidate"]["required"].remove("treeSha")
        with mock.patch.object(checker, "load_json", side_effect=[schema, attestation_schema]):
            result = checker.check_evidence_schema(self.root)
        self.assertEqual("failed", result.state)
        self.assertIn("candidate/reviewer", result.detail)

    def test_manifest_only_evaluator_signature_drift_is_failed(self) -> None:
        evaluator = json.loads((self.root / "docs/acceptance/v1.1/evaluator/manifest.json").read_text(encoding="utf-8"))
        evaluator["signature"]["algorithm"] = "none"
        with mock.patch.object(checker, "load_json", side_effect=[{}, evaluator]), \
                mock.patch.object(checker, "denominator_technical_review", return_value=("checked", "denominator reviewed")), \
                mock.patch.object(checker, "evaluator_v22_release_state", return_value=("failed", "evaluator signed-state contract: C29: invalid signature")):
            result = checker.check_freeze_attestations(self.root)
        self.assertEqual("failed", result.state)
        self.assertIn("C29", result.detail)

    def test_structured_denial_blocker_does_not_match_unrelated_text(self) -> None:
        self.assertTrue(checker.is_structured_denial_blocker("C17: blocked: denial-list-unenumerated"))
        self.assertFalse(checker.is_structured_denial_blocker("error: denial-list-unenumerated-but-not-a-blocker"))
        self.assertFalse(checker.is_structured_denial_blocker("denial list is unavailable"))

    def test_dirty_state_fails_unless_explicitly_allowed(self) -> None:
        with mock.patch.object(checker, "git_output", return_value=(0, "abc")), mock.patch.object(checker, "git_status", return_value=(0, " M product.txt\n")):
            failed = checker.check_worktree(self.root, allow_dirty=False)
            allowed = checker.check_worktree(self.root, allow_dirty=True)
        self.assertEqual("failed", failed.state)
        self.assertEqual("checked", allowed.state)

    def test_evaluator_test_timeout_exceeds_declared_deep_suite_budget(self) -> None:
        self.assertGreaterEqual(checker.EVALUATOR_TEST_TIMEOUT_SECONDS, 300)
        self.assertGreater(checker.EVALUATOR_TEST_TIMEOUT_SECONDS, checker.EVALUATOR_TEST_SUITE_BUDGET_SECONDS)
        self.assertEqual(120, checker.DEFAULT_COMMAND_TIMEOUT_SECONDS)
        with mock.patch.object(checker, "run_command", return_value=(0, "ok")) as run:
            result = checker.sibling_tool(
                self.root, "evaluator tool tests", ["python", "suite.py"],
                timeout_seconds=checker.EVALUATOR_TEST_TIMEOUT_SECONDS,
            )
        self.assertEqual("checked", result.state)
        run.assert_called_once_with(self.root, ["python", "suite.py"], checker.EVALUATOR_TEST_TIMEOUT_SECONDS)

    def test_blocked_exit_precedes_pending_exit(self) -> None:
        pending_and_blocked = [
            checker.Result("freeze", "pending", "independent review pending"),
            checker.Result("C17", "blocked", checker.PROVENANCE_BLOCKER),
        ]
        with mock.patch.object(checker, "run_all", return_value=pending_and_blocked), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(checker.BLOCKED_EXIT_CODE, checker.main(["--diagnostic"]))


if __name__ == "__main__":
    unittest.main()
