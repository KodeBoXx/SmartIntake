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
import { CuiIconComponent, CuiIconName, CuiIconSize } from '../icon/icon.component';

export type CuiInputType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'search'
  | 'url'
  | 'tel'
  | 'date'
  | 'datetime-local'
  | 'textarea';

export type CuiInputSize = 'sm' | 'md' | 'lg';

let uid = 0;

@Component({
  selector: 'cui-input',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './input.component.html',
  styleUrl: './input.component.css',
  host: {
    class: 'block',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CuiInputComponent),
      multi: true,
    },
  ],
})
export class CuiInputComponent implements ControlValueAccessor {
  // Identity
  readonly inputId = input<string>(`cui-input-${++uid}`);
  readonly name = input<string | undefined>(undefined);

  // Content
  readonly label = input<string | undefined>(undefined);
  readonly placeholder = input<string>('');
  readonly hint = input<string | undefined>(undefined);
  readonly error = input<string | undefined>(undefined);

  // Behavior
  readonly type = input<CuiInputType>('text');
  readonly size = input<CuiInputSize>('md');
  readonly required = input(false, { transform: booleanAttribute });
  readonly readOnly = input(false, { transform: booleanAttribute });
  readonly autocomplete = input<string | undefined>(undefined);
  readonly rows = input<number>(4);
  readonly min = input<number | string | undefined>(undefined);
  readonly max = input<number | string | undefined>(undefined);
  readonly step = input<number | string | undefined>(undefined);
  readonly minlength = input<number | undefined>(undefined);
  readonly maxlength = input<number | undefined>(undefined);
  readonly pattern = input<string | undefined>(undefined);

  // Icons (ignored for textarea)
  readonly prefixIcon = input<CuiIconName | undefined>(undefined);
  readonly suffixIcon = input<CuiIconName | undefined>(undefined);

  // Value is a model — supports [(value)] two-way binding + CVA
  readonly value = model<string>('');

  // Disabled: external attribute input (accepts boolean-attribute shorthand)
  readonly disabled = input(false, { transform: booleanAttribute });
  // Success: validated-ok state (spec §Inputs — emerald/success border)
  readonly success = input(false, { transform: booleanAttribute });
  // Mirror CVA's setDisabledState — effective disabled is either source
  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  // Internal UI state
  protected readonly passwordVisible = signal(false);

  // Derived
  protected readonly isTextarea = computed(() => this.type() === 'textarea');
  protected readonly isPassword = computed(() => this.type() === 'password');
  protected readonly isSearch = computed(() => this.type() === 'search');

  protected readonly effectiveType = computed(() => {
    const t = this.type();
    if (t === 'password') return this.passwordVisible() ? 'text' : 'password';
    if (t === 'textarea') return 'text';
    return t;
  });

  protected readonly effectivePrefixIcon = computed<CuiIconName | undefined>(() => {
    const explicit = this.prefixIcon();
    if (explicit) return explicit;
    if (this.isSearch()) return 'search';
    return undefined;
  });

  protected readonly hasTrailingControl = computed(
    () => this.isPassword() || !!this.suffixIcon(),
  );

  protected readonly hasError = computed(() => !!this.error());
  // "Already filled" — value is present but input is not focused; distinct border.
  // (Focus still overrides via focus-within: variant.)
  protected readonly hasValue = computed(() => (this.value() ?? '').length > 0);

  protected readonly iconSize = computed<CuiIconSize>(() =>
    this.size() === 'sm' ? 'xs' : 'sm',
  );

