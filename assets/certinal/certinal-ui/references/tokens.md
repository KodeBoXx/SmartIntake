# Token vocabulary

Authoritative token names and values for `@certinal/ui` v0.0.1.

## The one file that counts

`library/ui/src/styles/tokens.css` — the `--color-*` / `--spacing-*` / `--radius-*` / `--text-t-*`
vocabulary. Every `Cui*` component resolves against it. Import it and nothing else.

It begins with `@import "tailwindcss";`, so importing it **also boots Tailwind v4**. Do not
`@import 'tailwindcss'` again alongside it.

## Two decoy vocabularies — never use these

Both files ship in the same distribution and both look authoritative. Neither works.

| File | Vocabulary | Why it fails |
|---|---|---|
| `library/design-tokens/css/tokens.css` | `--ds2-forest`, `--ds2-teal-500`, `--ds2-text-primary` | Defines **zero** `--color-*` variables. Every `Cui*` component renders unstyled. Its values also disagree with the real ones — `--ds2-text-primary: #2D3239` vs the real `#0F172A`; `--ds2-success: #22C55E` vs the real `#C4E538`. Its header says "v3" but the naming is v2-era. |
| `library/ui/src/certinal-design-system.html` | `--t-400`, `--sp-3`, `--c-emerald-500`, `--r-xl`, `--border` | A **self-contained spec page**. Its variables exist only inside that one file. Read it to *see* what a component should look like; never copy its CSS variable names into app code. |

Both failures are silent — an undefined CSS custom property resolves to nothing, so you get
invisible text on a white page rather than an error. If a prototype renders colourless, the
first thing to check is which `tokens.css` got imported.

This is not an outside inference: `interaction-patterns.md` **Rule 11** states it as law —
*"Color tokens: only `--color-*`, never `--ds2-*`. Those are legacy. Sub-pages migrating into
the canonical pattern must swap to `--color-text-*`."* The `--ds2-*` file is a known-legacy
artefact that simply hasn't been deleted from the distribution.

`@certinal/design-tokens` also ships `tailwind/preset.js` — a **Tailwind v3** `theme.extend`
preset. It is not usable by Tailwind v4's `@theme` engine, which is what this library targets.

## Colour

Brand identity (Rule 1: identity only, never state — see `design-color-logic.md`):

| Ramp | 400 | 500 | 600 | 700 | Role |
|---|---|---|---|---|---|
| emerald | `#25C999` | `#1A7A5E` | `#1A7A5E` | `#15654D` | **primary brand** |
| cyan | `#22D3EE` | `#0891B2` | `#0E7490` | `#155E75` | accent |
| lime | `#A3E635` | `#84CC16` | `#65A30D` | `#4D7C0F` | secondary brand |

Note `emerald-500` and `emerald-600` are the **same hex** (`#1A7A5E`), and `emerald-50` ==
`emerald-100` (`#E6F5F0`). Not a typo in this doc — that is what the ramp ships.

Full ramps also exist for slate (neutral) and, for `cui-tag` taxonomic tones only:
teal, sky, blue, indigo, violet, pink, amber, stone.

Semantic state (Rule 1: state only, never identity):

```
--color-success: #C4E538   --color-success-light: #F7FEE7   --color-success-dark: #4D7C0F
--color-warning: #F59E0B   --color-warning-light: #FEF3C7   --color-warning-dark: #92400E
--color-error:   #EF4444   --color-error-light:   #FEE2E2   --color-error-dark:   #991B1B
--color-info:    #0891B2   --color-info-light:    #ECFEFF   --color-info-dark:    #155E75
```

`--color-success` is lime-derived (`#C4E538`), not a conventional green. It is deliberately
part of the brand gradient's family. Do not "correct" it to `#22C55E`.

Chrome — the only greys you may use:

```
--color-bg-page      #F8FAFC     page background
--color-bg-surface   #FFFFFF     card / table container
--color-bg-subtle    #F1F5F9     banner / inline note
--color-bg-muted     #E2E8F0
--color-text-primary #0F172A     titles, hero values
--color-text-secondary #334155
--color-text-muted   #64748B     secondary descriptions, stat labels
--color-text-faint   #94A3B8     timestamps, quietest metadata
--color-text-inverse #FFFFFF
--color-border-default #E2E8F0   all chrome borders
--color-border-strong  #CBD5E1
```

Aliases: `--color-brand-primary: #1A7A5E`, `--color-brand-secondary: #84CC16`.
Gradient: `--brand-gradient: linear-gradient(135deg, #C4E538 0%, #25C999 100%)`, exposed as
the `.bg-brand-gradient` utility.

## Type

`--font-display` and `--font-body` are **both DM Sans**; `--font-mono` is DM Mono. Fonts are
not bundled — the consumer loads them (see `assets/fonts.html`).

