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
import { CuiIconComponent, CuiIconName, CuiIconSize } from '../icon/icon.component';

export interface CuiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: CuiIconName;
}

export type CuiSelectSize = 'sm' | 'md' | 'lg';

let uid = 0;

@Component({
  selector: 'cui-select',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './select.component.html',
  styleUrl: './select.component.css',
  host: {
    class: 'block relative',
    '(document:click)': 'onDocumentClick($event)',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CuiSelectComponent),
      multi: true,
    },
  ],
})
export class CuiSelectComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  // Identity
  readonly inputId = input<string>(`cui-select-${++uid}`);
  readonly name = input<string | undefined>(undefined);

  // Content
  readonly label = input<string | undefined>(undefined);
  readonly placeholder = input<string>('Select…');
  readonly hint = input<string | undefined>(undefined);
  readonly error = input<string | undefined>(undefined);

  // Data
  readonly options = input<CuiSelectOption[]>([]);

  // Behavior
  readonly size = input<CuiSelectSize>('md');
  readonly required = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly success = input(false, { transform: booleanAttribute });

  // Icons
  readonly prefixIcon = input<CuiIconName | undefined>(undefined);

  // Value + CVA-mirrored disabled
  readonly value = model<string | null>(null);
  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(
    () => this.disabled() || this.cvaDisabled(),
  );

  // Internal UI state
  protected readonly isOpen = signal(false);
  protected readonly activeIndex = signal(-1);

  // Derived
  protected readonly hasError = computed(() => !!this.error());
  protected readonly hasValue = computed(
    () => this.value() !== null && this.value() !== undefined && this.value() !== '',
  );
  protected readonly selectedOption = computed<CuiSelectOption | undefined>(() =>
    this.options().find((o) => o.value === this.value()),
  );
  protected readonly displayLabel = computed(
    () => this.selectedOption()?.label ?? this.placeholder(),
  );

  protected readonly iconSize = computed<CuiIconSize>(() =>
    this.size() === 'sm' ? 'xs' : 'sm',
  );

  // Shared state-driven border/ring classes — mirrors CuiInput spec
  private readonly stateClasses = computed(() => {
    if (this.isDisabled()) {
      return ['border-border-default', 'bg-bg-subtle', 'opacity-50', 'cursor-not-allowed'];
    }
    if (this.hasError()) {
      return this.isOpen()
        ? ['border-error', 'ring-[3px]', 'ring-error/[.12]']
        : ['border-error', 'focus:ring-[3px]', 'focus:ring-error/[.12]'];
    }
    if (this.success()) {
      return this.isOpen()
        ? ['border-success', 'ring-[3px]', 'ring-emerald-400/15']
        : [
            'border-success',
            'focus:ring-[3px]',
            'focus:ring-emerald-400/15',
          ];
    }
    if (this.isOpen()) {
      return ['border-emerald-500', 'ring-[3px]', 'ring-emerald-400/15'];
    }
    if (this.hasValue()) {
      return [
        'border-emerald-200',
        'hover:border-emerald-400',
        'focus:border-emerald-500',
        'focus:ring-[3px]',
        'focus:ring-emerald-400/15',
      ];
    }
    return [
      'border-border-strong',
      'hover:border-emerald-400',
      'focus:border-emerald-500',
      'focus:ring-[3px]',
      'focus:ring-emerald-400/15',
    ];
  });

  protected readonly triggerClasses = computed(() => {
    const classes: string[] = [
      'w-full flex items-center gap-2',
      'bg-bg-surface border-[1.5px] rounded-lg',
      'text-left cursor-pointer',
      'font-body',
      'transition-[border-color,box-shadow] duration-150',
    ];

    switch (this.size()) {
      case 'sm':
        classes.push('h-8 px-3 text-t-200');
        break;
      case 'lg':
        classes.push('h-12 px-4 text-t-300');
        break;
      default:
        classes.push('h-10 px-4 text-t-300');
    }

    classes.push(...this.stateClasses());

    return classes.join(' ');
  });

  protected readonly triggerLabelClasses = computed(() => {
    const classes = ['flex-1 min-w-0 truncate'];
    classes.push(this.hasValue() ? 'text-text-primary' : 'text-text-faint');
    return classes.join(' ');
  });

  protected readonly iconWrapperClasses = computed(() => {
    const classes = ['flex items-center justify-center shrink-0'];
    if (this.hasError()) classes.push('text-error');
    else classes.push('text-text-muted');
    return classes.join(' ');
  });

  protected readonly chevronWrapperClasses = computed(() => {
    const classes = [
      'flex items-center justify-center shrink-0 text-text-muted',
      'transition-transform duration-150',
    ];
    if (this.isOpen()) classes.push('rotate-180');
    return classes.join(' ');
  });

  protected readonly listClasses = computed(() => {
    const classes = [
      'absolute left-0 right-0 top-full z-[100]',
      'bg-bg-surface border border-border-default rounded-lg',
      'shadow-lg py-1',
      'max-h-60 overflow-y-auto',
      'list-none m-0',
    ];
    return classes.join(' ');
  });

  protected optionClasses(option: CuiSelectOption, index: number): string {
    const classes = [
      'flex items-center gap-2',
      'px-3 py-2 mx-1 rounded-md',
      'font-body text-t-300 text-text-primary',
      'cursor-pointer select-none',
    ];

    if (option.disabled) {
      classes.push('opacity-50 cursor-not-allowed');
    } else if (option.value === this.value()) {
      classes.push('bg-emerald-50 text-emerald-700 font-medium');
    } else if (this.activeIndex() === index) {
      classes.push('bg-bg-subtle');
    } else {
      classes.push('hover:bg-bg-subtle');
    }

    return classes.join(' ');
  }

  // ControlValueAccessor
  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    this.value.set(v == null ? null : String(v));
  }
  registerOnChange(fn: (v: string | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.cvaDisabled.set(isDisabled);
  }

  // Interactions
  protected toggle(): void {
    if (this.isDisabled()) return;
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  private open(): void {
    this.isOpen.set(true);
    const idx = this.options().findIndex(
      (o) => !o.disabled && o.value === this.value(),
    );
    this.activeIndex.set(idx >= 0 ? idx : this.firstEnabledIndex());
  }

  protected close(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.activeIndex.set(-1);
    this.onTouched();
  }

  protected selectOption(option: CuiSelectOption): void {
    if (option.disabled || this.isDisabled()) return;
    this.value.set(option.value);
    this.onChange(option.value);
    this.close();
  }

  protected setActive(index: number): void {
    this.activeIndex.set(index);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.isDisabled()) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.isOpen()) {
          this.open();
        } else {
          this.moveActive(1);
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (!this.isOpen()) {
          this.open();
        } else {
          this.moveActive(-1);
        }
        break;

      case 'Home':
        if (this.isOpen()) {
          event.preventDefault();
          this.activeIndex.set(this.firstEnabledIndex());
        }
        break;

      case 'End':
        if (this.isOpen()) {
          event.preventDefault();
          this.activeIndex.set(this.lastEnabledIndex());
        }
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!this.isOpen()) {
          this.open();
        } else {
          const opt = this.options()[this.activeIndex()];
          if (opt) this.selectOption(opt);
        }
        break;

      case 'Escape':
        if (this.isOpen()) {
          event.preventDefault();
          this.close();
        }
        break;

      case 'Tab':
        if (this.isOpen()) this.close();
        break;
    }
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node;
    if (!this.elementRef.nativeElement.contains(target)) {
      this.close();
    }
  }

  private moveActive(delta: number): void {
    const opts = this.options();
    if (opts.length === 0) return;

    let idx = this.activeIndex();
    for (let i = 0; i < opts.length; i++) {
      idx = (idx + delta + opts.length) % opts.length;
      if (!opts[idx].disabled) {
        this.activeIndex.set(idx);
        return;
      }
    }
  }

  private firstEnabledIndex(): number {
    return this.options().findIndex((o) => !o.disabled);
  }

  private lastEnabledIndex(): number {
    const opts = this.options();
    for (let i = opts.length - 1; i >= 0; i--) {
      if (!opts[i].disabled) return i;
    }
    return -1;
  }
}
