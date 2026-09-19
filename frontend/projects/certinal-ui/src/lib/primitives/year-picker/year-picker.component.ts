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
  selector: 'cui-year-picker',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './year-picker.component.html',
  host: {
    class: 'block relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CuiYearPickerComponent),
      multi: true,
    },
  ],
})
export class CuiYearPickerComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly inputId = input<string>(`cui-year-picker-${++uid}`);
  readonly name = input<string | undefined>(undefined);

  readonly label = input<string | undefined>(undefined);
  readonly placeholder = input<string>('Select year…');
  readonly hint = input<string | undefined>(undefined);
  readonly error = input<string | undefined>(undefined);

  readonly size = input<CuiPickerSize>('md');
  readonly required = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly success = input(false, { transform: booleanAttribute });

  readonly prefixIcon = input<CuiIconName | undefined>('calendar');
  readonly clearable = input(true, { transform: booleanAttribute });

  readonly min = input<number | null>(null);
  readonly max = input<number | null>(null);

  readonly value = model<number | null>(null);

  protected readonly viewDecadeStart = signal<number>(
    Math.floor(new Date().getFullYear() / 10) * 10,
  );

  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  protected readonly isOpen = signal(false);

  protected readonly hasError = computed(() => !!this.error());
  protected readonly hasValue = computed(() => this.value() != null);

  protected readonly displayLabel = computed(() => {
    const v = this.value();
    return v != null ? String(v) : this.placeholder();
  });

  /** 12 cells: decade-1, decade-end+2 — first/last shown faded as "outside decade". */
  protected readonly yearGrid = computed<number[]>(() => {
    const start = this.viewDecadeStart() - 1;
    return Array.from({ length: 12 }, (_, i) => start + i);
  });

  protected readonly decadeLabel = computed(() => {
    const s = this.viewDecadeStart();
    return `${s} – ${s + 9}`;
  });

  protected readonly canGoPrevDecade = computed(() => {
    const min = this.min();
    if (min == null) return true;
    return min < this.viewDecadeStart();
  });
  protected readonly canGoNextDecade = computed(() => {
    const max = this.max();
    if (max == null) return true;
    return max > this.viewDecadeStart() + 9;
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
  private onChange: (v: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    if (v == null) {
      this.value.set(null);
      return;
    }
    const n = typeof v === 'number' ? v : Number(v);
    this.value.set(Number.isFinite(n) ? n : null);
  }
  registerOnChange(fn: (v: number | null) => void): void {
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
      const center = v ?? new Date().getFullYear();
      this.viewDecadeStart.set(Math.floor(center / 10) * 10);
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

  protected isYearSelected(year: number): boolean {
    return this.value() === year;
  }

  protected isYearDisabled(year: number): boolean {
    const min = this.min();
    if (min != null && year < min) return true;
    const max = this.max();
    if (max != null && year > max) return true;
    return false;
  }

  protected isYearOutsideDecade(year: number): boolean {
    const s = this.viewDecadeStart();
    return year < s || year >= s + 10;
  }

  protected yearCellClasses(year: number): string {
    const base = [
      'h-12 inline-flex items-center justify-center',
      'rounded-md text-t-300 cursor-pointer transition-colors',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400',
    ];
    if (this.isYearDisabled(year)) {
      base.push('text-text-faint cursor-not-allowed opacity-40');
    } else if (this.isYearSelected(year)) {
      base.push('bg-emerald-600 text-white font-medium hover:bg-emerald-700');
    } else if (this.isYearOutsideDecade(year)) {
      base.push('text-text-faint hover:bg-bg-subtle');
    } else {
      base.push('text-text-primary hover:bg-bg-subtle');
    }
    return base.join(' ');
  }

  protected onYearClick(year: number): void {
    if (this.isYearDisabled(year)) return;
    this.commit(year);
    if (this.isYearOutsideDecade(year)) {
      this.viewDecadeStart.set(Math.floor(year / 10) * 10);
    }
    this.close();
  }

  protected goToPrevDecade(): void {
    if (!this.canGoPrevDecade()) return;
    this.viewDecadeStart.update((s) => s - 10);
  }

  protected goToNextDecade(): void {
    if (!this.canGoNextDecade()) return;
    this.viewDecadeStart.update((s) => s + 10);
  }

  protected onClearClick(): void {
    this.commit(null);
    this.close();
  }

  protected onThisYearClick(): void {
    this.commit(new Date().getFullYear());
    this.close();
  }

  private commit(v: number | null): void {
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
