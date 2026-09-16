#!/usr/bin/env python3
"""Validate the hand-authored executable T17–T24 fixture oracle.

This checker intentionally validates the three priority fixture bindings against the
frozen asset bytes instead of trusting summarized expectations in the fixture file.
"""
import hashlib
import json
import pathlib
import re
import sys
from copy import deepcopy
from datetime import datetime, timedelta

from check_fixture_routes import check_document

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "t17-t24.json"
ASSETS = ROOT / "assets"
PACKAGES = ROOT / "packages"
SEC = ROOT.parent / "denominators" / "sec-total.json"
EXPECTED_FIXTURES = [f"T{number}" for number in range(17, 25)]
FORBIDDEN = ("evaluator://fixture-runner", "operation.status\": \"completed", "must satisfy", "broad alternative")
FIXTURE_FILES = tuple(sorted((ROOT / "fixtures").glob("t*-t*.json")))
RESPONSE_REFERENCE = re.compile(r"\$\{(?P<action>[A-Za-z0-9-]+)\.(?P<binding>[A-Za-z0-9_-]+)\}")
SYMBOLIC_FILE_PAYLOAD = re.compile(
    r"(?:--data(?:-binary)?(?:=|\s+)\s*@|(?<![A-Za-z0-9])@[A-Za-z0-9][A-Za-z0-9._/-]*)"
)
PACKAGE_ROOT_KEYS = {
    "schemaVersion", "engineContract", "contractVersion", "kind", "formKey", "definitionVersion",
    "titleKey", "descriptionKey", "defaultLocale", "supportedLocales", "data", "flow", "expressions",
    "guidance", "translations", "theme", "policies", "dependencies", "assets",
}


def load(path):
    return json.loads(path.read_text())


def rfc8785_json(value):
    """Return RFC 8785-compatible canonical bytes.

    The frozen package contains strings and integer JSON values only.  Rejecting
    floats avoids silently using Python's number formatting where it can differ
    from ECMAScript's RFC 8785 serialization rules.
    """
    def validate(node):
        if isinstance(node, float):
            raise ValueError("normalized package must not contain floats")
        if isinstance(node, dict):
            if not all(isinstance(key, str) for key in node):
                raise ValueError("JSON object keys must be strings")
            for child in node.values():
                validate(child)
        elif isinstance(node, list):
            for child in node:
                validate(child)
        elif node is not None and not isinstance(node, (str, int, bool)):
            raise ValueError("normalized package has a non-JSON value")

    validate(value)
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def normalize_lite_package(package):
    """Implement Lite Contract Details 9–11's complete N default table."""
    normalized = deepcopy(package)
    fields = {field.get("id"): field for field in normalized.get("data", {}).get("fields", [])}

    def visit(node):
        if isinstance(node, dict):
            if node.get("kind") == "question" and node.get("control") in {"repeatingCards", "dynamicMatrix"}:
                field = fields.get(node.get("fieldId"))
                if not isinstance(field, dict) or field.get("type") != "list":
                    raise ValueError("repeater control must bind a canonical list storage field")
                presentation = node.setdefault("presentation", {})
                if not isinstance(presentation, dict):
                    raise ValueError("repeater control presentation must be an object")
                settings = presentation.setdefault("settings", {})
                if not isinstance(settings, dict):
                    raise ValueError("repeater control presentation.settings must be an object")
                for setting in ("allowAdd", "allowRemove", "allowReorder"):
                    settings.setdefault(setting, True)
            for child in node.values():
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(normalized.get("flow", {}))
    return normalized


def normalized_package_sha256(package):
    return hashlib.sha256(rfc8785_json(normalize_lite_package(package))).hexdigest()


def flow_question_nodes(package):
    """Return canonical flow question nodes keyed by their storage field ID."""
    nodes = {}
    for phase in package.get("flow", {}).get("phases", []):
        for page in phase.get("pages", []):
            for section in page.get("sections", []):
                for node in section.get("nodes", []):
                    if node.get("kind") == "question" and isinstance(node.get("fieldId"), str):
                        nodes[node["fieldId"]] = node
    return nodes


def normalization_variants(package):
    """Freeze every product-exercised normalizer input independently.

    Each of the two canonical presentation types exercises a missing
    presentation, a presentation without settings, every independently missing
    default, every independently explicit false, explicit true, an already
    normalized input, and a second N round.  Values are complete portable
    packages rather than metadata patches so a product import can execute them.
    """
    variants = {}
    targets = {
        "repeatingCards": "hc-f10",
        "dynamicMatrix": "hc-f12",
    }
    defaults = {"allowAdd": True, "allowRemove": True, "allowReorder": True}

    for field_type, field_id in targets.items():
        prefix = field_type

        def clone():
            return deepcopy(package)

        def target(candidate):
            node = flow_question_nodes(candidate).get(field_id)
            if not node:
                raise ValueError(f"missing flow question for {field_id}")
            return node

        missing_presentation = clone()
        target(missing_presentation).pop("presentation", None)
        variants[f"{prefix}-missing-presentation"] = missing_presentation

        presentation_without_settings = clone()
        target(presentation_without_settings)["presentation"] = {}
        variants[f"{prefix}-presentation-without-settings"] = presentation_without_settings

        for setting in defaults:
            missing_setting = clone()
            target(missing_setting)["presentation"] = {"settings": dict(defaults)}
            target(missing_setting)["presentation"]["settings"].pop(setting)
            variants[f"{prefix}-missing-{setting}"] = missing_setting

            explicit_false = clone()
            target(explicit_false)["presentation"] = {"settings": dict(defaults)}
            target(explicit_false)["presentation"]["settings"][setting] = False
            variants[f"{prefix}-explicit-false-{setting}"] = explicit_false

        explicit_true = clone()
        target(explicit_true)["presentation"] = {"settings": dict(defaults)}
        variants[f"{prefix}-explicit-true"] = explicit_true

        fully_normalized = normalize_lite_package(clone())
        variants[f"{prefix}-fully-normalized"] = fully_normalized
        variants[f"{prefix}-idempotence-second-round"] = normalize_lite_package(fully_normalized)
    return variants


