import { Component, computed, input } from '@angular/core';

export type CuiAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'cui-avatar',
  templateUrl: './avatar.component.html',
  host: {
    class: 'inline-block',
  },
})
export class CuiAvatarComponent {
  readonly size = input<CuiAvatarSize>('md');
  readonly src = input<string>('');
  readonly initials = input<string>('');
  readonly alt = input<string>('');

  readonly containerClasses = computed(() => {
    const classes: string[] = [
      'cui-avatar',
      'inline-flex items-center justify-center',
      'rounded-full bg-brand-gradient',
      // Typography — family/weight shared across sizes; size set per variant below
      'font-display font-semibold text-white',
      'flex-shrink-0 overflow-hidden',
    ];

    switch (this.size()) {
      case 'xs':
        classes.push('w-6 h-6 text-[10px]');
        break;
      case 'sm':
        classes.push('w-8 h-8 text-t-100');
        break;
      case 'md':
        classes.push('w-10 h-10 text-t-200');
        break;
      case 'lg':
        classes.push('w-12 h-12 text-t-300');
        break;
      case 'xl':
        classes.push('w-16 h-16 text-t-500');
        break;
    }

    return classes.join(' ');
  });
}
