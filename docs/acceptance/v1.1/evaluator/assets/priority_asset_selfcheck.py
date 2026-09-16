#!/usr/bin/env python3
"""Dependency-free structural check and T22 not-run template emitter.

This tool validates evaluator-owned frozen input definitions.  It never invokes
Smart Intake or records an observed result; deep probe checks use a loopback fake
WebDriver service only.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
import stat
import warnings
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def load(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8"))
def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
def sha(value):
    return hashlib.sha256(value).hexdigest()
def fail(message):
    raise AssertionError(message)
def require(condition, message):
    if not condition: fail(message)

def normalized_hc_package_sha256(package):
    """Compute the T19 package identity using the T24 Lite Contract N table."""
    normalized=copy.deepcopy(package)
    fields={field.get("id"): field for field in normalized.get("data",{}).get("fields",[])}
    def visit(node):
        if isinstance(node,dict):
            if node.get("kind")=="question" and node.get("control") in {"repeatingCards","dynamicMatrix"}:
                if fields.get(node.get("fieldId"),{}).get("type")!="list":
                    fail("T19 repeater control must bind canonical list storage")
                presentation=node.setdefault("presentation",{})
                settings=presentation.setdefault("settings",{})
                if not isinstance(settings,dict): fail("T19 list-like presentation settings must be an object")
                for key in ("allowAdd","allowRemove","allowReorder"): settings.setdefault(key,True)
            for child in node.values(): visit(child)
        elif isinstance(node,list):
            for child in node: visit(child)
        elif isinstance(node,float):
            fail("T19 package identity cannot normalize floating JSON values")
    visit(normalized.get("flow",{}))
    return sha(json.dumps(normalized,sort_keys=True,ensure_ascii=False,separators=(",", ":")).encode("utf-8"))

def check_t08():
    p = load("t08-validation-errors.json")["frozenInputProtocol"]
    cases = p["patchCases"]
    require(len(cases) == 8, "T08 must have eight invalid PATCH batches")
    ids = {c["caseId"] for c in cases}
    require(ids == set(p["requestBytes"]), "T08 case/request byte IDs differ")
    for c in cases:
        raw = bytes.fromhex(c["requestUtf8Hex"])
        require(sha(raw) == c["requestSha256"], f"T08 hash {c['caseId']}")
        body = json.loads(raw)
        require(set(body) == {"baseRevision", "clientMutationId", "operations"}, f"T08 envelope {c['caseId']}")
        require(body["baseRevision"] == 8 and len(body["operations"]) == 1, f"T08 batch {c['caseId']}")
        expected = c["expected"]
        require(expected["httpStatus"] == 422 and expected["atomicity"]["operationsApplied"] == 0, f"T08 response {c['caseId']}")
        require(expected["diagnostic"]["jsonPointer"].startswith("/operations/0"), f"T08 pointer {c['caseId']}")

def check_t19():
    p = load("t19-webhooks.json")["frozenInputProtocol"]
    required = {"schemaVersion", "eventId", "eventType", "timestamp", "tenantId", "workspaceId", "resources", "sequence", "payloadMode", "payload", "formId"}
    envelopes = p["eventEnvelopes"]
    require(len(envelopes) == 3, "T19 must freeze three raw envelopes")
    for item in envelopes:
        raw = bytes.fromhex(item["rawBodyUtf8Hex"])
        require(sha(raw) == item["rawBodySha256"], f"T19 hash {item['eventId']}")
        decoded=json.loads(raw); require(required <= set(decoded), f"T19 envelope fields {item['eventId']}")
        if decoded["eventType"]=="submission.deleted": require({"deletionId","accessRevokedAt","formId"} <= set(decoded), "T19 deletion identity fields")
    graph=p["frozenPackageReleaseSessionGraph"]
    package=json.loads((ROOT.parent / "packages" / "package-hc.json").read_text())
    package_digest=normalized_hc_package_sha256(package)
    package_source_digest=sha((ROOT.parent / "packages" / "package-hc.json").read_bytes())
    def graph_ids(field):
        yield field["id"]
        for child in field.get("properties",[]): yield from graph_ids(child)
        for schema in (field.get("itemSchema"),field.get("rowSchema")):
            if isinstance(schema,dict): yield from graph_ids(schema)
    allowed={item for field in package["data"]["fields"] for item in graph_ids(field)}
    require(
        graph["packageId"]=="pkg-"+package_digest[:16]
        and graph.get("packageNormalization")=="RFC8785(N(package))"
        and graph.get("packageCanonicalSha256")==package_digest
        and graph.get("releasePackageCanonicalSha256")==package_digest
        and graph.get("packageSourceSha256")==package_source_digest
        and graph.get("inputAnswerFieldIds")==sorted(graph["inputAnswers"])
        and graph.get("inputAnswersCanonicalSha256")==sha(canonical(graph["inputAnswers"]))
        and graph["releaseId"] and graph["sessionId"],
        "T19 exact normalized package/release/session graph pins")
    full=next(item["envelope"] for item in envelopes if item["envelope"]["payloadMode"]=="full")
    require(full["formId"]==graph["formKey"] and full["payload"]["sessionId"]==graph["sessionId"] and full["payload"]["answers"] == {next(iter(graph["inputAnswers"])): graph["inputAnswers"][next(iter(graph["inputAnswers"]))]}, "T19 full payload uses exact frozen InputAnswer envelopes")
    require(set(graph["inputAnswers"]) <= allowed and set(full["payload"]["answers"]) <= allowed, "T19 answer IDs are in exact HC recursive graph")
    raw_hashes={item["eventId"]:item["rawBodySha256"] for item in envelopes}
    require(all(sha(bytes.fromhex(item["rawBodyUtf8Hex"]))==raw_hashes[item["eventId"]] for item in envelopes), "T19 frozen event envelope digests")
    ids = {c["id"] for c in p["deliveryCases"]}
    needed = {"valid-signature", "tampered-body", "old-timestamp", "duplicate", "out-of-order", "network-failure", "timeout-408", "retry-429", "retry-5xx", "pause-401", "pause-403", "permanent-4xx", "disable-410", "retry-exhaustion", "rotation", "replay", "reference-full", "deletion"}
    require(needed <= ids, "T19 delivery cases incomplete")
    require(p["retryOffsetsSeconds"] == [60,300,1800,7200,21600,43200,86400], "T19 retry offsets")
    require(len(p["jitterMilliseconds"]) == 7 and len(p["retrySchedule"]) == 7, "T19 deterministic jitter schedule")
    for row in p["retrySchedule"]: require(row["effectiveDelayMilliseconds"] == row["baseDelaySeconds"] * 1000 + row["jitterMilliseconds"], "T19 jitter arithmetic")
    require(all(case["signingVector"].get("rawBodySha256ByEvent")=={event_id:raw_hashes[event_id] for event_id in case["eventIds"]} for case in p["deliveryCases"]), "T19 delivery vectors pin exact current event bodies")
    require(p["retryClasses"] == {"retryable":["network-drop","status-408","status-429","status-500"],"pause":["status-401","status-403"],"permanent":["status-422","status-410"],"maxAttempts":8}, "T19 retry classes")
    require(p["controlledReceiver"]["secretValueMaterialized"] is False, "T19 must not materialize secret")

def base_candidate():
    return {"schemaVersion":"4.0.0","engineContract":"4.0.0","contractVersion":"4.0.0","kind":"smart-form-package","formKey":"candidate-a","definitionVersion":"1.0.0","titleKey":"form.title","descriptionKey":"form.description","defaultLocale":"en","supportedLocales":["en"],"data":{"fields":[{"id":"field-a","key":"name","type":"text","labelKey":"q.name","sensitivity":"ordinary","mode":"input","hiddenRetention":"clear","normalizer":"preserve","constraints":{"maxLength":120}}]},"flow":{"startPageId":"page-a","phases":[{"id":"phase-a","titleKey":"form.title","pages":[{"id":"page-a","titleKey":"form.title","sections":[{"id":"section-a","titleKey":"form.title","layout":"stack","nodes":[{"id":"node-a","kind":"question","fieldId":"field-a","control":"text"}]}],"routes":[]}]}]},"expressions":{},"guidance":{},"translations":{"en":{"direction":"ltr","reviewState":"approved","messages":{"form.title":"Candidate","form.description":"Hostile import base.","q.name":"Name","confirmation":"Recorded."},"pronunciations":[]}},"theme":{"themeKey":"accessible-default","version":"1.0.0","tokens":{"accent":"#175CD3","background":"#FFFFFF","text":"#182230","fontFamily":"system","density":"comfortable","radius":8}},"policies":{"reviewBeforeSubmit":True,"draftExpiryDays":30,"showProgress":True,"presentation":"grouped","guidanceMode":"text","narrationAutoplay":False,"allowVoiceQuestions":False,"retentionPolicyKey":"standard-intake","responseAccess":"anonymous","confirmationKey":"confirmation"},"dependencies":[],"assets":[]}

def valid_closed_t21_package(package):
    root={"schemaVersion","engineContract","contractVersion","kind","formKey","definitionVersion","titleKey","descriptionKey","defaultLocale","supportedLocales","data","flow","expressions","guidance","translations","theme","policies","dependencies","assets"}
    if not isinstance(package,dict) or set(package)!=root:
        return False
    if [package.get(k) for k in ("schemaVersion","engineContract","contractVersion")] != ["4.0.0"]*3 or package.get("kind")!="smart-form-package":
        return False
    english=package.get("translations",{}).get("en",{})
    return (isinstance(package.get("data",{}).get("fields"),list)
            and isinstance(package.get("flow",{}).get("phases"),list)
            and set(english)=={"direction","reviewState","messages","pronunciations"}
            and english.get("reviewState") in {"pending-native-review","approved","rejected"})
def t21_bytes(case):
    import copy
    valid=base_candidate();base=canonical(valid)
    if case=="duplicate-keys": return base.replace(b'"formKey":"candidate-a"',b'"formKey":"candidate-a","formKey":"candidate-b"')
    d=copy.deepcopy(valid)
    if case=="executable-property":d["onload"]="alert(1)"
    elif case=="unsupported-component-url":d["component"]={"url":"https://evil.invalid/component.js"}
    elif case=="unknown-operator":d["expressions"]["untrusted"]={"op":"eval","args":[]}
    elif case=="unknown-field-type":d["data"]["fields"][0]["type"]="script"
    elif case=="invalid-unicode":return base[:-1]+b',"label":"\xed\xa0\x80"}'
    elif case in {"cross-tenant-candidate","expired-candidate"}: pass
    elif case=="forged-approval": d["translations"]["en"]["reviewState"]="approved"
    elif case=="depth-bomb":
        value=0
        for n in range(20,0,-1):value={f"d{n:02d}":value}
        d["depthProbe"]=value
    elif case=="size-bomb":
        d["padding"]="";shell=canonical(d);return shell[:-2]+b"x"*(5*1024*1024+1-len(shell))+b'"}'
    else: fail(f"unknown T21 case {case}")
    return canonical(d)
def object_depth(value):
    if isinstance(value, dict): return 1 + max((object_depth(v) for v in value.values()), default=0)
    if isinstance(value, list): return max((object_depth(v) for v in value), default=0)
    return 0

def check_t21():
    p=load("t21-hostile-imports.json")["frozenInputProtocol"]
    cases=p["cases"]; payloads={x["id"]:x for x in p["primaryPayloads"]}
    require("payloadBytes" not in p and "generators" not in p, "T21 has no alternate payload maps")
    require(len(cases)==11 and len(payloads)==11, "T21 exact 11 primary attacks")
    require(sha(bytes.fromhex(p["baseCandidate"]["utf8Hex"])) == p["baseCandidate"]["sha256"], "T21 base hash")
    guards={c["id"]:c["intendedGuard"] for c in cases}
    expected_statuses={
        "duplicate-keys":[400], "executable-property":[422], "unsupported-component-url":[422],
        "unknown-operator":[422], "unknown-field-type":[422], "depth-bomb":[422],
        "size-bomb":[413], "invalid-unicode":[400], "cross-tenant-candidate":[200,403],
        "expired-candidate":[200,410], "forged-approval":[200,403],
    }
    for c in cases:
        entry=payloads[c["id"]]; raw=t21_bytes(c["id"])
        if entry["source"] == "exact-bytes":
            require(raw.hex()==entry["utf8Hex"], f"T21 exact primary bytes {c['id']}")
            expected_count, expected_hash=entry["byteCount"], entry["sha256"]
        else:
            generated=entry["generator"]
            require(generated["id"]==c["id"] and generated["intendedGuard"]==guards[c["id"]], f"T21 intended guard {c['id']}")
            expected_count, expected_hash=generated["producedByteCount"], generated["producedSha256"]
        require(len(raw)==expected_count and sha(raw)==expected_hash, f"T21 bytes {c['id']}")
        require(c["verify"]["byteCount"]==len(raw) and c["verify"]["sha256"]==sha(raw), f"T21 verify {c['id']}")
        require(c["intendedGuard"]==guards[c["id"]] and c["expect"]=="reject before persistence", f"T21 guard {c['id']}")
        require(c.get("expectedHttpStatuses")==expected_statuses[c["id"]], f"T21 authoritative HTTP statuses {c['id']}")
    duplicate=t21_bytes("duplicate-keys")
    require(duplicate[:1]==b"{" and duplicate[-1:]==b"}", "T21 duplicate payload is an object, not quoted JSON")
    pairs=json.loads(duplicate, object_pairs_hook=lambda entries: entries)
    require(sum(key=="formKey" for key, _ in pairs)==2 and b'"formKey":"candidate-a","formKey":"candidate-b"' in duplicate, "T21 actual duplicate keys")
    require(object_depth(json.loads(t21_bytes("depth-bomb"))) == 21, "T21 depth exactly 21")
    require(len(t21_bytes("size-bomb")) == 5*1024*1024+1, "T21 size exactly 5 MiB + 1")
    invalid=t21_bytes("invalid-unicode"); require(invalid.startswith(canonical(base_candidate())[:-1]) and invalid.endswith(b'"\xed\xa0\x80"}'), "T21 malformed Unicode mutates only one raw member")
    require(all(payloads[cid]["mutation"] for cid in payloads), "T21 exact one-mutation descriptors")
    executable=json.loads(t21_bytes("executable-property"))
    require(executable["onload"]=="alert(1)", "T21 executable property is actual input")
    for cid in ("executable-property", "unsupported-component-url", "unknown-operator", "unknown-field-type", "cross-tenant-candidate", "expired-candidate", "forged-approval", "depth-bomb", "size-bomb"):
        raw=t21_bytes(cid)
        if cid not in {"size-bomb"}:
            decoded=json.loads(raw); package=decoded
            require(package["schemaVersion"]==package["engineContract"]==package["contractVersion"]=="4.0.0" and package["kind"]=="smart-form-package" and {"formKey","data","flow"} <= set(package), f"T21 valid package mutation {cid}")
    for cid in ("cross-tenant-candidate", "expired-candidate", "forged-approval"):
        require(json.loads(t21_bytes(cid)) == (base_candidate() if cid != "forged-approval" else {**base_candidate(), "translations":{**base_candidate()["translations"], "en":{**base_candidate()["translations"]["en"], "reviewState":"approved"}}}), f"T21 {cid} raw bytes are canonical package only")
        guard=next(row for row in cases if row["id"]==cid)["guardReachability"]
        state=p["serverOwnedCaseStates"][cid]
        required_state={"candidateActor","candidateWorkspace","candidateTenant","validateWorkspace","validateTenant","commitWorkspace","commitTenant","sourceFormId","sourceDraftId","targetFormId","targetDraftId","mode","policyVersion","candidateDigestInput","expiresAt","evaluationClock","competingGuards","exclusiveGuard","exactlyOneTargetMismatch"}
        require(guard.get("validateThenCommit") is True and guard.get("candidateIdFromValidate")=="/candidateId" and guard.get("candidateDigestFromValidate")=="/candidateDigest" and guard.get("onlyServerOwnedState")==state and guard.get("malformedEnvelopeCannotReachGuard") is True and required_state <= set(state) and sum(state["competingGuards"].values())==1 and state["competingGuards"].get(state["exclusiveGuard"]) is True, f"T21 {cid} reaches only its fully materialized exclusive server-owned candidate guard")
    forged=json.loads(t21_bytes("forged-approval"))
    require(valid_closed_t21_package(forged), "T21 forged approval validates against the closed package schema")
    require(forged["translations"]["en"]["reviewState"]=="approved" and p["serverOwnedCaseStates"]["forged-approval"]["trustedApproval"] is False, "T21 declared approved translation cannot grant trusted approval")
    expired=p["serverOwnedCaseStates"]["expired-candidate"]
    require(expired["candidateLifetime"]=="PT24H" and expired["expiresAtEqualsCreationPlus"]=="PT24H" and expired["validateResponseExpiresAt"]=="2026-09-14T00:00:00Z" and expired["candidateValidAtValidationClock"] is True and datetime.fromisoformat(expired["validateResponseExpiresAt"].replace("Z","+00:00"))-datetime.fromisoformat(expired["creationClock"].replace("Z","+00:00"))==timedelta(hours=24), "T21 expiry is exact validation creation plus 24h")
    for entry in payloads.values():
        request=entry["normativeValidateRequest"]
        raw=t21_bytes(entry["id"])
        prefix=bytes.fromhex(request["packageMemberPrefixUtf8Hex"]); suffix=bytes.fromhex(request["packageMemberSuffixUtf8Hex"])
        if "requestUtf8Hex" in request:
            envelope=bytes.fromhex(request["requestUtf8Hex"])
            require(envelope == prefix + raw + suffix and sha(envelope)==request["requestSha256"], f"T21 final validate envelope bytes {entry['id']}")
        else:
            require(request.get("requestGenerator",{}).get("algorithm")=="validate-envelope-with-hostile-package-member/v1" and request["requestByteCount"]==len(prefix)+len(raw)+len(suffix) and request["requestSha256"]==sha(prefix+raw+suffix), f"T21 generated final validate envelope {entry['id']}")

def check_t22(deep=True):
    from t22_dataset_generator import DATASETS, canonical as t22_canonical, generate
    from t22_export_bundle import CSV_BUNDLE_FORMAT, build_export_artifacts, verify_export_artifacts
    from t22_workload_runner import EXPORT_CREATE_OPERATIONS, INVENTORY, OPS, PROVISIONING, THRESHOLDS, WORKLOADS, RESOURCE_CEILINGS, ExportJobHandle, apply_handle_delta, apply_measurements, evidence_envelope, export_job_binding_plan, load_operations, materialization_plan, resolve_browser_discovery, result_base, run, save_submit_load, validate_browser_evidence, validate_raw_result_contract, verify_export_downloads
    p=load("t22-scale-limits.json")["frozenInputProtocol"]
    require(p["executionStatus"]=="not-run", "T22 corpus execution status")
    require(len(p["workloads"])==8 and len(p["commands"])==8 and set(WORKLOADS)=={x["id"] for x in p["workloads"]}, "T22 workloads/commands")
    require(len(p["datasets"])==8 and set(DATASETS)=={x["id"] for x in p["datasets"]}, "T22 datasets")
    require(len(p["limits"])==11 and all(x["plusOne"]==x["limit"]+1 for x in p["limits"]), "T22 limit + 1")
    require(sha(INVENTORY.read_bytes())==p["operationInventory"]["sha256"], "T22 operation inventory pin")
    operations=load_operations(); require(set(OPS.values()) <= set(operations), "T22 only O_named operations")
    require(p["protocolVersion"] == "t22-scale-v5", "T22 v5 protocol")
    require(p.get("apiExportJobBinding") == export_job_binding_plan(), "T22 frozen explicit product export job binding plan")
    require(p["rawResultSchema"]["schemaVersion"] == "t22-raw-result/v4", "T22 v4 result schema")
    require({"stageExecution", "setupSamples", "measurementSamples", "latencyBuckets", "exportJobChains", "thresholdFailures", "blockers"} <= set(p["rawResultSchema"]["required"]) and not ({"browserEvidence", "browserChannelDiscovery", "browserChannelDiscoveryRaw", "browserChannelDiscoveryArtifactSha256"} & set(p["rawResultSchema"]["required"])), "T22 generic raw result schema excludes conditional browser evidence")
    require(p["rawResultSchema"].get("requiredNonNull") == ["runId", "startedAtUtc", "endedAtUtc"] and p["rawResultSchema"].get("browserDiscoveryConditional") == {"workloads":["complex-form","respondent-runtime","accessibility-browser"],"whenExecutionStatus":"executed","fields":["browserEvidence","browserChannelDiscovery","browserChannelDiscoveryRaw","browserChannelDiscoveryArtifactSha256","browserReleaseAuthorities"],"nonBrowser":"allowed-null-or-absent"}, "T22 conditional browser discovery raw-result schema")
    require(p["rawResultSchema"].get("saveSubmitSampleRequired") == ["sessionId"], "T22 save-submit samples bind active sessions")
    ordered_handles={"parent":{"changed":"before","removed":"gone","sibling":"kept"},"topSibling":"kept","__handleVersion":4}
    apply_handle_delta(ordered_handles,{"baseVersion":4,"operations":[{"op":"set","path":["parent","changed"],"value":"after"},{"op":"delete","path":["parent","removed"]}]})
    require(ordered_handles=={"parent":{"changed":"after","sibling":"kept"},"topSibling":"kept","__handleVersion":5}, "T22 ordered handle set/delete delta preserves siblings")
    for delta in ({"baseVersion":4,"operations":[{"op":"set","path":["x"],"value":1}]},{"baseVersion":5,"operations":[{"op":"delete","path":["parent","missing"]}]},{"baseVersion":5,"operations":[{"op":"set","path":["__handleVersion"],"value":6}]}):
        try: apply_handle_delta(ordered_handles,delta)
        except RuntimeError: continue
        fail("T22 stale/invalid handle delta was accepted")
    require(p["generatorTool"]["version"] == "t22-dataset/v3" and p["runnerTool"]["version"] == "t22-runner/v6", "T22 pinned code versions")
    probe=p.get("browserDiscoveryProbe", {})
    require(probe.get("schemaVersion") == "t22-browser-discovery-probe/v3" and probe.get("ownedProbe", {}).get("repoRelativePath") == "assets/t22_browser_discovery_probe.py" and probe.get("ownedProbe", {}).get("invocation") == ["{ownedProbePath}", "--config-id", "{configId}"] and probe.get("ownedProbe", {}).get("mode") == 755, "T22 frozen evaluator-owned browser probe contract")
    owned_probe = ROOT / "t22_browser_discovery_probe.py"
    require(probe.get("ownedProbe", {}).get("sha256") == sha(owned_probe.read_bytes()) and stat.S_IMODE(owned_probe.stat().st_mode) == 0o755, "T22 owned browser probe SHA-256 and executable-mode pins")
    webdriver_schema=probe["sourceSchemas"]["webdriver-capabilities"]
    require(webdriver_schema["browserSourceKeys"] == ["endpointUrl","endpointAuthority","providerHttp","providerResponse"] and probe["releaseAuthorities"]["maximumAgeSeconds"] == 3600, "T22 preserves raw provider HTTP evidence and freezes release freshness")
    require("outer finally" in probe["execution"] and "session-scoped provider AT" in probe["sourceSchemas"]["native-version-command"]["rawProviderResponse"] and "Evaluator-host" in probe["sourceSchemas"]["native-version-command"]["rawProviderResponse"], "T22 binds AT/session lifecycle without evaluator-host substitution")
    require(all("--adapter" in row["executionCommand"] and "--dry-run" in row["dryRunCommand"] for row in p["commands"]), "T22 command adapter/dry-run semantics")
    if not deep:
        return
    generated={name:generate(name) for name in DATASETS}
    non_browser_contract=result_base("api-export","cold",generated["responses-10000"],1,1,materialization_plan("api-export","cold",generated["responses-10000"],1,1),"executed")
    for field in ("browserEvidence","browserChannelDiscovery","browserChannelDiscoveryRaw","browserChannelDiscoveryArtifactSha256","browserReleaseAuthorities"): non_browser_contract.pop(field)
    require(validate_raw_result_contract(non_browser_contract,p["rawResultSchema"]), "T22 non-browser raw result allows absent browser discovery fields")
    browser_contract=result_base("complex-form","cold",generated["complex-1000"],1,1,materialization_plan("complex-form","cold",generated["complex-1000"],1,1),"executed")
    browser_contract["browserChannelDiscoveryArtifactSha256"]="0"*64
    browser_contract["browserReleaseAuthorities"]=[]
    require(validate_raw_result_contract(browser_contract,p["rawResultSchema"]), "T22 executed browser raw result requires non-null discovery fields")
    browser_contract["browserChannelDiscoveryArtifactSha256"]=None
    require(not validate_raw_result_contract(browser_contract,p["rawResultSchema"]), "T22 executed browser raw result rejects null discovery field")
    for name,value in generated.items():
        copy=dict(value); observed=copy.pop("sha256"); require(sha(t22_canonical(copy))==observed, f"T22 deterministic hash {name}")
        require(value["generatorVersion"]=="t22-dataset/v3" and value["operationIntents"], f"T22 intents {name}")
        require(all("path" not in intent and intent["operationId"] in operations for intent in value["operationIntents"]), f"T22 no invented route {name}")
        bundle=value["objectBundle"]; require({"package","form","release","session","answers","request"} <= set(bundle) and bundle["answers"], f"T22 complete object bundle {name}")
    require(len(generated["catalog-10000"]["forms"])==10000 and len(generated["catalog-10000"]["releases"])==100, "T22 catalog dimensions")
    complex_data=generated["complex-1000"]; package=complex_data["package"]; require(package["schemaVersion"]==package["engineContract"]==package["contractVersion"]=="4.0.0" and package["kind"]=="smart-form-package" and {"formKey","data","flow"} <= set(package), "T22 canonical package")
    page_count=sum(len(phase["pages"]) for phase in package["flow"]["phases"])
    def recursive_definitions(field):
        yield field
        for child in field.get("properties", []): yield from recursive_definitions(child)
        for schema in (field.get("itemSchema"), field.get("rowSchema")):
            if isinstance(schema, dict): yield from recursive_definitions(schema)
    require(len(complex_data["instances"])==2000 and page_count==100 and len([child for field in package["data"]["fields"] for child in recursive_definitions(field)])==1000 and len(package["expressions"])==500, "T22 complex dimensions")
    repeater=package["data"]["fields"][0]; require(repeater["type"]=="list" and repeater["itemSchema"]["properties"][0]["itemSchema"]["properties"][0]["itemSchema"]["properties"][0]["type"]=="integer", "T22 canonical three-level repeater")
    require("repeaters" not in package and all("answers" in item for item in complex_data["instances"]), "T22 no private root repeaters")
    def graph_ids(pkg): return {field["id"] for field in pkg["data"]["fields"]}
    for name,value in generated.items():
        package_for_answers=value.get("package") or value["objectBundle"]["package"]
        release_packages={release["id"]:(value.get("package") or value["objectBundle"]["package"]) for release in value.get("releases", [])}
        if "forms" in value and "releases" in value:
            release_packages.update({release["id"] : form["package"] for release,form in zip(value["releases"],value["forms"])})
        allowed=graph_ids(package_for_answers)
        sessions=value.get("sessions", []) + ([value["session"]] if "session" in value else [])
        for session_value in sessions:
            session_allowed=graph_ids(release_packages.get(session_value["releaseId"], package_for_answers))
            require(set(session_value["answers"]) <= session_allowed and all(answer.get("status") == "answered" for answer in session_value["answers"].values()), f"T22 graph-bound session answers {name}")
    require(set().union(*(set(row["answers"]) for row in generated["responses-10000"]["responses"])) <= graph_ids(generated["responses-10000"]["package"]), "T22 graph-bound response answers")
    target_export=generated["responses-10000"]
    require(len(target_export["responses"])==10000 and target_export["distractorForm"]["id"]!=target_export["targetForm"]["id"] and target_export["distractorResponses"] and all(row["formId"]==target_export["targetForm"]["id"] for row in target_export["responses"]) and all(row["formId"]==target_export["distractorForm"]["id"] for row in target_export["distractorResponses"]), "T22 export dataset contains exact target 10000 plus excluded distractor-form responses")
    # The actual export artifacts are deterministic bytes, not metadata claims.
    export_dataset=generated["responses-10000"]; export_bytes=build_export_artifacts(export_dataset)
    verified=verify_export_artifacts(export_dataset,export_bytes["json"],export_bytes[CSV_BUNDLE_FORMAT])
    require(verified["responseCount"]==10000 and len(verified["bundleFiles"])==6, "T22 actual JSON/relational CSV export success")
    import io, zipfile
    def expect_export_reject(json_bytes, bundle_bytes, reason):
        try: verify_export_artifacts(export_dataset,json_bytes,bundle_bytes)
        except ValueError: return
        fail("T22 export mutation was accepted: "+reason)
    # Every mutation is actual bytes, re-parsed by the production verifier.
    text_id, integer_id, repeater_id=[field["id"] for field in export_dataset["package"]["data"]["fields"]]
    require(export_dataset["package"]["data"]["fields"][0]["type"]=="text" and export_dataset["package"]["data"]["fields"][1]["type"]=="integer" and export_dataset["package"]["data"]["fields"][2]["type"]=="list", "T22 export package declares distinct typed fields")
    require(isinstance(export_dataset["exportDictionary"],list) and all({"fieldId","keyPath","type","unit","parentFieldId","optionIds","ordered"} <= set(row) for row in export_dataset["exportDictionary"]), "T22 authoritative graph data dictionary")
    # These mutate the graph/dictionary independently of the generated bytes;
    # the verifier must not merely regenerate its own expected export.
    import copy
    def expect_graph_reject(mutator, reason):
        candidate=copy.deepcopy(export_dataset); mutator(candidate)
        try: verify_export_artifacts(candidate,export_bytes["json"],export_bytes[CSV_BUNDLE_FORMAT])
        except ValueError: return
        fail("T22 graph mutation was accepted: "+reason)
    # Explicit assignments keep the adversarial mutations readable.
    def changed_child_type(d): d["package"]["data"]["fields"][2]["itemSchema"]["properties"][0]["type"]="text"
    def wrong_parent(d): d["exportDictionary"][3]["parentFieldId"]=d["exportDictionary"][1]["fieldId"]
    def wrong_path_order(d): d["exportDictionary"][3]["keyPath"]=list(reversed(d["exportDictionary"][3]["keyPath"])); d["exportDictionary"][3]["ordered"]=False
    expect_graph_reject(changed_child_type,"changed child type")
    expect_graph_reject(wrong_parent,"wrong dictionary parent")
    expect_graph_reject(wrong_path_order,"wrong dictionary keyPath/order")
    changed=json.loads(export_bytes["json"]); changed["responses"][0]["answers"][text_id]["value"]="changed"; expect_export_reject(t22_canonical(changed)+b"\n",export_bytes[CSV_BUNDLE_FORMAT],"changed answer")
    bad_integer=json.loads(export_bytes["json"]); bad_integer["responses"][2]["answers"][integer_id]["value"]=9007199254740993; expect_export_reject(t22_canonical(bad_integer)+b"\n",export_bytes[CSV_BUNDLE_FORMAT],"non-string 2^53+1 integer")
    def mutate_bundle(mutator):
        with zipfile.ZipFile(io.BytesIO(export_bytes[CSV_BUNDLE_FORMAT])) as source:
            files={name:source.read(name) for name in source.namelist()}
        mutator(files)
        from t22_export_bundle import deterministic_zip
        return deterministic_zip(files)
    expect_export_reject(export_bytes["json"],mutate_bundle(lambda files: files.__setitem__("responses.csv",files["responses.csv"].replace(b"'=SUM(A1:A2)",b"=SUM(A1:A2)",1))),"unescaped formula")
    expect_export_reject(export_bytes["json"],mutate_bundle(lambda files: files.__setitem__("repeater_level_2.csv",files["repeater_level_2.csv"].replace(b"-l1-",b"-missing-",1))),"broken parent linkage")
    expect_export_reject(export_bytes["json"],mutate_bundle(lambda files: files.__setitem__("repeater_level_1.csv",files["repeater_level_1.csv"].replace(b",0,,\n",b",0,forbidden-scalar,\n",1))),"scalar value attributed to list field")
    expect_export_reject(export_bytes["json"],mutate_bundle(lambda files: files.pop("data_dictionary.csv")),"missing dictionary")
    expect_export_reject(export_bytes["json"],mutate_bundle(lambda files: files.pop("interpretation_manifest.json")),"missing interpretation manifest")
    expect_export_reject(export_bytes["json"],mutate_bundle(lambda files: files.pop("repeater_level_3.csv")),"missing repeater table file")
    expect_export_reject(export_bytes["json"],mutate_bundle(lambda files: files.__setitem__("extra.csv",b"x\n")),"extra CSV file")
    expect_export_reject(export_bytes["json"],mutate_bundle(lambda files: files.__setitem__("responses.csv",files["responses.csv"]+files["responses.csv"].splitlines()[1]+b"\n")),"duplicate root response row")
    duplicate_zip=io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore",UserWarning)
        with zipfile.ZipFile(duplicate_zip,"w") as duplicate_archive:
            with zipfile.ZipFile(io.BytesIO(export_bytes[CSV_BUNDLE_FORMAT])) as source:
                for name in source.namelist(): duplicate_archive.writestr(name,source.read(name))
                duplicate_archive.writestr("responses.csv",source.read("responses.csv"))
    expect_export_reject(export_bytes["json"],duplicate_zip.getvalue(),"duplicate bundle file")
    require({item["operation"]["fieldId"] for item in generated["durability-acknowledged-writes"]["acknowledgements"]} <= graph_ids(generated["durability-acknowledged-writes"]["package"]), "T22 graph-bound durability writes")
    require(len(generated["durability-acknowledged-writes"]["acknowledgements"])==20 and len(generated["durability-acknowledged-writes"]["faultSchedule"])==2, "T22 durability")
    require({"saveAnswer","validateSession","submit"} <= set(WORKLOADS["save-submit"][3]) and THRESHOLDS["save-submit"] == {"saveP95Milliseconds":1000,"submitP95Milliseconds":2000,"validationP95Milliseconds":1000,"errorRate":0.001}, "T22 separate save/submit/validation plan")
    frozen_save_load=save_submit_load(WORKLOADS["save-submit"][1],WORKLOADS["save-submit"][2],p["minimumSamplesPerBucket"])
    require(frozen_save_load.count("saveAnswer")==200 and frozen_save_load.count("validateSession")==p["minimumSamplesPerBucket"]["validation"] and frozen_save_load.count("submit")==p["minimumSamplesPerBucket"]["submit"], "T22 actual save-submit counts derive from frozen protocol minima")
    changed_minima=dict(p["minimumSamplesPerBucket"]); changed_minima.update({"validation":3,"submit":4})
    changed_save_load=save_submit_load(1,1,changed_minima)
    require(changed_save_load.count("validateSession")==3 and changed_save_load.count("submit")==4, "T22 save-submit execution does not hard-code terminal counts")
    require(THRESHOLDS["respondent-runtime"] == {"runtime100P95Milliseconds":3000,"complexRuntimeP95Milliseconds":5000}, "T22 separate runtime thresholds")
    require(p.get("durabilityProtocol",{}).get("writesBeforeRestart")==10 and p["durabilityProtocol"]["writesAfterRestart"]==10, "T22 exact durability protocol")
    require({"submissions","createExportJson","createExportRelationalCsv"} <= set(WORKLOADS["api-export"][3]) and {"cursor_page","export_complete","download_export"} <= set(materialization_plan("api-export", "cold", generated["responses-10000"], 1, 1)["requiredAdapterMethods"]), "T22 cursor/product-create-export plan")
    require({"restart","restore","verify_durability"} <= set(materialization_plan("durability", "cold", generated["durability-acknowledged-writes"], 1, 1)["requiredAdapterMethods"]), "T22 durability hooks")
    require("browser_instrument" in materialization_plan("accessibility-browser", "cold", generated["browser-at-matrix"], 1, 1)["requiredAdapterMethods"], "T22 browser hook")
    run_ids=set()
    for workload in WORKLOADS:
        plan=materialization_plan(workload, "cold", generated[WORKLOADS[workload][0]], WORKLOADS[workload][1], WORKLOADS[workload][2])
        require(plan["provisioningPlan"]==[{"step":step,"operationIds":[OPS[x] for x in semantics],"materialization":"runtime-adapter-required"} for step,semantics in PROVISIONING[workload]], f"T22 provisioning plan {workload}")
        dry, code=run(workload, "cold", None, None, True)
        required=p["rawResultSchema"]["required"]
        require(code==0 and dry["executionStatus"]=="dry-run" and all(key in dry for key in required), f"T22 complete dry result {workload}")
        require(isinstance(dry["runId"],str) and dry["runId"] and dry["runId"] not in run_ids and dry["startedAtUtc"] and dry["endedAtUtc"], f"T22 stable unique run identity {workload}"); run_ids.add(dry["runId"])
        require(len(dry["stageExecution"])==len(plan["provisioningPlan"])+11+3, f"T22 all limit/rate dry stages {workload}")
        blocked, code=run(workload, "cold", "http://example.invalid", None, False)
        require(code==2 and blocked["executionStatus"]=="blocked" and all(key in blocked for key in required), f"T22 complete blocked result {workload}")
    # Pure deterministic semantic tests: threshold and error-rate failures must not pass.
    data=generated["sessions-200"];plan=materialization_plan("save-submit","cold",data,20,10)
    def measured(workload, dataset, plan):
        value=result_base(workload,"cold",dataset,WORKLOADS[workload][1],WORKLOADS[workload][2],plan,"executed")
        value.update({"memoryBytesPeak":1,"resourceAllocation":{name:{key:value for key,value in values.items() if isinstance(value,(int,float))} for name,values in RESOURCE_CEILINGS.items() if isinstance(values,dict)},"cost":0,"rawSamplesArtifactSha256":"0"*64})
        return value
    failure=measured("save-submit",data,plan)
    failure["measurementSamples"]=[{"semantic":"saveAnswer","ordinal":0,"elapsedMilliseconds":1,"httpStatus":200,"errorClass":None},{"semantic":"validateSession","ordinal":1,"elapsedMilliseconds":1,"httpStatus":200,"errorClass":None},{"semantic":"submit","ordinal":2,"elapsedMilliseconds":2001,"httpStatus":200,"errorClass":None}]
    apply_measurements("save-submit",failure,{})
    require(failure["verdict"]=="failed" and "submitP95" in failure["thresholdFailures"], "T22 threshold failure")
    error=measured("save-submit",data,plan)
    error["measurementSamples"]=[{"semantic":"saveAnswer","ordinal":0,"elapsedMilliseconds":1,"httpStatus":500,"errorClass":"http"},{"semantic":"validateSession","ordinal":1,"elapsedMilliseconds":1,"httpStatus":200,"errorClass":None},{"semantic":"submit","ordinal":2,"elapsedMilliseconds":1,"httpStatus":200,"errorClass":None}]
    apply_measurements("save-submit",error,{})
    require(error["verdict"]=="failed" and "errorRate" in error["thresholdFailures"], "T22 error-rate failure")
    boundary=measured("save-submit",data,plan)
    boundary["measurementSamples"]=[{"semantic":"saveAnswer" if n < 996 else ("validateSession" if n < 998 else "submit"),"ordinal":n,"elapsedMilliseconds":1,"httpStatus":500 if n == 0 else 200,"errorClass":"http" if n == 0 else None} for n in range(1000)]
    apply_measurements("save-submit",boundary,{})
    require(boundary["errorRate"] == 0.001 and boundary["verdict"]=="failed" and "errorRate" in boundary["thresholdFailures"], "T22 exact error-rate boundary fails")
    below=measured("save-submit",data,plan); below["measurementSamples"]=boundary["measurementSamples"]+[ {"semantic":"saveAnswer","ordinal":1000,"elapsedMilliseconds":1,"httpStatus":200,"errorClass":None} ]; apply_measurements("save-submit",below,{})
    require(below["errorRate"] < 0.001 and below["verdict"]=="passed", "T22 just-below error rate passes")
    zero=measured("save-submit",data,plan); zero["measurementSamples"]=boundary["measurementSamples"][1:]; apply_measurements("save-submit",zero,{})
    require(zero["errorRate"] == 0 and zero["verdict"]=="passed", "T22 zero error rate")
    over_resource=copy.deepcopy(zero); over_resource["resourceAllocation"]["application"]["cpuCores"]=RESOURCE_CEILINGS["application"]["cpuCores"]+1; apply_measurements("save-submit",over_resource,{})
    require("resource-ceilings" in over_resource["thresholdFailures"], "T22 exceeded resource ceiling fails")
    zero_resource=copy.deepcopy(zero); zero_resource["resourceAllocation"]["databaseOrDurableStorage"]["memoryGiB"]=0; apply_measurements("save-submit",zero_resource,{})
    require("resource-ceilings" in zero_resource["thresholdFailures"], "T22 zero resource allocation fails")
    changed_ceiling=copy.deepcopy(zero); changed_ceiling["resourceCeilings"]["client"]["memoryGiB"]=99; apply_measurements("save-submit",changed_ceiling,{})
    require("resource-ceilings" in changed_ceiling["thresholdFailures"], "T22 changed resource ceiling binding fails")
    browser=measured("accessibility-browser",generated["browser-at-matrix"],materialization_plan("accessibility-browser","cold",generated["browser-at-matrix"],1,1))
    apply_measurements("accessibility-browser",browser,{"instrumentation":False})
    require(browser["verdict"]=="failed" and {"localRenderMillisecondsP95","firstUsableMillisecondsP95","instrumentation"} <= set(browser["thresholdFailures"]), "T22 browser hook absence")
    compile_data=generated["compile-1000"]; compile_plan=materialization_plan("import-compile","cold",compile_data,1,1)
    fast=measured("import-compile",compile_data,compile_plan); fast["measurementSamples"]=[{"bucket":"valid-compile","elapsedMilliseconds":100,"httpStatus":200,"errorClass":None},{"bucket":"valid-compile","elapsedMilliseconds":101,"httpStatus":200,"errorClass":None},{"bucket":"valid-commit","elapsedMilliseconds":9000,"httpStatus":201,"errorClass":None},{"bucket":"invalid-bounded-rejection","elapsedMilliseconds":1,"httpStatus":422,"errorClass":None},{"bucket":"progress-poll","elapsedMilliseconds":1,"httpStatus":200,"errorClass":None}]; apply_measurements("import-compile",fast,{"slowCompileWithoutVisibleProgress":False})
    require(fast["verdict"]=="passed", "T22 fast compile without progress and slow commit passes")
    slow_visible=measured("import-compile",compile_data,compile_plan); slow_visible["measurementSamples"]=[{"bucket":"valid-compile","elapsedMilliseconds":3000,"httpStatus":200,"errorClass":None}]; apply_measurements("import-compile",slow_visible,{"slowCompileWithoutVisibleProgress":False})
    require(slow_visible["verdict"]=="failed" and "valid-compileP95" in slow_visible["thresholdFailures"], "T22 below-count compile fails")
    slow_missing=measured("import-compile",compile_data,compile_plan); slow_missing["measurementSamples"]=[{"bucket":"valid-compile","elapsedMilliseconds":3000,"httpStatus":200,"errorClass":None}]; apply_measurements("import-compile",slow_missing,{"slowCompileWithoutVisibleProgress":True})
    require(slow_missing["verdict"]=="failed" and "compileProgressVisibility" in slow_missing["thresholdFailures"], "T22 slow compile missing progress fails")
    export=measured("api-export",generated["responses-10000"],materialization_plan("api-export","cold",generated["responses-10000"],1,1)); export["measurementSamples"]=[{"bucket":"export","elapsedMilliseconds":1,"httpStatus":200,"errorClass":None},{"bucket":"export","elapsedMilliseconds":1,"httpStatus":200,"errorClass":None}]; apply_measurements("api-export",export,{"cursorIntegrity":True,"downloadCount":2,"exportArtifactsValid":False})
    require(export["verdict"]=="failed" and "exportArtifacts" in export["thresholdFailures"], "T22 invalid export artifacts fail")
    durability=measured("durability",generated["durability-acknowledged-writes"],materialization_plan("durability","cold",generated["durability-acknowledged-writes"],1,1))
    durability["measurementSamples"]=[{"semantic":"saveAnswer","ordinal":0,"elapsedMilliseconds":1,"httpStatus":200,"errorClass":None}]
    apply_measurements("durability",durability,{"dataLoss":0,"exactAcknowledgedWrites":20,"noCorruption":True,"noTruncation":True,"queuedClientMutationsPreserved":True,"verifiedExactState":True,"backupRpoHours":25,"restoreRtoHours":5})
    require(durability["verdict"]=="failed" and "rpo-rto-or-state" in durability["thresholdFailures"], "T22 RPO/RTO failure")
    integrity=measured("durability",generated["durability-acknowledged-writes"],materialization_plan("durability","cold",generated["durability-acknowledged-writes"],1,1)); integrity["measurementSamples"]=[{"semantic":"saveAnswer","ordinal":0,"elapsedMilliseconds":1,"httpStatus":200,"errorClass":None}]
    apply_measurements("durability",integrity,{"dataLoss":0,"exactAcknowledgedWrites":20,"verifiedExactState":True,"backupRpoHours":1,"restoreRtoHours":1,"noCorruption":False,"noTruncation":True,"queuedClientMutationsPreserved":True})
    require(integrity["verdict"]=="failed" and "noCorruption" in integrity["thresholdFailures"] and "noTruncation" not in integrity["thresholdFailures"], "T22 false integrity evidence fails exactly")
    missing=measured("durability",generated["durability-acknowledged-writes"],materialization_plan("durability","cold",generated["durability-acknowledged-writes"],1,1)); missing["measurementSamples"]=[{"semantic":"saveAnswer","ordinal":0,"elapsedMilliseconds":1,"httpStatus":200,"errorClass":None}]
    apply_measurements("durability",missing,{"dataLoss":0,"exactAcknowledgedWrites":20,"verifiedExactState":True,"backupRpoHours":1,"restoreRtoHours":1,"noCorruption":True,"noTruncation":True})
    require(missing["verdict"]=="failed" and "queuedClientMutationsPreserved" in missing["thresholdFailures"], "T22 missing integrity evidence fails")
    # Deterministic execution-path tests use an ephemeral adapter and a patched HTTP transport; no product call occurs.
    import tempfile, t22_workload_runner as runner
    adapter_code="""def prepare_phase(*a): return {'isolated':True}
