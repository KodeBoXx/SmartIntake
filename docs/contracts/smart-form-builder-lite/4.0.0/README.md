# Smart Form Builder Lite canonical contract foundation — 4.0.0

This directory is the versioned, transport-level contract foundation. It is intentionally independent from the current controllers, persistence lifecycle, and UI.

## Package stamp

A publishable package has `contractVersion: "4.0.0"` and a `packageStamp`. `canonicalSha256` is `sha256:` plus the lowercase SHA-256 digest of the UTF-8 canonical JSON body after removing `packageStamp`. Canonical JSON recursively sorts object keys and preserves array order. This avoids a self-referential digest while making equivalent object-member orders hash identically.

`evaluatorContract` is pinned to `4.0.0`. `timeZoneDatabaseVersion` is optional in this foundation but should be present when date-time evaluation is enabled in a release.

## Typed values

Typed integers are JSON **strings** matching `^(0|-?[1-9][0-9]*)$` and are range checked as exact signed int64 values. JSON numeric integers, `-0`, leading zeros, plus signs, and exponent notation are rejected. Decimal values are strings with no exponent or plus sign; their canonical output removes trailing fractional zeroes and never has negative zero. Exact decimal results are restricted to 34 significant digits and adjusted exponent -6143 through 6144.

The JSON Schema describes wire shape. `ContractValue` supplies the stricter semantic range and decimal checks that JSON Schema cannot express portably.

## Evaluator boundary

`ExpressionEngine` accepts closed JSON ASTs and has no dynamic code, clock, network, or host-timezone access. It supports scalar literals, frozen `sessionDate` / `sessionTimeZone`, scalar operators, three-valued boolean logic, and a bounded evaluation budget. It is an intentionally isolated foundation, not a claim that the entire PRD evaluator (notably list/item scopes and aggregate operators) is production-integrated.

The test harness reads `docs/source-handoff/.../expression-contract.json`, executes applicable scalar/context vectors, and reports skipped vectors by ID. It must not be interpreted as full evaluator acceptance unless every source vector is executed and passing.
