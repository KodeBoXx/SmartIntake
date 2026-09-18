# Smart Form Builder Lite v1.1 evaluator corpus

This tree is the independent evaluator expected-outcome corpus, semantic-major version **2.4.21-m0**. It derives only from the frozen authoritative PRD, evaluator protocol, contract details, authentication companion, and requirement register; it does not inspect or derive expected behavior from product output.

The release replaces the obsolete generated `fixtures/full-fixture-oracles.json` with four canonical, independently checked group artifacts: T01–T07 (23 cases), T08–T15 (33), T17–T24 (95), and T25–T32 (41). Their 31 fixture IDs, concrete pre-state/actions/exact expectations/evidence requirements, priority-asset bindings, O_total route checks, exact configured-email success/failure cases, and coverage references are release inputs. Fixture execution remains **not-run**.

Release 2.4.21-m0 pins the executable T22 browser probe (`assets/t22_browser_discovery_probe.py`, SHA-256 recorded in `manifest.json`, mode `0755`). Because `urllib` exposes parsed status and header fields, browser evidence retains and revalidates canonicalized parsed status/header fields plus original provider response body bytes; it does not claim capture of original HTTP status-line or header bytes. The probe registers a cleanup lease before stdout so parse or validation failure closes its provider session. It also requires provider-session-scoped AT identity, keeps one discovered session set across both respondent package series with outer-finally cleanup, and enforces 3,600-second release-authority freshness.

All evaluator artifacts, including group/asset/package/locale checkers and the deterministic O_named-bound T22 generator and adapter-required runner, are listed in `manifest.json`. The corpus digest is the SHA-256 of sorted `SHA256(file) + path` lines for every non-manifest evaluator artifact. The canonical pre-signature manifest digest is calculated by `tools/validate_corpus.py:canonical_manifest_digest`: canonical JSON (`sort_keys`, UTF-8, trailing LF) after normalizing `signature.value`, `signature.payloadDigest`, and `preSignatureManifestDigest.storedValue` to `null`.

Every record has an honest record-level `oracleProvenance` mode. Citations bind full source and exact line-range SHA-256 digests. The 277-key en/hi/ar locale closure has exact parity; Hindi and Arabic native-language review remains pending and makes no linguistic approval claim.

Run the read-only corpus checks:

```bash
python3 docs/acceptance/v1.1/evaluator/tools/validate_corpus.py --allow-blocked-denial-list
python3 docs/acceptance/v1.1/evaluator/tools/test_validate_corpus.py
```

Strict validation remains blocked by the authoritative seven-ID denial-list discrepancy. This release is unsigned and pending fresh independent review; it makes no product-conformance, fixture-execution, native-language approval, or M0-exit claim.
