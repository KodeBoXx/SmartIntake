Design Color Logic
Color rules established when designing /dashboard-alt02 using the @certinal/ui design library. /dashboard-alt02 is the canonical reference for color balance in this app — any new design-driven page should match its discipline. When in doubt, open src/app/features/dashboard/components/dashboard-alt02.component.ts and copy.

Why these rules exist
The @certinal/ui palette mixes two distinct kinds of color — brand identity and semantic state. Using them on the same axis confuses scanning. A clean rule lets every coloured pixel mean something specific.

How to apply
When designing or critiquing any new screen, check that brand colors are used for identity and semantic colors for state — not the other way around. When mapping a product/domain to a brand color, follow the table in Rule 2. When building a list/table of items that carry both category AND state, follow Rule 3 to the letter (flush table, colored left stripe, vertical time/state stack on the right).

Rule 1 — Brand colors for identity. Semantic colors for state. Never the same axis.
The Cui palette exposes:

Brand: emerald (primary, teal-leaning #1A7A5E), lime (secondary), cyan (accent)
Semantic: success, warning, error, info, neutral
Brand colors must only signal which thing (product, category, entity, or sibling metric within a product). Semantic colors must only signal what state (completed, pending, error, info). Don't use success to identify a product, and don't use emerald to mean "completed."

Rule 1a — Within-product KPI rows: vary across the brand family, never with semantic accents.
When a single-product page has multiple sibling KPI cards (e.g. Purpose Registry's "Total / Active / Draft / Categories"), differentiate them visually by rotating through the brand family (emerald, cyan, lime) — anchored on the product's primary brand. The page should read as a harmonious composition of related hues, not as a status dashboard.

Principles:

Anchor on the product's primary brand. Position 1 always carries the brand Rule 2 maps to the product (cyan for DPDP, emerald for Clinical, lime for Cookies).
Rotate through the other brand family members for the remaining positions.
No exact-shade repeats in the same row. With 4 cards and only 3 CuiCardAccentColor brand tokens (emerald / cyan / lime), the 4th slot must use a second tone of an existing brand, not a reused token. The canonical second tone is "bright emerald" (emerald-400, #25C999) — a brighter teal that pairs cleanly with emerald-500's deep teal.
No semantic accents on sibling KPI cards. accentColor="success", "warning", "error", "info" are state colors and confuse the axis. Semantic colors belong on per-stat values inside a card, not on the card itself.
Canonical 4-card recipe (single product, by anchor brand)
Slot	Cyan-anchored (e.g. DPDP / Purpose Registry)	Emerald-anchored (e.g. Clinical Consents)	Lime-anchored (e.g. Cookie Consents)
1	accentColor="cyan" — #0E7490	accentColor="emerald" — #1A7A5E (deep teal)	accentColor="lime" — #84CC16
2	accentColor="emerald" — #1A7A5E (deep teal)	accentColor="cyan" — #0E7490	accentColor="cyan" — #0E7490
3	accentColor="lime" — #84CC16	accentColor="lime" — #84CC16	accentColor="emerald" — #1A7A5E (deep teal)
4	accentColor="emerald" + .metric-card-emerald-bright wrapper — #25C999 (bright teal)	accentColor="emerald" + .metric-card-emerald-bright wrapper — #25C999 (bright teal)	accentColor="emerald" + .metric-card-emerald-bright wrapper — #25C999 (bright teal)
Reference: purpose-registry-alt01.component.ts (Cyan-anchored row) is the canonical 4-card implementation.

Canonical 6-card recipe (single product, by anchor brand)
For audit-log / activity-log / metrics pages that genuinely need 6 KPI cards (e.g. /dpdp/transactions with Total / Granted / Revoked / Modified / Data Requests / Success Rate), extend the 4-card table with two more "-bright" wrapper variants. Six distinct brand-family tones — no semantic colors:

Slot	Cyan-anchored (e.g. DPDP / Transactions)	Emerald-anchored	Lime-anchored
1	accentColor="cyan" — #0E7490	accentColor="emerald" — #1A7A5E	accentColor="lime" — #84CC16
2	accentColor="emerald" — #1A7A5E	accentColor="cyan" — #0E7490	accentColor="cyan" — #0E7490
3	accentColor="emerald" + .metric-card-emerald-bright — #25C999	accentColor="emerald" + .metric-card-emerald-bright — #25C999	accentColor="emerald" + .metric-card-emerald-bright — #25C999
4	accentColor="lime" — #84CC16	accentColor="lime" — #84CC16	accentColor="emerald" — #1A7A5E
5	accentColor="cyan" + .metric-card-cyan-bright — #22D3EE (bright cyan)	accentColor="cyan" + .metric-card-cyan-bright — #22D3EE	accentColor="cyan" + .metric-card-cyan-bright — #22D3EE
6	accentColor="lime" + .metric-card-lime-bright — #A3E635 (bright lime)	accentColor="lime" + .metric-card-lime-bright — #A3E635	accentColor="lime" + .metric-card-lime-bright — #A3E635
Reference: transactions.component.ts (Cyan-anchored 6-card row) is the canonical 6-card implementation.

How to apply the -bright wrappers
All three wrappers follow the same shape — wrap the card in a <div class="metric-card-{brand}-bright"> and keep the matching accentColor="{brand}" on the card:

<!-- Slot 3 (emerald-bright): emerald-400 instead of emerald-500 -->
<div class="metric-card-emerald-bright">
  <cui-metric-card icon="…" [value]="…" title="…" accentColor="emerald" />
</div>

<!-- Slot 5 (cyan-bright): cyan-400 instead of cyan-600 -->
<div class="metric-card-cyan-bright">
  <cui-metric-card icon="…" [value]="…" title="…" accentColor="cyan" />
</div>

<!-- Slot 6 (lime-bright): lime-400 instead of lime-600 -->
<div class="metric-card-lime-bright">
  <cui-metric-card icon="…" [value]="…" title="…" accentColor="lime" />
</div>
The wrapper classes live in src/styles.scss and override --metric-accent, --metric-accent-soft, and the cui-card border-top color to the -400 shade. The accentColor="{brand}" attribute stays — the library still applies its base classes; the wrapper retunes the resolved shade.

Responsive grid for 6-card rows
A 6-card row needs more breakpoints than a 4-card one. Use:

<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
  …six <cui-metric-card> instances, with wrapper divs on slots 3, 5, 6…
</div>
xl:grid-cols-6 at ≥1280px — all six cards in one row (cui-app-shell's 1200px content area + the row's gap accommodates this).
lg:grid-cols-3 at 1024–1279px — two rows of three.
sm:grid-cols-2 at 640–1023px — three rows of two.
grid-cols-1 below 640px — single column.
Rows with fewer cards
For 2-card or 3-card rows, take the first N slots from the cyan-anchored 4-card column (cyan → emerald → lime). No bright-* wrapper needed — no shade collision yet.

Rows with more than 6 cards
Discouraged — six is the practical ceiling before the brand palette starts to feel repetitive. If a page truly needs more than six KPIs, group them: render the top 6 as a primary row using the 6-card recipe, then a secondary row of detail metrics in a different visual treatment (e.g. a compact text list, or <cui-metric-stat> children inside a single card via <cui-metric-card [stats]="…">). Don't extend the brand-family tone rotation past six.

Legibility-first variant: emerald + lime only, no -bright shades
The standard 4-card and 6-card recipes use the -bright wrappers (emerald-400, cyan-400, lime-400) for shade differentiation. Those -400 shades fail WCAG AA contrast for value text on the white cui-metric-card surface:

Shade	Hex	Contrast vs white	WCAG AA large text (≥3:1)
emerald-500	#1A7A5E	4.57:1	✅
emerald-700	#15654D	≈5.5:1	✅
lime-700	#4D7C0F	4.0:1	✅
lime-600	#65A30D	2.69:1	⚠️ borderline (library default)
cyan-600	#0E7490	4.55:1	✅
emerald-400	#25C999	≈1.75:1	❌
cyan-400	#22D3EE	≈1.6:1	❌
lime-400	#A3E635	≈1.5:1	❌
For pages where every KPI must be WCAG-AA legible AND no cyan/blue is allowed (entity-state audit logs, compliance dashboards, accessibility-first views), use this legibility-first variant: three guaranteed-legible tones rotated × 2.

Slot	Card	Accent + wrapper	Resolved color
1	(any)	accentColor="emerald"	emerald-500 #1A7A5E
2	(any)	accentColor="emerald" + .metric-card-emerald-dark	emerald-700 #15654D
3	(any)	accentColor="lime" + .metric-card-lime-dark	lime-700 #4D7C0F
4	(repeat)	accentColor="emerald"	emerald-500
5	(repeat)	accentColor="emerald" + .metric-card-emerald-dark	emerald-700
6	(repeat)	accentColor="lime" + .metric-card-lime-dark	lime-700
The .metric-card-emerald-dark and .metric-card-lime-dark wrappers live in src/styles.scss alongside the -bright wrappers; same shape (override --metric-accent, --metric-accent-soft, and the cui-card border-top color), just retuned to the -700 shade.

When to choose this variant over the default 6-card recipe:

The product brand for the page is not cyan (e.g. a non-DPDP module that should anchor on emerald — would otherwise have only emerald + lime + emerald-bright + lime-bright, and bright variants fail AA).
The page audience explicitly requires WCAG AA (compliance-facing pages, audit logs printed for legal review, etc.).
The user has explicitly excluded cyan/blue from a specific page (rare but valid — e.g. when the brand identity contracts to "emerald + green" temporarily).
The page is hidden behind a feature flag while design iteration continues (the legibility-first variant is the safe default until a richer palette is decided).
Forbidden combinations even in the legibility-first variant: never use the -bright wrappers on this variant. The whole point is WCAG AA contrast — adding a -400 shade defeats the purpose.

Across-products vs within-product
Across-products KPI rows (different cards = different products, like /dashboard-alt02's clinical / data / cookies row) are a different pattern: each card's accent identifies its product per Rule 2 directly. Don't conflate the two — the recipe table above only applies when all cards in the row belong to the same product.

Rule 2 — Product → brand color mapping (canonical)
Product / domain	Cui accent	Why
Clinical Consents	emerald (primary brand)	Healthcare/trust. Primary product → primary color.
Data Processing	cyan (accent)	Cyan reads as "data/technical/information" across UX conventions.
Cookie Consents	lime (secondary brand)	Web/marketing/conversion energy. Signals "secondary" in hierarchy.
This is the canonical mapping for any consent-domain UI in this app. Don't re-pick colors per page.

Rule 3 — Encode independent axes on independent visual channels.
When a row needs to convey both category AND state (e.g. the activity stream), give each axis its own channel:

Category → left border (4px solid, category color) + icon tile tint
State → right-aligned pill, with time stacked vertically above it (flex flex-col items-end gap-1)
This enables two-mode scanning: horizontal by category, vertical by state.

Container shape for lists of these rows: one outer rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] shadow-sm overflow-hidden wrapper. Rows sit flush inside it (no gap, no per-row shadow, no per-row rounded corners). Use border-b border-[var(--color-border-default)] on every row except the last for a thin 1px divider. The colored left stripe is the only category-coded edge per row; overflow-hidden on the wrapper clips it cleanly at the rounded corners.

Do not stack rows as separate cards with gaps — that pattern was deliberately replaced with the flush table in /dashboard-alt02. Reserve card-with-gap layouts for grids of summary metrics (e.g. CuiMetricCardComponent), not lists of homogeneous items.

Rule 4 — Page chrome stays neutral.
Token	Use
--color-bg-page	Page background
--color-bg-surface	Card / table container background
--color-bg-subtle	Banner / inline-note background
--color-border-default	All chrome borders (outer container, row divider)
--color-text-primary	Titles, hero values, primary labels
--color-text-muted	Secondary descriptions, stat labels
--color-text-faint	Timestamps, the quietest metadata
Color is reserved for meaning, not decoration. Never use brand color as a page-level wash, and don't reach for arbitrary greys — pick the right --color-text-* rung for the information's importance.

Rule 5 — Brand color tints need different mix percentages.
Equal hex isn't equal lightness — emerald, cyan, and lime read at different weights at the same alpha. The canonical CATEGORY_PALETTE on /dashboard-alt02 uses these mix percentages to make all three brands feel visually equal:

Brand	Icon tile / pill bg	Notes
emerald	color-mix(in srgb, var(--color-emerald-500) 12%, transparent)	Densest pigment; needs the least mix.
cyan	color-mix(in srgb, var(--color-cyan-500) 14%, transparent)	Slightly lighter pigment than emerald.
lime	color-mix(in srgb, var(--color-lime-500) 18%, transparent) (icon) / 20% (pill)	Yellowest brand; needs the most mix to register.
When introducing a new product brand mapping, copy this shape (icon tile tint, pill bg tint, both at the same percentage; pill text uses the *-700 rung; the 4px stripe uses the *-500 or *-600 rung for emerald/cyan/lime respectively).

Rule 6 — The CATEGORY_PALETTE contract.
Every brand-coded section should derive its colors from a single palette constant with this five-token shape per category:

{
  border:    'var(--color-{brand}-{500|600})',                                  // 4px left stripe
  iconBg:    'color-mix(in srgb, var(--color-{brand}-500) {mix}%, transparent)', // icon tile bg
  iconColor: 'var(--color-{brand}-{500|600|700})',                              // icon glyph
  pillBg:    'color-mix(in srgb, var(--color-{brand}-500) {mix}%, transparent)', // status pill bg
  pillText:  'var(--color-{brand}-700)',                                        // status pill text
}
Never inline these mix expressions in templates. Centralize them in a CATEGORY_PALETTE constant at the top of the component (or a shared module if the palette is shared) — paletteFor(category) is the single accessor pages should use.

Rule 7 — CuiBadgeVariant is missing cyan (but has info).
The library's CuiBadgeVariant is 'emerald' | 'lime' | 'success' | 'warning' | 'error' | 'info' | 'neutral'. info is the semantic blue state color (wired to --color-info-*) — use it for states like "Submitted / Sent / In Progress", per Rule 1's brand-vs-semantic split. It is not a substitute for brand cyan. If you need a cyan-themed identity pill (e.g. to match a data-processing card), build a small inline pill using the CATEGORY_PALETTE tokens defined in Rule 6 — do not fake it with neutral or info.

Rule 8 — Tailwind v4 tree-shakes unused @theme tokens.
@certinal/ui's tokens.css puts --color-bg-surface, --color-border-default, shadow tokens, etc. inside Tailwind v4's @theme {} block. Tailwind v4 only emits these as CSS variables when a Tailwind utility references them. Library components reference them via raw CSS (not utilities), so they get stripped.

Fix: declare the critical non-Tailwind-referenced tokens in a :root {} override inside src/styles.scss. The override block already exists there — extend it when adding new Cui consumers.

Reference implementations
src/app/features/dashboard/components/dashboard-alt02.component.ts — the canonical page. CATEGORY_PALETTE constant (lines ~49–75) is the single source of truth for product→color mapping. The Activity Stream block (lines ~121–162) is the canonical flush-table pattern from Rule 3. The coverage cards (lines ~104–118) are the canonical across-products KPI row.
src/app/features/dpdp/components/purpose-registry-alt01.component.ts — canonical within-product 4-card KPI row (Rule 1a). KPI cards rotate cyan → emerald → lime → emerald-bright, anchored on the cyan brand for DPDP. Header icon tile, CPs pill, and palette constant follow Rules 2, 5, 6.
src/app/features/dpdp/components/transactions.component.ts — canonical within-product 6-card legibility-first variant (Rule 1a). KPI cards rotate emerald → emerald-dark → lime-dark × 2 — three WCAG-AA-legible tones, no cyan/blue, no -bright shades. Max 4 columns per row (grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4) wraps as 4 + 2 at xl widths. Currently hidden from nav while design iteration continues; route remains accessible via direct URL.
src/styles.scss — Tailwind tree-shake fix (Rule 8), plus the six brand-family wrapper classes used by Rule 1a recipes: .metric-card-emerald-bright / .metric-card-cyan-bright / .metric-card-lime-bright (the standard 4-card and 6-card recipes) and .metric-card-emerald-dark / .metric-card-lime-dark (the legibility-first variant). The -bright -400 shades fail WCAG AA for value text; use -dark -700 shades on legibility-critical pages.