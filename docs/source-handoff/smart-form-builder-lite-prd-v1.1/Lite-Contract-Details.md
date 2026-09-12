# Lite contract details

Binding detail for Lite PRD 1.1. This is specification prose, not an implemented schema or a product-test result. The original full-product contract files do not govern Lite.

## Version and normalization

The proposed Lite package/envelope/manifest/event and engine contract is 4.0.0. It deliberately changes the accepted capability and submission shapes. Historical packages require explicit validation/migration; they cannot silently activate omitted capabilities. Definition/theme/block versions remain independently authored.

The normalizer N accepts a structurally and semantically valid, resolved portable package. For every `repeatingCards` or `dynamicMatrix` node, it creates `presentation` and `presentation.settings` when absent and fills absent `allowAdd`, `allowRemove`, `allowReorder` with true. It preserves explicit false. **These three settings are the entire materialized-default table for engine 4.0.0.** Every other optional property remains absent when omitted; its documented behavioral default belongs to the pinned engine contract. No value, ID, text, Unicode sequence or array order is changed. Scalar field defaults must already have canonical field values; invalid precision/default shape is diagnosed rather than silently repaired.

After N, encode with RFC 8785 and hash UTF-8 canonical bytes with SHA-256. N is idempotent. Both omitted and explicitly true repeater settings yield the same digest. Changing semantic array order, IDs or text changes the digest. Implementation acceptance must supply normalization inputs, expected canonical output and hashes using a conforming encoder. These are not claimed to be generated schemas or executed product tests.

Portable packages always contain resolved ordinary fields/nodes/expressions. Block insertion is a separate authoring transaction before N, never a runtime fetch. The caller supplies an immutable insertion namespace; remap each inserted field/node/expression/guidance/term/validator/option/fixed-row identity to `i_` plus the first 60 lowercase hex characters of SHA-256 over UTF-8 `namespace + ':' + identityKind + ':' + originalId`. Namespace is a nonempty ASCII ID under the normal ID pattern, unique per insertion in the target form. Rewrite references by resolved identity, including typed choice literals; do not rewrite ordinary text or keys. Return the full old/new mapping, reject collisions, and store the exact block version/digest dependency. Copy uses the same procedure with a new explicit namespace. The package hash includes the resolved result and dependency records, not editor history.

`packageHash` identifies N(package). `runtimeManifestHash` identifies the complete immutable credential-free interpretation manifest. `candidateDigest` hashes canonical `{mode,targetFormId,targetDraftId,expectedDraftRevision,allowInvalidDraft,normalizedPackageHash,policyVersion}` with absent target fields represented as null. The candidate ID is an opaque server resource, not the digest. The server returns these inputs and expiry; clients never derive authority from a digest. An invalid-draft candidate has no normalizedPackageHash: use a separate `inputPackageHash` in its digest payload, include sorted diagnostic codes/pointers, and mark `publishable:false`. Such a candidate cannot be used to publish.

## Typed values, defaults and expressions

`InputAnswer` is recursive `{status,value?}`, with no `type`, provenance, actor, tenant or release properties at any depth. Only `answered` carries a value. Type is resolved from the pinned field. Object values are `{fields:{fieldId:InputAnswer}}`; list values are `{items:[{itemId,fields:{fieldId:InputAnswer}}]}`. Defaults use this same wrapper and must be answered, canonical and recursively valid. Missing child inputs initialize as unanswered; they do not disappear from an applicable object's eventual envelope. Whole-list/object replacement through `set` is rejected; edit leaves by field ID and rowPath and add/remove/move records with the discriminated operations. An object is structurally present when applicable and its child cells are initialized; lists distinguish untouched/unanswered from explicitly answered empty items. Client item IDs must be unique across that entire list field in a session, including nested parent paths; a deleted ID cannot be reused during that session.

