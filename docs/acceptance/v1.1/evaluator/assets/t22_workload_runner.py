#!/usr/bin/env python3
"""Inventory-bound T22 workload runner.

M2 leaves wire materialization, control-plane faults, browser probes and result
extraction unspecified.  A runtime adapter is therefore mandatory for execution;
without it this runner writes a complete blocked v4 record and exits nonzero.
"""
from __future__ import annotations
import argparse, base64, concurrent.futures, copy, csv, dataclasses, datetime, email.utils, hashlib, importlib.util, json, math, multiprocessing, os, re, signal, stat, subprocess, threading, time, urllib.error, urllib.request, uuid
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from t22_dataset_generator import EXPORT_OUTPUT_COLUMNS, EXPORT_SUBMISSION_WINDOW, EXPORT_TARGET_FORM_ID, EXPORT_WORKSPACE_ID, canonical, generate
from t22_export_bundle import CSV_BUNDLE_CONTENT_TYPE, CSV_BUNDLE_FORMAT, JSON_CONTENT_TYPE, verify_export_artifacts

ROOT=Path(__file__).resolve().parents[2]; INVENTORY=ROOT/"denominators"/"o-named.json"
EVALUATOR_ROOT=Path(__file__).resolve().parent.parent
OPS={"catalog":"ON-get-v1-workspaces-w-forms-2cc818d28d","create":"ON-post-v1-workspaces-w-forms-89f650ba42","save":"ON-put-v1-workspaces-w-forms-f-drafts-d-d5d5fa6522","validateDraft":"ON-post-v1-workspaces-w-forms-f-drafts-d-validate-a7ada56c4b","publish":"ON-post-v1-workspaces-w-forms-f-releases-e3ec39e2bc","start":"ON-post-v1-public-forms-shareid-sessions-1ca37406cb","readSession":"ON-get-v1-sessions-s-daef09677a","saveAnswer":"ON-patch-v1-sessions-s-d902ee3064","validateSession":"ON-post-v1-sessions-s-validate-dde1446480","submit":"ON-post-v1-sessions-s-submissions-ba988d3740","importValidate":"ON-post-v1-workspaces-w-imports-validate-57f09aa4ca","importCommit":"ON-post-v1-workspaces-w-imports-candidateid-commit-9f77424a8c","submissions":"ON-get-v1-workspaces-w-submissions-bd7aaa46e9","createExportJson":"ON-post-v1-workspaces-w-exports-380db1264c","createExportRelationalCsv":"ON-post-v1-workspaces-w-exports-380db1264c"}
EXPORT_SELECTION={"formId":EXPORT_TARGET_FORM_ID,"filterSnapshot":{"workspaceId":EXPORT_WORKSPACE_ID,"formId":EXPORT_TARGET_FORM_ID,"releaseId":"release-7f0b3b08413bac14","submittedAtUtc":EXPORT_SUBMISSION_WINDOW,"statuses":["submitted"]},"columns":EXPORT_OUTPUT_COLUMNS,"includeDataDictionary":True,"includeInterpretation":True}
EXPORT_CREATE_OPERATIONS={
    "createExportJson":{"format":"json","request":{"format":"json",**copy.deepcopy(EXPORT_SELECTION)},"responseStatus":"queued"},
    "createExportRelationalCsv":{"format":CSV_BUNDLE_FORMAT,"request":{"format":CSV_BUNDLE_FORMAT,**copy.deepcopy(EXPORT_SELECTION)},"responseStatus":"queued"},
}
WORKLOADS={"large-catalog":("catalog-10000",1,1,["catalog"]),"complex-form":("complex-1000",1,1,["create","save","validateDraft","publish"]),"respondent-runtime":("runtime-100-and-complex",2,1,["start","readSession","saveAnswer"]),"save-submit":("sessions-200",20,10,["saveAnswer","validateSession","submit"]),"import-compile":("compile-1000",1,1,["importValidate","importCommit"]),"api-export":("responses-10000",1,1,["submissions","createExportJson","createExportRelationalCsv"]),"durability":("durability-acknowledged-writes",1,1,["saveAnswer","readSession"]),"accessibility-browser":("browser-at-matrix",1,1,["start","readSession"])}
MINIMUM_SAMPLES={"runtime100":2,"complexRuntime":2,"localRenderMilliseconds":2,"firstUsableMilliseconds":2,"compileValid":2,"compileInvalid":2,"catalog":2,"validation":2,"save":2,"submit":2,"export":2,"accessibility":2}
MIN_SAMPLES_PER_SERIES=2
COMPILE_MAX_POLLS=60
COMPILE_DEADLINE_SECONDS=30
COMPILE_POLL_CADENCE_SECONDS=0.050
ADAPTER_HOOK_TIMEOUT_SECONDS=10
RESOURCE_CEILINGS=json.loads((Path(__file__).resolve().parent/"t22-scale-limits.json").read_text())["frozenInputProtocol"]["referenceResources"]["benchmarkResourceCeilings"]
DISCOVERY_PROBE_PROTOCOL=json.loads((Path(__file__).resolve().parent/"t22-scale-limits.json").read_text())["frozenInputProtocol"]["browserDiscoveryProbe"]
RESOURCE_CATEGORIES=tuple(name for name,value in RESOURCE_CEILINGS.items() if isinstance(value,dict))
RESOURCE_MINIMUMS={name:{key:0.01 for key,value in RESOURCE_CEILINGS[name].items() if isinstance(value,(int,float)) and key != "monthlyCostUsd"} for name in RESOURCE_CATEGORIES}
THRESHOLDS={"large-catalog":{"p95Milliseconds":1000},"complex-form":{"p95Milliseconds":100,"maxSampleMilliseconds":500,"browserLongTasksMilliseconds":500},"respondent-runtime":{"runtime100P95Milliseconds":3000,"complexRuntimeP95Milliseconds":5000},"save-submit":{"saveP95Milliseconds":1000,"submitP95Milliseconds":2000,"validationP95Milliseconds":1000,"errorRate":0.001},"import-compile":{"p95Milliseconds":5000,"compileProgressMilliseconds":2000},"api-export":{"endToEndMilliseconds":60000,"cursorIntegrity":True,"downloads":2},"durability":{"dataLoss":0,"exactAcknowledgedWrites":20,"backupRpoHours":24,"restoreRtoHours":4,"noCorruption":True,"noTruncation":True,"queuedClientMutationsPreserved":True},"accessibility-browser":{"firstUsableP95Milliseconds":5000,"localRenderP95Milliseconds":100,"instrumentation":True}}
PROVISIONING={"large-catalog":[("create-catalog-forms",["create"]),("publish-selected-releases",["publish"]),("catalog-cursor-search",["catalog"])],"complex-form":[("create-form",["create"]),("save-complex-draft",["save"]),("validate-and-publish",["validateDraft","publish"])],"respondent-runtime":[("publish-and-activate-release",["publish"]),("start-evaluator-sessions",["start"])],"save-submit":[("publish-and-activate-release",["publish"]),("start-200-sessions",["start"])],"import-compile":[("validate-import-candidate",["importValidate"]),("commit-valid-candidate",["importCommit"])],"api-export":[("provision-submission-snapshot",["submissions"]),("create-json-export-job",["createExportJson"]),("create-relational-csv-export-job",["createExportRelationalCsv"])],"durability":[("publish-and-start-session",["publish","start"]),("acknowledge-save-sequence",["saveAnswer"])],"accessibility-browser":[("publish-and-start-instrumented-session",["publish","start"])]}

@dataclasses.dataclass(frozen=True)
class ExportJobHandle:
    format: str
    export_job_id: str
    create_response_sha256: str

BROWSER_DISCOVERY_FIELDS=("browserEvidence","browserChannelDiscovery","browserChannelDiscoveryRaw","browserChannelDiscoveryArtifactSha256","browserReleaseAuthorities")
BROWSER_WORKLOADS=frozenset(("complex-form","respondent-runtime","accessibility-browser"))

def validate_raw_result_contract(result, raw_schema):
    """Validate generic fields everywhere and discovery evidence only when executed in a browser workload."""
    if not isinstance(result,dict) or any(field not in result for field in raw_schema.get("required",())):
        return False
    if any(result.get(field) is None for field in raw_schema.get("requiredNonNull",())):
        return False
    conditional=raw_schema.get("browserDiscoveryConditional",{})
    fields=tuple(conditional.get("fields",()))
    if fields != BROWSER_DISCOVERY_FIELDS or set(conditional.get("workloads",())) != BROWSER_WORKLOADS:
        return False
    if result.get("workloadId") in BROWSER_WORKLOADS and result.get("executionStatus")=="executed":
        return all(field in result and result[field] is not None for field in fields)
    return True

def export_request_selection(request):
    return {key:copy.deepcopy(request[key]) for key in ("formId","filterSnapshot","columns","includeDataDictionary","includeInterpretation")}

def validate_export_selection(request,dataset):
    if export_request_selection(request) != EXPORT_SELECTION:
        raise RuntimeError("create-export selection differs from the frozen target-response snapshot")
    target=dataset.get("targetForm",{})
    responses=dataset.get("responses",[])
    distractors=dataset.get("distractorResponses",[])
    snapshot=EXPORT_SELECTION["filterSnapshot"]
    if target.get("id")!=request["formId"] or target.get("workspaceId")!=snapshot["workspaceId"] or target.get("releaseId")!=snapshot["releaseId"]:
        raise RuntimeError("frozen export selection does not bind the generated target form")
    if len(responses)!=10000 or any(row.get("workspaceId")!=snapshot["workspaceId"] or row.get("formId")!=request["formId"] or row.get("releaseId")!=snapshot["releaseId"] or row.get("status") not in snapshot["statuses"] or not (snapshot["submittedAtUtc"]["gte"] <= row.get("submittedAtUtc","") < snapshot["submittedAtUtc"]["lt"]) for row in responses):
        raise RuntimeError("frozen export selection does not select exactly the target 10000 responses")
    if not distractors or any(row.get("formId")==request["formId"] for row in distractors):
        raise RuntimeError("export dataset lacks excluded distractor form responses")

def export_job_binding_plan():
    return {"createOperations":[{"semantic":semantic,"operationId":OPS[semantic],"format":spec["format"],"request":spec["request"],"requestSelection":EXPORT_SELECTION,"responseBoundIds":[],"response":{"httpStatus":202,"required":["exportJobId","format","status"],"status":spec["responseStatus"]},"binding":{"format":"/format","exportJobId":"/exportJobId","immutableHandle":"format-specific"}} for semantic,spec in EXPORT_CREATE_OPERATIONS.items()],"completion":{"mustConsume":"bound create response exportJobId","required":["exportJobId","format","status","completed","completionMilliseconds"],"status":"completed"},"download":{"mustConsume":"bound create response exportJobId","required":["exportJobId","format","status","downloaded","elapsedMilliseconds"],"status":"downloaded"},"timing":{"start":"immediately-before-product-create-export","receipt":"immediately-after-create-response","measuredTotal":"create-through-verified-download"},"distinctFormats":True,"endToEndMilliseconds":60000}

BASE_HOOKS=("provision","materialize","extract","prepare_phase","capture_telemetry","exercise_limit","exercise_rate_control")
def load_operations():
    found={m["id"]:{"method":m["method"],"path":m["path"]} for m in json.loads(INVENTORY.read_text())["members"]}; missing=set(OPS.values())-set(found)
    if missing: raise RuntimeError("inventory missing O_named IDs: "+",".join(sorted(missing)))
    return found
def load_adapter(path):
    if not path:return None
    spec=importlib.util.spec_from_file_location("t22_runtime_adapter",path)
    if not spec or not spec.loader:raise RuntimeError("adapter cannot be loaded")
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def percentile(values,p):
    if not values:return None
    values=sorted(values);return values[min(len(values)-1,round((len(values)-1)*p))]
