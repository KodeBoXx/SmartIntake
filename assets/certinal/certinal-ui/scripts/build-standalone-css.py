#!/usr/bin/env python3
"""Regenerate assets/tokens-standalone.css from the vendored library.

Flattens Tailwind v4's @theme{} into plain :root{} so the tokens resolve in a
single-file HTML / React / RN-web prototype with no Tailwind build step.
Run from the skill root after refreshing library/.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

def block(text, header):
    i = text.index(header); j = text.index('{', i); d = 0
    for k in range(j, len(text)):
        if text[k] == '{': d += 1
        elif text[k] == '}':
            d -= 1
            if d == 0: return text[j + 1:k]
    sys.exit(f'unbalanced braces after {header!r}')

src  = (ROOT / 'library/ui/src/styles/tokens.css').read_text(encoding='utf8')
typo = (ROOT / 'library/ui/src/styles/typography.css').read_text(encoding='utf8')
theme = block(src, '@theme')
root  = block(src, '\n:root')
types = '\n'.join(m.group(0) for m in re.finditer(r'\.type-[a-z0-9-]+\s*\{[^}]*\}', typo))

(ROOT / 'assets/tokens-standalone.css').write_text(f"""/* Certinal design tokens — STANDALONE (no Tailwind build required).
   Generated from @certinal/ui v0.0.1 tokens.css + typography.css.
   Identical values; @theme{{}} flattened to :root{{}} so plain CSS resolves them.
   Regenerate with scripts/build-standalone-css.py — do not hand-edit. */

:root {{{theme}}}

:root {{{root}}}

/* ---- type utilities ---- */
{types}

/* ---- base ---- */
html, body {{ font-family: var(--font-body); }}
body {{
  margin: 0; padding: 0;
  background-color: var(--color-bg-page);
  font-size: var(--text-t-300); font-weight: 400; line-height: 1.6;
  color: var(--color-text-primary);
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
}}
code, pre, kbd, samp {{ font-family: var(--font-mono); }}
*:focus-visible {{ outline: 3px solid var(--color-emerald-400); outline-offset: 2px; }}
@media (prefers-reduced-motion: reduce) {{
  *, *::before, *::after {{ animation-duration: .01ms !important; transition-duration: .01ms !important; }}
}}
.bg-brand-gradient {{ background: var(--brand-gradient); }}
::-webkit-scrollbar {{ width: 6px; height: 6px; }}
::-webkit-scrollbar-track {{ background: transparent; }}
::-webkit-scrollbar-thumb {{ background: var(--color-border-strong); border-radius: 3px; }}
::-webkit-scrollbar-thumb:hover {{ background: var(--color-text-muted); }}
""", encoding='utf8')

n = len(re.findall(r'^\s*--', (ROOT / 'assets/tokens-standalone.css').read_text(encoding='utf8'), re.M))
print(f'assets/tokens-standalone.css — {n} variables, {types.count(".type-")} type utilities')
