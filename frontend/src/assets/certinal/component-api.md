# @certinal/ui — component API

Generated from library/ui/src/lib by scripts/extract-component-api.py. Do not hand-edit.

Legend: `name!` required input · `name↔` two-way `model()` · otherwise an optional
`input()` with its default. All components are standalone; import the class from
`@certinal/ui` and list it in the consumer's `imports: [...]`.

## `CuiIconName` — 51 registered names (closed union)

An unregistered name renders an empty box plus a console error.

```
consent-flow consent-rights consent-govern consent-map menu close
search bell settings grid link plus
chevron-down chevron-left chevron-right panel-left-close panel-left-open more-vertical
more-horizontal dashboard file-text shield shield-check cookie
database pen-tool send activity target map-pin
receipt monitor globe bar-chart-3 user users
user-check inbox trash-2 download pencil eye
clock calendar trending-up check minus info
alert-triangle alert-circle check-circle
```

## primitives (43)

### `[cuiTooltip]` — CuiTooltipDirective
- type `CuiTooltipPosition` = 'top' | 'bottom' | 'left' | 'right'
- inputs: `cuiTooltip`: string = '', `tooltipPosition`: CuiTooltipPosition = 'top'

### `cui-avatar` — CuiAvatarComponent
- type `CuiAvatarSize` = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
- inputs: `size`: CuiAvatarSize = 'md', `src`: string = '', `initials`: string = '', `alt`: string = ''

### `cui-badge` — CuiBadgeComponent
- type `CuiBadgeVariant` = 'emerald' | 'lime' | 'success' | 'warning' | 'error' | 'info' | 'neutral'
- inputs: `variant`: CuiBadgeVariant = 'neutral', `dot`: boolean = false

### `cui-button` — CuiButtonComponent
- type `CuiButtonVariant` = 'primary' | 'primary02' | 'secondary' | 'secondary02' | 'tertiary' | 'danger'
- type `CuiButtonSize` = 'sm' | 'md' | 'lg' | 'xl'
- inputs: `variant`: CuiButtonVariant = 'primary', `size`: CuiButtonSize = 'md', `loading`: boolean = false, `disabled`: boolean = false, `iconOnly`: boolean = false, `type`: 'button' | 'submit' | 'reset' = 'button'
- outputs: `buttonClick<MouseEvent>`

### `cui-calendar` — CuiCalendarComponent
- type `CuiCalendarMode` = 'single' | 'range'
- interface `CuiCalendarRange`
- inputs: `id`: string = `cui-calendar-${++uid}`, `mode`: CuiCalendarMode = 'single', `viewMonth`↔: Date = startOfMonth(new Date()), `selected`: Date | CuiCalendarRange | null = null, `rangeHover`: Date | null = null, `min`: Date | null = null, `max`: Date | null = null, `disabledDates`: ((d: Date) => boolean) | null = null, `weekStartsOn`: 0 | 1 | 2 | 3 | 4 | 5 | 6 | null = null, `locale`: string | null = null, `showOutsideDays`: boolean = true, `ariaLabel`: string | undefined = undefined
- outputs: `daySelect<Date>`, `dayHover<Date | null>`

### `cui-card-body` — CuiCardBodyComponent

### `cui-card-footer` — CuiCardFooterComponent

### `cui-card-header` — CuiCardHeaderComponent

### `cui-card-icon` — CuiCardIconComponent
- type `CuiCardIconSize` = 'sm' | 'md' | 'lg'
- inputs: `size`: CuiCardIconSize = 'md'

### `cui-card-title` — CuiCardTitleComponent
- type `CuiCardTitleSize` = 'sm' | 'md' | 'lg'
- inputs: `size`: CuiCardTitleSize = 'md'

### `cui-checkbox` — CuiCheckboxComponent
- type `CuiCheckboxSize` = 'sm' | 'md'
- inputs: `inputId`: string = `cui-checkbox-${++uid}`, `name`: string | undefined = undefined, `label`: string | undefined = undefined, `size`: CuiCheckboxSize = 'md', `checked`↔: boolean = false, `indeterminate`: boolean = false, `disabled`: boolean = false

