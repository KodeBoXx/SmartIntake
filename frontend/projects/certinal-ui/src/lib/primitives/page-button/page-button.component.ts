import { Component, booleanAttribute, computed, input, output } from '@angular/core';

@Component({
  selector: 'cui-page-button',
  templateUrl: './page-button.component.html',
  host: {
    class: 'inline-block',
  },
})
export class CuiPageButtonComponent {
  readonly page = input.required<number>();
  readonly active = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly type = input<'button' | 'submit' | 'reset'>('button');

  readonly pageClick = output<number>();

  readonly buttonClasses = computed(() => {
    const classes: string[] = [
      'inline-flex items-center justify-center',
      'w-9 h-9 rounded-md',
      'border-0',
      'type-label',
      'transition-colors duration-200 ease-out',
      'outline-none focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:outline-offset-2',
    ];

    if (this.disabled()) {
      classes.push('bg-transparent text-text-faint cursor-not-allowed opacity-40');
    } else if (this.active()) {
      classes.push(
        'bg-emerald-500 text-white font-semibold cursor-pointer',
        'hover:bg-emerald-400',
      );
    } else {
      classes.push(
        'bg-transparent text-text-secondary cursor-pointer',
        'hover:bg-bg-subtle hover:text-text-primary',
      );
    }

    return classes.join(' ');
  });

  onClick(): void {
    if (!this.disabled()) {
      this.pageClick.emit(this.page());
    }
  }
}
