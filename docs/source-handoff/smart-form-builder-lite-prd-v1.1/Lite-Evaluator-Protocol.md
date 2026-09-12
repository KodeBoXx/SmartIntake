# Smart Form Builder Lite evaluator protocol

Binding retained task protocol for Lite PRD 1.1. This is a test specification, not a saved-scenario feature or evidence of completed product tests. Build an independent Lite assertion corpus; do not import the original full-product ledger as an acceptance obligation.

## 1. Evaluation freeze and ownership

The evaluator owns the expected outcomes independently of either implementation. Before either timed implementation run starts, freeze and give both tools the same:

- PRD/schema/contract versions, this protocol, assertion ledger and one manifest checksum.
- Complete medical-style and equally complex nonmedical golden packages, per-control/type/operator/boundary vectors, exact input actions and expected machine outputs, all required English/Hindi/Arabic content, extension cases and large catalog/form/response datasets.
- Test identities, tenant/role grants, permitted origins/domains, provider endpoints/credentials with equivalent scope, fault schedules, load-generation seeds and observation windows.
- Model/tool versions, implementation time/token/cost allowance, human assistance policy, equal infrastructure/resource/cost ceilings and the milestone being compared.
- Participant allocation, orientation materials, task timeboxes, usability scoring, browser/assistive-technology versions and any proposed score-4 improvement metrics/thresholds.

Record each case result with requirement/assertion IDs, source commit, corpus checksum, environment, command or manual task, artifact, observed outcome and pass/fail/blocked/not-run. A screenshot can establish visual state, not durable acceptance; a mock cannot establish required external-provider verification. Shared provider unavailability is blocked equally or replaced with the same approved evidence-equivalent environment for both. Every contract correction receives a new version and is distributed to both tools before its corresponding comparison resumes.

The historical Core ledger has 87 requirements and Lite 1.0 retained 80. Lite 1.1 accounts for every retained requirement and adds the explicit foundation requirements in its current disposition register; evaluation uses that current full set. Evaluators must materialize the remaining Lite assertions, translated packs, executable runners, fault/benchmark generators and field/operator vectors before a measured run. The fixed task below is not the entire executable oracle.

Each requirement is scored once in its ledger category: correctness 25%, authoring 20%, respondent 20%, reliability 15%, security 10%, maintainability 10%. Base scores are zero through three. The weighted base score is the sum of category mean requirement base score divided by three and multiplied by that category's weight, so complete demonstrated coverage can reach 100%. Apply hard gates first, and report core/enhancement coverage separately. A score of three needs every required assertion and minimum evidence level. Score four is disabled unless a separate improvement addendum is frozen before timed runs; any enabled improvement result is reported separately and does not change the base score or its denominator. Excluded workflows and optional additions earn no bonus.

## 2. Participant and observation protocol

Use five independent nondeveloper authors and five independent respondents per tool. The author and respondent groups are separate. Authors routinely create or maintain information-collection forms, understand labels/options/required questions, and have not developed either evaluated product. Respondents are adults comfortable with an ordinary web form but have not been taught this task or either product. Use synthetic identities and answers only. Recruit language/device/accessibility needs in advance and match them across tools; do not substitute more experienced users after seeing failures.

For two independent groups, match relevant experience and locale/device needs. If participants must try both tools, counterbalance order and use structurally identical relabeled fixture variants with the same expected complexity; record prior exposure. Do not give one tool an unblinded coaching advantage. Facilitators may read the task verbatim, resolve a genuine typo in the shared script for both tools, or address equipment safety; they cannot point to a control, suggest a rule, repair data or confirm whether an answer is correct. Any product-use hint counts as intervention and an unsuccessful unassisted attempt. Record requested help even if refused.

