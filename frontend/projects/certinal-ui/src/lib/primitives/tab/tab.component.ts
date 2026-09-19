import { Component, booleanAttribute, computed, input, output } from '@angular/core';

export type CuiTabSize = 'sm' | 'md';

@Component({
  selector: 'cui-tab',
  templateUrl: './tab.component.html',
  host: {
    class: 'inline-block',
  },
})
export class CuiTabComponent {
  readonly label = input.required<string>();
  readonly active = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly size = input<CuiTabSize>('md');

  readonly tabClick = output<void>();

  readonly tabClasses = computed(() => {
    const classes: string[] = [
      'relative inline-flex items-center gap-2',
      'border-0 bg-transparent',
      'border-b-2 -mb-px',
      'type-label',
      'transition-colors duration-200 ease-out',
      'outline-none focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:outline-offset-2',
    ];

    switch (this.size()) {
      case 'sm':
        classes.push('h-9 px-3');
        break;
      case 'md':
        classes.push('h-11 px-4');
        break;
    }

    if (this.disabled()) {
      classes.push('border-transparent text-text-faint cursor-not-allowed');
    } else if (this.active()) {
      classes.push(
        'border-emerald-500 text-emerald-700 font-semibold cursor-pointer',
      );
    } else {
      classes.push(
        'border-transparent text-text-muted cursor-pointer',
        'hover:text-text-secondary hover:border-border-default',
      );
    }

    return classes.join(' ');
  });

  onClick(): void {
    if (!this.disabled()) {
      this.tabClick.emit();
    }
  }
}