Sizes are a clamp scale, `--text-t-100` … `--text-t-900`:

| Token | Value | Applied by |
|---|---|---|
| `t-900` | `clamp(3rem, 6vw, 4.5rem)` | `.type-display` (300 weight) |
| `t-800` | `clamp(2.25rem, 4vw, 3rem)` | `.type-h1` (700) |
| `t-700` | `clamp(1.875rem, 3vw, 2.25rem)` | `.type-h2` (700) |
| `t-600` | `clamp(1.5rem, 2.5vw, 1.875rem)` | `.type-h3` (600) |
| `t-500` | `clamp(1.25rem, 2vw, 1.5rem)` | `.type-h4` (600) |
| `t-400` | `1.125rem` | `.type-body-lg` |
| `t-300` | `1rem` | `.type-body`, `.type-button` (500) |
| `t-200` | `0.875rem` | `.type-body-sm`, `.type-label` (500), `.type-code` |
| `t-100` | `0.75rem` | `.type-caption`, `.type-caption-bold` (600, uppercase, `0.04em`), `.type-code-sm` |

Apply type with **one** `.type-*` class — it sets family + size + weight + leading together.
Do not pair a `.type-*` class with a Tailwind `font-*` weight utility; the `.type-*` rule
already declares `font-weight` and the utility loses to it at equal specificity depending on
emit order. Use the weight variant instead (`.type-caption-bold`).

> The eConsent app's own notes refer to a `.type-caption-semibold`. This library ships
> `.type-caption-bold`. Check `library/ui/src/styles/typography.css` before assuming a
> `.type-*` name exists.

## Scale

```
spacing   1..24 on a 4px unit / 8px rhythm: --spacing-1 .25rem … --spacing-24 6rem
          (defined: 1 2 3 4 5 6 8 10 12 16 20 24 — there is no --spacing-7, -9, -11 …)
radius    sm 4px | md 8px | lg 12px | xl 16px | 2xl 24px | full 9999px
shadow    sm | md | lg | xl   (all slate-tinted rgba(15,23,42,…), very low alpha)
```

Raw `:root` variables (not Tailwind-aware — no utility is generated for these):

```
--size-control-sm|md|lg|xl   32 | 40 | 48 | 56 px      40px is the default control height
--size-icon-xs|sm|md|lg|xl   12 | 16 | 20 | 24 | 32 px
--size-avatar-xs…xl          24 | 32 | 40 | 48 | 64 px
--size-tap-target            44px    WCAG 2.5.8 minimum
--border-1 | -1-5 | -2       1 | 1.5 | 2 px            controls use 1.5px borders
--dur-fast|base|slow         150 | 200 | 350 ms
--ease-out / --ease-in-out   cubic-bezier(0.4, 0, 0.2, 1)
--z-base|raised|dropdown|modal|toast   0 | 10 | 100 | 200 | 300
```

## Not a design token: `--sidebar-w`

`interaction-patterns.md` §7c/§7d uses `left: var(--sidebar-w, 0px)` to keep a sub-page's
sticky footer from overlapping the sidebar. That variable is **published by the app shell at
runtime**, not defined in `tokens.css` — which is why every use carries a `0px` fallback.
Don't add it to the token file, and don't drop the fallback.

## Behaviour baked into tokens.css

Importing `tokens.css` is not passive — it also applies:

- `body { margin:0; padding:0; background: var(--color-bg-page) }`
- a global focus ring: `*:focus-visible { outline: 3px solid var(--color-emerald-400); outline-offset: 2px }`
- a `prefers-reduced-motion` block that clamps **all** animation and transition durations to `0.01ms`
- a 6px custom scrollbar
- the `.bg-brand-gradient` utility

Two consequences worth knowing. Do not re-implement a focus ring — you already have an
AA-compliant one. And when testing motion, remember a reduced-motion OS setting will
flatten every animation globally, not just the ones you wrote.

## Tailwind v4 tree-shaking (the token that "disappears")

`tokens.css` declares colours inside Tailwind v4's `@theme {}` block. Tailwind v4 only emits
an `@theme` entry as a real CSS variable **if some Tailwind utility references it**. `Cui*`
components reach for several tokens from raw CSS instead of utilities — so those get stripped
from the build and resolve to nothing at runtime.

Fix, in the consuming app's own `styles.css`, re-declare the affected tokens in a plain
`:root {}` block after the import. Known to need it: `--color-bg-surface`,
`--color-border-default`, the `--shadow-*` set. Extend that block whenever a new `Cui`
consumer shows an unstyled surface.

This is the same issue as Rule 8 in `design-color-logic.md`; that file has the eConsent
app's specific override block.