### `cui-chip` — CuiChipComponent
- type `CuiChipSize` = 'sm' | 'md'
- inputs: `active`: boolean = false, `disabled`: boolean = false, `removable`: boolean = false, `size`: CuiChipSize = 'md'

### `cui-date-picker` — CuiDatePickerComponent
- inputs: `inputId`: string = `cui-date-picker-${++uid}`, `name`: string | undefined = undefined, `label`: string | undefined = undefined, `placeholder`: string = 'Select date…', `hint`: string | undefined = undefined, `error`: string | undefined = undefined, `size`: CuiPickerSize = 'md', `required`: boolean = false, `disabled`: boolean = false, `success`: boolean = false, `prefixIcon`: CuiIconName | undefined = 'calendar', `clearable`: boolean = true, `showToday`: boolean = true, `min`: Date | null = null, `max`: Date | null = null, `disabledDates`: ((d: Date) => boolean) | null = null, `weekStartsOn`: 0 | 1 | 2 | 3 | 4 | 5 | 6 | null = null, `locale`: string | null = null, `value`↔: Date | null = null

### `cui-date-range-picker` — CuiDateRangePickerComponent
- interface `CuiDateRangePreset`
- inputs: `inputId`: string = `cui-date-range-picker-${++uid}`, `name`: string | undefined = undefined, `label`: string | undefined = undefined, `placeholder`: string = 'Select date range…', `hint`: string | undefined = undefined, `error`: string | undefined = undefined, `size`: CuiPickerSize = 'md', `required`: boolean = false, `disabled`: boolean = false, `success`: boolean = false, `prefixIcon`: CuiIconName | undefined = 'calendar', `clearable`: boolean = true, `min`: Date | null = null, `max`: Date | null = null, `disabledDates`: ((d: Date) => boolean) | null = null, `weekStartsOn`: 0 | 1 | 2 | 3 | 4 | 5 | 6 | null = null, `locale`: string | null = null, `maxRangeDays`: number | null = null, `presets`: CuiDateRangePreset[] = CUI_DEFAULT_DATE_RANGE_PRESETS, `numberOfMonths`: number = 2, `value`↔: CuiCalendarRange | null = null

### `cui-date-time-picker` — CuiDateTimePickerComponent
- inputs: `inputId`: string = `cui-date-time-picker-${++uid}`, `name`: string | undefined = undefined, `label`: string | undefined = undefined, `placeholder`: string = 'Select date & time…', `hint`: string | undefined = undefined, `error`: string | undefined = undefined, `size`: CuiPickerSize = 'md', `required`: boolean = false, `disabled`: boolean = false, `success`: boolean = false, `prefixIcon`: CuiIconName | undefined = 'clock', `clearable`: boolean = true, `min`: Date | null = null, `max`: Date | null = null, `disabledDates`: ((d: Date) => boolean) | null = null, `weekStartsOn`: 0 | 1 | 2 | 3 | 4 | 5 | 6 | null = null, `locale`: string | null = null, `step`: number = 15, `use24Hour`: boolean | null = null, `value`↔: Date | null = null

### `cui-divider` — CuiDividerComponent
- type `CuiDividerOrientation` = 'horizontal' | 'vertical'
- inputs: `orientation`: CuiDividerOrientation = 'horizontal', `spacing`: 'sm' | 'md' | 'lg' = 'md'

