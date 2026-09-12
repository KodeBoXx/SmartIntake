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
import { CuiIconComponent, CuiIconSize } from '../icon/icon.component';

export type CuiCheckboxSize = 'sm' | 'md';

let uid = 0;

@Component({
  selector: 'cui-checkbox',
  standalone: true,
  imports: [CuiIconComponent],
  template: `
    <label [class]="wrapperClasses()" [attr.for]="inputId()">
      <span [class]="boxWrapperClasses()">
        <input
          type="checkbox"
          class="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          [id]="inputId()"
          [name]="name()"
          [checked]="checked()"
          [disabled]="isDisabled()"
          [attr.aria-checked]="indeterminate() ? 'mixed' : checked()"
          (change)="onChangeEvent($event)"
          (blur)="onBlur()"
        />
        <span [class]="boxClasses()">
          @if (indeterminate()) {
            <cui-icon name="minus" [size]="iconSize()" />
          } @else if (checked()) {
            <cui-icon name="check" [size]="iconSize()" />
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
      useExisting: forwardRef(() => CuiCheckboxComponent),
      multi: true,
    },
  ],
})
export class CuiCheckboxComponent implements ControlValueAccessor {
  readonly inputId = input<string>(`cui-checkbox-${++uid}`);
  readonly name = input<string | undefined>(undefined);
  readonly label = input<string | undefined>(undefined);
  readonly size = input<CuiCheckboxSize>('md');

  readonly checked = model<boolean>(false);
  readonly indeterminate = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  protected readonly iconSize = computed<CuiIconSize>(() => 'xs');

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

  protected readonly boxClasses = computed(() => {
    const c = [
      'absolute inset-0 flex items-center justify-center',
      'border-[1.5px] rounded',
      'transition-colors duration-150',
    ];

    const active = this.checked() || this.indeterminate();
    if (active) {
      c.push('bg-emerald-500 border-emerald-500 text-white');
      if (!this.isDisabled()) c.push('peer-hover:bg-emerald-600 peer-hover:border-emerald-600');
    } else {
      c.push('bg-bg-surface border-border-strong');
      if (!this.isDisabled()) c.push('peer-hover:border-emerald-400');
    }
    c.push('peer-focus-visible:ring-[3px] peer-focus-visible:ring-emerald-400/15');
    return c.join(' ');
  });

  protected readonly labelClasses = computed(() => {
    const c = ['type-body-sm leading-snug select-none', 'text-text-primary'];
    if (this.size() === 'sm') c.push('text-t-200');
    else c.push('text-t-300');
    return c.join(' ');
  });

  // ControlValueAccessor
  private onChange: (v: boolean) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    this.checked.set(!!v);
  }
  registerOnChange(fn: (v: boolean) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.cvaDisabled.set(d);
  }

  protected onChangeEvent(e: Event): void {
    const next = (e.target as HTMLInputElement).checked;
    this.checked.set(next);
    this.onChange(next);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