Authors receive exactly 20 minutes of shared orientation covering navigation, ordinary properties, rules, preview, locale review, publish and recovery using a separate five-field practice form. They get no completed target package, target screenshots, raw JSON or source code. The author task then has a 60-minute wall-clock limit. Respondents get five minutes to read the introduction and neutral explanation that all data is synthetic; their task has a 25-minute wall-clock limit. Product loading, recovery, help and provider delay count toward the timebox. A confirmed evaluator-wide infrastructure outage is recorded as blocked and the same run policy applied to both, not silently subtracted from one result.

Measure completion, time, input/logic errors, help usage, navigation recovery and interventions. A successful author must publish the required semantics, not merely any form. A successful respondent must produce the exact final answer meaning and an accepted receipt. At least four of five must succeed for each respective requirement; no critical respondent answer-meaning error may remain among successful attempts. Keep every failed/abandoned attempt in the denominator and report its cause. These five-user trials do not prove population-wide usability.

## 3. Frozen blank-canvas author task

Create a new form named **Community equipment support request**, key `equipment-support`, with English as default locale. This is an ordinary information request; it does not collect payments, schedule appointments, process documents or obtain e-signatures. Use a new owned implementation. The old application is optional experience reference only.

The form has three phases and three pages:

1. **About your request / About**: fields 1–12 below, relevant instructions and scoped help.
2. **Equipment / Equipment**: fields 13, 21, 24 and 27–29, their typed descendants, and a second read-only instance of field 3.
3. **Review / Review and submit**: a review node followed by field 30. Review is not an answer-progress page.

Use exactly these 30 canonical field definitions, including children. Field keys are stable human-readable integration keys. The evaluator records generated field IDs from the author's first valid export and checks all later identity assertions against those IDs; authors need no developer ID picker. Labels can be the readable form of these names. Do not accept raw JSON editing as visual-authoring success.

| # | Key / parent | Canonical type / control | Required configuration |
|---|---|---|---|
| 1 | `respondentName` | text / short text | Required, maximum 120 characters. |
| 2 | `referenceCode` | text / identifier | Required, maximum 20; preserve leading zeros. |
| 3 | `email` | text / email | Required; editable on About and shared read-only instance on Equipment. |
| 4 | `needsSetup` | boolean / yes-no | Required; false is a valid answer. |
| 5 | `setupDetails` | text / long text | Required only while field 4 is true; sensitive, hidden retention clear. |
| 6 | `services` | multiChoice / chips | Options `opt_collection`, `opt_setup`, `opt_other`, `opt_none`; at least one; `opt_none` exclusive. |
| 7 | `otherServiceDetails` | text / text | Required while `opt_other` is selected; hidden retention clear. |
| 8 | `visitDate` | date / date | Required ISO calendar date; this records information only. |
| 9 | `extraAttendees` | integer / number | Required, minimum 0, maximum 10, step 1. |
| 10 | `priority` | integer / rating | Required, 1–5; endpoints labeled Low priority and High priority. |
| 11 | `priorityOrder` | ordered multiChoice / ranking | Rank exactly `opt_reliability`, `opt_portability`, `opt_price`; keyboard move controls. |
| 12 | `entryMode` | choice / mode selector | Required, options `opt_cards`, `opt_table`; default cards. |
| 13 | `equipment` | list / repeating cards or dynamic matrix | 1–50 items; alternate instances bind the same field; allow add/remove/reorder; summaries use equipmentName and quantity. |
| 14 | `equipment.equipmentName` | text / short text | Required, maximum 80. |
| 15 | `equipment.quantity` | integer / number | Required, minimum 1, maximum 10. |
| 16 | `equipment.unitCost` | decimal / currency | Required, USD, scale 2, minimum 0, maximum 1000000. |
| 17 | `equipment.accessories` | list / repeating cards | Optional, maximum 10 per equipment item; second repeater level. |
| 18 | `equipment.accessories.accessoryName` | text / short text | Required within an existing accessory. |
| 19 | `equipment.accessories.tests` | list / repeating cards | Optional, maximum 5; third repeater level. |
| 20 | `equipment.accessories.tests.testResult` | choice / radio | Required within a test; options `opt_pass`, `opt_fail`. Show this node only when the parentItem accessoryName is answered, exercising an explicit parent-scoped expression. |
| 21 | `checks` | list / fixed yes-no matrix | Fixed row IDs `row_power`, `row_space`, labels Power available and Space available; no add/remove. |
| 22 | `checks.checkResult` | boolean / yes-no | Required in each fixed row; rows initialize unanswered. |
| 23 | `checks.checkDetails` | text / row detail | Required when that same row's checkResult is false; clear when hidden; item-scoped rule. |
| 24 | `shipping` | object / address composite | Explicit child roles postalCode and country; no implicit state/region requirements. |
| 25 | `shipping.postalCode` | text / identifier | Required, preserve leading zeros; no US-only format rule. |
| 26 | `shipping.country` | choice / searchable combobox | Required, options `opt_in`, `opt_gb`; labels India and United Kingdom. |
| 27 | `note` | text / text with status choice | Optional; allow explicit unknown and declined separately from unanswered. |
| 28 | `total` | decimal / read-only calculated | USD scale 2; sum each applicable equipment quantity multiplied by unitCost. Server recomputes. |
| 29 | `supportingFiles` | attachments / file upload | Optional, maximum 2 files, text/plain allowed, normal scan/readiness behavior. |
| 30 | `reviewAcknowledged` | boolean / acknowledgment | Required requireTrue; displayed on final review only. Cannot be supplied by voice. |