### `cui-icon` — CuiIconComponent
- type `CuiIconName` = // Brand / product | 'consent-flow' | 'consent-rights' | 'consent-govern' | 'consent-map' // Core UI | 'menu' | 'close' | 'search' | 'bell' | 'settings' | 'grid' | 'link' | 'plus' | 'chevron-down' | 'chevron-left' | 'chevron-right' | 'panel-left-close' | 'panel-left-open' | 'more-vertical' | 'more-horizontal' // Nav / layout | 'dashboard' | 'file-text' | 'shield' | 'shield-check' | 'cookie' | 'database' // Consent Flow items | 'pen-tool' | 'send' | 'activity' // DPDP items | 'target' | 'map-pin' | 'receipt' // Cookie items | 'monitor' | 'globe' | 'bar-chart-3' // Consent Rights items | 'user' | 'users' | 'user-check' | 'inbox' | 'trash-2' | 'download' | 'pencil' | 'eye' | 'clock' | 'calendar' | 'trending-up' // Form controls | 'check' | 'minus' // Status | 'info' | 'alert-triangle' | 'alert-circle' | 'check-circle'
- type `CuiIconSize` = 'xs' | 'sm' | 'md' | 'lg'
- inputs: `name`!: CuiIconName, `size`: CuiIconSize = 'sm'

### `cui-icon-button` — CuiIconButtonComponent
- type `CuiIconButtonVariant` = 'default' | 'primary' | 'danger' | 'inverse'
- type `CuiIconButtonSize` = 'sm' | 'md' | 'lg'
- inputs: `variant`: CuiIconButtonVariant = 'default', `size`: CuiIconButtonSize = 'md', `disabled`: boolean = false, `badge`: boolean = false, `type`: 'button' | 'submit' | 'reset' = 'button', `ariaLabel`: string = '', `ariaExpanded`: boolean | null = null, `ariaControls`: string | null = null
- outputs: `buttonClick<MouseEvent>`

### `cui-input` — CuiInputComponent
- type `CuiInputType` = | 'text' | 'email' | 'password' | 'number' | 'search' | 'url' | 'tel' | 'date' | 'datetime-local' | 'textarea'
- type `CuiInputSize` = 'sm' | 'md' | 'lg'
- inputs: `inputId`: string = `cui-input-${++uid}`, `name`: string | undefined = undefined, `label`: string | undefined = undefined, `placeholder`: string = '', `hint`: string | undefined = undefined, `error`: string | undefined = undefined, `type`: CuiInputType = 'text', `size`: CuiInputSize = 'md', `required`: boolean = false, `readOnly`: boolean = false, `autocomplete`: string | undefined = undefined, `rows`: number = 4, `min`: number | string | undefined = undefined, `max`: number | string | undefined = undefined, `step`: number | string | undefined = undefined, `minlength`: number | undefined = undefined, `maxlength`: number | undefined = undefined, `pattern`: string | undefined = undefined, `prefixIcon`: CuiIconName | undefined = undefined, `suffixIcon`: CuiIconName | undefined = undefined, `value`↔: string = '', `disabled`: boolean = false, `success`: boolean = false

### `cui-logo` — CuiLogoComponent
- type `CuiLogoSize` = 'sm' | 'md' | 'lg'
- inputs: `size`: CuiLogoSize = 'md', `iconOnly`: boolean = false

### `cui-modal-body` — CuiModalBodyComponent

### `cui-modal-footer` — CuiModalFooterComponent
- type `CuiModalFooterAlign` = 'end' | 'start' | 'center' | 'between'
- inputs: `align`: CuiModalFooterAlign = 'end'

### `cui-modal-header` — CuiModalHeaderComponent
- inputs: `title`: string | undefined = undefined, `subtitle`: string | undefined = undefined, `titleId`: string | undefined = undefined

### `cui-month-picker` — CuiMonthPickerComponent
- inputs: `inputId`: string = `cui-month-picker-${++uid}`, `name`: string | undefined = undefined, `label`: string | undefined = undefined, `placeholder`: string = 'Select month…', `hint`: string | undefined = undefined, `error`: string | undefined = undefined, `size`: CuiPickerSize = 'md', `required`: boolean = false, `disabled`: boolean = false, `success`: boolean = false, `prefixIcon`: CuiIconName | undefined = 'calendar', `clearable`: boolean = true, `min`: Date | null = null, `max`: Date | null = null, `disabledMonths`: ((d: Date) => boolean) | null = null, `locale`: string | null = null, `value`↔: Date | null = null

