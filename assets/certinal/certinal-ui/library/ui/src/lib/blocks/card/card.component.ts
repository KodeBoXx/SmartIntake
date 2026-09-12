import { Component, booleanAttribute, computed, input } from '@angular/core';

export type CuiCardVariant = 'default' | 'elevated' | 'feature' | 'dark';
export type CuiCardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CuiCardStatus = 'none' | 'success' | 'warning' | 'info' | 'error';
export type CuiCardAccentColor =
  | 'emerald'
  | 'lime'
  | 'cyan'
  | 'neutral'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

@Component({
  selector: 'cui-card',
  standalone: true,
  templateUrl: './card.component.html',
  styleUrl: './card.component.css',
  host: {
    '[class]': 'hostClasses()',
    '[attr.role]': 'clickable() ? "button" : null',
    '[attr.tabindex]': 'clickable() && !disabled() ? 0 : null',
    '[attr.aria-disabled]': 'clickable() && disabled() ? "true" : null',
    '(keydown)': 'onKeydown($event)',
  },
})
export class CuiCardComponent {
  readonly variant = input<CuiCardVariant>('default');
  readonly padding = input<CuiCardPadding>('md');
  readonly status = input<CuiCardStatus>('none');
  readonly hoverable = input(false, { transform: booleanAttribute });
  readonly accentTop = input(false, { transform: booleanAttribute });
  readonly accentLeft = input(false, { transform: booleanAttribute });
  readonly accentColor = input<CuiCardAccentColor>('emerald');
  readonly clickable = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });

  protected readonly hostClasses = computed(() => {
    const classes = ['cui-card', `cui-card--${this.variant()}`];

    switch (this.padding()) {
      case 'none':
        classes.push('cui-card--pad-none');
        break;
      case 'sm':
        classes.push('cui-card--pad-sm');
        break;
      case 'lg':
        classes.push('cui-card--pad-lg');
        break;
      default:
        classes.push('cui-card--pad-md');
    }

    if (this.status() !== 'none') {
      classes.push(`cui-card--status-${this.status()}`);
    }

    if (this.hoverable()) classes.push('cui-card--hoverable');
    if (this.accentTop()) {
      classes.push('cui-card--accent-top');
      classes.push(`cui-card--accent-${this.accentColor()}`);
    }
    if (this.accentLeft()) {
      classes.push('cui-card--accent-left');
      classes.push(`cui-card--accent-${this.accentColor()}`);
    }
    if (this.clickable()) classes.push('cui-card--clickable');
    if (this.disabled()) classes.push('cui-card--disabled');

    return classes.join(' ');
  });

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.clickable() || this.disabled()) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      (event.currentTarget as HTMLElement).click();
    }
  }
}