Additional author actions, all within the same task:

1. Create the fields/layout/rules through visual controls. Configure and test both equipment entry modes, the fixed-row detail rule, nested repeaters and total. Shared fields must not become duplicated answer definitions.
2. Add semantic rich instructions with a heading, two-item list and safe email placeholder. Add short help, detailed help, glossary term **Estimate**, and approved Q&A: “Does an estimate take a payment?” → “No. This form only collects information.” Attach this approved Q&A to both About and Equipment scopes through a shared guidance reference or explicitly identical approved content. Declare one paraphrase: “Will this charge me?” The no-match script is “Can you recommend a supplier?” and must produce an honest no-approved-answer state.
3. Add visible/selectable narration text: “Enter the equipment you need. The estimate only records information. You can stop narration at any time.” Enable opt-in narration; never autoplay. The provider uses the approved real reference adapter in its separate E3 check.
4. Create a reusable block from the shipping object and its guidance; insert it into a temporary scratch area to inspect the ID remap, then remove the temporary insertion so the final package still has 30 definitions. Update the block in a separate draft and show the impact diff without silently updating a published session.
5. Import the evaluator-supplied complete Hindi content pack and Arabic RTL test pack using the locale UI, inspect a deliberately missing mandatory acknowledgment key in a separate invalid variant, and approve only the complete pack. Full native-script packs are required evaluator assets; Roman Hindi or English text labeled Hindi is not a substitute.
6. Preview the supplied complete, setup-detail, Other-detail and invalid input cases in ordinary preview. The invalid input case has whitespace-only name, quantity 0 and a false fixed row without detail. Diagnostics must link to those exact objects; preview creates no real events or messages.
7. Publish v1, open a pinned synthetic test session, start v2, rename a heading and reorder a question, inspect stale approval, reapprove and publish. Verify the v1 session is unchanged. Export the final v1 package for the staff-authorized import equivalence check.

The evaluator's HTTP check under an ordinary staff workspace role imports the UI-created package preserving its generated IDs, edits a composite setting through the imported draft's properties panel and restores it, then compares normalized package hash and golden outputs. A separate interpreter/runner verifies the expected output independently; the tool's own serializer is not the sole oracle. T04 still needs separate coverage of all catalog controls not used by this bounded usability task.

## 4. Exact respondent script and ground truth

