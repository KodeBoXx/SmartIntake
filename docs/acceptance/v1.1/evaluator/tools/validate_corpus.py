#!/usr/bin/env python3
"""Read-only standard-library validation for evaluator corpus v1.1.0."""
from __future__ import annotations
import argparse, hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[3]
ID = re.compile(r"^EVAL-[A-Z]{3,5}-[0-9A-Z-]+$")
FORBIDDEN = ("TBD", "TODO", "FIXME", "???")

def canonical(value):
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, separators=(",", ": ")) + "\n"
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def source_for(kind):
    return REPO / "docs/source-handoff" / ("Smart-Form-Builder-Lite-PRD-v1.1.md" if kind == "PRD" else "smart-form-builder-lite-prd-v1.1/Lite-Evaluator-Protocol.md")
def line_slice(path, specification):
    nums=[int(x) for x in re.findall(r"\d+", str(specification))]
    if not nums: return ""
    first,last=nums[0],nums[-1]
    return "\n".join(path.read_text(encoding="utf-8").splitlines()[first-1:last])
def corpus_files(root):
    return sorted((p for p in root.rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.relative_to(root).as_posix() != "manifest.json"), key=lambda p:p.as_posix())
def corpus_digest(root=ROOT):
    lines=sorted(f"{sha(p)}  ./{p.relative_to(root).as_posix()}\n" for p in corpus_files(root))
    return hashlib.sha256("".join(lines).encode()).hexdigest()
def record_walk(value):
    if isinstance(value, dict):
        if "id" in value and "prdCitations" in value:
            yield value; return
        for child in value.values(): yield from record_walk(child)
    elif isinstance(value, list):
        for child in value: yield from record_walk(child)
def add(errors,key,message): errors.append((key,message))
def schema_ok(record, schema):
    required=schema.get("required", [])
    if any(key not in record for key in required): return False
    props=schema.get("properties", {})
    for key, rule in props.items():
        if key not in record: continue
        value=record[key]
        if "const" in rule and value != rule["const"]: return False
        if "enum" in rule and value not in rule["enum"]: return False
        if rule.get("type") == "string" and not isinstance(value,str): return False
        if rule.get("type") == "array" and not isinstance(value,list): return False
        if key == "id" and not ID.fullmatch(value): return False
    return True