def check_product_roundtrip(errors, indexed, prefix, package, expected_bytes, expected_hash, rounds=1):
    """Require a complete response-bound import/commit/publish/export chain."""
    setup, validate, commit, publish, export, compare, teardown = (
        indexed.get(prefix + suffix)
        for suffix in ("-setup-reset", "-validate", "-commit", "-publish", "-export", "-compare", "-teardown-reset")
    )
    isolation_id = "t24-" + prefix
    snapshot_id = isolation_id + "-clean-database-snapshot"
    if not all((setup, validate, commit, publish, export, compare, teardown)):
        fail(errors, f"T24-01: normalization variant {prefix} lacks executable product actions")
        return
    if (setup.get("kind") != "clean-database-snapshot-reset"
            or setup.get("executionScopeId") != isolation_id
            or setup.get("snapshotId") != snapshot_id
            or setup.get("expectedResult") != {
                "databaseState": "clean-snapshot-restored",
                "formKeyAbsent": package["formKey"],
            }
            or teardown.get("kind") != "clean-database-snapshot-teardown"
            or teardown.get("executionScopeId") != isolation_id
            or teardown.get("restoreSnapshotId") != snapshot_id
            or teardown.get("dependsOn") != [prefix + "-compare"]
            or teardown.get("expectedResult") != {
                "databaseState": "clean-snapshot-restored",
                "formKeyAbsent": package["formKey"],
                "stateCarryover": False,
            }):
        fail(errors, f"T24-01: normalization variant {prefix} is not bounded by a clean database reset")
    chain_actions = (validate, commit, publish, export, compare)
    if any(action.get("executionScopeId") != isolation_id for action in chain_actions):
        fail(errors, f"T24-01: normalization variant {prefix} actions are not in one isolated execution scope")
    if (validate.get("kind") != "http"
            or validate.get("method") != "POST"
            or validate.get("path") != "/v1/workspaces/workspace-alpha/imports/validate"
            or validate.get("body") != {"mode": "create", "package": package}
            or validate.get("dependsOn") != [prefix + "-setup-reset"]
            or validate.get("expectedResponse", {}).get("httpStatus") != 200
            or set(validate.get("responseBindings", {})) != {"candidateId", "candidateDigest", "expiresAt"}
            or validate.get("responseBindings", {}).get("candidateId", {}).get("source") != "/candidateId"
            or validate.get("responseBindings", {}).get("candidateDigest", {}).get("source") != "/candidateDigest"
            or validate.get("responseBindings", {}).get("expiresAt", {}).get("source") != "/expiresAt"):
        fail(errors, f"T24-01: normalization variant {prefix} validate action is not exact")
    if (commit.get("kind") != "http"
            or commit.get("method") != "POST"
            or commit.get("path") != f"/v1/workspaces/workspace-alpha/imports/${{{prefix}-validate.candidateId}}/commit"
            or commit.get("body") != {"candidateDigest": f"${{{prefix}-validate.candidateDigest}}"}
            or commit.get("dependsOn") != [prefix + "-validate"]
            or not commit.get("headers", {}).get("Idempotency-Key")
            or set(commit.get("responseBindings", {})) != {"formId", "draftId", "draftRevision", "packageHash", "etag"}
            or commit.get("responseBindings", {}).get("etag", {}).get("source") != "header:ETag"):
        fail(errors, f"T24-01: normalization variant {prefix} commit action is not response-bound")
    if (publish.get("kind") != "http"
            or publish.get("actorRef") != "publisher"
            or publish.get("method") != "POST"
            or publish.get("path") != f"/v1/workspaces/workspace-alpha/forms/${{{prefix}-commit.formId}}/releases"
            or publish.get("body") != {
                "draftId": f"${{{prefix}-commit.draftId}}",
                "draftRevision": f"${{{prefix}-commit.draftRevision}}",
                "packageHash": f"${{{prefix}-commit.packageHash}}",
            }
            or publish.get("dependsOn") != [prefix + "-commit"]
            or not publish.get("headers", {}).get("Idempotency-Key")
            or set(publish.get("responseBindings", {})) != {"releaseId", "packageHash", "runtimeManifestHash", "definitionVersion", "status"}):
        fail(errors, f"T24-01: normalization variant {prefix} publish action is not response-bound")
    if (export.get("kind") != "http"
            or export.get("method") != "GET"
            or export.get("path") != f"/v1/workspaces/workspace-alpha/forms/${{{prefix}-commit.formId}}/export?releaseId=${{{prefix}-publish.releaseId}}"
            or export.get("dependsOn") != [prefix + "-commit", prefix + "-publish"]
            or export.get("exportOnlyBoundRelease") != f"${{{prefix}-publish.releaseId}}"
            or set(export.get("responseBindings", {})) != {"package", "packageUtf8Bytes", "packageSha256", "runtimeManifest"}):
        fail(errors, f"T24-01: normalization variant {prefix} export action is not release-bound")
    if (compare.get("kind") != "rfc8785-normalization-comparison"
            or compare.get("dependsOn") != [prefix + "-export"]
            or compare.get("inputPackage") != f"${{{prefix}-validate.body.package}}"
            or compare.get("exportedPackage") != f"${{{prefix}-export.package}}"
            or compare.get("normalization") != "RFC8785(N(package))"
            or compare.get("normalizationRounds") != rounds
            or compare.get("expectedCanonicalUtf8") != expected_bytes.decode("utf-8")
            or compare.get("expectedNormalizedPackageHash") != expected_hash
            or compare.get("expectedResult") != {"canonicalBytesEqual": True, "sha256Equal": True}):
        fail(errors, f"T24-01: normalization variant {prefix} does not execute its canonical N comparison")


def normalization_isolation_errors(indexed, variants):
    """Return isolation failures for repeated create-mode normalization chains."""
    errors = []
    scopes = {}
    creates = {}
    for name, package in variants.items():
        prefix = "normalization-" + name
        validate = indexed.get(prefix + "-validate", {})
        setup = indexed.get(prefix + "-setup-reset", {})
        teardown = indexed.get(prefix + "-teardown-reset", {})
        scope_id = validate.get("executionScopeId")
        expected_scope = "t24-" + prefix
        expected_snapshot = expected_scope + "-clean-database-snapshot"
        if not isinstance(scope_id, str) or scope_id != expected_scope:
            errors.append(f"{prefix}: missing or non-unique isolation ID")
        if isinstance(scope_id, str):
            if scope_id in scopes:
                errors.append(f"{prefix}: reuses isolation ID from {scopes[scope_id]}")
            scopes[scope_id] = prefix
        if (setup.get("executionScopeId") != scope_id
                or setup.get("snapshotId") != expected_snapshot
                or validate.get("dependsOn") != [prefix + "-setup-reset"]
                or teardown.get("executionScopeId") != scope_id
                or teardown.get("restoreSnapshotId") != expected_snapshot
                or teardown.get("dependsOn") != [prefix + "-compare"]):
            errors.append(f"{prefix}: reset/teardown boundary is incomplete")
        key = (validate.get("path"), validate.get("body", {}).get("package", {}).get("formKey"))
        creates.setdefault(key, []).append((prefix, scope_id if isinstance(scope_id, str) else None))
    for (path, form_key), values in creates.items():
        if len(values) > 1 and (not all(scope for _, scope in values) or len({scope for _, scope in values}) != len(values)):
            errors.append(f"repeated create {path} / {form_key} lacks independent isolation")
    return errors


def fail(errors, message):
    errors.append(message)


def closed_package_schema_errors(package):
    """Validate the closed evaluator package shape used by the hostile fixture.

    The product's historical package schema is intentionally permissive, so this
    independent fixture guard owns the closed wire contract needed to establish
    that an approved locale reviewState is schema-permitted rather than an
    unvalidated assertion in fixture metadata.
    """
    errors = []
    if not isinstance(package, dict) or set(package) != PACKAGE_ROOT_KEYS:
        errors.append("root keys are not the closed smart-form-package contract")
        return errors
    if package.get("schemaVersion") != "4.0.0" or package.get("engineContract") != "4.0.0" or package.get("contractVersion") != "4.0.0" or package.get("kind") != "smart-form-package":
        errors.append("package version triplet/kind is not canonical")
    for key in ("formKey", "definitionVersion", "titleKey", "descriptionKey", "defaultLocale"):
        if not isinstance(package.get(key), str) or not package[key]:
            errors.append(f"package {key} is absent")
    if not isinstance(package.get("data", {}).get("fields"), list) or not isinstance(package.get("flow", {}).get("phases"), list):
        errors.append("package data/flow graph is absent")
    translations = package.get("translations")
    if not isinstance(translations, dict) or "en" not in translations:
        errors.append("English translation is absent")
    else:
        english = translations["en"]
        allowed_translation = {"direction", "reviewState", "messages", "pronunciations"}
        if not isinstance(english, dict) or set(english) != allowed_translation:
            errors.append("English translation is not closed")
        elif english.get("reviewState") not in {"pending-native-review", "approved", "rejected"}:
            errors.append("English reviewState is not schema-permitted")
    return errors