Use the evaluator-reviewed target release from Section 3, not a participant author's potentially broken result. Keep the session date `2026-09-05` and timezone `Asia/Kolkata`. Begin in English, cards mode, with no entered answers and fixed matrix rows unanswered. This script assesses the builder/runtime, not the respondent's knowledge. Read these synthetic facts verbatim; do not infer real personal information.

1. Enter name **Alex Morgan**, reference **00123** and email **alex.morgan@example.test**. Set needs setup to **Yes**, enter **Please call after 17:00.**, then change needs setup to **No**. The hidden detail must clear.
2. Select **Other**, enter **Loan adapter.**, select **None**, then select **Collection**. At the end Collection is the only selected service and the hidden Other detail is cleared.
3. Enter date **5 September 2026**, extra attendees **0**, priority **4**. Rank priorities in the order **Reliability, Price, Portability**. Keep cards mode and press Next. Record the acknowledged server revision and progress **1/2**.
4. Use Click to Ask to speak “Does an estimate take a payment?” and then “Can you recommend a supplier?” in the appropriately scoped help. The first speaks only its approved answer and displays matching passive text; the second gives the no-approved-answer state. The bar has Play/Pause and Click to Ask only; there is no typed-question or answer-dictation input. The same Equipment help must also expose the approved estimate Q&A, either through a shared guidance reference or the explicitly authored equivalent scope.
5. Add equipment A with name **Display unit**, quantity **2**, unit cost **12.50**; add accessory A **Power cable** and one test **Pass**. Add equipment B with the same name **Display unit**, quantity **1**, unit cost **7.25**; add accessory B **HDMI cable** and one test **Pass**. Add a temporary **Spare** accessory to B and delete that accessory.
6. Move equipment B above A using the available accessible controls. Use Back to About to change entry mode to table, then Next to return to Equipment. All item identities/values must remain attached to their original records. Total is **32.25** at this point.
7. For Power available choose **Yes**. For Space available choose **No**, enter detail **Clear the rear shelf.**. Set shipping postal code **00120**, country **India**, and note answer status **Unknown**. Upload `equipment-note.txt` with exact UTF-8 bytes `fixture` followed by one LF byte (8 bytes total); wait for Ready.
8. Save and reload the same browser/device with its existing unexpired session authorization. Acknowledged values must survive. Switch to Hindi and Arabic, inspect the same typed values/IDs and direction, then return to English. Advertise only complete approved locales. No resume code, second-device exchange or delivery task is part of this test.
9. Go to review. Record progress **2/2** and that Submit still needs the final acknowledgment. Open the **second equipment item's quantity** from review (this is original A after the reorder), change it to **3**, and return to review. The first equipment item must remain quantity 1; total becomes **44.75**.
10. Confirm that the cleared setup/Other details are absent, Unknown differs from blank, false/zero are retained, shipping code retains its leading zeros and attachment metadata says Ready. Acknowledge the displayed text **I reviewed these answers and authorize this information request.** Explicitly submit, then obtain a durable server receipt. A progress label, narration completion or URL change is not a receipt.

The evaluator records generated item IDs at creation and binds aliases `equipmentA`, `equipmentB`, `accessoryA`, `accessoryB`, `testA`, `testB` to those exact IDs. These aliases are notation in the oracle, not a requirement to force particular client-generated IDs through the UI. Reorder/edit/delete assertions compare the recorded IDs. Normalize only explicitly run-generated identifiers/timestamps through documented mapping; never normalize answer values, ordering, meaning or changed identity away.

Final answer oracle, keyed by canonical field key and mapped to the release's actual IDs:

