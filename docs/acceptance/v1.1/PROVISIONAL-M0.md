# Provisional M0 status and deferred evidence

M0 is preserved as **provisional and unaccepted**. On 2026-09-16 the product owner explicitly authorized later approved product milestones to proceed without weakening, waiving, or representing M0 as complete.

This sequencing decision does not grant acceptance credit, change the authoritative Smart Form Builder Lite PRD v1.1, restore intentionally excluded capabilities, or authorize M1 evidence to substitute for M0 evidence.

## Latest unsigned candidate

- Evaluator release: `2.4.21-m0`
- Artifact closure: 55 artifacts
- Interpretation bindings: 221
- Corpus SHA-256: `dcec91d8f8f6d05b4e948a842eb95974dceebdebec3162589bd3b538d529ba1a`
- Canonical pre-signature manifest SHA-256: `5a16106d7f74b12d4793b7da065fbd82e7e59ba510a63affb105c629916363f7`
- State: unsigned; evaluator allowlist approval, interpretation approval, and manifest signature absent
- Acceptance consequence: no M0 exit, product-conformance, human-review, native-language-review, provider, or measured-performance claim

## Deferred evidence and provenance

| Gap | Current evidence | Consequence |
|---|---|---|
| C17 historical seven-ID denial list | The authoritative PRD and scope review state that seven formerly removed whole-Core IDs remain absent, but no authoritative source enumerates them. IDs are not inferred. | Strict provenance remains blocked until a checksummed authoritative addendum or reviewed handoff correction enumerates all seven IDs. |
| Evaluator technical freeze | The latest integrated browser-evidence and gate-hardening changes passed reported focused checks, but the exact final bytes have not received a defect-free independent signing review. | The evaluator remains unsigned and cannot be used as frozen acceptance authority. |
| Browser/provider evidence | The latest repair retains original response-body bytes plus canonicalized parsed status/header fields, uses session-scoped AT acquisition and shared respondent sessions, and adds failure-safe cleanup and authority-age checks. The bounded deep run and independent post-repair signing review were not completed on the exact final bytes. | Browser/AT/performance evidence remains deferred. Product work must not claim those acceptance results. |
| Baseline evidence | Gate hardening requires an active retained clean-candidate record with exactly one matching attestation, candidate identity, and reviewer metadata. No retained baseline currently exists. | No unchanged/fair timed baseline is claimed. A final baseline must be captured only against a clean, stable candidate and rerun after relevant byte changes. |
| Final strict gate | Diagnostic and provisional flags remain non-acceptance controls. The final strict `check_m0.py --freeze-check` run has not passed on clean, signed, C17-resolved bytes. | M0 remains provisional even while later implementation proceeds. |

## Verified or reported checks

The latest work reports:

- evaluator mutation suite: 11/11 passed;
- M0 gate tests: 25/25 passed;
- baseline isolation tests: 16/16 passed;
- inventory verification and self-check passed;
- focused priority, fixture, structural, closure, and `git diff --check` checks passed.

These results are engineering evidence only. They do not resolve C17, create a retained baseline, or substitute for independent signatures and the strict clean-worktree gate.

## Sequencing guardrails

1. Continue with the next approved product milestone using additive, reversible changes.
2. Preserve V1–V4 and the frozen current route/UI/database inventory.
3. Do not weaken authorization, tenant isolation, data integrity, migration reconciliation, or product tests because acceptance evidence is deferred.
4. Record any M1 dependency that genuinely requires unresolved M0 authority instead of fabricating a value.
5. Do not sign the evaluator, claim M0 acceptance, or claim full product acceptance until every actual M0 gate is satisfied.
6. Do not start capabilities excluded by the authoritative PRD.
