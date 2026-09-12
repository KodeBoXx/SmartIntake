import { Component, computed, input } from '@angular/core';

export type CuiSkeletonVariant = 'text' | 'rect' | 'circle';

@Component({
  selector: 'cui-skeleton',
  standalone: true,
  template: `<div [class]="skeletonClasses()" [style.width]="resolvedWidth()" [style.height]="resolvedHeight()" aria-hidden="true"></div>`,
  styles: [`
    @keyframes cui-skeleton-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .cui-skeleton {
      background: linear-gradient(
        90deg,
        var(--color-bg-muted) 25%,
        var(--color-bg-subtle) 50%,
        var(--color-bg-muted) 75%
      );
      background-size: 200% 100%;
      animation: cui-skeleton-shimmer 1.5s infinite;
    }
  `],
  host: {
    class: 'block',
  },
})
export class CuiSkeletonComponent {
  readonly variant = input<CuiSkeletonVariant>('text');
  readonly width = input<string | number | undefined>(undefined);
  readonly height = input<string | number | undefined>(undefined);

  protected readonly skeletonClasses = computed(() => {
    const c = ['cui-skeleton'];
    switch (this.variant()) {
      case 'circle':
        c.push('rounded-full');
        break;
      case 'rect':
        c.push('rounded-md');
        break;
      default:
        c.push('rounded');
    }
    return c.join(' ');
  });

  protected readonly resolvedWidth = computed(() => this.toCssSize(this.width(), '100%'));
  protected readonly resolvedHeight = computed(() =>
    this.toCssSize(this.height(), this.variant() === 'text' ? '12px' : '100%'),
  );

  private toCssSize(v: string | number | undefined, fallback: string): string {
    if (v === undefined || v === null) return fallback;
    return typeof v === 'number' ? `${v}px` : v;
  }
}
