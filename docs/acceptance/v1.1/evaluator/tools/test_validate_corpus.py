import importlib.util, json, shutil, tempfile, unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('validator',HERE/'validate_corpus.py'); validator=importlib.util.module_from_spec(spec); spec.loader.exec_module(validator)
class ValidatorNegativeMatrix(unittest.TestCase):
 def copy(self):
  d=tempfile.TemporaryDirectory(); r=Path(d.name)/'evaluator'; shutil.copytree(HERE.parent,r); return d,r
 def test_clean_waived_passes_and_validator_is_read_only(self):
  d,r=self.copy(); self.addCleanup(d.cleanup); before={p.relative_to(r):p.read_bytes() for p in r.rglob('*') if p.is_file()}; self.assertEqual([],validator.validate(r,False)); self.assertEqual(before,{p.relative_to(r):p.read_bytes() for p in r.rglob('*') if p.is_file()})
 def test_negative_matrix_c01_c20(self):
  # Each named check has a temp corpus fixture; direct structural mutations cover C01/C02/C03/C04/C05/C06/C07/C08/C09/C10/C11/C12/C13/C14/C15/C16/C17/C18/C19/C20.
  for check in [f'C{i:02}' for i in range(1,21)]:
   with self.subTest(check=check):
    d,r=self.copy(); self.addCleanup(d.cleanup)
    if check=='C01': (r/'README.md').write_text('bad\r\n')
    elif check=='C02':
     p=r/'navigation/navigation-oracle.json'; x=json.loads(p.read_text()); del x['records'][0]['status']; p.write_text(json.dumps(x))
    elif check=='C03':
     p=r/'navigation/navigation-oracle.json'; x=json.loads(p.read_text()); x['records'][1]['id']=x['records'][0]['id']; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C04':
     p=r/'navigation/navigation-oracle.json'; x=json.loads(p.read_text()); x['records'][0]['prdCitations'][0]['quote']='not in PRD'; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C05':
     p=r/'navigation/navigation-oracle.json'; x=json.loads(p.read_text()); x['records'][0]['status']='pass'; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C06':
     p=r/'navigation/navigation-oracle.json'; x=json.loads(p.read_text()); x['records'][0]['expected']['bad']='TODO'; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C07':
     p=r/'navigation/navigation-oracle.json'; x=json.loads(p.read_text()); x['records'][0]['fixtures']=[];x['records'][0]['milestoneGates']=[]; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check in {'C08','C09'}:
     p=r/'navigation/navigation-oracle.json'; x=json.loads(p.read_text()); x['frozenStrings']=[] if check=='C08' else x['frozenStrings']; x['records']=x['records'][:-1] if check=='C09' else x['records']; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C10':
     p=r/'review/status-label-map.json'; x=json.loads(p.read_text()); x['statusVocabulary']=[]; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C11':
     p=r/'packages/package-hc.json'; x=json.loads(p.read_text()); x['catalogCoverage']=[]; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C12':
     p=r/'oracles/respondent-oracle.json'; x=json.loads(p.read_text()); [z['expected'].update(quantity='9') for z in validator.record_walk(x) if z['id']=='EVAL-RESP-O14']; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C13':
     p=r/'oracles/respondent-oracle.json'; x=json.loads(p.read_text()); [z['expected'].update(sha256='0') for z in validator.record_walk(x) if z['id']=='EVAL-RESP-O20']; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C14':
     p=r/'locales/key-inventory.json'; x=json.loads(p.read_text()); x['localePacks']['hi']['messageValues']='x'; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C15':
     p=r/'locales/plural-map.json'; x=json.loads(p.read_text()); x['grammar']='x'; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C16':
     p=r/'sentinels/commitments.json'; x=json.loads(p.read_text()); x['rounds'][0]['slotCount']=2; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C17': self.assertIn('C17',[x[0] for x in validator.validate(r,True)]); continue
    elif check=='C18':
     p=r/'manifest.json'; x=json.loads(p.read_text()); x['corpusDigest']='0'; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C19':
     p=r/'manifest.json'; x=json.loads(p.read_text()); x['status']['productTestsExecuted']=True; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    elif check=='C20':
     p=r/'oracles/focus-oracle.json'; x=json.loads(p.read_text()); del x['records'][0]['blockedReason']; p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
    self.assertIn(check,[x[0] for x in validator.validate(r,False)])
if __name__=='__main__': unittest.main()
