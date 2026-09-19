import { Component, booleanAttribute, computed, input, output } from '@angular/core';

@Component({
  selector: 'cui-product-tab',
  templateUrl: './product-tab.component.html',
  host: {
    class: 'inline-block',
  },
})
export class CuiProductTabComponent {
  readonly label = input.required<string>();
  readonly active = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly tabClick = output<void>();

  readonly tabClasses = computed(() => {
    const classes: string[] = [
      'relative flex items-center justify-center gap-2',
      'h-[44px] px-7',
      'rounded-t-[10px]',
      'border-t-[3px] border-l border-r',
      // Typography — button role (DM Sans, t-300 / 500 weight, leading-1)
      'type-button',
      'tracking-[-0.01em]',
      'no-underline',
      'transition-all duration-150 ease-out',
      '-mb-px',
      'focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:[outline-offset:-3px]',
    ];

    if (this.active()) {
      classes.push(
        'bg-bg-page border-t-emerald-500 border-l-border-default border-r-border-default',
        'text-emerald-900 font-semibold',
      );
    } else if (this.disabled()) {
      classes.push(
        'bg-transparent border-transparent',
        'text-slate-300 cursor-not-allowed',
      );
    } else {
      classes.push(
        'bg-transparent border-transparent',
        'text-text-muted cursor-pointer',
        'hover:text-text-secondary',
      );
    }

    return classes.join(' ');
  });

  readonly iconClasses = computed(() => {
    const base = 'w-4 h-4';
    if (this.active()) return `${base} text-emerald-500`;
    return base;
  });

  onClick(): void {
    if (!this.disabled()) {
      this.tabClick.emit();
    }
  }
}