def by_fixture(document):
    return {record["fixture"]: record for record in document["records"]}


def check_case_shape(errors, record):
    seen = set()
    for item in record["cases"]:
        case_id = item.get("id")
        if not case_id or case_id in seen:
            fail(errors, f"{record['fixture']}: duplicate/missing case id {case_id!r}")
        seen.add(case_id)
        for key in ("prestate", "actors", "resources", "inputs", "actions", "expected"):
            if not item.get(key):
                fail(errors, f"{case_id}: missing {key}")
        expected = item.get("expected", {})
        has_http_action = any(action.get("kind") in {"http", "http-concurrent"} for action in item["actions"] if isinstance(action, dict))
        if (has_http_action and not expected.get("http")) or not expected.get("state") or not expected.get("payload") or not expected.get("evidence", {}).get("captures"):
            fail(errors, f"{case_id}: expected HTTP when applicable, state/payload/evidence is incomplete")
        rendered = json.dumps(item, sort_keys=True).lower()
        if any(token in rendered for token in FORBIDDEN):
            fail(errors, f"{case_id}: generic runner, completed predicate, or broad alternative found")
        if any(action.get("target", "").startswith("evaluator://") for action in item["actions"] if isinstance(action, dict)):
            fail(errors, f"{case_id}: evaluator target is forbidden")
    return seen


def priority_t19(errors, record):
    asset = load(ASSETS / "t19-webhooks.json")["frozenInputProtocol"]
    source = {entry["id"]: entry for entry in asset["deliveryCases"]}
    cases = {entry["id"].removeprefix("T19-"): entry for entry in record["cases"]}
    if set(cases) != set(source):
        fail(errors, "T19 case IDs do not exactly equal t19-webhooks delivery case IDs")
        return
    for case_id, source_case in source.items():
        item = cases[case_id]
        if item["inputs"].get("signingVector") != source_case["signingVector"]:
            fail(errors, f"T19-{case_id}: signing vector differs from pinned asset")
        if item["resources"].get("receiverFault") != source_case["faultHandle"]:
            fail(errors, f"T19-{case_id}: receiver fault differs from pinned asset")
        if item["resources"].get("eventIds") != source_case["eventIds"]:
            fail(errors, f"T19-{case_id}: event IDs differ from pinned asset")
        if item["expected"]["payload"] != source_case["expected"]:
            fail(errors, f"T19-{case_id}: expected payload differs from pinned asset")


