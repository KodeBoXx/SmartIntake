#!/usr/bin/env python3
"""Deterministic, evaluator-only T22 dataset generator.

Generated objects are input fixtures. They do not infer API bodies or endpoint
paths: materialization belongs to a runtime adapter because M2 does not freeze
those body/extraction contracts. Operation IDs below resolve only through the
checked-in normative O_named inventory in the runner.
"""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path
from t22_export_bundle import package_dictionary, write_export_artifacts

VERSION = "t22-dataset/v3"
SEED = "m0-t22-20260914"
DATASETS = ("catalog-10000", "complex-1000", "runtime-100-and-complex", "sessions-200", "compile-1000", "responses-10000", "durability-acknowledged-writes", "browser-at-matrix")
EXPORT_WORKSPACE_ID="workspace-responses-10000"
EXPORT_TARGET_FORM_ID="form-responses-target"
EXPORT_DISTRACTOR_FORM_ID="form-responses-distractor"
EXPORT_SUBMISSION_WINDOW={"gte":"2026-01-01T00:00:00Z","lt":"2026-02-01T00:00:00Z"}
EXPORT_OUTPUT_COLUMNS=["responseId","submissionId","submittedAtUtc","answers"]

def canonical(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
def digest(dataset_id, ordinal): return hashlib.sha256(f"{SEED}\0{dataset_id}\0{ordinal:08d}".encode()).hexdigest()
def ids(dataset_id, prefix, count): return [f"{prefix}-{digest(dataset_id, n)[:16]}" for n in range(count)]
def operation(op_id, semantic): return {"operationId": op_id, "semantic": semantic, "materialization": "runtime-adapter-required"}

def package(dataset_id, fields=1, pages=1, expressions=0):
    """Create a complete PRD 4.0.0 portable package, never a private dataset shape."""
    # ``fields`` is the required recursive-definition total.  The complex
    # package reserves six definitions for its real three-level repeater.
    root_count = fields - 6 if fields >= 1000 else fields
    field_ids = ids(dataset_id, "field", root_count)
    form_key = f"form-{digest(dataset_id, 0)[:16]}"
    definitions = [{"id": field_id, "key": f"field{ordinal + 1}", "type": "text", "labelKey": f"q.{field_id}", "sensitivity": "ordinary", "mode": "input", "hiddenRetention": "clear", "normalizer": "preserve", "constraints": {"maxLength": 120}} for ordinal, field_id in enumerate(field_ids)]
    if fields >= 1000:
        quantity={"id": f"{field_ids[0]}-quantity", "key": "quantity", "type": "integer", "constraints": {"minimum": "0", "wireFormat": "canonical-decimal-string"}}
        level3={"id": f"{field_ids[0]}-level3", "key": "level3", "type": "list", "labelKey": f"q.{field_ids[0]}.level3", "itemSchema": {"id": f"{field_ids[0]}-level3-item", "key": "item", "type": "object", "labelKey": f"q.{field_ids[0]}.level3.item", "properties": [quantity]}}
        level2={"id": f"{field_ids[0]}-level2", "key": "level2", "type": "list", "labelKey": f"q.{field_ids[0]}.level2", "itemSchema": {"id": f"{field_ids[0]}-level2-item", "key": "item", "type": "object", "labelKey": f"q.{field_ids[0]}.level2.item", "properties": [level3]}}
        definitions[0] = {"id": field_ids[0], "key": "repeaterLevel1", "type": "list", "labelKey": f"q.{field_ids[0]}", "sensitivity": "ordinary", "mode": "input", "hiddenRetention": "clear", "itemSchema": {"id": f"{field_ids[0]}-item", "key": "item", "type": "object", "labelKey": f"q.{field_ids[0]}.item", "properties": [level2]}}
    page_rows=[]
    for index in range(pages):
        assigned=field_ids[index * len(field_ids) // pages:(index + 1) * len(field_ids) // pages]
        page_id=f"page-{index + 1:03d}"
        page_rows.append({"id":page_id,"titleKey":f"page.{index + 1}","sections":[{"id":f"section-{index + 1:03d}","titleKey":f"page.{index + 1}","layout":"stack","nodes":[{"id":f"node-{field_id}","kind":"question","fieldId":field_id,"control":"repeater" if definitions[field_ids.index(field_id)]["type"] == "list" else "text"} for field_id in assigned]}],"routes":[],**({"defaultNextPageId":f"page-{index + 2:03d}"} if index + 1 < pages else {})})
    messages={"form.title":f"Generated {dataset_id}","form.description":"Deterministic evaluator workload package.","confirmation":"Recorded."}
    messages.update({f"page.{index + 1}":f"Page {index + 1}" for index in range(pages)})
    messages.update({field["labelKey"]:field["key"] for field in definitions})
    return {"schemaVersion":"4.0.0","engineContract":"4.0.0","contractVersion":"4.0.0","kind":"smart-form-package","formKey":form_key,"definitionVersion":"1.0.0","titleKey":"form.title","descriptionKey":"form.description","defaultLocale":"en","supportedLocales":["en"],"data":{"fields":definitions},"flow":{"startPageId":page_rows[0]["id"],"phases":[{"id":"phase-main","titleKey":"form.title","pages":page_rows}]},"expressions":{f"expr-{n + 1:03d}":{"op":"eq","args":[{"ref":{"fieldId":field_ids[n % fields],"scope":"root"}},{"literal":{"type":"text","value":"seeded"}}]} for n in range(expressions)},"guidance":{},"translations":{"en":{"direction":"ltr","reviewState":"approved","messages":messages,"pronunciations":[]}},"theme":{"themeKey":"accessible-default","version":"1.0.0","tokens":{"accent":"#175CD3","background":"#FFFFFF","text":"#182230","fontFamily":"system","density":"comfortable","radius":8}},"policies":{"reviewBeforeSubmit":True,"draftExpiryDays":30,"showProgress":True,"presentation":"grouped","guidanceMode":"text","narrationAutoplay":False,"allowVoiceQuestions":False,"retentionPolicyKey":"standard-intake","responseAccess":"anonymous","confirmationKey":"confirmation"},"dependencies":[],"assets":[]}
def package_field_ids(pkg): return [field["id"] for field in pkg["data"]["fields"]]
def package_record_id(pkg): return f"package-{hashlib.sha256(canonical(pkg)).hexdigest()[:16]}"
def release(dataset_id, pkg, ordinal=0): return {"id":f"release-{digest(dataset_id,ordinal)[:16]}","packageId":package_record_id(pkg),"formKey":pkg["formKey"],"version":f"1.0.{ordinal}","state":"published"}
def recursive_list_answer(field_id, ordinal):
    return {"status":"answered","value":{"items":[{"itemId":f"{field_id}-l1-{ordinal}","fields":{f"{field_id}-level2":{"status":"answered","value":{"items":[{"itemId":f"{field_id}-l2-{ordinal}","fields":{f"{field_id}-level3":{"status":"answered","value":{"items":[{"itemId":f"{field_id}-l3-{ordinal}","fields":{f"{field_id}-quantity":{"status":"answered","value":"1"}}}]}}}}]}}}}]}}
def responses_package(dataset_id):
    """Typed export graph: text + integer + three declared list/object levels."""
    p=package(dataset_id,3); text_id,integer_id,repeater_id=ids(dataset_id,"export-field",3)
    quantity_id=f"{repeater_id}-quantity"; level2_id=f"{repeater_id}-level2"; level3_id=f"{repeater_id}-level3"
    p["data"]["fields"]=[
      {"id":text_id,"key":"canonicalText","type":"text","labelKey":"q.canonicalText","mode":"input","sensitivity":"ordinary","hiddenRetention":"clear","constraints":{"maxLength":120}},
      {"id":integer_id,"key":"canonicalInteger","type":"integer","labelKey":"q.canonicalInteger","mode":"input","sensitivity":"ordinary","hiddenRetention":"clear","constraints":{"wireFormat":"canonical-decimal-string"}},
      {"id":repeater_id,"key":"repeaterLevel1","type":"list","labelKey":"q.repeaterLevel1","mode":"input","sensitivity":"ordinary","hiddenRetention":"clear","itemSchema":{"id":f"{repeater_id}-item","key":"item","type":"object","properties":[{"id":level2_id,"key":"level2","type":"list","itemSchema":{"id":f"{level2_id}-item","key":"item","type":"object","properties":[{"id":level3_id,"key":"level3","type":"list","itemSchema":{"id":f"{level3_id}-item","key":"item","type":"object","properties":[{"id":quantity_id,"key":"quantity","type":"integer","constraints":{"wireFormat":"canonical-decimal-string"}}]}}]}}]}}
    ]
    p["flow"]["phases"][0]["pages"][0]["sections"][0]["nodes"]=[{"id":"node-"+field_id,"kind":"question","fieldId":field_id,"control":"repeater" if field_id==repeater_id else "text"} for field_id in (text_id,integer_id,repeater_id)]
    p["translations"]["en"]["messages"].update({"q.canonicalText":"Canonical text","q.canonicalInteger":"Canonical integer","q.repeaterLevel1":"Repeater"})
    return p
def session(dataset_id, rel, pkg, ordinal=0, answers=1):
    graph=package_field_ids(pkg); assert graph
    answer_map={}
    for n in range(answers):
        field_id=graph[n%len(graph)]
        answer_map[field_id]=recursive_list_answer(field_id, ordinal) if pkg["data"]["fields"][graph.index(field_id)]["type"] == "list" else {"status":"answered","value":f"seed-{ordinal}-{n}"}
    return {"id":f"session-{digest(dataset_id,ordinal)[:16]}","releaseId":rel["id"],"revision":1,"answers":answer_map}
def bundle(dataset_id, pkg=None, rel=None):
    pkg=pkg or package(dataset_id+":bundle"); rel=rel or release(dataset_id+":bundle", pkg); ses=session(dataset_id+":bundle", rel, pkg)
    return {"package": pkg, "form": {"id": f"form-{digest(dataset_id, 0)[:16]}", "packageId": package_record_id(pkg)}, "release": rel, "session": ses, "answers": ses["answers"], "request": {"id": f"request-{digest(dataset_id, 0)[:16]}", "body": ses, "materialization": "runtime-adapter-required"}}
def with_meta(dataset_id, value):
    value.update({"datasetId": dataset_id, "generatorVersion": VERSION, "seed": f"{SEED}:{dataset_id}"}); value["sha256"] = hashlib.sha256(canonical(value)).hexdigest(); return value

def catalog():
    d="catalog-10000"; forms=[{"id": fid, "title": f"Catalog form {n:05d}", "package": package(f"{d}:form:{n:05d}"), "selectedReleaseId": f"release-{digest(d+':release',n%100)[:16]}"} for n,fid in enumerate(ids(d,"form",10000))]
    releases=[{"id": f"release-{digest(d+':release',n)[:16]}", "version": f"1.0.{n}", "state":"published"} for n in range(100)]
    return with_meta(d,{"forms":forms,"releases":releases,"objectBundle":bundle(d,forms[0]["package"]),"operationIntents":[operation("ON-get-v1-workspaces-w-forms-2cc818d28d","catalog-cursor-search")]})
def complex_form():
    d="complex-1000"; p=package(d,1000,100,500); r=release(d,p)
    # The package is complete before it is hashed; instances retain only
    # graph-bound InputAnswer values, never a private root repeater shape.
    instances=[{"id": x,"packageId":package_record_id(p),"answers":{p["data"]["fields"][0]["id"]:recursive_list_answer(p["data"]["fields"][0]["id"], n)}} for n,x in enumerate(ids(d,"instance",2000))]
    return with_meta(d,{"package":p,"form":{"id":"form-complex","packageId":package_record_id(p)},"release":r,"instances":instances,"objectBundle":bundle(d,p,r),"operationIntents":[operation("ON-post-v1-workspaces-w-forms-89f650ba42","create-form"),operation("ON-put-v1-workspaces-w-forms-f-drafts-d-d5d5fa6522","save-draft"),operation("ON-post-v1-workspaces-w-forms-f-drafts-d-validate-a7ada56c4b","validate-draft"),operation("ON-post-v1-workspaces-w-forms-f-releases-e3ec39e2bc","publish-release")]})
def runtime():
    d="runtime-100-and-complex"; small=package(d+":small",100,10); large=complex_form()["package"]; rs=[release(d+":small",small),release(d+":large",large)]
    return with_meta(d,{"forms":[{"id":"form-runtime-100","package":small},{"id":"form-runtime-complex","package":large}],"releases":rs,"sessions":[session(d+":small",rs[0],small,answers=100),session(d+":large",rs[1],large,answers=1000)],"objectBundle":bundle(d,small,rs[0]),"operationIntents":[operation("ON-post-v1-public-forms-shareid-sessions-1ca37406cb","start-session"),operation("ON-get-v1-sessions-s-daef09677a","load-session"),operation("ON-patch-v1-sessions-s-d902ee3064","save-answer")]})
def sessions_workload():
    d="sessions-200"; p=package(d,10); r=release(d,p); ss=[session(d,r,p,n,10) for n in range(200)]
    return with_meta(d,{"package":p,"form":{"id":"form-sessions","packageId":package_record_id(p)},"release":r,"sessions":ss,"rate":{"aggregateMutationsPerSecond":20},"objectBundle":bundle(d,p,r),"operationIntents":[operation("ON-patch-v1-sessions-s-d902ee3064","save-draft"),operation("ON-post-v1-sessions-s-validate-dde1446480","validate-session"),operation("ON-post-v1-sessions-s-submissions-ba988d3740","submit-session")]})
def compile_workload():
    d="compile-1000"; valid=package(d+":valid",1000,100,500); invalid=package(d+":invalid",1000,100,500); invalid["expressions"]["expr-001"]["op"]="unknown-op"
    return with_meta(d,{"packages":[{"kind":"valid","object":valid},{"kind":"invalid","object":invalid}],"objectBundle":bundle(d,valid),"operationIntents":[operation("ON-post-v1-workspaces-w-imports-validate-57f09aa4ca","validate-import"),operation("ON-post-v1-workspaces-w-imports-candidateid-commit-9f77424a8c","commit-import")]})
def responses():
    # Frozen expected export corpus: every value, relationship, and export
    # interpretation is independently reconstructible from this generator.
    d="responses-10000"; p=responses_package(d); r=release(d,p)
    text_field, integer_field, repeater_field = package_field_ids(p)
    target_form={"id":EXPORT_TARGET_FORM_ID,"workspaceId":EXPORT_WORKSPACE_ID,"releaseId":r["id"]}
    distractor_form={"id":EXPORT_DISTRACTOR_FORM_ID,"workspaceId":EXPORT_WORKSPACE_ID,"releaseId":"release-responses-distractor"}
    rows=[]
    for n,x in enumerate(ids(d,"response",10000)):
        integer=("-9223372036854775808" if n==0 else "9223372036854775807" if n==1 else "9007199254740993" if n==2 else str(n))
        text=("=SUM(A1:A2)" if n%7==0 else "canonical response "+str(n))
        rows.append({"id":x,"submissionId":x,"workspaceId":EXPORT_WORKSPACE_ID,"formId":target_form["id"],"releaseId":r["id"],"status":"submitted","submittedAtUtc":"2026-01-%02dT12:00:00Z"%(n%28+1),"answers":{text_field:{"status":"answered","value":text},integer_field:{"status":"answered","value":integer},repeater_field:recursive_list_answer(repeater_field,n)}})
    distractors=[]
    for n,x in enumerate(ids(d,"distractor-response",100)):
        distractors.append({"id":x,"submissionId":x,"workspaceId":EXPORT_WORKSPACE_ID,"formId":distractor_form["id"],"releaseId":distractor_form["releaseId"],"status":"submitted","submittedAtUtc":"2026-01-%02dT12:00:00Z"%(n%28+1),"answers":{text_field:{"status":"answered","value":"distractor "+str(n)}}})
    dictionary=package_dictionary(p)
    runtime_manifest={"format":"t22-relational-csv-zip/v1","tables":["responses.csv","repeater_level_1.csv","repeater_level_2.csv","repeater_level_3.csv","data_dictionary.csv","interpretation_manifest.json"]}
    package_hash=hashlib.sha256(canonical(p)).hexdigest(); dictionary_hash=hashlib.sha256(canonical(dictionary)).hexdigest(); runtime_hash=hashlib.sha256(canonical(runtime_manifest)).hexdigest()
    interpretation={"schema":"t22-export-interpretation/v2","releaseId":r["id"],"definitionVersion":p["definitionVersion"],"packageHash":package_hash,"runtimeManifestHash":runtime_hash,"dictionaryHash":dictionary_hash,"interpretationKey":hashlib.sha256(canonical({"packageHash":package_hash,"runtimeManifestHash":runtime_hash,"dictionaryHash":dictionary_hash,"releaseId":r["id"],"definitionVersion":p["definitionVersion"]})).hexdigest(),"rowCount":10000,"submissionIdUnique":True,"link":"parentItemId references itemId in the same submission at the preceding level","formats":{"json":"application/json","csvBundle":"application/vnd.smartintake.relational-csv+zip"},"tables":runtime_manifest["tables"]}
    return with_meta(d,{"package":p,"release":r,"targetForm":target_form,"distractorForm":distractor_form,"responses":rows,"distractorResponses":distractors,"exportDictionary":dictionary,"exportInterpretation":interpretation,"objectBundle":bundle(d,p,r),"operationIntents":[operation("ON-get-v1-workspaces-w-submissions-bd7aaa46e9","cursor-walk"),operation("ON-post-v1-workspaces-w-exports-380db1264c","create-export")]})
def durability():
    d="durability-acknowledged-writes"; p=package(d,10); r=release(d,p); s=session(d,r,p,answers=10); writes=[{"sequence":n+1,"baseRevision":n+1,"operation":{"op":"set","fieldId":package_field_ids(p)[n%len(package_field_ids(p))],"answer":{"status":"answered","value":str(n)}},"expectedDurability":"acknowledged-before-fault"} for n in range(20)]
    return with_meta(d,{"package":p,"release":r,"session":s,"acknowledgements":writes,"faultSchedule":[{"afterAcknowledgement":10,"hook":"restart"},{"afterAcknowledgement":20,"hook":"restore"}],"objectBundle":bundle(d,p,r),"operationIntents":[operation("ON-patch-v1-sessions-s-d902ee3064","save-draft"),operation("ON-get-v1-sessions-s-daef09677a","verify-acknowledged-state")]})
def browser_matrix():
    d="browser-at-matrix"; p=package(d,100,10); r=release(d,p)
    # Channels are frozen, not their release numbers.  The adapter records the
    # actual browser/OS/AT versions selected at execution time and proves each
    # desktop latest/previous pair is adjacent.
    slots=[("Chrome","latest","desktop","Windows","NVDA"),("Chrome","previous-major","desktop","Windows","none"),("Edge","latest","desktop","Windows","NVDA"),("Edge","previous-major","desktop","Windows","none"),("Firefox","latest","desktop","Windows","NVDA"),("Firefox","previous-major","desktop","Windows","none"),("Safari","latest","macOS","macOS","VoiceOver"),("Safari","previous-major","macOS","macOS","VoiceOver"),("Chrome","latest","mobile","Android","TalkBack"),("Safari","latest","mobile","iOS","VoiceOver")]
    # Versions intentionally are not frozen in the protocol: the adapter
    # resolves the selected channel at run start and reports its observation.
    matrix=[{"id":x,"browser":b,"requestedChannel":channel,"device":device,"os":os,"at":at,"selection":"evaluator-selected latest/previous-major channel slot; exact observed versions are execution evidence"} for x,(b,channel,device,os,at) in zip(ids(d,"matrix",10),slots)]
    return with_meta(d,{"package":p,"form":{"id":"form-a11y","packageId":package_record_id(p)},"release":r,"browserMatrix":matrix,"objectBundle":bundle(d,p,r),"operationIntents":[operation("ON-post-v1-public-forms-shareid-sessions-1ca37406cb","start-session"),operation("ON-get-v1-sessions-s-daef09677a","instrument-browser-runtime")]})

def generate(dataset_id):
    makers={"catalog-10000":catalog,"complex-1000":complex_form,"runtime-100-and-complex":runtime,"sessions-200":sessions_workload,"compile-1000":compile_workload,"responses-10000":responses,"durability-acknowledged-writes":durability,"browser-at-matrix":browser_matrix}
    if dataset_id not in makers: raise ValueError(f"unknown dataset: {dataset_id}")
    return makers[dataset_id]()
def write(dataset_id, output): value=generate(dataset_id); Path(output).parent.mkdir(parents=True,exist_ok=True); Path(output).write_bytes(canonical(value)+b"\n"); return value
def main():
    p=argparse.ArgumentParser();p.add_argument("--dataset",choices=DATASETS);p.add_argument("--all",action="store_true");p.add_argument("--output",required=True);p.add_argument("--verify",action="store_true");p.add_argument("--export-bundle",action="store_true",help="write deterministic actual JSON and relational CSV artifacts for responses-10000") ;a=p.parse_args()
    if a.export_bundle:
        if a.dataset not in (None,"responses-10000") or a.all: p.error("--export-bundle is only valid for responses-10000")
        value=generate("responses-10000"); paths=write_export_artifacts(value,a.output)
        print("T22 export bundle verified", ",".join(f"{name}:{path}" for name,path in paths.items())); return
    if a.all == (a.dataset is not None): p.error("choose exactly one of --dataset or --all")
    values=[write(x,Path(a.output)/f"{x}.json") for x in DATASETS] if a.all else [write(a.dataset,a.output)]
    for x in values:
        observed=x.pop("sha256"); assert observed==hashlib.sha256(canonical(x)).hexdigest();x["sha256"]=observed
    print("T22 generator verified", ",".join(x["datasetId"]+":"+x["sha256"] for x in values))
if __name__=="__main__":main()
