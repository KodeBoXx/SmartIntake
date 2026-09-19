import { Component, booleanAttribute, computed, input, model } from '@angular/core';

export type CuiToggleSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'cui-toggle',
  standalone: true,
  templateUrl: './toggle.component.html',
  host: { class: 'inline-block' },
})
export class CuiToggleComponent {
  readonly value = model<boolean>(false);
  readonly size = input<CuiToggleSize>('md');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly label = input<string | undefined>(undefined);

  protected toggle(): void {
    if (this.disabled()) return;
    this.value.update((v) => !v);
  }

  readonly trackClasses = computed(() => {
    const base = [
      'relative inline-flex shrink-0 items-center',
      'rounded-full border-0 cursor-pointer',
      'transition-colors duration-200 ease-out',
      'outline-none focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:outline-offset-2',
    ];
    switch (this.size()) {
      case 'sm': base.push('w-8 h-4 p-0.5'); break;
      case 'lg': base.push('w-14 h-7 p-0.5'); break;
      default: base.push('w-11 h-6 p-0.5');
    }
    if (this.disabled()) base.push('opacity-50 cursor-not-allowed');
    base.push(this.value() ? 'bg-emerald-500' : 'bg-bg-muted');
    return base.join(' ');
  });

  readonly thumbClasses = computed(() => {
    const base = [
      'inline-block bg-white rounded-full shadow-sm',
      'transition-transform duration-200 ease-out',
    ];
    switch (this.size()) {
      case 'sm':
        base.push('w-3 h-3');
        if (this.value()) base.push('translate-x-4');
        break;
      case 'lg':
        base.push('w-6 h-6');
        if (this.value()) base.push('translate-x-7');
        break;
      default:
        base.push('w-5 h-5');
        if (this.value()) base.push('translate-x-5');
    }
    return base.join(' ');
  });
}