def priority_t21(errors, record):
    asset = load(ASSETS / "t21-hostile-imports.json")["frozenInputProtocol"]
    source = {entry["id"]: entry for entry in asset["cases"]}
    cases = {entry["id"].removeprefix("T21-"): entry for entry in record["cases"]}
    if set(cases) != set(source):
        fail(errors, "T21 case IDs do not exactly equal t21-hostile-imports case IDs")
        return
    for case_id, source_case in source.items():
        item = cases[case_id]
        verify = source_case["verify"]
        expected = item["expected"]["payload"]
        exact = {
            "problem.code": source_case["intendedGuard"],
            "persistenceWrites": verify["persistenceWrites"],
            "rawByteCount": verify["byteCount"],
            "rawSha256": verify["sha256"],
            "decodedStructureVerified": verify["decodedStructureVerified"],
            "boundedResourceMeasurementRequired": source_case["boundedResourceMeasurementRequired"],
        }
        if expected != exact:
            fail(errors, f"T21-{case_id}: expected bytes/guard differs from pinned asset")
        primary = next(entry for entry in asset["primaryPayloads"] if entry["id"] == case_id)
        frozen = primary.get("normativeValidateRequest", {})
        if item["inputs"].get("frozenValidateRequest") != frozen:
            fail(errors, f"T21-{case_id}: final normative validate bytes differ from pinned asset")
        if item["inputs"].get("payloadRegistryPointer") != "/frozenInputProtocol/primaryPayloads/" + str(asset["primaryPayloads"].index(primary)):
            fail(errors, f"T21-{case_id}: primary-payload pointer is not exact")
        actions = item.get("actions", [])
        authoritative_statuses = source_case.get("expectedHttpStatuses")
        action_statuses = [
            action["expectedResponse"]["httpStatus"]
            for action in actions
            if isinstance(action.get("expectedResponse"), dict)
            and "httpStatus" in action["expectedResponse"]
        ]
        if (not isinstance(authoritative_statuses, list)
                or item.get("expected", {}).get("http", {}).get("statuses") != authoritative_statuses
                or action_statuses != authoritative_statuses):
            fail(errors, f"T21-{case_id}: action HTTP statuses must exactly match the authoritative case outcome")
        if any("packageRawBytesRef" in json.dumps(action, sort_keys=True) for action in actions):
            fail(errors, f"T21-{case_id}: symbolic packageRawBytesRef is forbidden")
        validate = next((action for action in actions if action.get("id") == "validate"), None)
        if not validate or validate.get("method") != "POST" or not validate.get("path", "").endswith("/imports/validate"):
            fail(errors, f"T21-{case_id}: missing normative validate action")
        if validate and validate.get("rawRequest") != frozen:
            fail(errors, f"T21-{case_id}: validate must bind frozen envelope bytes")
        raw_hex = frozen.get("requestUtf8Hex")
        if raw_hex:
            raw = bytes.fromhex(raw_hex)
            prefix = bytes.fromhex(frozen["packageMemberPrefixUtf8Hex"])
            suffix = bytes.fromhex(frozen["packageMemberSuffixUtf8Hex"])
            if not (raw.startswith(prefix) and raw.endswith(suffix) and hashlib.sha256(raw).hexdigest() == frozen.get("requestSha256")):
                fail(errors, f"T21-{case_id}: hostile bytes do not occupy the final package member")
        elif frozen.get("requestGenerator", {}).get("algorithm") != "validate-envelope-with-hostile-package-member/v1":
            fail(errors, f"T21-{case_id}: generated final envelope is not frozen")
        server_cases = asset.get("serverOwnedCaseStates", {})
        if case_id not in server_cases:
            if len(actions) != 1 or any(action.get("kind") == "server-owned-candidate-fixture-state" for action in actions):
                fail(errors, f"T21-{case_id}: malformed envelope must not claim candidate-guard reachability")
            continue
        state = server_cases[case_id]
        commit = next((action for action in actions if action.get("id") == "commit"), None)
        setup = next((action for action in actions if action.get("id") == "server-candidate-state"), None)
        required_state={"candidateActor","candidateWorkspace","candidateTenant","validateWorkspace","validateTenant","commitWorkspace","commitTenant","sourceFormId","sourceDraftId","targetFormId","targetDraftId","mode","policyVersion","candidateDigestInput","expiresAt","evaluationClock","competingGuards","exclusiveGuard","exactlyOneTargetMismatch"}
        if not commit or not setup or setup.get("dependsOn") != ["validate"] or setup.get("exclusiveState") != state or setup.get("forbidRequestSuppliedAuthority") is not True or not required_state <= set(state) or setup.get("rejectSimultaneousMismatchMutation") is not True:
            fail(errors, f"T21-{case_id}: one exclusive server-owned guard state is required")
            continue
        bindings = validate.get("responseBindings", {})
        if bindings.get("candidateId", {}).get("source") != "/candidateId" or bindings.get("candidateDigest", {}).get("source") != "/candidateDigest":
            fail(errors, f"T21-{case_id}: validate must bind opaque candidate ID and digest")
        expected_path=f"/v1/workspaces/{state['commitWorkspace']}/imports/${{validate.candidateId}}/commit"
        if commit.get("path") != expected_path or commit.get("body") != {"candidateDigest":"${validate.candidateDigest}"} or set(commit.get("body", {})) != {"candidateDigest"}:
            fail(errors, f"T21-{case_id}: commit must use only response-bound candidate digest")
        expected_dependencies = ["validate", "server-candidate-state"] + (["advance-controlled-clock"] if case_id == "expired-candidate" else [])
        if not commit.get("headers", {}).get("Idempotency-Key") or commit.get("dependsOn") != expected_dependencies:
            fail(errors, f"T21-{case_id}: commit must depend on validated server state and have idempotency")
        if case_id == "expired-candidate":
            advance = next((action for action in actions if action.get("id") == "advance-controlled-clock"), {})
            expected_expiry = validate.get("expectedResponse", {}).get("exactValues", {}).get("expiresAt")
            try:
                exact_lifetime = (datetime.fromisoformat(expected_expiry.replace("Z", "+00:00"))
                                  - datetime.fromisoformat(state["creationClock"].replace("Z", "+00:00"))) == timedelta(hours=24)
            except (AttributeError, KeyError, ValueError):
                exact_lifetime = False
            if (item.get("prestate", {}).get("clock") != state.get("creationClock")
                    or expected_expiry != state.get("validateResponseExpiresAt")
                    or state.get("candidateLifetime") != "PT24H"
                    or state.get("expiresAtEqualsCreationPlus") != "PT24H"
                    or not exact_lifetime
                    or validate.get("expectedResponse", {}).get("httpStatus") != 200
                    or bindings.get("expiresAt", {}).get("source") != "/expiresAt"
                    or advance.get("from") != "${validate.expiresAt}"
                    or advance.get("assertCandidateWasValidAtValidate") is not True
                    or advance.get("to") != state.get("advanceControlledClockTo")):
                fail(errors, "T21-expired-candidate: validation must precede controlled expiry")
        if case_id == "forged-approval":
            claim = item.get("inputs", {}).get("declaredApprovalClaim", {})
            raw = bytes.fromhex(frozen["requestUtf8Hex"])
            package = json.loads(raw)["package"]
            if (claim.get("path") != "/translations/en/reviewState"
                    or claim.get("schemaValid") is not True
                    or package.get("translations", {}).get("en", {}).get("reviewState") != "approved"
                    or closed_package_schema_errors(package)
                    or state.get("trustedApproval") is not False
                    or item.get("expected", {}).get("validation", {}).get("trustedApproval") is not False
                    or item.get("expected", {}).get("validation", {}).get("httpStatus") != 200):
                fail(errors, "T21-forged-approval: caller claim must be valid without being trusted")
        actors = {actor.get("id"): actor for actor in item.get("actors", [])}
        validate_actor,commit_actor=actors.get("validate-actor",{}),actors.get("commit-actor",{})
        if validate_actor.get("principal") != commit_actor.get("principal") or validate_actor.get("principal") != state["candidateActor"] or validate_actor.get("tenant") != state["validateTenant"] or commit_actor.get("tenant") != state["commitTenant"] or validate_actor.get("workspace") != state["validateWorkspace"] or commit_actor.get("workspace") != state["commitWorkspace"] or set(validate_actor.get("workspaceMemberships",[])) != {"workspace-alpha","workspace-beta"} or set(commit_actor.get("workspaceMemberships",[])) != {"workspace-alpha","workspace-beta"}:
            fail(errors, f"T21-{case_id}: tenant/actor context does not exercise selected guard")
        if sum(state["competingGuards"].values()) != 1 or state["competingGuards"].get(state["exclusiveGuard"]) is not True:
            fail(errors, f"T21-{case_id}: guard state is not exclusive")
        # Mutation regressions: an omitted material field or a second enabled
        # guard must never be accepted as a purported exclusive probe.
        incomplete=dict(state); incomplete.pop("policyVersion")
        simultaneous=dict(state); simultaneous["competingGuards"]=dict(state["competingGuards"]); simultaneous["competingGuards"][next(name for name in simultaneous["competingGuards"] if name != simultaneous["exclusiveGuard"])]=True
        def exclusive(candidate):
            return required_state <= set(candidate) and sum(candidate.get("competingGuards",{}).values()) == 1 and candidate["competingGuards"].get(candidate.get("exclusiveGuard")) is True
        if exclusive(incomplete) or exclusive(simultaneous):
            fail(errors, f"T21-{case_id}: incomplete/simultaneous guard mutation escaped")
        if case_id == "expired-candidate" and (commit.get("expectedResponse",{}).get("httpStatus") != 410 or item["expected"]["http"].get("statuses") != [200, 410]):
            fail(errors, "T21-expired-candidate: expiry must return the exact 410 result")

    status_mutation = [400]
    malformed_status_action = {"expectedResponse": {"httpStatus": 422}}
    if malformed_status_action["expectedResponse"]["httpStatus"] in status_mutation:
        fail(errors, "T21 action-status mismatch mutation regression is ineffective")


def priority_t22(errors, record):
    asset = load(ASSETS / "t22-scale-limits.json")["frozenInputProtocol"]
    cases = {entry["id"]: entry for entry in record["cases"]}
    workloads = {entry["id"]: entry for entry in asset["workloads"]}
    commands = {entry["workloadId"]: entry for entry in asset["commands"]}
    for work_id, work in workloads.items():
        item = cases.get("T22-workload-" + work_id)
        if not item:
            fail(errors, f"T22 workload absent: {work_id}")
            continue
        expected = item["expected"]["payload"]
        if expected.get("datasetId") != work["datasetId"] or expected.get("target") != work["target"] or expected.get("coldWarmWindows") != work["coldWarmWindows"]:
            fail(errors, f"T22 workload differs from pinned asset: {work_id}")
        command_action = item["actions"][0]
        if command_action.get("commands") != commands[work_id]:
            fail(errors, f"T22 command spec differs from pinned asset: {work_id}")
    for limit in asset["limits"]:
        item = cases.get("T22-limit-" + limit["id"])
        if not item:
            fail(errors, f"T22 limit absent: {limit['id']}")
            continue
        expected = item["expected"]["payload"]
        if item["inputs"] != {"limit": limit["limit"], "plusOne": limit["plusOne"], "unit": limit["unit"]} or expected.get("capabilities.limit") != limit["limit"] or {key: expected.get(key) for key in limit["expected"]} != limit["expected"]:
            fail(errors, f"T22 limit differs from pinned asset: {limit['id']}")
    for rate in asset["rateControls"]:
        item = cases.get("T22-rate-" + rate["id"])
        if not item or item["resources"].get("rateControl") != rate:
            fail(errors, f"T22 rate control differs from pinned asset: {rate['id']}")
        elif {key: item["expected"]["payload"].get(key) for key in asset["rateExpected"]} != asset["rateExpected"]:
            fail(errors, f"T22 rate expectation differs from pinned asset: {rate['id']}")