def now():return time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
def monotonic():return time.monotonic()
def materialization_plan(workload,phase,dataset,rate,duration):
    hooks=list(BASE_HOOKS)
    if workload=="complex-form":hooks += ["measure_local_complex_render","measure_browser_long_tasks"]
    if workload=="respondent-runtime":hooks += ["browser_instrument"]
    if workload=="api-export":hooks += ["cursor_page","export_complete","download_export"]
    if workload=="import-compile":hooks += ["start_compile","read_compile_progress","compile_verdict","commit_candidate"]
    if workload=="durability":hooks += ["restart","restore","verify_durability","acknowledge_write","inject_fault","measure_backup_restore"]
    if workload=="accessibility-browser":hooks += ["browser_instrument"]
    plan={"schemaVersion":"t22-materialization-plan/v3","workloadId":workload,"phase":phase,"datasetId":dataset["datasetId"],"datasetSha256":dataset["sha256"],"ratePerSecond":rate,"durationSeconds":duration,"concurrency":"paced ThreadPoolExecutor; scheduled i/ratePerSecond","resourceCeilings":RESOURCE_CEILINGS,"operationIds":[OPS[x] for x in WORKLOADS[workload][3]],"provisioningPlan":[{"step":step,"operationIds":[OPS[x] for x in semantics],"materialization":"runtime-adapter-required"} for step,semantics in PROVISIONING[workload]],"limitCases":11,"rateControlClasses":["administrative","draft","tenant-aggregate"],"requiredAdapterMethods":hooks}
    if workload=="api-export":
        plan["exportJobBinding"]=export_job_binding_plan()
    return plan
def result_base(workload,phase,dataset,rate,duration,plan,status):
    # Complete v4 shape is emitted before any prerequisite check.
    started=now()
    return {"schemaVersion":"t22-raw-result/v4","runId":"run-"+str(uuid.uuid4()),"workloadId":workload,"datasetId":dataset["datasetId"],"datasetSha256":dataset["sha256"],"window":phase,"executionStatus":status,"verdict":status,"ratePerSecond":rate,"durationSeconds":duration,"startedAtUtc":started,"endedAtUtc":started,"sampleCount":0,"p50Milliseconds":None,"p95Milliseconds":None,"p99Milliseconds":None,"latencyBuckets":{},"stageExecution":[],"setupSamples":[],"samples":[],"measurementSamples":[],"browserEvidence":[],"browserChannelDiscovery":[],"browserChannelDiscoveryRaw":[],"browserChannelDiscoveryArtifactSha256":None,"browserReleaseAuthorities":None,"exportJobChains":{},"memoryBytesPeak":None,"resourceAllocation":None,"resourceCeilings":RESOURCE_CEILINGS,"cost":None,"errorCount":0,"errorRate":0.0,"rawSamplesArtifactSha256":None,"requestPlanSha256":hashlib.sha256(canonical(plan)).hexdigest(),"blockers":[],"thresholds":THRESHOLDS[workload],"thresholdFailures":[]}
def block(workload,phase,dataset,rate,duration,plan,*messages):
    r=result_base(workload,phase,dataset,rate,duration,plan,"blocked");r["blockers"]=list(messages);r["stageExecution"].append({"stage":"prerequisite","state":"blocked","detail":"; ".join(messages)});return r
def render(template,handles):
    for key,value in handles.items():template=template.replace("{"+key+"}",str(value))
    if "{" in template:raise RuntimeError("unresolved normative-path handle")
    return template
def http_call(base_url,authorization,operation,handles,prepared):
    headers={"Content-Type":"application/json",**prepared.get("headers",{})}
    if authorization:headers["Authorization"]=authorization
    body=prepared.get("body"); rendered_path=render(operation["path"],handles);request=urllib.request.Request(urljoin(base_url.rstrip("/")+"/",rendered_path.lstrip("/")),data=None if body is None else canonical(body),method=operation["method"],headers=headers);begin=time.perf_counter()
    try:
        with urllib.request.urlopen(request,timeout=30) as response:return {"httpStatus":response.status,"elapsedMilliseconds":round((time.perf_counter()-begin)*1000,3),"body":response.read().decode("utf-8",errors="replace"),"requestPath":rendered_path,"errorClass":None}
    except urllib.error.HTTPError as error:return {"httpStatus":error.code,"elapsedMilliseconds":round((time.perf_counter()-begin)*1000,3),"body":error.read().decode("utf-8",errors="replace"),"errorClass":"http"}
    except Exception as error:return {"httpStatus":None,"elapsedMilliseconds":round((time.perf_counter()-begin)*1000,3),"body":"","errorClass":type(error).__name__}
def run_operation(adapter,operations,base_url,auth,workload,semantic,handles,dataset,ordinal,strict=True,response_binding=None):
    # A request never observes a partially merged concurrent handle mutation.
    snapshot=copy.deepcopy(handles); identity={key:snapshot.get(key) for key in ("sessionId","formId","releaseId") if key in snapshot}; prepared=adapter.materialize(workload,semantic,dataset,snapshot,ordinal)
    if any(snapshot.get(key)!=value for key,value in identity.items()): raise RuntimeError("adapter mutated frozen request identity")
    if not isinstance(prepared,dict): raise RuntimeError("materialize must return a request mapping")
    if response_binding is not None and prepared.get("body") != response_binding["request"]:
        raise RuntimeError("format-specific create-export request differs from frozen normative body")
    if response_binding is not None: validate_export_selection(prepared["body"],dataset)
    final_request={"path":render(operations[OPS[semantic]]["path"],snapshot)}
    sample=http_call(base_url,auth,operations[OPS[semantic]],snapshot,prepared)
    # Test adapters may replace the transport, but the runner still records the
    # exact rendered request it dispatched and rejects transport disagreement.
    sample.setdefault("requestPath",final_request["path"])
    if sample["requestPath"]!=final_request["path"]: raise RuntimeError("transport request path differs from final rendered request")
    sample.update({"operationId":OPS[semantic],"semantic":semantic,"ordinal":ordinal,**({"sessionId":identity["sessionId"]} if "sessionId" in identity else {})})
    # Session coverage records the immutable final request identity, never the
    # selected handle before materialization.  A materializer cannot rewrite it.
    if semantic in {"readSession","saveAnswer","validateSession","submit"}:
        expected=identity.get("sessionId"); path=sample.get("requestPath")
        match=re.fullmatch(r"/v1/sessions/([^/?#]+)(?:/(?:validate|submissions))?",path or "")
        if not isinstance(expected,str) or not expected or not match or match.group(1)!=expected:
            raise RuntimeError("materialized request session identity differs from final rendered path")
        final_identity={"sessionId":match.group(1),"requestPath":path}
        if prepared.get("immutableRequestIdentity") is not None and prepared["immutableRequestIdentity"]!=final_identity:
            raise RuntimeError("adapter attempted to mutate immutable request identity")
        sample["sessionId"]=final_identity["sessionId"]
        sample["immutableRequestIdentity"]=final_identity
    if strict and (sample["errorClass"] or not 200<=sample["httpStatus"]<300):raise RuntimeError("HTTP failure "+json.dumps({k:v for k,v in sample.items() if k!="body"},sort_keys=True))
    if response_binding is not None:
        if sample["httpStatus"] != 202: raise RuntimeError("create-export operation must return HTTP 202")
        try: response=json.loads(sample["body"])
        except (TypeError,json.JSONDecodeError) as error: raise RuntimeError("create-export response is not JSON") from error
        required={"exportJobId","format","status"}
        if not isinstance(response,dict) or set(response)!=required or not isinstance(response["exportJobId"],str) or not response["exportJobId"] or response["format"]!=response_binding["format"] or response["status"]!=response_binding["responseStatus"]:
            raise RuntimeError("create-export response/binding is missing or differs from its format")
        selection=export_request_selection(response_binding["request"])
        sample["exportCreateBinding"]={"format":response["format"],"exportJobId":response["exportJobId"],"status":response["status"],"request":copy.deepcopy(response_binding["request"]),"requestSelection":selection,"requestSelectionSha256":hashlib.sha256(canonical(selection)).hexdigest()}
    elif not sample["errorClass"] and 200<=sample["httpStatus"]<300:
        adapter.extract(workload,semantic,sample,handles)
    sample["responseSha256"]=hashlib.sha256(sample.pop("body").encode()).hexdigest();return sample
def bucket(workload,sample):
    if workload=="save-submit":return {"saveAnswer":"save","validateSession":"validation","submit":"submit"}.get(sample["semantic"],"setup")
    if workload=="respondent-runtime":return "runtime100" if sample["ordinal"]%2==0 else "complexRuntime"
    return "http"
