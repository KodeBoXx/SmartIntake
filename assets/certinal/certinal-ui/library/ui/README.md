# Certinal UI

A standalone-component design system for the Certinal product family, built on Angular 20 and Tailwind CSS 4. Lives in this repo as a library project (`projects/certinal/ui`) with a co-located playground app (`src/app`) for demoing and reviewing components.

## Versions

| Layer | Version | Notes |
|---|---|---|
| Node.js | **22.12.0** | Volta-pinned in `package.json` — switches automatically inside this project |
| Angular | **20.3.19** | Standalone components, signals, new control flow (`@if`/`@for`) |
| Angular CLI | 20.3.25 | |
| TypeScript | 5.9.3 | `moduleResolution: "bundler"` |
| Tailwind CSS | **4.2.2** | Oxide engine, `.postcssrc.json`-wired |
| Lucide Angular | 0.575.0 | Icon set used by `cui-icon` |
| ng-packagr | 20.3.2 | Builds the publishable library bundle |

The library exports **66 building blocks** organised in tiers:

- **42 primitives** — `cui-button`, `cui-input`, `cui-badge`, `cui-avatar`, `cui-card-*`, `cui-modal-*`, plus the date/time subsystem (`cui-calendar`, `cui-date-picker`, `cui-date-range-picker`, `cui-date-time-picker`, `cui-time-picker`, `cui-month-picker`, `cui-year-picker`, `cui-time-column`).
- **22 blocks** — `cui-header`, `cui-modal`, `cui-drawer`, `cui-data-table`, `cui-toast`, `cui-popover`, etc.
- **1 section** — `cui-confirm-dialog`
- **1 layout** — `cui-app-shell`

## How to use it

### 1. Install (after publish)

```bash
npm install @certinal/ui lucide-angular
```

(Inside this repo it's already linked via the `@certinal/ui` workspace project — no install needed.)

### 2. Import the global styles **once** at the app root

In `src/styles.css`:

```css
@import '@certinal/ui/styles/tokens.css';      /* design tokens */
@import '@certinal/ui/styles/typography.css';  /* type scale + fonts */
@import 'tailwindcss';                          /* Tailwind v4 */
```

Without these globals, Tailwind utilities like `bg-emerald-500`, `text-text-primary`, and `text-t-300` (which read CSS custom properties) won't resolve to the Certinal palette / type scale.

### 3. Use components as standalone imports

```ts
import { Component } from '@angular/core';
import { CuiButtonComponent, CuiCardComponent, CuiCardTitleComponent } from '@certinal/ui';

@Component({
  selector: 'app-example',
  standalone: true,
  imports: [CuiButtonComponent, CuiCardComponent, CuiCardTitleComponent],
  template: `
    <cui-card variant="elevated" pad="md">
      <cui-card-title size="md">Hello</cui-card-title>
      <cui-button variant="primary" (click)="save()">Save</cui-button>
    </cui-card>
  `,
})
export class ExampleComponent { save() { /* ... */ } }
```

### 4. Build, run, ship

| Task | Command |
|---|---|
| Run the playground | `npm start` → http://localhost:4200/ |
| Build the library | `npx ng build @certinal/ui` → `dist/certinal/ui` |
| Build the playground | `npx ng build` → `dist/certinal-ui` |
| Type-check everything | `npx tsc --noEmit` |
| Run unit tests | `npx ng test` |

---

## Styling — Global CSS vs Component CSS

The library uses **two layers of CSS deliberately**, and each layer answers a different question.

### Global CSS — *"What is true everywhere?"*

Lives in `projects/certinal/ui/src/styles/`:

| File | Contents | Why global |
|---|---|---|
| `tokens.css` | All design tokens as CSS custom properties: `--color-emerald-500`, `--color-text-primary`, `--color-bg-surface`, `--spacing-4`, `--radius-2xl`, `--shadow-md`, `--dur-fast`, `--ease-out`, `--font-body`, `--font-display`, `--text-t-100…600`, etc. | A token must mean the same thing in every component — "emerald-500" cannot be redefined per file. Tokens are also consumed by Tailwind utilities (`bg-emerald-500`, `text-t-300`), so they need to exist before any utility runs. |
| `typography.css` | Type scale utilities (`type-h1`, `type-h2`, `type-button`, `type-caption`, `type-code-sm`), font-face declarations, base body defaults | The type scale is a single source of truth used by hundreds of templates. Defining it once globally avoids duplication and drift. |
| Host app `src/styles.css` | Imports the above + Tailwind preflight + Tailwind utility generation | Tailwind preflight resets element defaults across the whole document — that's a global concern by definition. |

**Rule of thumb:** if changing the value should change *every* component that uses it, it belongs in global CSS.

### Component CSS — *"What only this component should know?"*

Angular wraps every `*.component.css` in **view encapsulation** (default: `Emulated`), which scopes selectors so they cannot leak out of the component's DOM. This is powerful but also expensive in terms of fragmentation, so we use it **only when one of these four conditions applies**:

| Justification | Example |
|---|---|
| **`@keyframes`** | `cui-spin` in `button.component.css`, `cui-modal-fade-in/scale-in` in `modal.component.css`, `cui-drawer-slide` in `drawer.component.css`. Global keyframe names can collide; scoping them prevents that. |
| **Multi-class `:host()` variant systems** | `card.component.css` uses `:host(.cui-card--elevated)`, `:host(.cui-card--feature)`, `:host(.cui-card--dark)`, `:host(.cui-card--pad-sm)`, etc. `:host()` only works inside the component file. |
| **Host CSS variables consumed by children** | The card sets `--cui-card-icon-bg`, `--cui-card-title-color`, `--cui-card-body-color` on `:host` per variant. `card-icon`, `card-title`, `card-body` read those vars — variant theming cascades automatically. |
| **Native browser pseudo-elements** | `input.component.css` styles `::-webkit-calendar-picker-indicator`, `::-webkit-search-cancel-button`, number-spinner buttons. Tailwind cannot target these directly. |

If a component doesn't match one of these four conditions, **it should not have a `.css` file at all** — its styling is expressed in Tailwind utility classes in the template (or in `@HostBinding('class')` / the component decorator's `host` block).

### What this looks like in practice

After the recent cleanup, the library has roughly:

- **49 components with no `.css` file** — pure Tailwind in templates.
- **17 components with a `.css` file** — each justified by one of the four rules above.

This split keeps style logic discoverable: when reading a component, you know that *if* a `.css` file exists, it's there for a specific reason — not as a default catch-all.

### Why not "Tailwind only" (no component CSS)?

Removing component CSS entirely would force every animation, every variant system, and every native-widget override into the global namespace. You would lose Angular's isolation guarantees, gain specificity wars, and break refactoring (you can't tell which selectors a component depends on anymore). The four-rule discipline preserves the benefits of utility-first styling **and** the safety net of view encapsulation where it actually pays for itself.
