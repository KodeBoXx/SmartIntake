# Sentinel rotation protocol

- Rounds `S-R1` (M0), `S-R2` (M3), `S-R3` (M8), and `S-R4` (M12) regenerate class-to-opaque `SLOT-<round>-<nn>` mappings. Each has at least scheduled sentinels plus one null slot.
- Implementers/runners receive slots and payload bundles only. Class-to-slot mappings and payloads remain in evaluator custody outside the repository. No committed sentinel artifact contains payload, diff, or defect location.
- Each commitment is `HMAC-SHA-256(round_secret, canonical_payload_bytes)`. The secret is never committed and is published only after results.
- Order: seal commitments; blinded runner execution; record status; publish secret and mapping; independent reviewer verifies commitments and semantic detection.
- A class never uses the same slot index in consecutive rounds. Disclosed payloads retire. A sentinel change increments corpus version and invalidates mapped results.
