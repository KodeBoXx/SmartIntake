#!/usr/bin/env python3
"""Validate the isolated, not-run T25–T32 evaluator oracle without product access."""
from __future__ import annotations

import copy
import hashlib
import json
import pathlib
import sys
from typing import Any

from check_fixture_routes import check_document

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORACLE = pathlib.Path(__file__).with_name("t25-t32.json")
EXPECTED_FIXTURES = [f"T{number}" for number in range(25, 33)]
EXPECTED_CASES = {
    "T25": {"T25-ORIENTATION-AND-ALLOCATION", "T25-AUTHOR-SCRIPT-AND-SCORING", "T25-RESPONDENT-SCRIPT-AND-CRITICAL-MEANING"},
    "T26": {"T26-HC-NHC-STRUCTURAL-PARITY", "T26-NONHEALTHCARE-COMPOSITE-CANONICAL-OUTPUT", "T26-PIN-DISABLE-OLD-RELEASE", "T26-OWNERSHIP-INVENTORY"},
    "T27": {"T27-NORMAL-AND-GENERIC-FAILURE", "T27-THROTTLE-AND-ISOLATION", "T27-SETUP-ONLY-GUARD", "T27-EXPIRY-LOGOUT-REVOCATION", "T27-CSRF-DEEP-LINK-SHARED-DEVICE"},
    "T28": {"T28-CLEAN-BOOTSTRAP-AND-PENDING-OWNER", "T28-TEMPORARY-PASSWORD-NO-EMAIL", "T28-COPY-INVITATION-NO-EMAIL", "T28-CONFIGURED-INVITATION-EMAIL-DELIVERY", "T28-INVITE-EXPIRY-REVOKE-RESEND-CONCURRENT-ACCEPT", "T28-EXISTING-ACCOUNT-SECOND-TENANT-AND-FORGED-ID", "T28-LAST-OWNER-AND-PLATFORM-BOUNDARIES"},
    "T29": {"T29-CURRENT-PASSWORD-CHANGE-AND-SESSION-REVOCATION", "T29-PASSWORD-POLICY-UNICODE-AND-NO-TRUNCATION", "T29-ADMIN-RECOVERY-WITHOUT-EMAIL", "T29-CONFIGURED-SELF-RECOVERY-EMAIL", "T29-RESET-PURPOSE-EXPIRY-REUSE-REVOKE", "T29-SHARED-ACCOUNT-TENANT-BOUNDARY", "T29-SOLE-ADMIN-OPERATOR-RECOVERY"},
    "T30": {"T30-REQUIRED-SCREEN-ROUTE-MATRIX", "T30-NO-ACCESS-AND-INDEPENDENT-WORKSPACE-ROLES", "T30-INVITATION-DELIVERY-FAILURE-AND-COPY-FEEDBACK", "T30-EXPIRY-RETURN-AND-SHARED-DEVICE-CLEARING"},
    "T31": {"T31-PROFILE-STAMPS-AND-REJECTION", "T31-INT64-EXTREMA-JSON-CSV-ROUNDTRIP", "T31-JAVASCRIPT-BOUNDARY-2POW53-AND-PLUS-ONE", "T31-INVALID-INTEGER-ENCODINGS-AND-OVERFLOW", "T31-FROZEN-TODAY-AND-DERIVED-LATER-PAGE", "T31-PLACEMENT-EMPTY-AGGREGATE-AND-SCOPE", "T31-CYCLE-DATE-ZERO-DIVISION-AND-LIMIT-BEFORE-ROWS"},
    "T32": {"T32-CLEAN-START-BOOTSTRAP-FIRST-USER", "T32-ACKNOWLEDGED-DATA-SURVIVES-STOP-RESTART", "T32-DEPENDENCY-READINESS-AND-PROVIDER-CAPABILITY", "T32-BACKUP-RESTORE-AND-DELETION-REPLAY"},
}
BANNED = ("evaluator://fixture-runner", "operation.status=completed", "must satisfy", "perform-case", "execute deterministic")


def digest(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def walk(value: Any):
    if isinstance(value, dict):
        for item in value.values():
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)
    elif isinstance(value, str):
        yield value


def error(errors: list[str], message: str) -> None:
    errors.append(message)


def has_http_action(case: dict[str, Any], method: str, path: str) -> bool:
    return any(action.get("kind") == "http" and action.get("method") == method and action.get("path") == path for action in case["actions"])


