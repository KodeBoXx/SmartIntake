import { Component, computed, input } from '@angular/core';
import { CuiAvatarComponent, CuiAvatarSize } from '../../primitives/avatar/avatar.component';

export interface CuiAvatarGroupItem {
  initials?: string;
  src?: string;
  alt?: string;
}

@Component({
  selector: 'cui-avatar-group',
  standalone: true,
  imports: [CuiAvatarComponent],
  templateUrl: './avatar-group.component.html',
  host: { class: 'inline-flex' },
})
export class CuiAvatarGroupComponent {
  readonly items = input.required<CuiAvatarGroupItem[]>();
  readonly size = input<CuiAvatarSize>('md');
  readonly max = input<number>(4);

  readonly visibleItems = computed(() => this.items().slice(0, this.max()));
  readonly overflowCount = computed(() => Math.max(0, this.items().length - this.max()));

  readonly overflowClasses = computed(() => {
    const base = [
      'inline-flex items-center justify-center',
      'rounded-full',
      'bg-bg-muted text-text-secondary font-display font-semibold',
      'border-2 border-bg-surface',
      'flex-shrink-0',
    ];
    switch (this.size()) {
      case 'xs': base.push('w-6 h-6 text-[10px]'); break;
      case 'sm': base.push('w-8 h-8 text-t-100'); break;
      case 'lg': base.push('w-12 h-12 text-t-300'); break;
      case 'xl': base.push('w-16 h-16 text-t-500'); break;
      default: base.push('w-10 h-10 text-t-200');
    }
    return base.join(' ');
  });
}
