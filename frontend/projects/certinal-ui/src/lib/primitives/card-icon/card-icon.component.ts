import { Component, computed, input } from '@angular/core';

export type CuiCardIconSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'cui-card-icon',
  standalone: true,
  templateUrl: './card-icon.component.html',
  styleUrl: './card-icon.component.css',
  host: {
    class: 'cui-card-icon',
    '[class]': 'hostClasses()',
  },
})
export class CuiCardIconComponent {
  readonly size = input<CuiCardIconSize>('md');

  protected readonly hostClasses = computed(() => {
    const classes = ['cui-card-icon'];
    switch (this.size()) {
      case 'sm':
        classes.push('cui-card-icon--sm');
        break;
      case 'lg':
        classes.push('cui-card-icon--lg');
        break;
      default:
        classes.push('cui-card-icon--md');
    }
    return classes.join(' ');
  });
}