Server envelope statuses are answered, unanswered, unknown, declined, respondentNotApplicable and notApplicable. Only the last is automatic exclusion by applicability and is forbidden in client mutations. `respondentNotApplicable` is permitted only by `allowNotApplicable`, satisfies requiredness when allowed, remains visible in review, and is distinct from an automatically hidden field. Unknown/declined follow the analogous allow flags. All nonanswered cells omit value. A hidden parent omits descendants regardless of hidden retention.

Initial unanswered and automatically hidden cells use provenance source `system`; declared defaults use `default`; derived values use `calculated`; explicitly entered answers/statuses use `respondent`. changedAt is the authoritative initialization/mutation time at which the effective state was established. Client payloads cannot set provenance. Hidden retention may preserve prior values privately under policy, but the effective excluded answer has system provenance and no value.

Literal shape is `{literal:{type,value}}`; homogeneous arrays additionally declare `itemType`. Decimal constants are strings, integers are exact signed 64-bit values encoded as canonical decimal strings, and date/time/choice types are explicit. Null, arbitrary objects and nested array literals are rejected; the dateTime value's bounded `{instant,timeZone}` object is the sole scalar object representation. `expression-contract.json` defines every operator, type/arity, promotion, lazy evaluation, Unknown/error result and fixed vectors. Decimal arithmetic is exact within 34 significant digits; calculations that cannot produce an exact bounded result fail rather than round implicitly. Mutable locale is absent from all expression contexts. Localized formatting may read the selected locale after evaluating a value, but no locale-dependent expression can affect answers, applicability, routing, constraints or options.

## Authorable content and messages

Fields have an optional `descriptionKey`, shared across instances; instance guidance can add local explanation. Sections now accept `guidanceId` with the same approved-content lookup as pages/questions. At an active question, Q&A searches the currently visible page/section/field guidance for the best relevant approved coverage; an unresolved tie prompts a short spoken clarification using Click to Ask, and a no-match response never invents advice. Narration uses only the selected visible scope. Empty/missing optional guidance is omitted; an unresolved declared reference blocks publication.

Theme tokens accept closed spacing values in pixels (`fieldGap`, `sectionGap`, `pagePadding`) and a responsive map with fixed compact <=639px, medium <=1023px, and wide column count 1..3. Omitted spacing is 16/32/24 and omitted wideColumns is 2; these defaults are engine behavior and remain omitted in N. Compact always stacks, medium caps at two columns, wide uses the requested count while honoring minimum readable control width; content order never changes. Header/footer use localized approved content keys and are sanitized through the same text renderer. Fonts remain the existing bounded system/sans/serif choices. Arbitrary CSS, executable HTML and user-supplied breakpoints remain unsupported.

Translation messages may be plain text or `{grammar:'smartforms-message-1',parts:[...]}`. Parts are literal text, a formatted expression value, or a cardinal plural with an integer count expression and locale cases. There is no executable template syntax. Content/guidance/header/footer text parts use the sanitized Markdown subset from the PRD (semantic headings, paragraphs, lists, emphasis, HTTPS links, header tables and authorized asset images); plain labels remain inline text. Parse authored Markdown before inserting escaped expression-value text, so a value cannot add a link, image or formatting node. Legacy {{field:...}} string placeholders are not wire 4.0.0 syntax and produce a migration diagnostic; visual placeholders export AST value parts. Value text is escaped; unsupported/Unknown values show the localized system 'not provided' label, never an old hidden value. Maximum nesting is 3, maximum total parts is 200 per message; cycles through content references are impossible because parts cannot reference other messages. For plural counts only nonnegative integers are accepted. The frozen `smartforms-cardinal-1` map is: English one for 1, otherwise other; Hindi one for 0 or 1, otherwise other; Arabic zero for 0, one for 1, two for 2, few for integer remainder modulo 100 in 3..10, many for 11..99, otherwise other. Every required category plus other must be supplied for the advertised locale. Additional locale category maps are exact-version capabilities and must pass a locale review before advertisement; they cannot silently fall back to English.

The AST supports safe answer piping and repeated counts. Message expressions read the same effective values as review; they cannot mutate the definition or answer. For narration, use the same rendered plain text; formatting/escape output must not expose hidden values. Acknowledgment content is deliberately restricted to an approved **plain string** for this version, with no answer piping. Warning text may use the AST and is hashed after rendering against the current review snapshot.

