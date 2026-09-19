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
import { CUI_DATE_CONFIG } from '../calendar/calendar.config';
import { CuiTimeColumnComponent } from '../time-column/time-column.component';
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
  selector: 'cui-time-picker',
  standalone: true,
  imports: [CuiIconComponent, CuiTimeColumnComponent],
  templateUrl: './time-picker.component.html',
  host: {
    class: 'block relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CuiTimePickerComponent),
      multi: true,
    },
  ],
})
export class CuiTimePickerComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly config = inject(CUI_DATE_CONFIG);

  readonly inputId = input<string>(`cui-time-picker-${++uid}`);
  readonly name = input<string | undefined>(undefined);

  readonly label = input<string | undefined>(undefined);
  readonly placeholder = input<string>('Select time…');
  readonly hint = input<string | undefined>(undefined);
  readonly error = input<string | undefined>(undefined);

  readonly size = input<CuiPickerSize>('md');
  readonly required = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly success = input(false, { transform: booleanAttribute });

  readonly prefixIcon = input<CuiIconName | undefined>('clock');
  readonly clearable = input(true, { transform: booleanAttribute });

  readonly step = input(15, { transform: numberAttribute });
  readonly showSeconds = input(false, { transform: booleanAttribute });
  readonly use24Hour = input<boolean | null>(null);

  /** Canonical 24-hour string `"HH:mm"` (or `"HH:mm:ss"` if `showSeconds`). */
  readonly value = model<string | null>(null);

  // Pending state during popover edit
  protected readonly pendingHour = signal<number>(9);
  protected readonly pendingMinute = signal<number>(0);
  protected readonly pendingSecond = signal<number>(0);

  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  protected readonly isOpen = signal(false);

  protected readonly hasError = computed(() => !!this.error());
  protected readonly hasValue = computed(() => this.value() != null);
  protected readonly resolvedUse24Hour = computed(
    () => this.use24Hour() ?? this.config.use24Hour,
  );

  protected readonly displayLabel = computed(() => {
    const v = this.value();
    if (!v) return this.placeholder();
    return formatTimeForDisplay(v, this.resolvedUse24Hour(), this.showSeconds());
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
  protected readonly footerPrimaryClasses = cuiPickerFooterPrimaryClasses();

  // CVA ------------------------------------------------------------------
  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    if (v == null) {
      this.value.set(null);
      return;
    }
    this.value.set(typeof v === 'string' ? v : null);
  }
  registerOnChange(fn: (v: string | null) => void): void {
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
      if (v) {
        const parts = v.split(':').map(Number);
        this.pendingHour.set(parts[0] ?? 9);
        this.pendingMinute.set(roundToStep(parts[1] ?? 0, this.step()));
        this.pendingSecond.set(roundToStep(parts[2] ?? 0, this.step()));
      } else {
        this.pendingHour.set(9);
        this.pendingMinute.set(0);
        this.pendingSecond.set(0);
      }
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

  protected onNowClick(): void {
    const now = new Date();
    this.pendingHour.set(now.getHours());
    this.pendingMinute.set(roundToStep(now.getMinutes(), this.step()));
    this.pendingSecond.set(roundToStep(now.getSeconds(), this.step()));
  }

  protected onClearClick(): void {
    this.commit(null);
    this.close();
  }

  protected onApplyClick(): void {
    const h = pad2(this.pendingHour());
    const m = pad2(this.pendingMinute());
    const s = pad2(this.pendingSecond());
    this.commit(this.showSeconds() ? `${h}:${m}:${s}` : `${h}:${m}`);
    this.close();
  }

  private commit(v: string | null): void {
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

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.min(59, Math.round(value / step) * step);
}

function formatTimeForDisplay(canonical: string, use24Hour: boolean, showSeconds: boolean): string {
  const parts = canonical.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  if (use24Hour) {
    return showSeconds ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(h)}:${pad2(m)}`;
  }
  const period = h >= 12 ? 'PM' : 'AM';
  const dh = h % 12 === 0 ? 12 : h % 12;
  return showSeconds
    ? `${dh}:${pad2(m)}:${pad2(s)} ${period}`
    : `${dh}:${pad2(m)} ${period}`;
}