def validate(root=ROOT, require_denial_list=True):
    errors=[]; docs={}
    # C01: all committed corpus bytes, not only JSON, have frozen hygiene.
    for path in corpus_files(root):
        raw=path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf") or b"\r" in raw or b"\t" in raw or not raw.endswith(b"\n") or raw.endswith(b"\n\n"):
            add(errors,"C01",f"{path}: byte hygiene")
        if path.suffix == ".json":
            try:
                value=json.loads(raw.decode("utf-8"))
                if raw.decode("utf-8") != canonical(value): add(errors,"C01",f"{path}: noncanonical JSON")
                docs[path.relative_to(root).as_posix()]=value
            except Exception as exc: add(errors,"C01",f"{path}: {exc}")
    docs["manifest.json"] = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    schema=docs.get("conventions/record-schema.json",{})
    all_records=[]
    for name,value in docs.items():
        if name != "conventions/record-schema.json": all_records += [(name,r) for r in record_walk(value)]
    seen=set(); expected_seen=set()
    for name,record in all_records:
        if not schema_ok(record,schema): add(errors,"C02",f"{name}: schema violation {record.get('id')}")
        rid=record.get("id")
        if not ID.fullmatch(str(rid)) or rid in seen: add(errors,"C03",f"{name}: invalid/duplicate id {rid}")
        seen.add(rid)
        citations=record.get("prdCitations",[])
        if not citations: add(errors,"C04",f"{rid}: missing citation")
        for cite in citations:
            if not isinstance(cite,dict): add(errors,"C04",f"{rid}: malformed citation"); continue
            source=source_for(cite.get("file"))
            if not source.exists() or not cite.get("quote") or cite["quote"] not in line_slice(source,cite.get("lines","")):
                add(errors,"C04",f"{rid}: quote absent from cited line range")
        if record.get("status") != "not-run": add(errors,"C05",f"{rid}: status")
        blob=json.dumps(record,ensure_ascii=False)
        if any(word in blob for word in FORBIDDEN) or '"":' in blob: add(errors,"C06",f"{rid}: placeholder")
        if not record.get("fixtures") and not record.get("milestoneGates"): add(errors,"C07",f"{rid}: orphan")
        marker=(record.get("assertionType"),json.dumps(record.get("expected"),sort_keys=True,ensure_ascii=False))
        if marker in expected_seen: add(errors,"C07",f"{rid}: duplicate expected outcome")
        expected_seen.add(marker)
        if record.get("evidenceLevel") in ("E3","human") and not (record.get("blockedReason") or record.get("accessPrerequisite")): add(errors,"C20",f"{rid}: evidence gate")
    nav=docs.get("navigation/navigation-oracle.json",{}); strings=["Answer steps complete. Review and submit remain.","An answer added a step.","Remaining steps may change.","No answer steps. Review and submit remain."]
    prd_nav=line_slice(source_for("PRD"),"1407-1419")
    if nav.get("frozenStrings") != strings or any(text not in prd_nav for text in strings): add(errors,"C08","frozen navigation strings")
    nav_records={r.get("id"):r for r in nav.get("records",[])}
    if set(nav_records)-{"EVAL-NAV-BASE",*(f"EVAL-NAV-{i:02}" for i in range(1,6))} or any(f"EVAL-NAV-{i:02}" not in nav_records for i in range(1,6)): add(errors,"C09","navigation records")
    sm=docs.get("review/status-label-map.json",{}); vocab=["answered","unanswered","unknown","declined","respondentNotApplicable","notApplicable"]
    if sm.get("statusVocabulary") != vocab or next((r for r in sm.get("map",[]) if r.get("status")=="notApplicable"),{}).get("projection") != "omitted": add(errors,"C10","status map")
    budget=docs.get("packages/parity-budget.json",{}).get("budget",{})
    for name in ("packages/package-hc.json","packages/package-nhc.json"):
        package=docs.get(name,{})
        if package.get("parityActual") != budget or package.get("catalogCoverage") != list(range(1,18)): add(errors,"C11",name)
    matrix=docs.get("packages/catalog-coverage-matrix.json",{}).get("records",[])
    if len(matrix)!=17 or not all(r["expected"].get(k) is True for r in matrix for k in ("validCase","invalidCase","boundaryCase")): add(errors,"C11","catalog matrix")
    oracle=docs.get("oracles/respondent-oracle.json",{}); outcomes={r["expected"].get("canonicalKey"):r["expected"] for r in record_walk(oracle) if r["id"].startswith("EVAL-RESP-O")}
    try:
        a,b=outcomes["equipmentA"],outcomes["equipmentB"]
        if [outcomes["equipment"]["orderedItems"],a["quantity"],b["quantity"],outcomes["extraAttendees"]["value"],outcomes["priority"]["value"]] != [["equipmentB","equipmentA"],"3","1","0","4"]: raise ValueError()
        if (int(b["quantity"])*float(b["unitCost"]), int(a["quantity"])*float(a["unitCost"]), outcomes["total"]["value"]) != (7.25,37.5,"44.75"): raise ValueError()
    except (KeyError,ValueError): add(errors,"C12","respondent arithmetic/typing")
    attachment=outcomes.get("supportingFiles",{})
    if attachment.get("bytes") != 8 or hashlib.sha256(attachment.get("fixtureBytesUtf8","").encode()).hexdigest() != attachment.get("sha256"): add(errors,"C13","attachment fixture digest")
    packs=docs.get("locales/key-inventory.json",{}).get("localePacks",{})
    stubs=sm.get("localeStubs",{})
    if not all(packs.get(x,{}).get("messageValues") is None and packs[x].get("translationStatus")=="not-supplied" and stubs.get(x,{}).get("translationStatus")=="not-supplied" for x in ("hi","ar")): add(errors,"C14","locale stubs")
    if docs.get("locales/plural-map.json",{}).get("grammar") != "smartforms-cardinal-1": add(errors,"C15","plural map")
    sent=docs.get("sentinels/public-catalog.json",{}).get("records",[]); schedule=docs.get("sentinels/gate-schedule.json",{})
    if len(sent)!=7 or any(r["expected"].get("payloadCommitted") is not False or r.get("milestoneGates") != [g for g in ("M0","M3","M8","M12") if r["id"] in schedule.get(g,[])] for r in sent): add(errors,"C16","sentinel schedule")
    commitment=docs.get("sentinels/commitments.json",{}).get("rounds",[{}])[0]
    if commitment.get("slotCount") != len(commitment.get("scheduledSentinelIds",[]))+commitment.get("nullSlots",0) or commitment.get("commitments") != [] or commitment.get("sealed") is not False: add(errors,"C16","commitments")
    denial=REPO/"docs/acceptance/v1.1/inventory/inventory.json"
    try: denial_data=json.loads(denial.read_text())["formerlyRemovedWholeCoreDenialList"]
    except Exception: denial_data={}
    if require_denial_list and (denial_data.get("declaredCount") != 7 or denial_data.get("enumerationAvailable") is not True or len(denial_data.get("identifiers",[])) != 7): add(errors,"C17","blocked: denial-list-unenumerated at inventory.json#/formerlyRemovedWholeCoreDenialList.identifiers")
    manifest=docs.get("manifest.json",{})
    listed={x.get("path"):x.get("sha256") for x in manifest.get("artifacts",[])}; actual={p.relative_to(root).as_posix():sha(p) for p in corpus_files(root)}
    if manifest.get("corpusDigest") != corpus_digest(root) or listed != actual: add(errors,"C18","aggregate or per-file digest")
    refs=manifest.get("crossScopeRefs",{})
    for key in ("inventoryManifest","denominatorManifest"):
        ref=refs.get(key,{})
        path=REPO/ref.get("path","")
        if not path.exists() or ref.get("sha256") != sha(path): add(errors,"C18",f"cross-scope pin {key}")
    status=manifest.get("status",{})
    if status.get("measuredConformanceExecuted") is not False or status.get("productTestsExecuted") is not False: add(errors,"C19","conformance claim")
    return errors

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--allow-blocked-denial-list",action="store_true"); args=parser.parse_args()
    errors=validate(require_denial_list=not args.allow_blocked_denial_list)
    for key,message in errors: print(f"{key}: {message}")
    return 1 if errors else 0
if __name__ == "__main__": raise SystemExit(main())