def record_stage(result,name,state="executed",detail=None):result["stageExecution"].append({"stage":name,"state":state,**({"detail":detail} if detail else {})})
def finite_timing(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
def save_submit_load(rate, duration, minimum_samples):
    """Build the actual save/validate/submit execution schedule from protocol minima."""
    if not isinstance(rate,int) or not isinstance(duration,int) or rate <= 0 or duration <= 0:
        raise RuntimeError("save-submit rate and duration must be positive integers")
    required={bucket:minimum_samples.get(bucket) for bucket in ("save","validation","submit")}
    if any(not isinstance(count,int) or count < 2 for count in required.values()):
        raise RuntimeError("save-submit protocol minima must be integer values >=2")
    return (["saveAnswer"]*max(rate*duration,required["save"])
            + ["validateSession"]*required["validation"]
            + ["submit"]*required["submit"])

def _adapter_rpc_loop(adapter, connection):
    os.setsid()
    send_lock=threading.Lock()
    def dispatch(request_id,method,args):
        base={index:copy.deepcopy(value) for index,value in enumerate(args) if isinstance(value,dict)}
        try: result=(request_id,True,getattr(adapter,method)(*args))
        except BaseException as error: result=(request_id,False,type(error).__name__+": "+str(error))
        # Adapter hooks commonly bind opaque IDs into ``handles``.  RPC
        # serialization would otherwise discard those in-place updates.  Return
        # each mutable mapping after its call so the parent supplies the exact
        # updated handles to the next ordered RPC.
        # Return only explicit changed leaves with the version observed by this
        # hook; never return/merge a completion-order full handle snapshot.
        def diff(before,after,path=()):
            operations=[]
            for key in before:
                if key not in after: operations.append({"op":"delete","path":[*path,key]})
            for key,value in after.items():
                if key not in before: operations.append({"op":"set","path":[*path,key],"value":copy.deepcopy(value)})
                elif isinstance(value,dict) and isinstance(before[key],dict): operations.extend(diff(before[key],value,[*path,key]))
                elif before[key]!=value: operations.append({"op":"set","path":[*path,key],"value":copy.deepcopy(value)})
            return operations
        updates={index:{"baseVersion":value.get("__handleVersion",0),"operations":diff(base[index],value)} for index,value in enumerate(args) if isinstance(value,dict)}
        with send_lock: connection.send((*result,updates))
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        while True:
            request=connection.recv()
            if request is None: return
            request_id,method,args=request; executor.submit(dispatch,request_id,method,args)

def bounded_hook(adapter, method, *args):
    """Do not let a materialization hook defeat the monotonic run deadline."""
    context=multiprocessing.get_context("fork")
    queue=context.Queue(1)
    def invoke():
        try: queue.put((True,getattr(adapter,method)(*args)))
        except BaseException as error: queue.put((False,type(error).__name__+": "+str(error)))
    process=context.Process(target=invoke); process.start()
    try: ok,value=queue.get(timeout=ADAPTER_HOOK_TIMEOUT_SECONDS)
    except Exception:
        process.terminate(); process.join(1)
        if process.is_alive(): process.kill(); process.join(1)
        queue.close(); raise RuntimeError("adapter hook timeout: "+method)
    try:
        process.join(1)
        if not ok: raise RuntimeError("adapter hook failed: "+method+": "+value)
        return value
    finally: queue.close(); process.close()

def apply_handle_delta(target,update):
    """Apply one ordered leaf-delta without replacing unrelated sibling handles."""
    if not isinstance(update,dict) or set(update)!={"baseVersion","operations"} or not isinstance(update["baseVersion"],int) or not isinstance(update["operations"],list): raise RuntimeError("invalid handle delta")
    if target.get("__handleVersion",0)!=update["baseVersion"]: raise RuntimeError("stale handle delta conflict")
    if not update["operations"]: return
    for operation in update["operations"]:
        if not isinstance(operation,dict) or operation.get("op") not in {"set","delete"}: raise RuntimeError("invalid handle delta operation")
        path=operation.get("path"); cursor=target
        if not isinstance(path,list) or not path or any(not isinstance(key,str) or key=="__handleVersion" for key in path): raise RuntimeError("invalid handle delta path")
        for key in path[:-1]:
            if key not in cursor: cursor[key]={}
            if not isinstance(cursor[key],dict): raise RuntimeError("handle delta type conflict")
            cursor=cursor[key]
        key=path[-1]
        if operation["op"]=="set":
            if "value" not in operation: raise RuntimeError("handle delta set value missing")
            cursor[key]=copy.deepcopy(operation["value"])
        else:
            if key not in cursor: raise RuntimeError("handle delta delete conflict")
            del cursor[key]
    target["__handleVersion"]=update["baseVersion"]+1

class BoundedAdapter:
    """One stateful Linux adapter process; handles survive across RPC hooks."""
    def __init__(self, adapter):
        context=multiprocessing.get_context("fork"); parent,child=context.Pipe()
        self._connection=parent; self._process=context.Process(target=_adapter_rpc_loop,args=(adapter,child)); self._process.start(); self._send_lock=threading.Lock(); self._handle_lock=threading.Lock(); self._condition=threading.Condition(); self._responses={}; self._next_request=0; self._closed=False
        self._receiver=threading.Thread(target=self._receive,daemon=True); self._receiver.start()
    def _receive(self):
        while not self._closed:
            try: request_id,ok,value,updates=self._connection.recv()
            except (EOFError,OSError): return
            with self._condition: self._responses[request_id]=(ok,value,updates); self._condition.notify_all()
    def __getattr__(self, method):
        def invoke(*args,timeout_seconds=ADAPTER_HOOK_TIMEOUT_SECONDS):
            with self._send_lock:
                self._next_request+=1; request_id=self._next_request; self._connection.send((request_id,method,args))
            with self._condition: ready=self._condition.wait_for(lambda:request_id in self._responses,timeout_seconds)
            if not ready:
                os.killpg(self._process.pid, signal.SIGTERM); self._process.join(1)
                if self._process.is_alive(): os.killpg(self._process.pid, signal.SIGKILL); self._process.join(1)
                raise RuntimeError("adapter hook timeout: "+method)
            with self._condition: ok,value,updates=self._responses.pop(request_id)
            if not ok: raise RuntimeError("adapter hook failed: "+method+": "+value)
            with self._handle_lock:
                for index,update in updates.items():
                    target=args[index]
                    if not isinstance(target,dict): continue
                    # Read-only hooks carry an empty delta.  They must not
                    # advance a shared handle's version or turn an otherwise
                    # independent later mutation into a false conflict.
                    if isinstance(update,dict) and update.get("operations")==[]: continue
                    apply_handle_delta(target,update)
            return value
        return invoke
    def close(self):
        self._closed=True
        if self._process.is_alive(): self._connection.send(None); self._process.join(1)
        if self._process.is_alive(): os.killpg(self._process.pid, signal.SIGKILL); self._process.join(1)
        self._connection.close(); self._process.close()

def evidence_envelope(result):
    """Immutable evidence identity; no result field may be replayed out of context."""
    return {key:result.get(key) for key in ("runId","workloadId","datasetId","datasetSha256","window","startedAtUtc","endedAtUtc","measurementSamples","browserEvidence","browserChannelDiscovery","browserChannelDiscoveryRaw","browserChannelDiscoveryArtifactSha256","browserReleaseAuthorities","exportJobChains","exportVerification","memoryBytesPeak","resourceAllocation","resourceCeilings","cost","thresholds")}

def rfc3339_utc(value):
    if not isinstance(value,str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z",value): return None
    try:return datetime.datetime.fromisoformat(value[:-1]+"+00:00")
    except ValueError:return None

def browser_matrix():
    matrix=generate("browser-at-matrix")["browserMatrix"]
    tuples={(item["browser"],item["requestedChannel"],item["device"],item["os"],item["at"]) for item in matrix}
    if not matrix or len({item["id"] for item in matrix}) != len(matrix) or len(tuples)!=len(matrix): raise RuntimeError("frozen browser/AT matrix IDs or resolved configuration tuples are not unique")
    # The four desktop browser families must provide adjacent latest/previous
    # channel slots.  Mobile slots cover the additional iOS/Android targets.
    desktop={(item["browser"],item["device"],item["os"]):set() for item in matrix if item["device"] in ("desktop","macOS")}
    for item in matrix:
        if item["device"] in ("desktop","macOS"): desktop[(item["browser"],item["device"],item["os"])].add(item["requestedChannel"])
    required={"Chrome","Edge","Firefox","Safari"}
    if {browser for browser,_,_ in desktop} != required or any(channels != {"latest","previous-major"} for channels in desktop.values()):
        raise RuntimeError("browser matrix must freeze adjacent desktop channel slots")
    if not any(item["browser"]=="Safari" and item["os"]=="iOS" for item in matrix) or not any(item["browser"]=="Chrome" and item["os"]=="Android" for item in matrix):
        raise RuntimeError("browser matrix must include iOS Safari and Android Chrome")
    return matrix

def browser_major(version):
    try:
        value=str(version).split(".",1)[0]
        return int(value) if value and str(int(value)) == value else None
    except (TypeError,ValueError):
        return None

DISCOVERY_SLOT_KEYS={"configId","browser","requestedChannel","browserVersion","device","os","osVersion","at","atVersion","resolvedAtUtc","detection","sessionBinding"}
DISCOVERY_DETECTION_KEYS={"sourceKind","tool","command","rawOutput","rawOutputSha256"}

def strict_json(raw, description):
    """Decode JSON without accepting duplicate keys or JavaScript constants."""
    def reject_pairs(entries):
        result={}
        for key,value in entries:
            if key in result: raise ValueError("duplicate key: "+key)
            result[key]=value
        return result
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=reject_pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError("non-finite constant: "+value)))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise RuntimeError(description+" is not strict UTF-8 JSON") from error

def discovery_rule(config):
    rules=[rule for rule in DISCOVERY_PROBE_PROTOCOL["sourceRules"] if rule.get("configId")==config.get("id")]
    if len(rules)!=1: raise RuntimeError("no unique frozen discovery source rule for matrix slot")
    return rules[0]

def require_exact_object(value, keys, description):
    if not isinstance(value,dict) or set(value)!=set(keys): raise RuntimeError(description+" has missing or extra fields")
    return value

def require_required_object(value, keys, description):
    if not isinstance(value,dict) or not set(keys)<=set(value): raise RuntimeError(description+" has missing required fields")
    return value

def require_string(value, description, nullable=False):
    if value is None and nullable: return value
    if not isinstance(value,str) or not value: raise RuntimeError(description+" must be a nonempty string")
    return value

def canonical_browser_name(value):
    names={"chrome":"Chrome","microsoftedge":"Edge","edge":"Edge","firefox":"Firefox","safari":"Safari"}
    normalized=names.get(str(value).casefold())
    if normalized is None: raise RuntimeError("provider browserName is unsupported")
    return normalized

def canonical_platform_name(value):
    names={"windows":"Windows","macos":"macOS","mac os":"macOS","ios":"iOS","android":"Android"}
    normalized=names.get(str(value).casefold())
    if normalized is None: raise RuntimeError("provider platformName is unsupported")
    return normalized

def retained_http_json(record, description):
    """Revalidate exact provider HTTP status/header/body evidence before use."""
    required={"status","headersBase64","headersSha256","bodyBase64","bodySha256"}
    if not isinstance(record,dict) or set(record)!=required or not isinstance(record["status"],int):
        raise RuntimeError(description+" raw HTTP record is malformed")
    try:
        headers=base64.b64decode(record["headersBase64"],validate=True)
        body=base64.b64decode(record["bodyBase64"],validate=True)
    except Exception as error: raise RuntimeError(description+" raw HTTP record is not base64") from error
    if hashlib.sha256(headers).hexdigest()!=record["headersSha256"] or hashlib.sha256(body).hexdigest()!=record["bodySha256"]:
        raise RuntimeError(description+" raw HTTP SHA-256 differs")
    return strict_json(body,description+" response")

def raw_browser_identity(document, config, rule):
    """Parse a frozen browser provider response without trusting nonstandard AT keys."""
    kind=rule["browserSourceKind"]
    browser_source=document["browserSource"]
    if kind=="webdriver-capabilities":
        source=require_exact_object(browser_source,{"endpointUrl","endpointAuthority","providerHttp","providerResponse"},"persistent WebDriver browser source")
        parsed=urlsplit(require_string(source["endpointUrl"],"WebDriver endpoint URL"))
        authority=require_string(source["endpointAuthority"],"WebDriver endpoint authority")
        test_mode=os.getenv("T22_BROWSER_PROBE_TEST_MODE")=="1"
        if parsed.scheme not in ({"https"} if not test_mode else {"https","http"}) or parsed.scheme+"://"+parsed.netloc != authority or parsed.username or parsed.password:
            raise RuntimeError("persistent WebDriver endpoint authority is invalid")
        response=retained_http_json(source["providerHttp"],"WebDriver provider")
        if source["providerHttp"]["status"] < 200 or source["providerHttp"]["status"] >= 300 or response != source["providerResponse"]:
            raise RuntimeError("WebDriver parsed provider response does not derive from retained HTTP bytes")
        response=require_required_object(response,{"value"},"WebDriver provider response")
        value=require_required_object(response["value"],{"sessionId","capabilities"},"WebDriver response value")
        capabilities=require_required_object(value["capabilities"],{"browserName","browserVersion","platformName"},"WebDriver capabilities")
        if {"accessibilityName","accessibilityVersion"} & set(capabilities):
            raise RuntimeError("ordinary WebDriver accessibility capabilities are not a frozen AT source")
        browser=canonical_browser_name(capabilities["browserName"]); os_name=canonical_platform_name(capabilities["platformName"])
        capability=rule["requiredDeviceCapability"]; device_id=capabilities.get(capability)
        if not isinstance(value["sessionId"],str) or not value["sessionId"] or not isinstance(device_id,str) or not device_id:
            raise RuntimeError("provider omitted immutable session ID or frozen device/UDID capability")
        if config["device"]=="mobile":
            if not isinstance(capabilities.get("appium:deviceName"),str) or not capabilities["appium:deviceName"]: raise RuntimeError("Appium mobile capabilities require appium:deviceName")
            device="mobile"
        else: device="macOS" if os_name=="macOS" else "desktop"
        os_version=capabilities.get("platformVersion")
        if not isinstance(os_version,str) or not os_version: os_version="provider-unreported"
        return {"browser":browser,"browserVersion":capabilities["browserVersion"],"os":os_name,"osVersion":os_version,"device":device,
                "sessionBinding":{"sessionId":value["sessionId"],"deviceId":device_id,"endpointUrl":source["endpointUrl"],"endpointAuthority":authority,"capabilitiesSha256":hashlib.sha256(canonical(capabilities)).hexdigest()}}
    if kind=="playwright-browser-version":
        required=DISCOVERY_PROBE_PROTOCOL["sourceSchemas"][kind]["browserSourceRequiredKeys"]
        source=require_required_object(browser_source,required,"Playwright browser source")
        return {"browser":canonical_browser_name(source["browserName"]),"browserVersion":source["browserVersion"],"os":canonical_platform_name(source["platformName"]),"osVersion":source["platformVersion"],"device":source["deviceName"]}
    raise RuntimeError("unrecognized frozen browser source kind")

def raw_accessibility_identity(document, config, rule):
    kind=rule["accessibilitySourceKind"]
    if kind=="none": return {"at":"none","atVersion":None}
    if kind!="native-version-command": raise RuntimeError("unrecognized frozen accessibility source kind")
    source=require_required_object(document.get("accessibilitySource"),{"native","providerResponses"},"native accessibility source")
    native=require_required_object(source["native"],{"accessibility","platform","device"},"native accessibility evidence")
    accessibility=require_required_object(native["accessibility"],{"name","version"},"native accessibility identity")
    platform_source=require_required_object(native["platform"],{"name","version"},"native accessibility platform")
    responses=source["providerResponses"]
    if not isinstance(responses,list) or len(responses)!=1:
        raise RuntimeError("native accessibility provider responses are incomplete")
    record=responses[0]
    if not isinstance(record,dict) or set(record)!={"command","http","response"} or record.get("command")!=["provider-session-execute","t22:accessibility"]:
        raise RuntimeError("AT evidence must come from the persistent provider session endpoint")
    response=retained_http_json(record["http"],"provider AT capability")
    if record["http"]["status"] < 200 or record["http"]["status"] >= 300 or response != record["response"]:
        raise RuntimeError("AT parsed capability does not derive from retained provider bytes")
    if response.get("value",{}).get("accessibility") != accessibility or response.get("value",{}).get("deviceId") != native["device"]:
        raise RuntimeError("AT capability response is not bound to the native AT identity/device")
    if canonical_platform_name(platform_source["name"])!=config["os"]: raise RuntimeError("native accessibility platform does not match matrix slot")
    if config["device"]=="mobile" and not isinstance(native["device"],str): raise RuntimeError("native accessibility device is missing")
    return {"at":accessibility["name"],"atVersion":accessibility["version"]}

