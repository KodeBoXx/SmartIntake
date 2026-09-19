import { Component, computed, input } from '@angular/core';

export type CuiDividerOrientation = 'horizontal' | 'vertical';

@Component({
  selector: 'cui-divider',
  template: `<div [class]="dividerClasses()" role="separator"></div>`,
  host: {
    class: 'inline-block',
  },
})
export class CuiDividerComponent {
  readonly orientation = input<CuiDividerOrientation>('horizontal');
  readonly spacing = input<'sm' | 'md' | 'lg'>('md');

  readonly dividerClasses = computed(() => {
    const classes: string[] = ['bg-border-default'];

    if (this.orientation() === 'vertical') {
      classes.push('w-px');
      switch (this.spacing()) {
        case 'sm': classes.push('h-4 mx-1'); break;
        case 'md': classes.push('h-5 mx-1.5'); break;
        case 'lg': classes.push('h-6 mx-2'); break;
      }
    } else {
      classes.push('h-px w-full');
      switch (this.spacing()) {
        case 'sm': classes.push('my-2'); break;
        case 'md': classes.push('my-4'); break;
        case 'lg': classes.push('my-6'); break;
      }
    }

    return classes.join(' ');
  });
}