## Acknowledgments and review binding

An acknowledgment control must declare `acknowledgmentContentKey`; labelKey is its short action label and is not implicitly the entire content. Multiple instances sharing one Boolean field must bind the same content key. The server checks requireTrue and the matching acknowledgment intent. A field record contains kind=field, fieldId, instanceId, rowPath, locale, contentKey, contentHash and acceptedAt. Warning records instead contain kind=warning and stable validatorId, fieldId, rowPath, locale, contentKey, contentHash and acceptedAt. Validators have globally unique IDs, a payload matching kind, and requiresAcknowledgment; severity=error requires false and cannot be waived.

Hash canonical `{locale,contentKey,text}` for the actual approved rendered text. The client submits intent with expectedContentHash and no acceptedAt; the server computes/compares content and stamps acceptance. Logical uniqueness is `(kind,fieldId,rowPath,validatorId when warning)` within the current review snapshot. Reordering rows does not move acceptance to another row; removed/hidden rows contribute no record. A locale change clears pending acknowledgments and invalidates the review digest, but leaves canonical answers and applicability unchanged. In particular, the acknowledgment Boolean may remain true while its locale-specific acceptance is pending; submit still requires the current matching record. Changed content, warning parameters or affected answers require renewed review and acknowledgment. No voice or caller-supplied timestamp can stand in for the respondent's explicit confirmation.

## Pinned interpretation and consumer access

Every envelope includes `schemaVersion`, `submissionId`, trusted tenant/workspace/form/session IDs, `sessionRevision`, authoritative timestamps, locale, `evaluationContext:{sessionDate,timeZone}`, release metadata, recursive answers, attachment metadata and acknowledgments. The release metadata includes releaseId, definitionVersion, packageSchemaVersion, runtimeManifestVersion, runtimeManifestHash, packageHash and engineContract plus contractVersion (equal semantic-version aliases). No response-lineage/head/predecessor metadata exists.

The manifest binds the exact normalized package hash, effective behavior policy, resolved components/assets and timezone database version. The session pins it unchanged. Choice IDs and locale labels resolve through the pinned package. There are no remote option sources, session option snapshots or per-answer snapshot references. The frozen evaluation date/timezone makes calculations reproducible without enabling response editing.

`GET /v1/workspaces/{w}/submissions/{id}/interpretation` is a staff response-view operation returning `{package,runtimeManifest,dataDictionary}` for that submission. It grants no draft/edit authority. Exports include each distinct interpretation once, keyed by hashes. The dictionary is an array of `{fieldId,keyPath,type,unit?,parentFieldId?,optionIds?,ordered}`; keyPath is an array of sibling keys, avoiding dotted-key ambiguity. Provider credentials and private author-review notes never enter it.

Readers negotiate exact supported schemas by digest; unknown compatible optional metadata can be retained, while unknown majors fail explicitly. Imports reject unknown core fields. Complete 4.0.0 implementation schemas/OpenAPI and matching full examples are required before API acceptance; this prose and the proposed minimal example are not a claim that those deliverables have passed validation.

## Remaining execution boundary

The retained vectors and proposed schema rules are specification data. They do not execute the required compiler, APIs, browser, provider, authorization, scale or accessibility behavior. The full evaluator-owned fixture corpus and implementation adapters must be frozen and versioned before either timed Tool A/Tool B run; the Lite corpus must be materialized independently and is not claimed to be a complete executable suite yet.

## Compact speech contract

Only Play/Pause narration and Click to Ask are permanent respondent voice actions. Capture follows an explicit user gesture; the same ask control shows capture/finish/cancel states. Recognized text is transient question input to the help matcher, not an answer candidate. Select only approved relevant content from visible scopes and speak its exact text; retain passive readable narration/answer text and ordinary inline instructions. No typed-question endpoint capability, answer-dictation application, extra Read help panel, or speed toolbar is a Lite respondent requirement. No match, unsupported language, denied permission or provider failure changes any answer or blocks normal form completion.