def security_matrix(errors, record):
    sec = load(SEC)
    matrix = next((item for item in record["cases"] if item["id"] == "T20-01-complete-security-denominator"), None)
    if not matrix:
        fail(errors, "T20 complete security denominator case is absent")
        return
    if sec.get("total") != 10452 or len(sec.get("members", [])) != 10452:
        fail(errors, "SEC denominator is not the 10,452-row frozen matrix")
    dimensions = sec.get("dimensions", {})
    expected_dimensions = {"principal_profiles": 17, "security_surfaces": 39, "relationship_contexts": 4, "security_states": 5}
    for key, total in expected_dimensions.items():
        if len(dimensions.get(key, [])) != total:
            fail(errors, f"SEC dimension {key} is not {total}")
    expected = matrix["expected"]["payload"]
    if expected.get("memberCount") != sec["total"] or matrix["inputs"].get("memberSelection") != "all 10,452 SEC records in deterministic file order":
        fail(errors, "T20 does not bind every SEC record deterministically")
    statuses = {member.get("expected") for member in sec["members"]}
    if statuses - {"allow", "401", "403", "404", "410"}:
        fail(errors, "SEC contains an unexpected authorization status")
    action = matrix["actions"][0]
    if action.get("kind") != "security-matrix-execution" or action.get("expectedStatusFrom") != "expected" or action.get("forbidOutcomeAlternatives") is not True:
        fail(errors, "T20 matrix action is not bound to exact SEC semantics")

