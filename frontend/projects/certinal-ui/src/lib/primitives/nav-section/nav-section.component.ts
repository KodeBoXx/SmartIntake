import { Component, booleanAttribute, computed, input, signal } from '@angular/core';
import { CuiIconComponent, CuiIconName } from '../icon/icon.component';

@Component({
  selector: 'cui-nav-section',
  imports: [CuiIconComponent],
  templateUrl: './nav-section.component.html',
  host: {
    class: 'block',
  },
})
export class CuiNavSectionComponent {
  readonly label = input.required<string>();
  readonly icon = input<CuiIconName | null>(null);
  readonly collapsed = input(false, { transform: booleanAttribute });
  readonly hasActiveChild = input(false, { transform: booleanAttribute });
  readonly defaultExpanded = input(true, { transform: booleanAttribute });

  private readonly userExpanded = signal<boolean | null>(null);

  readonly expanded = computed(() => {
    const override = this.userExpanded();
    if (override !== null) return override;
    return this.defaultExpanded();
  });

  readonly headerClasses = computed(() => {
    const classes: string[] = [
      'relative w-full h-12 flex items-center',
      'border-0 cursor-pointer',
      'type-label text-left',
      'transition-colors duration-300 ease-in-out',
      'outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-inset',
    ];

    if (this.collapsed()) {
      classes.push('justify-center px-0');
    } else {
      classes.push('pl-4 pr-3 gap-3');
    }

    if (this.hasActiveChild()) {
      classes.push('bg-white/5 text-success font-bold');
    } else {
      classes.push('bg-transparent text-white/70 hover:bg-white/5 hover:text-white');
    }

    return classes.join(' ');
  });

  toggle(): void {
    this.userExpanded.set(!this.expanded());
  }
}