Speech context binds the form release, locale and effective visible question context. Invalidate pending results when those change. Ordinary autosave must not collapse the form or remount unrelated controls. A saved-revision update by itself must not interrupt still-relevant audio; if the edited branch changes the spoken content's relevance, stop stale output. Relevant approved field help can answer a question asked from the page bar without forcing generic page narration.

## Draft lifecycle — Revisioned mutation replay and unparseable input

### Atomic mutation replay

`PATCH /v1/sessions/{s}` continues to accept one atomic batch:

```json
{
  "baseRevision": 11,
  "clientMutationId": "mutation_synthetic_012",
  "operations": [
    {"op": "set", "fieldId": "fld_name", "rowPath": [], "answer": {"status": "answered", "value": "Alex Example"}}
  ],
  "currentPageId": "page_review",
  "locale": "en"
}
```

`baseRevision`, `clientMutationId` and `operations` are required; `operations` may be empty only when locale or currentPageId is present; a truly empty mutation is rejected. This permits presentation-only updates without fabricating answer changes. Navigation and locale fields are optional intent subject to ordinary authorization and validation. `clientMutationId` is unique within the session and applies to the whole batch, including navigation and locale intent. The server stores the canonical request digest, outcome and accepted revision atomically with every accepted mutation. Failed requests MUST NOT partially apply operations. A definitive failed outcome may also be recorded under the mutation ID; changing the request requires a new ID.

After current authorization checks, the server MUST check the mutation identity before rejecting a stale `baseRevision`. Replaying the same session/mutation ID and identical canonical body returns the recorded outcome without reevaluating or reapplying the batch. The same ID with a different body returns `409 MUTATION_ID_REUSED`. A new mutation ID with a stale base returns `409 SESSION_REVISION_STALE` and leaves the draft unchanged. Dedupe identity MUST NOT depend on a client timestamp or credential rotation.

The response distinguishes `acceptedRevision` from `currentRevision`. A replay remains associated with its original accepted revision even if another actor advanced the current state. Example mutation response fields are:

```json
{
  "requestId": "req_mutation_012",
  "clientMutationId": "mutation_synthetic_012",
  "outcome": "applied",
  "acceptedRevision": 12,
  "currentRevision": 13,
  "replayed": true,
  "validation": {
    "blocking": false,
    "invalidInputs": [],
    "diagnostics": []
  }
}
```

`validation` and any returned effective changes MUST identify the revision to which they refer; when `acceptedRevision` differs from `currentRevision`, the example validation describes the accepted revision and MUST NOT replace newer client state. The client reconciles the current state with an authorized GET. Implementations may additionally return explicitly revision-tagged current validation. An older acknowledgment MUST NOT roll back the client's latest state or mark later unsent input as saved. Mutation results are retained while the draft is recoverable; deletion/revocation removes their access, and result records MUST NOT retain raw answers beyond the applicable data-retention policy.

### Persistent parse-invalid marker

The UI MUST retain unparseable raw text only in the allowed local input buffer and mark it invalid immediately. It MUST NOT present that raw text as saved. Local invalid input MUST block review and submit for applicable fields even if offline or the marker request is still pending. The submit path flushes pending typed mutations and marker mutations before obtaining a review digest. No successful server acknowledgment can acknowledge raw text that was never stored.

Add the input operation `markInvalid` with this exact bounded shape; additional keys are rejected:

```json
{
  "op": "markInvalid",
  "fieldId": "fld_amount",
  "rowPath": [
    {"listFieldId": "fld_expenses", "itemId": "item_beta"}
  ],
  "code": "UNPARSEABLE_INPUT"
}
```

`op`, `fieldId`, `rowPath` and `code` are required. `code` is the literal `UNPARSEABLE_INPUT` in Lite 1.1; there is no caller-supplied raw text, value, message, parameter, type or provenance. The operation is permitted only for an input cell that this actor can edit; read-only fields, calculated outputs and fields outside the authorized session cannot be marked by the respondent. It participates in the same atomic batch, revision guard and dedupe rules as `set`, `clear` and item operations.

