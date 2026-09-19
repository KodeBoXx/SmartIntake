/**
 * @certinal/ui — Primitives
 * Atomic UI elements: buttons, inputs, badges, avatars, toggles, etc.
 */

export { CuiButtonComponent } from './button/button.component';
export type { CuiButtonVariant, CuiButtonSize } from './button/button.component';

export { CuiIconButtonComponent } from './icon-button/icon-button.component';
export type { CuiIconButtonVariant, CuiIconButtonSize } from './icon-button/icon-button.component';

export { CuiBadgeComponent } from './badge/badge.component';
export type { CuiBadgeVariant } from './badge/badge.component';

export { CuiAvatarComponent } from './avatar/avatar.component';
export type { CuiAvatarSize } from './avatar/avatar.component';

export { CuiProductTabComponent } from './product-tab/product-tab.component';

export { CuiDividerComponent } from './divider/divider.component';
export type { CuiDividerOrientation } from './divider/divider.component';

export { CuiLogoComponent } from './logo/logo.component';
export type { CuiLogoSize } from './logo/logo.component';

export { CuiIconComponent } from './icon/icon.component';
export type { CuiIconName, CuiIconSize } from './icon/icon.component';

export { CuiNavItemComponent } from './nav-item/nav-item.component';

export { CuiNavSectionComponent } from './nav-section/nav-section.component';

export { CuiInputComponent } from './input/input.component';
export type { CuiInputType, CuiInputSize } from './input/input.component';

export { CuiSelectComponent } from './select/select.component';
export type { CuiSelectOption, CuiSelectSize } from './select/select.component';

export { CuiCardIconComponent } from './card-icon/card-icon.component';
export type { CuiCardIconSize } from './card-icon/card-icon.component';

export { CuiCardTitleComponent } from './card-title/card-title.component';
export type { CuiCardTitleSize } from './card-title/card-title.component';

export { CuiCardBodyComponent } from './card-body/card-body.component';

export { CuiCardHeaderComponent } from './card-header/card-header.component';

export { CuiCardFooterComponent } from './card-footer/card-footer.component';

export { CuiModalHeaderComponent } from './modal-header/modal-header.component';

export { CuiModalBodyComponent } from './modal-body/modal-body.component';

export { CuiModalFooterComponent } from './modal-footer/modal-footer.component';
export type { CuiModalFooterAlign } from './modal-footer/modal-footer.component';

export { CuiTooltipDirective } from './tooltip/tooltip.directive';
export type { CuiTooltipPosition } from './tooltip/tooltip.directive';

export { CuiCheckboxComponent } from './checkbox/checkbox.component';
export type { CuiCheckboxSize } from './checkbox/checkbox.component';

export { CuiRadioComponent } from './radio/radio.component';
export type { CuiRadioSize } from './radio/radio.component';

export { CuiChipComponent } from './chip/chip.component';
export type { CuiChipSize } from './chip/chip.component';

export { CuiTagComponent } from './tag/tag.component';
export type { CuiTagTone, CuiTagSize } from './tag/tag.component';

export { CuiProgressBarComponent } from './progress-bar/progress-bar.component';
export type { CuiProgressBarSize } from './progress-bar/progress-bar.component';

export { CuiSkeletonComponent } from './skeleton/skeleton.component';
export type { CuiSkeletonVariant } from './skeleton/skeleton.component';

export { CuiTabComponent } from './tab/tab.component';
export type { CuiTabSize } from './tab/tab.component';

export { CuiTableCellComponent } from './table-cell/table-cell.component';
export type { CuiTableAlign } from './table-cell/table-cell.component';

export { CuiTableHeaderCellComponent } from './table-header-cell/table-header-cell.component';
export type { CuiTableSort } from './table-header-cell/table-header-cell.component';

export { CuiTableRowComponent } from './table-row/table-row.component';

export { CuiPageButtonComponent } from './page-button/page-button.component';

export { CuiSpinnerComponent } from './spinner/spinner.component';
export type { CuiSpinnerSize } from './spinner/spinner.component';

export { CuiToggleComponent } from './toggle/toggle.component';
export type { CuiToggleSize } from './toggle/toggle.component';

export { CuiMultiSelectComponent } from './multi-select/multi-select.component';

export { CuiCalendarComponent } from './calendar/calendar.component';
export type { CuiCalendarMode, CuiCalendarRange } from './calendar/calendar.component';
export {
  CUI_DATE_CONFIG,
  CUI_DATE_CONFIG_DEFAULTS,
  provideCuiDateConfig,
} from './calendar/calendar.config';
export type { CuiDateConfig } from './calendar/calendar.config';

export { CuiDatePickerComponent } from './date-picker/date-picker.component';
export { CuiDateTimePickerComponent } from './date-time-picker/date-time-picker.component';
export {
  CuiDateRangePickerComponent,
  CUI_DEFAULT_DATE_RANGE_PRESETS,
} from './date-range-picker/date-range-picker.component';
export type { CuiDateRangePreset } from './date-range-picker/date-range-picker.component';

export { CuiTimeColumnComponent } from './time-column/time-column.component';
export { CuiTimePickerComponent } from './time-picker/time-picker.component';
export { CuiMonthPickerComponent } from './month-picker/month-picker.component';
export { CuiYearPickerComponent } from './year-picker/year-picker.component';
