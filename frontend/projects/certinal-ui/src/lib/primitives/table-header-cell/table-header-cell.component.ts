import {
  Component,
  HostListener,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';
import { CuiIconComponent } from '../icon/icon.component';
import { CuiTableAlign } from '../table-cell/table-cell.component';

export type CuiTableSort = 'none' | 'asc' | 'desc';

@Component({
  selector: 'th[cuiTableHeaderCell]',
  imports: [CuiIconComponent],
  templateUrl: './table-header-cell.component.html',
  host: {
    role: 'columnheader',
    '[class]': 'hostClasses()',
    '[attr.aria-sort]': 'ariaSort()',
    '[attr.tabindex]': 'sortable() ? 0 : null',
  },
})
export class CuiTableHeaderCellComponent {
  readonly align = input<CuiTableAlign>('left');
  readonly sortable = input(false, { transform: booleanAttribute });
  readonly sort = input<CuiTableSort>('none');

  readonly sortChange = output<CuiTableSort>();

  readonly hostClasses = computed(() => {
    const classes: string[] = [
      'px-4 py-3',
      'type-caption-bold',
      'text-text-secondary',
      'bg-bg-subtle',
      'border-b border-border-default',
      'select-none',
    ];

    switch (this.align()) {
      case 'center':
        classes.push('text-center');
        break;
      case 'right':
        classes.push('text-right');
        break;
      default:
        classes.push('text-left');
    }

    if (this.sortable()) {
      classes.push(
        'cursor-pointer',
        'transition-colors duration-200 ease-out',
        'hover:bg-bg-muted',
        'outline-none focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:outline-offset-[-3px]',
      );
    }

    return classes.join(' ');
  });

  readonly contentWrapperClasses = computed(() => {
    const classes = ['inline-flex items-center gap-1.5'];
    if (this.align() === 'right') classes.push('w-full justify-end');
    if (this.align() === 'center') classes.push('w-full justify-center');
    return classes.join(' ');
  });

  readonly sortIconClasses = computed(() => {
    const sort = this.sort();
    const base = 'transition-transform duration-200 ease-out';
    if (sort === 'asc') return `${base} rotate-180 text-emerald-600`;
    if (sort === 'desc') return `${base} text-emerald-600`;
    return `${base} text-text-faint`;
  });

  protected ariaSort(): string | null {
    if (!this.sortable()) return null;
    if (this.sort() === 'asc') return 'ascending';
    if (this.sort() === 'desc') return 'descending';
    return 'none';
  }

  @HostListener('click')
  onClick(): void {
    if (!this.sortable()) return;
    this.cycleSort();
  }

  @HostListener('keydown.enter', ['$event'])
  @HostListener('keydown.space', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.sortable()) return;
    event.preventDefault();
    this.cycleSort();
  }

  private cycleSort(): void {
    const cur = this.sort();
    const next: CuiTableSort = cur === 'none' ? 'asc' : cur === 'asc' ? 'desc' : 'none';
    this.sortChange.emit(next);
  }
}