An accepted marker persists a server-owned invalid state and advances the session revision. It preserves the last accepted typed value separately; that value may preserve the current editing display/dependency preview but MUST NOT be accepted in an applicable submitted cell while the marker exists. If there was no prior typed value, the field remains unanswered. The marker invalidates all previously issued review digests for the session. It does not claim that the raw input can be restored after tab loss.

GET session and mutation responses expose marker state in `validation.invalidInputs`, with the following exact entry shape:

```json
{
  "fieldId": "fld_amount",
  "rowPath": [
    {"listFieldId": "fld_expenses", "itemId": "item_beta"}
  ],
  "code": "UNPARSEABLE_INPUT",
  "messageKey": "validation.input.unparseable",
  "markedAtRevision": 12,
  "markedAt": "2026-09-05T10:00:00Z"
}
```

Every property is required and server-generated except the validated address and fixed code. Timestamps are UTC RFC 3339; `markedAtRevision` is a positive integer. No raw input or raw-input hash is stored in this marker. `validation.blocking` is true whenever an applicable parse-invalid marker or another blocking validation error exists. `validation.diagnostics` contains the corresponding safe field diagnostic with severity `error`, the same address/code/message key and no answer-bearing parameters. After reload, a marked cell displays the parse-invalid state and explains that re-entry is required; it MUST NOT display its previous typed value as the respondent's current valid answer.

`POST /v1/sessions/{s}/validate` and submission MUST return `422 INVALID_INPUT_PENDING` with applicable marker diagnostics and MUST NOT issue a new review digest or accept a snapshot while such a marker exists. A submit referencing a digest made before the marker returns `409 REVIEW_STALE`. A type-valid, authorized `set` to that exact cell or an authorized `clear` removes its parse marker in the same transaction; normal requiredness and constraints still apply. A typed but constraint-invalid set can remove the parse marker while remaining blocked by ordinary validation. A rejected set does not remove a marker. Merely reading, reviewing, changing locale, receiving an acknowledgment or retrying does not remove it.

Removing an item removes markers within that item. Server-applied hidden `clear` removes both the prior typed value and marker atomically. Under `memory`/`draft` hidden retention, a hidden marker may remain in draft state, but the non-applicable cell emits no value and creates no inaccessible final-review error; if the cell becomes applicable again, its retained marker blocks acceptance until a type-valid set or clear. Thus a hidden marker never permits an old typed value to reappear as an accepted answer. Servers cannot infer invalid text that a client has never transmitted; compliant UI blocking is mandatory in addition to the server marker.


## Public acceptance controls

Form/channel availability windows are [startsAt, endsAt). Start and acceptance check the current public channel, release retirement policy, emergency close/revocation and expiry. A configured maximum counts accepted submissions per share link across its releases, not people or answer uniqueness. Session creation does not reserve a slot. Default public access permits unlimited repeat responses until an explicitly configured form-wide cap or closing time is reached. Deletion does not refund an historical acceptance count.

The acceptance transaction serializes those checks, counter increment, immutable snapshot, session state and outbox. Return RESPONSE_CAP_REACHED or CHANNEL_CLOSED when applicable. Retired releases reject new sessions but previously authorized sessions may finish within their ordinary deadline/window unless emergency-closed. Rollback changes the release selected for new sessions only. No verified-person claim, invitation entitlement, content hash uniqueness or prior response head participates in acceptance.

## Receipt and repeated-submission behavior

A respondent may start another response to the same form immediately after submitting. Identical values are not merged, rejected or hidden from lists/exports. A fresh accepted submission receives a new submissionId and its own created event. No product requirement deduplicates response content or a person's repeated submissions.

