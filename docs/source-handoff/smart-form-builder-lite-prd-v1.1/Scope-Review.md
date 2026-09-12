# Lite 1.1 scope and consistency review

All 80 Lite 1.0 requirements remain; 15 explicit foundation requirements were added, for 95 total. Of the original requirement-table rows, 79 remain verbatim and 1 were rewritten. Surrounding behavior text also changes where necessary; an unchanged row is not a claim that its entire section is byte-identical. No retained feature was removed. All seven formerly removed whole Core requirement IDs remain absent and are not reused.

The current specification lists 31 acceptance fixtures: T01–T32 with T16 intentionally absent. Added T27–T32 cover staff login, onboarding/administration, credential recovery, staff UI, exact interpretation/numbers and local deployment. Original form capabilities, review/versioning, repeats, attachments, language/voice, simple response read/export and retained outbound integrations remain mandatory.

The scope scan distinguished exclusions from positive obligations. Staff invitations are permitted, respondent invitation channels are excluded. Authentication secrets have narrow initial delivery exceptions, not machine API credentials. Form-draft/release history is retained, response-processing revisions are excluded. Development fixtures are required, saved-scenario product management is excluded. Session mutation replay protects draft edits, repeat response submissions remain allowed. Operational service/provider metrics remain, completion/error analytics dashboards are excluded.

The standalone PRD consolidates all normative details in appendices. Separate Markdown/JSON specification files in this directory are matching convenience extracts; the PRD is the single entry point. Review reports and asset manifests are supporting evidence. The document was checked for requirement coverage, fixture references, JSON parsing, local links, legacy version leakage, selected removed-feature identifiers, expression-vector identity and original-file preservation. These checks do not prove exhaustive formal consistency or product implementation.

There are 101 expression vectors and 34 operators. Existing integer values are encoded as strings, EXPR-073 accepts the expanded domain, five runtime-zero cases use field operands to preserve their runtime/lazy intent, and ten new boundary/today/compile cases are included. Product evaluator execution remains not run.

56 original/source files are verified unchanged by hash. No application source or Software Factory record was changed.