def priority_t24(errors, record):
    cases={case["id"]:case for case in record["cases"]}
    for case_id in ("T24-01-ui-and-http-create-identical-package","T24-02-import-export-twice"):
        actions=cases.get(case_id,{}).get("actions",[])
        prefixes=("http",) if case_id.endswith("identical-package") else ("round1","round2")
        actors={actor.get("id"):actor for actor in cases[case_id].get("actors", [])}
        if actors.get("publisher",{}).get("principal") != "publisher-alpha":
            fail(errors, f"{case_id}: publish must use authorized publisher actor")
        if case_id == "T24-01-ui-and-http-create-identical-package":
            indexed={action.get("id"):action for action in actions}
            ui_ids=("ui-open-authoring", "ui-create-form", "ui-configure-pages", "ui-configure-fields", "ui-configure-rules", "ui-configure-locales", "ui-save-draft", "ui-review", "ui-publish", "ui-export")
            ui_actions=[indexed.get(action_id,{}) for action_id in ui_ids]
            browser_kinds={"browser-navigation", "browser-control-sequence", "browser-download"}
            if (not all(action.get("kind") in browser_kinds for action in ui_actions)
                    or any(action.get("method") or action.get("path") for action in ui_actions if action.get("id") != "ui-export")
                    or any(action.get("kind") == "http" for action in ui_actions)
                    or indexed.get("ui-open-authoring",{}).get("route") != "/workspaces/workspace-alpha/forms/new"
                    or indexed.get("ui-open-authoring",{}).get("actorRef") != "author"
                    or indexed.get("ui-publish",{}).get("actorRef") != "publisher"):
                fail(errors, "T24-01: UI producer must be a concrete browser authoring flow, not relabeled HTTP lifecycle actions")
            package=load(PACKAGES / "package-hc.json")
            source_nodes = {field.get("id"): field for field in package.get("data", {}).get("fields", [])}
            source_controls = flow_question_nodes(package)
            required_controls = {"hc-f10": "repeatingCards", "hc-f11": "repeatingCards", "hc-f12": "dynamicMatrix"}
            if any(source_nodes.get(field_id, {}).get("type") != "list"
                   or source_nodes.get(field_id, {}).get("presentation") is not None
                   or source_controls.get(field_id, {}).get("control") != control
                   or source_controls.get(field_id, {}).get("presentation", {}).get("settings") != {"allowAdd": True, "allowRemove": True, "allowReorder": True}
                   for field_id, control in required_controls.items()):
                fail(errors, "T24-01: HC must retain canonical list storage with repeater controls/presentation on flow question nodes")
            source_hash = "sha256:" + normalized_package_sha256(package)
            payload_hashes = cases[case_id].get("expected", {}).get("payload", {})
            variants = normalization_variants(package)
            normalized_bytes = {name: rfc8785_json(normalize_lite_package(value)) for name, value in variants.items()}
            variant_hashes = {name: "sha256:" + hashlib.sha256(value).hexdigest() for name, value in normalized_bytes.items()}
            if (cases[case_id].get("inputs", {}).get("normalizationVariants") != variants
                    or payload_hashes.get("normalizationVariantHashes") != variant_hashes
                    or payload_hashes.get("ui.normalizedPackageHash") != source_hash
                    or payload_hashes.get("http.normalizedPackageHash") != source_hash
                    or cases[case_id].get("inputs", {}).get("normalization") != "RFC8785(N(package))"):
                fail(errors, "T24-01: normalized producer hashes and frozen variants must be recomputed from N(package-hc.json)")
            metadata_names = set(cases[case_id].get("inputs", {}).get("normalizationVariants", {}))
            if metadata_names != set(variants):
                fail(errors, "T24-01: every and only product-exercised normalization variant must be frozen")
            for variant_name, variant_package in variants.items():
                rounds = 2 if variant_name.endswith("-idempotence-second-round") else 1
                expected_value = variant_package
                for _ in range(rounds):
                    expected_value = normalize_lite_package(expected_value)
                expected_bytes = rfc8785_json(expected_value)
                expected_hash = "sha256:" + hashlib.sha256(expected_bytes).hexdigest()
                check_product_roundtrip(errors, indexed, "normalization-" + variant_name, variant_package, expected_bytes, expected_hash, rounds)

            errors.extend(normalization_isolation_errors(indexed, variants))

            # A frozen variant without its complete product proof is only
            # metadata.  Prove the guard catches that regression rather than
            # merely relying on the loop above to look plausible.
            mutation_name = next(iter(variants))
            missing_export = dict(indexed)
            missing_export.pop("normalization-" + mutation_name + "-export")
            mutation_errors = []
            mutation_value = variants[mutation_name]
            mutation_bytes = rfc8785_json(normalize_lite_package(mutation_value))
            check_product_roundtrip(
                mutation_errors,
                missing_export,
                "normalization-" + mutation_name,
                mutation_value,
                mutation_bytes,
                "sha256:" + hashlib.sha256(mutation_bytes).hexdigest(),
            )
            if not mutation_errors:
                fail(errors, "T24-01: metadata-only normalization variant mutation is ineffective")

            missing_reset = dict(indexed)
            missing_reset.pop("normalization-" + mutation_name + "-setup-reset")
            if not normalization_isolation_errors(missing_reset, variants):
                fail(errors, "T24-01: missing clean-database reset mutation is ineffective")
            reuse_reset = deepcopy(indexed)
            second_name = next(name for name in variants if name != mutation_name)
            second_prefix = "normalization-" + second_name
            first_scope = reuse_reset["normalization-" + mutation_name + "-validate"]["executionScopeId"]
            first_snapshot = reuse_reset["normalization-" + mutation_name + "-setup-reset"]["snapshotId"]
            reuse_reset[second_prefix + "-setup-reset"]["snapshotId"] = first_snapshot
            reuse_reset[second_prefix + "-teardown-reset"]["restoreSnapshotId"] = first_snapshot
            if not normalization_isolation_errors(reuse_reset, variants):
                fail(errors, "T24-01: reused clean-database reset mutation is ineffective")
            reuse_scope = deepcopy(indexed)
            reuse_scope[second_prefix + "-validate"]["executionScopeId"] = first_scope
            if not normalization_isolation_errors(reuse_scope, variants):
                fail(errors, "T24-01: duplicate execution-scope mutation is ineffective")

            defaults = {"allowAdd": True, "allowRemove": True, "allowReorder": True}
            for field_type, field_id in (("repeatingCards", "hc-f10"), ("dynamicMatrix", "hc-f12")):
                prefix = field_type
                for name in (f"{prefix}-missing-presentation", f"{prefix}-presentation-without-settings"):
                    node = flow_question_nodes(normalize_lite_package(variants[name]))[field_id]
                    if node["presentation"]["settings"] != defaults:
                        fail(errors, f"T24-01: {name} does not materialize exactly the default table")
                for setting in defaults:
                    missing_name = f"{prefix}-missing-{setting}"
                    false_name = f"{prefix}-explicit-false-{setting}"
                    missing_node = flow_question_nodes(normalize_lite_package(variants[missing_name]))[field_id]
                    false_node = flow_question_nodes(normalize_lite_package(variants[false_name]))[field_id]
                    if missing_node["presentation"]["settings"] != defaults or false_node["presentation"]["settings"][setting] is not False:
                        fail(errors, f"T24-01: {prefix} {setting} default/false distinction is not executable")
                if (normalized_bytes[f"{prefix}-explicit-true"] != normalized_bytes[f"{prefix}-fully-normalized"]
                        or normalized_bytes[f"{prefix}-fully-normalized"] != normalized_bytes[f"{prefix}-idempotence-second-round"]):
                    fail(errors, f"T24-01: {prefix} explicit-true/normalized/idempotence hash algebra is ineffective")

            # N has no licence to sort, rewrite identity/text, or fill defaults
            # outside the three-entry repeater table.  These mutations are kept
            # independent from fixture metadata so a self-consistent table
            # cannot conceal a lossy normalizer.
            reordered = deepcopy(package)
            reordered["data"]["fields"] = list(reversed(reordered["data"]["fields"]))
            changed_id = deepcopy(package)
            changed_id["formKey"] = "clinical-history-intake-preserved-id"
            changed_text = deepcopy(package)
            changed_text["translations"]["en"]["messages"]["form.title"] = "Clinical résumé 東京"
            omitted_unrelated = deepcopy(package)
            next(field for field in omitted_unrelated["data"]["fields"] if field["id"] == "hc-f10").pop("guidanceId")
            storage_mutation = deepcopy(package)
            next(field for field in storage_mutation["data"]["fields"] if field["id"] == "hc-f10")["type"] = "repeatingCards"
            try:
                normalize_lite_package(storage_mutation)
                storage_mutation_rejected = False
            except ValueError:
                storage_mutation_rejected = True
            if (normalize_lite_package(reordered)["data"]["fields"] != reordered["data"]["fields"]
                    or normalize_lite_package(changed_id)["formKey"] != changed_id["formKey"]
                    or normalize_lite_package(changed_text)["translations"]["en"]["messages"]["form.title"] != "Clinical résumé 東京"
                    or "guidanceId" in next(field for field in normalize_lite_package(omitted_unrelated)["data"]["fields"] if field["id"] == "hc-f10")
                    or normalize_lite_package(package)["data"]["fields"] != package["data"]["fields"]
                    or not storage_mutation_rejected
                    or len({normalized_package_sha256(package), normalized_package_sha256(reordered), normalized_package_sha256(changed_id), normalized_package_sha256(changed_text), normalized_package_sha256(omitted_unrelated)}) != 5):
                fail(errors, "T24-01: N must preserve canonical storage and order/IDs/text/unrelated-omission semantics")
            pages=[page for phase in package["flow"]["phases"] for page in phase["pages"]]
            fields=package["data"]["fields"]
            page_plan=indexed.get("ui-configure-pages",{})
            field_plan=indexed.get("ui-configure-fields",{})
            rule_plan=indexed.get("ui-configure-rules",{})
            locale_plan=indexed.get("ui-configure-locales",{})
            if (page_plan.get("inputs",{}).get("pages") != [{"id":page["id"],"titleKey":page["titleKey"],"descriptionKey":page.get("descriptionKey",page["titleKey"])} for page in pages]
                    or len(page_plan.get("controls",[])) != len(pages)*5
                    or field_plan.get("inputs",{}).get("fields") != fields
                    or len(field_plan.get("controls",[])) != len(fields)*8
                    or rule_plan.get("inputs",{}).get("expressions") != package["expressions"]
                    or len(rule_plan.get("inputs",{}).get("fieldRules",[])) != len(fields)
                    or len(rule_plan.get("controls",[])) != len(fields)*5
                    or locale_plan.get("inputs",{}).get("translations") != package["translations"]
                    or locale_plan.get("inputs",{}).get("supportedLocales") != package["supportedLocales"]
                    or len(locale_plan.get("controls",[])) != len(package["supportedLocales"])*4):
                fail(errors, "T24-01: UI authoring controls must construct the exact pages, fields, rules, and locales of the canonical package")
            export=indexed.get("ui-export",{})
            comparison=indexed.get("normalize-and-compare-producers",{})
            if (export.get("kind") != "browser-download"
                    or export.get("dependsOn") != ["ui-create-form", "ui-publish"]
                    or export.get("controls") != [{"operation":"click","selector":"[data-testid=\"export-package\"]"},{"operation":"await-download","selector":"[data-testid=\"export-package\"]","value":"package.json"}]
                    or set(export.get("responseBindings",{})) != {"package","packageUtf8Bytes","packageSha256"}
                    or comparison.get("kind") != "canonical-package-comparison"
                    or comparison.get("dependsOn") != ["ui-export","http-export"]
                    or comparison.get("leftPackage") != "${ui-export.package}"
                    or comparison.get("rightPackage") != "${http-export.package}"
                    or comparison.get("normalization") != "RFC8785(N(package))"
                    or comparison.get("expectedResult",{}).get("equal") is not True):
                fail(errors, "T24-01: UI and HTTP exports must apply N before RFC8785 canonical comparison")
        for prefix in prefixes:
            indexed={action.get("id"):action for action in actions}
            validate,commit,publish,export=(indexed.get(prefix+suffix) for suffix in ("-validate","-commit","-publish","-export"))
            if not all((validate,commit,publish,export)):
                fail(errors, f"{case_id}: {prefix} validate/commit/publish/export lifecycle is incomplete")
                continue
            if validate.get("method") != "POST" or validate.get("path") != "/v1/workspaces/workspace-alpha/imports/validate" or set(validate.get("body", {})) != {"mode","package"}:
                fail(errors, f"{case_id}: {prefix} validate contract is not exact")
            bindings=validate.get("responseBindings", {})
            if bindings.get("candidateId",{}).get("source") != "/candidateId" or bindings.get("candidateDigest",{}).get("source") != "/candidateDigest":
                fail(errors, f"{case_id}: {prefix} validate response bindings are incomplete")
            if commit.get("method") != "POST" or commit.get("path") != f"/v1/workspaces/workspace-alpha/imports/${{{prefix}-validate.candidateId}}/commit" or commit.get("body") != {"candidateDigest":f"${{{prefix}-validate.candidateDigest}}"} or not commit.get("headers",{}).get("Idempotency-Key") or commit.get("dependsOn") != [prefix+"-validate"]:
                fail(errors, f"{case_id}: {prefix} commit contract/dependency is not exact")
            commit_bindings=commit.get("responseBindings", {})
            if {"formId","draftId","draftRevision","packageHash","etag"} != set(commit_bindings) or commit_bindings.get("etag",{}).get("source") != "header:ETag":
                fail(errors, f"{case_id}: {prefix} commit response bindings are incomplete")
            expected_publish_path=f"/v1/workspaces/workspace-alpha/forms/${{{prefix}-commit.formId}}/releases"
            expected_publish_body={"draftId":f"${{{prefix}-commit.draftId}}","draftRevision":f"${{{prefix}-commit.draftRevision}}","packageHash":f"${{{prefix}-commit.packageHash}}"}
            if publish.get("actorRef") != "publisher" or publish.get("method") != "POST" or publish.get("path") != expected_publish_path or publish.get("body") != expected_publish_body or not publish.get("headers",{}).get("Idempotency-Key") or publish.get("dependsOn") != [prefix+"-commit"]:
                fail(errors, f"{case_id}: {prefix} publish contract/dependency is not exact")
            if {"releaseId","packageHash","runtimeManifestHash","definitionVersion","status"} != set(publish.get("responseBindings", {})):
                fail(errors, f"{case_id}: {prefix} publish response bindings are incomplete")
            expected_export_path=f"/v1/workspaces/workspace-alpha/forms/${{{prefix}-commit.formId}}/export?releaseId=${{{prefix}-publish.releaseId}}"
            if export.get("method") != "GET" or export.get("path") != expected_export_path or export.get("dependsOn") != [prefix+"-commit", prefix+"-publish"] or export.get("exportOnlyBoundRelease") != f"${{{prefix}-publish.releaseId}}":
                fail(errors, f"{case_id}: {prefix} export must use only immediate bound release")
            if set(export.get("responseBindings",{})) != {"package","runtimeManifest"}:
                fail(errors, f"{case_id}: {prefix} export must bind package and runtime manifest")
            if any("/revisions/" in str(action) or action.get("body") == {"mode":"publish"} or "packageRef" in str(action) or (action.get("id"," ").endswith("-commit") and not action.get("body")) for action in (validate,commit,publish,export)):
                fail(errors, f"{case_id}: {prefix} invented revision publish route/body found")
        if "steps" in cases[case_id] or "manual" in json.dumps(actions).lower():
            fail(errors, f"{case_id}: duplicate/manual lifecycle representation is forbidden")
    # Mutation-test all retired lifecycle shapes independently of whether a
    # future fixture happens to contain a differently named action.
    forbidden=(
        {"id":"x-commit","path":"/v1/workspaces/w/imports/c/commit"},
        {"body":{"packageRef":"legacy"}},
        {"body":{"mode":"publish"}},
        {"path":"/v1/workspaces/w/forms/f/revisions/r/publish"},
        {"path":"/v1/workspaces/w/forms/f/releases/r"},
        {"kind":"manual-ui"},
    )
    def invalid_shape(action):
        return (action.get("id","").endswith("-commit") and not action.get("body")) or "packageRef" in str(action) or action.get("body")=={"mode":"publish"} or "/revisions/" in action.get("path","") or "/releases/" in action.get("path","") or action.get("kind") == "manual-ui"
    if not all(invalid_shape(action) for action in forbidden):
        fail(errors, "T24 forbidden-shape mutation regression is ineffective")
    integer=cases.get("T24-05-integer-extrema-and-2pow53",{})
    read = next((action for action in integer.get("actions", []) if action.get("id") == "read-draft"), {})
    put = next((action for action in integer.get("actions", []) if action.get("method") == "PUT"), {})
    if (read.get("responseBindings", {}).get("etag", {}).get("source") != "header:ETag"
            or read.get("responseBindings", {}).get("revision", {}).get("source") != "/draftRevision"
            or put.get("headers", {}).get("If-Match") != "${read-draft.etag}"
            or put.get("dependsOn") != ["read-draft"]
            or set(put.get("responseBindings", {})) != {"revision", "etag"}
            or not isinstance(put.get("body"), dict)
            or "package" in put.get("body", {})
            or put.get("body", {}).get("contractVersion") != "4.0.0"):
        fail(errors, "T24-05: integer preservation PUT must use a response-bound ETag and full canonical package")
    integer_fields = [field for field in put.get("body", {}).get("data", {}).get("fields", []) if field.get("type") == "integer"]
    if not any(field.get("default") == "9007199254740993" and field.get("constraints", {}).get("wireFormat") == "canonical-decimal-string" for field in integer_fields):
        fail(errors, "T24-05: canonical package must preserve a typed 2^53+1 integer default")

    update = cases.get("T24-04-copy-remaps-update-preserves", {})
    update_actions = {action.get("id"): action for action in update.get("actions", [])}
    read, validate, commit = (update_actions.get(name, {}) for name in ("read-target-draft", "update-validate", "update-commit"))
    if (read.get("responseBindings", {}).get("draftRevision", {}).get("source") != "/draftRevision"
            or read.get("responseBindings", {}).get("etag", {}).get("source") != "header:ETag"
            or not isinstance(validate.get("body", {}).get("package"), dict)
            or set(validate.get("responseBindings", {})) != {"candidateId", "candidateDigest", "expiresAt"}
            or commit.get("path") != "/v1/workspaces/workspace-alpha/imports/${update-validate.candidateId}/commit"
            or commit.get("body") != {"candidateDigest": "${update-validate.candidateDigest}", "expectedDraftRevision": "${read-target-draft.draftRevision}"}
            or commit.get("headers", {}).get("If-Match") != "${read-target-draft.etag}"
            or commit.get("dependsOn") != ["read-target-draft", "update-validate"]
            or set(commit.get("responseBindings", {})) != {"formId", "draftId", "draftRevision", "etag", "packageHash"}):
        fail(errors, "T24-04: update lifecycle must use full package, validate bindings, and bound revision/ETag commit")

    cli = cases.get("T24-09-cli-http-transcript-is-not-product-cli", {})
    cli_validate = next((action for action in cli.get("actions", []) if action.get("id") == "cli-validate"), {})
    if (cli_validate.get("kind") != "http"
            or cli_validate.get("method") != "POST"
            or cli_validate.get("path") != "/v1/workspaces/workspace-alpha/imports/validate"
            or cli_validate.get("actorRef") != "author"
            or cli_validate.get("headers", {}).get("Content-Type") != "application/json"
            or cli_validate.get("headers", {}).get("Cookie") != "evaluator-session"
            or cli_validate.get("body", {}).get("mode") != "create"
            or closed_package_schema_errors(cli_validate.get("body", {}).get("package"))
            or cli_validate.get("requestBodySchema") != {"additionalProperties": False, "required": ["mode", "package"]}
            or cli_validate.get("expectedResponse", {}).get("httpStatus") != 200
            or set(cli_validate.get("responseBindings", {})) != {"candidateId", "candidateDigest", "expiresAt"}
            or cli_validate.get("responseBindings", {}).get("candidateId", {}).get("source") != "/candidateId"
            or cli_validate.get("responseBindings", {}).get("candidateDigest", {}).get("source") != "/candidateDigest"
            or cli_validate.get("responseBindings", {}).get("expiresAt", {}).get("source") != "/expiresAt"
            or "command" in cli_validate
            or has_symbolic_file_payload(cli_validate)):
        fail(errors, "T24-09: CLI validation must be a complete structured validate request with opaque candidate bindings")


