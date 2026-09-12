---
name: certinal-ui
description: Use when building, extending or reviewing any Certinal-family UI — a prototype, demo, POC, mockup, pitch screen, or a new page/feature in an existing Certinal app (eConsent, ConsentFlow, ConsentMap, Consent Rights/Govern, eSign, DSR portal). Triggers on choosing colours, fonts, spacing, radii or icons for a Certinal screen; on deciding between a modal, drawer, page, popover or toast; on anything importing `@certinal/ui`, `@certinal/design-tokens` or a `Cui*` component or `cui-*` tag; and on "make this match our other apps / look like eConsent / stay on-brand".
---

# Certinal UI

The Certinal design system: `@certinal/ui` v0.0.1 (Angular 20 + Tailwind v4 — 68 components, 4 directives, 2 services,
4 DI helpers) plus
the two written laws that govern how it is used. Vendored under `library/` in this skill, so
this works with no repo checkout.

Purpose: a new prototype, and every page added to it later, looks like it belongs to the same
product family as everything else Certinal ships — without re-deciding colour, type, spacing
or interaction each time.

## Which copy of the library is the truth

There is more than one copy of `@certinal/ui` and **they have forked in both directions**.
Get this wrong and you will document or use variants that don't exist in the app you're building.

| | this skill's `library/` | a repo's own `packages/ui` (e.g. `econsent-ui/packages/ui`, pkg v1.0.0) |
|---|---|---|
| shape | standalone design-system fork, `CERTINAL_UI_VERSION 0.0.1` | monorepo-adapted fork |
| components | 68, **includes `cui-app-shell`** | 81, includes 14 the other lacks — `activity-feed`, `version-timeline`, `searchable-select`, `collapsible-card`, `selection-card`, `unsaved-changes-dialog`, `validation-modal`, `anchor-nav`, `back-button`, `browser-frame`, `code-snippet`, `color-picker`, `empty-strip`, `paginator-button`. **No `cui-app-shell`.** |
| tokens | full taxonomic ramps (teal/sky/blue/indigo/violet/pink/amber/stone) for `cui-tag` | adds `--color-purple-*` and `--color-ink: #042129`; **drops** the full taxonomic ramps |
| badges | `emerald lime success warning error info neutral` | same **plus `indigo`, `pink`, `blue`** (PII / PHI / data-element classification) |
| Tailwind | `@theme` + `@import "tailwindcss"` at the top — consumable standalone | `@theme static`, import removed (the engine is loaded by `src/tailwind.css`) |

**Rule: whichever copy is vendored in the repo you are editing wins.** Read *its* source; never
import this skill's `library/` into a repo that has its own. The vendored copy here is for
greenfield prototypes with no repo to inherit from — which is also the case where nothing else
would supply the design system at all.

`references/component-api.md` and `references/tokens.md` describe **this skill's fork**. When
working inside a repo with its own copy, regenerate against that copy:

```bash
~/.claude/skills/certinal-ui/scripts/extract-component-api.py <repo>/packages/ui/src/lib
```

## Do this first

1. **Read `references/tokens.md`.** It names the one token file that counts and the two
   decoy token files that fail silently. Skipping this is the most common way a screen ends
   up colourless or off-brand.
2. **Pick the lane.**
   - *Angular 20 target* → install/point at `@certinal/ui`, import
     `library/ui/src/styles/tokens.css` then `typography.css` once at the app root, add
     `assets/fonts.html` to `<head>`, and compose `Cui*` standalone components.
     APIs: `references/component-api.md`.
   - *Anything else* (single-file HTML, React, Next, RN, deck) → `references/outside-angular.md`.
     Use `assets/tokens-standalone.css` and reproduce the measured component specs there.
     The components can't travel; the tokens and specs must.
3. **Before laying out a screen, read the two laws** for the parts you're touching:
   `references/design-color-logic.md` (what each colour is allowed to mean) and
   `references/interaction-patterns.md` (which container each user intent gets).

## The six non-negotiables

These transfer to every Certinal app and every prototype, in any stack.

1. **Tokens only.** No literal hex, px, rem or font-family string in a component or a
   prototype. If a value isn't a token, either use the right token or add one to `tokens.css`.
2. **Brand colour = identity. Semantic colour = state. Never the same axis.** Emerald/cyan/lime
   say *which thing*; success/warning/error/info say *what state*. A `success` badge never
   means "Clinical product"; emerald never means "completed".

   **The axis runs both ways, and the reverse direction is the one that gets violated.**
   A row of sibling KPI cards on one page must be accented from the **brand family only** —
   rotate emerald → cyan → lime, then the `-bright`/`-dark` second tones, anchored on the
   product's brand per `design-color-logic.md` Rule 2. Never
   `accentColor="success"|"warning"|"error"|"info"` on a card, even when the cards *count*
   statuses. "Total / Active / Under Review / High Risk" gets four brand tones, not
   emerald + success + warning + error. Semantic colour belongs to a stat *value inside* a
   card, never to the card. Recipes: Rule 1a, 4-card and 6-card tables — but read *Where the
   law files and the shipped code disagree* below before implementing one, because the hexes
   those tables quote don't match the code, slot 4 fails WCAG AA on the hero value, and the
   legibility-first variant renders three identical cards as specified.