### `cui-multi-select` — CuiMultiSelectComponent
- inputs: `inputId`: string = `cui-multi-select-${++uid}`, `options`: CuiSelectOption[] = [], `value`↔: string[] = [], `placeholder`: string = 'Select…', `searchable`: boolean = true, `size`: CuiSelectSize = 'md', `disabled`: boolean = false, `maxDisplayChips`: number = 3, `confirmable`: boolean = false, `compactDisplay`: boolean = false

### `cui-nav-item` — CuiNavItemComponent
- inputs: `label`!: string, `icon`: CuiIconName | null = null, `active`: boolean = false, `collapsed`: boolean = false, `disabled`: boolean = false, `badge`: string | number | null = null, `indent`: boolean = false
- outputs: `navClick`

### `cui-nav-section` — CuiNavSectionComponent
- inputs: `label`!: string, `icon`: CuiIconName | null = null, `collapsed`: boolean = false, `hasActiveChild`: boolean = false, `defaultExpanded`: boolean = true

### `cui-page-button` — CuiPageButtonComponent
- inputs: `page`!: number, `active`: boolean = false, `disabled`: boolean = false, `type`: 'button' | 'submit' | 'reset' = 'button'
- outputs: `pageClick<number>`

### `cui-product-tab` — CuiProductTabComponent
- inputs: `label`!: string, `active`: boolean = false, `disabled`: boolean = false
- outputs: `tabClick`

### `cui-progress-bar` — CuiProgressBarComponent
- type `CuiProgressBarSize` = 'sm' | 'md'
- inputs: `value`: number = 0, `size`: CuiProgressBarSize = 'md', `indeterminate`: boolean = false

### `cui-radio` — CuiRadioComponent
- type `CuiRadioSize` = 'sm' | 'md'
- inputs: `inputId`: string = `cui-radio-${++uid}`, `name`!: string, `value`!: string, `label`: string | undefined = undefined, `size`: CuiRadioSize = 'md', `checked`↔: boolean = false, `disabled`: boolean = false

### `cui-select` — CuiSelectComponent
- type `CuiSelectSize` = 'sm' | 'md' | 'lg'
- interface `CuiSelectOption`
- inputs: `inputId`: string = `cui-select-${++uid}`, `name`: string | undefined = undefined, `label`: string | undefined = undefined, `placeholder`: string = 'Select…', `hint`: string | undefined = undefined, `error`: string | undefined = undefined, `options`: CuiSelectOption[] = [], `size`: CuiSelectSize = 'md', `required`: boolean = false, `disabled`: boolean = false, `success`: boolean = false, `prefixIcon`: CuiIconName | undefined = undefined, `value`↔: string | null = null

### `cui-skeleton` — CuiSkeletonComponent
- type `CuiSkeletonVariant` = 'text' | 'rect' | 'circle'
- inputs: `variant`: CuiSkeletonVariant = 'text', `width`: string | number | undefined = undefined, `height`: string | number | undefined = undefined

### `cui-spinner` — CuiSpinnerComponent
- type `CuiSpinnerSize` = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
- inputs: `size`: CuiSpinnerSize = 'md'

### `cui-tab` — CuiTabComponent
- type `CuiTabSize` = 'sm' | 'md'
- inputs: `label`!: string, `active`: boolean = false, `disabled`: boolean = false, `size`: CuiTabSize = 'md'
- outputs: `tabClick`

### `cui-tag` — CuiTagComponent
- type `CuiTagTone` = | 'emerald' | 'lime' | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo' | 'violet' | 'pink' | 'amber' | 'stone'
- type `CuiTagSize` = 'sm' | 'md'
- inputs: `tone`: CuiTagTone = 'stone', `size`: CuiTagSize = 'md'

### `cui-time-column` — CuiTimeColumnComponent
- inputs: `hour`!: number, `minute`!: number, `second`: number = 0, `step`: number = 15, `showSeconds`: boolean = false, `use24Hour`: boolean = true
- outputs: `hourChange<number>`, `minuteChange<number>`, `secondChange<number>`

