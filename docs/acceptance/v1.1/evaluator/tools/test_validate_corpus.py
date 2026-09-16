import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("validator", HERE / "validate_corpus.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
SOURCE_REPO = validator.REPO
sys.path.insert(0, str(SOURCE_REPO))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, separators=(",", ": ")) + "\n")


class CorpusV20Validation(unittest.TestCase):
    def copy(self):
        temp = tempfile.TemporaryDirectory()
        repo = Path(temp.name) / "repo"
        shutil.copytree(SOURCE_REPO / "docs", repo / "docs")
        copied = repo / "docs/acceptance/v1.1/evaluator"
        self.refresh_unsigned_closure(copied)
        return temp, copied

    @staticmethod
    def refresh_unsigned_closure(root):
        """Keep test copies self-contained while release closure stays deferred."""
        manifest_path = root / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        actual = {path.relative_to(root).as_posix(): validator.sha(path) for path in validator.corpus_files(root)}
        manifest["artifacts"] = [{"path": path, "sha256": digest} for path, digest in sorted(actual.items())]
        manifest["corpusDigest"] = validator.corpus_digest(root)
        manifest["preSignatureManifestDigest"]["storedValue"] = None
        manifest["preSignatureManifestDigest"]["storedValue"] = validator.canonical_manifest_digest(manifest)
        write_json(manifest_path, manifest)

    def errors(self, root, deep_assets=False):
        """Mutation isolation may skip only costly deterministic T22 materialization."""
        return {
            key for key, _ in validator.validate(
                root, False, test_structural_assets=not deep_assets
            )
        }

    def test_clean_waived_passes_and_is_read_only(self):
        temp, root = self.copy()
        self.addCleanup(temp.cleanup)
        before = {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()}
        self.assertEqual([], validator.validate(root, False, test_structural_assets=True))
        self.assertEqual(before, {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()})

    def test_priority_asset_and_fixture_package_checkers_pass(self):
        for checker in (
            HERE.parent / "assets/priority_asset_selfcheck.py",
            HERE.parent / "fixtures/check_t01_t07.py",
            HERE.parent / "fixtures/check_t08_t15.py",
            HERE.parent / "fixtures/check_t17_t24.py",
            HERE.parent / "fixtures/check_t25_t32.py",
            HERE.parent / "fixtures/check_full_fixture_oracles.py",
            HERE.parent / "locales/check_locale_closure.py",
        ):
            with self.subTest(checker=checker.name):
                result = subprocess.run([sys.executable, str(checker)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_core_hygiene_and_oracle_mutations(self):
        mutations = {
            "C01": ("README.md", lambda x: "bad\r\n"),
            "C04": ("navigation/navigation-oracle.json", lambda x: self.mutate_quote(x)),
            "C11": ("packages/package-hc.json", lambda x: self.mutate_key(x, "catalogCoverage", [])),
            "C12": ("oracles/respondent-oracle.json", lambda x: self.mutate_record(x, "EVAL-RESP-O14", "quantity", "9")),
            "C16": ("sentinels/commitments.json", lambda x: self.mutate_key(x["rounds"][0], "slotCount", 2)),
            "C25": ("oracles/foundation-acceptance.json", lambda x: self.mutate_key(x["records"][0], "scalarProvenance", {"/anything": {}})),
        }
        for check, (name, mutate) in mutations.items():
            with self.subTest(check=check):
                temp, root = self.copy()
                self.addCleanup(temp.cleanup)
                path = root / name
                if check == "C01":
                    path.write_text(mutate(None))
                else:
                    data = json.loads(path.read_text())
                    mutate(data)
                    write_json(path, data)
                self.assertIn(check, self.errors(root))

    def test_required_v16_mutations(self):
        cases = {
            "source-swap": self.source_swap,
            "partial-source-overlap": self.partial_overlap,
            "unknown-rule": self.unknown_rule,
            "arbitrary-value-generic-derivation": self.generic_derivation,
            "ledger-only-coverage": self.ledger_only,
            "invalid-signature-claim": self.invalid_signature,
        }
        expected = {
            "source-swap": "C32",
            "partial-source-overlap": "C32",
            "unknown-rule": "C31",
            "arbitrary-value-generic-derivation": "C25",
            "ledger-only-coverage": "C23",
            "invalid-signature-claim": "C29",
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                temp, root = self.copy()
                self.addCleanup(temp.cleanup)
                mutate(root)
                self.assertIn(expected[name], self.errors(root))

    def test_full_fixture_assets_locale_and_package_mutations(self):
        cases = {
            "group-case-set": ("fixtures/t01-t07.json", lambda d: d["fixtures"][0]["cases"].pop(), "C33"),
            "coverage-group-id": ("coverage/fixture-coverage.json", lambda d: d["records"][0]["expected"].__setitem__("canonicalGroupArtifactId", "EVAL-GROUP-WRONG"), "C23"),
            "locale-native-value": ("locales/key-inventory.json", lambda d: d["localePacks"]["hi"]["messageValues"].__setitem__("form.title", None), "C14"),
            "package-observed-claim": ("packages/package-hc.json", lambda d: d.__setitem__("parityActual", {}), "C11"),
            "t19-events": ("assets/t19-webhooks.json", lambda d: d["frozenInputProtocol"]["eventEnvelopes"].pop(), "C33"),
            "t22-workload": ("assets/t22-scale-limits.json", lambda d: d["frozenInputProtocol"]["commands"].pop(), "C33"),
            "t25-participant": ("assets/t25-usability-protocol.json", lambda d: d["frozenInputProtocol"]["participants"].pop(), "C33"),
        }
        for name, (relative, mutate, check) in cases.items():
            with self.subTest(name=name):
                temp, root = self.copy()
                self.addCleanup(temp.cleanup)
                path = root / relative
                data = json.loads(path.read_text())
                mutate(data)
                write_json(path, data)
                self.assertIn(check, self.errors(root, deep_assets=name in {"t19-events", "t22-workload", "t25-participant"}))

    def test_manifest_only_and_source_drift_change_bound_digest_or_fail_pins(self):
        temp, root = self.copy()
        self.addCleanup(temp.cleanup)
        manifest = json.loads((root / "manifest.json").read_text())
        baseline = validator.canonical_manifest_digest(manifest)
        manifest["blocked"].append({"reason": "manifest-only-drift", "scope": "test"})
        self.assertNotEqual(baseline, validator.canonical_manifest_digest(manifest))
        # PRD/PROTO source pin drifts are checked against the immutable authoritative source set.
        manifest["sources"][0]["sha256"] = "0" * 64
        manifest["sources"][1]["sha256"] = "1" * 64
        write_json(root / "manifest.json", manifest)
        self.assertIn("C22", self.errors(root))

    def test_denominator_byte_drift_breaks_transitive_closure(self):
        # The closure validator receives a copied authority tree, so no shared denominator byte is edited.
        temp, root = self.copy()
        self.addCleanup(temp.cleanup)
        repo_temp = Path(temp.name) / "repo"
        old_repo = validator.REPO
        validator.REPO = repo_temp
        self.addCleanup(lambda old_repo=old_repo: setattr(validator, "REPO", old_repo))
        target = repo_temp / "docs/acceptance/v1.1/denominators/a-total.json"
        target.write_bytes(target.read_bytes() + b" ")
        self.assertIn("C28", self.errors(root))

    def test_c28_allows_signed_evaluator_after_shared_attested_approval(self):
        temp, root, repo_temp, manifest, index, record = self.attested_denominator()
        self.addCleanup(temp.cleanup)
        old_repo = validator.REPO
        validator.REPO = repo_temp
        self.addCleanup(lambda old_repo=old_repo: setattr(validator, "REPO", old_repo))
        errors = []
        validator.check_denominator_closure(manifest, errors)
        self.assertNotIn("C28", {key for key, _ in errors})
        self.assertEqual("attested", record["status"])
        self.assertEqual("approved", record["decision"])
        self.assertEqual("approved", index["independentReviewAttestation"]["status"])

    def test_c28_rejects_malformed_stale_and_advisory_attestations_for_signing(self):
        for kind in ("malformed", "stale", "advisory"):
            with self.subTest(kind=kind):
                temp, root, repo_temp, manifest, index, record = self.attested_denominator()
                self.addCleanup(temp.cleanup)
                old_repo = validator.REPO
                validator.REPO = repo_temp
                self.addCleanup(lambda old_repo=old_repo: setattr(validator, "REPO", old_repo))
                pointer = index["independentReviewAttestation"]
                if kind == "malformed":
                    record["status"] = "approved"  # shared record status must be attested
                    self.write_attestation(repo_temp, index, record)
                elif kind == "stale":
                    record["preAttestationBinding"]["manifestIndexSha256"] = "0" * 64
                    pointer["preAttestationBinding"] = record["preAttestationBinding"]
                    self.write_attestation(repo_temp, index, record)
                else:
                    record["authority"] = "advisory-non-human"
                    record["status"] = "advisory"
                    record["decision"] = "advisory"
                    self.write_attestation(repo_temp, index, record)
                write_json(repo_temp / "docs/acceptance/v1.1/denominators/manifest-index.json", index)
                manifest["crossScopeRefs"]["denominatorClosure"]["manifestIndexSha256"] = validator.sha(repo_temp / "docs/acceptance/v1.1/denominators/manifest-index.json")
                errors = []
                validator.check_denominator_closure(manifest, errors)
                self.assertIn("C28", {key for key, _ in errors})

    def test_signed_corpus_schema_path_and_mutations(self):
        temp, root = self.copy()
        self.addCleanup(temp.cleanup)
        self.make_signed(root)
        self.assertEqual([], validator.validate(root, False, test_structural_assets=True))
        mutations = {
            "stale": ("provenance/interpretation-review.json", lambda d: d.__setitem__("reviewedAt", "not-utc"), "C31"),
            "advisory": ("provenance/evaluator-selected-allowlist.json", lambda d: d["approval"].__setitem__("decision", "advisory"), "C31"),
            "wrong-digest": ("manifest.json", lambda d: d.__setitem__("corpusDigest", "0" * 64), "C18"),
            "manifest-policy": ("manifest.json", lambda d: d["signature"].__setitem__("provider", "other"), "C29"),
            "wrong-key": ("manifest.json", lambda d: d["signatureAuthority"].__setitem__("publicKey", "A" * 43), "C29"),
            "wrong-byte": ("manifest.json", lambda d: d["blocked"].append({"reason": "changed", "scope": "test"}), "C29"),
            "stale-signature-digest": ("manifest.json", lambda d: d["signature"].__setitem__("payloadDigest", "0" * 64), "C29"),
            "altered-signature": ("manifest.json", lambda d: d["signature"].__setitem__("value", "A" * 86), "C29"),
            "stale-attestation-state": ("manifest.json", lambda d: d.__setitem__("attestationState", "unsigned; stale"), "C34"),
            "stale-review-state": ("manifest.json", lambda d: d.__setitem__("reviewState", "unsigned-pending-independent-evaluator-freeze"), "C34"),
            "stale-frozen-at": ("manifest.json", lambda d: d.__setitem__("frozenAt", None), "C34"),
            "stale-review-lineage": ("manifest.json", lambda d: d["reviewLineage"].__setitem__("status", "pending-independent-review"), "C34"),
            "stale-review-entry": ("manifest.json", lambda d: d["reviewLineage"].__setitem__("entries", [{"status": "pending"}]), "C34"),
            "stale-lineage-claim": ("manifest.json", lambda d: d["reviewLineage"].__setitem__("claimsNotMade", ["no signature"]), "C34"),
            "stale-allowlist-blocker": ("manifest.json", lambda d: d["blocked"].append({"reason": "evaluator-selected-allowlist-pending-approval", "scope": "stale"}), "C34"),
            "stale-interpretation-blocker": ("manifest.json", lambda d: d["blocked"].append({"reason": "semantic-interpretation-review-pending", "scope": "stale"}), "C34"),
            "stale-denial-list-blocker": ("manifest.json", lambda d: d["blocked"].append({"reason": "denial-list-not-published", "scope": "stale"}), "C34"),
            "stale-allowlist-approval": ("provenance/evaluator-selected-allowlist.json", lambda d: (d.__setitem__("approvalStatus", "pending-independent-review"), d.pop("approval")), "C31"),
            "stale-interpretation-approval": ("provenance/interpretation-review.json", lambda d: (d.__setitem__("reviewStatus", "pending-independent-review"), d.pop("approval")), "C31"),
        }
        for name, (relative, mutate, check) in mutations.items():
            with self.subTest(name=name):
                child, copied = self.copy()
                self.addCleanup(child.cleanup)
                self.make_signed(copied)
                path = copied / relative
                data = json.loads(path.read_text())
                mutate(data)
                write_json(path, data)
                self.assertIn(check, self.errors(copied))

    def test_real_ed25519_manifest_signature_rejects_wrong_key_bytes_and_signature(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        import base64
        private = Ed25519PrivateKey.generate()
        public = base64.urlsafe_b64encode(private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)).decode().rstrip("=")
        authority = {"authority": "independent-agent-review", "provider": "codex-gpt", "keyId": "evaluator-test-ed25519-v1", "publicKey": public}
        digest = "a" * 64
        signature = {
            "algorithm": "ed25519", "keyId": authority["keyId"], "payloadDigest": digest,
            "value": base64.urlsafe_b64encode(private.sign(validator.signature_payload("evaluator-manifest/v1", digest))).decode().rstrip("="),
        }
        self.assertTrue(validator.signature_valid(signature, authority, "evaluator-manifest/v1", digest))
        self.assertFalse(validator.signature_valid(signature, {**authority, "publicKey": "A" * 43}, "evaluator-manifest/v1", digest))
        self.assertFalse(validator.signature_valid(signature, authority, "evaluator-manifest/v1", "b" * 64))
        self.assertFalse(validator.signature_valid({**signature, "value": "A" * 86}, authority, "evaluator-manifest/v1", digest))

    @staticmethod
    def make_signed(root):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        import base64
        private_key = Ed25519PrivateKey.generate()
        public_key = base64.urlsafe_b64encode(private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)).decode().rstrip("=")
        authority = {"authority": "independent-agent-review", "provider": "codex-gpt", "keyId": "evaluator-test-ed25519-v1", "publicKey": public_key}

        def sign(kind, digest):
            return base64.urlsafe_b64encode(private_key.sign(validator.signature_payload(kind, digest))).decode().rstrip("=")

        def approve(document, status_key, time_key, kind):
            document[status_key] = "approved"
            document["approval"] = {
                "decision": "approved", "reviewer": "test-independent-agent", time_key: "2026-09-14T13:30:00Z",
                "signature": {"algorithm": "ed25519", "keyId": authority["keyId"], "payloadDigest": None, "value": None},
            }
            digest = validator.approval_payload_digest(document)
            document["approval"]["signature"].update({"payloadDigest": digest, "value": sign(kind, digest)})

        allowlist_path = root / "provenance/evaluator-selected-allowlist.json"
        allowlist = json.loads(allowlist_path.read_text())
        approve(allowlist, "approvalStatus", "approvedAt", "evaluator-selected-allowlist/v1")
        write_json(allowlist_path, allowlist)
        review_path = root / "provenance/interpretation-review.json"
        review = json.loads(review_path.read_text())
        approve(review, "reviewStatus", "reviewedAt", "interpretation-review/v1")
        write_json(review_path, review)
        manifest_path = root / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["signatureAuthority"] = authority
        signed_at = "2026-09-14T13:30:00Z"
        manifest["signature"] = {"algorithm": "ed25519", "authority": authority["authority"], "decision": "approved", "keyId": authority["keyId"], "payloadDigest": None, "provider": authority["provider"], "signedAt": signed_at, "signer": "test-independent-agent", "state": "signed", "value": None}
        manifest["attestationState"] = validator.SIGNED_ATTESTATION_STATE
        manifest["reviewState"] = validator.SIGNED_REVIEW_STATE
        manifest["frozenAt"] = signed_at
        manifest["blocked"] = [
            entry for entry in manifest.get("blocked", [])
            if entry.get("reason") not in validator.SIGNED_RESOLVED_BLOCKERS
        ]
        manifest["reviewLineage"] = {
            "status": "approved-independent-review",
            "claimsNotMade": validator.SIGNED_CLAIMS_NOT_MADE,
            "approval": {"authority": "independent-agent-review", "provider": "codex-gpt", "reviewer": "test-independent-agent", "reviewedAt": signed_at, "decision": "approved", "reviewStatus": "approved"},
        }
        actual = {path.relative_to(root).as_posix(): validator.sha(path) for path in validator.corpus_files(root)}
        manifest["artifacts"] = [{"path": path, "sha256": digest} for path, digest in sorted(actual.items())]
        manifest["corpusDigest"] = validator.corpus_digest(root)
        manifest["preSignatureManifestDigest"]["storedValue"] = None
        digest = validator.canonical_manifest_digest(manifest)
        manifest["preSignatureManifestDigest"]["storedValue"] = digest
        manifest["signature"].update({"payloadDigest": digest, "value": sign("evaluator-manifest/v1", digest)})
        write_json(manifest_path, manifest)

    @staticmethod
    def mutate_key(value, key, replacement):
        value[key] = replacement
        return value

    @staticmethod
    def mutate_quote(value):
        value["records"][0]["prdCitations"][0]["quote"] = "not a source quote"
        return value

    @staticmethod
    def mutate_record(value, record_id, key, replacement):
        for record in validator.record_walk(value):
            if record["id"] == record_id:
                record["expected"][key] = replacement

    @staticmethod
    def source_swap(root):
        path = root / "assets/t08-validation-errors.json"
        data = json.loads(path.read_text())
        data["records"][0]["prdCitations"][0]["sourceSha256"] = "f" * 64
        write_json(path, data)

    @staticmethod
    def partial_overlap(root):
        path = root / "assets/t08-validation-errors.json"
        data = json.loads(path.read_text())
        data["records"][0]["prdCitations"][0]["lines"] = "582-583"
        write_json(path, data)

    @staticmethod
    def unknown_rule(root):
        path = root / "assets/t22-scale-limits.json"
        data = json.loads(path.read_text())
        data["records"][0]["oracleProvenance"]["ruleId"] = "unknown-rule/v1"
        write_json(path, data)

    @staticmethod
    def generic_derivation(root):
        path = root / "assets/t22-scale-limits.json"
        data = json.loads(path.read_text())
        data["records"][0]["scalarProvenance"] = {"/capPlusOne": {"derivation": "generic"}}
        write_json(path, data)

    @staticmethod
    def ledger_only(root):
        path = root / "coverage/fixture-coverage.json"
        data = json.loads(path.read_text())
        row = next(r for r in data["records"] if r["expected"]["fixture"] == "T08")
        row["expected"]["coveringRecordIds"] = ["EVAL-FIXCOV-T08"]
        write_json(path, data)

    @staticmethod
    def invalid_signature(root):
        path = root / "manifest.json"
        data = json.loads(path.read_text())
        data["signature"]["state"] = "signed"
        data["signature"]["value"] = "not-a-valid-signature"
        data["signature"]["signer"] = "fabricated"
        write_json(path, data)

    def attested_denominator(self):
        """Build a review-attested authority copy without changing shared files."""
        temp, root = self.copy()
        repo_temp = Path(temp.name) / "repo"
        manifest = json.loads((root / "manifest.json").read_text())
        manifest["signature"] = {"algorithm": "ed25519", "state": "signed", "value": "test-signature", "signer": "test-signer"}
        denominator = repo_temp / "docs/acceptance/v1.1/denominators"
        index_path = denominator / "manifest-index.json"
        index = json.loads(index_path.read_text())
        build = self.load_denominator_build(repo_temp)
        binding = validator.denominator_review.reconstruct_pre_attestation_binding(
            denominator, lambda output: build(output, pending=True)
        )
        record = {
            "schemaVersion": "1.0.0",
            "attestationType": "denominator-technical-review",
            "authority": "independent-agent-review",
            "status": "attested",
            "decision": "approved",
            "reviewer": "test-independent-agent",
            "attestedAt": "2026-09-14T12:00:00Z",
            "manifestVersion": index["version"],
            "scope": "denominator-technical-review",
            "preAttestationBinding": binding,
        }
        self.write_attestation(repo_temp, index, record)
        build(denominator)
        index = json.loads(index_path.read_text())
        manifest["crossScopeRefs"]["denominatorClosure"]["manifestIndexSha256"] = validator.sha(index_path)
        manifest["crossScopeRefs"]["denominatorClosure"]["sha256sumsSha256"] = validator.sha(denominator / "SHA256SUMS")
        manifest["crossScopeRefs"]["denominatorClosure"]["reviewAttestationSha256"] = validator.sha(denominator / "review-attestation.json")
        return temp, root, repo_temp, manifest, index, record

    @staticmethod
    def load_denominator_build(repo_temp):
        path = repo_temp / "docs/acceptance/v1.1/denominators/build_manifests.py"
        spec = importlib.util.spec_from_file_location("test_denominator_builder", path)
        module = importlib.util.module_from_spec(spec)
        write_bytecode = sys.dont_write_bytecode
        sys.path.insert(0, str(repo_temp))
        try:
            sys.dont_write_bytecode = True
            spec.loader.exec_module(module)
        finally:
            sys.dont_write_bytecode = write_bytecode
            sys.path.pop(0)
        return module.build

    @staticmethod
    def write_attestation(repo_temp, index, record):
        path = repo_temp / "docs/acceptance/v1.1/denominators/review-attestation.json"
        write_json(path, record)
        index["independentReviewAttestation"] = {
            "status": "approved" if record["decision"] == "approved" else "rejected" if record["decision"] == "rejected" else "advisory",
            "path": "docs/acceptance/v1.1/denominators/review-attestation.json",
            "sha256": validator.sha(path),
            "authority": record["authority"],
            "reviewer": record["reviewer"],
            "attestedAt": record["attestedAt"],
            "decision": record["decision"],
            "preAttestationBinding": record["preAttestationBinding"],
            "note": "Independent technical review attestation is content-bound.",
        }


if __name__ == "__main__":
    unittest.main()
