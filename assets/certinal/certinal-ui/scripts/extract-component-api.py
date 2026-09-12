import os, re, sys, pathlib

# Default: this skill's vendored standalone fork. Pass a path to point at the copy
# vendored inside a repo you are working in, e.g.
#   extract-component-api.py ~/Workspace/certinal-workspace/econsent-ui/packages/ui/src/lib
_DEFAULT = pathlib.Path(__file__).resolve().parent.parent / 'library/ui/src/lib'
ROOT = str(pathlib.Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else _DEFAULT)
if not os.path.isdir(ROOT):
    sys.exit(f'not a directory: {ROOT}')
TIERS = ['primitives','blocks','sections','layouts']

def scan_angle(s, i):
    """s[i]=='<'. Balance <> while ignoring '>' that is part of '=>'. """
    d = 0; start = i
    while i < len(s):
        c = s[i]
        if c == '<': d += 1
        elif c == '>':
            if s[i-1] == '=':      # arrow function, not a closing angle
                i += 1; continue
            d -= 1
            if d == 0: return s[start+1:i], i+1
        i += 1
    return None, i

def scan_paren(s, i):
    d = 0; start = i
    while i < len(s):
        if s[i] == '(': d += 1
        elif s[i] == ')':
            d -= 1
            if d == 0: return s[start+1:i], i+1
        i += 1
    return None, i

def parse(src):
    inputs, outputs = [], []
    for m in re.finditer(r'readonly\s+(\w+)\s*=\s*(input\.required|input|model|output)\s*', src):
        name, kind = m.group(1), m.group(2)
        j = m.end(); gen = ''
        if j < len(src) and src[j] == '<':
            gen, j = scan_angle(src, j)
        if j >= len(src) or src[j] != '(':
            continue
        args, _ = scan_paren(src, j)
        gen  = re.sub(r'\s+', ' ', (gen  or '')).strip()
        args = re.sub(r'\s+', ' ', (args or '')).strip()
        if kind == 'output':
            outputs.append(f"{name}<{gen}>" if gen and gen != 'void' else name)
            continue
        t = gen
        if not t:
            if 'booleanAttribute' in args or re.match(r'^(true|false)\b', args): t = 'boolean'
            elif args.startswith("'"): t = 'string'
            elif re.match(r'^\d', args): t = 'number'
            elif args.startswith('['): t = 'array'
            else: t = 'unknown'
        d = 0; cut = len(args)
        for k, ch in enumerate(args):
            if ch in '<([{': d += 1
            elif ch in '>)]}': d -= 1
            elif ch == ',' and d == 0: cut = k; break
        default = args[:cut].strip()
        if default.startswith('{'): default = ''
        inputs.append((name, kind, t, default))
    return inputs, outputs

out = {t: [] for t in TIERS}
for tier in TIERS:
    for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, tier)):
        dirnames[:] = [d for d in dirnames if not d.startswith('.') and d != '__MACOSX']
        for fn in sorted(filenames):
            if not re.search(r'\.(component|directives?|service)\.ts$', fn): continue
            src = open(os.path.join(dirpath, fn), encoding='utf8').read()
            starts = [m.start() for m in re.finditer(r'export class \w+', src)]
            if not starts: continue
            # File-level declarations belong to the file, not to one class.
            types = [(t.group(1), re.sub(r'\s+',' ',t.group(2)).strip())
                     for t in re.finditer(r'export type (\w+)\s*=\s*([^;]+);', src)
                     if len(t.group(2)) < 4000]
            ifaces = re.findall(r'export interface (\w+)', src)
            # A file may declare several classes (e.g. header.directives.ts). Slice per class
            # and take each one's own decorator selector, which sits just above it.
            for k, st in enumerate(starts):
                end = starts[k + 1] if k + 1 < len(starts) else len(src)
                # decorator block: from the previous class end (or file start) to this class
                head_from = starts[k - 1] if k else 0
                head, body = src[head_from:st], src[st:end]
                cls = re.match(r'export class (\w+)', body).group(1)
                sm = re.findall(r"selector:\s*'([^']+)'", head)
                sel = sm[-1] if sm else f"(service) {cls}"
                inputs, outputs = parse(body)
                methods = []
                if fn.endswith('.service.ts'):
                    for mm in re.finditer(r'^  (?!private|readonly|#|constructor|\})(\w+)\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{', body, re.M):
                        sig = f"{mm.group(1)}({re.sub(r'[ ]+',' ',mm.group(2)).strip()})"
                        if mm.group(3): sig += f": {re.sub(r'[ ]+',' ',mm.group(3)).strip()}"
                        methods.append(sig)
                out[tier].append(dict(cls=cls, sel=sel,
                                      types=types if k == 0 else [],
                                      ifaces=ifaces if k == 0 else [],
                                      inputs=inputs, outputs=outputs, methods=methods))

icons = []
_icn = os.path.join(ROOT, 'primitives/icon/icon.component.ts')
if os.path.exists(_icn):
    _u = open(_icn, encoding='utf8').read().split('export type CuiIconName =')[1].split(';')[0]
    icons = re.findall(r"'([a-z0-9-]+)'", _u)

print("# @certinal/ui — component API")
print()
print("Generated from library/ui/src/lib by scripts/extract-component-api.py. Do not hand-edit.")
print()
print("Legend: `name!` required input · `name\u2194` two-way `model()` · otherwise an optional")
print("`input()` with its default. All components are standalone; import the class from")
print("`@certinal/ui` and list it in the consumer's `imports: [...]`.")
print()
if icons:
    print(f"## `CuiIconName` \u2014 {len(icons)} registered names (closed union)")
    print()
    print("An unregistered name renders an empty box plus a console error.")
    print()
    print('```')
    for i in range(0, len(icons), 6):
        print(' '.join(icons[i:i+6]))
    print('```')

for tier in TIERS:
    items = sorted(out[tier], key=lambda c: c['sel'])
    print(f"\n## {tier} ({len(items)})\n")
    for c in items:
        print(f"### `{c['sel']}` — {c['cls']}")
        for n,v in c['types']:  print(f"- type `{n}` = {v}")
        for n in c['ifaces']:   print(f"- interface `{n}`")
        if c['inputs']:
            print('- inputs: ' + ', '.join(
                f"`{n}`{'↔' if k=='model' else '!' if k=='input.required' else ''}: {t}"
                + (f" = {d}" if d and len(d) < 60 else '')
                for n,k,t,d in c['inputs']))
        if c['outputs']: print('- outputs: ' + ', '.join(f"`{o}`" for o in c['outputs']))
        if c['methods']: print('- methods: ' + ', '.join(f"`{m}`" for m in c['methods']))
        print()
print('TOTALS ' + ' '.join(f"{t}={len(out[t])}" for t in TIERS), file=sys.stderr)
