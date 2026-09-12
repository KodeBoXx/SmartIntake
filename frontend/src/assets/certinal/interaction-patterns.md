Interaction Patterns
Canonical rules for which container to use when displaying or editing information in the certinal-admin-angular app. Companion to design-color-logic.md.

1. The single principle
Predictability beats per-case optimisation.

This is enterprise compliance software, not a productivity tool. Users here are operators — they review consents, audit records, manage registries. They are not exploring. They are not editing all day. They want their hands to move the same way every time.

Therefore the model below is stated as rules, not heuristics. There are no "use a drawer if the form is short, use a page if it's long" judgement calls. The user clicks View, a drawer opens. The user clicks Edit, a page loads. Every time. Every module. Forever.

This is the only way a 7-module compliance product feels coherent.

2. The four rules
User action	Container	Rule
View a record's details	Right drawer (CuiDrawerComponent, size lg, 600px)	Every "view details" in every module opens the right drawer. No exceptions.
Edit or create a record	Dedicated page (Angular route)	Every edit and create is a deep-linkable URL. No exceptions.
Delete / archive / revoke	Confirm dialog (CuiConfirmService, tone danger)	Every destructive action goes through confirm.
Quick action (set status, assign, change priority, single-field mutation)	Dropdown / popover / inline control	Attached to the trigger. No overlay.
That's it. There are no other interaction containers.

The right side of the viewport is reserved. The only surface that ever appears on the right is the View drawer (rule 1 above). On an edit or create page (rule 2), the right side is empty — no context sidebar, no quick-info rail, no version-history aside, no help panel. The form spans the full content width. Secondary context that might feel like it belongs in a right sidebar (version history, help text, quick metadata) goes inline inside the form instead — see §6 for the canonical placements. This is non-negotiable: a persistent right-side panel on an edit page makes the page read as "view + edit at the same time," which is exactly the modal/drawer-with-edit pattern §4 deletes.

2a. Drawer entry animation — slide from right.
The View drawer enters with a slide-from-right animation, not the Cui library default (which is a scale-up + fade). The drawer panel begins fully off-canvas to the right and translates into position; the dimmed overlay fades in independently. Both motions complete together in ~240ms.

Why slide-from-right, not scale-up: scale animates the drawer from inside its final position, which makes it read like a modal popping open. Slide reads like a panel arriving — it matches the metaphor that the drawer "comes in from the side" and "preserves list context," which is the entire reason §2 chose drawer over modal for View. The motion direction also gives the user a clear cue that swiping right would close it (even though we use click/Esc, the direction is the same affordance the user already knows from iOS / native side-sheets).

Implementation lives in src/styles.scss:

@keyframes cui-drawer-slide-from-right {
  0%   { transform: translateX(100%); opacity: 0; }
  100% { transform: translateX(0);    opacity: 1; }
}