Each new deliberate Submit uses a fresh attemptId. The client uses that attemptId to query pending/succeeded/failed status after an uncertain request. It does not show success before durable acceptance or automatically resubmit while the outcome is unresolved. Lite does not require submission-request deduplication: if a repeated request is accepted, it must be represented truthfully as another submission. The operation ledger records each received attempt and any accepted receipt; it must not collapse accepted records by answer/person identity. An accepted session stops editing; Start another response creates a fresh draft. Terminal-state validation is separate from identity/content deduplication.

Receipt-read authorization is distinct from draft-write authorization and expires seven days after the absolute draft deadline. It permits only status and minimal receipt `{submissionId,submittedAt,status:"accepted",requestId}`, not draft/answer/attachment reads. Receipt recovery can survive ordinary draft expiry but is immediately revoked by security revocation or deletion. Persisted pending operations resolve after restart; missing receipt/status never proves that acceptance failed. Same-browser/device authorization remains required; this does not deliver a cross-device resume link.

## Policy retention and deletion

Retention remains an administrative policy capability, not a response-processing workflow. Deletion targets an immutable submission and all its session/receipt credentials, retained attachment references, derived exports and queued answer-bearing payloads. An authorized policy job inventories affected stores, checks holds and installs a tombstone/access cutoff atomically. New access and derivatives are blocked after cutoff. Existing download capabilities must be revocable; already downloaded external copies cannot be recalled.

Retention runs from that submission's submittedAt. A hold committed before deletion blocks it without side effects; a new hold after the deletion cutoff fails clearly rather than claiming preservation. Status separates blockedByHold, accessRevoked, purging, livePurgedAwaitingBackupExpiry, completed and failedRetryable. Access revocation alone is not erasure. Live cleanup deadline is 24 hours by default; backups expire within 35 days. Restoration reapplies tombstones before access, and tombstones survive every backup/replay horizon that could restore data. Deleting a reference never removes bytes legitimately retained elsewhere or grants access via shared storage.

## Attachments — Finalized attachment bytes are sealed

An upload ID begins in `issued`, may transition through `uploading` and `processing`, and terminates as `ready`, `rejected`, `cancelled` or `expired`. Only `ready` creates an accepted attachment reference. `complete` is retry-safe for the same uploaded object/version: it returns that upload's current/final state and never runs a conflicting second finalization. Replacing bytes requires a new upload/attachment ID.

Before marking ready, the server MUST bind the ID to the exact verified immutable bytes or immutable object version, and bind type/size/hash and malware-scan results to that same version. Outstanding transfer credentials must not be able to change the bytes served through a finalized ID. Implementations may seal/copy the object or use version-pinned access; all later validation/downloads must resolve the sealed version. Client-provided `ready`, successful upload transport or an old scan result is never sufficient.

Late completion or scanner callbacks for cancelled, rejected, expired or deleted uploads cannot revive them. A retry with conflicting object/version metadata fails visibly. Upload cancellation and deletion serialize with finalization; referenced accepted snapshots retain their authorized sealed bytes until their own retention requires deletion. Per-session byte limits account for in-progress reservations so parallel transfers cannot evade the published bound; abandoned reservations expire and release quota. Processing failure/timeout remains visible and blocks any attempted acceptance of that attachment rather than silently claiming readiness.


## Deleted outbound event payloads

Deletion suppresses undelivered full payloads, prevents further dispatch and rejects replay without returning answer data. Never rewrite a previously emitted event's body while keeping its ID. Emit a separate submission.deleted event with new eventId, monotonic form sequence, timestamp, tenant/workspace/form/submission IDs and deletionId/accessRevokedAt. Its mode is always reference and it contains no answer/person data or external API-fetch entitlement. Receivers match tombstones by submissionId; an older delayed created event must not restore deleted data. Delivery signature/rotation/retry behavior remains as specified in the PRD. An attempt already dispatched before cutoff is recorded as such without claiming it can be recalled.

## Definition assets and staff invitations

Definition-asset create/complete/read/delete operations use normal staff workspace authorization and the same sealed-byte invariant as respondent files. Published dependencies prevent premature byte deletion. Draft revision and form review operations use revision guards; actual server reviewer decisions bind exact draft digests.