| Field | Exact final meaning/value |
|---|---|
| respondentName | answered text `Alex Morgan` |
| referenceCode | answered text `00123` |
| email | answered text `alex.morgan@example.test`, stored once despite two instances |
| needsSetup | answered boolean `false` |
| setupDetails | system `notApplicable`, no value |
| services | answered multichoice `["opt_collection"]` |
| otherServiceDetails | system `notApplicable`, no value |
| visitDate | answered date `2026-09-05` |
| extraAttendees | answered integer `"0"` |
| priority | answered integer `"4"` |
| priorityOrder | answered ordered IDs `["opt_reliability","opt_price","opt_portability"]` |
| entryMode | answered choice `opt_table` |
| equipment | ordered items `[equipmentB,equipmentA]`, retaining their recorded IDs |
| equipmentB | equipmentName `Display unit`, quantity `"1"`, unitCost `7.25`; only accessoryB `HDMI cable`, whose only testB has `opt_pass` |
| equipmentA | equipmentName `Display unit`, quantity `"3"`, unitCost `12.50`; only accessoryA `Power cable`, whose only testA has `opt_pass` |
| checks | fixed IDs unchanged; row_power checkResult `true`, checkDetails notApplicable/no value; row_space checkResult `false`, checkDetails `Clear the rear shelf.` |
| shipping | typed object with postalCode `00120`, country `opt_in`; no undisclosed required children |
| note | explicit `unknown` answer status, no value; not an unanswered cell or named None option |
| total | server-calculated answered decimal `44.75`, unit USD, calculated provenance |
| supportingFiles | one ready authorized attachment ID for the exact 8-byte file; safe metadata, no durable bearer URL |
| reviewAcknowledged | answered boolean `true`; server record binds approved English displayed text digest and respondent acceptance timestamp |

No temporary Spare accessory or its descendants remain. No hidden detail, malformed raw input, fabricated trusted provenance or duplicate shared email cell appears. Server-assigned receipt/submission/session/release identifiers, commit timestamps, attachment digest and accepted draft revision and release binding are validated against the recorded operation rather than fabricated in this document. The published release hash must match the accepted snapshot's release binding.

Critical errors include changing the wrong repeated item after reorder; losing leading zeros; treating zero/false as unanswered; treating Unknown as No/None; changing a date/decimal during locale switch; retaining hidden detail in review/output/narration; accepting a pending/rejected attachment as Ready; bypassing required review acknowledgment; a voice command submitting; or believing a nonaccepted state is submission success. Any such unresolved error prevents a successful attempt even if a receipt exists.

## 5. Deterministic review projection and edit return

Review is a projection of the effective typed answer snapshot under the pinned release, not a second independent form or PDF preview. Traverse declared phase/page/section order, deduplicate canonical fields, and preserve object children and list item order/IDs. Display each applicable canonical field once; omit system-hidden notApplicable fields and descendants. Final review-gate controls render separately after the summary, so their acknowledgment is not duplicated as a second summary question.

Show localized field/option labels while retaining value meaning. Show false as No, zero as 0, unanswered as Not answered, explicit unknown as Unknown, declined as Prefer not to answer, and explicitly allowed `respondentNotApplicable` as Not applicable (respondent answer) using the approved locale pack. `respondentNotApplicable` remains an applicable respondent-selected status with no value; it is distinct from system-hidden `notApplicable`, which is omitted from review. A selected option named None remains a selected option, not an answer-status synonym. Preserve ranked option order. Show unit/currency and derived labeling. For repeated items with identical labels include an unambiguous item position plus distinguishing configured summary values. Show attachment name, size and readiness through authorized metadata; do not expose a durable download token. Drawing/typed-name values, when a different fixture uses them, remain ordinary captured data with no e-sign claim.

For a shared field, the edit link selects the first currently applicable editable instance in declared route order; if none is editable, display it as read-only without a misleading edit action. A nested link locates by stable row path, opens all relevant disclosures/containers, activates the required input mode if necessary, and focuses the actual field. Returning to review preserves scroll/focus near the edited summary row while announcing changed totals/errors. Removed/reordered rows cannot redirect the edit to another record.

Any relevant answer, applicability, acknowledgment locale/text or displayed summary change invalidates the review digest and final review acceptance. The respondent returns to the refreshed review and explicitly acknowledges current content before submission. A server `REVIEW_STALE` response preserves valid draft data, announces the stale review and returns a review action; it is not a generic retry that submits a different unseen snapshot. Earlier accepted submissions remain immutable.

