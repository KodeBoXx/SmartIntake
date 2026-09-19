import {
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  model,
  numberAttribute,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CuiIconComponent, CuiIconName } from '../icon/icon.component';
import {
  CuiCalendarComponent,
  CuiCalendarRange,
} from '../calendar/calendar.component';
import { CUI_DATE_CONFIG } from '../calendar/calendar.config';
import {
  addDays,
  addMonths,
  formatDate,
  isBeforeDay,
  startOfDay,
  startOfMonth,
} from '../calendar/calendar.utils';
import {
  CuiPickerSize,
  cuiPickerFooterLinkClasses,
  cuiPickerIconSize,
  cuiPickerIconWrapperClasses,
  cuiPickerLabelClasses,
  cuiPickerPanelClasses,
  cuiPickerPanelFooterClasses,
  cuiPickerTriggerClasses,
} from '../calendar/picker-trigger';

let uid = 0;

export interface CuiDateRangePreset {
  label: string;
  range: () => CuiCalendarRange;
}

export const CUI_DEFAULT_DATE_RANGE_PRESETS: CuiDateRangePreset[] = [
  {
    label: 'Today',
    range: () => {
      const t = startOfDay(new Date());
      return { start: t, end: t };
    },
  },
  {
    label: 'Yesterday',
    range: () => {
      const y = addDays(startOfDay(new Date()), -1);
      return { start: y, end: y };
    },
  },
  {
    label: 'Last 7 days',
    range: () => {
      const end = startOfDay(new Date());
      return { start: addDays(end, -6), end };
    },
  },
  {
    label: 'Last 30 days',
    range: () => {
      const end = startOfDay(new Date());
      return { start: addDays(end, -29), end };
    },
  },
  {
    label: 'This month',
    range: () => {
      const t = startOfDay(new Date());
      const start = startOfMonth(t);
      const end = addDays(addMonths(start, 1), -1);
      return { start, end };
    },
  },
  {
    label: 'Last month',
    range: () => {
      const t = startOfMonth(new Date());
      const start = addMonths(t, -1);
      const end = addDays(t, -1);
      return { start, end };
    },
  },
  {
    label: 'This year',
    range: () => {
      const t = new Date();
      const start = new Date(t.getFullYear(), 0, 1);
      const end = new Date(t.getFullYear(), 11, 31);
      return { start, end };
    },
  },
];

