import { Component, booleanAttribute, computed, input } from '@angular/core';

export type CuiTableAlign = 'left' | 'center' | 'right';

@Component({
  selector: 'td[cuiTableCell]',
  templateUrl: './table-cell.component.html',
  host: {
    '[class]': 'hostClasses()',
  },
})
export class CuiTableCellComponent {
  readonly align = input<CuiTableAlign>('left');
  readonly truncate = input(false, { transform: booleanAttribute });
  readonly nowrap = input(false, { transform: booleanAttribute });

  readonly hostClasses = computed(() => {
    const classes: string[] = [
      'px-4 py-3',
      'type-body-sm',
      'text-text-primary',
      'border-b border-border-default',
      'align-middle',
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

    if (this.truncate()) {
      classes.push('truncate max-w-0');
    }

    if (this.nowrap()) {
      classes.push('whitespace-nowrap');
    }

    return classes.join(' ');
  });
}