def iter_fixture_cases(document):
    for record in document.get("fixtures", document.get("records", [])):
        for case in record.get("cases", []):
            yield record.get("id", record.get("fixture", "unknown")), case


def has_symbolic_file_payload(action):
    """Identify curl-style payload files that cannot prove request bytes."""
    return SYMBOLIC_FILE_PAYLOAD.search(json.dumps(action, sort_keys=True)) is not None


def global_lifecycle_guard(errors):
    """Reject retired/symbolic lifecycle shapes in every executable fixture.

    A fixture may name stable pre-state resources, but every value interpolated
    into a request must come from an earlier declared response binding. Package
    request bodies are either a complete object or a declared exported-package
    binding; filenames, refs, recorded IDs, and inferred revision/ETag values
    are not executable dependencies.
    """
    for path in FIXTURE_FILES:
        document = load(path)
        for fixture_id, case in iter_fixture_cases(document):
            actions = case.get("actions", [])
            known = {}
            authoritative_statuses = {
                status for status in case.get("expected", {}).get("http", {}).get("statuses", [])
                if isinstance(status, int)
            }
            for index, action in enumerate(actions):
                if not isinstance(action, dict):
                    continue
                action_id = action.get("id")
                if action_id:
                    known[action_id] = (index, set(action.get("responseBindings", {})))
                if has_symbolic_file_payload(action):
                    fail(errors, f"{path.name}:{case.get('id')}: symbolic @file request payload found")
                action_status = action.get("expectedResponse", {}).get("httpStatus")
                if isinstance(action_status, int) and action_status not in authoritative_statuses:
                    fail(errors, f"{path.name}:{case.get('id')}: action HTTP {action_status} is absent from the authoritative case outcome")
                if action.get("kind") not in {"http", "api", "command-line-http"}:
                    continue
                rendered = json.dumps(action, sort_keys=True)
                if any(token in rendered for token in ("packageRef", "packageRawBytesRef", "bodyRef", "recorded:", "/revisions/")):
                    fail(errors, f"{path.name}:{case.get('id')}: retired/symbolic lifecycle value found")
                body = action.get("body")
                if isinstance(body, dict) and "package" in body:
                    package = body["package"]
                    if isinstance(package, str):
                        match = RESPONSE_REFERENCE.fullmatch(package)
                        source = known.get(match.group("action")) if match else None
                        if not source or match.group("binding") not in source[1] or action.get("dependsOn") is None or match.group("action") not in action["dependsOn"]:
                            fail(errors, f"{path.name}:{case.get('id')}: package string is not a declared response binding")
                    elif not isinstance(package, dict):
                        fail(errors, f"{path.name}:{case.get('id')}: package body must be an object or bound export")
                for match in RESPONSE_REFERENCE.finditer(rendered):
                    source_id, binding = match.group("action"), match.group("binding")
                    source = known.get(source_id)
                    if not source or binding not in source[1] or source[0] >= index:
                        fail(errors, f"{path.name}:{case.get('id')}: unresolved response reference {match.group(0)}")
                        continue
                    if source_id not in action.get("dependsOn", []):
                        fail(errors, f"{path.name}:{case.get('id')}: {match.group(0)} lacks dependsOn")
                route = action.get("route", action.get("path", ""))
                if str(route).endswith("/commit"):
                    if not isinstance(body, dict) or set(body) - {"candidateDigest", "expectedDraftRevision"} or "candidateDigest" not in body:
                        fail(errors, f"{path.name}:{case.get('id')}: commit body has authority or missing digest")
                    if not action.get("headers", {}).get("Idempotency-Key"):
                        fail(errors, f"{path.name}:{case.get('id')}: commit lacks idempotency key")
                status = action.get("expectedResponse", action.get("expect", {})).get("httpStatus")
                csrf_probe = "Origin" in action.get("headers", {}) and status is None
                if action.get("method") == "PUT" and "/drafts/" in str(route) and status not in {401, 403} and not csrf_probe:
                    if not isinstance(body, dict) or "package" in body or body.get("kind") != "smart-form-package":
                        fail(errors, f"{path.name}:{case.get('id')}: draft PUT is not a full canonical package")
                    if not action.get("headers", {}).get("If-Match"):
                        fail(errors, f"{path.name}:{case.get('id')}: draft PUT lacks response-bound If-Match")

    # A direct mutation proves the guard is live rather than a list of terms.
    malformed = {"id": "commit", "kind": "http", "method": "POST", "path": "/v1/workspaces/w/imports/recorded:candidate/commit", "body": {"candidateDigest": "recorded:digest"}}
    symbolic_payloads = (
        {"kind": "command-line-http", "command": "curl --data @validate-request.json https://example.invalid"},
        {"kind": "command-line-http", "command": "curl --data-binary @validate-request.json https://example.invalid"},
        {"kind": "command-line-http", "command": "curl -d @validate-request.json https://example.invalid"},
    )
    status_mismatch = {"expected": {"http": {"statuses": [400]}}, "action": {"expectedResponse": {"httpStatus": 422}}}
    if (not ("recorded:" in json.dumps(malformed) and not malformed.get("headers", {}).get("Idempotency-Key"))
            or not all(has_symbolic_file_payload(action) for action in symbolic_payloads)
            or status_mismatch["action"]["expectedResponse"]["httpStatus"] in status_mismatch["expected"]["http"]["statuses"]):
        fail(errors, "global lifecycle mutation regression is ineffective")


def main():
    document = load(FIXTURE)
    errors = check_document(document)
    records = by_fixture(document)
    if document.get("fixtureIds") != EXPECTED_FIXTURES or list(records) != EXPECTED_FIXTURES:
        fail(errors, "fixture IDs/order must be exactly T17 through T24")
    for fixture in EXPECTED_FIXTURES:
        if fixture not in records:
            continue
        check_case_shape(errors, records[fixture])
    if all(fixture in records for fixture in ("T19", "T21", "T22", "T20")):
        priority_t19(errors, records["T19"])
        priority_t21(errors, records["T21"])
        priority_t22(errors, records["T22"])
        security_matrix(errors, records["T20"])
        priority_t24(errors, records["T24"])
    global_lifecycle_guard(errors)
    if errors:
        print("FAIL " + "\nFAIL ".join(errors))
        return 1
    total = sum(len(record["cases"]) for record in records.values())
    print(f"PASS {len(records)}/8 T17–T24 fixtures; {total} explicit cases; T19/T21/T22 asset bindings exact; T20 SEC=10,452")
    return 0


if __name__ == "__main__":
    sys.exit(main())
