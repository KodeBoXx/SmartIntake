# Smart Form Builder Lite 1.1 — implementation handoff

Use [the single, self-contained PRD](../Smart-Form-Builder-Lite-PRD-v1.1.md). Its Appendices A–D include all the detailed requirements and the full expression JSON; no separate requirement files need to be combined. This is the new specification for the next implementation run. Preserve all retained C and E requirements and the stated Lite exclusions.

## Files to give the implementation tool

Use the whole `Smart-Form-Builder-Lite-PRD-v1.1-handoff.zip`, rather than the old Lite 1.0 or Core bundle. It contains:

1. The complete revised PRD, with 95 numbered requirements and 31 acceptance fixtures.
2. `Authentication-and-Administration.md` — staff accounts, first-admin setup, invitation/temporary-password onboarding, sessions, role boundaries, password lifecycle and APIs.
3. `Lite-Contract-Details.md` and `expression-contract.json` — proposed public profile 4.0.0, exact 64-bit integer strings, explicit evaluator stamping and 101 fixed expression vectors.
4. `Lite-Evaluator-Protocol.md` — retained complex form task and new foundation acceptance cases.
5. `Gap-Analysis.md`, `requirement-dispositions.csv`, `Scope-Review.md` and validation/source evidence — what changed, why and what was checked.
6. `certinal-ui-assets.zip` — a snapshot of the local approved Certinal UI skill's library, styles, references and font asset instructions. Extract it into an implementation dependency location; follow the supplied source/API, and preserve its notices. The manifest records the snapshot digest. Do not rely on an absolute path from this computer.

The single PRD is normative, including its appendices. The separate specification Markdown/JSON files are convenience extracts of those appendices. Gap/source/validation reports are evidence, not instructions to modify the old implementation. The UI archive supplies design assets; it does not add product features or override Lite scope. Local Claude session and implementation source are not needed as hidden inputs for the next agent.

## Interpretation choices already resolved

- Real staff sign-in and account lifecycle are mandatory. Public forms still need no respondent account.
- Both onboarding methods work without email. Email invitation/self-service recovery integration remains required for full completion.
- Platform administration and tenant administration are separate from workspace answer permissions. Multiple tenant memberships remain in scope.
- Repeat submissions, including identical ones, remain allowed. Only form-wide windows/caps restrict acceptance.
- The voice surface stays Play/Pause and Click to Ask. No answer dictation, typed question or response-processing workflow is reintroduced.
- The public wire/evaluator profile is 4.0.0. Existing internal Software Factory schema/contract version 1 is not interchangeable. Do not relabel an old package or silently replace the specified rule language.
- Angular 20/Tailwind 4/Certinal UI, Spring Boot, PostgreSQL and local Docker Compose are the agreed baseline. Pin actual dependency versions. Hosting elsewhere is later deployment work, not a hidden initial prerequisite.

## Completion boundaries

Start with the clean local identity path: bootstrap → choose password → create tenant/initial owner → owner activation → workspace/user roles → real staff screens. Build canonical parsing/evaluation before browser rule parity; deliver the full retained builder/respondent/voice/response/export features in the PRD sequence.

Full schemas/OpenAPI, complete example envelopes/packages, executable fixture runners and independent acceptance assertions remain required build/evaluation outputs. The included expression vectors are normative expectations, not a claim that a product evaluated them. Materialize and freeze the complete evaluator corpus before a measured comparison. Tests from a previous work order do not establish this PRD's completion.

Use the same input bundle and constraints for any tool comparison. The phonetic tool name “War Flux” does not imply an API, plugin, schema or proprietary integration; this is a portable Markdown/JSON/ZIP handoff.
