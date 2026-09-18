#!/usr/bin/env python3
"""Generate versioned M0 denominator manifests without inspecting product output."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import tempfile
from itertools import product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from tools.acceptance.denominator_review import (
    classify_denominator_review, reconstruct_pre_attestation_binding,
    validate_denominator_attestation,
)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PRD = ROOT / "docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md"
AUTH = ROOT / "docs/source-handoff/smart-form-builder-lite-prd-v1.1/Authentication-and-Administration.md"
LEDGER = ROOT / "docs/source-handoff/smart-form-builder-lite-prd-v1.1/requirement-dispositions.csv"
PROTOCOL = ROOT / "docs/source-handoff/smart-form-builder-lite-prd-v1.1/Lite-Evaluator-Protocol.md"
INPUT_FILES = {
    "docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md": PRD,
    "docs/source-handoff/smart-form-builder-lite-prd-v1.1/Authentication-and-Administration.md": AUTH,
    "docs/source-handoff/smart-form-builder-lite-prd-v1.1/requirement-dispositions.csv": LEDGER,
    "docs/source-handoff/smart-form-builder-lite-prd-v1.1/Lite-Evaluator-Protocol.md": PROTOCOL,
}
VERSION = "2.0.0-m0"
OWNER = "acceptance/denominators"
GENERATED_ARTIFACTS = frozenset({
    "a-total.json", "c-total.json", "f-total.json", "h-total.json", "i-total.json",
    "manifest-index.json", "n-current.json", "o-named.json", "o-total.json", "s-total.json",
    "sec-total.json", "ui-staff-total.json", "ui-total.json", "wcag-total.json",
    "wcag-applicability-exclusions.json", "SHA256SUMS",
})
STATIC_ARTIFACTS = frozenset({"README.md", "build_manifests.py", "review-attestation.schema.json"})
OPTIONAL_STATIC_ARTIFACT = "review-attestation.json"

class ValidationError(RuntimeError):
    """A manifest source, generation, or checked-in artifact is invalid."""

def citation(source, lines): return {"source": source, "lines": lines}
def member(id, title, source, lines, owner="acceptance", **extra):
    row = {"id": id, "title": title, "citation": citation(source, lines),
           "owner": owner, "status": "not-run"}
    row.update(extra)
    return row

def payload(name, selection, rule, members, citations, **extra):
    return {"manifest": name, "version": VERSION, "owner": OWNER,
            "selection": selection, "counting_rule": rule,
            "source_citations": citations, "members": members,
            "total": len(members), "current_execution_status": "not-run",
            "independent_review_required": True, **extra}

def operations_from(text, base_line):
    found = []
    for line_number, line in enumerate(text.splitlines(), start=base_line):
        for endpoint in re.findall(r"`((?:GET|POST|PUT|PATCH|DELETE)(?:/(?:GET|POST|PUT|PATCH|DELETE))? /v1/[^`? ]+)", line):
            verbs, path = endpoint.split(" ", 1)
            for verb in verbs.split("/"):
                found.append((verb, path, str(line_number)))
    return found

def requirement_lines(text):
    return {match.group(1): str(number) for number, line in enumerate(text.splitlines(), start=1)
            if (match := re.search(r"\| (SF-[A-Z]+-\d+) \| [CE] \|", line))}

def stable_id(prefix, value):
    """Use a readable canonical slug plus a content hash, never list position."""
    canonical = str(value).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", canonical).strip("-")[:72]
    if not slug:
        raise ValidationError(f"cannot derive {prefix} ID from blank content")
    return f"{prefix}-{slug}-{hashlib.sha256(canonical.encode()).hexdigest()[:10]}"

def require(condition, message):
    if not condition:
        raise ValidationError(message)

def input_hashes():
    return {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in INPUT_FILES.items()}

def validate_attestation(path, binding):
    """Return a validated optional review record; absence is pending, never approval."""
    if not path.exists():
        return None
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValidationError(f"invalid review attestation: {exc}") from exc
    valid, detail = validate_denominator_attestation(record, version=VERSION, binding=binding)
    require(valid, detail)
    return record

def build(output_dir, *, pending=False):
    """Build either canonical pending bytes or a final attested release.

    A final release validates its review record against a separately rebuilt
    pending release. This makes the binding non-circular while final checksums
    still include the review artifact itself.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    attestation_path = HERE / OPTIONAL_STATIC_ARTIFACT
    final_attestation = attestation_path.exists() and not pending
    prd = PRD.read_text(encoding="utf-8")
    auth = AUTH.read_text(encoding="utf-8")
    protocol = PROTOCOL.read_text(encoding="utf-8")
    source = "docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md"
    companion = "docs/source-handoff/smart-form-builder-lite-prd-v1.1/Authentication-and-Administration.md"
    evaluator_protocol = "docs/source-handoff/smart-form-builder-lite-prd-v1.1/Lite-Evaluator-Protocol.md"

    classes = dict(re.findall(r"\| (SF-[A-Z]+-\d+) \| ([CE]) \|", prd))
    requirement_line_map = requirement_lines(prd)
    require(len(classes) == 95 and list(classes.values()).count("C") == 83 and list(classes.values()).count("E") == 12,
            "authoritative PRD requirement classes must be exactly 95 (83 Core, 12 Enhancement)")
    requirements = []
    with LEDGER.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rid = row["requirementId"]
            requirements.append(member("A-" + rid, rid + " retained requirement", source,
                requirement_line_map[rid], "acceptance/requirement-ledger",
                requirement_id=rid, classification=classes[rid], fixture=row["acceptance"],
                requirement_text=row["currentRequirement"]))
    require(len(requirements) == 95, "requirement disposition register must contain 95 rows")

    # The PRD tables are the named API source.  Multiplexed GET/POST cells split
    # into one verb+path member, as required by the approved plan.
    named = []
    seen = set()
    prd_api_start = prd.index("### 11.2")
    named_operations = [(verb, path, source, line) for verb, path, line in operations_from(
        prd[prd_api_start:prd.index("### 11.6")], prd[:prd_api_start].count("\n") + 1)]
    named_operations += [(verb, path, companion, line) for verb, path, line in operations_from(auth, 1)]
    for verb, path, operation_source, line in named_operations:
        key = (verb, path)
        if key not in seen:
            seen.add(key)
            named.append(member(stable_id("ON", f"{verb} {path}"), f"{verb} {path}", operation_source,
                line, "api/openapi", method=verb, path=path))
    require(len(named) == 53, f"named operation count must be 53, got {len(named)}")

    # §11.5 says these supporting CRUD resources are mandatory, but intentionally
    # does not fix paths.  This finite list is therefore M0-selected, not PRD-fixed.
    support = []
    for resource, template, verbs, lines, rationale in [
        ("catalog folders", "/v1/workspaces/{w}/folders", "GET POST PATCH DELETE", "604", "M0-selected concrete CRUD path for PRD-required supporting resource"),
        ("catalog tags", "/v1/workspaces/{w}/tags", "GET POST PATCH DELETE", "604", "M0-selected concrete CRUD path for PRD-required supporting resource"),
        ("reusable blocks", "/v1/workspaces/{w}/blocks", "GET POST PATCH DELETE", "604", "M0-selected concrete CRUD path for PRD-required supporting resource"),
        ("themes", "/v1/workspaces/{w}/themes", "GET POST PATCH DELETE", "604", "M0-selected concrete CRUD path for PRD-required supporting resource"),
        ("locale bundles", "/v1/workspaces/{w}/locale-bundles", "GET POST PUT DELETE", "604", "M0-selected concrete CRUD path for PRD-required supporting resource"),
        ("share channels", "/v1/workspaces/{w}/forms/{f}/share-channels", "GET POST PATCH DELETE", "604", "M0-selected concrete CRUD path for PRD-required supporting resource"),
        ("policy objects", "/v1/organizations/{o}/policies", "GET POST PATCH DELETE", "604", "M0-selected concrete CRUD path for PRD-required supporting resource"),
        ("submission interpretation", "/v1/workspaces/{w}/submissions/{id}/interpretation", "GET", "1103", "PRD-named staff response-view interpretation operation"),
    ]:
        for verb in verbs.split():
            support.append(member(stable_id("OS", f"{verb} {template}"), f"{verb} {template} ({resource})", source,
                lines, "api/openapi", method=verb, path=template, resource=resource, rationale=rationale))
    named_supporting_operations = [{
        "id": stable_id("ONS", "GET /v1/workspaces/{w}/submissions/{id}/interpretation"),
        "title": "submission interpretation",
        "citation": citation(source, "1103"),
        "owner": "api/openapi",
        "status": "included-in-o-total",
        "method": "GET",
        "path": "/v1/workspaces/{w}/submissions/{id}/interpretation",
        "rationale": "PRD-named response-view interpretation operation; its method/path are explicit and it is executable."
    }, {
        "id": stable_id("ONS", "authorized asset api|PRD 568"),
        "title": "authorized asset API",
        "citation": citation(source, "568"),
        "owner": "api/openapi",
        "status": "awaiting-m2-endpoint-design",
        "method": None,
        "path": None,
        "rationale": "PRD names an authorized asset API but does not prescribe an HTTP method or path; retained in inventory, excluded from executable O_total until M2 endpoint design freezes both keys."
    }]

    schemas = []
    for artifact, lines in [("package", "413,417-435"), ("expression", "269-292,424"),
                            ("input-answer", "479-481"), ("typed-answer", "477-504"),
                            ("runtime-manifest", "365,369,413"), ("submission-envelope", "477-504"),
                            ("event", "606-616")]:
        schemas.append(member(f"S-{artifact}", f"{artifact} schema positive and negative validation", source,
            lines, "contract/schema", artifact=artifact,
            examples=["positive", "negative"], selection="plan-selected seven-artifact contract set"))

    # SEC is a complete, source-derived authorization product.  The selected
    # compound profiles exercise additive roles; they are M0 coverage choices,
    # not new product roles.
    surfaces = [
        ("form-definition", "read", "523,553-559,564"), ("form-definition", "mutate", "89,523,553-559,564"),
        ("draft", "read", "89-90,555-560"), ("draft", "mutate", "89-90,555-560"),
        ("release", "read", "90-91,561-563"), ("release", "mutate", "90-91,561-563"),
        ("review-decision", "read", "90,560,905,942"), ("review-decision", "decide-content-or-rule", "90,560,905,942"), ("review-decision", "decide-locale", "90,942"),
        ("public-session", "read", "95,576-588"), ("public-session", "mutate", "95,576-588"),
        ("submission", "list", "587-588,594-598"), ("submission", "detail", "587-588,594-598"), ("submission", "submit", "587-588"), ("submission", "submission-operation-read", "587-588,594-598"),
        ("response-attachment", "read", "583-585,599"), ("response-attachment", "create", "583-585,599"), ("response-attachment", "complete", "583-585,599"), ("response-attachment", "delete", "583-585,599"),
        ("definition-asset", "read", "568,940,1237"), ("definition-asset", "create", "568,940,1237"), ("definition-asset", "complete", "568,940,1237"), ("definition-asset", "delete", "568,940,1237"),
        ("export", "status-or-history-read", "93,391,598"), ("export", "create", "93,391,598"), ("export", "download", "93,391,598"),
        ("webhook-configuration", "read", "87,178,600,610,623,957"), ("webhook-configuration", "configure-reference", "87,178,600,610,623,957"), ("webhook-configuration", "configure-full-policy-approved", "87,178,600,610,623,957"), ("webhook-configuration", "configure-full-policy-not-approved", "87,178,600,610,623,957"),
        ("webhook-delivery", "history-read", "601-602,610,616,623,1233"), ("webhook-delivery", "replay-reference", "601-602,610,616,623,1233"), ("webhook-delivery", "replay-full-policy-approved", "601-602,610,616,623,1233"), ("webhook-delivery", "replay-full-policy-not-approved", "601-602,610,616,623,1233"),
        ("locale-bundle", "read", "90,604"), ("locale-bundle", "mutate", "90,604"), ("policy", "read", "87,103,604,957"), ("policy", "mutate", "87,103,604,957"), ("audit-event", "read", "94,523"),
    ]
    require(len(surfaces) == 39, "SEC requires exactly 39 resource-specific surfaces")
    singleton_roles = ["platform-super-administrator", "organization-administrator", "organization-owner", "workspace-administrator", "author", "reviewer", "translator", "publisher", "response-viewer", "response-exporter", "auditor", "respondent"]
    profiles = [
        ("P-platform-super-administrator", ["platform-super-administrator"], "staff-session"),
        ("P-organization-administrator", ["organization-administrator"], "staff-session"),
        ("P-organization-owner", ["organization-owner"], "staff-session"),
        ("P-workspace-administrator", ["workspace-administrator"], "staff-session"),
        ("P-author", ["author"], "staff-session"), ("P-reviewer", ["reviewer"], "staff-session"),
        ("P-translator", ["translator"], "staff-session"), ("P-publisher", ["publisher"], "staff-session"),
        ("P-response-viewer", ["response-viewer"], "staff-session"), ("P-response-exporter", ["response-exporter"], "staff-session"),
        ("P-auditor", ["auditor"], "staff-session"), ("P-respondent", ["respondent"], "respondent-session"),
        ("P-organization-owner-response-exporter", ["organization-owner", "response-exporter"], "staff-session"),
        ("P-reviewer-publisher", ["reviewer", "publisher"], "staff-session"),
        ("P-platform-super-administrator-organization-owner", ["platform-super-administrator", "organization-owner"], "staff-session"),
        ("P-organization-administrator-author", ["organization-administrator", "author"], "staff-session"),
        ("P-authenticated-staff-no-workspace-role", [], "staff-session"),
    ]
    require(len(profiles) == 17 and len(singleton_roles) == 12, "SEC requires 17 profiles and 12 singleton roles")
    grants = {
        "organization-administrator": {("policy", "read"), ("policy", "mutate")},
        "organization-owner": {("policy", "read"), ("policy", "mutate"), ("webhook-configuration", "read"), ("webhook-configuration", "configure-reference"), ("webhook-delivery", "history-read"), ("webhook-delivery", "replay-reference")},
        "author": {("form-definition", "read"), ("form-definition", "mutate"), ("draft", "read"), ("draft", "mutate"), ("review-decision", "read"), *( ("definition-asset", action) for action in ("read", "create", "complete", "delete"))},
        "reviewer": {("draft", "read"), ("release", "read"), ("review-decision", "read"), ("review-decision", "decide-content-or-rule")},
        "translator": {("draft", "read"), ("locale-bundle", "read"), ("locale-bundle", "mutate"), ("review-decision", "read"), ("review-decision", "decide-locale")},
        "publisher": {("release", "read"), ("release", "mutate"), ("review-decision", "read")},
        "response-viewer": {("submission", "list"), ("submission", "detail"), ("response-attachment", "read")},
        "response-exporter": {("submission", "list"), ("submission", "detail"), ("response-attachment", "read"), ("export", "status-or-history-read"), ("export", "create"), ("export", "download")},
        "auditor": {("audit-event", "read")},
        "respondent": {("public-session", "read"), ("public-session", "mutate"), ("submission", "submit"), ("submission", "submission-operation-read"), *(("response-attachment", action) for action in ("read", "create", "complete", "delete"))},
    }
    relationship_contexts = [
        ("authorized-scope", {"staff-session": "assigned-workspace-resource", "respondent-session": "own-respondent-resource"}),
        ("same-tenant-unauthorized-scope", {"staff-session": "same-tenant-unassigned-workspace-resource", "respondent-session": "other-respondent-resource"}),
        ("foreign-tenant", {"staff-session": "foreign-tenant-resource", "respondent-session": "foreign-tenant-resource"}),
        ("missing-tenant-or-resource", {"staff-session": "missing-tenant-or-resource", "respondent-session": "missing-tenant-or-resource"}),
    ]
    states = ["active", "staff-authentication-expired-or-revoked", "staff-membership-role-or-tenant-inactive", "public-session-or-capability-expired", "resource-deleted-or-tombstoned"]
    sec, sec_excluded = [], []
    for profile, roles, credential_scope in profiles:
        applicable = {"active", "staff-authentication-expired-or-revoked", "staff-membership-role-or-tenant-inactive", "resource-deleted-or-tombstoned"} if credential_scope == "staff-session" else {"active", "public-session-or-capability-expired", "resource-deleted-or-tombstoned"}
        for resource, action, lines in surfaces:
            for relationship, details in relationship_contexts:
                for state in states:
                    canonical = "|".join((profile, resource, action, relationship, state))
                    dimensions = {"principal_profile": profile, "roles": roles, "credential_scope": credential_scope, "resource": resource, "action": action, "relationship_context": relationship, "relationship_detail": details[credential_scope], "security_state": state}
                    if state not in applicable:
                        sec_excluded.append({"id": stable_id("SECX", canonical), "dimensions": dimensions,
                            "reason_code": "SECX-STAFF-PROFILE-PUBLIC-AUTHORITY-STATE" if credential_scope == "staff-session" else "SECX-RESPONDENT-PROFILE-STAFF-AUTHORITY-STATE",
                            "rationale": "This authentication-state family cannot apply to the credential scope.", "citation": citation(source, "529-537")})
                        continue
                    allowed = any((resource, action) in grants.get(role, set()) for role in roles)
                    if set(roles) == {"organization-owner", "response-exporter"} and (resource, action) in {("webhook-configuration", "configure-full-policy-approved"), ("webhook-delivery", "replay-full-policy-approved")}:
                        allowed = True
                    if relationship != "authorized-scope":
                        expected, reason = "404", "SEC-CONCEALED-RELATIONSHIP-BOUNDARY"
                    elif credential_scope == "staff-session" and state == "staff-authentication-expired-or-revoked":
                        expected, reason = "401", "SEC-STAFF-AUTHENTICATION-EXPIRED-OR-REVOKED"
                    elif credential_scope == "staff-session" and state == "staff-membership-role-or-tenant-inactive":
                        expected, reason = "403", "SEC-STAFF-MEMBERSHIP-ROLE-OR-TENANT-INACTIVE"
                    elif state == "public-session-or-capability-expired":
                        expected, reason = ("410", "SEC-EXPIRED-RESPONDENT-CAPABILITY") if allowed else ("403", "SEC-UNGRANTED-SURFACE")
                    elif state == "resource-deleted-or-tombstoned":
                        if not allowed:
                            expected, reason = "403", "SEC-UNGRANTED-SURFACE"
                        elif (resource, action) in {("public-session", "read"), ("public-session", "mutate"), ("submission", "submission-operation-read"), ("submission", "detail")}:
                            expected, reason = "410", "SEC-AUTHORIZED-TOMBSTONE"
                        else:
                            expected, reason = "404", "SEC-AUTHORIZED-DELETED-RESOURCE"
                    elif (resource, action) in {("webhook-configuration", "configure-full-policy-not-approved"), ("webhook-delivery", "replay-full-policy-not-approved")}:
                        expected, reason = "403", "SEC-WEBHOOK-FULL-PAYLOAD-POLICY-NOT-APPROVED"
                    elif allowed:
                        expected, reason = "allow", "SEC-EXPLICIT-ROLE-SET-GRANT"
                    else:
                        expected, reason = "403", "SEC-UNGRANTED-SURFACE"
                    # PRD 537 governs every respondent expired/deleted session or
                    # capability outcome, including submission and attachment work.
                    # PRD 597 is narrower: only an authorized staff submission detail
                    # tombstone uses it as the governing 410 rule.
                    outcome_lines = {"401": "534-537", "403": "534-537", "404": "534-537"}.get(expected)
                    if expected == "410":
                        outcome_lines = "597" if (credential_scope == "staff-session" and resource == "submission" and action == "detail" and reason == "SEC-AUTHORIZED-TOMBSTONE") else "537"
                    citations = [citation(source, lines), citation(companion, "7-11")]
                    if outcome_lines:
                        citations.extend([citation(source, outcome_lines), citation(companion, "7-11")])
                    sec.append(member(stable_id("SEC", canonical), f"{profile} {action} {resource} {relationship}/{state}", source, lines, "security/operations", dimensions=dimensions, expected=expected, reason_code=reason, grant_basis=roles, citations=citations, outcome_citations=[] if outcome_lines is None else [citation(source, outcome_lines), citation(companion, "7-11")]))
    require(len(sec) == 10452 and len(sec_excluded) == 2808, "SEC must be 10,452 plus 2,808 structural exclusions")
    explicit_role_matrix = [{"role": role, "resource": resource, "action": action, "expected": "allow" if (resource, action) in grants.get(role, set()) else "403", "citations": [citation(source, lines), citation(companion, "7-11")]} for role in singleton_roles for resource, action, lines in surfaces]

    # Exactly the 55 WCAG 2.2 A/AA success criteria.  Each gets both required
    # methods; 2.4.12 and 2.4.13 are AAA and belong in the exclusion inventory.
    criteria = {
        "1.1.1":"A", "1.2.1":"A", "1.2.2":"A", "1.2.3":"A", "1.2.4":"AA", "1.2.5":"AA",
        "1.3.1":"A", "1.3.2":"A", "1.3.3":"A", "1.3.4":"AA", "1.3.5":"AA",
        "1.4.1":"A", "1.4.2":"A", "1.4.3":"AA", "1.4.4":"AA", "1.4.5":"AA", "1.4.10":"AA", "1.4.11":"AA", "1.4.12":"AA", "1.4.13":"AA",
        "2.1.1":"A", "2.1.2":"A", "2.1.4":"A", "2.2.1":"A", "2.2.2":"A", "2.3.1":"A",
        "2.4.1":"A", "2.4.2":"A", "2.4.3":"A", "2.4.4":"A", "2.4.5":"AA", "2.4.6":"AA", "2.4.7":"AA", "2.4.11":"AA",
        "2.5.1":"A", "2.5.2":"A", "2.5.3":"A", "2.5.4":"A", "2.5.7":"AA", "2.5.8":"AA",
        "3.1.1":"A", "3.1.2":"AA", "3.2.1":"A", "3.2.2":"A", "3.2.3":"AA", "3.2.4":"AA", "3.2.6":"A",
        "3.3.1":"A", "3.3.2":"A", "3.3.3":"AA", "3.3.4":"AA", "3.3.7":"A", "3.3.8":"AA", "4.1.2":"A", "4.1.3":"AA",
    }
    require(len(criteria) == 55, "WCAG 2.2 A/AA criteria inventory must contain exactly 55 criteria")
    wcag = []
    for c, level in criteria.items():
        for method in ["automated-static-inspection", "manual-browser-keyboard-at"]:
            wcag.append(member(f"WCAG-{c}-{method[:3]}", f"WCAG 2.2 {c} via {method}", source,
                "355-359,1421-1440", "accessibility", criterion=c, level=level, method=method,
                wcag_citation="https://www.w3.org/TR/WCAG22/"))
    wcag_exclusions = [
        member("WCAGX-2.4.12", "WCAG 2.2 2.4.12 Focus Not Obscured (Enhanced)", "https://www.w3.org/TR/WCAG22/",
               "§2.4.12", "accessibility", criterion="2.4.12", level="AAA", rationale="PRD target is WCAG 2.2 AA, so AAA criterion is outside WCAG_total."),
        member("WCAGX-2.4.13", "WCAG 2.2 2.4.13 Focus Appearance", "https://www.w3.org/TR/WCAG22/",
               "§2.4.13", "accessibility", criterion="2.4.13", level="AAA", rationale="PRD target is WCAG 2.2 AA, so AAA criterion is outside WCAG_total."),
    ]

    ui_routes = [
        ("staff-sign-in", "/sign-in", "sign-in/invalid/throttled"), ("staff-setup", "/setup", "pending/expired"),
        ("catalog", "/workspaces/{w}/forms", "loading/empty/no-access"), ("builder", "/workspaces/{w}/forms/{f}/drafts/{d}", "loading/invalid/conflict"),
        ("preview", "/preview/{d}", "loading/error/no-side-effects"), ("review-publish", "/workspaces/{w}/forms/{f}/review", "pending/denied/stale"),
        ("responses", "/workspaces/{w}/submissions", "loading/empty/denied"), ("response-detail", "/workspaces/{w}/submissions/{s}", "loading/tombstone/denied"),
        ("integrations", "/workspaces/{w}/integrations", "empty/invalid/denied"), ("public-entry", "/f/{shareId}", "closed/expired/start"),
        ("public-form", "/sessions/{s}", "loading/offline/stale"), ("public-review", "/sessions/{s}/review", "stale/invalid/acknowledgment"),
        ("receipt", "/sessions/{s}/receipt", "pending/succeeded/failed"), ("not-found", "/not-found", "not-found/no-access")]
    ui = [member(stable_id("UI", f"{n}|{r}|{s}"), n, source, "361-409,678-709", "frontend", route=r, states=s,
        control_intent="Certinal route/detail drawer/confirmation/inline validation/toast as applicable") for n,r,s in ui_routes]
    staff_names = "sign-in setup activation recovery platform-organizations organization-settings user-list add-user user-detail role-assignment invitation-delivery catalog builder review-publish responses response-detail export-history provider-policy".split()
    staff = [member(stable_id("UISTAFF", n), n.replace("-", " "), companion, "74-104", "frontend/staff",
        screen=n, required_states=["loading", "empty-or-no-access", "invalid", "denied", "expired", "email-unavailable"],
        certinal_intent="dedicated edit route; detail drawer for read-only details; confirmation for destructive action") for n in staff_names]

    compiler_topics = ["closed-schema", "stable-id-key", "control-type-compatibility", "scope-arity", "option-domain",
        "route-reachability", "route-cycle", "dependency-cycle", "hidden-retention", "dynamic-requiredness", "calculation",
        "review-projection", "locale-completeness", "rtl-theme", "asset-policy", "limit-before-expansion", "extension-settings",
        "fixed-matrix", "nested-repeater-depth", "protected-calculated-value", "unknown-truth", "exact-integer", "decimal-scale", "diagnostic-pointer"]
    compiler_line_map = {
        "closed-schema":"431", "stable-id-key":"422,513", "control-type-compatibility":"220-267", "scope-arity":"271-292",
        "option-domain":"220-267", "route-reachability":"305-312", "route-cycle":"305-312", "dependency-cycle":"428,514",
        "hidden-retention":"293-304", "dynamic-requiredness":"313-329", "calculation":"271-292", "review-projection":"1395-1403",
        "locale-completeness":"331-359", "rtl-theme":"331-359", "asset-policy":"218,429", "limit-before-expansion":"568,666",
        "extension-settings":"431", "fixed-matrix":"220-267", "nested-repeater-depth":"220-267,666", "protected-calculated-value":"479-504",
        "unknown-truth":"481", "exact-integer":"481,433", "decimal-scale":"481", "diagnostic-pointer":"529-539",
    }
    compiler = [member(stable_id("C", topic), topic, source, compiler_line_map[topic], "compiler/runtime", case=topic) for topic in compiler_topics]
    hostile_topics = ["duplicate-json-keys", "malformed-unicode", "excessive-nesting", "prototype-style-key", "raw-executable-content",
        "unsupported-type-or-operator", "remote-reference", "secret-like-provider-field", "oversize-json", "candidate-cross-tenant-commit"]
    hostile = [member(stable_id("H", topic), topic, source, "568-572", "import/security", import_class=topic) for topic in hostile_topics]
    identities = [member(f"I-{i:02d}", f"item {i} retains generated ID and values after add/delete/reorder", evaluator_protocol,
        "57-64,103", "runtime/repeaters", item_number=i,
        assertion="generated itemId remains attached to its original row; no index-derived reassignment or truncation") for i in range(1,51)]
    faults = ["idle-autosave", "continuous-autosave", "server-500", "offline", "two-tabs", "stale-revision", "expired-draft", "shared-device",
        "app-restart", "database-restart", "backup-restore-tombstone-replay", "dependency-partial-failure"]
    fault_members = [member(stable_id("F", fault), fault, evaluator_protocol if fault in {"idle-autosave", "continuous-autosave", "two-tabs", "stale-revision"} else source,
                            "202" if fault in {"idle-autosave", "continuous-autosave", "two-tabs", "stale-revision"} else "663-675", "operations/reliability", drill=fault) for fault in faults]
    n_surfaces = ["auth-bootstrap", "auth-session-lifecycle", "catalog", "draft-save", "definition-import-export", "publish-release", "public-session-start",
        "session-read", "session-mutation", "session-validation", "submission-receipt", "response-list", "response-detail", "response-export",
        "frontend-entry", "frontend-authoring", "frontend-preview", "frontend-respondent", "frontend-response-admin", "database-v1-v4", "compose-clean-start"]
    n_citations = {
        "auth-bootstrap":(companion,"7-27"), "auth-session-lifecycle":(companion,"15-45"), "catalog":(source,"657"),
        "draft-save":(source,"373-379"), "definition-import-export":(source,"568-604"), "publish-release":(source,"365-369"),
        "public-session-start":(source,"371-385"), "session-read":(source,"371-379"), "session-mutation":(source,"373-379"),
        "session-validation":(source,"313-329"), "submission-receipt":(source,"371-377"), "response-list":(source,"387-393"),
        "response-detail":(source,"387-393"), "response-export":(source,"391-393"), "frontend-entry":(source,"678-709"),
        "frontend-authoring":(source,"678-709"), "frontend-preview":(evaluator_protocol,"191"), "frontend-respondent":(source,"371-385"),
        "frontend-response-admin":(evaluator_protocol,"189"), "database-v1-v4":(source,"653-675"), "compose-clean-start":(evaluator_protocol,"204"),
    }
    current = [member(stable_id("N", surface), surface, *n_citations[surface], "characterization",
        surface=surface, assertion="capture request/input and observed current result before/after refactor; no PRD behavior is inferred from the observation") for surface in n_surfaces]

    docs = {
        "a-total.json": payload("A_total", "PRD-fixed", "one retained requirement-disposition row = one assertion", requirements, [citation(source, "101-676")], prd_fixed_count=95),
        "o-named.json": payload("O_named", "PRD-fixed", "one unique HTTP verb + canonical path from §11.2–§11.5 and authentication companion API table", named, [citation(source, "545-604"), citation(companion, "68-94")], prd_fixed_count=53),
        "o-total.json": payload("O_total", "mixed: O_named fixed plus executable M0-selected supporting CRUD", "O_named members plus one executable verb+path for each frozen supporting operation; all executable operation records use method/path keys", named + support, [citation(source, "568,604,1103")], plan_selected_count=len(named)+len(support), named_supporting_total=len(named)+len(named_supporting_operations), named_supporting_operations=named_supporting_operations),
        "s-total.json": payload("S_total", "plan-selected", "one M2 top-level schema artifact, each with independent positive and negative example validation", schemas, [citation(source, "413-435,477-504,606-616")]),
        "sec-total.json": payload("SEC_total", "M0-selected complete security product", "17 principal profiles × 39 resource-specific security surfaces × four relationship contexts × applicable credential states; every feasible tuple has an exact allow/401/403/404/410 outcome", sec, [citation(source, "81-97,523,529-537,560-564,576-610,940,957,1237"), citation(companion, "7-11")], dimensions={"principal_profiles": [{"id": profile, "roles": roles, "credential_scope": scope} for profile, roles, scope in profiles], "security_surfaces": [{"resource": resource, "action": action} for resource, action, _ in surfaces], "relationship_contexts": [value for value, _ in relationship_contexts], "security_states": states}, role_capability_matrix=explicit_role_matrix, excluded_combinations=sec_excluded, exclusion_policy="Only credential-scope/state structural impossibility is SECX. Denials, ownership/assignment boundaries, tombstones, webhook policy failures, and missing/foreign resources remain SEC assertions.", coverage_choice="The 17 profiles, including four compound profiles and no-workspace-role profile, are an M0 evaluation coverage choice; authoritative singleton roles remain product behavior."),
        "wcag-total.json": payload("WCAG_total", "WCAG-fixed criteria with plan-selected methods", "55 WCAG 2.2 A/AA criteria × both approved methods", wcag, [citation(source, "355-359,1421-1440")], methods=["automated-static-inspection","manual-browser-keyboard-at"], wcag_reference="https://www.w3.org/TR/WCAG22/", wcag_criteria_count=55),
        "wcag-applicability-exclusions.json": payload("WCAG_applicability_exclusions", "correction inventory", "two prior mistaken AAA inclusions removed from WCAG_total", wcag_exclusions, [citation(source, "355-359")]),
        "ui-total.json": payload("UI_total", "plan-selected", "one public/staff shell route with its named state cluster and Certinal control intent", ui, [citation(source, "361-409,678-709")]),
        "ui-staff-total.json": payload("UI_staff_total", "plan-selected; labels split as listed", "one PRD-named staff screen, with all six mandatory state categories and recorded Certinal intent", staff, [citation(companion, "74-104")]),
        "c-total.json": payload("C_total", "plan-selected", "one compiler/graph semantic case", compiler, [citation(source, "202-329,413-435,1395-1403")]),
        "h-total.json": payload("H_total", "PRD-derived class inventory", "one hostile import class; each must reject safely before expensive semantic processing", hostile, [citation(source, "§11.3 lines 568–572")]),
        "i-total.json": payload("I_total", "PRD-fixed", "one identity-preservation assertion per item in the T06 50-item scenario", identities, [citation(evaluator_protocol, "57-64,103")], prd_fixed_count=50),
        "f-total.json": payload("F_total", "plan-selected", "one named fault/recovery drill", fault_members, [citation(source, "373-379,663-675"), citation(evaluator_protocol, "202-204")]),
        "n-current.json": payload("N_current", "plan-selected characterization inventory", "one pre-refactor observable surface; observed result is captured later and is never expected behavior", current, [citation(source, "361-409,517-675"), citation(companion, "7-45"), citation(evaluator_protocol, "189-204")]),
    }
    for filename, content in docs.items():
        ids = []
        for row in content["members"]:
            require(all(row.get(key) for key in ("id", "title", "owner", "status", "citation")),
                    f"{filename}: member is missing required metadata")
            require("TBD" not in json.dumps(row).upper(), f"{filename}: {row['id']} contains TBD")
            require(all(row["citation"].get(key) for key in ("source", "lines")),
                    f"{filename}: {row['id']} has an orphan citation")
            ids.append(row["id"])
        require(content["total"] == len(content["members"]), f"{filename}: total does not equal member count")
        require(len(ids) == len(set(ids)), f"{filename}: duplicate member ID")
        if filename in {"o-named.json", "o-total.json"}:
            require(all(row.get("method") and row.get("path") for row in content["members"]),
                    f"{filename}: every operation must use method/path keys")
        if filename == "sec-total.json":
            excluded_ids = [row["id"] for row in content["excluded_combinations"]]
            require(all(value.startswith("SECX-") for value in excluded_ids), "SEC exclusions must use SECX-* IDs")
            require(len(excluded_ids) == len(set(excluded_ids)), "SEC exclusions have duplicate IDs")
            require(len(ids) + len(excluded_ids) == len(set(ids + excluded_ids)),
                    "SEC member and exclusion IDs are not globally unique")
            require(all(row["expected"] in {"allow", "401", "403", "404", "410"} for row in content["members"]),
                    "SEC expected outcome must be exact and non-disjunctive")
            require(all(row.get("outcome_citations") and {item["source"] for item in row["outcome_citations"]} >= {source, companion}
                        for row in content["members"] if row["expected"] in {"401", "403", "404", "410"}),
                    "every exact SEC denial/status outcome needs PRD and authentication citations")
            for row in (value for value in content["members"] if value["expected"] == "410"):
                dimensions = row["dimensions"]
                governing = "597" if (dimensions["credential_scope"] == "staff-session" and dimensions["resource"] == "submission" and dimensions["action"] == "detail" and row["reason_code"] == "SEC-AUTHORIZED-TOMBSTONE") else "537"
                require(citation(source, governing) in row["outcome_citations"], "SEC 410 outcome citation must use its governing PRD line")
            require(all(row.get("reason_code") and row.get("rationale") and row.get("citation")
                        for row in content["excluded_combinations"]),
                    "each SECX exclusion needs reason code, rationale, and citation")
            require(content["total"] == 10452 and len(excluded_ids) == 2808,
                    "SEC complete profile/surface product must be 10,452 members plus 2,808 SECX exclusions")
            require({row["reason_code"] for row in content["excluded_combinations"]} == {"SECX-STAFF-PROFILE-PUBLIC-AUTHORITY-STATE", "SECX-RESPONDENT-PROFILE-STAFF-AUTHORITY-STATE"},
                    "SECX must use only the two credential-scope structural reason codes")
        if filename == "wcag-total.json":
            require(content["total"] == 110 and content["wcag_criteria_count"] == 55,
                    "WCAG total must be 55 criteria × 2 methods")
            require({row["level"] for row in content["members"]} == {"A", "AA"},
                    "WCAG members must use actual A or AA levels")
        (output_dir / filename).write_text(json.dumps(content, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    hashes = input_hashes()
    # SHA256SUMS deliberately excludes itself and the index.  The index pins
    # its digest and every release member digest, avoiding a checksum cycle.
    checksum_members = sorted([*docs, "README.md", "build_manifests.py", "review-attestation.schema.json"] + ([OPTIONAL_STATIC_ARTIFACT] if final_attestation else []))
    digest_paths = {name: (output_dir / name if name in docs else HERE / name) for name in checksum_members}
    digest_entries = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in digest_paths.items()}
    sums_bytes = "".join(f"{digest_entries[name]}  {name}\n" for name in checksum_members).encode("utf-8")
    (output_dir / "SHA256SUMS").write_bytes(sums_bytes)
    if final_attestation:
        binding = reconstruct_pre_attestation_binding(HERE, lambda target: build(target, pending=True))
        record = validate_attestation(attestation_path, binding)
        require(record is not None, "final release requires a review attestation")
        review_pointer = {"status": "approved" if record["decision"] == "approved" else "rejected", "path": "docs/acceptance/v1.1/denominators/review-attestation.json", "sha256": digest_entries[OPTIONAL_STATIC_ARTIFACT], "authority": record["authority"], "reviewer": record["reviewer"], "attestedAt": record["attestedAt"], "decision": record["decision"], "preAttestationBinding": record["preAttestationBinding"], "note": "Validated independent technical-review attestation."}
        release_status = classify_denominator_review(record, version=VERSION, binding=binding)
        require(release_status != "unreviewed-not-released", "advisory, rejected, or invalid reviews cannot finalize a release")
        if output_dir.resolve() != HERE.resolve():
            (output_dir / OPTIONAL_STATIC_ARTIFACT).write_bytes(attestation_path.read_bytes())
    else:
        review_pointer = {"status": "pending-independent-review", "path": "docs/acceptance/v1.1/denominators/review-attestation.json", "sha256": None, "authority": None, "reviewer": None, "attestedAt": None, "decision": None, "preAttestationBinding": None, "note": "Pending independent technical review; no reviewer identity or approval is claimed."}
        release_status = "unreviewed-not-released"
    index = {
        "version": VERSION,
        "source_sha256": hashes[next(iter(INPUT_FILES))], "input_sha256": hashes,
        "generator": "build_manifests.py", "current_execution_status": "not-run",
        "independent_review_required": True, "release_status": release_status,
        "manifests": {name: {"total": doc["total"], "sha256": digest_entries[name]} for name, doc in docs.items()},
        "exclusions": {"sec-total.json": {"total": len(sec_excluded), "sha256": digest_entries["sec-total.json"]}},
        "closure": {"kind": "sha256sums-transitive-closure/v1", "sha256sumsPath": "docs/acceptance/v1.1/denominators/SHA256SUMS", "sha256sumsSha256": hashlib.sha256(sums_bytes).hexdigest(), "memberPaths": checksum_members},
        "independentReviewAttestation": review_pointer,
    }
    (output_dir / "manifest-index.json").write_text(json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    expected_output = GENERATED_ARTIFACTS | (STATIC_ARTIFACTS if output_dir.resolve() == HERE.resolve() else frozenset()) | ({OPTIONAL_STATIC_ARTIFACT} if final_attestation else frozenset())
    require({p.name for p in output_dir.iterdir()} == expected_output,
            "generator produced an unexpected artifact set")

def self_check():
    """Focused source-derived SEC and closure invariants, including mutations."""
    binding = reconstruct_pre_attestation_binding(HERE, build)
    require(set(binding) == {"kind", "manifestIndexSha256", "sha256sumsSha256"}, "pre-attestation reconstruction drifted")
    document = json.loads((HERE / "sec-total.json").read_text(encoding="utf-8"))
    for row in (value for value in document["members"] if value["expected"] == "410"):
        dimensions = row["dimensions"]
        governing = "597" if (dimensions["credential_scope"] == "staff-session" and dimensions["resource"] == "submission" and dimensions["action"] == "detail" and row["reason_code"] == "SEC-AUTHORIZED-TOMBSTONE") else "537"
        require(citation("docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md", governing) in row["outcome_citations"], f"410 governing citation drifted for {row['reason_code']}")
    rows = {(
        row["dimensions"]["principal_profile"], row["dimensions"]["resource"], row["dimensions"]["action"],
        row["dimensions"]["relationship_context"], row["dimensions"]["security_state"]
    ): row["expected"] for row in document["members"]}
    def expect(profile, resource, action, relationship, state, result):
        require(rows[(profile, resource, action, relationship, state)] == result, "focused SEC invariant failed")
    active = "active"
    expect("P-respondent", "public-session", "read", "same-tenant-unauthorized-scope", active, "404")
    expect("P-author", "draft", "read", "same-tenant-unauthorized-scope", active, "404")
    expect("P-reviewer", "review-decision", "decide-content-or-rule", "authorized-scope", active, "allow")
    expect("P-translator", "review-decision", "decide-content-or-rule", "authorized-scope", active, "403")
    expect("P-translator", "review-decision", "decide-locale", "authorized-scope", active, "allow")
    expect("P-publisher", "review-decision", "decide-content-or-rule", "authorized-scope", active, "403")
    expect("P-reviewer-publisher", "review-decision", "decide-content-or-rule", "authorized-scope", active, "allow")
    expect("P-organization-owner", "submission", "detail", "authorized-scope", active, "403")
    expect("P-response-exporter", "webhook-configuration", "configure-reference", "authorized-scope", active, "403")
    expect("P-organization-owner-response-exporter", "webhook-configuration", "configure-full-policy-approved", "authorized-scope", active, "allow")
    expect("P-organization-owner-response-exporter", "webhook-delivery", "replay-full-policy-not-approved", "authorized-scope", active, "403")
    expect("P-author", "definition-asset", "delete", "authorized-scope", active, "allow")
    expect("P-respondent", "public-session", "read", "authorized-scope", "resource-deleted-or-tombstoned", "410")
    expect("P-response-viewer", "submission", "detail", "authorized-scope", "resource-deleted-or-tombstoned", "410")
    expect("P-author", "submission", "detail", "authorized-scope", "resource-deleted-or-tombstoned", "403")
    with tempfile.TemporaryDirectory(prefix="denominator-byte-change-") as name:
        target = Path(name)
        for item in HERE.iterdir():
            if item.is_file():
                (target / item.name).write_bytes(item.read_bytes())
        (target / "sec-total.json").write_bytes((target / "sec-total.json").read_bytes() + b" ")
        try:
            check_closure(target)
        except ValidationError:
            pass
        else:
            raise ValidationError("SEC byte mutation did not invalidate transitive closure")
    # Exercise the complete lifecycle using a real live review file.  It is
    # removed and pending bytes regenerated before this command returns.
    live_attestation = HERE / OPTIONAL_STATIC_ARTIFACT
    require(not live_attestation.exists(), "self-check requires the checked-in release to start pending")
    binding = reconstruct_pre_attestation_binding(HERE, lambda target: build(target, pending=True))
    approved = {"schemaVersion": "1.0.0", "attestationType": "denominator-technical-review", "authority": "independent-agent-review", "status": "attested", "decision": "approved", "reviewer": "independent-agent-reviewer", "attestedAt": "2026-09-14T12:00:00Z", "manifestVersion": VERSION, "scope": "denominator-technical-review", "preAttestationBinding": binding}
    schema = json.loads((HERE / "review-attestation.schema.json").read_text(encoding="utf-8"))
    reviewer_pattern = schema["properties"]["reviewer"]["pattern"]
    timestamp_pattern = schema["properties"]["attestedAt"]["pattern"]
    for bad_reviewer in ("", " ", "\t\n"):
        require(re.fullmatch(reviewer_pattern, bad_reviewer) is None and not validate_denominator_attestation({**approved, "reviewer": bad_reviewer}, version=VERSION, binding=binding)[0], "reviewer schema/helper parity drifted")
    for bad_timestamp in ("2026-09-14T12:00:00+00:00", "2026-09-14 12:00:00Z"):
        require(re.fullmatch(timestamp_pattern, bad_timestamp) is None and not validate_denominator_attestation({**approved, "attestedAt": bad_timestamp}, version=VERSION, binding=binding)[0], "timestamp schema/helper parity drifted")
    require(schema["properties"]["attestedAt"].get("format") == "date-time" and not validate_denominator_attestation({**approved, "attestedAt": "2026-13-14T12:00:00Z"}, version=VERSION, binding=binding)[0], "timestamp calendar validation drifted")
    require(re.fullmatch(reviewer_pattern, approved["reviewer"]) is not None and re.fullmatch(timestamp_pattern, approved["attestedAt"]) is not None and validate_denominator_attestation(approved, version=VERSION, binding=binding)[0], "valid attestation schema/helper parity drifted")
    try:
        live_attestation.write_text(json.dumps(approved, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        build(HERE)
        check()
        # A changed attestation byte must invalidate closure before any parser
        # can accept it, and a stale binding must fail regeneration.
        live_attestation.write_bytes(live_attestation.read_bytes() + b" ")
        try:
            check()
        except ValidationError:
            pass
        else:
            raise ValidationError("attestation byte mutation did not invalidate finalized closure")
        live_attestation.write_text(json.dumps({**approved, "preAttestationBinding": {**binding, "manifestIndexSha256": "0" * 64}}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        try:
            build(HERE)
        except ValidationError:
            pass
        else:
            raise ValidationError("stale attestation binding was accepted")
        live_attestation.write_text(json.dumps({**approved, "authority": "advisory-non-human", "status": "advisory", "decision": "advisory"}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        try:
            build(HERE)
        except ValidationError:
            pass
        else:
            raise ValidationError("advisory attestation was accepted as finalized")
        live_attestation.write_text(json.dumps({**approved, "decision": "rejected"}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        try:
            build(HERE)
        except ValidationError:
            pass
        else:
            raise ValidationError("rejected attestation was accepted as finalized")
    finally:
        live_attestation.unlink(missing_ok=True)
        build(HERE)
    print("denominator manifests: focused invariants passed")

def check_closure(directory):
    """Validate transitive release closure before comparing regenerated bytes."""
    index = json.loads((directory / "manifest-index.json").read_text(encoding="utf-8"))
    closure = index.get("closure")
    require(isinstance(closure, dict) and closure.get("kind") == "sha256sums-transitive-closure/v1", "manifest-index closure is invalid")
    names = closure.get("memberPaths")
    require(isinstance(names, list) and names == sorted(names) and len(names) == len(set(names)), "closure member paths must be a sorted unique list")
    require(all(isinstance(name, str) and Path(name).name == name for name in names), "closure member paths must be safe basenames")
    sums = directory / "SHA256SUMS"
    require(closure.get("sha256sumsPath") == "docs/acceptance/v1.1/denominators/SHA256SUMS" and closure.get("sha256sumsSha256") == hashlib.sha256(sums.read_bytes()).hexdigest(), "SHA256SUMS closure digest mismatch")
    entries = {}
    for line in sums.read_text(encoding="utf-8").splitlines():
        digest, name = line.split("  ", 1)
        require(re.fullmatch(r"[0-9a-f]{64}", digest) and name not in entries, "SHA256SUMS is malformed")
        entries[name] = digest
    require(set(entries) == set(names), "SHA256SUMS names do not equal closure member paths")
    for name, digest in entries.items():
        target = directory / name
        require(target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == digest, f"closure digest mismatch for {name}")
    manifests = index.get("manifests")
    require(isinstance(manifests, dict) and set(manifests) == {name for name in entries if name.endswith('.json') and name not in {'review-attestation.schema.json', OPTIONAL_STATIC_ARTIFACT}}, "manifest index keys do not equal release manifests")
    for name, meta in manifests.items():
        doc = json.loads((directory / name).read_text(encoding="utf-8"))
        require(meta.get("sha256") == entries[name] and meta.get("total") == len(doc.get("members", [])) == doc.get("total"), f"manifest digest or total mismatch for {name}")
    require(index.get("exclusions", {}).get("sec-total.json") == {"total": 2808, "sha256": entries["sec-total.json"]}, "SECX index binding drifted")
    attestation = directory / OPTIONAL_STATIC_ARTIFACT
    pointer = index.get("independentReviewAttestation")
    require(isinstance(pointer, dict), "review-attestation pointer is invalid")
    if attestation.exists():
        binding = reconstruct_pre_attestation_binding(HERE, lambda target: build(target, pending=True))
        record = validate_attestation(attestation, binding)
        require(record is not None and pointer.get("status") == "approved" and record["decision"] == "approved", "final release must have an approved independent review")
        require(pointer.get("sha256") == entries.get(OPTIONAL_STATIC_ARTIFACT) == hashlib.sha256(attestation.read_bytes()).hexdigest(), "attestation digest binding drifted")
        require(pointer.get("preAttestationBinding") == binding and index.get("release_status") == classify_denominator_review(record, version=VERSION, binding=binding), "attestation release binding drifted")
    else:
        require(pointer == {"status": "pending-independent-review", "path": "docs/acceptance/v1.1/denominators/review-attestation.json", "sha256": None, "authority": None, "reviewer": None, "attestedAt": None, "decision": None, "preAttestationBinding": None, "note": "Pending independent technical review; no reviewer identity or approval is claimed."} and index.get("release_status") == "unreviewed-not-released", "pending review pointer drifted")

def check():
    """Regenerate to a temporary directory and compare without touching live files."""
    expected_live = GENERATED_ARTIFACTS | STATIC_ARTIFACTS | ({OPTIONAL_STATIC_ARTIFACT} if (HERE / OPTIONAL_STATIC_ARTIFACT).exists() else frozenset())
    require({p.name for p in HERE.iterdir()} == expected_live, "unexpected or missing live denominator artifacts")
    check_closure(HERE)
    with tempfile.TemporaryDirectory(prefix="denominator-check-") as temp:
        generated = Path(temp)
        build(generated)
        require({p.name for p in generated.iterdir()} == GENERATED_ARTIFACTS | ({OPTIONAL_STATIC_ARTIFACT} if (HERE / OPTIONAL_STATIC_ARTIFACT).exists() else frozenset()), "temporary generation artifact set differs from expectation")
        for name in sorted(GENERATED_ARTIFACTS | ({OPTIONAL_STATIC_ARTIFACT} if (HERE / OPTIONAL_STATIC_ARTIFACT).exists() else frozenset())):
            require((HERE / name).read_bytes() == (generated / name).read_bytes(), f"stale or non-deterministic generated artifact: {name}")
    print("denominator manifests: check passed")

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify artifacts without writing live files")
    parser.add_argument("--self-check", action="store_true", help="run focused SEC and closure invariants")
    args = parser.parse_args(argv)
    try:
        if args.self_check:
            self_check()
        elif args.check:
            check()
        else:
            build(HERE)
    except (OSError, ValueError, ValidationError) as exc:
        print(f"denominator manifests: {exc}", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