## 6. Progress and navigation oracle

The progress unit is **answer pages**, even in focused-question presentation. Label it as pages/answer steps so a question-at-a-time view does not imply a question-count percentage. Denominator is the count of applicable answer pages on the currently known reachable route; dedicated review/confirmation pages and their final acknowledgment gates are excluded. A page is complete only after the respondent successfully validates/navigates past it and its applicable values remain valid. Merely visiting it, autosaving it or entering a required-looking value does not establish completion. An optional answer page counts while it is on the route and becomes complete after its valid Next action even if optional answers remain unanswered.

For the main two-answer-page task: initial About is **0/2**; successful Next to Equipment is **1/2**; arrival at Review after valid Equipment is **2/2**. Unchecked final acknowledgment does not alter that ratio and still blocks submission. Accompany 2/2 with **Answer steps complete. Review and submit remain.** A later accepted receipt is a separate state. Pending save has its own visible status; it never masquerades as an accepted submission or changes a valid page into invalid solely due to network latency. Submission waits for consistent server revision.

Use these extra independently frozen navigation vectors:

- **Optional empty page:** About valid → 1/2; leave every optional input on Equipment unanswered and press valid Next → 2/2 at Review. If the fixture's Equipment has a required control, this vector must use its explicit all-optional variant; do not silently waive the main task's required fields.
- **New work:** a separate variant moves setupDetails to a third conditional answer page after Equipment. With needsSetup=false, complete About/Equipment → 2/2. From review edit needsSetup=true. Previously completed About/Equipment remain valid; the new detail page is incomplete, so progress becomes 2/3 with **An answer added a step.** Fill and leave that page → 3/3 at review. Back history cannot include a now-inapplicable old branch.
- **Invalidated completed page:** from 2/2, clear a required value on About through an edit link. About becomes incomplete and progress becomes 1/2 until it validates again. Show the exact error and require refreshed review after correction.
- **Unresolved branch:** when the branch decision is unanswered, show the known-path count plus **Remaining steps may change.** Do not claim the unknown route has been completed. Once resolved, display the new exact denominator.
- **No answer pages:** a content-only form goes directly to review with **No answer steps. Review and submit remain.** Do not divide by zero or imply submission; any final acknowledgment still gates Submit.

The complete golden pack must encode these numerator/denominator/focus states as expected outputs. A UI is allowed to display a percentage derived from the ratio, but neither tool chooses a different denominator or completion predicate.

## 7. Accessibility task and focus oracle

Record exact browser/OS/screen-reader versions. Run a keyboard-only author task and the respondent task with a desktop reader (NVDA or a predeclared equivalent) and VoiceOver mobile/desktop as specified by the final browser matrix. Use the same combinations for both tools. Keep automated scan output and actual task observations separate.

| Action | Required observable focus/state |
|---|---|
| Add a field/page without dragging | Keyboard reaches a named Add action; new object is selected and its label/property control is reachable; outline order is announced. |
| Open Logic and create an item-scoped condition | Operator/operand/scope controls have meaningful names; keyboard can complete the expression; invalid scope links to the offending object. |
| Use compact narration/help controls | Play/Pause and Click to Ask have accessible names and states; focus stays on the active control. Passive answer text and ordinary inline instructions remain readable without a separate help dialog. |
| Change setup Yes to No while detail is focused | Hidden field leaves focus/accessibility tree; focus moves to the nearest meaningful visible heading/control without jumping to the browser chrome or exposing hidden text. |
| Add a nested accessory/test | New item and its position are announced; focus lands on its first editable control, and parent/item identity remains understandable. |
| Remove a repeated item | Removal is announced; focus moves to the next surviving item's related control, else previous item, else the list Add control. |
| Move equipment B above A | Position change is announced; focus remains associated with B and its move control; equal labels do not erase identity. |
| Submit invalid nested row | Error summary announces failures; activating its link expands containers, selects the proper input mode and focuses that exact row/field with its inline error. |
| Activate a review edit link | Stable row path is used, target is focused and a Return to review action restores context near the changed summary row. |
| Toggle locale | `lang`/direction and accessible names update; typed values and item IDs stay unchanged; mixed-direction identifiers are not scrambled. |
| Pause narration/navigate | Pause is keyboard reachable; navigation ends stale speech; focus is not trapped in a disappearing voice bar. |
| Upload pending/rejected/ready | Per-file name/state/progress/removal is accessible; changes are announced without interrupting every keystroke; required readiness error links to upload. |

