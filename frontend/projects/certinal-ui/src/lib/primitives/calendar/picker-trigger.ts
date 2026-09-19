/**
 * Shared trigger-styling helpers for the date/time picker primitives. Mirrors
 * `cui-select` so a `cui-date-picker` next to a `cui-select` looks identical.
 *
 * Internal to the date subsystem — not part of the public library surface.
 */

export type CuiPickerSize = 'sm' | 'md' | 'lg';

export interface CuiPickerTriggerState {
  size: CuiPickerSize;
  isDisabled: boolean;
  hasError: boolean;
  isSuccess: boolean;
  isOpen: boolean;
  hasValue: boolean;
}

export function cuiPickerTriggerClasses(state: CuiPickerTriggerState): string {
  const classes: string[] = [
    'w-full flex items-center gap-2',
    'bg-bg-surface border-[1.5px] rounded-lg',
    'text-left cursor-pointer',
    'font-body',
    'transition-[border-color,box-shadow] duration-150',
  ];

  switch (state.size) {
    case 'sm':
      classes.push('h-8 px-3 text-t-200');
      break;
    case 'lg':
      classes.push('h-12 px-4 text-t-300');
      break;
    default:
      classes.push('h-10 px-4 text-t-300');
  }

  if (state.isDisabled) {
    classes.push('border-border-default', 'bg-bg-subtle', 'opacity-50', 'cursor-not-allowed');
  } else if (state.hasError) {
    classes.push(
      'border-error',
      state.isOpen
        ? 'ring-[3px] ring-error/[.12]'
        : 'focus:ring-[3px] focus:ring-error/[.12]',
    );
  } else if (state.isSuccess) {
    classes.push(
      'border-success',
      state.isOpen
        ? 'ring-[3px] ring-emerald-400/15'
        : 'focus:ring-[3px] focus:ring-emerald-400/15',
    );
  } else if (state.isOpen) {
    classes.push('border-emerald-500', 'ring-[3px]', 'ring-emerald-400/15');
  } else if (state.hasValue) {
    classes.push(
      'border-emerald-200',
      'hover:border-emerald-400',
      'focus:border-emerald-500',
      'focus:ring-[3px]',
      'focus:ring-emerald-400/15',
    );
  } else {
    classes.push(
      'border-border-strong',
      'hover:border-emerald-400',
      'focus:border-emerald-500',
      'focus:ring-[3px]',
      'focus:ring-emerald-400/15',
    );
  }

  return classes.join(' ');
}

export function cuiPickerLabelClasses(hasValue: boolean): string {
  return ['flex-1 min-w-0 truncate', hasValue ? 'text-text-primary' : 'text-text-faint'].join(' ');
}

export function cuiPickerIconWrapperClasses(hasError: boolean): string {
  return [
    'flex items-center justify-center shrink-0',
    hasError ? 'text-error' : 'text-text-muted',
  ].join(' ');
}

export function cuiPickerIconSize(size: CuiPickerSize): 'xs' | 'sm' {
  return size === 'sm' ? 'xs' : 'sm';
}

export function cuiPickerPanelClasses(): string {
  return [
    'absolute left-0 top-full z-[100] mt-1',
    'w-max',
    'bg-bg-surface border border-border-default rounded-lg shadow-lg',
    'overflow-hidden',
  ].join(' ');
}

export function cuiPickerPanelFooterClasses(): string {
  return [
    'flex items-center justify-between gap-2',
    'px-3 py-2 border-t border-border-default bg-bg-subtle',
  ].join(' ');
}

/** Tertiary footer button — used for "Today", "Now", "Clear". */
export function cuiPickerFooterLinkClasses(): string {
  return [
    'inline-flex items-center justify-center px-2 py-1 rounded-md',
    'type-caption-bold text-emerald-700 hover:bg-emerald-50',
    'cursor-pointer transition-colors',
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
  ].join(' ');
}

/** Primary footer button — "Apply". */
export function cuiPickerFooterPrimaryClasses(): string {
  return [
    'inline-flex items-center justify-center px-3 py-1 rounded-md',
    'type-caption-bold bg-emerald-600 text-white hover:bg-emerald-700',
    'cursor-pointer transition-colors',
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600',
  ].join(' ');
}