3. **One `.type-*` class per text element, for text you author.** Never pair `.type-*` with a
   Tailwind `font-*` weight — use the weight variant.

   Scope matters here, because the library does not obey this rule and cannot: `cui-metric-card`
   hard-codes `font-size: 28px` and `11px`, and `cui-button` composes
   `font-body font-medium leading-none` + a per-size `text-t-*` rather than applying
   `.type-button`. Reproducing a primitive faithfully outranks this rule. It binds *your*
   page-level text. Three rungs the layout spec asks for and `typography.css` does not ship —
   pick the nearest and don't invent a class name:
   the §7b H1 (24px/700 — `.type-h3` is 24–30px/**600**, `.type-h1` is 36–48px/700),
   the breadcrumb crumb (12px/500 — `.type-caption` is 12/400, `.type-label` is 14/500),
   and a 28px display number.

4. **A stats row on a list or registry page is an inline stat strip, not a card grid.**
   `cui-metric-card` is **dashboards only** — §7b Rule 6. The strip is one rounded container,
   a cell per stat, 32px tinted icon tile, `text-xl font-bold` value, `text-[11px]` muted
   label, separators between cells (vertical on `sm+`, horizontal on mobile), `mb-5` to the
   next section. Reaching for four metric cards on a registry page is the most common way to
   get a page that is individually fine and collectively inconsistent. If a requester asks for
   cards on a registry page anyway, say that the house pattern is the strip and let them decide.
5. **Interaction grammar is fixed, not per-case.** View → right drawer (`lg`, 600px, deep-linked
   `?details=:id`). Edit or create → its own page/route. Destructive → confirm dialog, danger
   tone. Single-field change → dropdown/popover on the trigger. Feedback → toast. Validation →
   inline alert. There are no other containers, and no "but this form is short" exception.
6. **Never hand-roll a component that exists.** 74 classes ship — check
   `references/component-api.md` before writing a `<button>`, a `fixed inset-0` overlay, a
   `<select>`, or a bespoke table row.

Rule 5 is the one that gets rationalised away under time pressure. It is the rule with the
most value: it is what makes a seven-module product feel like one product.
`interaction-patterns.md` §4 lists the patterns that must not exist, §6 maps every intent to
its container, §10 is the flowchart.

## Files

| Path | What it is |
|---|---|
| `references/tokens.md` | Token vocabulary, exact values, the decoy files, Tailwind v4 tree-shaking gotcha |
| `references/design-color-logic.md` | Colour law, verbatim. Brand-vs-semantic, KPI-row recipes (4/6-card), WCAG-legible variant, `CATEGORY_PALETTE` contract |
| `references/interaction-patterns.md` | Interaction law, verbatim. Four rules, intent→container map, page/sub-page layout contracts, per-component usage |
| `references/component-api.md` | Generated: all 74 exported classes with selector, inputs (`↔` = two-way `model()`, `!` = required), outputs, variant unions, and the 51 registered `cui-icon` names |
| `references/outside-angular.md` | Measured component specs for non-Angular targets |
| `assets/tokens-standalone.css` | All 208 tokens + 14 `.type-*` utilities, no build step |
| `assets/fonts.html` | DM Sans + DM Mono `<link>` block |
| `library/` | Vendored `@certinal/ui` + `@certinal/design-tokens` source — read a component when you need exact styling |
| `scripts/` | Regenerate `component-api.md` and `tokens-standalone.css` after refreshing `library/` |

The two law files are verbatim copies of the design team's own docs, kept that way so they
can be diffed and replaced wholesale when the design team revises them. Parts of
`interaction-patterns.md` name specific modules and routes of `certinal-admin-angular`; the
grammar is portable, the route names are examples.

## Where the law files and the shipped code disagree

The law files are the design team's prose and are slightly ahead of / behind the library in
two places. **The code wins** — verified against `library/` at v0.0.1.

| Law file says | Code actually does |
|---|---|
| `interaction-patterns.md` §7: `this.toast.success({ message: 'Asset saved.' })` | `success(message: string, title?: string)` takes a **string**, not a config object. The object form is `show({ variant, message, title })`. The snippet as written won't compile. |
| `design-color-logic.md` Rule 7: no cyan pill, hand-build one from `CATEGORY_PALETTE` | True for **badges** (`CuiBadgeVariant` has no cyan). But `cui-tag` ships `tone="cyan"` → `bg-cyan-50 text-cyan-700`. For a cyan *identity* chip use `<cui-tag tone="cyan">`; reserve the hand-built pill for a tone `cui-tag` genuinely lacks. |
| Rule 1a's recipe tables quote one hex per accent — `emerald #1A7A5E`, `cyan #0E7490`, `lime #84CC16` | A metric card resolves **two different rungs**, and the quoted hex is a different one of the two in each column. `metric-card.component.css` sets `--metric-accent` (icon tile + hero value) to emerald-**700** `#15654D` / cyan-600 `#0E7490` / lime-600 `#65A30D`; `card.component.css` sets the 4px `accent-top` border to emerald-**700** `#15654D` / cyan-**500** `#0891B2` / lime-500 `#84CC16`. So `#1A7A5E` appears **nowhere** in an emerald metric card. Don't spot-check a screenshot against those tables. |
| Rule 1a's legibility-first variant: slot 1 `emerald` (emerald-500), slot 2 `emerald` + `.metric-card-emerald-dark` (emerald-700) | **Unbuildable as written.** Plain `emerald` already resolves `--metric-accent` to emerald-700, so slots 1, 2 and 4 render pixel-identical — breaking Rule 1a's own "no exact-shade repeats in the same row." If you need this variant, define `.metric-card-emerald-dark` at emerald-**800** `#0F4A38`. |
| Rule 1a's canonical slot 4: `emerald` + `.metric-card-emerald-bright` | The `-bright` wrapper retunes `--metric-accent`, and `.cui-metric-card__value` is coloured by `--metric-accent` — so this paints the **hero number** emerald-400 at ~1.75:1, which the colour doc's own contrast table marks as failing AA. Have the wrapper retune the border and icon tile only and leave the value at the -700 rung. The `-bright`/`-dark` wrappers live in the **consuming app's** `styles.scss`, not in the library, so this is yours to get right. |

Also note `.type-caption-semibold` is referenced in some Certinal app notes but the library
ships `.type-caption-bold`. Check `library/ui/src/styles/typography.css` before using a
`.type-*` name.

**And one contradiction internal to the colour doc, which reading harder will not resolve.**
Rule 1a says use the legibility-first variant when *"the product brand for the page is not
cyan"* **or** when *"the page audience explicitly requires WCAG AA (compliance-facing pages,
audit logs printed for legal review)"*. Any emerald-anchored compliance page — a Consent Govern
audit or risk register, i.e. much of this product — satisfies both. Yet the canonical 4-card
table routes emerald-anchored pages to emerald → cyan → lime → emerald-bright. Two rules, same
page, opposite answers. The stated reason for the first bullet is also wrong on its face: it
claims an emerald-anchored page "would otherwise have only emerald + lime + emerald-bright +
lime-bright", but the emerald-anchored column of the table directly above it has cyan at slot 2.

Until design settles it: use the **standard** recipe with slot 4's `-bright` wrapper fixed per
the row above (border and icon tile only, value stays at -700). That satisfies both Rule 1a's
no-repeat requirement and AA on the value, which neither documented variant does as written.
Flag it rather than quietly picking, if the page is going in front of a compliance reviewer.

## Traps

| Trap | Reality |
|---|---|
| "These KPI cards count statuses, so status colours are the *consistent* choice — brand colour on a status card would be borrowing a brand colour to mean state" | Backwards, and this exact inversion was produced in testing. The **card accent is identity** (which metric, on which product's page); the **status is the value inside**. Four brand tones. Rule 1a. |
| The repo has no `design-color-logic.md`, so the token file is the whole law | The token file tells you which colours *exist*, never which one a thing is *allowed to mean*. In testing, reading only the codebase produced correct hexes and inverted semantics. Read the two law files. |
| Importing `@certinal/design-tokens/css/tokens.css` | Wrong file. `--ds2-*` names, zero `--color-*`, values that disagree with the real ones. Components render unstyled, silently. Use `library/ui/src/styles/tokens.css`. |
| Copying CSS variables out of `certinal-design-system.html` | Its `--t-*` / `--sp-*` / `--c-*` vocabulary exists only inside that file. Read it to *see* a component; never lift its variable names. |
| Also importing `tailwindcss` next to `tokens.css` | `tokens.css` already starts with `@import "tailwindcss"`. Double import. |
| Rounded-rectangle buttons | Certinal buttons are `--radius-full` pills, 1.5px border. Cards are 24px. Getting these two wrong loses the family resemblance on its own. |
| Any Lucide icon name in `cui-icon` | Closed union of 51 names. Unregistered → empty box + console error. |
| `--color-success` "looks wrong", let me use `#22C55E` | It is lime `#C4E538` on purpose, from the brand gradient family. Leave it. |
| A token resolves to nothing at runtime | Tailwind v4 tree-shakes unreferenced `@theme` entries. Re-declare it in a `:root{}` block in the app's own `styles.css`. See `tokens.md`. |
| Writing a focus ring | `tokens.css` already ships an AA-compliant 3px `emerald-400` global `:focus-visible` ring. |
| Using `@dewdrops/*` | Forbidden workspace-wide for new work. This system, or `@angular/material` where this system has no equivalent. |

## Refreshing

When the design team ships a new `@certinal/ui`, replace `library/` with the new
`packages/ui` + `packages/design-tokens`, drop in the revised law files, then from the skill
root run `scripts/extract-component-api.py > references/component-api.md` and
`scripts/build-standalone-css.py`. Bump the version stamped at the top of this file.
