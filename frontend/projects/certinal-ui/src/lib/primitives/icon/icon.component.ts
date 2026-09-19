import { Component, computed, input } from '@angular/core';

export type CuiIconName =
  // Brand / product
  | 'consent-flow'
  | 'consent-rights'
  | 'consent-govern'
  | 'consent-map'
  // Core UI
  | 'menu'
  | 'close'
  | 'search'
  | 'bell'
  | 'settings'
  | 'grid'
  | 'link'
  | 'plus'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'panel-left-close'
  | 'panel-left-open'
  | 'more-vertical'
  | 'more-horizontal'
  // Nav / layout
  | 'dashboard'
  | 'file-text'
  | 'shield'
  | 'shield-check'
  | 'cookie'
  | 'database'
  // Consent Flow items
  | 'pen-tool'
  | 'send'
  | 'activity'
  // DPDP items
  | 'target'
  | 'map-pin'
  | 'receipt'
  // Cookie items
  | 'monitor'
  | 'globe'
  | 'bar-chart-3'
  // Consent Rights items
  | 'user'
  | 'users'
  | 'user-check'
  | 'inbox'
  | 'trash-2'
  | 'download'
  | 'pencil'
  | 'eye'
  | 'clock'
  | 'calendar'
  | 'trending-up'
  // Form controls
  | 'check'
  | 'minus'
  // Status
  | 'info'
  | 'alert-triangle'
  | 'alert-circle'
  | 'check-circle';

export type CuiIconSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_PX: Record<CuiIconSize, number> = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
};

@Component({
  selector: 'cui-icon',
  standalone: true,
  templateUrl: './icon.component.html',
  host: {
    class: 'inline-flex shrink-0',
    '[attr.aria-hidden]': '"true"',
  },
})
export class CuiIconComponent {
  readonly name = input.required<CuiIconName>();
  readonly size = input<CuiIconSize>('sm');

  readonly pixelSize = computed(() => SIZE_PX[this.size()]);
}
