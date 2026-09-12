import { Component, booleanAttribute, computed, input, model } from '@angular/core';
import { CuiIconComponent, CuiIconName } from '../../primitives/icon/icon.component';

export type CuiSegmentedSize = 'sm' | 'md' | 'lg';

export interface CuiSegmentedOption {
  value: string;
  label?: string;
  icon?: CuiIconName;
  disabled?: boolean;
}

@Component({
  selector: 'cui-segmented-control',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './segmented-control.component.html',
  host: { class: 'inline-block' },
})
export class CuiSegmentedControlComponent {
  readonly options = input.required<CuiSegmentedOption[]>();
  readonly value = model<string>('');
  readonly size = input<CuiSegmentedSize>('md');
  readonly disabled = input(false, { transform: booleanAttribute });

  readonly containerClasses = computed(() => {
    const base = ['inline-flex bg-bg-subtle rounded-full p-1 gap-1'];
    if (this.disabled()) base.push('opacity-50 pointer-events-none');
    return base.join(' ');
  });

  protected segmentClasses(option: CuiSegmentedOption): string {
    const base = [
      'inline-flex items-center justify-center gap-1.5',
      'rounded-full',
      'border-0',
      'transition-colors duration-200 ease-out',
      'outline-none focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:outline-offset-2',
    ];

    switch (this.size()) {
      case 'sm':
        base.push('h-7 px-3 type-caption');
        break;
      case 'lg':
        base.push('h-10 px-5 type-label');
        break;
      default:
        base.push('h-8 px-4 type-label');
    }

    if (option.disabled) {
      base.push('bg-transparent text-text-faint cursor-not-allowed');
    } else if (this.value() === option.value) {
      base.push('bg-bg-surface text-text-primary shadow-sm font-medium cursor-pointer');
    } else {
      base.push('bg-transparent text-text-muted cursor-pointer hover:text-text-secondary');
    }
    return base.join(' ');
  }

  protected onSelect(option: CuiSegmentedOption): void {
    if (option.disabled || this.disabled()) return;
    this.value.set(option.value);
  }
}
