#!/usr/bin/env python3
"""Validate the hand-authored T08–T15 fixture oracle without product access."""
import json, sys
from pathlib import Path

from check_fixture_routes import check_document
ROOT=Path(__file__).resolve().parents[1]
fixture=json.loads((ROOT/'fixtures/t08-t15.json').read_text())
asset=json.loads((ROOT/'assets/t08-validation-errors.json').read_text())['frozenInputProtocol']
errors=check_document(fixture)
records={r['fixture']:r for r in fixture['records']}
expected={f'T{i:02d}' for i in range(8,16)}
if set(records)!=expected: errors.append(f'fixture IDs are {sorted(records)}, expected {sorted(expected)}')
if fixture['executionStatus']!='not-run': errors.append('fixture execution status must be not-run')
for fid,r in records.items():
  if not r.get('preState') or not r.get('requirements') or not r.get('evidence'): errors.append(f'{fid}: missing prestate, requirements, or evidence')
  for a in r.get('actions',[]):
    if not a.get('inputRef') or not a.get('actor') or not a.get('resource') or not a.get('input') or not a.get('expected') or not a.get('evidence'): errors.append(f'{a.get("id")}: incomplete executable fields')
    raw=json.dumps(a,sort_keys=True)
    if 'evaluator://fixture-runner' in raw or '"completed"' in raw.lower(): errors.append(f'{a["id"]}: generic runner/completed state is forbidden')
    if 'deny-or' in raw.lower() or 'one of' in raw.lower(): errors.append(f'{a["id"]}: broad outcome is forbidden')
# Byte-for-byte semantic equality for every value T08 imports from the priority asset.
t08record=records['T08']
t08={a['id'].removeprefix('T08-'):a for a in t08record['actions']}
if t08record.get('assetExpected') != {k:asset[k] for k in ('caseExpectations','responseContract')}: errors.append('T08: asset-wide expected contract differs from t08-validation-errors.json')
if t08record.get('assetPreState') != {k:asset['packageSessionFieldHandles'][k] for k in ('packageHandle','releaseHandle','sessionHandle','tenantHandle','workspaceHandle','sessionRevisionBeforeUnrelatedMutation','priorAcceptedUnrelatedMutation','unrelatedValidField')}: errors.append('T08: asset prestate differs from t08-validation-errors.json')
for c in asset['patchCases']:
  got=t08.get(c['caseId'])
  if not got: errors.append(f'T08 missing asset case {c["caseId"]}'); continue
  exp=c['expected']
  if got['input'] != c['request']: errors.append(f'T08 {c["caseId"]}: request differs from asset')
  if got.get('request',{}).get('bodyUtf8Hex') != c['requestUtf8Hex'] or got.get('request',{}).get('sha256') != c['requestSha256']: errors.append(f'T08 {c["caseId"]}: encoded request differs from asset')
  wanted={k:exp[k] for k in ('httpStatus','problemCode','diagnostic','atomicity','focusEvidence')}
  actual={k:got['expected'].get(k) for k in wanted}
  if actual != wanted: errors.append(f'T08 {c["caseId"]}: expected outcome differs from asset')
  if got['expected'].get('contentType')!='application/problem+json': errors.append(f'T08 {c["caseId"]}: incorrect problem content type')
if len(t08)!=len(asset['patchCases']): errors.append('T08 has extra or missing PATCH cases')
if errors:
  print('FAIL')
  print('\n'.join(errors)); sys.exit(1)
print(f'PASS T08-T15: {len(records)} fixtures, {sum(len(r["actions"]) for r in records.values())} actions; T08 {len(t08)} asset-exact PATCH cases')
