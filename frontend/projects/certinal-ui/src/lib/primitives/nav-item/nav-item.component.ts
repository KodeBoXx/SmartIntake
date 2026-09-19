import { Component, booleanAttribute, computed, input, output } from '@angular/core';
import { CuiIconComponent, CuiIconName } from '../icon/icon.component';

@Component({
  selector: 'cui-nav-item',
  imports: [CuiIconComponent],
  templateUrl: './nav-item.component.html',
  host: {
    class: 'block',
  },
})
export class CuiNavItemComponent {
  readonly label = input.required<string>();
  readonly icon = input<CuiIconName | null>(null);
  readonly active = input(false, { transform: booleanAttribute });
  readonly collapsed = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly badge = input<string | number | null>(null);
  readonly indent = input(false, { transform: booleanAttribute });

  readonly navClick = output<void>();

  readonly rootClasses = computed(() => {
    const classes: string[] = [
      'relative w-full h-12 flex items-center',
      'border-0',
      'type-label text-left',
      'transition-colors duration-300 ease-in-out',
      'outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-inset',
    ];

    if (this.collapsed()) {
      classes.push('justify-center px-0');
    } else if (this.indent()) {
      classes.push('pl-10 pr-3 gap-3');
    } else {
      classes.push('pl-4 pr-3 gap-3');
    }

    if (this.disabled()) {
      classes.push('bg-transparent opacity-40 cursor-not-allowed text-white/60');
    } else if (this.active()) {
      if (this.indent()) {
        classes.push('bg-success text-emerald-900 font-bold cursor-pointer');
      } else {
        classes.push('bg-transparent text-success font-bold cursor-pointer');
      }
    } else {
      classes.push('bg-transparent text-white/70 hover:bg-white/5 hover:text-white cursor-pointer');
    }

    return classes.join(' ');
  });

  readonly badgePillClasses = computed(() => {
    const base = [
      'type-caption-bold',
      'inline-flex items-center justify-center',
      'min-w-5 h-5 px-1.5 rounded-full',
    ];
    if (this.active()) {
      base.push('bg-emerald-900 text-white');
    } else {
      base.push('bg-error text-white');
    }
    return base.join(' ');
  });

  readonly hasBadge = computed(() => {
    const b = this.badge();
    return b !== null && b !== '' && !this.disabled();
  });

  onClick(): void {
    if (!this.disabled()) {
      this.navClick.emit();
    }
  }
}
