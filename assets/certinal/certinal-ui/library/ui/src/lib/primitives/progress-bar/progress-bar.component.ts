import { Component, booleanAttribute, computed, input } from '@angular/core';

export type CuiProgressBarSize = 'sm' | 'md';

@Component({
  selector: 'cui-progress-bar',
  standalone: true,
  template: `
    <div [class]="trackClasses()" role="progressbar"
         [attr.aria-valuemin]="0"
         [attr.aria-valuemax]="100"
         [attr.aria-valuenow]="indeterminate() ? null : clampedValue()">
      <div [class]="fillClasses()" [style.width]="fillWidth()"></div>
    </div>
  `,
  styles: [`
    @keyframes cui-progress-indeterminate {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }
    .cui-indeterminate {
      animation: cui-progress-indeterminate 1.4s ease-in-out infinite;
      width: 25%;
    }
  `],
  host: {
    class: 'block w-full',
  },
})
export class CuiProgressBarComponent {
  readonly value = input<number>(0);
  readonly size = input<CuiProgressBarSize>('md');
  readonly indeterminate = input(false, { transform: booleanAttribute });

  protected readonly clampedValue = computed(() =>
    Math.max(0, Math.min(100, this.value() ?? 0)),
  );

  protected readonly trackClasses = computed(() => {
    const c = ['w-full bg-bg-muted rounded-full overflow-hidden relative'];
    c.push(this.size() === 'sm' ? 'h-1' : 'h-2');
    return c.join(' ');
  });

  protected readonly fillClasses = computed(() => {
    const c = [
      'h-full rounded-full',
      'bg-brand-gradient',
    ];
    if (this.indeterminate()) {
      c.push('cui-indeterminate');
    } else {
      c.push('transition-[width] duration-500 ease-out');
    }
    return c.join(' ');
  });

  protected readonly fillWidth = computed(() =>
    this.indeterminate() ? '25%' : `${this.clampedValue()}%`,
  );
}
