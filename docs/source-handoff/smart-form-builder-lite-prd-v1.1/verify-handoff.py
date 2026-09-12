from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parent.parent
manifest=json.loads((Path(__file__).parent/'manifest.json').read_text())
for row in manifest['files']:
 p=root/row['path']
 assert p.is_file(),row['path']
 assert hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256'],row['path']
print('All manifested handoff files match their SHA-256 digests.')