  // Shared state-driven border/ring classes — per spec §Inputs (6 states + already-filled).
  private readonly stateClasses = computed(() => {
    if (this.isDisabled()) {
      return ['border-border-default', 'bg-bg-subtle', 'opacity-50', 'cursor-not-allowed'];
    }
    if (this.hasError()) {
      return [
        'border-error',
        'focus-within:ring-[3px] focus-within:ring-error/[.12]',
      ];
    }
    if (this.success()) {
      return [
        'border-success',
        'focus-within:ring-[3px] focus-within:ring-emerald-400/15',
      ];
    }
    if (this.hasValue()) {
      // Already filled — distinct emerald-200 border; hover + focus still override.
      return [
        'border-emerald-200',
        'hover:border-emerald-400',
        'focus-within:border-emerald-500',
        'focus-within:ring-[3px] focus-within:ring-emerald-400/15',
      ];
    }
    // Default (empty)
    return [
      'border-border-strong',
      'hover:border-emerald-400',
      'focus-within:border-emerald-500',
      'focus-within:ring-[3px] focus-within:ring-emerald-400/15',
    ];
  });

  // Wrapper for non-textarea inputs — horizontal flex, fixed height
  protected readonly wrapperClasses = computed(() => {
    const classes: string[] = [
      'flex items-center w-full gap-2',
      'bg-bg-surface border-[1.5px] rounded-lg',
      'transition-[border-color,box-shadow] duration-150',
    ];

    switch (this.size()) {
      case 'sm':
        classes.push('h-8 px-3');
        break;
      case 'lg':
        classes.push('h-12 px-4');
        break;
      default:
        classes.push('h-10 px-4');
    }

    classes.push(...this.stateClasses());
    return classes.join(' ');
  });

  // Wrapper for textarea — block, padding inside, no fixed height
  protected readonly textareaWrapperClasses = computed(() => {
    const classes: string[] = [
      'block w-full',
      'bg-bg-surface border-[1.5px] rounded-lg',
      'transition-[border-color,box-shadow] duration-150',
    ];

    switch (this.size()) {
      case 'sm':
        classes.push('px-3 py-2');
        break;
      case 'lg':
        classes.push('px-4 py-3');
        break;
      default:
        classes.push('px-4 py-3');
    }

    classes.push(...this.stateClasses());
    return classes.join(' ');
  });

  protected readonly inputClasses = computed(() => {
    const classes: string[] = [
      'flex-1 min-w-0',
      'bg-transparent outline-none border-0 p-0',
      'font-body text-text-primary placeholder:text-text-faint',
    ];

    switch (this.size()) {
      case 'sm':
        classes.push('text-t-200');
        break;
      default:
        classes.push('text-t-300');
    }

    if (this.isDisabled()) classes.push('cursor-not-allowed');
    return classes.join(' ');
  });

  protected readonly textareaClasses = computed(() => {
    const classes: string[] = [
      'block w-full',
      'bg-transparent outline-none border-0 p-0',
      'font-body text-text-primary placeholder:text-text-faint',
      'resize-y',
    ];

    switch (this.size()) {
      case 'sm':
        classes.push('text-t-200');
        break;
      default:
        classes.push('text-t-300');
    }

    if (this.isDisabled()) classes.push('cursor-not-allowed');
    return classes.join(' ');
  });

  protected readonly iconWrapperClasses = computed(() => {
    const classes: string[] = [
      'flex items-center justify-center shrink-0',
    ];
    if (this.hasError()) classes.push('text-error');
    else classes.push('text-text-muted');
    return classes.join(' ');
  });

  protected readonly trailingButtonClasses = computed(() =>
    [
      'flex items-center justify-center shrink-0',
      'text-text-muted hover:text-text-primary',
      'transition-colors duration-150',
      'bg-transparent border-0 p-0 cursor-pointer',
      this.isDisabled() ? 'pointer-events-none opacity-60' : '',
    ].join(' '),
  );

  // ControlValueAccessor
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    this.value.set(v == null ? '' : String(v));
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.cvaDisabled.set(isDisabled);
  }

  protected onInput(event: Event) {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    this.value.set(target.value);
    this.onChange(target.value);
  }

  protected onBlur() {
    this.onTouched();
  }

  protected togglePassword() {
    this.passwordVisible.update((v) => !v);
  }
}