def get_case(fixtures: dict[str, dict[str, Any]], fixture_id: str, case_id: str) -> dict[str, Any]:
    return next(case for case in fixtures[fixture_id]["cases"] if case["id"] == case_id)


def t31_session_set_envelope_errors(fixtures: dict[str, dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    t31 = fixtures["T31"]
    expected_valid_sets = {
        "s-t31-int64-min": "-9223372036854775808",
        "s-t31-int64-max": "9223372036854775807",
        "s-t31-2pow53": "9007199254740992",
        "s-t31-2pow53-plus-one": "9007199254740993",
    }
    actual_valid_sets: dict[str, str] = {}
    required_citations = {"PRD:582", "PRD:590", "CONTRACT:19", "CONTRACT:71-83"}

    for case in t31["cases"]:
        for action in case["actions"]:
            if action.get("kind") != "http" or action.get("method") != "PATCH" or action.get("path") != "/v1/sessions/{s}":
                continue
            body = action.get("body")
            if not isinstance(body, dict) or not isinstance(body.get("baseRevision"), int) or not isinstance(body.get("clientMutationId"), str):
                errors.append(f"{case['id']}: PATCH must have numeric baseRevision and clientMutationId")
                continue
            if not required_citations <= set(action.get("contractCitations", [])):
                errors.append(f"{case['id']}: PATCH lacks typed-operation contract citations")
            for operation in body.get("operations", []):
                if operation.get("op") != "set":
                    continue
                if "value" in operation:
                    errors.append(f"{case['id']}: set operation uses forbidden direct value")
                if set(operation) != {"op", "fieldId", "rowPath", "answer"}:
                    errors.append(f"{case['id']}: set operation shape is not the exact typed envelope")
                    continue
                answer = operation.get("answer")
                if not isinstance(answer, dict) or set(answer) != {"status", "value"} or answer.get("status") != "answered":
                    errors.append(f"{case['id']}: set answer must be {{status: answered, value}}")
                    continue
                if operation.get("fieldId") != "quantity" or operation.get("rowPath") != []:
                    errors.append(f"{case['id']}: integer set must address quantity at root rowPath")
                session_ref = action.get("sessionRef")
                if session_ref in expected_valid_sets:
                    if not isinstance(answer["value"], str):
                        errors.append(f"{case['id']}: valid integer transport must use a decimal string")
                    actual_valid_sets[session_ref] = answer["value"]

    if actual_valid_sets != expected_valid_sets:
        errors.append("T31 must freeze separate typed PATCH values for int64 min/max and 2^53/+1")
    return errors


def check_source_pins(document: dict[str, Any], errors: list[str]) -> None:
    for label, pin in document.get("sourcePins", {}).items():
        path = ROOT.parents[3] / pin.get("path", "")
        if not path.is_file():
            error(errors, f"source pin {label} points to a missing file")
        elif digest(path) != pin.get("sha256"):
            error(errors, f"source pin {label} SHA-256 drifted")


def check_frozen_assets(fixtures: dict[str, dict[str, Any]], errors: list[str]) -> None:
    for fixture_id, fixture in fixtures.items():
        for asset in fixture.get("frozenAssets", []):
            path = ROOT.parents[3] / asset.get("path", "")
            if not path.is_file():
                error(errors, f"{fixture_id} frozen asset is missing")
            elif digest(path) != asset.get("sha256"):
                error(errors, f"{fixture_id} frozen asset SHA-256 drifted")


def check_case_shape(fixtures: dict[str, dict[str, Any]], errors: list[str]) -> int:
    case_count = 0
    for fixture_id, fixture in fixtures.items():
        if fixture.get("executionStatus") != "not-run":
            error(errors, f"{fixture_id} must remain not-run")
        if not fixture.get("requirements") or not fixture.get("citations"):
            error(errors, f"{fixture_id} lacks requirement/source binding")
        actual_ids = {case.get("id") for case in fixture.get("cases", [])}
        if actual_ids != EXPECTED_CASES[fixture_id]:
            error(errors, f"{fixture_id} case set drifted")
        for case in fixture.get("cases", []):
            case_count += 1
            if not case.get("preState") or not case.get("actions"):
                error(errors, f"{case.get('id')}: missing concrete pre-state/actions")
            if not all(isinstance(action, dict) and action.get("kind") for action in case.get("actions", [])):
                error(errors, f"{case.get('id')}: action has no concrete kind")
            expected = case.get("expected", {})
            if expected.get("executionStatus") != "not-run" or not expected.get("laterPassPredicate") or not expected.get("evidence"):
                error(errors, f"{case.get('id')}: not-run oracle must freeze predicate and evidence")
    return case_count


def check_requirements(fixtures: dict[str, dict[str, Any]], errors: list[str]) -> None:
    t25 = get_case(fixtures, "T25", "T25-ORIENTATION-AND-ALLOCATION")
    allocation = t25["expected"]["laterPassPredicate"]
    if allocation["authors"] != {"allocated": 5, "orientationMinutes": 20, "taskLimitMinutes": 60} or allocation["respondents"] != {"allocated": 5, "readingMinutes": 5, "taskLimitMinutes": 25}:
        error(errors, "T25 must freeze 5+5 allocation, 20-minute orientation and exact timeboxes")
    if allocation.get("protocolAssetSha256") != fixtures["T25"]["frozenAssets"][0].get("sha256"):
        error(errors, "T25 scoring predicate must bind the exact usability protocol asset")
    respondent = get_case(fixtures, "T25", "T25-RESPONDENT-SCRIPT-AND-CRITICAL-MEANING")["expected"]["laterPassPredicate"]
    if respondent.get("minimumSuccesses") != 4 or respondent.get("denominator") != 5 or respondent.get("criticalMeaningErrorsAmongSuccesses") != 0 or respondent.get("requiredTotal") != "44.75":
        error(errors, "T25 respondent scoring is incomplete")

    parity = get_case(fixtures, "T26", "T26-HC-NHC-STRUCTURAL-PARITY")["expected"]["laterPassPredicate"]
    if {parity.get("hcFieldCount"), parity.get("nhcFieldCount")} != {42} or {parity.get("hcPageCount"), parity.get("nhcPageCount")} != {5} or parity.get("comparisonMode") != "structural-only" or parity.get("observedProductParity") is not False:
        error(errors, "T26 HC/NHC structural parity oracle drifted")

    t27 = get_case(fixtures, "T27", "T27-NORMAL-AND-GENERIC-FAILURE")
    if not has_http_action(t27, "POST", "/v1/auth/sign-in") or t27["expected"]["laterPassPredicate"]["unknownAndWrong"] != {"sameHttpStatus": 401, "samePublicBody": True}:
        error(errors, "T27 must freeze real sign-in and indistinguishable invalid credential response")

    t28 = get_case(fixtures, "T28", "T28-TEMPORARY-PASSWORD-NO-EMAIL")
    if not has_http_action(t28, "POST", "/v1/auth/activate") or t28["expected"]["laterPassPredicate"]["provision"].get("emailDeliveryState") != "not-configured":
        error(errors, "T28 temporary-password no-email path is incomplete")
    invite_email = get_case(fixtures, "T28", "T28-CONFIGURED-INVITATION-EMAIL-DELIVERY")["expected"]["laterPassPredicate"]
    if invite_email.get("provider") != {"acceptedByProvider": True, "inboxReceived": True}:
        error(errors, "T28 configured invitation email evidence is incomplete")

    recovery = get_case(fixtures, "T29", "T29-CONFIGURED-SELF-RECOVERY-EMAIL")["expected"]["laterPassPredicate"]
    if recovery.get("knownAndUnknownRequest") != {"sameHttpStatus": 202, "samePublicBody": True} or recovery.get("providerForKnown", {}).get("acceptedByProvider") is not True:
        error(errors, "T29 recovery generic response/provider evidence is incomplete")
    shared = get_case(fixtures, "T29", "T29-SHARED-ACCOUNT-TENANT-BOUNDARY")["expected"]["laterPassPredicate"]
    if shared.get("sharedRecoveryByTenantAdmin", {}).get("httpStatus") != 403 or shared.get("platformRecoveryByTenantAdmin", {}).get("httpStatus") != 403:
        error(errors, "T29 shared-account tenant boundary is incomplete")

    t30 = get_case(fixtures, "T30", "T30-REQUIRED-SCREEN-ROUTE-MATRIX")["expected"]["laterPassPredicate"]
    if t30.get("namedScreens") != 10 or t30.get("actorOrCodeManagementSurface") is not False:
        error(errors, "T30 required staff-screen matrix is incomplete")

    t31 = get_case(fixtures, "T31", "T31-JAVASCRIPT-BOUNDARY-2POW53-AND-PLUS-ONE")["expected"]["laterPassPredicate"]
    if t31.get("EXPR-073", {}).get("value") != "9007199254740992" or t31.get("INT64-05", {}).get("value") != "9007199254740993" or t31.get("valuesRemainDistinct") is not True:
        error(errors, "T31 2^53/+1 string vectors are incomplete")
    extrema = get_case(fixtures, "T31", "T31-INT64-EXTREMA-JSON-CSV-ROUNDTRIP")["expected"]["laterPassPredicate"]
    if extrema.get("vectors") != {"INT64-01": {"canonicalDecimalString": "9223372036854775807", "allStagesExact": True}, "INT64-02": {"canonicalDecimalString": "-9223372036854775808", "allStagesExact": True}} or extrema.get("wireType") != "canonical decimal string":
        error(errors, "T31 int64 extrema canonical wire strings are incomplete")
    invalid = get_case(fixtures, "T31", "T31-INVALID-INTEGER-ENCODINGS-AND-OVERFLOW")["expected"]["laterPassPredicate"]
    if invalid.get("INT64-06") != {"httpStatus": 422, "code": "INTEGER_ENCODING", "draftChanged": False, "rejectedWireValue": 1} or invalid.get("INT64-03") != {"httpStatus": 422, "code": "INTEGER_RANGE", "draftChanged": False} or invalid.get("INT64-04") != {"httpStatus": 422, "code": "INTEGER_RANGE", "draftChanged": False}:
        error(errors, "T31 invalid integer diagnostics are incomplete")
    errors.extend(t31_session_set_envelope_errors(fixtures))
    mutated = copy.deepcopy(fixtures)
    direct_value = get_case(mutated, "T31", "T31-INT64-EXTREMA-JSON-CSV-ROUNDTRIP")["actions"][0]["body"]["operations"][0]
    direct_value["value"] = direct_value.pop("answer")["value"]
    if not any("forbidden direct value" in message for message in t31_session_set_envelope_errors(mutated)):
        error(errors, "T31 direct-value negative checker mutation was accepted")

    t32 = get_case(fixtures, "T32", "T32-CLEAN-START-BOOTSTRAP-FIRST-USER")
    if not any(action.get("argv") == ["docker", "compose", "--env-file", ".env.acceptance", "up", "--build", "-d"] for action in t32["actions"]):
        error(errors, "T32 clean start command is not frozen")
    restore = get_case(fixtures, "T32", "T32-BACKUP-RESTORE-AND-DELETION-REPLAY")["expected"]["laterPassPredicate"]
    if restore.get("backupAgeMaximum") != "PT24H" or restore.get("restoreDurationMaximum") != "PT4H" or restore.get("deletedAuthorizedRead", {}).get("httpStatus") != 410:
        error(errors, "T32 backup/restore/tombstone oracle is incomplete")


def main() -> int:
    document = json.loads(ORACLE.read_text(encoding="utf-8"))
    errors: list[str] = check_document(document)
    if document.get("fixtureSet") != EXPECTED_FIXTURES or document.get("executionStatus") != "not-run" or document.get("frozenAtM0") is not True:
        error(errors, "oracle header must identify the fixed not-run T25–T32 set")
    prerequisites = document.get("laterExecutionPrerequisites", [])
    if {item.get("id") for item in prerequisites} != {"PRE-REAL-STAFF", "PRE-EMAIL-PROVIDER", "PRE-HUMAN-TRIAL", "PRE-DUAL-RUNTIME", "PRE-LOCAL-RECOVERY"} or any(item.get("state") != "not-run" for item in prerequisites):
        error(errors, "later execution prerequisites are incomplete or not frozen as not-run")
    fixtures = {fixture.get("id"): fixture for fixture in document.get("fixtures", [])}
    if list(fixtures) != EXPECTED_FIXTURES:
        error(errors, "fixture records must be exactly T25 through T32 in order")
    check_source_pins(document, errors)
    if set(fixtures) == set(EXPECTED_FIXTURES):
        check_frozen_assets(fixtures, errors)
        count = check_case_shape(fixtures, errors)
        check_requirements(fixtures, errors)
    else:
        count = 0
    rendered = "\n".join(walk(document)).lower()
    for token in BANNED:
        if token in rendered:
            error(errors, f"prohibited generic/tautological token found: {token}")
    if errors:
        print("FAIL " + "; ".join(errors))
        return 1
    print(f"PASS T25–T32 isolated not-run oracle: {len(fixtures)}/8 fixtures, {count} concrete cases, source pins current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