def parse_probe_output(raw, config, resolved_at=None):
    """Derive one slot from retained full provider responses and a required subset."""
    document=strict_json(raw,"browser discovery probe output")
    rule=discovery_rule(config)
    required={"browserSource"} | ({"accessibilitySource"} if rule["accessibilitySourceKind"]!="none" else set())
    if not isinstance(document,dict) or set(document)!=required: raise RuntimeError("browser discovery probe output has missing or extra sources")
    browser=raw_browser_identity(document,config,rule)
    accessibility=raw_accessibility_identity(document,config,rule)
    if accessibility["at"] != "none" and document["accessibilitySource"]["native"].get("device") != browser["sessionBinding"]["deviceId"]:
        raise RuntimeError("native AT evidence device/UDID is not the persistent provider device")
    derived={**browser,**accessibility}
    for key in ("browser","browserVersion","os","osVersion","device","at"):
        require_string(derived[key],"derived discovery "+key)
    require_string(derived["atVersion"],"derived discovery AT version") if derived["at"]!="none" else None
    if derived["at"]=="none" and derived["atVersion"] is not None: raise RuntimeError("derived discovery AT/version is inconsistent")
    if browser_major(derived["browserVersion"]) is None: raise RuntimeError("derived discovery browser version is invalid")
    if any(derived[key]!=config[key] for key in ("browser","device","os","at")): raise RuntimeError("probe-derived identity does not match frozen matrix slot")
    resolved_at=now() if resolved_at is None else resolved_at
    if not rfc3339_utc(resolved_at): raise RuntimeError("runner discovery resolution time is invalid")
    return {"configId":config["id"],"browser":derived["browser"],"requestedChannel":config["requestedChannel"],"browserVersion":derived["browserVersion"],"device":derived["device"],"os":derived["os"],"osVersion":derived["osVersion"],"at":derived["at"],"atVersion":derived["atVersion"],"resolvedAtUtc":resolved_at,"detection":{"sourceKind":rule["browserSourceKind"],"tool":rule["tool"],"command":rule["command"],"rawOutput":raw.decode("utf-8"),"rawOutputSha256":hashlib.sha256(raw).hexdigest()},"sessionBinding":browser.get("sessionBinding")}

def _release_url(browser):
    rules=DISCOVERY_PROBE_PROTOCOL["releaseAuthorities"]["rules"]; rule=rules.get(browser)
    if not rule: raise RuntimeError("release authority missing browser")
    test=os.getenv("T22_BROWSER_PROBE_TEST_MODE")=="1"; override=os.getenv("T22_RELEASE_AUTHORITY_TEST_BASE_URL")
    url=(override.rstrip("/")+"/"+browser if test and override else rule["url"])
    parsed=urlsplit(url)
    if test:
        if parsed.scheme not in {"http","https"} or parsed.hostname not in {"localhost","127.0.0.1"}: raise RuntimeError("test release catalog must be loopback")
    elif parsed.scheme!="https" or parsed.hostname not in rule["hosts"]: raise RuntimeError("release authority URL is not frozen HTTPS allowlisted host")
    return url,rule

def _release_majors(browser, parser, raw):
    document=strict_json(raw,"release authority")
    # Explicit test mode supplies only authority-owned current/previous values.
    if os.getenv("T22_BROWSER_PROBE_TEST_MODE")=="1":
        if not isinstance(document,dict) or document.get("browser")!=browser or not isinstance(document.get("latestMajor"),int) or not isinstance(document.get("previousMajor"),int): raise RuntimeError("test release catalog has malformed browser major pair")
        return document["latestMajor"],document["previousMajor"],document.get("publishedAtUtc")
    versions=[]
    if parser=="chrome-for-testing": versions=[item.get("version","") for item in document.get("versions",[]) if isinstance(item,dict)]
    elif parser=="edge-updates": versions=[item.get("ProductVersion","") for product in document if isinstance(product,dict) for item in product.get("Releases",[]) if isinstance(item,dict)]
    elif parser=="mozilla-major-history": versions=list(document.keys()) if isinstance(document,dict) else []
    elif parser=="apple-safari-release-catalog": versions=re.findall(r"Safari\s+(\d+(?:\.\d+)*)",raw.decode("utf-8","replace"))
    majors=sorted({browser_major(value) for value in versions if browser_major(value) is not None},reverse=True)
    if len(majors)<2 or majors[0] != majors[1]+1: raise RuntimeError("release authority does not establish exact current/previous adjacent majors")
    return majors[0],majors[1],None

def _freshness_utc(value, label):
    parsed=rfc3339_utc(value)
    if parsed is None: raise RuntimeError(label+" is not strict RFC3339 UTC")
    return parsed

def resolve_release_authorities(matrix_entries, run_started_at):
    artifacts=[]; timeout=DISCOVERY_PROBE_PROTOCOL["timeoutSeconds"]
    started=_freshness_utc(run_started_at,"run start")
    maximum_age=DISCOVERY_PROBE_PROTOCOL["releaseAuthorities"]["maximumAgeSeconds"]
    for browser in sorted({item["browser"] for item in matrix_entries}):
        url,rule=_release_url(browser); retrieved=now()
        try:
            with urllib.request.urlopen(url,timeout=timeout) as response:
                raw=response.read(); status=response.status; headers={name.casefold():value for name,value in response.getheaders()}
        except Exception as error: raise RuntimeError("release authority retrieval failed for "+browser+": "+str(error)) from error
        if not 200 <= status < 300: raise RuntimeError("release authority returned non-success HTTP status")
        latest,previous,published=_release_majors(browser,rule["parser"],raw)
        retrieved_at=_freshness_utc(retrieved,"release retrieval")
        if retrieved_at < started or (datetime.datetime.now(datetime.timezone.utc)-retrieved_at).total_seconds() > maximum_age:
            raise RuntimeError("release authority retrieval is outside the evaluator run/freshness window")
        date_header=headers.get("date")
        if not date_header: raise RuntimeError("release authority HTTPS response lacks Date freshness metadata")
        try: date_at=email.utils.parsedate_to_datetime(date_header).astimezone(datetime.timezone.utc)
        except Exception as error: raise RuntimeError("release authority Date header is invalid") from error
        try: age=int(headers.get("age","0"))
        except ValueError as error: raise RuntimeError("release authority Age header is invalid") from error
        if age < 0 or (retrieved_at-date_at).total_seconds()+age > maximum_age:
            raise RuntimeError("release authority HTTP Date/Age freshness exceeds maximumAgeSeconds")
        # Test catalogs and release formats which publish a timestamp must prove
        # that source-specific generation/publishing is fresh too.
        published_at=_freshness_utc(published,"release authority publishedAtUtc") if published is not None else None
        if published_at is not None and (retrieved_at-published_at).total_seconds() > maximum_age:
            raise RuntimeError("release authority published freshness exceeds maximumAgeSeconds")
        artifacts.append({"browser":browser,"url":url,"endpointAuthority":urlsplit(url).scheme+"://"+urlsplit(url).netloc,"tls":urlsplit(url).scheme=="https","retrievedAtUtc":retrieved,"publishedAtUtc":published,"httpStatus":status,"httpDate":date_header,"httpAgeSeconds":age,"cacheControl":headers.get("cache-control"),"maximumAgeSeconds":maximum_age,"sha256":hashlib.sha256(raw).hexdigest(),"rawBase64":base64.b64encode(raw).decode("ascii"),"latestMajor":latest,"previousMajor":previous})
    return {"artifacts":artifacts,"artifactSha256":hashlib.sha256(canonical(artifacts)).hexdigest()}

def validate_release_bindings(slots, authorities):
    items={item["browser"]:item for item in authorities["artifacts"]}
    if len(items)!=4 or len(items)!=len(authorities["artifacts"]): raise RuntimeError("release authority evidence is incomplete")
    for slot in slots:
        authority=items.get(slot["browser"])
        if authority is None or authority["endpointAuthority"]==slot["sessionBinding"]["endpointAuthority"]: raise RuntimeError("measurement and release authorities are not independent")
        expected=authority["latestMajor"] if slot["requestedChannel"]=="latest" else authority["previousMajor"]
        if browser_major(slot["browserVersion"]) != expected: raise RuntimeError("persistent session browser major is stale or does not match release authority")

def close_browser_sessions(discovery):
    failures=[]
    for slot in discovery["slots"]:
        binding=slot["sessionBinding"]
        try:
            request=urllib.request.Request(binding["endpointUrl"].rstrip("/")+"/session/"+binding["sessionId"],method="DELETE")
            with urllib.request.urlopen(request,timeout=8): pass
        except Exception as error: failures.append(slot["configId"]+": "+str(error))
    if failures: raise RuntimeError("evaluator could not close persistent browser sessions: "+"; ".join(failures))

def owned_browser_probe():
    """Return only the frozen, contained, digest-pinned evaluator executable."""
    owned=DISCOVERY_PROBE_PROTOCOL["ownedProbe"]
    root=EVALUATOR_ROOT.resolve(); expected=(root/owned["repoRelativePath"]).resolve()
    try: expected.relative_to(root)
    except ValueError as error: raise RuntimeError("frozen owned probe path escapes evaluator root") from error
    actual_mode = int(f"{stat.S_IMODE(expected.stat().st_mode):o}") if expected.exists() else None
    if not expected.is_file() or actual_mode != owned.get("mode") or hashlib.sha256(expected.read_bytes()).hexdigest()!=owned["sha256"]:
        raise RuntimeError("owned browser discovery probe path, mode, or SHA-256 differs from frozen protocol")
    return expected

