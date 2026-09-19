import { Component, computed, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

export type CuiStatsStripAccent = 'emerald' | 'lime' | 'cyan';

export interface CuiStatsStripItem {
  icon: string;
  value: string | number;
  label: string;
  accent?: CuiStatsStripAccent;
}

@Component({
  selector: 'cui-stats-strip',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './stats-strip.component.html',
  styleUrl: './stats-strip.component.css',
  host: { class: 'block' },
})
export class CuiStatsStripComponent {
  readonly items = input.required<CuiStatsStripItem[]>();
  readonly defaultAccent = input<CuiStatsStripAccent>('emerald');

  protected readonly resolvedItems = computed(() =>
    this.items().map((item, i) => ({
      ...item,
      accent: item.accent ?? this.rotateAccent(i),
      isLast: i === this.items().length - 1,
    }))
  );

  private rotateAccent(index: number): CuiStatsStripAccent {
    const palette: CuiStatsStripAccent[] = ['cyan', 'emerald', 'lime'];
    return palette[index % palette.length];
  }

  protected tileStyle(accent: CuiStatsStripAccent): Record<string, string> {
    switch (accent) {
      case 'cyan':
        return { background: 'color-mix(in srgb, var(--color-cyan-500) 14%, transparent)', color: 'var(--color-cyan-700)' };
      case 'lime':
        return { background: 'var(--color-lime-100)', color: 'var(--color-lime-700)' };
      case 'emerald':
      default:
        return { background: 'color-mix(in srgb, var(--color-emerald-400) 18%, transparent)', color: 'var(--color-emerald-700)' };
    }
  }
}
