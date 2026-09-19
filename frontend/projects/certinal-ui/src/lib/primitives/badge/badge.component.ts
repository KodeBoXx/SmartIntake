import { Component, booleanAttribute, computed, input } from '@angular/core';

export type CuiBadgeVariant = 'emerald' | 'lime' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

@Component({
  selector: 'cui-badge',
  templateUrl: './badge.component.html',
  host: {
    class: 'inline-block',
  },
})
export class CuiBadgeComponent {
  readonly variant = input<CuiBadgeVariant>('neutral');
  readonly dot = input(false, { transform: booleanAttribute });

  readonly badgeClasses = computed(() => {
    const classes: string[] = [
      'inline-flex items-center gap-1',
      'px-2.5 py-[3px]',
      'rounded-full',
      // Typography — caption-bold (DM Sans, t-100 / 600 weight)
      'type-caption-bold',
      'whitespace-nowrap',
    ];

    switch (this.variant()) {
      case 'emerald':
        classes.push('bg-emerald-100 text-emerald-700');
        break;
      case 'lime':
        classes.push('bg-lime-100 text-lime-700');
        break;
      case 'success':
        classes.push('bg-success-light text-success-dark');
        break;
      case 'warning':
        classes.push('bg-warning-light text-warning-dark');
        break;
      case 'error':
        classes.push('bg-error-light text-error-dark');
        break;
      case 'info':
        classes.push('bg-info-light text-info-dark');
        break;
      case 'neutral':
        classes.push('bg-bg-muted text-text-secondary');
        break;
    }

    return classes.join(' ');
  });
}
