import { Component, computed, input } from '@angular/core';

export type CuiSpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'cui-spinner',
  standalone: true,
  template: `
    <div [class]="spinnerClasses()" role="status" aria-label="Loading"></div>
  `,
  host: { class: 'inline-flex' },
})
export class CuiSpinnerComponent {
  readonly size = input<CuiSpinnerSize>('md');

  readonly spinnerClasses = computed(() => {
    const base = [
      'inline-block rounded-full',
      'border-emerald-200 border-t-emerald-500',
      'animate-spin',
    ];
    switch (this.size()) {
      case 'xs': base.push('w-3 h-3 border-2'); break;
      case 'sm': base.push('w-4 h-4 border-2'); break;
      case 'lg': base.push('w-8 h-8 border-[3px]'); break;
      case 'xl': base.push('w-12 h-12 border-4'); break;
      default: base.push('w-6 h-6 border-2');
    }
    return base.join(' ');
  });
}
