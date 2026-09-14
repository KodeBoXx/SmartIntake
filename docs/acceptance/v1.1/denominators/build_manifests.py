#!/usr/bin/env python3
"""Generate versioned M0 denominator manifests without inspecting product output."""
from __future__ import annotations

import csv
import hashlib
import json
import re
from itertools import product
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PRD = ROOT / "docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md"
AUTH = ROOT / "docs/source-handoff/smart-form-builder-lite-prd-v1.1/Authentication-and-Administration.md"
LEDGER = ROOT / "docs/source-handoff/smart-form-builder-lite-prd-v1.1/requirement-dispositions.csv"
VERSION = "1.0.0-m0"
OWNER = "acceptance/denominators"

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

def operations_from(text):
    found = []
    for endpoint in re.findall(r"`((?:GET|POST|PUT|PATCH|DELETE)(?:/(?:GET|POST|PUT|PATCH|DELETE))? /v1/[^`? ]+)", text):
        verbs, path = endpoint.split(" ", 1)
        for verb in verbs.split("/"):
            found.append((verb, path))
    return found

def main():
    prd = PRD.read_text(encoding="utf-8")
    auth = AUTH.read_text(encoding="utf-8")
    source = "docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md"
    companion = "docs/source-handoff/smart-form-builder-lite-prd-v1.1/Authentication-and-Administration.md"

    classes = dict(re.findall(r"\| (SF-[A-Z]+-\d+) \| ([CE]) \|", prd))
    assert len(classes) == 95 and list(classes.values()).count("C") == 83 and list(classes.values()).count("E") == 12
    requirements = []
    with LEDGER.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rid = row["requirementId"]
            requirements.append(member("A-" + rid, rid + " retained requirement", source,
                "requirement disposition register", "acceptance/requirement-ledger",
                requirement_id=rid, classification=classes[rid], fixture=row["acceptance"],
                requirement_text=row["currentRequirement"]))
    assert len(requirements) == 95

    # The PRD tables are the named API source.  Multiplexed GET/POST cells split
    # into one verb+path member, as required by the approved plan.
    named = []
    seen = set()
    for verb, path in operations_from(prd[prd.index("### 11.2"):prd.index("### 11.6")]) + operations_from(auth):
        key = (verb, path)
        if key not in seen:
            seen.add(key)
            named.append(member(f"ON-{verb}-{len(named)+1:02d}", f"{verb} {path}", source if path not in auth else companion,
                "PRD §11.2–§11.5 or Appendix A API table", "api/openapi", method=verb, path=path))
    assert len(named) == 53, len(named)

    # §11.5 says these supporting CRUD resources are mandatory, but intentionally
    # does not fix paths.  This finite list is therefore M0-selected, not PRD-fixed.
    support = []
    for resource, template, verbs in [
        ("catalog folders", "/v1/workspaces/{w}/folders", "GET POST PATCH DELETE"),
        ("catalog tags", "/v1/workspaces/{w}/tags", "GET POST PATCH DELETE"),
        ("reusable blocks", "/v1/workspaces/{w}/blocks", "GET POST PATCH DELETE"),
        ("themes", "/v1/workspaces/{w}/themes", "GET POST PATCH DELETE"),
        ("locale bundles", "/v1/workspaces/{w}/locale-bundles", "GET POST PUT DELETE"),
        ("share channels", "/v1/workspaces/{w}/forms/{f}/share-channels", "GET POST PATCH DELETE"),
        ("policy objects", "/v1/organizations/{o}/policies", "GET POST PATCH DELETE"),
    ]:
        for verb in verbs.split():
            support.append(member(f"OS-{len(support)+1:02d}", f"{verb} {template} ({resource})", source,
                "§11.5 line 604", "api/openapi", method=verb, path=template, resource=resource,
                rationale="M0-selected concrete CRUD path for PRD-required supporting resource"))

    schemas = []
    for artifact in ["package", "expression", "input-answer", "typed-answer", "runtime-manifest", "submission-envelope", "event"]:
        schemas.append(member(f"S-{artifact}", f"{artifact} schema positive and negative validation", source,
            "§10/§11 and plan M2", "contract/schema", artifact=artifact,
            examples=["positive", "negative"], selection="plan-selected seven-artifact contract set"))

    # Security is a finite, reviewable five-dimension product.  Invalid requests
    # are assertions (deny/not-found), not exclusions.  Only state/operation pairs
    # which cannot exist are excluded and emitted below with their rationale.
    resources = ["form-definition", "draft", "release", "public-session", "submission", "attachment",
                 "export", "webhook", "locale-bundle", "policy", "audit-event", "background-job"]
    operations = ["read", "mutate", "deliver"]
    actors = ["anonymous-respondent", "workspace-author", "workspace-publisher", "workspace-exporter",
              "workspace-auditor", "organization-admin", "platform-admin"]
    tenants = ["own-tenant", "foreign-tenant", "missing-tenant"]
    states = ["active", "expired-or-revoked", "deleted-or-tombstoned"]
    sec, sec_excluded = [], []
    for r, op, actor, tenant, state in product(resources, operations, actors, tenants, states):
        impossible = ((op == "deliver" and r not in {"webhook", "background-job"}) or
                      (op == "mutate" and state == "deleted-or-tombstoned") or
                      (r == "audit-event" and op != "read"))
        ident = f"SEC-{len(sec)+len(sec_excluded)+1:04d}"
        if impossible:
            sec_excluded.append({"id": ident, "dimensions": {"resource": r, "operation": op, "actor": actor,
                "tenant_context": tenant, "state": state}, "rationale": "operation has no meaningful resource/state transition"})
        else:
            expected = "allow" if tenant == "own-tenant" and state == "active" and actor in {"workspace-author", "organization-admin", "platform-admin"} else "deny-or-not-found"
            sec.append(member(f"SEC-{len(sec)+1:04d}", f"{actor} {op} {r} in {tenant}/{state}", source,
                "§12 lines 632–649; Appendix A lines 7–27", "security/operations",
                dimensions={"resource": r, "operation": op, "actor": actor, "tenant_context": tenant, "state": state}, expected=expected))

    # Applicability inventory: every A/AA criterion plausibly reachable by the
    # authoring/respondent/staff UI gets both an inspection and an actual-task method.
    criteria = "1.1.1 1.2.1 1.2.2 1.2.3 1.2.4 1.2.5 1.3.1 1.3.2 1.3.3 1.3.4 1.3.5 1.4.1 1.4.2 1.4.3 1.4.4 1.4.5 1.4.10 1.4.11 1.4.12 1.4.13 2.1.1 2.1.2 2.1.4 2.2.1 2.2.2 2.3.1 2.4.1 2.4.2 2.4.3 2.4.4 2.4.5 2.4.6 2.4.7 2.4.11 2.4.12 2.4.13 2.5.1 2.5.2 2.5.3 2.5.4 2.5.7 2.5.8 3.1.1 3.1.2 3.2.1 3.2.2 3.2.3 3.2.4 3.2.6 3.3.1 3.3.2 3.3.3 3.3.4 3.3.7 3.3.8 4.1.2 4.1.3".split()
    wcag = []
    for c in criteria:
        for method in ["automated-static-inspection", "manual-browser-keyboard-at"]:
            wcag.append(member(f"WCAG-{c}-{method[:3]}", f"WCAG 2.2 {c} via {method}", source,
                "§8 lines 355–359; Appendix C lines 1421–1440", "accessibility",
                criterion=c, level="A/AA", method=method))

    ui_routes = [
        ("staff-sign-in", "/sign-in", "sign-in/invalid/throttled"), ("staff-setup", "/setup", "pending/expired"),
        ("catalog", "/workspaces/{w}/forms", "loading/empty/no-access"), ("builder", "/workspaces/{w}/forms/{f}/drafts/{d}", "loading/invalid/conflict"),
        ("preview", "/preview/{d}", "loading/error/no-side-effects"), ("review-publish", "/workspaces/{w}/forms/{f}/review", "pending/denied/stale"),
        ("responses", "/workspaces/{w}/submissions", "loading/empty/denied"), ("response-detail", "/workspaces/{w}/submissions/{s}", "loading/tombstone/denied"),
        ("integrations", "/workspaces/{w}/integrations", "empty/invalid/denied"), ("public-entry", "/f/{shareId}", "closed/expired/start"),
        ("public-form", "/sessions/{s}", "loading/offline/stale"), ("public-review", "/sessions/{s}/review", "stale/invalid/acknowledgment"),
        ("receipt", "/sessions/{s}/receipt", "pending/succeeded/failed"), ("not-found", "/not-found", "not-found/no-access")]
    ui = [member(f"UI-{i+1:02d}", n, source, "§4 lines 147–194; §9–§11; Appendix C", "frontend", route=r, states=s,
        control_intent="Certinal route/detail drawer/confirmation/inline validation/toast as applicable") for i,(n,r,s) in enumerate(ui_routes)]
    staff_names = "sign-in setup activation recovery platform-organizations organization-settings user-list add-user user-detail role-assignment invitation-delivery catalog builder review-publish responses response-detail export-history provider-policy".split()
    staff = [member(f"UISTAFF-{i+1:02d}", n.replace("-", " "), source, "§4 lines 194–200; Appendix A lines 74–104", "frontend/staff",
        screen=n, required_states=["loading", "empty-or-no-access", "invalid", "denied", "expired", "email-unavailable"],
        certinal_intent="dedicated edit route; detail drawer for read-only details; confirmation for destructive action") for i,n in enumerate(staff_names)]

    compiler_topics = ["closed-schema", "stable-id-key", "control-type-compatibility", "scope-arity", "option-domain",
        "route-reachability", "route-cycle", "dependency-cycle", "hidden-retention", "dynamic-requiredness", "calculation",
        "review-projection", "locale-completeness", "rtl-theme", "asset-policy", "limit-before-expansion", "extension-settings",
        "fixed-matrix", "nested-repeater-depth", "protected-calculated-value", "unknown-truth", "exact-integer", "decimal-scale", "diagnostic-pointer"]
    compiler = [member(f"C-{i+1:02d}", topic, source, "§5–§7; §10; Appendix C T04–T06", "compiler/runtime", case=topic) for i,topic in enumerate(compiler_topics)]
    hostile_topics = ["duplicate-json-keys", "malformed-unicode", "excessive-nesting", "prototype-style-key", "raw-executable-content",
        "unsupported-type-or-operator", "remote-reference", "secret-like-provider-field", "oversize-json", "candidate-cross-tenant-commit"]
    hostile = [member(f"H-{i+1:02d}", topic, source, "§11.3 lines 568–572", "import/security", import_class=topic) for i,topic in enumerate(hostile_topics)]
    identities = [member(f"I-{i:02d}", f"item {i} retains generated ID and values after add/delete/reorder", source,
        "Appendix C T06 lines 804–805; evaluator protocol lines 57–64, 103", "runtime/repeaters", item_number=i,
        assertion="generated itemId remains attached to its original row; no index-derived reassignment or truncation") for i in range(1,51)]
    faults = ["idle-autosave", "continuous-autosave", "server-500", "offline", "two-tabs", "stale-revision", "expired-draft", "shared-device",
        "app-restart", "database-restart", "backup-restore-tombstone-replay", "dependency-partial-failure"]
    fault_members = [member(f"F-{i+1:02d}", fault, source, "T09 lines 808–809; §13 lines 663–675; Appendix C lines 202–204", "operations/reliability", drill=fault) for i,fault in enumerate(faults)]
    n_surfaces = ["auth-bootstrap", "auth-session-lifecycle", "catalog", "draft-save", "definition-import-export", "publish-release", "public-session-start",
        "session-read", "session-mutation", "session-validation", "submission-receipt", "response-list", "response-detail", "response-export",
        "frontend-entry", "frontend-authoring", "frontend-preview", "frontend-respondent", "frontend-response-admin", "database-v1-v4", "compose-clean-start"]
    current = [member(f"N-{i+1:02d}", surface, source, "plan M1; PRD §§9–13", "characterization",
        surface=surface, assertion="capture request/input and observed current result before/after refactor; no PRD behavior is inferred from the observation") for i,surface in enumerate(n_surfaces)]

    docs = {
        "a-total.json": payload("A_total", "PRD-fixed", "one retained requirement-disposition row = one assertion", requirements, [citation(source, "requirement disposition register; plan M0")], prd_fixed_count=95),
        "o-named.json": payload("O_named", "PRD-fixed", "one unique HTTP verb + canonical path from §11.2–§11.5 and Appendix A", named, [citation(source, "§11.2–§11.5 lines 545–604"), citation(companion, "API table lines 68–94")], prd_fixed_count=53),
        "o-total.json": payload("O_total", "mixed: O_named fixed plus M0-selected supporting CRUD", "O_named members plus one verb+path for each frozen §11.5 supporting CRUD resource", named + support, [citation(source, "§11.5 line 604")], plan_selected_count=len(named)+len(support)),
        "s-total.json": payload("S_total", "plan-selected", "one M2 top-level schema artifact, each with independent positive and negative example validation", schemas, [citation(source, "§10–§11"), citation(source, "approved plan M2")]),
        "sec-total.json": payload("SEC_total", "plan-selected finite feasible security product", "every non-impossible resource × operation × actor × tenant context × state tuple; expected outcome may be allow, deny, or not-found", sec, [citation(source, "§12 lines 632–649"), citation(companion, "lines 7–27")], dimensions={"resources":resources,"operations":operations,"actors":actors,"tenant_contexts":tenants,"states":states}, excluded_combinations=sec_excluded, exclusion_policy="Only a nonsensical resource-operation-state transition is excluded; all authorization-denial combinations remain test members."),
        "wcag-total.json": payload("WCAG_total", "plan-selected applicability inventory", "each listed WCAG 2.2 A/AA criterion × both approved methods", wcag, [citation(source, "§8 lines 355–359"), citation(source, "Appendix C lines 1421–1440")], methods=["automated-static-inspection","manual-browser-keyboard-at"], wcag_reference="https://www.w3.org/TR/WCAG22/"),
        "ui-total.json": payload("UI_total", "plan-selected", "one public/staff shell route with its named state cluster and Certinal control intent", ui, [citation(source, "§4 lines 147–200"), citation(source, "Appendix C")]),
        "ui-staff-total.json": payload("UI_staff_total", "plan-selected; labels split as listed", "one PRD-named staff screen, with all six mandatory state categories and recorded Certinal intent", staff, [citation(source, "§4 lines 194–200"), citation(companion, "lines 74–104")]),
        "c-total.json": payload("C_total", "plan-selected", "one compiler/graph semantic case", compiler, [citation(source, "§5–§7; §10"), citation(source, "Appendix C T04–T06")]),
        "h-total.json": payload("H_total", "PRD-derived class inventory", "one hostile import class; each must reject safely before expensive semantic processing", hostile, [citation(source, "§11.3 lines 568–572")]),
        "i-total.json": payload("I_total", "PRD-fixed", "one identity-preservation assertion per item in the T06 50-item scenario", identities, [citation(source, "Appendix C T06 lines 804–805"), citation(companion.replace("Authentication-and-Administration.md", "Lite-Evaluator-Protocol.md"), "lines 57–64, 103")], prd_fixed_count=50),
        "f-total.json": payload("F_total", "plan-selected", "one named fault/recovery drill", fault_members, [citation(source, "T09 lines 808–809; §13 lines 663–675")]),
        "n-current.json": payload("N_current", "plan-selected characterization inventory", "one pre-refactor observable surface; observed result is captured later and is never expected behavior", current, [citation(source, "plan M1; PRD §§9–13")]),
    }
    for filename, content in docs.items():
        ids = []
        for row in content["members"]:
            assert all(row.get(key) for key in ("id", "title", "owner", "status", "citation")), (filename, row)
            assert "TBD" not in json.dumps(row).upper(), (filename, row["id"])
            assert all(row["citation"].get(key) for key in ("source", "lines")), (filename, row["id"])
            ids.append(row["id"])
        assert len(ids) == len(set(ids)), (filename, "duplicate member ID")
        (HERE / filename).write_text(json.dumps(content, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    index = {"version": VERSION, "source_sha256": hashlib.sha256(PRD.read_bytes()).hexdigest(),
             "generator": "build_manifests.py", "manifests": {name: doc["total"] for name, doc in docs.items()},
             "current_execution_status": "not-run", "independent_review_required": True}
    (HERE / "manifest-index.json").write_text(json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    files = sorted(p for p in HERE.glob("*.json")) + [HERE / "README.md", HERE / "build_manifests.py"]
    (HERE / "SHA256SUMS").write_text("".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in files), encoding="utf-8")

if __name__ == "__main__": main()
