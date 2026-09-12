import { Component, booleanAttribute, computed, input, output } from '@angular/core';
import { CuiCardComponent, CuiCardAccentColor } from '../card/card.component';
import { CuiIconComponent, CuiIconName } from '../../primitives/icon/icon.component';

export type CuiMetricStatColor =
  | 'primary'
  | 'muted'
  | 'success'
  | 'warning'
  | 'error';

export type CuiMetricCardStatus = 'none' | 'success' | 'warning' | 'error' | 'info';

export interface CuiMetricStat {
  label: string;
  value: string | number;
  color?: CuiMetricStatColor;
}

@Component({
  selector: 'cui-metric-card',
  standalone: true,
  imports: [CuiCardComponent, CuiIconComponent],
  templateUrl: './metric-card.component.html',
  styleUrl: './metric-card.component.css',
  host: {
    class: 'block',
  },
})
export class CuiMetricCardComponent {
  // Required content
  readonly icon = input.required<CuiIconName>();
  readonly value = input.required<string | number>();
  readonly title = input.required<string>();

  // Optional content
  readonly valueLabel = input<string | undefined>(undefined);
  readonly stats = input<CuiMetricStat[]>([]);

  // Styling
  readonly accentColor = input<CuiCardAccentColor>('emerald');
  readonly accentTop = input(true, { transform: booleanAttribute });
  readonly accentLeft = input(false, { transform: booleanAttribute });
  readonly status = input<CuiMetricCardStatus>('none');

  // Behavior (passthrough to inner cui-card)
  readonly hoverable = input(false, { transform: booleanAttribute });
  readonly clickable = input(false, { transform: booleanAttribute });

  // Events
  readonly cardClick = output<void>();

  // Internal classes
  protected readonly rootClasses = computed(() => {
    const classes = `cui-metric-card cui-metric-card--${this.accentColor()}`;
    const s = this.status();
    return s === 'none' ? classes : `${classes} cui-metric-card--status-${s}`;
  });

  protected statValueClass(stat: CuiMetricStat): string {
    const color = stat.color ?? 'primary';
    return `cui-metric-card__stat-value cui-metric-card__stat-value--${color}`;
  }
}
