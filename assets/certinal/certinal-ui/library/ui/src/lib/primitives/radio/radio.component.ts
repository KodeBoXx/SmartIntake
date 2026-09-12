import {
  Component,
  booleanAttribute,
  computed,
  forwardRef,
  input,
  model,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type CuiRadioSize = 'sm' | 'md';

let uid = 0;

@Component({
  selector: 'cui-radio',
  standalone: true,
  template: `
    <label [class]="wrapperClasses()" [attr.for]="inputId()">
      <span [class]="boxWrapperClasses()">
        <input
          type="radio"
          class="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          [id]="inputId()"
          [name]="name()"
          [value]="value()"
          [checked]="checked()"
          [disabled]="isDisabled()"
          (change)="onSelect()"
          (blur)="onBlur()"
        />
        <span [class]="ringClasses()">
          @if (checked()) {
            <span [class]="dotClasses()"></span>
          }
        </span>
      </span>

      @if (label()) {
        <span [class]="labelClasses()">{{ label() }}</span>
      }
    </label>
  `,
  host: {
    class: 'inline-block',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CuiRadioComponent),
      multi: true,
    },
  ],
})
export class CuiRadioComponent implements ControlValueAccessor {
  readonly inputId = input<string>(`cui-radio-${++uid}`);
  readonly name = input.required<string>();
  readonly value = input.required<string>();
  readonly label = input<string | undefined>(undefined);
  readonly size = input<CuiRadioSize>('md');

  readonly checked = model<boolean>(false);
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  protected readonly wrapperClasses = computed(() =>
    [
      'inline-flex items-center gap-3',
      this.isDisabled() ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
    ].join(' '),
  );

  protected readonly boxWrapperClasses = computed(() => {
    const c = ['relative inline-block shrink-0'];
    c.push(this.size() === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]');
    return c.join(' ');
  });

  protected readonly ringClasses = computed(() => {
    const c = [
      'absolute inset-0 flex items-center justify-center rounded-full',
      'border-[1.5px] bg-bg-surface',
      'transition-colors duration-150',
    ];
    if (this.checked()) {
      c.push('border-emerald-500');
    } else {
      c.push('border-border-strong');
      if (!this.isDisabled()) c.push('peer-hover:border-emerald-400');
    }
    c.push('peer-focus-visible:ring-[3px] peer-focus-visible:ring-emerald-400/15');
    return c.join(' ');
  });

  protected readonly dotClasses = computed(() => {
    const c = ['rounded-full bg-emerald-500'];
    c.push(this.size() === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2');
    return c.join(' ');
  });

  protected readonly labelClasses = computed(() => {
    const c = ['leading-snug select-none text-text-primary'];
    c.push(this.size() === 'sm' ? 'text-t-200' : 'text-t-300');
    return c.join(' ');
  });

  // ControlValueAccessor — value here is the *currently selected* group value
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    this.checked.set(v === this.value());
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.cvaDisabled.set(d);
  }

  protected onSelect(): void {
    this.checked.set(true);
    this.onChange(this.value());
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