@Component({
  selector: 'cui-date-range-picker',
  standalone: true,
  imports: [CuiIconComponent, CuiCalendarComponent],
  templateUrl: './date-range-picker.component.html',
  host: {
    class: 'block relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CuiDateRangePickerComponent),
      multi: true,
    },
  ],
})
export class CuiDateRangePickerComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly config = inject(CUI_DATE_CONFIG);

  readonly inputId = input<string>(`cui-date-range-picker-${++uid}`);
  readonly name = input<string | undefined>(undefined);

  readonly label = input<string | undefined>(undefined);
  readonly placeholder = input<string>('Select date range…');
  readonly hint = input<string | undefined>(undefined);
  readonly error = input<string | undefined>(undefined);

  readonly size = input<CuiPickerSize>('md');
  readonly required = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly success = input(false, { transform: booleanAttribute });

  readonly prefixIcon = input<CuiIconName | undefined>('calendar');
  readonly clearable = input(true, { transform: booleanAttribute });

  readonly min = input<Date | null>(null);
  readonly max = input<Date | null>(null);
  readonly disabledDates = input<((d: Date) => boolean) | null>(null);
  readonly weekStartsOn = input<0 | 1 | 2 | 3 | 4 | 5 | 6 | null>(null);
  readonly locale = input<string | null>(null);

  /** Maximum span in days (e.g., 90 for "max 3 months"). null = unbounded. */
  readonly maxRangeDays = input<number | null>(null);

  readonly presets = input<CuiDateRangePreset[]>(CUI_DEFAULT_DATE_RANGE_PRESETS);
  readonly numberOfMonths = input(2, { transform: numberAttribute });

  readonly value = model<CuiCalendarRange | null>(null);

  // View state
  protected readonly viewMonthLeft = signal<Date>(startOfMonth(new Date()));
  protected readonly viewMonthRight = computed(() => addMonths(this.viewMonthLeft(), 1));

  // Pending range during selection
  protected readonly pending = signal<CuiCalendarRange>({ start: null, end: null });
  protected readonly rangeHover = signal<Date | null>(null);

  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  protected readonly isOpen = signal(false);

  protected readonly hasError = computed(() => !!this.error());
  protected readonly hasValue = computed(() => {
    const v = this.value();
    return !!(v && v.start && v.end);
  });

  protected readonly resolvedLocale = computed(() => this.locale() ?? this.config.locale);

  protected readonly displayLabel = computed(() => {
    const v = this.value();
    if (!v || !v.start || !v.end) return this.placeholder();
    const loc = this.resolvedLocale();
    return `${formatDate(v.start, loc)} – ${formatDate(v.end, loc)}`;
  });

  // Trigger / panel styling
  protected readonly triggerClasses = computed(() =>
    cuiPickerTriggerClasses({
      size: this.size(),
      isDisabled: this.isDisabled(),
      hasError: this.hasError(),
      isSuccess: this.success(),
      isOpen: this.isOpen(),
      hasValue: this.hasValue(),
    }),
  );
  protected readonly labelClasses = computed(() => cuiPickerLabelClasses(this.hasValue()));
  protected readonly iconWrapperClasses = computed(() =>
    cuiPickerIconWrapperClasses(this.hasError()),
  );
  protected readonly iconSize = computed(() => cuiPickerIconSize(this.size()));
  protected readonly panelClasses = cuiPickerPanelClasses();
  protected readonly footerClasses = cuiPickerPanelFooterClasses();
  protected readonly footerLinkClasses = cuiPickerFooterLinkClasses();

  // CVA ------------------------------------------------------------------
  private onChange: (v: CuiCalendarRange | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    if (!v || typeof v !== 'object') {
      this.value.set(null);
      return;
    }
    const r = v as CuiCalendarRange;
    const start = r.start ? startOfDay(r.start instanceof Date ? r.start : new Date(r.start as string)) : null;
    const end = r.end ? startOfDay(r.end instanceof Date ? r.end : new Date(r.end as string)) : null;
    this.value.set({ start, end });
  }
  registerOnChange(fn: (v: CuiCalendarRange | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.cvaDisabled.set(d);
  }

  constructor() {
    // On open, copy current value into pending and anchor the left calendar to the start month.
    effect(() => {
      if (!this.isOpen()) return;
      const v = this.value();
      if (v && v.start) {
        this.pending.set({ start: v.start, end: v.end ?? null });
        this.viewMonthLeft.set(startOfMonth(v.start));
      } else {
        this.pending.set({ start: null, end: null });
        this.viewMonthLeft.set(startOfMonth(new Date()));
      }
      this.rangeHover.set(null);
    });
  }

  // Interactions ---------------------------------------------------------

  protected toggle(): void {
    if (this.isDisabled()) return;
    this.isOpen() ? this.close() : this.isOpen.set(true);
  }

  protected close(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.onTouched();
  }

  protected onDaySelect(d: Date): void {
    const day = startOfDay(d);
    const cur = this.pending();

    if (!cur.start || (cur.start && cur.end)) {
      // First click of a new range
      this.pending.set({ start: day, end: null });
      this.rangeHover.set(null);
      return;
    }

    // Second click — close the range and commit
    let start = cur.start;
    let end = day;
    if (isBeforeDay(end, start)) [start, end] = [end, start];

    // Enforce maxRangeDays
    const cap = this.maxRangeDays();
    if (cap != null) {
      const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
      if (diff + 1 > cap) {
        // Truncate to the cap, anchored on `start`
        end = addDays(start, cap - 1);
      }
    }

    const range: CuiCalendarRange = { start, end };
    this.pending.set(range);
    this.rangeHover.set(null);
    this.commit(range);
    this.close();
  }

  protected onDayHover(d: Date | null): void {
    this.rangeHover.set(d);
  }

  protected onPresetClick(p: CuiDateRangePreset): void {
    const r = p.range();
    this.pending.set(r);
    if (r.start) this.viewMonthLeft.set(startOfMonth(r.start));
    this.commit(r);
    this.close();
  }

  protected onClearClick(): void {
    this.commit(null);
    this.close();
  }

  protected onCancelClick(): void {
    this.close();
  }

  private commit(v: CuiCalendarRange | null): void {
    this.value.set(v);
    this.onChange(v);
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (this.isDisabled()) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.isOpen.set(true);
    }
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node;
    if (!this.elementRef.nativeElement.contains(target)) this.close();
  }

  protected onEscape(): void {
    if (this.isOpen()) this.close();
  }

  // Sync the right calendar's viewMonth back to the left when the user nav'd it
  protected onRightViewMonthChange(d: Date): void {
    // Right calendar's prev moves the pair back one month; next moves forward.
    this.viewMonthLeft.set(addMonths(d, -1));
  }
}
