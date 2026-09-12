import {
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  forwardRef,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CuiIconComponent, CuiIconName } from '../icon/icon.component';
import { CuiCalendarComponent } from '../calendar/calendar.component';
import { CUI_DATE_CONFIG } from '../calendar/calendar.config';
import { formatDate, startOfDay, startOfMonth } from '../calendar/calendar.utils';
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

@Component({
  selector: 'cui-date-picker',
  standalone: true,
  imports: [CuiIconComponent, CuiCalendarComponent],
  templateUrl: './date-picker.component.html',
  host: {
    class: 'block relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CuiDatePickerComponent),
      multi: true,
    },
  ],
})
export class CuiDatePickerComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly config = inject(CUI_DATE_CONFIG);

  readonly inputId = input<string>(`cui-date-picker-${++uid}`);
  readonly name = input<string | undefined>(undefined);

  readonly label = input<string | undefined>(undefined);
  readonly placeholder = input<string>('Select date…');
  readonly hint = input<string | undefined>(undefined);
  readonly error = input<string | undefined>(undefined);

  readonly size = input<CuiPickerSize>('md');
  readonly required = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly success = input(false, { transform: booleanAttribute });

  readonly prefixIcon = input<CuiIconName | undefined>('calendar');
  readonly clearable = input(true, { transform: booleanAttribute });
  readonly showToday = input(true, { transform: booleanAttribute });

  readonly min = input<Date | null>(null);
  readonly max = input<Date | null>(null);
  readonly disabledDates = input<((d: Date) => boolean) | null>(null);
  readonly weekStartsOn = input<0 | 1 | 2 | 3 | 4 | 5 | 6 | null>(null);
  readonly locale = input<string | null>(null);

  readonly value = model<Date | null>(null);
  protected readonly viewMonth = signal<Date>(startOfMonth(new Date()));

  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  protected readonly isOpen = signal(false);

  protected readonly hasError = computed(() => !!this.error());
  protected readonly hasValue = computed(() => this.value() != null);

  protected readonly resolvedLocale = computed(() => this.locale() ?? this.config.locale);

  protected readonly displayLabel = computed(() => {
    const v = this.value();
    return v ? formatDate(v, this.resolvedLocale()) : this.placeholder();
  });

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

  // ControlValueAccessor -------------------------------------------------
  private onChange: (v: Date | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    if (v == null) {
      this.value.set(null);
      return;
    }
    const d = v instanceof Date ? v : new Date(v as string);
    this.value.set(isNaN(d.getTime()) ? null : startOfDay(d));
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

  // Interactions ---------------------------------------------------------

  protected toggle(): void {
    if (this.isDisabled()) return;
    this.isOpen() ? this.close() : this.open();
  }

  private open(): void {
    this.isOpen.set(true);
    const v = this.value();
    this.viewMonth.set(startOfMonth(v ?? new Date()));
  }

  protected close(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.onTouched();
  }

  protected onDaySelect(d: Date): void {
    this.commit(startOfDay(d));
    this.close();
  }

  protected onTodayClick(): void {
    this.commit(startOfDay(new Date()));
    this.close();
  }

  protected onClearClick(): void {
    this.commit(null);
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
      this.open();
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
