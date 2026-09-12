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
import { CuiIconComponent } from '../icon/icon.component';
import { CuiChipComponent } from '../chip/chip.component';
import { CuiButtonComponent } from '../button/button.component';
import { CuiSelectOption, CuiSelectSize } from '../select/select.component';

let uid = 0;

@Component({
  selector: 'cui-multi-select',
  standalone: true,
  imports: [CuiIconComponent, CuiChipComponent, CuiButtonComponent],
  templateUrl: './multi-select.component.html',
  host: {
    class: 'block relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CuiMultiSelectComponent),
      multi: true,
    },
  ],
})
export class CuiMultiSelectComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly inputId = input<string>(`cui-multi-select-${++uid}`);
  readonly options = input<CuiSelectOption[]>([]);
  readonly value = model<string[]>([]);
  readonly placeholder = input<string>('Select…');
  readonly searchable = input(true, { transform: booleanAttribute });
  readonly size = input<CuiSelectSize>('md');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly maxDisplayChips = input<number>(3);

  // Confirmable mode — selections buffered until Done is clicked
  readonly confirmable = input(false, { transform: booleanAttribute });
  // Compact trigger display — "First label (+N more)" instead of chips
  readonly compactDisplay = input(false, { transform: booleanAttribute });

  protected readonly isOpen = signal(false);
  protected readonly searchQuery = signal('');
  protected readonly pendingValue = signal<string[]>([]);
  private readonly cvaDisabled = signal(false);

  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  protected readonly selectedOptions = computed(() => {
    const vals = new Set(this.value());
    return this.options().filter((opt) => vals.has(opt.value));
  });

  protected readonly visibleChips = computed(() =>
    this.selectedOptions().slice(0, this.maxDisplayChips()),
  );

  protected readonly overflowCount = computed(() =>
    Math.max(0, this.selectedOptions().length - this.maxDisplayChips()),
  );

  protected readonly filteredOptions = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.options();
    return this.options().filter((opt) => opt.label.toLowerCase().includes(q));
  });

  protected readonly hasValue = computed(() => this.value().length > 0);

  protected readonly compactLabel = computed(() => {
    const opts = this.selectedOptions();
    if (opts.length === 0) return '';
    if (opts.length === 1) return opts[0].label;
    return `${opts[0].label} (+${opts.length - 1} more)`;
  });

  protected readonly triggerClasses = computed(() => {
    const c = [
      'w-full flex items-center gap-2',
      'bg-bg-surface border-[1.5px] rounded-lg',
      'cursor-pointer font-body',
      'transition-[border-color,box-shadow] duration-150',
      'min-h-10',
    ];
    switch (this.size()) {
      case 'sm': c.push('px-2 py-1 text-t-200 min-h-8'); break;
      case 'lg': c.push('px-3 py-2 text-t-300 min-h-12'); break;
      default: c.push('px-3 py-1.5 text-t-300');
    }

    if (this.isDisabled()) {
      c.push('border-border-default bg-bg-subtle opacity-50 cursor-not-allowed');
    } else if (this.isOpen()) {
      c.push('border-emerald-500 ring-[3px] ring-emerald-400/15');
    } else if (this.hasValue()) {
      c.push('border-emerald-200 hover:border-emerald-400');
    } else {
      c.push('border-border-strong hover:border-emerald-400');
    }
    return c.join(' ');
  });

  protected toggle(): void {
    if (this.isDisabled()) return;
    if (this.isOpen()) {
      this.close();
      return;
    }
    if (this.confirmable()) {
      this.pendingValue.set([...this.value()]);
    }
    this.isOpen.set(true);
    this.searchQuery.set('');
  }

  close(): void {
    if (this.isOpen()) {
      this.isOpen.set(false);
      this.pendingValue.set([]);
      this.onTouched();
    }
  }

  protected toggleOption(option: CuiSelectOption): void {
    if (option.disabled || this.isDisabled()) return;
    if (this.confirmable()) {
      const cur = this.pendingValue();
      const next = cur.includes(option.value)
        ? cur.filter((v) => v !== option.value)
        : [...cur, option.value];
      this.pendingValue.set(next);
    } else {
      const cur = this.value();
      const next = cur.includes(option.value)
        ? cur.filter((v) => v !== option.value)
        : [...cur, option.value];
      this.value.set(next);
      this.onChange(next);
    }
  }

  protected isSelected(option: CuiSelectOption): boolean {
    if (this.confirmable() && this.isOpen()) {
      return this.pendingValue().includes(option.value);
    }
    return this.value().includes(option.value);
  }

  protected onDone(): void {
    const next = [...this.pendingValue()];
    this.value.set(next);
    this.onChange(next);
    this.isOpen.set(false);
    this.pendingValue.set([]);
    this.onTouched();
  }

  protected onCancel(): void {
    this.close();
  }

  protected removeChip(value: string): void {
    if (this.isDisabled()) return;
    const next = this.value().filter((v) => v !== value);
    this.value.set(next);
    this.onChange(next);
  }

  protected onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }

  protected clearAll(event: Event): void {
    event.stopPropagation();
    if (this.isDisabled()) return;
    this.value.set([]);
    this.onChange([]);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node;
    if (!this.elementRef.nativeElement.contains(target)) this.close();
  }

  protected optionClasses(opt: CuiSelectOption): string {
    const base = [
      'flex items-center gap-2',
      'px-3 py-2 mx-1 rounded-md',
      'type-body-sm cursor-pointer select-none',
    ];
    if (opt.disabled) {
      base.push('opacity-50 cursor-not-allowed');
    } else if (this.isSelected(opt)) {
      base.push('bg-emerald-50 text-emerald-700 font-medium');
    } else {
      base.push('text-text-primary hover:bg-bg-subtle');
    }
    return base.join(' ');
  }

  protected checkboxClasses(opt: CuiSelectOption): string {
    const base = [
      'w-4 h-4 flex items-center justify-center shrink-0 rounded border-[1.5px]',
      'transition-colors duration-150 ease-out',
    ];
    if (this.isSelected(opt)) {
      base.push('bg-emerald-500 border-emerald-500');
    } else {
      base.push('bg-bg-surface border-border-strong');
    }
    return base.join(' ');
  }

  // ControlValueAccessor
  private onChange: (v: string[]) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: unknown): void {
    if (Array.isArray(v)) this.value.set(v.map(String));
    else this.value.set([]);
  }
  registerOnChange(fn: (v: string[]) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.cvaDisabled.set(isDisabled);
  }
}
