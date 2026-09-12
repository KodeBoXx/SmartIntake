# Prototyping outside Angular 20

`@certinal/ui` is Angular 20 + Tailwind v4 only. Plenty of prototypes aren't: a single-file
HTML mock, a React or Next scratch app, React Native, a slide-deck screenshot. This is where
visual consistency actually breaks, because the components can't come along.

**What still comes along: the tokens and the specs.** Nothing here is a licence to re-pick
colours or invent a button.

## Setup

1. `assets/fonts.html` → `<head>`.
2. `assets/tokens-standalone.css` → inline in a `<style>` or ship as a stylesheet. Generated
   from the real `tokens.css`, `@theme{}` flattened to `:root{}`, all 208 variables, plus the
   14 `.type-*` utilities. No Tailwind build needed.
3. Style everything with `var(--color-*)` / `var(--spacing-*)` / `var(--radius-*)` and one
   `.type-*` class per text element. A literal hex in a prototype is the defect this skill exists
   to prevent — the whole point is that the next prototype matches this one.

> Writing a token glob into a CSS comment will silently delete your token block. `--t-*/--sp-*`
> inside `/* … */` contains `*/`, which closes the comment early; CSS error-recovery then eats
> everything up to the next `}` — typically the whole `:root`. The page renders in Times with no
> colour, which looks exactly like importing the wrong `tokens.css`. Write `--t-…` or
> `--t-* / --sp-*` with spaces.

React/Vue: same CSS file, `className` instead of `class`. React Native has no CSS variables —
export the token values into a JS constants module and reference those; keep the names.

## Component specs to reproduce

Measured from the library source, not approximated. Section refs are the sections of
`library/ui/src/certinal-design-system.html`, which renders each of these visually.

### Button — pill, never a rounded rectangle

The single most recognisable Certinal signature, and the thing agents get wrong first.

```
shape        border-radius: 9999px  (--radius-full)     icon-only: 40×40, --radius-md
border       1.5px solid                                 every variant, transparent when unfilled
type         .type-button (DM Sans 500)                   size md → --text-t-300
padding      sm 6px/16px · md 12px/20px · lg 16px/32px · xl 20px/40px
motion       transition 300ms ease-in-out; hover translateY(-1px); active scale(.97)
disabled     opacity .40, pointer-events none
```

| variant | fill | text | border | hover |
|---|---|---|---|---|
| `primary` | `--color-emerald-500` | white | transparent | fill → `emerald-400`, `--shadow-md` |
| `primary02` | `--color-success` (`#C4E538`) | `emerald-900` | transparent | fill → `emerald-400`, text → white |
| `secondary` | `--color-bg-surface` | `--color-text-primary` | `--color-border-strong` | fill → `bg-subtle`, border → `emerald-400` |
| `secondary02` | `--color-bg-surface` | `--color-text-primary` | `emerald-400` | fill → `bg-subtle` |
| `tertiary` | transparent | `emerald-600` | transparent | fill → `emerald-50` |
| `danger` | `--color-error` | white | transparent | fill → `error-dark` |

The primary CTA stays emerald on **every** page regardless of that page's brand accent — the
page's identity colour lives in its icon tile, KPI cards, row stripes and badges. See
`design-color-logic.md` Rule 1.

### Input / select — rounded rectangle, 1.5px, 3px focus ring

```
shape     --radius-lg (12px)      surface --color-bg-surface     border 1.5px
height    sm 32px · md 40px · lg 48px      (--size-control-*)
padding   sm 12px · md/lg 16px horizontal   textarea: 12px/16px vertical
focus     border --color-emerald-500 + ring 3px emerald-400 @ 15% alpha
error     ring 3px --color-error @ 12%
filled    border emerald-200 when a value is present and unfocused — a deliberate
          "already answered" state; hover and focus both override it
```

### Badge vs Tag — different jobs

Both are `--radius-full` pills in `.type-caption-bold` (12px / 600 / uppercase / `0.04em`),
padding `3px 10px`.

- **Badge** = **state**. Variants `emerald | lime | success | warning | error | info | neutral`,
  each `{tone}-light` fill over `{tone}-dark` text (`neutral` = `bg-muted` / `text-secondary`).
- **Tag** = **identity / category**. Has the wide taxonomic ramp (emerald, lime, teal, sky,
  blue, indigo, violet, pink, amber, stone) precisely so categories can be distinguished
  without borrowing a semantic colour.