Repeat essential respondent controls at 320 CSS pixels, 200% and 400% zoom, reduced-motion and high-contrast preferences. Focus cannot be covered by sticky controls. Wide data tables may use a justified accessible two-dimensional scrolling pattern; ordinary field labels and controls must remain operable. Verify applicable WCAG 2.2 AA contrast, target-size, semantic/error/focus criteria with actual evidence. An automated green scan alone does not pass T13 or justify a conformance claim.


## 8. Lite scope-specific acceptance additions

- Staff Add user supports temporary-password setup or a normal invitation. Verify both without email, then with configured delivery; accepting an invitation creates only the currently authorized offered membership. Normal sign-in works without SSO or actor/code-selection screens.
- An exporter in workspace A exports any A form and is denied B unless separately granted export in B. There is no per-form grant prerequisite or extra export-permission screen.
- Repeated fresh submissions with identical values are visible as distinct submitted responses and distinct export rows. No person/content deduplication is performed. Form-wide closing windows and explicitly configured caps remain independent.
- Ordinary PDF upload follows the same scan/readiness/download rules as other permitted files. Test a valid PDF, misleading MIME/type, rejected scan and unauthorized download.
- The response area supports listing, viewing answers/attachments and exporting only. It does not expose post-submission corrections, revision selection, private notes, assignments, tags or processing statuses.
- The compact voice test checks relevant field help asked from the page bar, approved exact answer text/audio, no-match and hidden-scope exclusion. Typed questions, separate Read help and answer dictation controls are absent. Microphone/provider failure preserves normal manual form entry; speech cannot set any field or acknowledgment.
- Ordinary preview runs temporary input cases without saving scenario resources or generating live response/provider side effects. Test fixtures and development tests are still required.

All observed outcomes must record pass/fail/blocked/not-run with evidence. No product tests were executed by writing this protocol.


## 9. Lite 1.1 foundation acceptance

T27–T30 use the full authentication companion, including multiple-tenant membership and shared-account recovery boundaries. Run the ordinary author task after real sign-in with an author role; neither a development identity header nor SQL-created memberships establishes usable onboarding. Run email-disabled temporary-password and invitation-copy flows before adding configured email evidence. Staff invites do not become respondent invitations.

T31 additionally covers the signed integer extrema, 2^53 and 2^53+1, typed wire strings through create/save/reload/JSON/CSV, invalid encodings and the same server/browser results. Numeric values in the human task remain the quantities shown; their canonical integer wire values are strings. Run every retained and new expression vector under profile 4.0.0. Refuse unstamped/mismatched/unsupported package contracts. Test a derived total revealing a later page in one pass, the second of two placements being the visible one, typed empty aggregates, legal self-validation, genuine applicability cycles, date bounds, literal zero division and limits before expensive row execution.

Extend T09 with slow/out-of-order autosave responses while editing English, Hindi and Arabic text and choice fields. Unrelated questions, scroll and focus remain stable. Only a real rule dependency can change visibility; no saving flag collapses the form.

T32 proves a clean local start through first real user and restart/restore. The new developer/agent receives the same UI asset bundle, current PRD, expression profile and acceptance requirements. Work-order test totals quoted in historical review logs are not results for these fixtures. All product fixture execution in this PRD revision remains not run.
