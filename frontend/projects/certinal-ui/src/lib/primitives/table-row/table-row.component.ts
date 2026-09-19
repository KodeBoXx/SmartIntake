import {
  Component,
  HostListener,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'tr[cuiTableRow]',
  template: '<ng-content />',
  host: {
    '[class]': 'hostClasses()',
    '[attr.aria-disabled]': 'disabled() ? "true" : null',
    '[attr.aria-selected]': 'selected() ? "true" : null',
    '[attr.tabindex]': 'clickable() && !disabled() ? 0 : null',
    '[attr.role]': 'clickable() ? "button" : null',
  },
})
export class CuiTableRowComponent {
  readonly clickable = input(false, { transform: booleanAttribute });
  readonly selected = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });

  readonly rowClick = output<void>();

  readonly hostClasses = computed(() => {
    const classes: string[] = ['transition-colors duration-200 ease-out'];

    if (this.selected()) {
      classes.push('bg-emerald-50');
    } else {
      classes.push('bg-bg-surface');
    }

    if (this.disabled()) {
      classes.push('opacity-50 cursor-not-allowed');
    } else if (this.clickable()) {
      classes.push(
        'cursor-pointer',
        'hover:bg-bg-subtle',
        'outline-none focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:outline-offset-[-3px]',
      );
    }

    return classes.join(' ');
  });

  @HostListener('click')
  onClick(): void {
    if (!this.clickable() || this.disabled()) return;
    this.rowClick.emit();
  }

  @HostListener('keydown.enter', ['$event'])
  @HostListener('keydown.space', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.clickable() || this.disabled()) return;
    event.preventDefault();
    this.rowClick.emit();
  }
}
