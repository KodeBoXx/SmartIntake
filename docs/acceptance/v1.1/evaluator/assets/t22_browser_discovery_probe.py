#!/usr/bin/env python3
"""Pinned T22 browser-session acquisition probe.

The evaluator selects the matrix slot. This probe creates one persistent W3C
WebDriver/Appium session, records a minimal cleanup lease before emitting its
result, then returns the parsed provider response and bound session/device
identity. The runner owns deletion after browser instrumentation completes;
the lease lets it close a session if output parsing or validation fails.
"""
from __future__ import annotations
import argparse, base64, hashlib, json, os, re, shutil, subprocess, sys, urllib.error, urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ASSETS=Path(__file__).resolve().parent; sys.path.insert(0,str(ASSETS))
from t22_dataset_generator import generate
PROTOCOL=json.loads((ASSETS/'t22-scale-limits.json').read_text())['frozenInputProtocol']['browserDiscoveryProbe']
SELF_CHECK_FIXTURES=None

def fail(message): raise RuntimeError(message)
def strict(raw,label):
 def pairs(items):
  result={}
  for key,value in items:
   if key in result: raise ValueError('duplicate '+key)
   result[key]=value
  return result
 try: return json.loads(raw.decode('utf-8'),object_pairs_hook=pairs,parse_constant=lambda value:(_ for _ in ()).throw(ValueError(value)))
 except Exception as error: raise RuntimeError(label+' is not strict JSON') from error
def config_for(config_id):
 matrix={item['id']:item for item in generate('browser-at-matrix')['browserMatrix']}
 if config_id not in matrix: fail('unknown frozen matrix config ID')
 return matrix[config_id]
def rule_for(config):
 rules=[rule for rule in PROTOCOL['sourceRules'] if rule['configId']==config['id']]
 if len(rules)!=1: fail('missing frozen browser source rule')
 return rules[0]
def endpoint():
 value=os.environ.get('T22_WEBDRIVER_ENDPOINT',''); parsed=urlsplit(value)
 test=os.environ.get('T22_BROWSER_PROBE_TEST_MODE')=='1'
 if not parsed.scheme or not parsed.netloc or parsed.username or parsed.password or (parsed.scheme!='https' and not(test and parsed.scheme=='http' and parsed.hostname in {'127.0.0.1','localhost'})):
  fail('T22_WEBDRIVER_ENDPOINT must be HTTPS (loopback HTTP only in explicit test mode)')
 return value.rstrip('/'),parsed.scheme+'://'+parsed.netloc
def fixture(kind,config):
 if SELF_CHECK_FIXTURES is None:return None
 value=SELF_CHECK_FIXTURES.get(kind,{}).get(config['id'])
 if value is None and kind=='webdriver': return None
 if value is None:fail('self-check fixture lacks frozen slot')
 return value
def allowed(variable,expected):
 value=os.environ.get(variable,expected); path=shutil.which(value) if '/' not in value else value
 if not path or Path(path).resolve().name.lower() not in {expected,expected+'.exe'}: fail(variable+' must name allowlisted '+expected)
 return str(Path(path).resolve())
def raw_http(request):
 try:
  with urllib.request.urlopen(request,timeout=8) as response:
   body=response.read(); status=response.status; headers=response.getheaders()
 except urllib.error.HTTPError as error:
  body=error.read(); status=error.code; headers=error.headers.items()
 # urllib exposes a parsed status and decoded ISO-8859-1 header fields, not
 # original status-line/header bytes. Retain a canonical re-encoding of those
 # parsed fields and the original response body before parsing provider JSON.
 header_bytes=b''.join(name.encode('iso-8859-1')+b': '+value.encode('iso-8859-1')+b'\r\n' for name,value in headers)
 return {'status':status,'headersBase64':base64.b64encode(header_bytes).decode(),'headersSha256':hashlib.sha256(header_bytes).hexdigest(),'bodyBase64':base64.b64encode(body).decode(),'bodySha256':hashlib.sha256(body).hexdigest()}
def decoded_http(record,label):
 if not isinstance(record,dict) or set(record)!={'status','headersBase64','headersSha256','bodyBase64','bodySha256'}: fail(label+' canonical HTTP evidence is malformed')
 try: body=base64.b64decode(record['bodyBase64'],validate=True); headers=base64.b64decode(record['headersBase64'],validate=True)
 except Exception as error: raise RuntimeError(label+' canonical HTTP evidence is not base64') from error
 if hashlib.sha256(body).hexdigest()!=record['bodySha256'] or hashlib.sha256(headers).hexdigest()!=record['headersSha256']: fail(label+' canonical HTTP evidence digest differs')
 if not isinstance(record['status'],int): fail(label+' HTTP status is invalid')
 return strict(body,label)
