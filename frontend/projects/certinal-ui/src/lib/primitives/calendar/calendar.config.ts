import { InjectionToken, Provider } from '@angular/core';

export interface CuiDateConfig {
  /** BCP 47 locale tag for month/weekday labels. Defaults to the browser locale. */
  locale: string;
  /** 0 = Sunday, 1 = Monday, … 6 = Saturday. */
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Display format for date inputs. Reserved for picker primitives — the calendar
   * grid does not consume this directly. Tokens follow the `dd MMM yyyy` style.
   */
  dateFormat: string;
  /** When true, time pickers default to 24-hour clock. */
  use24Hour: boolean;
}

export const CUI_DATE_CONFIG_DEFAULTS: CuiDateConfig = {
  locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
  weekStartsOn: 1,
  dateFormat: 'dd MMM yyyy',
  use24Hour: true,
};

export const CUI_DATE_CONFIG = new InjectionToken<CuiDateConfig>('CUI_DATE_CONFIG', {
  providedIn: 'root',
  factory: () => CUI_DATE_CONFIG_DEFAULTS,
});

export function provideCuiDateConfig(overrides: Partial<CuiDateConfig>): Provider {
  return {
    provide: CUI_DATE_CONFIG,
    useValue: { ...CUI_DATE_CONFIG_DEFAULTS, ...overrides },
  };
}
