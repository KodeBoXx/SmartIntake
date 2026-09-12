import { Component, computed, input } from '@angular/core';

export type CuiCardTitleSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'cui-card-title',
  standalone: true,
  templateUrl: './card-title.component.html',
  styleUrl: './card-title.component.css',
  host: {
    '[class]': 'hostClasses()',
  },
})
export class CuiCardTitleComponent {
  readonly size = input<CuiCardTitleSize>('md');

  protected readonly hostClasses = computed(() => {
    const classes = ['cui-card-title'];
    switch (this.size()) {
      case 'sm':
        classes.push('cui-card-title--sm');
        break;
      case 'lg':
        classes.push('cui-card-title--lg');
        break;
      default:
        classes.push('cui-card-title--md');
    }
    return classes.join(' ');
  });
}