def native(config,device_id,browser):
 seam=fixture('native',config)
 if seam is not None:
  # The fixture seam models a provider execute response, not evaluator-host
  # native output.  Keep its compatibility shim confined to explicit test mode.
  if os.environ.get('T22_BROWSER_PROBE_TEST_MODE')!='1': fail('native fixture seam is test-only')
  at=seam.get('native',{}).get('accessibility',{})
  payload=json.dumps({'value':{'accessibility':at,'deviceId':device_id,'platformVersion':seam.get('native',{}).get('platform',{}).get('version','test')}},separators=(',',':')).encode()
  headers=b'content-type: application/json\r\n'
  record={'status':200,'headersBase64':base64.b64encode(headers).decode(),'headersSha256':hashlib.sha256(headers).hexdigest(),'bodyBase64':base64.b64encode(payload).decode(),'bodySha256':hashlib.sha256(payload).hexdigest()}
  return {'native':{'accessibility':at,'platform':seam['native']['platform'],'device':device_id},'providerResponses':[{'command':['provider-session-execute','t22:accessibility'],'http':record,'response':strict(payload,'selfcheck AT provider response')}]}
 # AT is queried through the already-created provider session.  This avoids
 # substituting evaluator-host adb/xcrun/NVDA/VoiceOver output for remote or
 # mobile evidence.  Providers that do not expose this session-scoped
 # capability are intentionally blocked rather than guessed from the OS.
 endpoint=browser['endpointUrl'].rstrip('/')+'/session/'+browser['providerResponse']['value']['sessionId']+'/execute/sync'
 request=urllib.request.Request(endpoint,data=json.dumps({'script':'return {"t22:capability":"accessibility"};','args':[]},separators=(',',':')).encode(),method='POST',headers={'Content-Type':'application/json'})
 raw=raw_http(request); response=decoded_http(raw,'provider AT capability')
 if raw['status']<200 or raw['status']>=300 or not isinstance(response,dict) or not isinstance(response.get('value'),dict): fail('provider session-scoped AT capability endpoint is unavailable')
 value=response['value']; at=value.get('accessibility')
 if not isinstance(at,dict) or set(at)!={'name','version'} or not all(isinstance(at[k],str) and at[k] for k in at) or value.get('deviceId')!=device_id: fail('provider AT capability is not bound to the persistent device or lacks actual version')
 return {'native':{'accessibility':at,'platform':{'name':config['os'],'version':value.get('platformVersion','provider-unreported')},'device':device_id},'providerResponses':[{'command':['provider-session-execute','t22:accessibility'],'http':raw,'response':response}]}
def acquire(config,rule):
 seam=fixture('webdriver',config)
 if seam is not None:return seam
 base,authority=endpoint(); names={'Chrome':'chrome','Edge':'MicrosoftEdge','Firefox':'firefox','Safari':'safari'}
 caps={'browserName':names[config['browser']],'platformName':config['os'],'t22:requestedChannel':config['requestedChannel']}
 if config['device']=='mobile': caps.update({'appium:automationName':'XCUITest' if config['os']=='iOS' else 'UiAutomator2','appium:deviceName':'mobile'})
 req=urllib.request.Request(base+'/session',data=json.dumps({'capabilities':{'alwaysMatch':caps}},separators=(',',':')).encode(),method='POST',headers={'Content-Type':'application/json'})
 raw=raw_http(req); provider=decoded_http(raw,'WebDriver create session')
 if raw['status']<200 or raw['status']>=300: fail('WebDriver create session returned non-success status')
 value=provider.get('value') if isinstance(provider,dict) else None
 if not isinstance(value,dict) or not isinstance(value.get('sessionId'),str) or not isinstance(value.get('capabilities'),dict):fail('provider omitted persistent session/capabilities')
 return {'endpointUrl':base,'endpointAuthority':authority,'providerHttp':raw,'providerResponse':provider}
def close(browser):
 session=browser['providerResponse']['value']['sessionId']
 request=urllib.request.Request(browser['endpointUrl'].rstrip()+'/session/'+session,method='DELETE')
 try: raw_http(request)
 except Exception: pass
def write_lease(path,config,browser,device_id):
 binding={'sessionId':browser['providerResponse']['value']['sessionId'],'deviceId':device_id,'endpointUrl':browser['endpointUrl'],'endpointAuthority':browser['endpointAuthority']}
 document={'configId':config['id'],'sessionBinding':binding}
 target=Path(path); target.parent.mkdir(parents=True,exist_ok=True); temporary=target.with_suffix(target.suffix+'.tmp')
 temporary.write_bytes(json.dumps(document,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()); temporary.replace(target)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--config-id',required=True);parser.add_argument('--lease-output',required=True);parser.add_argument('--selfcheck-fixtures',help=argparse.SUPPRESS);args=parser.parse_args()
 global SELF_CHECK_FIXTURES
 if args.selfcheck_fixtures:
  SELF_CHECK_FIXTURES=strict(Path(args.selfcheck_fixtures).read_bytes(),'self-check fixtures')
  if not isinstance(SELF_CHECK_FIXTURES,dict) or set(SELF_CHECK_FIXTURES)!={'webdriver','native'}:fail('malformed self-check fixtures')
 config=config_for(args.config_id);rule=rule_for(config);browser=None; handed_off=False
 try:
  browser=acquire(config,rule)
  caps=browser['providerResponse']['value']['capabilities'];device_id=caps.get('appium:udid') if config['device']=='mobile' else caps.get('se:containerName')
  if not isinstance(device_id,str) or not device_id:fail('provider omitted frozen device/UDID capability')
  result={'browserSource':browser}
  if rule['accessibilitySourceKind']=='native-version-command':result['accessibilitySource']=native(config,device_id,browser)
  write_lease(args.lease_output,config,browser,device_id)
  sys.stdout.buffer.write(json.dumps(result,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()); handed_off=True
 finally:
  # Before the lease is written, the probe owns the session. Once the lease is
  # written, the runner can close it even when stdout cannot be parsed.
  if browser is not None and not handed_off: close(browser)
if __name__=='__main__':
 try:main()
 except Exception as error:print('t22 browser discovery probe: '+str(error),file=sys.stderr);raise SystemExit(2)
