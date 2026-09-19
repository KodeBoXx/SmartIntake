import { Component, booleanAttribute, computed, input, output } from '@angular/core';
import { CuiIconComponent, CuiIconName } from '../../primitives/icon/icon.component';
import { CuiIconButtonComponent } from '../../primitives/icon-button/icon-button.component';

export type CuiAlertVariant = 'info' | 'success' | 'warning' | 'error' | 'neutral';

@Component({
  selector: 'cui-alert',
  standalone: true,
  imports: [CuiIconComponent, CuiIconButtonComponent],
  templateUrl: './alert.component.html',
  host: { class: 'block' },
})
export class CuiAlertComponent {
  readonly variant = input<CuiAlertVariant>('info');
  readonly title = input<string | undefined>(undefined);
  readonly closable = input(false, { transform: booleanAttribute });

  readonly closed = output<void>();

  readonly iconName = computed<CuiIconName>(() => {
    switch (this.variant()) {
      case 'success': return 'check-circle';
      case 'error': return 'alert-circle';
      case 'warning': return 'alert-triangle';
      case 'info': return 'info';
      default: return 'info';
    }
  });

  readonly containerClasses = computed(() => {
    const base = ['flex items-start gap-3', 'p-4', 'rounded-lg', 'border'];
    switch (this.variant()) {
      case 'success': base.push('bg-success-light border-success/40'); break;
      case 'error': base.push('bg-error-light border-error/40'); break;
      case 'warning': base.push('bg-warning-light border-warning/40'); break;
      case 'info': base.push('bg-info-light border-info/40'); break;
      default: base.push('bg-bg-subtle border-border-default');
    }
    return base.join(' ');
  });

  readonly iconClasses = computed(() => {
    const base = ['shrink-0 mt-0.5'];
    switch (this.variant()) {
      case 'success': base.push('text-success-dark'); break;
      case 'error': base.push('text-error-dark'); break;
      case 'warning': base.push('text-warning-dark'); break;
      case 'info': base.push('text-info-dark'); break;
      default: base.push('text-text-muted');
    }
    return base.join(' ');
  });

  readonly titleClasses = computed(() => {
    const base = ['type-label', 'mb-1'];
    switch (this.variant()) {
      case 'success': base.push('text-success-dark'); break;
      case 'error': base.push('text-error-dark'); break;
      case 'warning': base.push('text-warning-dark'); break;
      case 'info': base.push('text-info-dark'); break;
      default: base.push('text-text-primary');
    }
    return base.join(' ');
  });
}