### `cui-time-picker` — CuiTimePickerComponent
- inputs: `inputId`: string = `cui-time-picker-${++uid}`, `name`: string | undefined = undefined, `label`: string | undefined = undefined, `placeholder`: string = 'Select time…', `hint`: string | undefined = undefined, `error`: string | undefined = undefined, `size`: CuiPickerSize = 'md', `required`: boolean = false, `disabled`: boolean = false, `success`: boolean = false, `prefixIcon`: CuiIconName | undefined = 'clock', `clearable`: boolean = true, `step`: number = 15, `showSeconds`: boolean = false, `use24Hour`: boolean | null = null, `value`↔: string | null = null

### `cui-toggle` — CuiToggleComponent
- type `CuiToggleSize` = 'sm' | 'md' | 'lg'
- inputs: `value`↔: boolean = false, `size`: CuiToggleSize = 'md', `disabled`: boolean = false, `label`: string | undefined = undefined

### `cui-year-picker` — CuiYearPickerComponent
- inputs: `inputId`: string = `cui-year-picker-${++uid}`, `name`: string | undefined = undefined, `label`: string | undefined = undefined, `placeholder`: string = 'Select year…', `hint`: string | undefined = undefined, `error`: string | undefined = undefined, `size`: CuiPickerSize = 'md', `required`: boolean = false, `disabled`: boolean = false, `success`: boolean = false, `prefixIcon`: CuiIconName | undefined = 'calendar', `clearable`: boolean = true, `min`: number | null = null, `max`: number | null = null, `value`↔: number | null = null

### `td[cuiTableCell]` — CuiTableCellComponent
- type `CuiTableAlign` = 'left' | 'center' | 'right'
- inputs: `align`: CuiTableAlign = 'left', `truncate`: boolean = false, `nowrap`: boolean = false

### `th[cuiTableHeaderCell]` — CuiTableHeaderCellComponent
- type `CuiTableSort` = 'none' | 'asc' | 'desc'
- inputs: `align`: CuiTableAlign = 'left', `sortable`: boolean = false, `sort`: CuiTableSort = 'none'
- outputs: `sortChange<CuiTableSort>`

### `tr[cuiTableRow]` — CuiTableRowComponent
- inputs: `clickable`: boolean = false, `selected`: boolean = false, `disabled`: boolean = false
- outputs: `rowClick`


## blocks (28)

### `(service) CuiToastService` — CuiToastService
- interface `CuiToastConfig`
- interface `CuiToastInstance`
- methods: `show(config: CuiToastConfig): number`, `success(message: string, title?: string): number`, `error(message: string, title?: string): number`, `warning(message: string, title?: string): number`, `info(message: string, title?: string): number`, `dismiss(id: number): void`, `dismissAll(): void`

### `[cuiHeaderDrawer]` — CuiHeaderDrawerDirective

### `[cuiHeaderIcons]` — CuiHeaderIconsDirective

### `[cuiHeaderTabs]` — CuiHeaderTabsDirective

### `cui-accordion` — CuiAccordionComponent
- interface `CuiAccordionItem`
- inputs: `items`!: CuiAccordionItem[], `multiple`: boolean = false, `expanded`↔: number[] = []

### `cui-alert` — CuiAlertComponent
- type `CuiAlertVariant` = 'info' | 'success' | 'warning' | 'error' | 'neutral'
- inputs: `variant`: CuiAlertVariant = 'info', `title`: string | undefined = undefined, `closable`: boolean = false
- outputs: `closed`

### `cui-avatar-group` — CuiAvatarGroupComponent
- interface `CuiAvatarGroupItem`
- inputs: `items`!: CuiAvatarGroupItem[], `size`: CuiAvatarSize = 'md', `max`: number = 4

### `cui-breadcrumb` — CuiBreadcrumbComponent
- interface `CuiBreadcrumbItem`
- interface `CuiBreadcrumbClickEvent`
- inputs: `items`!: CuiBreadcrumbItem[]
- outputs: `itemClick<CuiBreadcrumbClickEvent>`

