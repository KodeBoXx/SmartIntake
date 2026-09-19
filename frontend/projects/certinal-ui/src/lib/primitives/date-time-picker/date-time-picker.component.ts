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
import { CuiCalendarComponent } from '../calendar/calendar.component';
import { CuiTimeColumnComponent } from '../time-column/time-column.component';
import { CUI_DATE_CONFIG } from '../calendar/calendar.config';
import {
  formatDateTime,
  setTime,
  startOfDay,
  startOfMonth,
} from '../calendar/calendar.utils';
import {
  CuiPickerSize,
  cuiPickerFooterLinkClasses,
  cuiPickerFooterPrimaryClasses,
  cuiPickerIconSize,
  cuiPickerIconWrapperClasses,
  cuiPickerLabelClasses,
  cuiPickerPanelClasses,
  cuiPickerPanelFooterClasses,
  cuiPickerTriggerClasses,
} from '../calendar/picker-trigger';

let uid = 0;

@Component({
  selector: 'cui-date-time-picker',
  standalone: true,
  imports: [CuiIconComponent, CuiCalendarComponent, CuiTimeColumnComponent],
  templateUrl: './date-time-picker.component.html',
  host: {
    class: 'block relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CuiDateTimePickerComponent),
      multi: true,
    },
  ],
})
export class CuiDateTimePickerComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly config = inject(CUI_DATE_CONFIG);

  readonly inputId = input<string>(`cui-date-time-picker-${++uid}`);
  readonly name = input<string | undefined>(undefined);

  readonly label = input<string | undefined>(undefined);
  readonly placeholder = input<string>('Select date & time…');
  readonly hint = input<string | undefined>(undefined);
  readonly error = input<string | undefined>(undefined);

  readonly size = input<CuiPickerSize>('md');
  readonly required = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly success = input(false, { transform: booleanAttribute });

  readonly prefixIcon = input<CuiIconName | undefined>('clock');
  readonly clearable = input(true, { transform: booleanAttribute });

  readonly min = input<Date | null>(null);
  readonly max = input<Date | null>(null);
  readonly disabledDates = input<((d: Date) => boolean) | null>(null);
  readonly weekStartsOn = input<0 | 1 | 2 | 3 | 4 | 5 | 6 | null>(null);
  readonly locale = input<string | null>(null);

  /** Minute step for the minute column. Defaults to 15. */
  readonly step = input(15, { transform: numberAttribute });
  /** 24-hour clock; null = use config default. */
  readonly use24Hour = input<boolean | null>(null);

  readonly value = model<Date | null>(null);

  protected readonly viewMonth = signal<Date>(startOfMonth(new Date()));

  // Pending state — user picks date + time, then Apply commits.
  protected readonly pendingDate = signal<Date | null>(null);
  protected readonly pendingHour = signal<number>(9);
  protected readonly pendingMinute = signal<number>(0);

  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  protected readonly isOpen = signal(false);

  protected readonly hasError = computed(() => !!this.error());
  protected readonly hasValue = computed(() => this.value() != null);
  protected readonly resolvedLocale = computed(() => this.locale() ?? this.config.locale);
  protected readonly resolvedUse24Hour = computed(
    () => this.use24Hour() ?? this.config.use24Hour,
  );

  protected readonly displayLabel = computed(() => {
    const v = this.value();
    return v
      ? formatDateTime(v, this.resolvedLocale(), this.resolvedUse24Hour())
      : this.placeholder();
  });

  protected readonly canApply = computed(() => this.pendingDate() !== null);

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
  protected readonly footerPrimaryClasses = cuiPickerFooterPrimaryClasses();

  // CVA ------------------------------------------------------------------
  private onChange: (v: Date | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    if (v == null) {
      this.value.set(null);
      return;
    }
    const d = v instanceof Date ? v : new Date(v as string);
    this.value.set(isNaN(d.getTime()) ? null : d);
  }
  registerOnChange(fn: (v: Date | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.cvaDisabled.set(d);
  }

  constructor() {
    // When the popover opens, copy current value (or sensible defaults) into pending state.
    effect(() => {
      if (!this.isOpen()) return;
      const v = this.value();
      if (v) {
        this.pendingDate.set(startOfDay(v));
        this.pendingHour.set(v.getHours());
        this.pendingMinute.set(roundToStep(v.getMinutes(), this.step()));
        this.viewMonth.set(startOfMonth(v));
      } else {
        this.pendingDate.set(null);
        this.pendingHour.set(9);
        this.pendingMinute.set(0);
        this.viewMonth.set(startOfMonth(new Date()));
      }
    });
  }

  // Interactions ---------------------------------------------------------

  protected toggle(): void {
    if (this.isDisabled()) return;
    this.isOpen() ? this.close() : (this.isOpen.set(true));
  }

  protected close(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.onTouched();
  }

  protected onDaySelect(d: Date): void {
    this.pendingDate.set(startOfDay(d));
  }

  protected onNowClick(): void {
    const now = new Date();
    this.pendingDate.set(startOfDay(now));
    this.pendingHour.set(now.getHours());
    this.pendingMinute.set(roundToStep(now.getMinutes(), this.step()));
    this.viewMonth.set(startOfMonth(now));
  }

  protected onClearClick(): void {
    this.commit(null);
    this.close();
  }

  protected onApplyClick(): void {
    const d = this.pendingDate();
    if (!d) return;
    this.commit(setTime(d, this.pendingHour(), this.pendingMinute()));
    this.close();
  }

  private commit(v: Date | null): void {
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
}

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.min(59, Math.round(value / step) * step);
}