def resolve_browser_discovery(matrix_entries, selfcheck_fixtures=None, run_started_at=None):
    """Run the pinned evaluator probe directly once per slot; never ask adapters."""
    probe_executable=owned_browser_probe()
    run_started_at=now() if run_started_at is None else run_started_at
    release_authorities=resolve_release_authorities(matrix_entries,run_started_at)
    timeout=DISCOVERY_PROBE_PROTOCOL["timeoutSeconds"]; slots=[]; retained=[]
    try:
      for config in matrix_entries:
        try:
            completed=subprocess.run([str(probe_executable),"--config-id",config["id"]]+([] if selfcheck_fixtures is None else ["--selfcheck-fixtures",str(selfcheck_fixtures)]), shell=False, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RuntimeError("browser discovery probe failed or timed out for "+config["id"]+": "+str(error)) from error
        if completed.returncode != 0: raise RuntimeError("browser discovery probe returned nonzero for "+config["id"]+": "+completed.stderr.decode("utf-8","replace").strip())
        raw=bytes(completed.stdout)
        slot=parse_probe_output(raw,config)
        slots.append(slot); retained.append({"configId":config["id"],"resolvedAtUtc":slot["resolvedAtUtc"],"sha256":hashlib.sha256(raw).hexdigest(),"rawBase64":base64.b64encode(raw).decode("ascii")})
      validate_discovery_slots(slots,matrix_entries)
      validate_release_bindings(slots,release_authorities)
    except Exception:
      # A partial discovery has already created live provider sessions.  Close
      # exactly those sessions before reporting the discovery failure.
      if slots: close_browser_sessions({"slots":slots})
      raise
    return {"slots":slots,"raw":retained,"artifactSha256":hashlib.sha256(canonical(retained)).hexdigest(),"releaseAuthorities":release_authorities}

def validate_discovery_slots(slots,matrix_entries):
    expected={entry["id"]:entry for entry in matrix_entries}
    if len(slots)!=len(expected) or {row.get("configId") for row in slots if isinstance(row,dict)}!=set(expected): raise RuntimeError("browser discovery must contain exactly the frozen matrix slots")
    channel_majors={}
    for row in slots:
        if not isinstance(row,dict) or set(row)!=DISCOVERY_SLOT_KEYS: raise RuntimeError("browser discovery slot has missing or extra fields")
        frozen=expected[row["configId"]]
        if any(row[key]!=frozen[key] for key in ("browser","requestedChannel","device","os","at")) or not rfc3339_utc(row["resolvedAtUtc"]): raise RuntimeError("browser discovery slot is invalid")
        detection=require_exact_object(row["detection"],DISCOVERY_DETECTION_KEYS,"browser discovery detection")
        binding=row.get("sessionBinding")
        if not isinstance(binding,dict) or set(binding)!={"sessionId","deviceId","endpointUrl","endpointAuthority","capabilitiesSha256"} or any(not isinstance(binding.get(key),str) or not binding[key] for key in binding) or not re.fullmatch(r"[0-9a-f]{64}",binding["capabilitiesSha256"]):
            raise RuntimeError("browser discovery has no immutable session/device/endpoint binding")
        parsed=urlsplit(binding["endpointUrl"])
        if parsed.scheme+"://"+parsed.netloc != binding["endpointAuthority"] or parsed.username or parsed.password:
            raise RuntimeError("browser discovery endpoint binding is invalid")
        rule=discovery_rule(frozen)
        expected_detection={"sourceKind":rule["browserSourceKind"],"tool":rule["tool"],"command":rule["command"]}
        if any(detection[key]!=value for key,value in expected_detection.items()) or hashlib.sha256(detection["rawOutput"].encode("utf-8")).hexdigest()!=detection["rawOutputSha256"]: raise RuntimeError("browser discovery detection is not protocol-constrained")
        channel_majors.setdefault((row["browser"],row["device"],row["os"],row["requestedChannel"]),set()).add(browser_major(row["browserVersion"]))
    for browser,device,os in {(row["browser"],row["device"],row["os"]) for row in matrix_entries if row["device"] in ("desktop","macOS")}:
        latest=channel_majors.get((browser,device,os,"latest"),set()); previous=channel_majors.get((browser,device,os,"previous-major"),set())
        if len(latest)!=1 or len(previous)!=1 or next(iter(latest))!=next(iter(previous))+1: raise RuntimeError("browser discovery latest/previous majors are not adjacent")

def collect_browser_observations(adapter, workload, handles, dataset, package_identity, metrics, matrix_entries, discovery=None):
    """Collect independent browser observations for every frozen matrix configuration."""
    discovery=resolve_browser_discovery(matrix_entries) if discovery is None else discovery
    if not isinstance(discovery,dict) or set(discovery)!={"slots","raw","artifactSha256","releaseAuthorities"}: raise RuntimeError("parsed browser discovery state is invalid")
    slots={row["configId"]:row for row in discovery["slots"]}
    values={metric:[] for metric in metrics}; evidence=[]
    seen_values={metric:set() for metric in metrics}
    for config in matrix_entries:
        config_id=config["id"]
        for ordinal in range(MIN_SAMPLES_PER_SERIES):
            binding=slots[config_id]["sessionBinding"]
            probe=adapter.browser_instrument(workload,{**handles,"packageHandle":package_identity,"browserMatrixConfigId":config_id,"browserDiscoverySlot":copy.deepcopy(slots[config_id]),"browserTransportBinding":copy.deepcopy(binding),"sessionId":binding["sessionId"],"deviceId":binding["deviceId"],"endpointAuthority":binding["endpointAuthority"],"observationOrdinal":ordinal},dataset)
            if not isinstance(probe,dict) or probe.get("packageIdentity") != package_identity or probe.get("browserMatrixConfigId") != config_id:
                raise RuntimeError("browser instrumentation must bind package and frozen matrix configuration IDs")
            transport=probe.get("transportEvidence")
            required_transport={"sessionId":binding["sessionId"],"deviceId":binding["deviceId"],"endpointAuthority":binding["endpointAuthority"]}
            if not isinstance(transport,dict) or any(transport.get(key)!=value for key,value in required_transport.items()):
                raise RuntimeError("browser instrumentation transport is not bound to persistent provider session/device/endpoint")
            observed={key:probe.get(key) for key in ("browser","browserVersion","device","os","osVersion","at","atVersion")}
            observed["observedMajor"]=browser_major(observed["browserVersion"]); slot=slots[config_id]
            if any(observed[key] is None for key in ("browser","browserVersion","device","os","osVersion","at","observedMajor")) or (config["at"]=="none") != (observed["atVersion"] is None) or any(observed[key]!=slot.get(key) for key in ("browser","browserVersion","device","os","osVersion","at","atVersion")) or probe.get("resolvedChannel") != slot.get("requestedChannel") or probe.get("resolutionTimestampUtc")!=slot["resolvedAtUtc"] or probe.get("detection")!=slot["detection"]:
                raise RuntimeError("browser adapter must return observed resolved slot identity")
            for metric in metrics:
                value=probe.get(metric)
                if not finite_timing(value): raise RuntimeError("browser instrumentation metric missing: "+metric)
                # A single scalar repeated for all configurations/samples is not
                # independent evidence.  Values may collide in a real clock, but
                # every sample must carry its own immutable observation ID.
                observation_id=probe.get("observationId")
                if not isinstance(observation_id,str) or not observation_id or observation_id in seen_values[metric]: raise RuntimeError("browser observation IDs must be unique per metric")
                seen_values[metric].add(observation_id); values[metric].append(value)
                evidence.append({"transportEvidence":copy.deepcopy(required_transport),"configId":config_id,"packageIdentity":package_identity,"observationId":observation_id+":"+metric,"metric":metric,"ordinal":ordinal,"elapsedMilliseconds":value,"requestedChannel":slot["requestedChannel"],"resolutionTimestampUtc":probe["resolutionTimestampUtc"],"detection":copy.deepcopy(probe["detection"]),**observed})
    return values,evidence,discovery

def validate_browser_evidence(result, workload):
    evidence=result.get("browserEvidence",[])
    if workload not in ("complex-form","respondent-runtime","accessibility-browser"):
        return not evidence and not result.get("browserChannelDiscovery") and not result.get("browserChannelDiscoveryRaw") and result.get("browserChannelDiscoveryArtifactSha256") is None
    started,ended=rfc3339_utc(result.get("startedAtUtc")),rfc3339_utc(result.get("endedAtUtc"))
    discovery,retained=result.get("browserChannelDiscovery"),result.get("browserChannelDiscoveryRaw")
    if not started or not ended or ended < started or not isinstance(discovery,list) or not isinstance(retained,list) or not re.fullmatch(r"[0-9a-f]{64}",str(result.get("browserChannelDiscoveryArtifactSha256",""))): return False
    try:
        if result.get("rawSamplesArtifactSha256") != hashlib.sha256(canonical(evidence_envelope(result))).hexdigest(): return False
        if hashlib.sha256(canonical(retained)).hexdigest()!=result["browserChannelDiscoveryArtifactSha256"]: return False
        expected={row["id"]:row for row in browser_matrix()}
        if len(retained)!=len(expected) or {row.get("configId") for row in retained if isinstance(row,dict)}!=set(expected): return False
        reparsed=[]
        for artifact in retained:
            if not isinstance(artifact,dict) or set(artifact)!={"configId","resolvedAtUtc","sha256","rawBase64"}: return False
            raw=base64.b64decode(artifact["rawBase64"],validate=True)
            if hashlib.sha256(raw).hexdigest()!=artifact["sha256"]: return False
            reparsed.append(parse_probe_output(raw,expected[artifact["configId"]],artifact["resolvedAtUtc"]))
        validate_discovery_slots(reparsed,browser_matrix())
        authorities=result.get("browserReleaseAuthorities")
        if not isinstance(authorities,dict) or set(authorities)!={"artifacts","artifactSha256"} or hashlib.sha256(canonical(authorities["artifacts"])).hexdigest()!=authorities["artifactSha256"]: return False
        for artifact in authorities["artifacts"]:
            if not isinstance(artifact,dict) or not isinstance(artifact.get("browser"),str): return False
            raw=base64.b64decode(artifact["rawBase64"],validate=True)
            if hashlib.sha256(raw).hexdigest()!=artifact.get("sha256"): return False
            _, rule=_release_url(artifact["browser"])
            latest,previous,_=_release_majors(artifact["browser"],rule["parser"],raw)
            if (latest,previous)!=(artifact.get("latestMajor"),artifact.get("previousMajor")): return False
            maximum=DISCOVERY_PROBE_PROTOCOL["releaseAuthorities"]["maximumAgeSeconds"]
            if artifact.get("maximumAgeSeconds")!=maximum or artifact.get("httpStatus") not in range(200,300) or not isinstance(artifact.get("httpDate"),str) or not isinstance(artifact.get("httpAgeSeconds"),int) or artifact["httpAgeSeconds"]<0: return False
            retrieved_at=rfc3339_utc(artifact.get("retrievedAtUtc"))
            if retrieved_at is None or not started <= retrieved_at <= ended: return False
            try: date_at=email.utils.parsedate_to_datetime(artifact["httpDate"]).astimezone(datetime.timezone.utc)
            except Exception: return False
            if (retrieved_at-date_at).total_seconds()+artifact["httpAgeSeconds"] > maximum: return False
            if artifact.get("publishedAtUtc") is not None:
                published_at=rfc3339_utc(artifact["publishedAtUtc"])
                if published_at is None or (retrieved_at-published_at).total_seconds() > maximum: return False
        validate_release_bindings(reparsed,authorities)
    except (RuntimeError, ValueError): return False
    if discovery!=reparsed: return False
    slots={row["configId"]:row for row in reparsed}
    if len(slots)!=len(discovery): return False
    if any(not (started <= rfc3339_utc(row["resolvedAtUtc"]) <= ended) for row in slots.values()): return False
    if not evidence or len({row.get("observationId") for row in evidence}) != len(evidence): return False
    required={"configId","packageIdentity","observationId","metric","ordinal","elapsedMilliseconds","browser","browserVersion","observedMajor","device","os","osVersion","at","atVersion","requestedChannel","resolutionTimestampUtc","detection","transportEvidence"}
    if any(not isinstance(row,dict) or required-set(row) or not all(isinstance(row[key],str) and row[key] for key in ("configId","packageIdentity","observationId","metric")) or not isinstance(row["ordinal"],int) or row["ordinal"]<0 or not finite_timing(row["elapsedMilliseconds"]) for row in evidence): return False
    matrix_ids={row["id"] for row in browser_matrix()}
    if any(row["configId"] not in matrix_ids for row in evidence): return False
    configs={row["id"]:row for row in browser_matrix()}
    for row in evidence:
        observed_at=rfc3339_utc(row.get("resolutionTimestampUtc"))
        binding=slots[row["configId"]]["sessionBinding"]
        expected_transport={key:binding[key] for key in ("sessionId","deviceId","endpointAuthority")}
        if (observed_at is None or not started <= observed_at <= ended or any(row[key] != slots[row["configId"]][key] for key in ("browser","browserVersion","device","os","osVersion","at","atVersion","requestedChannel")) or row.get("resolutionTimestampUtc") != slots[row["configId"]]["resolvedAtUtc"] or row.get("detection") != slots[row["configId"]]["detection"] or row.get("transportEvidence") != expected_transport): return False
    by_bucket={}; observed_channels={}
    for row in evidence: by_bucket.setdefault((row["packageIdentity"],row["metric"]),set()).add((row["configId"],row["ordinal"]))
    for row in evidence:
        key=(row["browser"],row["device"],row["os"],row["requestedChannel"])
        if not isinstance(row["observedMajor"],int) or row["observedMajor"] != browser_major(row["browserVersion"]): return False
        observed_channels.setdefault(key,set()).add(row["observedMajor"])
    for browser,device,os in {(item["browser"],item["device"],item["os"]) for item in browser_matrix() if item["device"] in ("desktop","macOS")}:
        latest=observed_channels.get((browser,device,os,"latest"),set()); previous=observed_channels.get((browser,device,os,"previous-major"),set())
        if len(latest)!=1 or len(previous)!=1 or next(iter(latest)) != next(iter(previous))+1: return False
    return all({(config, ordinal) for config in matrix_ids for ordinal in range(MIN_SAMPLES_PER_SERIES)} <= samples for samples in by_bucket.values())

def immutable_artifact_bytes(download):
    """Read one immutable artifact representation and verify its declared digest."""
    supplied = [key for key in ("bytes", "path") if download.get(key) is not None]
    if len(supplied) != 1:
        raise RuntimeError("export download must supply exactly one immutable bytes or path source")
    if supplied[0] == "path":
        path = Path(download["path"])
        if not path.is_file(): raise RuntimeError("export artifact path is not a regular file")
        raw = path.read_bytes()
    else:
        raw = download["bytes"]
        if isinstance(raw, str): raw = raw.encode("utf-8")
        if not isinstance(raw, (bytes, bytearray)): raise RuntimeError("export artifact bytes are not immutable byte content")
        raw = bytes(raw)
    if hashlib.sha256(raw).hexdigest() != download.get("sha256"):
        raise RuntimeError("export artifact bytes/path SHA-256 differs from declared digest")
    return raw

def verify_export_downloads(dataset, bound_jobs, completions, downloads):
    """Verify product-created, response-bound format jobs and frozen export bytes."""
    required = {"json": ("json", JSON_CONTENT_TYPE), CSV_BUNDLE_FORMAT: (CSV_BUNDLE_FORMAT, CSV_BUNDLE_CONTENT_TYPE)}
    if set(bound_jobs)!=set(required) or set(completions)!=set(required):
        raise RuntimeError("export requires both response-bound create jobs and completions")
    if len({bound_jobs[key].export_job_id for key in required}) != len(required):
        raise RuntimeError("JSON and CSV exports must have distinct create response job IDs")
    for key in required:
        completion=completions[key]; bound=bound_jobs[key]
        if not isinstance(completion,dict) or completion.get("completed") is not True or completion.get("format")!=key or completion.get("exportJobId")!=bound.export_job_id or completion.get("status")!="completed" or not finite_timing(completion.get("completionMilliseconds")):
            raise RuntimeError("completion does not consume the corresponding response-bound create job")
    if len(downloads) != len(required): raise RuntimeError("export requires exactly JSON and relational CSV bundle artifacts")
    indexed = {}
    for download in downloads:
        key = download.get("format")
        if key not in required or key in indexed: raise RuntimeError("export has missing, extra, or duplicate artifact format")
        expected_format, content_type = required[key]
        if download.get("contentType") != content_type or download.get("format") != expected_format:
            raise RuntimeError("export format/content type mismatch")
        if download.get("exportJobId") != bound_jobs[key].export_job_id or download.get("exportJobId") != completions[key]["exportJobId"] or download.get("downloaded") is not True or download.get("complete") is not True or download.get("noTruncation") is not True or download.get("status")!="downloaded":
            raise RuntimeError("export artifact does not bind to its response-bound create and completion job")
        if not isinstance(download.get("artifactId"), str) or not isinstance(download.get("sha256"), str) or len(download["sha256"]) != 64:
            raise RuntimeError("export artifact identity or digest missing")
        indexed[key] = download
    if len({item["artifactId"] for item in indexed.values()}) != 2 or len({item["sha256"] for item in indexed.values()}) != 2:
        raise RuntimeError("export JSON and CSV bundle artifacts must be distinct")
    json_bytes = immutable_artifact_bytes(indexed["json"])
    bundle_bytes = immutable_artifact_bytes(indexed[CSV_BUNDLE_FORMAT])
    try:
        verification = verify_export_artifacts(dataset, json_bytes, bundle_bytes)
    except ValueError as error:
        raise RuntimeError("export deep comparison failed: " + str(error)) from error
    if any(item.get("rowCount") != verification["responseCount"] for item in indexed.values()):
        raise RuntimeError("export artifact row count differs from frozen response count")
    target_ids=[row["id"] for row in dataset["responses"]]
    distractor_ids={row["id"] for row in dataset.get("distractorResponses",[])}
    if len(target_ids)!=10000 or not distractor_ids or distractor_ids.intersection(target_ids):
        raise RuntimeError("export target/distractor dataset identity is invalid")
    verification["targetResponseIdsSha256"]=hashlib.sha256(canonical(target_ids)).hexdigest()
    verification["excludedDistractorResponseCount"]=len(distractor_ids)
    return verification

def apply_measurements(workload,result,extras):
    """Apply only complete, observed timings; never turn absent evidence into zero."""
    measurements=result["measurementSamples"]
    buckets={}
    fails=[]
    for sample in measurements:
        elapsed=sample.get("elapsedMilliseconds")
        if not finite_timing(elapsed):
            fails.append("nonfinite-or-missing-timing")
            continue
        buckets.setdefault(sample.get("bucket",bucket(workload,sample)),[]).append(elapsed)
    # These are independent browser-instrumentation series, never copied HTTP samples.
    browser_series=extras.get("browserSeries", {})
    for name, values in browser_series.items():
        values=values if isinstance(values,list) else [values]
        if not values or any(not finite_timing(value) for value in values):
            fails.append(name+"Instrumentation")
        else:
            buckets[name]=values
    sources={name:"browser-instrumentation" for name in browser_series}
    result["latencyBuckets"]={name:{"sampleCount":len(values),"p50Milliseconds":percentile(values,.5),"p95Milliseconds":percentile(values,.95),"p99Milliseconds":percentile(values,.99),"source":sources.get(name,"http-measurement")} for name,values in buckets.items()}
    values=[sample.get("elapsedMilliseconds") for sample in measurements if finite_timing(sample.get("elapsedMilliseconds"))]
    result.update({"samples":measurements,"sampleCount":len(measurements),"p50Milliseconds":percentile(values,.5),"p95Milliseconds":percentile(values,.95),"p99Milliseconds":percentile(values,.99),"errorCount":sum(sample.get("errorClass") is not None or not (isinstance(sample.get("httpStatus"),int) and 200<=sample["httpStatus"]<300) for sample in measurements)})
    result["errorRate"]=(result["errorCount"]/len(measurements)) if measurements else None
    t=THRESHOLDS[workload]
    # Browser instrumentation is authoritative observed timing evidence.  A
    # browser-only workload must not be rejected merely because it has no HTTP
    # transport samples.
    if not measurements and not any(values for values in browser_series.values()): fails.append("zero-samples")
    if any(result.get(key) is None for key in ("memoryBytesPeak","resourceAllocation","cost","rawSamplesArtifactSha256")):
        fails.append("null-required-metric")
    try: valid_run=isinstance(result.get("runId"),str) and str(uuid.UUID(result["runId"].removeprefix("run-"))) == result["runId"].removeprefix("run-")
    except ValueError: valid_run=False
    started,ended=rfc3339_utc(result.get("startedAtUtc")),rfc3339_utc(result.get("endedAtUtc"))
    if not valid_run or not started or not ended or ended < started: fails.append("missing-runId-or-timestamps")
    if not validate_browser_evidence(result,workload): fails.append("browserEvidence")
    # Executed evidence is always envelope-bound; synthetic threshold unit
    # probes deliberately use the all-zero sentinel before constructing an
    # artifact and are not executable observations.
    digest=result.get("rawSamplesArtifactSha256")
    if digest != "0"*64 and digest != hashlib.sha256(canonical(evidence_envelope(result))).hexdigest(): fails.append("rawSamplesArtifactSha256")
    numeric=(result.get("memoryBytesPeak"),result.get("cost"))
    if any(isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value < 0 for value in numeric):
        fails.append("invalid-telemetry-numeric")
    allocation=result.get("resourceAllocation")
    if result.get("resourceCeilings") != RESOURCE_CEILINGS: fails.append("resource-ceilings")
    required_allocation=set(RESOURCE_CATEGORIES)
    if not isinstance(allocation,dict) or not required_allocation <= set(allocation) or any(not isinstance(allocation[k],dict) or {field for field,value in RESOURCE_CEILINGS[k].items() if isinstance(value,(int,float))}-set(allocation[k]) for k in required_allocation):
        fails.append("invalid-resource-allocation")
    else:
        for name in RESOURCE_CATEGORIES:
            ceiling=RESOURCE_CEILINGS[name]
            actual=allocation[name]
            if any(isinstance(actual[key],bool) or not isinstance(actual[key],(int,float)) or not math.isfinite(actual[key]) or actual[key] < RESOURCE_MINIMUMS[name].get(key,0) or actual[key] > ceiling[key] for key,value in ceiling.items() if isinstance(value,(int,float))): fails.append("resource-ceilings")
        if result["cost"] > RESOURCE_CEILINGS["totalMonthlyCostUsd"]: fails.append("resource-ceilings")
    def p95_limit(bucket_name,key):
        current=result["latencyBuckets"].get(bucket_name)
        if not current or current["sampleCount"] < MINIMUM_SAMPLES.get(bucket_name,2) or not finite_timing(current["p95Milliseconds"]) or current["p95Milliseconds"]>t[key]: fails.append(bucket_name+"P95")
    if workload=="respondent-runtime":
        p95_limit("runtime100","runtime100P95Milliseconds"); p95_limit("complexRuntime","complexRuntimeP95Milliseconds")
        if {"runtime100","complexRuntime"} - set(browser_series): fails.append("browser-instrumentation-series")
    elif workload=="save-submit":
        for name,key in (("save","saveP95Milliseconds"),("validation","validationP95Milliseconds"),("submit","submitP95Milliseconds")): p95_limit(name,key)
        # PRD says strictly below 0.1%, therefore exact 0.001 is a failure.
        if result["errorRate"] is None or result["errorRate"] >= t["errorRate"]: fails.append("errorRate")
    elif workload=="accessibility-browser":
        p95_limit("localRenderMilliseconds","localRenderP95Milliseconds"); p95_limit("firstUsableMilliseconds","firstUsableP95Milliseconds")
        if {"localRenderMilliseconds","firstUsableMilliseconds"} - set(browser_series): fails.append("browser-instrumentation-series")
    elif workload=="import-compile":
        p95_limit("valid-compile","p95Milliseconds")
    elif t.get("p95Milliseconds") is not None and (not finite_timing(result["p95Milliseconds"]) or result["p95Milliseconds"]>t["p95Milliseconds"]): fails.append("p95")
    if t.get("maxSampleMilliseconds") is not None and (not values or max(values)>t["maxSampleMilliseconds"]): fails.append("maxSample")
    for key,expected in (("cursorIntegrity",True),("dataLoss",0),("exactAcknowledgedWrites",20),("instrumentation",True),("noCorruption",True),("noTruncation",True),("queuedClientMutationsPreserved",True)):
        if key in t and extras.get(key)!=expected: fails.append(key)
    if workload=="api-export": p95_limit("export","endToEndMilliseconds")
    # Only a slow *compile verdict* requires visible progress/job status.  The
    # progress poll's own latency and a later commit are neither compile p95
    # evidence nor a reason to require progress for a fast verdict.
    if workload=="import-compile" and extras.get("slowCompileWithoutVisibleProgress") is True: fails.append("compileProgressVisibility")
    if "browserLongTasksMilliseconds" in t and (not finite_timing(extras.get("browserLongTasks")) or extras["browserLongTasks"]>t["browserLongTasksMilliseconds"]): fails.append("browserLongTasks")
    if "downloads" in t and extras.get("downloadCount")!=t["downloads"]: fails.append("downloads")
    if workload=="api-export" and extras.get("exportArtifactsValid") is not True: fails.append("exportArtifacts")
    if workload=="durability" and (extras.get("backupRpoHours",float("inf"))>t["backupRpoHours"] or extras.get("restoreRtoHours",float("inf"))>t["restoreRtoHours"] or extras.get("verifiedExactState") is not True): fails.append("rpo-rto-or-state")
    result["thresholdFailures"]=list(dict.fromkeys(fails));result["verdict"]="passed" if not fails else "failed";result["executionStatus"]="executed" if not fails else "failed"
def control_stages(adapter,result,dataset):
    for limit in dataset["_limits"]:
        evidence=adapter.exercise_limit(limit,dataset); 
        expected=limit["expected"]
        if not isinstance(evidence,dict) or evidence.get("verified") is not True or evidence != {"verified":True, **expected}:raise RuntimeError("limit+1 case failed: "+limit["id"])
        record_stage(result,"limit+1:"+limit["id"])
    for control in dataset["_rateControls"]:
        evidence=adapter.exercise_rate_control(control,dataset)
        expected={"verified":True,"httpStatus":429,"queuedClientMutationsPreserved":True,"requiredHeader":"Retry-After"}
        if not isinstance(evidence,dict) or evidence != expected:raise RuntimeError("rate-control failed: "+control["id"])
        record_stage(result,"rate-control:"+control["id"])
def run(workload,phase,base_url,adapter_path,dry_run,protocol=None):
    dataset_id,rate,duration,_=WORKLOADS[workload];dataset=generate(dataset_id)
    if protocol is None: protocol=json.loads((Path(__file__).resolve().parent/"t22-scale-limits.json").read_text())["frozenInputProtocol"]
    frozen_samples=protocol.get("minimumSamplesPerBucket",{})
    if any(frozen_samples.get(name) != count or count < 2 for name,count in MINIMUM_SAMPLES.items()):
        raise RuntimeError("frozen protocol minimum sample counts differ from runner")
    if protocol.get("apiExportJobBinding") != export_job_binding_plan():
        raise RuntimeError("frozen export job binding plan differs from runner")
    raw_schema=protocol.get("rawResultSchema",{})
    if not validate_raw_result_contract(result_base(workload,phase,dataset,rate,duration,materialization_plan(workload,phase,dataset,rate,duration),"dry-run"),raw_schema):
        raise RuntimeError("frozen raw result contract differs from runner")
    dataset["_limits"]=protocol.get("limits",[]);dataset["_rateControls"]=protocol.get("rateControls",[]);plan=materialization_plan(workload,phase,dataset,rate,duration)
    if dry_run:
        r=result_base(workload,phase,dataset,rate,duration,plan,"dry-run");[record_stage(r,x["step"],"planned") for x in plan["provisioningPlan"]];[record_stage(r,"limit+1:"+x["id"],"planned") for x in dataset["_limits"]];[record_stage(r,"rate-control:"+x["id"],"planned") for x in dataset["_rateControls"]];return r,0
    if not base_url:return block(workload,phase,dataset,rate,duration,plan,"missing T22_BASE_URL"),2
    if not adapter_path:return block(workload,phase,dataset,rate,duration,plan,"M2 materialization blocked: explicit runtime adapter required"),2
    if workload in ("complex-form","respondent-runtime","accessibility-browser"):
        try: owned_browser_probe()
        except RuntimeError as error: return block(workload,phase,dataset,rate,duration,plan,str(error)),2
    adapter=load_adapter(adapter_path);missing=[x for x in plan["requiredAdapterMethods"] if not callable(getattr(adapter,x,None))]
    if missing:return block(workload,phase,dataset,rate,duration,plan,"missing runtime adapter hooks: "+",".join(missing)),2
    adapter=BoundedAdapter(adapter)
    result=result_base(workload,phase,dataset,rate,duration,plan,"executed");result["startedAtUtc"]=now()
    browser_discovery=None
    try:
        if adapter.prepare_phase(workload,phase,dataset).get("isolated") is not True:raise RuntimeError("phase isolation missing")
        handles=adapter.provision(workload,dataset,phase);operations=load_operations();auth=os.getenv("T22_AUTHORIZATION");export_handles={}
        # Discovery/session ownership spans every package series in this run.
        # The outer finally closes all created provider sessions exactly once.
        if workload in BROWSER_WORKLOADS:
            browser_discovery=resolve_browser_discovery(browser_matrix(),run_started_at=result["startedAtUtc"])
        for step,semantics in PROVISIONING[workload]:
            executed_step=False
            for semantic in semantics:
                binding=EXPORT_CREATE_OPERATIONS.get(semantic)
                # Export creation is deliberately deferred until controls have run;
                # its timer begins immediately before its product HTTP operation.
                if workload=="api-export" and binding is not None: continue
                sample=run_operation(adapter,operations,base_url,auth,workload,semantic,handles,dataset,len(result["setupSamples"]),response_binding=binding)
                result["setupSamples"].append(sample)
                executed_step=True
                if binding is not None:
                    response=sample.get("exportCreateBinding")
                    if not isinstance(response,dict): raise RuntimeError("create-export response binding missing")
                    format_name=binding["format"]
                    if format_name in export_handles: raise RuntimeError("duplicate format-specific create-export binding")
                    export_handles[format_name]=ExportJobHandle(format_name,response["exportJobId"],sample["responseSha256"])
                    result["exportJobChains"][format_name]={"create":{"semantic":semantic,"operationId":sample["operationId"],"requestPath":sample["requestPath"],"request":response["request"],"httpStatus":sample["httpStatus"],"response":{"exportJobId":response["exportJobId"],"format":response["format"],"status":response["status"]},"responseSha256":sample["responseSha256"]},"binding":{"format":format_name,"exportJobId":response["exportJobId"],"immutableHandle":"export-job:"+format_name}}
            if executed_step: record_stage(result,step)
        control_stages(adapter,result,dataset)
        if workload=="durability":
            for write in dataset["acknowledgements"][:10]:
                x=run_operation(adapter,operations,base_url,auth,workload,"saveAnswer",handles,dataset,write["sequence"]); 
                if adapter.acknowledge_write(workload,write,x,handles) is not True:raise RuntimeError("write acknowledgement missing")
                result["measurementSamples"].append(x)
            adapter.inject_fault(workload,{"kind":"network","afterAcknowledgedWrite":10},handles)
            active=run_operation(adapter,operations,base_url,auth,workload,"saveAnswer",handles,dataset,10,False)
            result["measurementSamples"].append(active); record_stage(result,"network-fault-active-operation")
            adapter.restart(workload,handles);record_stage(result,"network-fault-and-restart-after-10")
            for write in dataset["acknowledgements"][10:]:
                x=run_operation(adapter,operations,base_url,auth,workload,"saveAnswer",handles,dataset,write["sequence"])
                if adapter.acknowledge_write(workload,write,x,handles) is not True:raise RuntimeError("write acknowledgement missing")
                result["measurementSamples"].append(x)
            adapter.inject_fault(workload,{"kind":"service","afterAcknowledgedWrite":20},handles)
            active=run_operation(adapter,operations,base_url,auth,workload,"saveAnswer",handles,dataset,20,False)
            result["measurementSamples"].append(active); record_stage(result,"service-fault-active-operation")
            adapter.restore(workload,handles);record_stage(result,"service-fault-and-restore-after-20")
            result["setupSamples"].append(run_operation(adapter,operations,base_url,auth,workload,"readSession",handles,dataset,20));record_stage(result,"verify-exact-state")
            extras={**adapter.verify_durability(workload,handles,dataset),**adapter.measure_backup_restore(workload,handles,dataset)}
        elif workload=="complex-form":
            identity=dataset["package"]["formKey"]
            series,evidence,discovery=collect_browser_observations(adapter,workload,handles,dataset,identity,("localRenderMilliseconds",),browser_matrix(),browser_discovery)
            extras={"browserSeries":series,"browserEvidence":evidence,"browserChannelDiscovery":discovery["slots"],"browserChannelDiscoveryRaw":discovery["raw"],"browserChannelDiscoveryArtifactSha256":discovery["artifactSha256"],"browserReleaseAuthorities":discovery["releaseAuthorities"],"browserLongTasks":adapter.measure_browser_long_tasks(workload,handles,dataset)}
            for ordinal,value in enumerate(series["localRenderMilliseconds"]): result["measurementSamples"].append({"semantic":"complexRender","bucket":"localRenderMilliseconds","ordinal":ordinal,"elapsedMilliseconds":value,"httpStatus":200,"errorClass":None})
            record_stage(result,"local-complex-render"); record_stage(result,"browser-complex-long-tasks")
        elif workload=="respondent-runtime":
            forms={item["id"]: item for item in dataset["forms"]}
            series={}; browser_evidence=[]; matrix=browser_matrix(); discovery=browser_discovery
            for bucket_name, form_id in (("runtime100", "form-runtime-100"), ("complexRuntime", "form-runtime-complex")):
                package_identity=forms[form_id]["package"]["formKey"]
                observed,evidence,_=collect_browser_observations(adapter,workload,{**handles,"formId":form_id},dataset,package_identity,("firstUsableMilliseconds",),matrix,discovery)
                series[bucket_name]=observed["firstUsableMilliseconds"]; browser_evidence.extend(evidence)
                record_stage(result,"browser-first-usable-"+form_id)
            extras={"browserSeries":series,"browserEvidence":browser_evidence,"browserChannelDiscovery":discovery["slots"],"browserChannelDiscoveryRaw":discovery["raw"],"browserChannelDiscoveryArtifactSha256":discovery["artifactSha256"],"browserReleaseAuthorities":discovery["releaseAuthorities"],"instrumentation":True,"matrixConfigurationCount":len(matrix),"minSamplesPerSeriesPerConfiguration":MIN_SAMPLES_PER_SERIES}
            for ordinal,semantic in enumerate(["start","readSession","saveAnswer"]): result["measurementSamples"].append(run_operation(adapter,operations,base_url,auth,workload,semantic,handles,dataset,ordinal))
        elif workload=="api-export":
            extras={"cursorIntegrity":False,"downloadCount":0,"exportArtifactsValid":False}
            cursor=adapter.cursor_page(workload,handles,dataset)
            if not isinstance(cursor,dict) or not finite_timing(cursor.get("elapsedMilliseconds")): raise RuntimeError("cursor timing missing")
            extras["cursorIntegrity"]=bool(cursor.get("noDuplicate") and cursor.get("noMissing"));result["measurementSamples"].append({"semantic":"cursor","ordinal":0,"elapsedMilliseconds":cursor["elapsedMilliseconds"],"httpStatus":200,"errorClass":None});record_stage(result,"cursor-pagination-integrity")
            expected_formats=("json",CSV_BUNDLE_FORMAT); artifacts=[]; completions={}
            if export_handles: raise RuntimeError("export jobs must not be created before control stages")
            for ordinal,format_name in enumerate(expected_formats):
                export_started=monotonic()
                export_deadline=export_started+THRESHOLDS["api-export"]["endToEndMilliseconds"]/1000
                create_started_at=now()
                semantic="createExportJson" if format_name=="json" else "createExportRelationalCsv"
                binding=EXPORT_CREATE_OPERATIONS[semantic]
                sample=run_operation(adapter,operations,base_url,auth,workload,semantic,handles,dataset,len(result["setupSamples"]),response_binding=binding)
                create_receipt_at=now()
                response=sample.get("exportCreateBinding")
                if not isinstance(response,dict): raise RuntimeError("create-export response binding missing")
                bound=ExportJobHandle(format_name,response["exportJobId"],sample["responseSha256"])
                if format_name in export_handles or bound.export_job_id in {handle.export_job_id for handle in export_handles.values()}:
                    raise RuntimeError("JSON and CSV create-export responses reused one job ID")
                export_handles[format_name]=bound
                result["setupSamples"].append(sample)
                result["exportJobChains"][format_name]={"create":{"semantic":semantic,"operationId":sample["operationId"],"requestPath":sample["requestPath"],"request":response["request"],"requestSelection":response["requestSelection"],"requestSelectionSha256":response["requestSelectionSha256"],"createStartedAt":create_started_at,"createReceiptAt":create_receipt_at,"httpStatus":sample["httpStatus"],"response":{"exportJobId":response["exportJobId"],"format":response["format"],"status":response["status"]},"responseSha256":sample["responseSha256"]},"binding":{"format":format_name,"exportJobId":response["exportJobId"],"immutableHandle":"export-job:"+format_name}}
                record_stage(result,"create-"+format_name+"-export-job")
                remaining=export_deadline-monotonic()
                if remaining <= 0: raise RuntimeError("export end-to-end deadline exhausted before completion")
                completed=adapter.export_complete(workload,bound.export_job_id,format_name,timeout_seconds=remaining)
                if not isinstance(completed,dict) or completed.get("completed") is not True or completed.get("format") != format_name or completed.get("exportJobId") != bound.export_job_id or completed.get("status")!="completed" or not finite_timing(completed.get("completionMilliseconds")): raise RuntimeError("export completion/timing/format does not match its bound create job")
                completions[format_name]=completed
                result["exportJobChains"][format_name]["completion"]={"exportJobId":completed["exportJobId"],"format":completed["format"],"status":completed["status"],"completionMilliseconds":completed["completionMilliseconds"]}
                remaining=export_deadline-monotonic()
                if remaining <= 0: raise RuntimeError("export end-to-end deadline exhausted before download")
                download=adapter.download_export(workload,bound.export_job_id,format_name,dataset,timeout_seconds=remaining)
                if not isinstance(download,dict) or download.get("downloaded") is not True or download.get("format") != format_name or download.get("exportJobId") != bound.export_job_id or download.get("status")!="downloaded" or not finite_timing(download.get("elapsedMilliseconds")): raise RuntimeError("export download/timing/format does not match its bound create job")
                end_to_end=(monotonic()-export_started)*1000
                if end_to_end > THRESHOLDS["api-export"]["endToEndMilliseconds"]: raise RuntimeError("export end-to-end deadline exceeded")
                artifacts.append(download)
                result["measurementSamples"].append({"semantic":"export-"+format_name,"bucket":"export","ordinal":ordinal,"elapsedMilliseconds":end_to_end,"httpStatus":200,"errorClass":None});extras["downloadCount"]+=1
                result["exportJobChains"][format_name]["download"]={key:download[key] for key in ("exportJobId","format","status","artifactId","sha256","contentType","rowCount","elapsedMilliseconds")};result["exportJobChains"][format_name]["measuredTotalMilliseconds"]=end_to_end
                record_stage(result,"export-"+format_name+"-end-to-end")
            verification=verify_export_downloads(dataset,export_handles,completions,artifacts)
            extras["exportArtifactsValid"]=True; extras["exportVerification"]=verification; result["exportVerification"]=verification; result["exportJobs"]={format_name:export_handles[format_name].export_job_id for format_name in expected_formats}
            record_stage(result,"export-downloads")
        elif workload=="import-compile":
            extras={"slowCompileWithoutVisibleProgress":False}
            # The protocol freezes two independent observations for valid and
            # invalid compilation; a single lucky compile cannot establish p95.
            for candidate in dataset["packages"]:
              for attempt in range(MINIMUM_SAMPLES["compileValid"]):
                started=monotonic(); next_poll=started; job=adapter.start_compile(workload,candidate,handles)
                if not isinstance(job,dict) or not job.get("jobHandle"): raise RuntimeError("start_compile must return jobHandle")
                deadline=started+COMPILE_DEADLINE_SECONDS; progress_samples=[]; final=None; last_progress=-1; polls=0
                while polls < COMPILE_MAX_POLLS and monotonic() <= deadline:
                    wait=next_poll-monotonic()
                    if wait > 0: time.sleep(wait)
                    next_poll += COMPILE_POLL_CADENCE_SECONDS
                    polls += 1
                    progress=adapter.read_compile_progress(workload,job["jobHandle"],handles)
                    if not isinstance(progress,dict) or not finite_timing(progress.get("elapsedMilliseconds")): raise RuntimeError("compile progress timing missing")
                    if progress.get("complete") is True:
                        final=adapter.compile_verdict(workload,job["jobHandle"],handles); break
                    if progress.get("visibleJobStatus") is not True: raise RuntimeError("in-flight progress must expose visible status")
                    value=progress.get("progress")
                    if not isinstance(value,(int,float)) or isinstance(value,bool) or not 0 <= value <= 100 or value < last_progress: raise RuntimeError("compile in-flight progress must be monotonic 0..100")
                    last_progress=value
                    progress_samples.append(progress)
                    result["measurementSamples"].append({"semantic":"progress-poll-"+candidate["kind"],"bucket":"progress-poll","ordinal":len(result["measurementSamples"]),"elapsedMilliseconds":progress["elapsedMilliseconds"],"httpStatus":200,"errorClass":None})
                    record_stage(result,"compile-in-flight-"+candidate["kind"],detail="job="+str(job["jobHandle"])+" progress="+str(value))
                if final is None: raise RuntimeError("compile poll deadline/max-polls exceeded")
                elapsed=(monotonic()-started)*1000
                if not isinstance(final,dict) or not finite_timing(final.get("elapsedMilliseconds")): raise RuntimeError("final compile verdict missing")
                # The deadline measurement is local monotonic wall duration; an adapter's
                # reported verdict latency is recorded but cannot weaken that observation.
                actual=elapsed
                if actual>THRESHOLDS[workload]["compileProgressMilliseconds"] and not progress_samples: extras["slowCompileWithoutVisibleProgress"]=True
                if candidate["kind"]=="valid":
                    if final.get("accepted") is not True: raise RuntimeError("valid compile rejected")
                    result["measurementSamples"].append({"semantic":"valid-compile","bucket":"valid-compile","ordinal":len(result["measurementSamples"]),"elapsedMilliseconds":actual,"httpStatus":200,"errorClass":None})
                    committed=adapter.commit_candidate(workload,candidate,handles)
                    if not isinstance(committed,dict) or committed.get("committed") is not True or not finite_timing(committed.get("elapsedMilliseconds")): raise RuntimeError("valid commit/timing missing")
                    result["measurementSamples"].append({"semantic":"valid-commit","bucket":"valid-commit","ordinal":len(result["measurementSamples"]),"elapsedMilliseconds":committed["elapsedMilliseconds"],"httpStatus":201,"errorClass":None})
                elif final.get("accepted") is not False: raise RuntimeError("invalid compile was accepted")
                else: result["measurementSamples"].append({"semantic":"invalid-bounded-rejection","bucket":"invalid-bounded-rejection","ordinal":len(result["measurementSamples"]),"elapsedMilliseconds":actual,"httpStatus":422,"errorClass":None})
        elif workload=="accessibility-browser":
            identity=dataset["package"]["formKey"]
            series,evidence,discovery=collect_browser_observations(adapter,workload,handles,dataset,identity,("localRenderMilliseconds","firstUsableMilliseconds"),browser_matrix(),browser_discovery)
            for name,values in series.items():
                for value in values: result["measurementSamples"].append({"semantic":name,"bucket":name,"ordinal":len(result["measurementSamples"]),"elapsedMilliseconds":value,"httpStatus":200,"errorClass":None})
            extras={"instrumentation":True,"browserSeries":series,"browserEvidence":evidence,"browserChannelDiscovery":discovery["slots"],"browserChannelDiscoveryRaw":discovery["raw"],"browserChannelDiscoveryArtifactSha256":discovery["artifactSha256"],"browserReleaseAuthorities":discovery["releaseAuthorities"],"matrixConfigurationCount":len(browser_matrix()),"minSamplesPerSeriesPerConfiguration":MIN_SAMPLES_PER_SERIES}
            record_stage(result,"browser-instrumentation")
        else:
            semantics=WORKLOADS[workload][3]
            if workload=="save-submit":
                # Draft mutation traffic is independently paced at 20/s; validate and submit are distinct measurements.
                load=save_submit_load(rate,duration,frozen_samples)
            else:
                # Every measured semantic receives protocol-minimum independent
                # observations; keep the prescribed paced load as an additive
                # floor rather than allowing one-request workloads to evade p95.
                load=[semantic for semantic in semantics for _ in range(MINIMUM_SAMPLES.get({"catalog":"catalog","saveAnswer":"save","validateSession":"validation","submit":"submit"}.get(semantic,semantic),2))]
                while len(load) < rate*duration: load.append(semantics[len(load)%len(semantics)])
            start=monotonic()
            session_handles=None
            if workload=="save-submit":
                session_ids=[item.get("id") for item in dataset.get("sessions",[])]
                if len(session_ids)!=200 or any(not isinstance(item,str) or not item for item in session_ids) or len(set(session_ids))!=200: raise RuntimeError("save-submit requires exactly 200 unique active session identities")
                # Immutable per-session bindings prevent concurrent response
                # extraction from leaking a session handle into another save.
                session_handles={session_id:{**copy.deepcopy(handles),"sessionId":session_id,"s":session_id} for session_id in session_ids}
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(32,max(1,rate))) as pool:
                futures=[]
                for ordinal,semantic in enumerate(load):
                    if semantic=="saveAnswer":
                        delay=start+(sum(x=="saveAnswer" for x in load[:ordinal])/rate)-monotonic()
                        if delay>0:time.sleep(delay)
                    selected=handles
                    if session_handles:
                        # First 200 are the prescribed baseline saves: each
                        # dataset session occurs once. Validation/submission
                        # samples deliberately select active explicit handles.
                        selected=session_handles[session_ids[ordinal if semantic=="saveAnswer" else ordinal%200]]
                    futures.append((semantic,pool.submit(run_operation,adapter,operations,base_url,auth,workload,semantic,selected,dataset,ordinal,False)))
                for semantic,future in futures:
                    sample=future.result()
                    result["measurementSamples"].append(sample)
            if session_handles:
                save_ids=[sample.get("sessionId") for sample in result["measurementSamples"] if sample.get("semantic")=="saveAnswer"]
                if len(save_ids)!=200 or len(set(save_ids))!=200 or set(save_ids)!=set(session_ids): raise RuntimeError("save baseline must cover each active session exactly once")
                if any(sample.get("semantic") in ("validateSession","submit") and sample.get("sessionId") not in session_handles for sample in result["measurementSamples"]): raise RuntimeError("validation/submission lacks an active explicit session")
            record_stage(result,"paced-measurements");extras={}
        telemetry=adapter.capture_telemetry(workload,phase)
        if not {"memoryBytesPeak","resourceAllocation","cost"}<=set(telemetry):raise RuntimeError("incomplete telemetry")
        result.update({"memoryBytesPeak":telemetry["memoryBytesPeak"],"resourceAllocation":telemetry["resourceAllocation"],"cost":telemetry["cost"]});result["browserEvidence"]=extras.get("browserEvidence",[]);result["browserChannelDiscovery"]=extras.get("browserChannelDiscovery",[]);result["browserChannelDiscoveryRaw"]=extras.get("browserChannelDiscoveryRaw",[]);result["browserChannelDiscoveryArtifactSha256"]=extras.get("browserChannelDiscoveryArtifactSha256");result["browserReleaseAuthorities"]=extras.get("browserReleaseAuthorities");result["endedAtUtc"]=now();result["rawSamplesArtifactSha256"]=hashlib.sha256(canonical(evidence_envelope(result))).hexdigest()
        if result["memoryBytesPeak"] is None or result["resourceAllocation"] is None or result["cost"] is None: raise RuntimeError("required telemetry is null")
        if any(isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value < 0 for value in (result["memoryBytesPeak"],result["cost"])): raise RuntimeError("invalid numeric telemetry")
        required_allocation=set(RESOURCE_CATEGORIES)
        allocation=result["resourceAllocation"]
        if not isinstance(allocation,dict) or not required_allocation <= set(allocation): raise RuntimeError("resource allocation incomplete")
        for name in required_allocation:
            actual=allocation[name]
            if not isinstance(actual,dict) or any(key not in actual or isinstance(actual[key],bool) or not isinstance(actual[key],(int,float)) or not math.isfinite(actual[key]) or actual[key] < RESOURCE_MINIMUMS[name].get(key,0) or actual[key] > RESOURCE_CEILINGS[name][key] for key,value in RESOURCE_CEILINGS[name].items() if isinstance(value,(int,float))): raise RuntimeError("resource allocation exceeds benchmark ceiling or misses positive minimum")
        if result["cost"] > RESOURCE_CEILINGS["totalMonthlyCostUsd"]: raise RuntimeError("total benchmark cost exceeds ceiling")
        apply_measurements(workload,result,extras)
        if not validate_raw_result_contract(result,raw_schema): raise RuntimeError("raw result violates frozen conditional browser-discovery contract")
    except Exception as error:result.update({"executionStatus":"failed","verdict":"failed","failure":type(error).__name__+": "+str(error)});result["thresholdFailures"].append("execution")
    finally:
        if browser_discovery is not None:
            try:
                close_browser_sessions(browser_discovery)
            except Exception as error:
                result.update({"executionStatus":"failed","verdict":"failed","failure":"browser session cleanup: "+str(error)})
                result["thresholdFailures"].append("browser-session-cleanup")
        adapter.close()
    if result["endedAtUtc"] is None: result["endedAtUtc"]=now()
    return result,0 if result["verdict"]=="passed" else 1
def main():
    p=argparse.ArgumentParser();p.add_argument("--workload",choices=WORKLOADS,required=True);p.add_argument("--phase",choices=("cold","warm"),required=True);p.add_argument("--base-url",default=os.getenv("T22_BASE_URL"));p.add_argument("--adapter",default=os.getenv("T22_RUNTIME_ADAPTER"));p.add_argument("--output",required=True);p.add_argument("--dry-run",action="store_true");a=p.parse_args()
    result,code=run(a.workload,a.phase,a.base_url,a.adapter,a.dry_run);out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(canonical(result)+b"\n");print(f"T22 {result['executionStatus']} workload={a.workload} phase={a.phase} verdict={result['verdict']}");return code
if __name__=="__main__":raise SystemExit(main())