### `cui-card` — CuiCardComponent
- type `CuiCardVariant` = 'default' | 'elevated' | 'feature' | 'dark'
- type `CuiCardPadding` = 'none' | 'sm' | 'md' | 'lg'
- type `CuiCardStatus` = 'none' | 'success' | 'warning' | 'info' | 'error'
- type `CuiCardAccentColor` = | 'emerald' | 'lime' | 'cyan' | 'neutral' | 'success' | 'warning' | 'error' | 'info'
- inputs: `variant`: CuiCardVariant = 'default', `padding`: CuiCardPadding = 'md', `status`: CuiCardStatus = 'none', `hoverable`: boolean = false, `accentTop`: boolean = false, `accentLeft`: boolean = false, `accentColor`: CuiCardAccentColor = 'emerald', `clickable`: boolean = false, `disabled`: boolean = false

### `cui-data-table` — CuiDataTableComponent
- type `CuiDataTableSort` = 'asc' | 'desc'
- interface `CuiDataTableColumn`
- inputs: `columns`!: CuiDataTableColumn<T>[], `rows`: T[] = [], `rowKey`: string | undefined = undefined, `sortKey`↔: string | null = null, `sortDir`↔: CuiDataTableSort = 'asc', `clickable`: boolean = false, `loading`: boolean = false, `skeletonRows`: number = 5, `emptyMessage`: string = 'No data found', `emptyHint`: string | undefined = undefined
- outputs: `rowClick<T>`

### `cui-drawer` — CuiDrawerComponent
- type `CuiDrawerPosition` = 'left' | 'right' | 'top' | 'bottom'
- type `CuiDrawerSize` = 'sm' | 'md' | 'lg' | 'xl'
- inputs: `open`↔: boolean = false, `position`: CuiDrawerPosition = 'right', `size`: CuiDrawerSize = 'md', `title`: string | undefined = undefined, `closeOnOverlay`: boolean = true, `closeOnEsc`: boolean = true, `showClose`: boolean = true
- outputs: `closed`

### `cui-dropdown` — CuiDropdownComponent
- type `CuiDropdownPlacement` = | 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'
- type `CuiDropdownItemType` = 'item' | 'divider' | 'header'
- interface `CuiDropdownItem`
- inputs: `items`!: CuiDropdownItem[], `placement`: CuiDropdownPlacement = 'bottom-end', `disabled`: boolean = false
- outputs: `itemClick<CuiDropdownItem>`

### `cui-empty-state` — CuiEmptyStateComponent
- inputs: `icon`: CuiIconName = 'inbox', `title`!: string, `description`: string | undefined = undefined

### `cui-header` — CuiHeaderComponent
- inputs: `sticky`: boolean = true, `elevated`: boolean = true
- outputs: `hamburgerClick`

### `cui-metric-card` — CuiMetricCardComponent
- type `CuiMetricStatColor` = | 'primary' | 'muted' | 'success' | 'warning' | 'error'
- type `CuiMetricCardStatus` = 'none' | 'success' | 'warning' | 'error' | 'info'
- interface `CuiMetricStat`
- inputs: `icon`!: CuiIconName, `value`!: string | number, `title`!: string, `valueLabel`: string | undefined = undefined, `stats`: CuiMetricStat[] = [], `accentColor`: CuiCardAccentColor = 'emerald', `accentTop`: boolean = true, `accentLeft`: boolean = false, `status`: CuiMetricCardStatus = 'none', `hoverable`: boolean = false, `clickable`: boolean = false
- outputs: `cardClick`

### `cui-modal` — CuiModalComponent
- type `CuiModalSize` = 'sm' | 'md' | 'lg' | 'xl' | 'full'
- inputs: `open`↔: boolean = false, `size`: CuiModalSize = 'md', `closeOnOverlay`: boolean = true, `closeOnEsc`: boolean = true, `showClose`: boolean = true, `ariaLabel`: string | undefined = undefined
- outputs: `opened`, `closed`

