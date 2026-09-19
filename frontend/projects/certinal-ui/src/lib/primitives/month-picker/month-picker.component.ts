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
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CuiIconComponent, CuiIconName } from '../icon/icon.component';
import { CUI_DATE_CONFIG } from '../calendar/calendar.config';
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
  selector: 'cui-month-picker',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './month-picker.component.html',
  host: {
    class: 'block relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CuiMonthPickerComponent),
      multi: true,
    },
  ],
})
export class CuiMonthPickerComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly config = inject(CUI_DATE_CONFIG);

  readonly inputId = input<string>(`cui-month-picker-${++uid}`);
  readonly name = input<string | undefined>(undefined);

  readonly label = input<string | undefined>(undefined);
  readonly placeholder = input<string>('Select month…');
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
  readonly disabledMonths = input<((d: Date) => boolean) | null>(null);
  readonly locale = input<string | null>(null);

  /** Always normalised to the 1st of the month, midnight. */
  readonly value = model<Date | null>(null);

  protected readonly viewYear = signal<number>(new Date().getFullYear());

  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  protected readonly isOpen = signal(false);

  protected readonly hasError = computed(() => !!this.error());
  protected readonly hasValue = computed(() => this.value() != null);

  protected readonly resolvedLocale = computed(() => this.locale() ?? this.config.locale);

  protected readonly displayLabel = computed(() => {
    const v = this.value();
    if (!v) return this.placeholder();
    return new Intl.DateTimeFormat(this.resolvedLocale(), {
      month: 'long',
      year: 'numeric',
    }).format(v);
  });

  protected readonly monthLabels = computed<string[]>(() => {
    const fmt = new Intl.DateTimeFormat(this.resolvedLocale(), { month: 'short' });
    return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(2000, m, 1)));
  });

  protected readonly canGoPrevYear = computed(() => {
    const min = this.min();
    if (!min) return true;
    return min.getFullYear() < this.viewYear();
  });
  protected readonly canGoNextYear = computed(() => {
    const max = this.max();
    if (!max) return true;
    return max.getFullYear() > this.viewYear();
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
  private onChange: (v: Date | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    if (v == null) {
      this.value.set(null);
      return;
    }
    const d = v instanceof Date ? v : new Date(v as string);
    if (isNaN(d.getTime())) {
      this.value.set(null);
      return;
    }
    this.value.set(new Date(d.getFullYear(), d.getMonth(), 1));
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
    effect(() => {
      if (!this.isOpen()) return;
      const v = this.value();
      this.viewYear.set(v ? v.getFullYear() : new Date().getFullYear());
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

  protected isMonthSelected(monthIndex: number): boolean {
    const v = this.value();
    if (!v) return false;
    return v.getFullYear() === this.viewYear() && v.getMonth() === monthIndex;
  }

  protected isMonthDisabled(monthIndex: number): boolean {
    const candidate = new Date(this.viewYear(), monthIndex, 1);
    const min = this.min();
    if (min) {
      const minStart = new Date(min.getFullYear(), min.getMonth(), 1);
      if (candidate < minStart) return true;
    }
    const max = this.max();
    if (max) {
      const maxStart = new Date(max.getFullYear(), max.getMonth(), 1);
      if (candidate > maxStart) return true;
    }
    const fn = this.disabledMonths();
    return fn ? fn(candidate) : false;
  }

  protected monthCellClasses(monthIndex: number): string {
    const base = [
      'h-12 inline-flex items-center justify-center',
      'rounded-md text-t-300 cursor-pointer transition-colors',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400',
    ];
    if (this.isMonthDisabled(monthIndex)) {
      base.push('text-text-faint cursor-not-allowed opacity-40');
    } else if (this.isMonthSelected(monthIndex)) {
      base.push('bg-emerald-600 text-white font-medium hover:bg-emerald-700');
    } else {
      base.push('text-text-primary hover:bg-bg-subtle');
    }
    return base.join(' ');
  }

  protected onMonthClick(monthIndex: number): void {
    if (this.isMonthDisabled(monthIndex)) return;
    this.commit(new Date(this.viewYear(), monthIndex, 1));
    this.close();
  }

  protected goToPrevYear(): void {
    if (!this.canGoPrevYear()) return;
    this.viewYear.update((y) => y - 1);
  }

  protected goToNextYear(): void {
    if (!this.canGoNextYear()) return;
    this.viewYear.update((y) => y + 1);
  }

  protected onClearClick(): void {
    this.commit(null);
    this.close();
  }

  protected onThisMonthClick(): void {
    const t = new Date();
    this.commit(new Date(t.getFullYear(), t.getMonth(), 1));
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
