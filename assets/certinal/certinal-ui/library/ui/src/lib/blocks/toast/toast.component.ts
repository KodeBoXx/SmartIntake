import { Component, booleanAttribute, computed, input, output } from '@angular/core';
import { CuiIconComponent, CuiIconName } from '../../primitives/icon/icon.component';
import { CuiIconButtonComponent } from '../../primitives/icon-button/icon-button.component';

export type CuiToastVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral';

@Component({
  selector: 'cui-toast',
  standalone: true,
  imports: [CuiIconComponent, CuiIconButtonComponent],
  templateUrl: './toast.component.html',
  host: {
    class: 'block',
    role: 'status',
    'aria-live': 'polite',
  },
})
export class CuiToastComponent {
  readonly variant = input<CuiToastVariant>('neutral');
  readonly title = input<string | undefined>(undefined);
  readonly message = input.required<string>();
  readonly closable = input(true, { transform: booleanAttribute });

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
    const base = [
      'flex items-start gap-3',
      'min-w-[300px] max-w-[420px]',
      'p-3 pr-2',
      'rounded-lg shadow-lg',
      'border-l-4',
      'bg-bg-surface',
    ];
    switch (this.variant()) {
      case 'success': base.push('border-l-success'); break;
      case 'error': base.push('border-l-error'); break;
      case 'warning': base.push('border-l-warning'); break;
      case 'info': base.push('border-l-info'); break;
      default: base.push('border-l-border-strong');
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
}