def provision(*a): return {'w':'w','f':'f','d':'d','s':'s','shareid':'share','shareId':'share','candidateid':'c','candidateId':'c'}
def materialize(workload,semantic,dataset,handles,ordinal):
 if semantic=='createExportJson': return {'body':{'format':'json'}}
 if semantic=='createExportRelationalCsv': return {'body':{'format':'relational-csv-bundle'}}
 return {'body':{}}
def extract(*a): return None
def capture_telemetry(*a): return {'memoryBytesPeak':1,'resourceAllocation':{'application':{'cpuCores':4,'memoryGiB':8,'monthlyCostUsd':500},'client':{'cpuCores':4,'memoryGiB':8,'monthlyCostUsd':100},'databaseOrDurableStorage':{'cpuCores':4,'memoryGiB':16,'monthlyCostUsd':750},'loadGenerator':{'cpuCores':4,'memoryGiB':8,'monthlyCostUsd':250},'objectStorage':{'cpuCores':1,'memoryGiB':1,'monthlyCostUsd':100},'network':{'egressGiB':1000,'monthlyCostUsd':100}},'cost':0}
def measure_local_complex_render(*a): return 1
def measure_browser_long_tasks(*a): return 0
def measure_first_usable_input(*a): return 1
def cursor_page(*a): return {'noDuplicate':True,'noMissing':True,'elapsedMilliseconds':1}
def export_complete(workload,bound_job_id,format_name): return {'completed':True,'completionMilliseconds':1,'exportJobId':bound_job_id,'format':format_name,'status':'completed'}
def download_export(workload,bound_job_id,format_name,dataset):
  import hashlib
  from t22_export_bundle import CSV_BUNDLE_CONTENT_TYPE,CSV_BUNDLE_FORMAT,JSON_CONTENT_TYPE,build_export_artifacts
  fmt=format_name; ct=JSON_CONTENT_TYPE if fmt=='json' else CSV_BUNDLE_CONTENT_TYPE; raw=build_export_artifacts(dataset)[fmt]
  return {'downloaded':True,'elapsedMilliseconds':1,'exportJobId':bound_job_id,'format':fmt,'status':'downloaded','contentType':ct,'artifactId':'artifact-'+fmt,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':raw,'rowCount':len(dataset['responses']),'complete':True,'noTruncation':True}
def start_compile(workload,candidate,handles): return {'jobHandle':candidate['kind']+'-job'}
def read_compile_progress(workload,job,handles): return {'complete':True,'visibleJobStatus':True,'progress':100,'elapsedMilliseconds':1}
def compile_verdict(workload,job,handles): return {'accepted':job.startswith('valid'),'elapsedMilliseconds':1}
def commit_candidate(*a): return {'committed':True,'elapsedMilliseconds':1}
def browser_instrument(*a):
 from t22_dataset_generator import generate
 h=a[1]; ident=h.get('packageHandle','form-runtime-100'); config=h.get('browserMatrixConfigId','default'); ordinal=h.get('observationOrdinal',0)
 slot=h['browserDiscoverySlot']
 return {'localRenderMilliseconds':1,'firstUsableMilliseconds':1,'packageIdentity':ident,'browserMatrixConfigId':config,'observationId':ident+'-'+config+'-'+str(ordinal),'browser':slot['browser'],'browserVersion':slot['browserVersion'],'device':slot['device'],'os':slot['os'],'osVersion':slot['osVersion'],'at':slot['at'],'atVersion':slot['atVersion'],'resolvedChannel':slot['requestedChannel'],'resolutionTimestampUtc':slot['resolvedAtUtc'],'detection':slot['detection'],'transportEvidence':h['browserTransportBinding']}
def exercise_limit(limit,*a): return {'verified':True,**limit['expected']}
def exercise_rate_control(*a): return {'verified':True,'httpStatus':429,'queuedClientMutationsPreserved':True,'requiredHeader':'Retry-After'}
"""
    adapter_code=adapter_code.replace("{'format':'json'}",repr(EXPORT_CREATE_OPERATIONS["createExportJson"]["request"])).replace("{'format':'relational-csv-bundle'}",repr(EXPORT_CREATE_OPERATIONS["createExportRelationalCsv"]["request"]))
    matrix_by_id={row["id"]:row for row in generated["browser-at-matrix"]["browserMatrix"]}
    native_seam={}
    for config_id,config in matrix_by_id.items():
        if config["at"]!="none":
            native_seam[config_id]={"native":{"accessibility":{"name":config["at"],"version":"native-test"},"platform":{"name":config["os"],"version":"test"},"device":"fake-"+config_id},"providerResponses":[{"command":["selfcheck-native","fake-"+config_id],"stdout":"native-test"}]}
    class FakeWebDriver(BaseHTTPRequestHandler):
        fabricate_nonstandard_at=False
        sessions=[]
        deleted=[]
        def log_message(self,*args): pass
        def do_POST(self):
            request=json.loads(self.rfile.read(int(self.headers["Content-Length"])).decode("utf-8")); desired=request["capabilities"]["alwaysMatch"]
            browser={"chrome":"Chrome","MicrosoftEdge":"Edge","firefox":"Firefox","safari":"Safari"}[desired["browserName"]]; channel=desired["t22:requestedChannel"]; system=desired["platformName"]
            config_id=next(key for key,value in matrix_by_id.items() if value["browser"]==browser and value["requestedChannel"]==channel and value["os"]==system)
            caps={"browserName":browser.lower() if browser!="Edge" else "MicrosoftEdge","browserVersion":"127.0" if channel=="latest" else "126.0","platformName":system,"platformVersion":"test"}
            if system in ("Android","iOS"):
                caps.update({"appium:deviceName":"mobile","appium:udid":"fake-"+config_id})
            else: caps["se:containerName"]="fake-"+config_id
            if self.fabricate_nonstandard_at: caps.update({"accessibilityName":"fabricated","accessibilityVersion":"0"})
            self.__class__.sessions.append(desired); payload=json.dumps({"value":{"sessionId":"fake-session-"+config_id,"capabilities":caps}},separators=(",",":")).encode()
            self.send_response(200);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(payload)));self.end_headers();self.wfile.write(payload)
        def do_DELETE(self):
            self.__class__.deleted.append(self.path);self.send_response(200);self.send_header("Content-Length","0");self.end_headers()
    class ReleaseCatalog(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def do_GET(self):
            browser=self.path.rsplit('/',1)[-1]; payload=json.dumps({"browser":browser,"latestMajor":127,"previousMajor":126,"publishedAtUtc":datetime.utcnow().replace(microsecond=0).isoformat()+"Z"}).encode()
            self.send_response(200);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(payload)));self.end_headers();self.wfile.write(payload)
    webdriver=ThreadingHTTPServer(("127.0.0.1",0),FakeWebDriver); release_catalog=ThreadingHTTPServer(("127.0.0.1",0),ReleaseCatalog)
    webdriver_thread=threading.Thread(target=webdriver.serve_forever,daemon=True); webdriver_thread.start(); release_thread=threading.Thread(target=release_catalog.serve_forever,daemon=True); release_thread.start()
    original_webdriver_endpoint=os.environ.get("T22_WEBDRIVER_ENDPOINT"); original_test_mode=os.environ.get("T22_BROWSER_PROBE_TEST_MODE"); original_release_base=os.environ.get("T22_RELEASE_AUTHORITY_TEST_BASE_URL")
    os.environ["T22_WEBDRIVER_ENDPOINT"]=f"http://127.0.0.1:{webdriver.server_port}"; os.environ["T22_BROWSER_PROBE_TEST_MODE"]="1"; os.environ["T22_RELEASE_AUTHORITY_TEST_BASE_URL"]=f"http://127.0.0.1:{release_catalog.server_port}"
    seam_dir=tempfile.TemporaryDirectory()
    provider_fixtures=Path(seam_dir.name)/"provider-fixtures.json"; provider_fixtures.write_text(json.dumps({"webdriver":{},"native":native_seam}))
    original_resolve_browser_discovery=runner.resolve_browser_discovery
    runner.resolve_browser_discovery=lambda matrix_entries, **kwargs: original_resolve_browser_discovery(matrix_entries,provider_fixtures,**kwargs)
    with tempfile.NamedTemporaryFile("w", suffix=".py") as handle:
        handle.write(adapter_code); handle.flush(); original_http=runner.http_call
        def product_http(base_url, authorization, operation, handles, prepared):
            body=prepared.get("body", {})
            format_name=body.get("format") if isinstance(body,dict) else None
            if format_name in ("json", CSV_BUNDLE_FORMAT):
                return {"httpStatus":202,"elapsedMilliseconds":1,"body":json.dumps({"exportJobId":"product-job-"+format_name,"format":format_name,"status":"queued"},sort_keys=True),"errorClass":None}
            return {"httpStatus":200,"elapsedMilliseconds":1,"body":"{}","errorClass":None}
        runner.http_call=product_http
        passed, code=runner.run("complex-form","cold","http://adapter.invalid",handle.name,False,p)
        require(code==0 and passed["verdict"]=="passed" and all(key in passed for key in required), "T22 success plan")
        require(passed["browserChannelDiscoveryRaw"] and validate_browser_evidence(passed,"complex-form"), "T22 retained owned-probe discovery is revalidated")
        for transport_key in ("sessionId","deviceId","endpointAuthority"):
            mismatch_transport=copy.deepcopy(passed); mismatch_transport["browserEvidence"][0]["transportEvidence"][transport_key]="mismatch"; mismatch_transport["rawSamplesArtifactSha256"]=sha(t22_canonical(evidence_envelope(mismatch_transport))); apply_measurements("complex-form",mismatch_transport,{"browserSeries":{"localRenderMilliseconds":[1]*20},"browserLongTasks":0}); require("browserEvidence" in mismatch_transport["thresholdFailures"], "T22 mismatched persistent "+transport_key+" evidence fails")
        stale_release=copy.deepcopy(passed); stale_release["browserReleaseAuthorities"]["artifacts"][0]["latestMajor"]=999; stale_release["browserReleaseAuthorities"]["artifactSha256"]=sha(t22_canonical(stale_release["browserReleaseAuthorities"]["artifacts"])); stale_release["rawSamplesArtifactSha256"]=sha(t22_canonical(evidence_envelope(stale_release))); apply_measurements("complex-form",stale_release,{"browserSeries":{"localRenderMilliseconds":[1]*20},"browserLongTasks":0}); require("browserEvidence" in stale_release["thresholdFailures"], "T22 stale release/session pair fails")
        source_kinds={slot["configId"]:slot["detection"]["sourceKind"] for slot in passed["browserChannelDiscovery"]}
        require({config_id:"webdriver-capabilities" for config_id in matrix_by_id} == source_kinds, "T22 owned probe dispatches every frozen browser source kind")
        require(len(FakeWebDriver.sessions)==10 and len(FakeWebDriver.deleted)==10, "T22 loopback WebDriver serves and evaluator closes every persistent frozen session")
        FakeWebDriver.fabricate_nonstandard_at=True
        fabricated_provider, fabricated_provider_code=runner.run("complex-form","cold","http://adapter.invalid",handle.name,False,p)
        require(fabricated_provider_code==1 and fabricated_provider["verdict"]=="failed", "T22 fabricated ordinary-WebDriver accessibility fields are rejected")
        FakeWebDriver.fabricate_nonstandard_at=False
        owned_probe=ROOT/"t22_browser_discovery_probe.py"; original_probe_bytes=owned_probe.read_bytes()
        try:
            owned_probe.write_bytes(original_probe_bytes+b"\n# mutation\n")
            blocked, blocked_code=runner.run("complex-form","cold","http://adapter.invalid",handle.name,False,p)
            require(blocked_code==2 and blocked["verdict"]=="blocked", "T22 modified owned probe is rejected before launch")
        finally: owned_probe.write_bytes(original_probe_bytes)
        saved_owned=copy.deepcopy(runner.DISCOVERY_PROBE_PROTOCOL["ownedProbe"])
        try:
            runner.DISCOVERY_PROBE_PROTOCOL["ownedProbe"]["repoRelativePath"]="../alternate-probe.py"
            try: runner.owned_browser_probe()
            except RuntimeError: pass
            else: fail("T22 alternate probe path was accepted")
        finally: runner.DISCOVERY_PROBE_PROTOCOL["ownedProbe"]=saved_owned
        os.environ["T22_BROWSER_DISCOVERY_PROBE"]="/bin/false"
        ignored, ignored_code=runner.run("complex-form","cold","http://adapter.invalid",handle.name,False,p)
        require(ignored_code==0 and ignored["verdict"]=="passed", "T22 arbitrary probe environment is ignored")
        os.environ.pop("T22_BROWSER_DISCOVERY_PROBE",None)
        stale=copy.deepcopy(passed); stale["browserChannelDiscoveryRaw"][0]["resolvedAtUtc"]="2020-01-01T00:00:00Z"; stale["rawSamplesArtifactSha256"]=sha(t22_canonical(evidence_envelope(stale))); apply_measurements("complex-form",stale,{"browserSeries":{"localRenderMilliseconds":[1]*20},"browserLongTasks":0}); require("browserEvidence" in stale["thresholdFailures"], "T22 stale retained discovery time fails")
        fabricated=copy.deepcopy(passed); fabricated["browserChannelDiscovery"][0]["detection"]["rawOutputSha256"]="0"*64; fabricated["rawSamplesArtifactSha256"]=sha(t22_canonical(evidence_envelope(fabricated))); apply_measurements("complex-form",fabricated,{"browserSeries":{"localRenderMilliseconds":[1]*20},"browserLongTasks":0}); require("browserEvidence" in fabricated["thresholdFailures"], "T22 fabricated raw output/hash fails")
        missing_slot=copy.deepcopy(passed); missing_slot["browserChannelDiscoveryRaw"].pop(); missing_slot["rawSamplesArtifactSha256"]=sha(t22_canonical(evidence_envelope(missing_slot))); apply_measurements("complex-form",missing_slot,{"browserSeries":{"localRenderMilliseconds":[1]*20},"browserLongTasks":0}); require("browserEvidence" in missing_slot["thresholdFailures"], "T22 missing discovery slot fails")
        extra_slot=copy.deepcopy(passed); extra_slot["browserChannelDiscoveryRaw"].append(copy.deepcopy(extra_slot["browserChannelDiscoveryRaw"][0])); extra_slot["rawSamplesArtifactSha256"]=sha(t22_canonical(evidence_envelope(extra_slot))); apply_measurements("complex-form",extra_slot,{"browserSeries":{"localRenderMilliseconds":[1]*20},"browserLongTasks":0}); require("browserEvidence" in extra_slot["thresholdFailures"], "T22 extra discovery slot fails")
        mismatch=copy.deepcopy(passed); mismatch["browserEvidence"][0]["browserVersion"]="0"; mismatch["browserEvidence"][0]["observedMajor"]=0; mismatch["rawSamplesArtifactSha256"]=sha(t22_canonical(evidence_envelope(mismatch))); apply_measurements("complex-form",mismatch,{"browserSeries":{"localRenderMilliseconds":[1]*20},"browserLongTasks":0}); require("browserEvidence" in mismatch["thresholdFailures"], "T22 observation mismatch/replay fails")
        exported, code=runner.run("api-export","cold","http://adapter.invalid",handle.name,False,p)
        require(code==0 and exported["verdict"]=="passed" and exported.get("exportVerification",{}).get("responseCount")==10000 and exported["exportVerification"].get("excludedDistractorResponseCount")==len(generated["responses-10000"]["distractorResponses"]), "T22 actual byte export execution selects the target 10000 and excludes distractor responses: "+json.dumps(exported.get("failure", exported.get("thresholdFailures"))))
        export_bucket=exported["latencyBuckets"].get("export",{})
        require(export_bucket.get("sampleCount")==p["minimumSamplesPerBucket"]["export"] and export_bucket.get("p95Milliseconds",float("inf")) <= 60000 and {row["semantic"] for row in exported["measurementSamples"] if row.get("bucket")=="export"}=={"export-json","export-relational-csv-bundle"} and len(set(exported.get("exportJobs",{}).values()))==2, "T22 independent JSON/CSV end-to-end export bucket")
        chains=exported.get("exportJobChains",{})
        selection_keys=("formId","filterSnapshot","columns","includeDataDictionary","includeInterpretation")
        require(set(chains)=={"json",CSV_BUNDLE_FORMAT} and all(chain["create"]["response"]["exportJobId"]==chain["binding"]["exportJobId"]==chain["completion"]["exportJobId"]==chain["download"]["exportJobId"] and chain["create"]["response"]["format"]==chain["completion"]["format"]==chain["download"]["format"]==format_name and chain["create"].get("requestSelection")=={key:EXPORT_CREATE_OPERATIONS[chain["create"]["semantic"]]["request"][key] for key in selection_keys} and chain["create"].get("requestSelectionSha256")==hashlib.sha256(t22_canonical(chain["create"]["requestSelection"])).hexdigest() and chain["create"].get("createStartedAt") and chain["create"].get("createReceiptAt") and 0 <= chain.get("measuredTotalMilliseconds",float("inf")) <= 60000 for format_name,chain in chains.items()) and sha(t22_canonical(evidence_envelope(exported)))==exported["rawSamplesArtifactSha256"], "T22 complete selection-bound timed create/completion/download chain is persisted and digested")
        # The adapter is a completion/download consumer, never a job-ID source.
        require("'exportJobId':bound_job_id" in adapter_code and "'job-'+format_name" not in adapter_code, "T22 self-check adapter consumes supplied bound job IDs")
        def export_probe(http=product_http, source=None, ticks=None):
            old_http,old_monotonic=runner.http_call,runner.monotonic
            temporary=None
            try:
                if source is not None:
                    temporary=tempfile.NamedTemporaryFile("w",suffix=".py"); temporary.write(source); temporary.flush(); adapter_path=temporary.name
                else: adapter_path=handle.name
                runner.http_call=http
                if ticks is not None:
                    values=iter(ticks); runner.monotonic=lambda:next(values)
                return runner.run("api-export","cold","http://adapter.invalid",adapter_path,False,p)
            finally:
                runner.http_call,runner.monotonic=old_http,old_monotonic
                if temporary is not None: temporary.close()
        def mutated_create_response(mutator):
            def invoke(*args,**kwargs):
                response=product_http(*args,**kwargs)
                if response["httpStatus"]==202:
                    body=json.loads(response["body"]); mutator(body); response={**response,"body":json.dumps(body,sort_keys=True)}
                return response
            return invoke
        def export_request_source(mutator):
            json_request=mutator(copy.deepcopy(EXPORT_CREATE_OPERATIONS["createExportJson"]["request"]))
            csv_request=mutator(copy.deepcopy(EXPORT_CREATE_OPERATIONS["createExportRelationalCsv"]["request"]))
            return adapter_code+"\ndef materialize(workload,semantic,dataset,handles,ordinal):\n if semantic=='createExportJson': return {'body':"+repr(json_request)+"}\n if semantic=='createExportRelationalCsv': return {'body':"+repr(csv_request)+"}\n return {'body':{}}\n"
        def create_request_negative(label,mutator):
            rejected, rejected_code=export_probe(source=export_request_source(mutator))
            require(rejected_code==1 and rejected["verdict"]=="failed" and "execution" in rejected["thresholdFailures"], "T22 "+label+" create-export selection is rejected")
        create_request_negative("missing formId",lambda body: (body.pop("formId"),body)[1])
        create_request_negative("wrong formId",lambda body: ({**body,"formId":generated["responses-10000"]["distractorForm"]["id"]}))
        create_request_negative("wrong filter snapshot",lambda body: ({**body,"filterSnapshot":{**body["filterSnapshot"],"statuses":["draft"]}}))
        create_request_negative("wrong output columns",lambda body: ({**body,"columns":["responseId"]}))
        create_request_negative("whole-workspace",lambda body: {"format":body["format"]})
        missing, code=export_probe(mutated_create_response(lambda body: body.pop("exportJobId")))
        require(code==1 and missing["verdict"]=="failed" and "execution" in missing["thresholdFailures"], "T22 missing create response/binding is rejected")
        shared, code=export_probe(mutated_create_response(lambda body: body.__setitem__("exportJobId","product-job-shared")))
        require(code==1 and shared["verdict"]=="failed" and "execution" in shared["thresholdFailures"], "T22 same create job for both formats is rejected")
        swapped, code=export_probe(mutated_create_response(lambda body: body.__setitem__("format",CSV_BUNDLE_FORMAT if body["format"]=="json" else "json")))
        require(code==1 and swapped["verdict"]=="failed" and "execution" in swapped["thresholdFailures"], "T22 swapped create response format is rejected")
        invented_completion=adapter_code.replace("'exportJobId':bound_job_id,'format':format_name,'status':'completed'", "'exportJobId':'invented-completion-job','format':format_name,'status':'completed'")
        completion, code=export_probe(source=invented_completion)
        require(code==1 and completion["verdict"]=="failed" and "execution" in completion["thresholdFailures"], "T22 invented completion job ID is rejected")
        invented_download=adapter_code.replace("'exportJobId':bound_job_id,'format':fmt,'status':'downloaded'", "'exportJobId':'invented-download-job','format':fmt,'status':'downloaded'")
        download, code=export_probe(source=invented_download)
        require(code==1 and download["verdict"]=="failed" and "execution" in download["thresholdFailures"], "T22 invented download job ID is rejected")
        exact, code=export_probe(ticks=(0,0,0,60,100,100,100,160))
        require(code==0 and exact["verdict"]=="passed", "T22 exactly 60000ms export passes")
        over, code=export_probe(ticks=(0,0,0,60.001))
        require(code==1 and over["verdict"]=="failed" and "execution" in over["thresholdFailures"], "T22 export over 60000ms fails")
        def slow_create(*args,**kwargs):
            response=product_http(*args,**kwargs)
            if response["httpStatus"]==202: runner.monotonic()
            return response
        slow_create_result, code=export_probe(slow_create,ticks=(0,60.001,60.001))
        require(code==1 and slow_create_result["verdict"]=="failed" and "execution" in slow_create_result["thresholdFailures"], "T22 slow product create time counts toward its end-to-end deadline")
        compiled, code=runner.run("import-compile","cold","http://adapter.invalid",handle.name,False,p)
        require(code==0 and compiled["verdict"]=="passed" and {"valid-compile","valid-commit","invalid-bounded-rejection"} <= set(compiled["latencyBuckets"]), "T22 fast async compile first-poll completion success")
        if os.getenv("T22_EXTENDED_PROBES") == "1":
            save_submit, code=runner.run("save-submit","cold","http://adapter.invalid",handle.name,False,p)
            active_sessions={row["id"] for row in generated["sessions-200"]["sessions"]}
            save_samples=[row for row in save_submit["measurementSamples"] if row["semantic"]=="saveAnswer"]
            terminal_samples=[row for row in save_submit["measurementSamples"] if row["semantic"] in ("validateSession","submit")]
            require(code==0 and save_submit["verdict"]=="passed" and {row.get("sessionId") for row in save_samples}==active_sessions and len(save_samples)==len(active_sessions) and all(row.get("sessionId") in active_sessions for row in terminal_samples), "T22 actual save path covers exact 200 active session IDs")
            malicious_adapter=adapter_code+"\ndef materialize(workload,semantic,dataset,handles,ordinal):\n return {'immutableRequestIdentity':{'sessionId':'rewritten','requestPath':'/v1/sessions/rewritten'}}\n"
            with tempfile.NamedTemporaryFile("w",suffix=".py") as malicious_handle:
                malicious_handle.write(malicious_adapter); malicious_handle.flush()
                rewritten, rewritten_code=runner.run("save-submit","cold","http://adapter.invalid",malicious_handle.name,False,p)
            require(rewritten_code==1 and rewritten["verdict"]=="failed" and "execution" in rewritten["thresholdFailures"], "T22 malicious effective-session rewrite is rejected")
            exported, code=runner.run("api-export","cold","http://adapter.invalid",handle.name,False,p)
            require(code==0 and exported["verdict"]=="passed" and exported.get("exportVerification",{}).get("responseCount")==10000, "T22 actual byte export execution success: "+json.dumps(exported.get("failure", exported.get("thresholdFailures"))))
            export_bucket=exported["latencyBuckets"].get("export",{})
            require(export_bucket.get("sampleCount")==p["minimumSamplesPerBucket"]["export"] and export_bucket.get("p95Milliseconds",float("inf")) <= 60000 and {row["semantic"] for row in exported["measurementSamples"] if row.get("bucket")=="export"}=={"export-json","export-relational-csv-bundle"} and len(set(exported.get("exportJobs",{}).values()))==2, "T22 independent JSON/CSV end-to-end export bucket")
            compiled, code=runner.run("import-compile","cold","http://adapter.invalid",handle.name,False,p)
            require(code==0 and compiled["verdict"]=="passed" and {"valid-compile","valid-commit","invalid-bounded-rejection"} <= set(compiled["latencyBuckets"]), "T22 fast async compile first-poll completion success")
            good_downloads=[]
            for ordinal,fmt in enumerate(("json",CSV_BUNDLE_FORMAT)):
                raw=export_bytes[fmt]; good_downloads.append({"downloaded":True,"elapsedMilliseconds":1,"exportJobId":"job-"+fmt,"format":fmt,"status":"downloaded","contentType":"application/json" if fmt=="json" else "application/vnd.smartintake.relational-csv+zip","artifactId":"artifact-"+fmt,"sha256":sha(raw),"bytes":raw,"rowCount":10000,"complete":True,"noTruncation":True})
            def expect_download_reject(mutator, reason):
                candidate=[dict(item) for item in good_downloads]; mutator(candidate)
                try: verify_export_downloads(export_dataset,{"json":ExportJobHandle("json","job-json","0"*64),CSV_BUNDLE_FORMAT:ExportJobHandle(CSV_BUNDLE_FORMAT,"job-"+CSV_BUNDLE_FORMAT,"0"*64)},{"json":{"completed":True,"completionMilliseconds":1,"exportJobId":"job-json","format":"json","status":"completed"},CSV_BUNDLE_FORMAT:{"completed":True,"completionMilliseconds":1,"exportJobId":"job-"+CSV_BUNDLE_FORMAT,"format":CSV_BUNDLE_FORMAT,"status":"completed"}},candidate)
                except RuntimeError: return
                fail("T22 export download mutation was accepted: "+reason)
            expect_download_reject(lambda x:x[0].__setitem__("sha256","0"*64),"wrong digest")
            expect_download_reject(lambda x:x[1].__setitem__("format","csv"),"wrong format")
            expect_download_reject(lambda x:x[1].__setitem__("contentType","text/csv"),"wrong content type")
            expect_download_reject(lambda x:x[1].__setitem__("exportJobId","other-job"),"wrong job")
            expect_download_reject(lambda x:x.pop(),"missing CSV bundle")
            expect_download_reject(lambda x:x.append(dict(x[0])),"duplicate artifact")
        slow_adapter=adapter_code.replace("def read_compile_progress(workload,job,handles): return {'complete':True,'visibleJobStatus':True,'progress':100,'elapsedMilliseconds':1}", "_polls={}\ndef read_compile_progress(workload,job,handles):\n n=_polls.get(job,0); _polls[job]=n+1\n return {'complete':n>0,'visibleJobStatus':True,'progress':100 if n>0 else 25,'elapsedMilliseconds':1}")
        with tempfile.NamedTemporaryFile("w", suffix=".py") as slow_handle:
            slow_handle.write(slow_adapter); slow_handle.flush()
            monotonic=iter((0.0,0.1)*32)
            original_monotonic=runner.monotonic; runner.monotonic=lambda:next(monotonic)
            try: slow, code=runner.run("import-compile","cold","http://adapter.invalid",slow_handle.name,False,p)
            finally: runner.monotonic=original_monotonic
            require(code==0 and slow["verdict"]=="passed", "T22 persistent worker preserves compile handle state")
        never_adapter=slow_adapter.replace("'complete':n>0", "'complete':False")
        with tempfile.NamedTemporaryFile("w", suffix=".py") as never_handle:
            never_handle.write(never_adapter); never_handle.flush()
            original_max=runner.COMPILE_MAX_POLLS; runner.COMPILE_MAX_POLLS=2
            try: bounded, code=runner.run("import-compile","cold","http://adapter.invalid",never_handle.name,False,p)
            finally: runner.COMPILE_MAX_POLLS=original_max
            require(code==1 and bounded["verdict"]=="failed" and "execution" in bounded["thresholdFailures"], "T22 compile max-poll deadline is bounded")
        runner.http_call=lambda *a,**k:{"httpStatus":500,"elapsedMilliseconds":1,"body":"{}","errorClass":"http"}
        http_failed, code=runner.run("complex-form","cold","http://adapter.invalid",handle.name,False,p)
        require(code==1 and http_failed["verdict"]=="failed", "T22 HTTP execution failure")
        runner.http_call=original_http
    if original_webdriver_endpoint is None: os.environ.pop("T22_WEBDRIVER_ENDPOINT",None)
    else: os.environ["T22_WEBDRIVER_ENDPOINT"]=original_webdriver_endpoint
    if original_test_mode is None: os.environ.pop("T22_BROWSER_PROBE_TEST_MODE",None)
    else: os.environ["T22_BROWSER_PROBE_TEST_MODE"]=original_test_mode
    if original_release_base is None: os.environ.pop("T22_RELEASE_AUTHORITY_TEST_BASE_URL",None)
    else: os.environ["T22_RELEASE_AUTHORITY_TEST_BASE_URL"]=original_release_base
    runner.resolve_browser_discovery=original_resolve_browser_discovery
    webdriver.shutdown(); webdriver.server_close(); release_catalog.shutdown(); release_catalog.server_close(); seam_dir.cleanup()

    require("T22_RUNTIME_ADAPTER" in p["runnerTool"]["runtimeEnvironment"]["required"], "T22 adapter prerequisite")

def check_t25():
    p=load("t25-usability-protocol.json")["frozenInputProtocol"]
    require(p["orientation"]["durationMinutes"]==20 and p["respondentReading"]["durationMinutes"]==5, "T25 allocation")
    require([x["id"] for x in p["participants"]]==[f"A{i}" for i in range(1,6)]+[f"R{i}" for i in range(1,6)], "T25 5+5 slots")
    require(len(p["authorTaskScript"])==8 and len(p["respondentTaskScript"])==10, "T25 Appendix C tasks")
    require(len(p["browserDeviceATMatrix"])==4 and all(x["selectionStatus"]=="pending-external-selection-at-run" for x in p["browserDeviceATMatrix"]), "T25 external version pending")
    require(p["externalVersionSelection"]["status"]=="pending-external-selection-at-run" and p["externalVersionSelection"]["requiredBeforeFirstParticipant"] is True, "T25 external selection policy")
    require({"observationForm","interventionPolicy","anonymization","scoringForm","counterbalancing"} <= set(p), "T25 forms")

def emit_workload(workload_id, output):
    p=load("t22-scale-limits.json")["frozenInputProtocol"]
    workload=next((x for x in p["workloads"] if x["id"]==workload_id),None)
    if workload is None: fail(f"unknown workload {workload_id}")
    result={"schemaVersion":p["rawResultSchema"]["schemaVersion"],"workloadId":workload_id,"executionStatus":"not-run","verdict":"not-run","reason":"Corpus observation placeholder; use t22_workload_runner.py for a dry-run or execution."}
    Path(output).write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--emit-workload"); parser.add_argument("--output"); parser.add_argument("--structural-only", action="store_true", help="test isolation only; validates frozen structures but skips large deterministic T22 materialization"); parser.add_argument("--t22-deep-only", action="store_true", help=argparse.SUPPRESS)
    args=parser.parse_args(); require(not (args.structural_only and args.t22_deep_only), "select one T22 test mode")
    if args.t22_deep_only:
        check_t22()
    else:
        check_t08();check_t19();check_t21();check_t22(not args.structural_only);check_t25()
    if args.emit_workload:
        require(args.output is not None, "--output required with --emit-workload"); emit_workload(args.emit_workload,args.output)
    print("PASS priority assets: T08=8 PATCH, T19=18 delivery cases/3 envelopes, T21=11 primary attacks, T22=8 runnable workloads/11 limits, T25=5+5 slots")
if __name__ == "__main__": main()