Do not use a `success` badge to mean "this is the Clinical product". That is Rule 1.

There is **no cyan badge variant** — `info` is semantic blue, not brand cyan. But `cui-tag`
*does* ship `tone="cyan"` (`bg-cyan-50` / `text-cyan-700`), so a cyan identity chip is
`<cui-tag tone="cyan">`, not a hand-built pill. (`design-color-logic.md` Rule 7 predates
this and sends you to `CATEGORY_PALETTE`; only do that for a tone `cui-tag` lacks.)
Either way: don't fake brand cyan with `neutral` or `info`.

Tag fills are the `{tone}-50` rung over `{tone}-700` text — lighter than a badge's
`{tone}-light`. Padding `sm` 2px/8px, `md` 3px/10px.

### Card — 24px radius

```
radius    --radius-2xl (24px)        surface --color-bg-surface
padding   none 0 · sm 16px · md 24px · lg 32px
variants  default (1px border) · elevated (--shadow-md) · feature · dark
hover     hoverable → --shadow-lg
accent    accent-top → 4px top border; emerald→emerald-700, lime→lime-500, cyan→cyan-500
```

24px is unusually round for enterprise software and is a large part of the family
resemblance. A prototype with 8px cards reads as a different product.

### Icons

`cui-icon` accepts a **closed union of 51 names**, not arbitrary Lucide names. An unregistered
name renders an empty box plus a console error. Full list in `component-api.md` under
`cui-icon`; source of truth is `library/ui/src/lib/primitives/icon/icon.component.ts`.

Sizes: the `size` prop is `xs|sm|md|lg` only — 12/16/20/24px, default `sm`. `--size-icon-xl`
(32px) is a token but **not** a valid `cui-icon` size.

**Hand-porting the icons is where this lane breaks.** The library declares
`fill="none" stroke="currentColor" stroke-width="2"` plus round caps and joins on the root
`<svg>`, and the path data alone carries none of that. If you build a `<symbol>` sprite,
`<use href="#id">` does **not** inherit those attributes — every icon renders as a filled
black blob, which looks like a deliberate style rather than a bug until you compare against a
real screen. Declare the five attributes once on your icon class:

```css
.icon { fill: none; stroke: currentColor; stroke-width: 2;
        stroke-linecap: round; stroke-linejoin: round; }
```

Lift path data verbatim from `library/ui/src/lib/primitives/icon/icon.component.html` rather
than drawing approximations — approximated glyphs are the fastest way to make a prototype read
as a different product.

### Drawer — the view surface

Right-hand, `size="lg"` = **600px** (`max-width: 90vw`). Slides in from the right; the
library's exit is an instant unmount. In a prototype, animate entry with
`cubic-bezier(0.16, 1, 0.3, 1)` and honour `prefers-reduced-motion`.

## Layout skeleton

```
page background   --color-bg-page          content max-width ~1200px
main page         one outer max-w-6xl wrapper, sections separated by 24px (--spacing-6)
edit/create page  no max-width wrapper, work area is a 20px-gap column, sticky footer
header order      breadcrumb (12px, 12px below) → 40×40 icon tile + H1 (24px/700) +
                  subtitle (14px, --color-text-muted) → right-side actions
stats row         registry/list page → inline stat strip (ONE rounded container, a cell per
                  stat, 32px tinted icon tile, 20px/700 value, 11px muted label, separator
                  between cells), mb-5 to the next section. Dashboard → metric-card grid,
                  16–20px gap, 1 / 2 / 3 / 6 columns at base / 640 / 1024 / 1280.
                  Cards on a registry page is the wrong pattern — §7b Rule 6.
list of records   ONE rounded-xl surface container, rows flush inside it — 1px bottom
                  divider per row, 4px coloured left stripe for category. Never a stack
                  of separate cards with gaps.
```

Full rules, including breadcrumb shapes and the sticky-footer contract, are in
`interaction-patterns.md` §7b (main pages) and §7c (sub-pages).

## What does not change outside Angular

The interaction grammar is stack-independent. View → right drawer. Edit/create → its own
page or route. Destructive → confirm dialog. Single-field change → dropdown or popover on
the trigger. Feedback → toast. Validation → inline alert.

A single-file HTML prototype still has "pages" — swap a view, push a hash route. Collapsing
edit into a modal because "it's only a prototype" is exactly how the inconsistency this
design system was built to kill gets reintroduced. `interaction-patterns.md` §4 lists what
must not exist; that list applies to prototypes too.