.animate-cui-drawer-in.right-0 {
  animation: cui-drawer-slide-from-right
             var(--dur-base, 0.24s)
             var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

@media (prefers-reduced-motion: reduce) {
  .animate-cui-drawer-in.right-0 { animation: none; }
}
Selector specificity — the override targets .animate-cui-drawer-in.right-0 (two classes), beating the library's single-class .animate-cui-drawer-in rule. The .right-0 part comes from CuiDrawerComponent's panelClasses() computed function and is set only when position === 'right'. Since every drawer in this app is right-positioned (§2 rule 1), this is the right scope: targets every drawer without affecting any code path that doesn't apply here.

Easing — cubic-bezier(0.16, 1, 0.3, 1) (soft-out curve) decelerates smoothly into the resting position rather than stopping abruptly. Don't use a linear or "ease-in" curve — the drawer will feel like it slams into place.

Reduced motion — the explicit @media (prefers-reduced-motion: reduce) block disables the slide entirely. The drawer appears instantly, the overlay still fades (the library's overlay animation has its own reduced-motion rule). Don't try to "soften" the animation for reduced-motion users — they've asked for no animation, not gentler animation.

Exit animation — known limitation. CuiDrawerComponent uses @if (open()) to mount/unmount the panel, which removes the DOM node instantly on close. There is no slide-OUT animation; the drawer disappears immediately. Adding one requires deferring DOM removal until after a CSS transition, which is a library-level change, not a styles override. Acceptable for now since the entry animation carries the bulk of the perceived smoothness; revisit if the snap-on-close becomes a usability complaint.

Don't replace this with a per-page override. The animation belongs to the drawer pattern, not to any single page. Every drawer in every module gets the same slide. If you find yourself adding a wrapper class to scope a different animation to one page, you've contradicted §2's "every view details opens the same right drawer" rule — fix the requirement, not the animation.

2b. Drawer footer button standards
The View drawer's sticky footer (the [cuiDrawerFooter] slot — see packages/ui/src/lib/blocks/drawer/drawer.component.html) is the canonical action surface for the drawer. Buttons inside it must follow these three rules. Every drawer in every module obeys them; no per-page deviation.

Rule 1 — Right-aligned, uniform spacing.
The [cuiDrawerFooter] container is always class="flex justify-end gap-3 flex-wrap". No justify-between, no flex-1 spacers pushing buttons apart, no gap-2 / gap-4 deviations. Buttons flow right-to-left in DOM order, meaning the rightmost button is the most prominent action (e.g. Edit / Publish / Confirm Verification). This matches the reading-gravity rule used across the rest of the app and lets a returning user scan the footer at-a-glance from the right edge.

<div cuiDrawerFooter class="flex justify-end gap-3 flex-wrap">
  <!-- Cancel-like (dismiss) goes first → ends up on the LEFT of the row -->
  <!-- Destructive in the middle -->
  <!-- Primary CTA last → ends up on the RIGHT, eye lands there -->
</div>
Don't move primary actions to the left — justify-end + DOM order is how the convention reads. Don't combine with justify-between to push a "Cancel" pill to the far left; that breaks the reading-gravity. Use a single right-aligned cluster.

Rule 2 — Cancel / Close is variant="tertiary".
Any dismissal action — labeled "Cancel," "Close," "Dismiss," "Back," or similar — uses variant="tertiary". Never secondary, never secondary02. Reason: tertiary is the ghost/text-style variant; it visually recedes below the primary action it sits next to. Putting dismiss on a heavier variant (secondary or above) equalizes its visual weight with the primary CTA, which is exactly the failure mode that makes users hesitate at the footer.

<cui-button variant="tertiary" size="md" (buttonClick)="closeDetails()">
  <span class="flex items-center gap-1.5"><cui-icon name="close" size="sm" /> Close</span>
</cui-button>
Cancel/Close still carries an icon per Rule 3 below — close is the canonical icon for both labels.

Rule 3 — Every button has a <cui-icon> paired with its label.
Every button inside [cuiDrawerFooter] uses <cui-button> (never a raw <button>, never <cui-icon-button> here — icon-only buttons don't belong in a drawer footer; they belong in card chrome or table rows). Every button carries an icon adjacent to its label inside a <span class="flex items-center gap-1.5"> wrapper. The icon is <cui-icon size="sm"> regardless of button size; the label sits to the right of it.

<cui-button variant="primary" size="md" (buttonClick)="publish()">
  <span class="flex items-center gap-1.5"><cui-icon name="send" size="sm" /> Publish</span>
</cui-button>
Why mandatory icons (even for Cancel, which would normally be text-only per §2b Rule 2 reasoning in cui-migration-playbook.md): in the drawer footer specifically, the buttons are clustered tightly against each other. Without icons, the eye can't differentiate Cancel from Edit from Archive at a glance — they all read as a wall of pill-shaped text. Icons act as a glyph index that lets the user pick the action without reading every word. This is a drawer-specific exception to the broader "Cancel is text-only" convention used in form footers (see §7c Rule 10 — that's a different surface with different visual density).

Variant + icon mapping
The standard mapping for drawer-footer actions:

Intent	variant	Typical icon	Examples
Primary forward action (Edit, Publish, Submit, Confirm, Start)	primary	pencil, send, shield, check-circle	Edit, Publish, Start Verification, Confirm Verification, Approve, Complete
Secondary action (Copy, Duplicate, Export, Get Script)	secondary	link, download	Copy Code, Get Script, Export
Destructive (Archive, Delete, Reject, Fail)	danger	trash-2, inbox, close	Archive, Delete, Reject, Fail Verification
Dismiss (Cancel, Close, Back)	tertiary	close	Cancel, Close, Dismiss
If an action doesn't map to one of these intents, don't invent a new variant — surface the question and add a row before merging.

What gets enforced
✅ [cuiDrawerFooter] container class is exactly flex justify-end gap-3 flex-wrap.
✅ Every direct child of [cuiDrawerFooter] is a <cui-button> (or an Angular control-flow block wrapping one, e.g. @if).
✅ Every <cui-button> contains a <span class="flex items-center gap-1.5"><cui-icon ... /> Label</span> body.
✅ Cancel / Close / Dismiss labels use variant="tertiary".
❌ No <button> / raw HTML inside [cuiDrawerFooter].
❌ No <div class="flex-1"></div> spacers inside [cuiDrawerFooter].
❌ No <cui-icon-button> inside [cuiDrawerFooter] (icon-only doesn't fit the action-surface role).
❌ No text-only <cui-button> (every footer button has an icon).
Reference implementations
src/app/features/consent-rights/components/access-requests-01.component.ts — status-aware verification footer (multi-stage, 9 button states across 4 @if branches). Canonical example of the variant mapping above (primary/danger/primary) in action.
src/app/features/consent-map/components/asset-registry-alt01.component.ts — concise three-button footer (Edit / Archive / Close), demonstrates the Cancel-as-tertiary rule (Rule 2) and the right-to-left reading order.
src/app/features/dpdp/components/collection-points-alt01.component.ts — has TWO drawers; the Details drawer demonstrates the standard, the Preview drawer demonstrates the same standard applied to user-facing consent buttons (Reject All / Accept Selected / Accept All all carry icons).
Migration log
Append rows here when sweeps complete, so future agents know what's done.

Date	Sweep	Files affected	Notes
2026-05-25	Drawer footer right-alignment + cui-button conversion	19 files / 19 drawer footers (12 raw → cui-button, 7 alignment-only)	Pre-§2b sweep — established the right-alignment + variant mapping. Cancel-as-tertiary and mandatory-icon rules added retroactively in this section. One drawer not in this sweep: the second drawer in collection-points-alt01.component.ts (Preview drawer) was missed because the sweep counted one cuiDrawerFooter per file. Fixed separately — see next row.
2026-05-25	Preview-drawer alignment retrofit (the one drawer missed in row 1)	1 file / 1 drawer footer	collection-points-alt01.component.ts Preview drawer — container class changed from flex gap-2 flex-wrap to flex justify-end gap-3 flex-wrap to bring it inline with the Details drawer in the same file. Buttons (Reject All / Accept Selected / Accept All) still icon-less at this point — icons added in the next row.
2026-05-25	§2b Rule 2 + Rule 3 sweep — Cancel-as-tertiary verification + mandatory icons	5 files / 5 drawer footers	Added close icon to 4 Close buttons (already tertiary): asset-registry-alt01, data-element-registry-alt01, data-subject-type-manager-alt01, access-requests-alt01. Added close/check/check-circle icons to the 3 consent-form preview buttons (Reject All / Accept Selected / Accept All) in collection-points-alt01's Preview drawer. All 20 drawer footers across all 19 files now fully compliant with §2b.
3. Universal affordances
These are not "containers" — every app has them and they don't add cognitive load. They are mandatory wherever applicable:

Toast (CuiToastService) — post-action feedback ("Asset saved", "Request rejected"). Non-blocking. Auto-dismisses.
Inline alert (CuiAlertComponent) — validation errors and soft warnings, inside the form or list, never as an overlay.
4. What dies in this model
Things the audit found in the current app that must not exist going forward:

❌ Generic modals for "view details" — use the drawer.
❌ Generic modals for "edit a record" — use a page.
❌ Tabbed modals doing read+write in the same surface (e.g. current Purpose Registry).
❌ Modal whose primary CTA is "Edit" that then navigates to a page (two-hop friction).
❌ "Are you sure you want to save" modals — just save and toast.
❌ Stacked overlays (modal-on-modal, drawer-on-modal).
❌ Custom inline modal HTML per feature (fixed inset-0 bg-black/30 blocks). Use the Cui components.
❌ "View opens drawer, Edit opens a different drawer" — Edit is always a page.
❌ "Edit happens inline inside the drawer" — Edit is always a page.
❌ Persistent right-side context sidebar on an edit/create page (Quick Info rail, Help panel, Version History aside). Inline those sections inside the form instead. The right side is reserved for the View drawer only.
5. Why this specific model
Question	Answer
Why drawer for view?	Preserves list context. User keeps the underlying registry visible. Slides in, slides out. Deep-linkable via ?details=:id.
Why page for edit (always)?	Edits in compliance software are deliberate, often audited. Pages are deep-linkable (share with a colleague during review). Pages have room for validation, draft state, "are you sure you want to leave" guards. Page = "I'm in edit mode" is unambiguous.
Why not inline edit in the drawer?	That's the Linear/Notion model — designed for users who edit constantly. Operators here edit rarely and deliberately. Inline edit forces the user to recognise mode switches; "click Edit → land on page" doesn't.
Why confirm separate from modal?	Confirms have a distinct safety job: small, focused, two buttons, no casual-clickaway in danger mode. Visually identical to "view a record" would be dangerous.
Why popovers for quick actions instead of small modals?	A single-value mutation (set status, assign owner) doesn't need an overlay. A dropdown attached to the cell is faster, lighter, and doesn't dim the page.
Why no "small modal" category at all?	Every interaction that seems like it wants a small modal is actually one of: a confirm (destructive), a popover (quick mutation), or a page (anything else). Removing the modal category eliminates the largest source of inconsistency.
Why no right context sidebar on edit pages?	The right side of the viewport is a single, reserved channel — it means "view this record." A right sidebar on an edit page mixes view and edit on one surface, which is the exact pattern §4 deletes. It also forces a two-column form layout that breaks down on tablets and narrow viewports (see §7c Rule 4 — paired form sections via pointer:fine). Inline the secondary content (version history, help, quick metadata) inside the form section it relates to — the form scrolls, the page stays a page, the right side stays exclusively the drawer's domain.
6. Canonical intent → container mapping
This table is the answer to every "what should I use for X?" question:

User intent	Container
See an entity's full details	Right drawer (lg)
Edit an entity (any complexity)	Page (/:module/:resource/edit/:id)
Create a new entity	Page (/:module/:resource/new)
Delete / archive / revoke	Confirm dialog (danger tone)
Bulk action on selected rows	Page if it commits multiple changes; confirm if it's destructive
Set status / assign owner / change priority	Dropdown or popover attached to the cell or row
Filter / sort / column controls	Dropdown or popover attached to the control
Post-action feedback (saved, sent, deleted)	Toast (success / info / warning / error)
Validation error inside a form	Inline alert (lives with the data)
Multi-step workflow (e.g. onboarding)	Page + CuiStepperComponent
Nested record (sub-table inside an entity)	Inline section on the edit page. Never an overlay.
Secondary context on an edit page (version history, help text, quick metadata, "last updated by", related records)	Inline section inside the form, in the natural reading order. Version history at the bottom of the form, help as inline hints under the field, "last updated by" in the page-header subtitle row. NEVER a persistent right-side sidebar — the right side is reserved for the View drawer.
Right-side surface on an edit/create page	None. The form spans the full content width. If you find yourself wanting a right panel, you actually want either (a) an inline section in the form, or (b) the View drawer on the list page that links here.
7. Component cheat-sheet (Cui APIs)
// VIEW — drawer (slide-from-right animation per §2a; size="lg" = 600px per §2)
<cui-drawer [(open)]="drawerOpen" position="right" size="lg">
  <!-- entity details (read-only or with light controls) -->
</cui-drawer>

// EDIT / CREATE — just navigate
this.router.navigate(['/dpdp/collection/edit', id]);

// DESTRUCTIVE CONFIRM
this.confirm.show({
  title: 'Archive asset?',
  message: 'This will hide it from the registry. You can restore it later.',
  confirmText: 'Archive',
  tone: 'danger',
}).subscribe(ok => { if (ok) { /* ... */ } });

// QUICK ACTION — dropdown attached to a cell or row
<cui-dropdown [items]="rowActions" placement="bottom-end" (itemClick)="onAction($event)" />

// POST-ACTION FEEDBACK
this.toast.success({ message: 'Asset saved.' });

// VALIDATION ERROR
<cui-alert variant="error" title="Cannot save">
  Purpose name is required.
</cui-alert>

// TEXT INPUT / NUMBER / EMAIL / PASSWORD / DATE — always cui-input
<cui-input label="X" placeholder="…" required="true" [(ngModel)]="form.x" />

// TEXTAREA — cui-input with type="textarea"
<cui-input type="textarea" [rows]="4" [(ngModel)]="form.desc" />

// SELECT — cui-select with options array on the class
readonly statusOptions: CuiSelectOption[] = [
  { value: '', label: 'All Status' },
  { value: 'active', label: 'Active' },
];
<cui-select [options]="statusOptions" [(ngModel)]="filterStatus" />

// SEARCH BAR (with leading icon) — cui-search-bar
<cui-search-bar [(value)]="searchProxy" placeholder="Search…" />
7a. Form control standards
These supersede any raw <input>, <textarea>, or <select> markup in the app.

Use case	Component	Notes
Text / number / email / password / search / tel / url / date / datetime	CuiInputComponent	Set type prop; pass [min]/[max]/[step] for number; pass autocomplete for auth forms
Multi-line text	CuiInputComponent with type="textarea" and [rows]="N"	Same component, different type
Dropdown choice list	CuiSelectComponent with [options]="xxxOptions"	Options live as a class field of type CuiSelectOption[]. Use computed() when options derive from a signal.
Search input with a leading icon	CuiSearchBarComponent	Has the icon built-in. Two-way binds via model() — use a getter/setter proxy on the class if the source is a signal: get searchTermProxy() { return this.signal(); }
Checkbox / radio / file / color	Keep raw <input>	Out of scope for this standard; Cui has CuiCheckboxComponent and CuiRadioComponent but they require a separate migration pass with different ergonomics.
Why this matters: Before the standard, the app had 33 files containing 171 raw <input>/<select> elements, all styled inline with subtle differences. Field height, focus ring, error rendering, label typography all drifted per page. The Cui components enforce one visual language across every form and filter row.

Migration pattern (filter row): 1. Replace <input> with leading search icon → <cui-search-bar>. 2. Replace each <select><option>...</option></select> → <cui-select [options]="xxxOptions">. Move the <option> list to a readonly xxxOptions: CuiSelectOption[] field on the class. 3. Add CuiSearchBarComponent, CuiSelectComponent to the component's imports.

Migration pattern (form): 1. Replace each <input type="..."> → <cui-input type="..." [label]="..." [placeholder]="..." required="true">. Move the label from a separate <label> element into the label prop. Drop the inline * asterisk for required — required="true" renders it. 2. Replace each <textarea> → <cui-input type="textarea" [rows]="N">. 3. Replace each <select> → <cui-select> with options array on the class. 4. Add CuiInputComponent, CuiSelectComponent to imports.

7b. Main-page (list / registry / dashboard) conventions
Rules for the OUTER LAYOUT of a main-page component — list, registry, and dashboard routes. A "main page" is a route the user reaches from the sidebar or a top-level link, and it's where the user starts a workflow (browsing records, viewing summary cards, etc.). Sub-pages reached from a main page (edit, create) use a different set of rules — see §7c.

Main-page vs sub-page at a glance
Concern	Main page (§7b)	Sub-page (§7c)
Example URLs	/dpdp/collection, /dpdp/purposes, /dashboard-alt02, /consent-rights/users	/dpdp/collection/edit/cp_1, /dpdp/collection/new, /dpdp/purposes/edit/pur_1
Outer wrapper	<div class="max-w-6xl">	plain <div> (no max-w — cui-app-shell content area provides 1200px)
Header anatomy	breadcrumb + optional icon tile + title + subtitle + right-side action buttons (Export / Reset / Add)	breadcrumb + back-arrow + H1 inline (no icon tile) + status subtitle. Right-side header buttons are forbidden by Rule §7c/2 unless the entity has lifecycle/state actions (§7c/2a exception).
Section spacing	mb-6 between sibling sections	parent gap-5 (work area is flex flex-col gap-5)
Sticky footer	None — list pages don't have a save flow	Required (§7c/10). position: fixed + left: var(--sidebar-w, 0px) per §7d/9.
Canonical reference file	purpose-registry-alt01.component.ts (URL /dpdp/purposes)	purpose-edit-alt01.component.ts (URL /dpdp/purposes/edit/pur_1)
When adding a new route, decide which class it falls into FIRST (main page or sub-page), then follow only the matching section.

The page lives inside its parent route's layout. The route shell (§7d) already supplies the page background, the max-width container, and the outer left/right/top padding. The main-page component must NOT redeclare those.

Rule 1 — One outer wrapper.
<div class="max-w-6xl">
  ...
</div>
That's the entire outer wrapper. Use max-w-7xl / max-w-full only if the design genuinely needs more horizontal space (uncommon).

Do not wrap the template in min-h-screen, bg-[var(--color-bg-page)], bg-[var(--color-bg-surface)], or any horizontal padding (px-8, px-6, etc.). The route layout already provides all of that.

Rule 2 — Section spacing.
Sections inside the page are separated vertically by mb-6. Only mb-6. No pt-* on individual sections, no horizontal padding on individual sections, no per-section background bands.

<div class="max-w-6xl">
  <div class="mb-6">...header...</div>
  <div class="grid grid-cols-4 gap-5 mb-6">...summary cards...</div>
  <div class="grid grid-cols-2 gap-5 mb-6">...two-column section...</div>
  @if (alertCondition) {
    <div class="bg-white rounded-2xl ...">...alert panel...</div>
  }
</div>
Rule 3 — Header anatomy.
The page header is one <div class="mb-6"> with these parts in order:

Breadcrumb (one line): flex items-center gap-2 mb-3, all crumbs text-xs font-medium. Chevron is <lucide-icon name="chevron-right" [size]="12"> with the faint color. The mb-3 gives the title row enough breathing room from the breadcrumb (don't tighten to mb-1 — it reads as cramped).
Prior crumbs are clickable links — <a [routerLink]="['/section/landing']" class="text-xs font-medium hover:underline cursor-pointer" style="color: var(--color-text-faint)">…</a>. Use Angular's RouterLink directive (import from @angular/router and add RouterLink to the component's imports: [...]) so native browser link affordances work (cmd-click new tab, right-click copy link).
Current crumb is static text — <span class="text-xs font-medium" style="color: var(--color-text-primary)">…</span>. No hover, no cursor, no anchor.
Shape by page kind:
Module-dashboard / top-level page → 2 crumbs (<Module> › <Page Name>).
Module list / detail page → 2 crumbs (<Module> › <Page Name>).
Edit / Create / sub-page → 3 crumbs (<Module> › <Parent Page> › <Edit Page>). Middle crumb links to the parent list page.
Module → landing-URL mapping (where each module crumb routes to):
Consent Rights → /consent-rights/dashboard
Consent Map → /consent-map/dashboard
Consent Govern → /consent-govern/dashboard
ConsentFlow → / (the root dashboard). The pages under /dpdp/* and /cookies/* all live under the ConsentFlow umbrella per sidebar.ts CONSENT_FLOW_TOP_ITEM; their module crumb is literally ConsentFlow, NOT DPDP or Cookies.
Settings → /settings
Module-dashboard exception — On a page whose own URL equals the module-crumb's destination (the three module dashboards /consent-rights/dashboard, /consent-govern/dashboard, /consent-map/dashboard), the prior crumb would link to the same page the user is already on. There is nothing to click. Render BOTH crumbs as <span> in this case — keep the crumb pair for orientation, but drop the anchor + hover styling on the prior crumb. Only applies when the prior crumb's destination equals the current URL.
Icon tile (recommended): a 40×40 rounded tile sitting to the left of the title+subtitle block, top-aligned with the H1 (use items-start, NOT items-center — items-center makes the tile float oddly against a 2-line title block). Default behavior:
Module dashboards (/consent-rights/dashboard, /consent-govern/dashboard, /consent-map/dashboard) — always include the icon tile. It is the dashboard's primary visual anchor; omitting it leaves the H1 sitting cold against the page edge.
Registry / inventory pages — include.
Simple list pages with no strong identity — optional; omit only when the page genuinely has nothing to anchor (rare; default to include).
Styling is fixed: - Wrapper: class="flex items-start gap-3" around the tile + title stack. - Tile: class="w-10 h-10 rounded-lg flex items-center justify-center border border-slate-200 flex-shrink-0" with an inline background-color. - Icon: <lucide-icon [size]="20"> with an inline color. - Tile color follows the module's brand-color anchor (per design-color-logic.md Rule 2): - Consent Rights — emerald default (primary brand). Tile bg: color-mix(in srgb, var(--color-cyan-500) 14%, transparent) is also acceptable on cyan-leaning pages within Consent Rights. - Consent Govern — emerald (primary brand). Tile bg: color-mix(in srgb, var(--color-emerald-500) 12%, transparent), icon: var(--color-emerald-500). - Consent Map — cyan (the ConsentMap module is cyan-anchored per Rule 2). Tile bg: color-mix(in srgb, var(--color-cyan-500) 14%, transparent), icon: var(--color-cyan-700). - ConsentFlow (DPDP / cookies pages) — emerald default unless a specific page argues for a different brand color. - Lucide icon name: pick one that represents the page's subject (e.g. shield-check for the Consent Rights dashboard, map for the Consent Map dashboard, globe for Collection Points, cookie for cookie banners). Single icon, not changed by row state. The icon name must be registered in src/app/icons.ts — unregistered lucide names render as a console error and an empty box. 3. Title: <h1 class="text-2xl font-bold m-0" style="color: var(--color-text-primary)">{{ title }}</h1>. 4. Subtitle (optional): <p class="text-sm mt-1 m-0" style="color: var(--color-text-muted)">{{ subtitle }}</p>. Directly below the title — no ml-[52px] indent. When an icon tile is present, the tile sits beside the title+subtitle block; the subtitle stays directly under the title (not indented under it). 5. Right-side actions (optional): MUST use the cui-button primitive — <cui-button variant="primary" size="md">…</cui-button> for the primary CTA (Add / Create / Refresh), <cui-button variant="secondary" size="md">…</cui-button> for paired actions (Export / Reset). Do NOT hand-roll a <button> with bespoke classes here, even if the page belongs to a non-emerald module — the page's brand-color identity lives in the icon tile, KPI cards, row stripes, and badges; the primary action button stays emerald (the canonical cui-button primary variant) regardless of module accent. This anchors the user's eye to "the brand action." For icon+label content, wrap the icon and text in an inner <span class="flex items-center gap-1.5"><cui-icon name="plus" size="sm" /> Add X</span> so the icon aligns cleanly with the label.

Skeleton — without icon tile (simple list pages, non-dashboard):

<div class="mb-6">
  <div class="flex items-center gap-2 mb-3">
    <a [routerLink]="['/section/landing']" class="text-xs font-medium hover:underline cursor-pointer" style="color: var(--color-text-faint)">{{ parentCrumb }}</a>
    <lucide-icon name="chevron-right" [size]="12" style="color: var(--color-text-faint)" />
    <span class="text-xs font-medium" style="color: var(--color-text-primary)">{{ currentCrumb }}</span>
  </div>
  <div class="flex items-center justify-between gap-4 flex-wrap">
    <div>
      <h1 class="text-2xl font-bold m-0" style="color: var(--color-text-primary)">{{ title }}</h1>
      <p class="text-sm mt-1 m-0" style="color: var(--color-text-muted)">{{ subtitle }}</p>
    </div>
    <!-- Right-side action (cui-button primary; emerald regardless of module) -->
    <cui-button variant="primary" size="md" (buttonClick)="goToCreate()">
      <span class="flex items-center gap-1.5"><cui-icon name="plus" size="sm" /> Add X</span>
    </cui-button>
  </div>
</div>
Skeleton — module-dashboard variant (/consent-rights/dashboard, /consent-govern/dashboard, /consent-map/dashboard): both crumbs are static <span> because the prior crumb's destination equals the current page. Icon tile is mandatory; tint matches the module's brand-color anchor (the example below shows the Consent Govern emerald variant — swap to cyan for Consent Map).

<div class="mb-6">
  <div class="flex items-center gap-2 mb-3">
    <span class="text-xs font-medium" style="color: var(--color-text-faint)">Consent Govern</span>
    <lucide-icon name="chevron-right" [size]="12" style="color: var(--color-text-faint)" />
    <span class="text-xs font-medium" style="color: var(--color-text-primary)">Audit Central Dashboard</span>
  </div>
  <div class="flex items-center justify-between gap-4 flex-wrap">
    <div class="flex items-start gap-3">
      <div
        class="w-10 h-10 rounded-lg flex items-center justify-center border border-slate-200 flex-shrink-0"
        style="background-color: color-mix(in srgb, var(--color-emerald-500) 12%, transparent);"
      >
        <lucide-icon name="shield-check" [size]="20" style="color: var(--color-emerald-500);" />
      </div>
      <div>
        <h1 class="text-2xl font-bold m-0" style="color: var(--color-text-primary)">{{ title }}</h1>
        <p class="text-sm mt-1 m-0" style="color: var(--color-text-muted)">{{ subtitle }}</p>
      </div>
    </div>
    <!-- Optional right-side action (Refresh / Last-updated stamp / etc.) -->
  </div>
</div>
Skeleton — with icon tile (registries with a strong visual identity):

<div class="mb-6">
  <div class="flex items-center gap-2 mb-3">
    <a [routerLink]="['/section/landing']" class="text-xs font-medium hover:underline cursor-pointer" style="color: var(--color-text-faint)">{{ parentCrumb }}</a>
    <lucide-icon name="chevron-right" [size]="12" style="color: var(--color-text-faint)" />
    <span class="text-xs font-medium" style="color: var(--color-text-primary)">{{ currentCrumb }}</span>
  </div>
  <div class="flex items-center justify-between gap-4 flex-wrap">
    <div class="flex items-start gap-3">
      <div
        class="w-10 h-10 rounded-lg flex items-center justify-center border border-slate-200 flex-shrink-0"
        style="background-color: color-mix(in srgb, var(--color-emerald-500) 12%, transparent);"
      >
        <lucide-icon name="globe" [size]="20" style="color: var(--color-emerald-500);" />
      </div>
      <div>
        <h1 class="text-2xl font-bold m-0" style="color: var(--color-text-primary)">{{ title }}</h1>
        <p class="text-sm mt-1 m-0" style="color: var(--color-text-muted)">{{ subtitle }}</p>
      </div>
    </div>
    <!-- Right-side action (cui-button primary; emerald regardless of module) -->
    <cui-button variant="primary" size="md" (buttonClick)="goToCreate()">
      <span class="flex items-center gap-1.5"><cui-icon name="plus" size="sm" /> Add X</span>
    </cui-button>
  </div>
</div>
Canonical examples: - Module dashboards (both-static variant): src/app/features/consent-rights/components/consent-rights-dashboard.component.ts, src/app/features/consent-govern/components/audit-dashboard.component.ts, src/app/features/consent-map/components/consent-map-dashboard-alt01.component.ts. - Linked prior crumb (2-crumb variant): src/app/features/consent-rights/components/user-directory.component.ts. - Linked prior crumb (icon-tile variant): src/app/features/dpdp/components/collection-points-alt01.component.ts.

Rule 4 — No "surface band" around the header.
Do NOT wrap the header in:

<!-- WRONG -->
<div class="bg-[var(--color-bg-surface)] border-b border-[var(--color-border-default)] px-8 pt-4 pb-6">
  ...header...
</div>
That treatment is for app-shell chrome, not for page content. The header lives inline with the rest of the page.

Rule 5 — No alt-variant chips in the breadcrumb.
Do NOT add alt01 / v2 / pilot pills to the breadcrumb. The route URL (/feature-alt01) is the indicator of which variant the user is on. A chip duplicates that signal and clutters the breadcrumb.

Rule 6 — Stats KPI section: inline stat strip on list/registry pages; cui-metric-card only on dashboards.
A main-page's stats row sits directly under the header (mb-5 between the strip and the next section). The visual treatment differs by sub-type:

List / registry main pages (e.g. /dpdp/collection, /dpdp/purposes, /consent-rights/access, /consent-rights/users, /consent-rights/erasure, /consent-rights/portability, /consent-rights/correction, /consent-rights/notifications, /consent-rights/fiduciary-alerts, /consent-rights/sla) → use the inline stat strip.
Dashboard main pages (e.g. /dashboard-alt02, /consent-map/dashboard, /consent-rights/dashboard) → keep the existing <cui-metric-card> grid layout. Dashboards have a larger visual budget for KPIs (sub-stats, value labels, accent variants) and the strip is too dense for them.
The strip is a single rounded container with one cell per stat — column-flex on mobile (horizontal separator between cells) and row-flex with wrap on sm+ (vertical separator between cells). Each cell has a 32px tinted icon tile, a text-xl font-bold value, and a text-[11px] muted label.

<!-- Stats — inline strip pattern (vertical separators on desktop, horizontal on mobile) -->
<div
  class="rounded-xl flex flex-col sm:flex-row sm:flex-wrap items-stretch mb-5 overflow-hidden"
  style="background: var(--color-bg-surface); border: 1px solid var(--color-border-default)"
>
  <!-- Cell 1..N-1: include the responsive border classes -->
  <div class="flex items-center gap-2.5 px-4 py-4 flex-1 min-w-[140px] border-b sm:border-b-0 sm:border-r border-[var(--color-border-default)]">
    <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style="background: {ICON_TILE_BG}">
      <lucide-icon name="{ICON_NAME}" [size]="16" style="color: {ICON_COLOR}" />
    </div>
    <div class="min-w-0 flex flex-col gap-1">
      <div class="text-xl font-bold leading-tight" style="color: var(--color-text-primary)">{{ {VALUE_EXPR} }}</div>
      <div class="text-[11px] leading-tight" style="color: var(--color-text-muted)">{LABEL}</div>
    </div>
  </div>

  <!-- Last cell: drop the border-b sm:border-b-0 sm:border-r classes -->
  <div class="flex items-center gap-2.5 px-4 py-4 flex-1 min-w-[140px]">
    ... (same inner content)
  </div>
</div>
Accent → icon-tile mapping (use these recipes; do not invent new tints):

Accent / wrapper	Icon-tile background	Icon color
cyan	color-mix(in srgb, var(--color-cyan-500) 14%, transparent)	var(--color-cyan-700)
emerald	var(--color-emerald-50)	var(--color-emerald-700)
lime	var(--color-lime-100)	var(--color-lime-700)
success	var(--color-success-light)	var(--color-success-dark)
metric-card-emerald-bright	color-mix(in srgb, var(--color-emerald-400) 18%, transparent)	var(--color-emerald-700)
metric-card-emerald-dark	var(--color-emerald-100)	var(--color-emerald-800)
metric-card-lime-dark	var(--color-lime-200)	var(--color-lime-800)
Migration notes when converting an existing cui-metric-card grid:

Preserve each card's original icon, [value] binding, and title text (the title becomes the cell's label).
Drop valueLabel — the strip has no sub-sub label.
Convert cui-icon names to lucide kebab names. Most map 1:1 except: grid → layout-grid, minus → minus-circle. Only icons registered in src/app/icons.ts will render; substitute the closest registered alternative if the original isn't present.
Remove the now-unused CuiMetricCardComponent from both the from '@certinal/ui' import and the @Component.imports array.
Canonical reference: src/app/features/consent-rights/components/access-requests-01.component.ts — the stats <div> immediately under the page header.

Reference implementations
All alt01 pages now follow this structure:

src/app/features/consent-map/components/consent-map-dashboard-alt01.component.ts
src/app/features/cookies/components/banner-alt01.component.ts
src/app/features/consent-rights/components/access-requests-alt01.component.ts
src/app/features/dpdp/components/collection-points-alt01.component.ts
7c. Sub-page (edit / create) conventions
Rules for /edit/:id and /new sub-page components — form-heavy pages reached from a main page (§7b). A "sub-page" is a route the user enters by clicking a row's "Edit" or a page-header's "Add" button on a main page; its job is to capture or modify one entity, then return the user to the originating main page on Save / Cancel.

Distinguish from main pages (§7b): sub-pages have no icon tile, a back-arrow inline with the H1 (not a separate header element), no right-side header action buttons by default (one exception in Rule 2a), and a mandatory sticky footer (Rule 10) holding the save flow. Main pages have none of those. See the comparison table at the top of §7b for the side-by-side.

Apply on top of §7a (form controls) and §7d (app shell). The canonical reference is src/app/features/dpdp/components/purpose-edit-alt01.component.ts (URL /dpdp/purposes/edit/pur_1). Every rule below is observable in that file. When adding a new sub-page, copy that file as the skeleton — don't invent new conventions.

Reading order top-to-bottom: header → tabs → notices → form sections → inline sub-flows → sticky footer.

Rule 1 — Outer wrapper: a plain <div>, no max-width.
Sub-pages root at a plain <div>. Do NOT add max-w-*, min-h-screen, bg-*, or horizontal padding. The cui-app-shell already constrains the content area to 1200px with 24px desktop / 16px mobile padding (§7d Rule 1); the sub-page lives inside that constraint.

<div>
  <!-- header (Rule 2), work area (Rule 3), sticky footer (Rule 10) -->
</div>
List pages use <div class="max-w-6xl"> per §7b Rule 1 — sub-pages do not.

Rule 2 — Sub-page header: breadcrumb + back-arrow-inline-H1 + status subtitle.
The sub-page header has three rows in order — different from the §7b list-page header (icon-tile + right-side actions). On a sub-page, the back-arrow occupies the icon-tile slot, and all primary actions live in the sticky footer (Rule 10).

Row 1 — Breadcrumb (text-xs font-medium mb-3): - Three crumbs: <Module> › <Parent List Page> › <Edit/Create Leaf>. See §7b Rule 3 Item 1 for the module → landing-URL mapping. - Both parent crumbs are clickable links — <a [routerLink]="['/path']" class="text-xs font-medium hover:underline cursor-pointer" style="color: var(--color-text-faint)">…</a>. The module crumb routes to the module landing URL; the middle crumb routes to the parent list page that the leaf belongs to. Do NOT use (click)="back()" — that costs the user cmd-click / right-click affordances. - Lucide chevron-right separators at size 12 with color: var(--color-text-faint). - Leaf crumb is a static <span class="text-xs font-medium" style="color: var(--color-text-primary)"> — mode-aware: "New X" / "Edit X".

Row 2 — Back arrow + H1 (flex items-center gap-3): - 36×36 (w-9 h-9 rounded-lg) icon button on the LEFT with border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-subtle)], containing a lucide arrow-left at size 18. - H1 immediately to the right: text-2xl font-bold m-0 with color: var(--color-text-primary). Title is mode-aware. - The back arrow navigates explicitly to the list URL (router.navigate(['/module/resource'])), not browser-history back — preserves correct behavior when arriving via deep link or refresh.

Row 3 — Status / context subtitle (mt-1 ml-12 text-sm): - ml-12 offsets the text past the back-arrow column so it aligns under the H1. - In edit mode: <cui-badge dot="true"> for status + font-mono version + entity code + "Last edited by …". - In create mode: a one-line description.

<div class="mb-6">
  <!-- Breadcrumb -->
  <div class="flex items-center gap-2 mb-3">
    <a routerLink="/" class="text-xs font-medium hover:underline cursor-pointer" style="color: var(--color-text-faint)">ConsentFlow</a>
    <lucide-icon name="chevron-right" [size]="12" style="color: var(--color-text-faint)" />
    <a routerLink="/dpdp/purposes" class="text-xs font-medium hover:underline cursor-pointer" style="color: var(--color-text-faint)">Purpose Registry</a>
    <lucide-icon name="chevron-right" [size]="12" style="color: var(--color-text-faint)" />
    <span class="text-xs font-medium" style="color: var(--color-text-primary)">
      {{ mode() === 'create' ? 'New Purpose' : 'Edit Purpose' }}
    </span>
  </div>

  <!-- Title row -->
  <div class="flex items-center gap-3">
    <button type="button"
      class="w-9 h-9 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-muted)] cursor-pointer hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] flex items-center justify-center transition-colors flex-shrink-0"
      (click)="back()"
      aria-label="Back to Purpose Registry"
      title="Back to Purpose Registry">
      <lucide-icon name="arrow-left" [size]="18" />
    </button>
    <h1 class="text-2xl font-bold m-0" style="color: var(--color-text-primary)">
      {{ mode() === 'create' ? 'New Purpose' : 'Edit Purpose' }}
    </h1>
  </div>

  <!-- Status / context subtitle -->
  <div class="flex items-center gap-2 flex-wrap text-sm mt-1 ml-12" style="color: var(--color-text-muted)">
    @if (existing(); as e) {
      <cui-badge [variant]="statusBadgeVariant(e.status)" dot="true">{{ statusLabel(e.status) }}</cui-badge>
      <span class="font-mono">v{{ e.version }}</span>
      <span>·</span>
      <span>{{ e.code }}</span>
    } @else {
      <span>Define a new processing purpose under DPDP compliance.</span>
    }
  </div>
</div>
Forbidden in the sub-page header: icon tile (back-arrow occupies that slot), right-side action buttons for form-save operations (those belong in the sticky footer per Rule 10), alt-variant chips in the breadcrumb (§7b Rule 5 still applies).

Rule 2a — Exception: entity-state actions may sit on the right of the title row.
If the entity has lifecycle / state actions that operate INDEPENDENTLY of the form-save flow — Activate, Deactivate, Archive, Delete, Restore, Publish-without-edits, etc. — they may live in the sub-page header on the right side of the title row, not in the sticky footer.

Why this is allowed:

The sticky footer (Rule 10) holds form-save actions: Cancel, Save Draft, Save / Publish. Its semantics are "commit my pending edits."
Lifecycle actions have different semantics: they act on the entity's current state, often without saving pending edits. Activating a collection point is not the same as "save my changes."
Putting "Save Changes" and "Archive" next to each other in the footer makes them visually identical but semantically opposite, which is a worse design than placing them on different axes (footer = save flow, header = entity state).
When this exception applies: the entity has 2+ status states the user can transition between, AND the transitions don't require a form save. Examples: Collection Points (draft / active / inactive / archived), Vendor approvals, Document publication states. Counter-example: Purposes — the "Publish New Version" action requires editing first, so it correctly lives in the footer as the primary save button.

Title row shape when the exception applies:

<div class="flex items-center justify-between gap-3 flex-wrap">
  <!-- Left: back-arrow + H1 -->
  <div class="flex items-center gap-3">
    <button class="w-9 h-9 rounded-lg border …">
      <lucide-icon name="arrow-left" [size]="18" />
    </button>
    <h1 class="text-2xl font-bold m-0">{{ titleText }}</h1>
  </div>

  <!-- Right: entity-state action buttons (conditional on current status) -->
  <div class="flex items-center gap-2 flex-wrap">
    @if (entity()?.status === 'inactive') {
      <cui-button variant="primary02" size="sm" (buttonClick)="onActivate()">
        <span class="flex items-center gap-1.5"><cui-icon name="…" size="sm" /> Activate</span>
      </cui-button>
    }
    @if (entity()?.status === 'active') {
      <cui-button variant="secondary" size="sm" (buttonClick)="onDeactivate()">Deactivate</cui-button>
    }
    <cui-button variant="secondary" size="sm" (buttonClick)="onArchive()">Archive</cui-button>
  </div>
</div>
Title-row container changes from flex items-center gap-3 (Rule 2 default) → flex items-center justify-between gap-3 flex-wrap.
The right-side group is its own flex container so multiple buttons wrap correctly on narrow viewports.
flex-wrap on the outer ensures the right-side group drops below the title on very narrow widths instead of forcing a horizontal scroll.
Canonical reference: src/app/features/dpdp/components/collection-point-edit-alt01.component.ts (URL /dpdp/collection/edit/cp_1). The purpose-edit page does NOT use this exception — purposes have no state actions outside the save flow.

Rule 3 — Work area: single-column flex flow, pb-32 for the footer.
The work area sits below the header — a single vertical column. No two-column layout at this outer level. Use flex flex-col gap-5 with pb-32 to leave room for the sticky footer:

<div class="flex flex-col gap-5 pb-32">
  <!-- tabs (Rule 5), notices (Rule 7), validation (Rule 7), form sections (Rule 6) -->
</div>
Sections inside are spaced by the parent's gap-5. Do NOT put mb-* on individual sections — the gap is the single source of truth for vertical rhythm.

Rule 4 — Paired form sections: split by pointer type, not viewport width.
When you want two form sections side-by-side on Mac/desktop but stacked on iPad, don't use Tailwind width breakpoints (md:, lg:, xl:, 2xl:). iPad and Mac viewports overlap heavily — iPad Pro 12.9″ landscape is 1366px, which sits in the same range as a 13″ MacBook Air (1280–1440px). No width breakpoint can cleanly separate the two.

Key on the pointer type instead:

<div class="grid grid-cols-1 [@media(pointer:fine)]:grid-cols-2 gap-5">
  <section>…Basic Information…</section>
  <section>…Retention & Classification…</section>
</div>
pointer:coarse → iPad / touch tablets → 1 column. pointer:fine → Mac / desktop with mouse → 2 columns.

A keyboard-only laptop without a trackpad still registers as pointer:fine (the trackpad sensor reports its presence even when unused). An external mouse plugged into an iPad → pointer:fine too, acceptable since they've opted into a desktop-like setup.

Rule 5 — Tab strip (version/state tabs): pair overflow-x-auto with overflow-y-hidden.
When the sub-page shows multiple version/state tabs (Published / Draft), use the underline-tab convention. The absolutely-positioned underline indicator (<span class="absolute -bottom-px …">) overflows the container by 1px vertically — overflow-x: auto implicitly opens overflow-y to auto, and that 1px is enough to trigger a vertical scrollbar inside the tab strip. Always pair the two:

<div class="border-b border-slate-200 flex gap-0 overflow-x-auto overflow-y-hidden -mx-1 px-1">
  <button type="button"
    class="relative px-5 py-3 text-[13px] font-medium bg-transparent border-none cursor-pointer transition-all flex items-center gap-2 whitespace-nowrap"
    [class.font-semibold]="activeTab() === 'published'"
    [style.color]="activeTab() === 'published' ? 'var(--color-cyan-700)' : 'var(--color-text-muted)'"
    (click)="activeTab.set('published')">
    <lucide-icon name="globe" [size]="13" />
    Published v{{ publishedVersion() }}
    @if (activeTab() === 'published') {
      <span class="absolute -bottom-px left-3 right-3 h-[2px] rounded-t" style="background: var(--color-cyan-500)"></span>
    }
  </button>
  …
</div>
Don't fix the scrollbar by removing the underline's -bottom-px — the underline is meant to sit on top of the bottom border.

Rule 6 — Form section card.
Each form section is a <section> with this exact chrome:

<section class="rounded-2xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 min-w-0">
  <h2 class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
    Basic Information
  </h2>
  <!-- form fields -->
</section>
rounded-2xl — softer than rounded-xl for content panels.
border + bg-[var(--color-bg-surface)] — clean step-up surface against the page bg.
p-4 (16px) uniform padding.
min-w-0 — lets the section shrink in a grid context (prevents form fields from forcing horizontal overflow).
H2 is text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3 — a quiet label, not a hero heading.
Rule 7 — Inline alerts and context notices.
Validation alerts sit at the top of the work area as <cui-alert variant="error">. Display ONLY when the user has attempted to save with invalid input — not on initial render:

@if (validationError(); as err) {
  <cui-alert variant="error" title="Cannot save">{{ err }}</cui-alert>
}
Context notices (e.g., "you're editing a draft") sit just below the tabs as inline banners. Color signals the tone:

Amber (bg-amber-50 border-amber-200 text-amber-800) → needs attention / warning context.
Cyan (bg-[color-mix(in_srgb,var(--color-cyan-500)_6%,transparent)] border-[var(--color-cyan-300)]) → informational / decision required.
Emerald (bg-emerald-50 border-emerald-200) → confirmation / all good.
Each notice has an icon tile on the left + a title + a small description, with an optional action button on the right:

@if (editingDraft()) {
  <div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
    <div class="flex items-center gap-2.5 min-w-0">
      <div class="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
        <lucide-icon name="file-edit" [size]="14" class="text-amber-600" />
      </div>
      <div class="min-w-0">
        <div class="text-[13px] font-medium text-amber-800">Editing draft based on v…</div>
        <div class="text-[11px] text-amber-600 mt-0.5">Changes won't affect the live version until published.</div>
      </div>
    </div>
    <button class="…">Discard</button>
  </div>
}
Never use a modal or toast for this kind of contextual notice — it's part of the page's state, not an interruption.

Rule 8 — Inline icon buttons next to a form field: lock to 40×40.
When placing an action button (e.g. "Add new category" +) inline next to a <cui-input> or <cui-select>, the button must match the field's 40px default height exactly. Padding-based sizing drifts because the button's intrinsic height depends on icon size + border + padding math — easy to be 38px instead of 40px and look subtly off.

<button class="h-10 w-10 px-0 border border-[var(--color-border-default)] text-[var(--color-text-muted)] rounded-lg bg-[var(--color-bg-surface)] cursor-pointer hover:bg-[var(--color-bg-subtle)] transition-colors flex items-center justify-center flex-shrink-0"
  type="button" title="Add new category" (click)="…">
  <cui-icon name="plus" size="sm" />
</button>
h-10 w-10 → exact 40×40 box matching cui-input/cui-select md size.
flex items-center justify-center → centers the icon mathematically, not via padding.
flex-shrink-0 → never compresses when the field grows.
px-0 → explicit; lets w-10 define the width without padding interference.
Rule 9 — Inline sub-flows replace modals.
A sub-decision that "feels" like it wants a modal — "create a new category", "select version type before publishing", "confirm changes before saving" — renders inline inside the work area. Reveal with @if, position adjacent to the related field or at the bottom of the form. Use a cyan-tinted callout card when the user must make a decision before saving:

@if (showsVersionSection()) {
  <section class="rounded-2xl border border-[var(--color-cyan-300)] bg-[color-mix(in_srgb,var(--color-cyan-500)_6%,transparent)] p-6">
    <h2 class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-cyan-700)] mb-4">
      Publish a New Version
    </h2>
    <p class="type-body-sm text-[var(--color-text-muted)] mb-4">
      You're editing an active purpose. Publishing will create a new version. Choose the type:
    </p>
    <!-- radio choices, change-notes input -->
  </section>
}
Per §4, modals are deleted from this model. Inline sub-flows are the replacement. Tint conventions:

Tint	When	Example
Cyan (cyan-500 6% bg + cyan-300 border + cyan-700 heading)	Decision required before save	"Publish a New Version" version-type selection
Amber (per Rule 7)	Contextual warning, no decision	"You're editing a draft" notice
No tint (default card per Rule 6)	Routine sub-form	Inline "Enter new category name" + Add/Cancel buttons
Rule 10 — Sticky footer: sidebar-aware Cancel + Save Draft + Primary.
Sub-pages have a sticky footer (position: fixed; bottom: 0) holding the primary actions. The footer must span only the content column — it must NOT extend over the sidebar (this is the consumer side of §7d Rule 9: the sidebar is inviolable, every fixed-positioned page element offsets past it via the published --sidebar-w variable).

<div class="fixed bottom-0 right-0 bg-[var(--color-bg-surface)] border-t border-[var(--color-border-default)] py-3 px-4 sm:px-6 shadow-lg z-30 transition-[left] duration-200"
  style="left: var(--sidebar-w, 0px)">
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
    <!-- Optional meta line (hidden on mobile) -->
    <div class="type-caption text-[var(--color-text-faint)] hidden sm:block">
      @if (existing(); as e) {
        <span>v{{ e.version }} · {{ statusLabel(e.status) }} · {{ e.lastUpdatedBy }}</span>
      }
    </div>
    <!-- Action buttons -->
    <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-end">
      <cui-button variant="tertiary" size="md" (buttonClick)="back()">Cancel</cui-button>
      @if (canSaveAsDraft()) {
        <cui-button variant="secondary02" size="md" (buttonClick)="saveAsDraft()">
          <span class="flex items-center gap-1.5"><cui-icon name="file-text" size="sm" /> Save as Draft</span>
        </cui-button>
      }
      <cui-button variant="primary" size="md" (buttonClick)="publish()">
        <span class="flex items-center gap-1.5"><cui-icon name="send" size="sm" /> {{ publishLabel() }}</span>
      </cui-button>
    </div>
  </div>
</div>
left: var(--sidebar-w, 0px) — see §7d Rule 9 for the publishing side. The fallback 0px only kicks in outside an app-shell context (isolated tests). Inside the live app, the value is always set to the current sidebar width (270px expanded / 72px collapsed / 0px on mobile), so the footer aligns with the content column's left edge and never overlaps the sidebar.
transition-[left] duration-200 — the sidebar collapses with a 200ms width transition (cui-app-shell's hover-toggle in §7d Rule 1); the footer must match that exact duration on left so it tracks the sidebar's edge smoothly. Mismatched durations make the footer jump.
Work area's pb-32 (Rule 3) leaves room so the footer doesn't overlap form fields.
Action order (right-aligned): Cancel (leftmost) → Save Draft (optional middle) → Primary (rightmost).
Cancel is variant="tertiary" and text-only (no icon). Tertiary is the ghost/text variant; it visually recedes below the Primary CTA it sits next to. This matches §2b Rule 2 (Cancel-as-tertiary) which codifies the same principle for the drawer footer, but with one deliberate difference: §2b Rule 3 (drawer footer) mandates icons on every button — Cancel included; §7c Rule 10 (form footer) keeps Cancel icon-less. Why the divergence: drawer footers cluster 3-5 buttons tightly together, so icons act as a glyph index for fast scanning; form footers cluster only 2-3 buttons in a wider strip, and the primary action's icon already carries the "this is what happens next" semantic — adding an icon to Cancel would equalize its visual weight with Save/Publish, which is exactly the failure mode tertiary-variant is meant to avoid. Save Draft + Primary (Publish / Save / Submit) must carry their icons per the cui convention (icon to the left of the label inside a <span class="flex items-center gap-1.5"> wrapper).
Optional meta line on the left (hidden sm:block) shows version + status + last editor.
z-30 keeps the footer above content but below modals / drawers / dropdowns.
Don't hardcode left: 270px — it breaks when the sidebar collapses. Always read from --sidebar-w so the layout stays correct across collapse/expand/mobile.
Rule 11 — Color tokens: only --color-*, never --ds2-*.
Every text, border, surface, and accent color uses tokens from design-color-logic.md Rule 4's canonical set:

Use case	Token
Body text — primary	var(--color-text-primary)
Body text — secondary	var(--color-text-secondary)
Muted text	var(--color-text-muted)
Faint metadata	var(--color-text-faint)
Section card surface	var(--color-bg-surface)
Subtle hover / secondary surface	var(--color-bg-subtle)
Borders (default)	var(--color-border-default)
Error text / required asterisks	var(--color-error)
Brand accent — DPDP (cyan-anchored module)	var(--color-cyan-500) primary, -300 tints, -700 text
Do NOT use var(--ds2-text-*) — those are legacy. Sub-pages migrating into the canonical pattern must swap to --color-text-*.

Do NOT inline color-mix() expressions outside the canonical cyan tint in Rule 9. Any other tint should be derived from a palette constant per design-color-logic.md Rule 6.

Reference implementation
src/app/features/dpdp/components/purpose-edit-alt01.component.ts applies all 11 rules. When adding a new edit/create sub-page, copy this file as the skeleton — don't invent new conventions. The header → tabs → notices → form sections → inline sub-flows → sticky footer reading order is canonical.

7d. App shell composition (outer layout)
Rules for the OUTERMOST app layout — the chrome around every route. Apply once at the app root. The patterns in §7b (per-page header chrome) and §7c (per-sub-page form conventions) sit inside what §7d defines.

Canonical reference: src/app/layout/components/app-shell.component.ts.

Rule 1 — <cui-app-shell> is the outermost composition. Don't roll your own.
Every page renders inside a single <cui-app-shell> at the app root. It owns:

Flex column layout (header on top, body row below).
Desktop vs mobile breakpoint ((min-width: 1024px), hides the [sidebar] slot on mobile).
The floating hover-to-reveal collapse arrow on the sidebar edge.
The single internal sidebarCollapsed state (read it from the consumer via #shell template ref).
<main> as the only scroll container (see Rule 5).
<cui-app-shell #shell>
  <app-header header … />
  <app-sidebar sidebar [collapsed]="shell.sidebarCollapsed()" … />
  <router-outlet />
</cui-app-shell>
Do not wrap the whole app in a custom <div class="min-h-screen flex …"> or in position: fixed header + margin-left-compensated main. That pattern existed pre-migration and was the source of multiple sticky / scroll-context bugs. Consume <cui-app-shell> directly.

Rule 2 — Header is <cui-header> with named slots.
Inside <app-header>, use <cui-header> with these content slots:

Slot	Selector / directive	Purpose
Logo	<div logo>…</div> ([logo] attribute selector)	Always visible, leftmost. Use <cui-logo size="md"> for the canonical 43px Certinal mark.
Tabs	<ng-template cuiHeaderTabs>…</ng-template>	Center tab strip. Hidden below 900px container width by cui-header's @container query.
Icons	<ng-template cuiHeaderIcons>…</ng-template>	Right-side icon row (search, bell, etc.). Hidden below 900px.
Avatar	<div avatar>…</div> ([avatar] attribute selector)	Always visible, far right.
Mobile drawer body	<ng-template cuiHeaderDrawer>…</ng-template>	Content shown inside cui-header's built-in slide-in drawer when the hamburger is clicked at < 900px. See Rule 6.
<cui-header> has its own built-in hamburger button and drawer chrome (the "MENU" header bar + close button). Don't add a custom hamburger to <cui-header>'s slots — it'll duplicate.

Rule 3 — Sidebar is <cui-sidebar-shell> + <cui-nav-section> + <cui-nav-item>.
Inside <app-sidebar>:

<cui-sidebar-shell [collapsed]="collapsed">

  <!-- Optional product switcher (mobile-drawer-only; desktop has tabs in header) -->
  @if (showProductSwitcher && !collapsed) { … }

  <!-- Top-level standalone item (e.g. Dashboard) — NOT inside a cui-nav-section -->
  <cui-nav-item [label]="…" [icon]="…" [active]="isActive(item.path)" [collapsed]="collapsed" (navClick)="navigate(item)" />

  <!-- Sections with collapsible children -->
  @for (section of currentNav(); track section.title) {
    <cui-nav-section
      [label]="section.title"
      [icon]="…"
      [collapsed]="collapsed"
      [hasActiveChild]="hasActiveChild(section)"
      [defaultExpanded]="hasActiveChild(section)"
    >
      @for (item of section.items; track item.label) {
        <cui-nav-item
          [label]="item.label"
          [icon]="…"
          [active]="isActive(item.path)"
          [badge]="item.badge ?? null"
          [disabled]="!item.enabled"
          [collapsed]="collapsed"
          [indent]="true"
          (navClick)="navigate(item)"
        />
      }
    </cui-nav-section>
  }

</cui-sidebar-shell>
cui-nav-item is a button, not an anchor. Route navigation happens programmatically — navigate(item) calls router.navigate([item.path], { queryParams: item.queryParams }). Don't try to attach [routerLink] inside.

cui-nav-section owns its own expand state per instance. Drive the initial value via [defaultExpanded]="hasActiveChild(section)" so the section containing the current route auto-expands; the user toggles freely after that. Don't maintain a centralized expandedSections signal in the consumer.

Icon constraint. <cui-nav-item>'s icon input is typed CuiIconName | null — a fixed enum. Map any project-specific icon name to its closest CuiIconName equivalent in an ICON_MAP constant inside the sidebar consumer. See sidebar.component.ts for the canonical 40-entry map.

Rule 4 — Active-state hardening (Option A, the "hybrid").
The cui-library's defaults work as-published for almost everything in the sidebar. One override harded into src/styles.scss lifts visual weight off the top-level item (Dashboard) — leaves cui-library defaults untouched everywhere else:

// Top-level (non-indented) active item: transparent bg + lime text + the cui-default
// lime rail. The `.pl-4` selector targets only expanded top-level cui-nav-items
// (cui adds pl-10 for indented children and px-0 for collapsed rail mode).
cui-nav-item button.pl-4.bg-success {
  background: transparent;
  color: var(--color-success);
}
Resulting style stack:

Surface	Active appearance	Source
Top-level item (expanded)	transparent bg + lime text + lime rail + bold	Consumer override (above)
Top-level item (collapsed / rail mode)	filled lime block	cui-nav-item default
Indented child item	filled lime pill + dark text	cui-nav-item default
Section header (has-active-child)	bg-white/5 text-success font-bold + lime rail	cui-nav-section default
Hover (inactive row)	hover:bg-white/5 hover:text-white	cui-nav-item default
Disabled	opacity-40 cursor-not-allowed text-white/60	cui-nav-item default
Don't reach for the design-system HTML reference (certinal-design-system.html → .sidebar-nav a.active with emerald-50 light pill) — that's a light-theme sidebar; applying it to the dark cui-sidebar-shell produces visually disjointed light-on-dark pills.

Rule 5 — <main> inside <cui-app-shell> is the only scroll container.
cui-app-shell uses h-screen overflow-hidden on the host and flex-1 overflow-y-auto overflow-x-hidden on <main>. The document body does not scroll; html does not scroll. All page content scrolls inside <main>.

Consequences:

No position: sticky on the header / sidebar / per-page chrome. The shell elements are flex siblings in a non-scrolling parent — they can't move on scroll because there's no scroll context above them. (We previously added :host { position: sticky } to <app-header> and a global app-header { position: sticky } backstop — both removed once cui-app-shell took over.)
No overflow-y: scroll on html or body. Adds a reserved-but-unused gutter strip.
No height: 100% on html and body. With cui-app-shell's h-screen, forcing html/body to 100% creates layout edge cases (sticky containing-block math goes wrong; was also the root cause of "header drifts slightly down on scroll").
Per-page templates don't manage their own scroll. A page sets mb-6 between sections and lets <main>'s scrollbar handle vertical overflow. No overflow-y: auto on a page-level wrapper.
If a page needs a horizontally-scrollable area (e.g. a wide table), put overflow-x-auto on that specific element — not on the page root.

Rule 6 — Mobile drawer is projected via [cuiHeaderDrawer], not a separate overlay.
Below 900px container width, <cui-header> auto-renders its built-in slide-in drawer (slate-900/60 backdrop + emerald-900 panel with "MENU" header bar). Project the sidebar nav into it:

<!-- inside <cui-header> -->
<ng-template cuiHeaderDrawer>
  <app-sidebar
    [product]="…"
    [collapsed]="false"
    [showProductSwitcher]="true"
    [activeProductInput]="…"
    (productSwitch)="onDrawerProductSwitch($event)"
    (navClick)="onDrawerNavClick()"
  />
</ng-template>
Since <app-sidebar> is <cui-sidebar-shell>-based, the mobile drawer automatically inherits identical emerald-900 styling — desktop and mobile look the same.

The drawer doesn't auto-close on nav-item clicks. Wire a @ViewChild(CuiHeaderComponent) reference and call cuiHeader.closeDrawer() in the consumer's nav-click / product-switch handlers. Backdrop click and Esc are handled by cui-header automatically.

#cui-header-drawer width override. cui-header's drawer defaults to w-80 (320px). Override to 270px in styles.scss so the drawer matches the inner cui-sidebar-shell's natural width and the drawer doesn't feel oversized on mobile:

#cui-header-drawer {
  width: 270px;
  max-width: 85vw;
}
Don't add a custom mobile-sidebar overlay outside cui-header — it'll either duplicate or stack on top of cui-header's built-in drawer.

Rule 7 — Scrollbars are globally hidden.
src/styles.scss applies scrollbar-width: none + *::-webkit-scrollbar { display: none } to every scroll container in the app. Scroll functionality (wheel / trackpad / keyboard / Page Up/Down) is unchanged — only the visible track and thumb are gone.

Don't reintroduce visible scrollbars anywhere — including via the legacy ::-webkit-scrollbar styling block from older builds. If a specific page truly needs to show scroll progress (rare), use a progress-bar indicator at the top of the page, not a native scrollbar.

Rule 8 — Shell chrome lives in flex flow. No position: fixed.
The header, sidebar, and main all participate in cui-app-shell's flex layout naturally. Do not position: fixed any of them. The pre-migration <aside class="fixed top-[60px] bottom-0 left-0 …"> sidebar pattern is the canonical "what dies in this model" example — gone, with a margin-left-compensated <main> going with it.

Rule 9 — The sidebar is inviolable. App-shell publishes --sidebar-w; page chrome must consume it.
The left sidebar (cui-sidebar-shell, Rule 3) is the always-visible navigation rail. No page-level chrome — sticky footers, fixed banners, persistent toasts, dropdown overlays anchored to the viewport, anything position: fixed — may extend horizontally over the sidebar. The sidebar is always fully visible, always clickable, never obscured by anything originating from inside a routed page.

Enforcement mechanism: the app-shell publishes the current sidebar width as a CSS custom property --sidebar-w on the <cui-app-shell> host element. Any page-level fixed chrome that spans the viewport horizontally must consume this variable to offset itself past the sidebar.

Publishing side (app-shell.component.ts):

<cui-app-shell
  #shell
  [style.--sidebar-w]="shell.isDesktop() ? (shell.sidebarCollapsed() ? '72px' : '270px') : '0px'"
>
The value tracks sidebar state in real time:

State	--sidebar-w	Why
Desktop, sidebar expanded	270px	matches <cui-sidebar-shell>'s expandedWidth default
Desktop, sidebar collapsed (hover-arrow clicked)	72px	matches <cui-sidebar-shell>'s collapsedWidth default
Mobile (< 1024px)	0px	sidebar isn't in the layout — it's in the cui-header drawer overlay (Rule 6); footer can span full width because there's nothing to overlap
The CSS custom property cascades down through everything inside cui-app-shell — including <main>, the routed pages inside <router-outlet>, and any sticky/fixed chrome those pages contain.

Consuming side (any sticky/fixed chrome in a routed page):

<div
  class="fixed bottom-0 right-0 … transition-[left] duration-200"
  style="left: var(--sidebar-w, 0px)"
>
  …footer content…
</div>
Two things must always be in place on the consumer:

left: var(--sidebar-w, 0px) — the fallback 0px is for when the page is rendered outside an app-shell context (e.g. in an isolated test harness or storybook). In the live app, the published value always wins.
transition-[left] duration-200 — when the user toggles the sidebar collapse via the hover-arrow (cui-app-shell's built-in toggle, see Rule 1), the sidebar transitions from 270px → 72px over ~200ms. The footer must transition left at the same rate so it tracks the sidebar's edge smoothly. Mismatched durations make the footer jump.
Forbidden:

position: fixed with left: 0 (or anything < var(--sidebar-w)) — the chrome slides under the sidebar.
Hardcoding left: 270px — breaks when the sidebar collapses to 72px.
position: fixed chrome that ignores --sidebar-w entirely — same problem.
Removing the transition-[left] duration-200 — footer becomes jumpy during sidebar collapse.
What this rule does NOT govern: chrome that's position: sticky inside <main> (Rule 5 — main is the scroll container) is already naturally bounded by main's flex width, so it doesn't need --sidebar-w. Use sticky-inside-main for chrome that should release at the end of content (e.g. an inline "save indicator" within a long form). Use fixed-with---sidebar-w for chrome that must always be at viewport bottom regardless of scroll (e.g. the §7c Rule 10 sticky footer).

Reference implementation
The three layout files together implement all of §7d:

src/app/layout/components/app-shell.component.ts — <cui-app-shell> composition (Rules 1, 5, 8) and --sidebar-w publishing (Rule 9).
src/app/layout/components/header.component.ts — <cui-header> slots + [cuiHeaderDrawer] template (Rules 2, 6).
src/app/layout/components/sidebar.component.ts — <cui-sidebar-shell> + <cui-nav-item> + <cui-nav-section> + ICON_MAP + navigate() (Rules 3, 4).
src/styles.scss — top-level active override + drawer width override + global scrollbar hide (Rules 4, 6, 7).
Future enhancement: <cui-sidebar> library component
sidebar.component.ts is essentially a typed template wrapping <cui-sidebar-shell> + @for loops over a NavSection model + RBAC filtering + route-active detection. Promoting it into @certinal/ui as <cui-sidebar [topItem] [groups] [collapsed] [isActive]> would let any app consume this whole pattern in one tag. Not done yet — the library is now in-tree at packages/ui/, so adding the component is a same-repo change; when it lands, the admin app's sidebar.component.ts collapses to ~20 lines of model construction + a single <cui-sidebar> tag.

7e. Data table conventions
Every data table on a main page (registry / inventory / queue / library) follows this exact shape. The goal is that a user moving between 20+ tables sees one unchanging layout: same pill style, same hover behavior, same Actions affordance in the same place on every page.

Rule 1 — Table shell.
Two-wrapper structure: outer card with rounded corners + clipping, inner scroll container, then the <table> itself.

<div class="rounded-2xl overflow-hidden hidden md:block shadow-sm"
     style="background: var(--color-bg-surface); border: 1px solid var(--color-border-default)">
  <div class="overflow-x-auto">
    <table class="w-full border-collapse min-w-[820px]">
      <thead>
        <tr style="background: var(--color-bg-subtle); border-bottom: 1px solid var(--color-border-default)">
          <th class="text-xs uppercase tracking-wider font-medium px-5 py-3 text-left"
              style="color: var(--color-text-muted)">…</th>
        </tr>
      </thead>
      <tbody>
        @for (row of filteredRows(); track row.id) {
          <tr class="group transition-colors hover:bg-[var(--color-bg-subtle)]"
              style="border-bottom: 1px solid var(--color-border-default)">
            <td class="px-5 py-4 text-sm">…</td>
          </tr>
        }
      </tbody>
    </table>
  </div>
</div>
Required classes / attributes: - <tr> in <tbody> always carries class="group …" (see Rule 7 — the row hover propagates to the sticky Actions cell via group-hover:). - The <tr> is never clickable — it carries no (click) handler, no routerLink, and no cursor-pointer. Opening a record is done exclusively through the Actions-column View button (see Rule 5 and Rule 5a). The hover:bg-[var(--color-bg-subtle)] is a row-tracking aid only, not a clickability cue. - <th> defaults to text-left. Use text-left even for the Actions column — never text-center or text-right (see Rule 5). - Pad <td> with px-5 py-4 (px-3 py-4 is acceptable on dense queue-style tables; do not go below px-3).

Rule 1a — Every column's primary text is the same size: the <td>'s class.
This is the single most-violated rule in the audit, so it gets its own sub-rule. The text size for every column's primary value is set once on the <td> and inherited by content — text-sm for standard tables, text-xs ONLY on dense queue-style tables (and uniformly across every cell in that table). Never override with a smaller class on an inner <span> / <div> / <p> inside a cell whose primary value is the only thing there. When one column's primary value reads smaller than its row-neighbours, that column visually downgrades — the user reads it as "less important" or "metadata" when it's actually the column's main answer. Across tables in the app, that means a vendor.dataCategories.length count, a nextReviewDate, a "Not assessed" empty state, a — dash placeholder, a getRelativeDate(submittedAt) — all of these are primary column values and must inherit the row's text size.

❌ Wrong (cell content downsized — what the audit on 2026-05-26 caught and fixed):

<!-- vendor-inventory: DC + Activities + Transfer empty state -->
<td class="px-5 py-4 text-sm">
  <span class="text-xs" style="color: var(--color-text-secondary)">
    {{ vendor.dataCategories.length }} categories
  </span>
</td>
<td class="px-5 py-4 text-sm">
  <span class="text-xs" style="color: var(--color-text-muted)">—</span>
</td>
✅ Right (drop the inner text-xs, content inherits the <td>'s text-sm):

<td class="px-5 py-4 text-sm">
  <span style="color: var(--color-text-secondary)">
    {{ vendor.dataCategories.length }} categories
  </span>
</td>
<td class="px-5 py-4 text-sm">
  <span style="color: var(--color-text-muted)">—</span>
</td>
Sanctioned exception — a structural sub-line under a primary identifier within one cell (not a column-wide downsize):

<!-- ✅ Sub-line pattern — text-xs is OK because it's a SECOND line stacked
     under a primary identifier in the same cell. Common shape: name + email,
     name + ID, date + relative-time, etc. -->
<td class="px-5 py-4 text-sm">
  <p class="font-medium m-0" style="color: var(--color-text-primary)">{{ row.name }}</p>
  <p class="text-xs mt-0.5 m-0" style="color: var(--color-text-faint)">{{ row.email }}</p>
</td>
The diagnostic question is: is this the only thing in the cell? If yes → the size belongs on the <td>, not on an inner element. If no, and it's a second/third row stacked under a primary value → text-xs mt-0.5 with var(--color-text-faint) is the canonical sub-line style.

Also out of scope of this rule (don't conflate): - Pills, chips, and badges (<cui-badge>, status pill spans) — their text-xs is part of the pill's own typography, not column text. - Mobile card layouts (e.g. asset-registry's mobile cards, evidence-library, request-queue's mobile rows) — those are a different surface with their own typography stack; Rule 1a applies only to <td> cells. - Drawer body content — drawer detail rows have their own scale.

Audit history — Rule 1a sweeps
Date	Files swept	Violations fixed
2026-05-26	consent-rights-dashboard (Deadline), entity-inventory (DPO)	2 cells
2026-05-26	vendor-inventory (Data Categories, Activities, Transfer), data-element-registry (PII dash), processing-activity-list (Review Date + dash), request-queue (Submitted), vendor-directory ("Not assessed")	8 cells across 5 files. Audit triggered by /consent-map/vendor-inventory review. Codebase-wide grep class="text-xs" inside <td class="text-sm"> confirms no remaining violations in desktop table cells.
Rule 2 — State pills use <cui-badge>, never inline-styled spans.
Status, priority, severity, risk-level, criticality, vulnerability, and any other state-like value renders as <cui-badge> driven by a variant field on the domain's config map.

// In the domain model (e.g., vendor.model.ts):
type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'emerald' | 'lime';

export const VENDOR_STATUS_CONFIG: Record<VendorStatus, { label: string; color: string; bgColor: string; variant: BadgeVariant }> = {
  active:       { label: 'Active',       color: '#10B981', bgColor: '#ECFDF5', variant: 'success' },
  under_review: { label: 'Under Review', color: '#F59E0B', bgColor: '#FEF3C7', variant: 'warning' },
  suspended:    { label: 'Suspended',    color: '#EF4444', bgColor: '#FEE2E2', variant: 'error'   },
  offboarded:   { label: 'Offboarded',   color: '#6B7280', bgColor: '#F3F4F6', variant: 'neutral' },
};
<!-- In the table cell -->
<cui-badge [variant]="getStatusConfig(row.status).variant" dot="true">
  {{ getStatusConfig(row.status).label }}
</cui-badge>
Canonical mapping: - success (dot) — Active, Approved, Verified, Completed, Delivered, Acknowledged, Published, Signed, DPA Active - warning (dot) — Draft, Pending, Under Review, In Progress, In Review, Processing, Proposed, Scheduled, Overdue, Cross-border, Medium (priority/severity) - error (dot) — Failed, Rejected, Escalated, Suspended, Expired, Terminated, Dissolved, Missing, Unmapped, High and Critical (no tier-4 variant exists yet — Critical collapses to error) - info (dot) — Sent, Verified-DPR, In Progress (assessment), Planned, Submitted - neutral — Inactive, Deprecated, Archived, Decommissioned, Retired, Offboarded, Queued, Cancelled, Standard, Low priority, count = 0, free-form tags - emerald / lime — brand-identity counters only (clinical/cookie consent counts), not state

Forbidden: <span class="…rounded-full…" [style.background-color]="…" [style.color]="…">…</span>. The audit had 250+ of these; standardizing to cui-badge killed three separate "Verified greens" and an "Active outlier" in processing-activities.

color and bgColor fields on the config map are retained as legacy data for the row-anchor icon tile only — see Rule 4.

Rule 3 — Taxonomic chips render as plain text, not pills.
Identity / type / role / category values (Vendor Type, Asset Type, Subject Category, Role, Consent Mechanism, Legal Basis, Evidence Type, Entity Type, Data Element Category, Hosting, Activity Status's row-anchor icon, etc.) are rendered as plain text inside the cell — never as pills, regardless of how many hues the original design used.

<!-- Table row -->
<td class="px-5 py-4 text-sm">
  <span class="font-medium" style="color: var(--color-text-primary)">{{ getTypeConfig(row.type).label }}</span>
</td>

<!-- Mobile card / drawer field -->
<div class="text-sm font-medium" style="color: var(--color-text-primary)">{{ getTypeConfig(row.type).label }}</div>
Why: pills imply state. Taxonomic values are not state — they are "what kind." Putting 8 different hues across rows reads like 8 different alerts. A row's primary identity comes from its name column + (optionally) a row-anchor icon tile; the type label belongs in the data, not in a chip.

Exception — cui-tag exists in the library for cases where a multi-hue identity chip is genuinely warranted (e.g., the row-anchor icon tile that prefaces a vendor name). When used, drive it from a tone: CuiTagTone field on the config map (same shape as Rule 2's variant). Do NOT use cui-badge for identity.

Rule 4 — Row-anchor icon tile is the one place type-color tinting belongs.
When a row's leading column is a Name + ID combo (vendors, evidence, assets, vendor-inventory), a small w-8 h-8 rounded-lg icon tile to the left of the name tinted by the row's type carries the type-color identity for the entire row:

<td class="px-5 py-4 text-sm">
  <div class="flex items-center gap-2.5">
    <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
         [style.background-color]="getTypeConfig(row.type).bgColor">
      <lucide-icon [name]="getTypeConfig(row.type).icon" [size]="16"
                   [style.color]="getTypeConfig(row.type).color" />
    </div>
    <div class="min-w-0">
      <div class="font-medium truncate max-w-[200px]" style="color: var(--color-text-primary)">{{ row.name }}</div>
      <div class="text-[11px] font-mono" style="color: var(--color-text-muted)">{{ row.id }}</div>
    </div>
  </div>
</td>
This is the only sanctioned use of inline [style.background-color]/[style.color] in a table cell. Status pills, severity pills, type chips — none of them. Just the row-anchor tile.

Rule 5 — Actions column: sticky right, text-left header, [👁 View] + optional kebab.
Universal Actions column shape, applied identically across every table-bearing page:

<!-- Header -->
<th class="text-xs uppercase tracking-wider font-medium px-5 py-3 text-left sticky right-0"
    style="color: var(--color-text-muted); background: var(--color-bg-subtle)">Actions</th>

<!-- Cell -->
<td class="px-5 py-4 text-sm sticky right-0 bg-[var(--color-bg-surface)] group-hover:bg-[var(--color-bg-subtle)] transition-colors">
  <div class="flex items-center gap-1.5 justify-start">
    <cui-button variant="secondary" size="sm" (buttonClick)="openDetails(row)">
      <cui-icon name="eye" size="sm" />
      View
    </cui-button>
    @if (getSecondaryActions(row.status).length > 0) {
      <cui-dropdown [items]="getSecondaryActions(row.status)"
                    placement="bottom-end"
                    (itemClick)="onSecondaryAction($event, row)">
        <button cuiDropdownTrigger
                class="p-1.5 rounded-lg hover:bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border-none bg-transparent cursor-pointer flex items-center justify-center transition-colors"
                aria-label="More actions">
          <cui-icon name="more-vertical" size="sm" />
        </button>
      </cui-dropdown>
    }
  </div>
</td>
Constraints: - Header is text-left. Not center, not right. The actions column header word sits at the left of its cell; the buttons inside data cells also sit at the left of the cell (justify-start). This way every View button across all rows lines up on the same x-coordinate. - No left-border separator. Don't add border-l to the sticky column. The bg contrast on hover is sufficient visual separation. - No z-index on sticky cells. Removing it prevents the cells from creating stacking contexts that would clip the dropdown menu (which is a fixed-positioned element). The cells stay opaque via background color, so horizontal-scroll behavior is unaffected. - Button variant: secondary, size: sm. Filled-but-subordinate button, ~32px tall. - Button label is View. One standard label for the open-record affordance on every table in every module — paired with the eye icon. Do not use Details, View Details, View Profile, or page-specific verbs. (Supersedes the earlier "rename View Details → Details, keep everything else" guidance — that produced a different verb per page, which §1 predictability forbids.) When the page has no read-only drawer and View opens a content preview / rendered surface instead, the label stays View — it is still "show me this record." - Kebab is conditional. @if (getSecondaryActions(row.status).length > 0) — when a row has no secondary actions, the [⋮] doesn't render. Don't put a stub kebab "for visual consistency" — empty kebabs are noise. - Secondary actions are status-aware on DPR-style pages: a method returns the right CuiDropdownItem[] per row status (Verify / Confirm / Review / Approve / Mark Complete map to the right transitions). The kebab adapts; the trigger and the surrounding View button stay constant.

Rule 5a — Rows are never clickable. The View button is the only open affordance.
The <tr> must not carry a (click) handler, a routerLink, or cursor-pointer. A user opens a record's view (the right drawer per §2 rule 1, or a preview/rendered surface where no read-only drawer exists) only by clicking the Actions-column View button — never by clicking anywhere else on the row. Every other interactive element in a row is an explicit control inside a cell (the kebab, an inline link); the row body itself is inert.

Why: - One affordance, not two. A clickable row plus a View button is a redundant double-affordance. The user can't tell whether they do the same thing, and the wide full-row hit-target fires unintended navigations on stray clicks (selecting text, reaching for the kebab). - Predictability (§1). The open action lives in one fixed place — the sticky Actions cell, same x-coordinate on every table in every module. Nothing else in the row competes for the click. - Operators scan, not click. Compliance users read these tables far more than they act on them; a full-row hit-target invites misclicks on records they only meant to read.

The row's hover:bg-[var(--color-bg-subtle)] (Rule 6) stays — it aids horizontal eye-tracking across a wide row — but it is not a clickability cue. Don't add cursor-pointer to "hint" the row is interactive; it isn't.

Migration note: existing pages whose <tr> still carries (click)="openDetails(...)" (e.g. purpose-registry-alt01, the older registry references) are now out of standard. Drop the row handler on next touch — the View button already provides the action, so removal is behavior-preserving. The canonical Rule 1 shell already omits the row handler; align reference pages to it as they're revisited.

Rule 6 — Row hover propagates to the sticky cell via group / group-hover:.
Because the sticky Actions cell has its own opaque bg-bg-surface (required for sticky-during-scroll), the <tr>'s hover:bg-bg-subtle does not naturally extend through to it. Fix via Tailwind's group pattern:

<tr class="group …"> marks the row.
The sticky <td> uses bg-[var(--color-bg-surface)] group-hover:bg-[var(--color-bg-subtle)] transition-colors.
On hover the cell tracks the row's bg change. No other cells need group-hover: because their bg is transparent and naturally inherits the row's color.

Rule 7 — Per-row hover cards must use named groups (group/cats) to avoid colliding with row-hover.
When a cell shows a small inline hover card (e.g., +N more data categories that expands on hover), the trigger element needs its own named group — otherwise hovering anywhere in the row triggers the card (because the <tr> is also class="group").

<!-- + N data categories: named group `cats`, isolated from the row group -->
<span class="relative group/cats inline-block">
  <span class="…+N chip…">+{{ row.dataCategories.length - 2 }}</span>
  <span class="absolute … hidden group-hover/cats:block z-50 …">
    <!-- card content -->
  </span>
</span>
group/cats ↔ group-hover/cats:block form a private hover pair. The outer group on <tr> ↔ group-hover:bg-… form the row-hover pair. Same Tailwind variant family, distinct names.

Caveat: backticks inside HTML comments inside a JS template literal terminate the template literal early. If you want to mention group/cats in a comment near the markup, use parentheses or quotes — never backticks.

Rule 8 — Column data that should not wrap.
Cells whose content is identifier-like (Request ID, Alert ID, channel labels like "In-App", Event type, formatted dates with overdue indicator, status pills, type chips) need whitespace-nowrap on the <td>. Without it, hyphenated values break across two lines when the column is narrow, and the row height becomes inconsistent.

<td class="px-5 py-4 align-middle whitespace-nowrap">…</td>
When you add whitespace-nowrap to one column, neighbors often need it too — adding it to a single cell can push more pressure onto unconstrained ones. If the table now horizontally scrolls, that's the correct outcome; the outer <div class="overflow-x-auto"> is there for exactly this case.

Rule 9 — Drawer-section list chips stay as styled spans.
The list chips inside the right-side drawer that show "Data Categories Covered", "Purposes Covered", "Linked Assets", "Sub-processors", etc. are not state pills and not the same shape problem as Rule 2 — they are bulk-listed identity tags inside a richer detail surface. Leave them as their current styled-span form (subtle-bg, secondary text). Migrating them to <cui-badge> or <cui-tag> is unnecessary churn.

Rule 10 — Library affordances that make Rule 5 work.
A few small affordances inside @certinal/ui had to be added for this pattern. If you see a regression, these are the load-bearing changes:

cui-badge has an info variant wired to --color-info-* tokens. Submitted / Sent / Verified-DPR / In Progress (assessment) / Planned all use it.
cui-dropdown teleports its menu to document.body on open, with position: fixed and JS-computed coordinates from the trigger's getBoundingClientRect(). This is required because the sticky Actions cell creates a stacking context that would otherwise trap the menu beneath the next row.
cui-icon registry includes eye. The Actions button icon depends on it.
A cui-tag primitive exists for taxonomic identity chips with an 11-tone palette, but Rule 3 says prefer plain text — use cui-tag only when a multi-hue chip is genuinely needed.
Reference implementations
Closest-to-canonical: - src/app/features/dpdp/components/notice-registry.component.ts — current standard: non-clickable rows, single View button + persistent kebab (Edit / Version history / Copy code / Delete). - src/app/features/consent-govern/components/vendor-directory.component.ts — pilot. Single open button, no kebab. (Predates Rule 5a — still labels the button Details and may carry a row click; align on next touch.) - src/app/features/consent-rights/components/access-requests.component.ts — open button + status-aware kebab. (Same pre-Rule-5a caveat.) - src/app/features/dpdp/components/purpose-registry-alt01.component.ts — open button + persistent kebab (Edit / Copy / Delete), but the <tr> is still clickable and the button is labelled Details — both predate Rule 5a / the View label standard.

8. URL conventions
These are the only URL patterns used for record interactions in this app:

Pattern	Example	Used for
/:module/:resource	/dpdp/collection	List page
/:module/:resource?details=:id	/dpdp/collection?details=abc123	Drawer-open state (view detail)
/:module/:resource/new	/dpdp/collection/new	Create page
/:module/:resource/edit/:id	/dpdp/collection/edit/abc123	Edit page
Drawers MUST be deep-linkable via the ?details=:id query param. The drawer reads the param on init and opens; closing the drawer removes the param. This makes drawers behave like first-class views — refreshing the URL re-opens the same drawer.

9. Migration plan — current screens to target state
Screen	Current	Target	Effort
DPDP → Collection Points	View opens modal; Edit navigates to page	View opens drawer (?details=:id); Edit stays as page	Low — swap modal for drawer
DPDP → Purpose Registry	Tabbed modal with read + write in the same surface	Drawer to view; page (/dpdp/purposes/edit/:id) to edit. Publish/copy → dropdown or confirm	Medium — extract form into a page
ConsentMap → Asset Registry	Drawer for view; Edit button inside drawer navigates to page	✅ Already matches	—
ConsentMap → Processing Activity Registry	Same as Asset Registry	✅ Already matches	—
ConsentMap → Data Element Registry	Same as Asset Registry	✅ Already matches	—
Consent Rights → Access / Erasure / Correction Requests	All read + workflow transitions inside one modal	View → drawer. Workflow transitions: simple Approve/Reject → confirm; complex (notes/attachments required) → page	Medium — biggest payoff
Cookies → Banner Config	Page editor with inline delete modal	Page stays. Replace inline delete modal with CuiConfirmService	Low
All "are you sure you want to save" modals	Custom inline modals	Delete them. Save + CuiToastService.success()	Low — net code deletion
ConsentMap registries are the reference implementation. When migrating any other screen, model the View drawer on Asset Registry's, the Edit page on Asset Form's, and the row actions on Asset Registry's dropdown.

10. Decision flowchart
User wants to → ...
  view a record                 → right drawer (?details=:id)
  edit a record (any size)      → page (/edit/:id)
  create a record               → page (/new)
  delete / archive / revoke     → confirm (danger)
  set one field / pick option   → dropdown / popover
  filter the list               → dropdown / popover
  see "saved!" feedback         → toast
  see a validation problem      → inline alert
  show progress through a flow  → page + stepper
If your situation isn't on this list, the situation is wrong, not the list. Refactor the situation.

11. Team-level decisions to settle
Confirm ?details=:id as the deep-link param across all modules. (Audit found drawers in ConsentMap already use this; standardize the name.)
Confirm drawer width at Cui lg (600px). Audit confirms current implementations are already this size.
Row-action placement: always-visible kebab (⋮) opening a CuiDropdownComponent, vs hover-revealed icon buttons. Recommend kebab — predictable, accessible, single grammar across modules.
Where to put "save and continue editing": a page-level secondary button next to the save CTA. Never an overlay.
Companion doc: design-color-logic.md.