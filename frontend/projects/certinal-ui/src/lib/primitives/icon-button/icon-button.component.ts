import { Component, booleanAttribute, computed, input, output } from '@angular/core';

export type CuiIconButtonVariant = 'default' | 'primary' | 'danger' | 'inverse';
export type CuiIconButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'cui-icon-button',
  templateUrl: './icon-button.component.html',
  host: {
    class: 'inline-block',
  },
})
export class CuiIconButtonComponent {
  readonly variant = input<CuiIconButtonVariant>('default');
  readonly size = input<CuiIconButtonSize>('md');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly badge = input(false, { transform: booleanAttribute });
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly ariaLabel = input<string>('');
  readonly ariaExpanded = input<boolean | null>(null);
  readonly ariaControls = input<string | null>(null);

  // For Button click events
  readonly buttonClick = output<MouseEvent>();

  readonly buttonClasses = computed(() => {
    const classes: string[] = [
      // Base layout
      'relative inline-flex items-center justify-center',
      'rounded-md border-0 bg-transparent',
      'cursor-pointer',
      // Transition
      'transition-colors duration-150 ease-out',
      // Focus ring (a11y)
      'focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:outline-offset-2',
    ];

    // Variant
    switch (this.variant()) {
      case 'default':
        classes.push(
          'text-text-muted',
          'hover:bg-bg-subtle hover:text-text-secondary',
        );
        break;
      case 'primary':
        classes.push(
          'text-emerald-600',
          'hover:bg-emerald-50',
        );
        break;
      case 'danger':
        classes.push(
          'text-error',
          'hover:bg-error-light',
        );
        break;
      case 'inverse':
        classes.push(
          'text-white/70',
          'hover:bg-white/10 hover:text-white',
        );
        break;
    }

    // Size
    switch (this.size()) {
      case 'sm':
        classes.push('p-1.5');
        break;
      case 'md':
        classes.push('p-2');
        break;
      case 'lg':
        classes.push('p-2.5');
        break;
    }

    // Disabled
    if (this.disabled()) {
      classes.push('opacity-40 !cursor-not-allowed pointer-events-none');
    }

    return classes.join(' ');
  });
}
