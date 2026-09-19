import { Component, booleanAttribute, computed, input, model } from '@angular/core';
import { CuiIconComponent } from '../../primitives/icon/icon.component';

export interface CuiAccordionItem {
  label: string;
  content: string;
  disabled?: boolean;
}

@Component({
  selector: 'cui-accordion',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './accordion.component.html',
  host: { class: 'block' },
})
export class CuiAccordionComponent {
  readonly items = input.required<CuiAccordionItem[]>();
  readonly multiple = input(false, { transform: booleanAttribute });
  readonly expanded = model<number[]>([]);

  protected isExpanded = (i: number) => this.expanded().includes(i);

  protected toggle(index: number): void {
    const item = this.items()[index];
    if (item.disabled) return;

    const current = this.expanded();
    if (this.multiple()) {
      this.expanded.set(
        current.includes(index)
          ? current.filter((i) => i !== index)
          : [...current, index],
      );
    } else {
      this.expanded.set(current.includes(index) ? [] : [index]);
    }
  }

  protected headerClasses(item: CuiAccordionItem, isOpen: boolean): string {
    const base = [
      'flex items-center justify-between gap-3 w-full',
      'px-4 py-3',
      'type-label text-left',
      'border-0 bg-transparent',
      'transition-colors duration-200 ease-out',
      'outline-none focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:outline-offset-[-3px]',
    ];
    if (item.disabled) {
      base.push('text-text-faint cursor-not-allowed');
    } else {
      base.push('text-text-primary cursor-pointer hover:bg-bg-subtle');
      if (isOpen) base.push('bg-bg-subtle');
    }
    return base.join(' ');
  }

  protected chevronClasses = computed(() => 'transition-transform duration-200 ease-out shrink-0');

  protected isOpenChevron(i: number): string {
    return this.isExpanded(i) ? 'rotate-180 text-emerald-600' : 'text-text-muted';
  }
}