### `cui-paginator` — CuiPaginatorComponent
- inputs: `currentPage`↔: number = 1, `pageSize`↔: number = 10, `totalItems`!: number, `pageSizeOptions`: number[] = [10, 25, 50, 100], `siblingCount`: number = 1, `showPageSize`: boolean = true, `showTotal`: boolean = true

### `cui-platform-tabs` — CuiPlatformTabsComponent
- interface `CuiPlatformTab`
- inputs: `tabs`!: CuiPlatformTab[], `activeId`↔: string = ''
- outputs: `activeChange<string>`

### `cui-popover` — CuiPopoverComponent
- type `CuiPopoverPlacement` = | 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'
- inputs: `placement`: CuiPopoverPlacement = 'bottom-start', `disabled`: boolean = false, `width`: string = '320px'

### `cui-search-bar` — CuiSearchBarComponent
- inputs: `placeholder`: string = 'Search…', `value`↔: string = '', `size`: CuiInputSize = 'md', `disabled`: boolean = false

### `cui-segmented-control` — CuiSegmentedControlComponent
- type `CuiSegmentedSize` = 'sm' | 'md' | 'lg'
- interface `CuiSegmentedOption`
- inputs: `options`!: CuiSegmentedOption[], `value`↔: string = '', `size`: CuiSegmentedSize = 'md', `disabled`: boolean = false

### `cui-sidebar-shell` — CuiSidebarShellComponent
- inputs: `collapsed`: boolean = false, `expandedWidth`: string = '270px', `collapsedWidth`: string = '72px'

### `cui-stats-strip` — CuiStatsStripComponent
- type `CuiStatsStripAccent` = 'emerald' | 'lime' | 'cyan'
- interface `CuiStatsStripItem`
- inputs: `items`!: CuiStatsStripItem[], `defaultAccent`: CuiStatsStripAccent = 'emerald'

### `cui-stepper` — CuiStepperComponent
- type `CuiStepperStatus` = 'pending' | 'current' | 'complete'
- interface `CuiStepperItem`
- inputs: `steps`!: CuiStepperItem[], `currentIndex`↔: number = 0, `clickable`: boolean = false
- outputs: `stepClick<number>`

### `cui-tabs` — CuiTabsComponent
- interface `CuiTabsItem`
- inputs: `tabs`!: CuiTabsItem[], `activeIndex`↔: number = 0, `size`: CuiTabSize = 'md'

### `cui-toast` — CuiToastComponent
- type `CuiToastVariant` = 'success' | 'error' | 'warning' | 'info' | 'neutral'
- inputs: `variant`: CuiToastVariant = 'neutral', `title`: string | undefined = undefined, `message`!: string, `closable`: boolean = true
- outputs: `closed`

### `cui-toast-host` — CuiToastHostComponent
- type `CuiToastPosition` = | 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center'
- inputs: `position`: CuiToastPosition = 'top-right'

### `cui-tree` — CuiTreeComponent
- interface `CuiTreeNode`
- inputs: `nodes`!: CuiTreeNode<T>[], `expanded`↔: string[] = [], `selectedId`↔: string | null = null
- outputs: `nodeClick<CuiTreeNode<T>>`, `toggleChange<{ node: CuiTreeNode<T>; expanded: boolean }>`


## sections (2)

### `(service) CuiConfirmService` — CuiConfirmService
- interface `CuiConfirmConfig`
- methods: `show(config: CuiConfirmConfig): Observable<boolean>`

### `cui-confirm-dialog` — CuiConfirmDialogComponent
- type `CuiConfirmTone` = 'default' | 'danger'
- inputs: `open`↔: boolean = false, `title`!: string, `message`: string | undefined = undefined, `confirmText`: string = 'Confirm', `cancelText`: string = 'Cancel', `tone`: CuiConfirmTone = 'default', `icon`: CuiIconName | undefined = undefined
- outputs: `confirmed`, `cancelled`


## layouts (1)

### `cui-app-shell` — CuiAppShellComponent
- inputs: `maxContentWidth`: number = 1200, `contentPadding`: number = 24, `contentPaddingMobile`: number = 16, `desktopBreakpoint`: number = 1024

