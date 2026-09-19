/**
 * @certinal/ui — Blocks
 * Composed components: cards, alerts, modals, tables, tabs, etc.
 */

export { CuiHeaderComponent } from './header/header.component';
export {
  CuiHeaderTabsDirective,
  CuiHeaderIconsDirective,
  CuiHeaderDrawerDirective,
} from './header/header.directives';

export { CuiSidebarShellComponent } from './sidebar-shell/sidebar-shell.component';

export { CuiCardComponent } from './card/card.component';
export type {
  CuiCardVariant,
  CuiCardPadding,
  CuiCardStatus,
  CuiCardAccentColor,
} from './card/card.component';

export { CuiMetricCardComponent } from './metric-card/metric-card.component';
export type {
  CuiMetricStat,
  CuiMetricStatColor,
  CuiMetricCardStatus,
} from './metric-card/metric-card.component';

export { CuiModalComponent } from './modal/modal.component';
export type { CuiModalSize } from './modal/modal.component';

export { CuiTabsComponent } from './tabs/tabs.component';
export type { CuiTabsItem } from './tabs/tabs.component';

export { CuiPlatformTabsComponent } from './platform-tabs/platform-tabs.component';
export type { CuiPlatformTab } from './platform-tabs/platform-tabs.component';

export { CuiPaginatorComponent } from './paginator/paginator.component';

export { CuiDataTableComponent } from './data-table/data-table.component';
export type {
  CuiDataTableColumn,
  CuiDataTableSort,
} from './data-table/data-table.component';

export { CuiToastComponent } from './toast/toast.component';
export type { CuiToastVariant } from './toast/toast.component';
export { CuiToastHostComponent } from './toast/toast-host.component';
export type { CuiToastPosition } from './toast/toast-host.component';
export { CuiToastService } from './toast/toast.service';
export type { CuiToastConfig, CuiToastInstance } from './toast/toast.service';

export { CuiEmptyStateComponent } from './empty-state/empty-state.component';

export { CuiSearchBarComponent } from './search-bar/search-bar.component';

export { CuiBreadcrumbComponent } from './breadcrumb/breadcrumb.component';
export type {
  CuiBreadcrumbItem,
  CuiBreadcrumbClickEvent,
} from './breadcrumb/breadcrumb.component';

export { CuiAlertComponent } from './alert/alert.component';
export type { CuiAlertVariant } from './alert/alert.component';

export { CuiDropdownComponent } from './dropdown/dropdown.component';
export type {
  CuiDropdownItem,
  CuiDropdownItemType,
  CuiDropdownPlacement,
} from './dropdown/dropdown.component';

export { CuiSegmentedControlComponent } from './segmented-control/segmented-control.component';
export type {
  CuiSegmentedOption,
  CuiSegmentedSize,
} from './segmented-control/segmented-control.component';

export { CuiStepperComponent } from './stepper/stepper.component';
export type {
  CuiStepperItem,
  CuiStepperStatus,
} from './stepper/stepper.component';

export { CuiAvatarGroupComponent } from './avatar-group/avatar-group.component';
export type { CuiAvatarGroupItem } from './avatar-group/avatar-group.component';

export { CuiPopoverComponent } from './popover/popover.component';
export type { CuiPopoverPlacement } from './popover/popover.component';

export { CuiDrawerComponent } from './drawer/drawer.component';
export type { CuiDrawerPosition, CuiDrawerSize } from './drawer/drawer.component';

export { CuiAccordionComponent } from './accordion/accordion.component';
export type { CuiAccordionItem } from './accordion/accordion.component';

export { CuiTreeComponent } from './tree/tree.component';
export type { CuiTreeNode } from './tree/tree.component';

export { CuiStatsStripComponent } from './stats-strip/stats-strip.component';
export type {
  CuiStatsStripItem,
  CuiStatsStripAccent,
} from './stats-strip/stats-strip.component';