The Add user journey handles invitation issuance/acceptance behind the normal invitation link. Staff choose the person's username/display name, optional delivery email, workspace membership and roles. Both temporary-password onboarding and copyable invitation links work without configured email; configured email delivery remains supported. Validate the recipient/link, expiry, suspension and current offered roles at acceptance; accepted/expired/revoked links show normal user-facing status. Never expose manual actor selection or code exchange as setup steps. These links grant staff membership only, not an invited respondent access channel. Normal sign-in/account recovery preserve the same account and workspace boundaries.


## Lite 1.1 exact integer and evaluator profile

All typed integer values, input answers/defaults, integer literals/arrays, integer-field min/max/step and integer result cells use canonical base-10 strings: `"0"`, `"-1"`, `"9223372036854775807"`. Valid range is -9223372036854775808 through 9223372036854775807. Reject JSON-number transport for these typed values, a plus sign, exponent, fractional part, leading zeros, negative zero and out-of-range values. Format errors are INTEGER_ENCODING; range failures are INTEGER_RANGE. Human-facing input can accept localized digits through an explicit locale-aware parser, then emits this canonical ASCII representation or a parse-invalid marker; no binary-number intermediate may round the input.

Structural properties such as revision counters, field-count limits, scale, item positions and AST depth remain bounded safe JSON integers as their schemas require. A field ID supplies the type for InputAnswer: `{status:"answered",value:"9007199254740993"}` is an integer only when bound to an integer field. No inference from text contents is permitted. CSV preserves the exact digits; the dictionary declares integer type and warns that spreadsheet applications may coerce large numbers when opening a CSV. JSON/dictionary is the exact machine interchange; CSV byte fidelity must not be confused with an external spreadsheet's display fidelity.

Browser editing/evaluation uses BigInt for integer values and an exact decimal implementation for decimal values. Serialize integer values explicitly as canonical strings; native JSON serialization of BigInt is not the wire contract. Never convert a large integer to Number before parsing, calculating, comparing, formatting or serializing. This follows the language's distinction between BigInt and Number documented in [MDN BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt). The choice of a uniform integer-string wire representation is a Lite 1.1 contract decision.

Lite arithmetic retains its existing integer-to-decimal promotion and decimal result types for add/subtract/multiply/divide/min/max/sum. Exact 64-bit support changes the integer domain/transport, not those result signatures. Count/length/dateDiffDays/ageYears yield integer strings. A decimal result outside the integer range can still be a valid decimal; assigning it to an integer field without an explicit supported conversion is not allowed. Empty sum is decimal `"0"`; empty count is integer `"0"`. A nonempty unanswered list is not an empty list.

Every new package contains schemaVersion, contractVersion and engineContract. In this public profile all three are `4.0.0`; the last two name the same evaluator semantics and must agree. The manifest, capabilities and envelope release interpretation carry that exact semantic version. Shape and behavior versioning are conceptually independent; future profile changes document which changes. No missing version defaults to latest. Known legacy sources require an explicit migration adapter and tests. The Software Factory internal numeric version 1 and this profile are distinct contracts, not equivalent spellings.

The `today` operator takes no arguments and reads the same frozen sessionDate as the existing context expression. Date bounds and known choice-domain literals are compile-checked. A literal zero divisor is rejected at compile time even in an otherwise skipped branch; a variable zero divisor is an error only if its branch executes. The fixed vectors distinguish these cases.

Size, AST depth, expanded cell count, repeater depth and execution budgets apply before allocation/evaluation where possible and throughout traversal otherwise. Do not evaluate an arbitrarily large submitted row graph and check its limit only afterwards. Applicability and calculations share dependency order; self-reading validation emits diagnostics and does not itself create a calculation cycle. Multiple placements preserve a field whenever any applicable placement exposes it. Ordinary save acknowledgments cannot hide unrelated fields or overwrite newer local evaluation state.

The authentication companion governs staff invitations, session establishment and recovery. The general prohibition on exposing tokens has narrow authenticated initial-delivery exceptions there; ordinary profile/history/export/log responses never reveal them.
