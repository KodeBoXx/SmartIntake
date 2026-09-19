import { Component, booleanAttribute, computed, input, output } from '@angular/core';

export type CuiButtonVariant = 'primary' | 'primary02' | 'secondary' | 'secondary02' | 'tertiary' | 'danger';
export type CuiButtonSize = 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'cui-button',
  templateUrl: './button.component.html',
  styleUrl: './button.component.css',
  host: {
    class: 'inline-block',
  },
})
export class CuiButtonComponent {
  readonly variant = input<CuiButtonVariant>('primary');
  readonly size = input<CuiButtonSize>('md');
  readonly loading = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly iconOnly = input(false, { transform: booleanAttribute });
  readonly type = input<'button' | 'submit' | 'reset'>('button');

  // For Button click events
  readonly buttonClick = output<MouseEvent>();

  readonly buttonClasses = computed(() => {
    const classes: string[] = [
      // Base layout
      'inline-flex items-center justify-center gap-2',
      // Typography — family/weight/leading shared across sizes; size set per variant below
      'font-body font-medium leading-none',
      'border-[1.5px]',
      'cursor-pointer whitespace-nowrap',
      'relative overflow-hidden',
      // Transition & interaction
      'transition-[background-color,border-color,color,box-shadow,transform] duration-300 ease-in-out',
      'hover:-translate-y-[1px]',
      'active:scale-[0.97]',
      // Focus ring (a11y)
      'focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:outline-offset-2',
    ];

    // Variant
    switch (this.variant()) {
      case 'primary':
        classes.push(
          'bg-emerald-500 text-white border-transparent',
          'hover:bg-emerald-400 hover:shadow-md',
        );
        break;
      case 'primary02':
        classes.push(
          'bg-success text-emerald-900 border-transparent',
          'hover:bg-emerald-400 hover:text-white hover:shadow-md',
        );
        break;
      case 'secondary':
        classes.push(
          'bg-bg-surface text-text-primary border-border-strong',
          'hover:bg-bg-subtle hover:border-emerald-400',
        );
        break;
      case 'secondary02':
        classes.push(
          'bg-bg-surface text-text-primary border-emerald-400',
          'hover:bg-bg-subtle',
        );
        break;
      case 'tertiary':
        classes.push(
          'bg-transparent text-emerald-600 border-transparent',
          'hover:bg-emerald-50',
        );
        break;
      case 'danger':
        classes.push(
          'bg-error text-white border-transparent',
          'hover:bg-error-dark',
        );
        break;
    }

    // Size & shape
    if (this.iconOnly()) {
      classes.push('w-10 h-10 p-0 rounded-md');
    } else {
      classes.push('rounded-full');
      switch (this.size()) {
        case 'sm':
          classes.push('py-[6px] px-4 text-t-200');
          break;
        case 'md':
          classes.push('py-3 px-5 text-t-300');
          break;
        case 'lg':
          classes.push('py-4 px-8 text-t-400');
          break;
        case 'xl':
          classes.push('py-5 px-10 text-t-500');
          break;
      }
    }

    // Disabled / loading
    if (this.disabled() || this.loading()) {
      classes.push('opacity-40 !cursor-not-allowed pointer-events-none');
    }

    return classes.join(' ');
  });
}
