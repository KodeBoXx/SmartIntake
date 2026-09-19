import { Component, computed, input } from '@angular/core';

export type CuiLogoSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'cui-logo',
  templateUrl: './logo.component.html',
  host: {
    class: 'inline-block',
  },
})
export class CuiLogoComponent {
  readonly size = input<CuiLogoSize>('md');
  readonly iconOnly = input(false);

  readonly containerClasses = computed(() => {
    switch (this.size()) {
      case 'sm': return this.iconOnly() ? 'w-7 h-7' : 'h-[28px]';
      case 'md': return this.iconOnly() ? 'w-9 h-9' : 'h-[43px]';
      case 'lg': return this.iconOnly() ? 'w-12 h-12' : 'h-[56px]';
    }
  });
}
