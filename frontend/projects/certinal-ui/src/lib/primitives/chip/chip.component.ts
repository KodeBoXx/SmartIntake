import {
  Component,
  booleanAttribute,
  computed,
  EventEmitter,
  Output,
  input,
} from '@angular/core';
import { CuiIconComponent } from '../icon/icon.component';

export type CuiChipSize = 'sm' | 'md';

@Component({
  selector: 'cui-chip',
  standalone: true,
  imports: [CuiIconComponent],
  template: `
    <span [class]="chipClasses()" (click)="onChipClick()">
      <ng-content />
      @if (removable()) {
        <button
          type="button"
          [class]="removeBtnClasses()"
          aria-label="Remove"
          (click)="onRemoveClick($event)"
        >
          <cui-icon name="close" size="xs" />
        </button>
      }
    </span>
  `,
  host: {
    class: 'inline-block',
  },
})
export class CuiChipComponent {
  readonly active = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly removable = input(false, { transform: booleanAttribute });
  readonly size = input<CuiChipSize>('md');

  @Output() readonly remove = new EventEmitter<void>();
  @Output() readonly chipClick = new EventEmitter<void>();

  protected readonly chipClasses = computed(() => {
    const c = [
      'inline-flex items-center gap-2',
      'rounded-full border',
      'font-body font-medium',
      'transition-colors duration-150',
      'whitespace-nowrap',
    ];
    c.push(this.size() === 'sm' ? 'px-2.5 py-0.5 text-t-100' : 'px-3 py-1 text-t-200');

    if (this.disabled()) {
      c.push('bg-bg-subtle border-border-default text-text-faint cursor-not-allowed opacity-60');
    } else if (this.active()) {
      c.push('bg-emerald-100 border-emerald-400 text-emerald-700 cursor-pointer');
    } else {
      c.push(
        'bg-bg-subtle border-border-default text-text-secondary cursor-pointer',
        'hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-600',
      );
    }
    return c.join(' ');
  });

  protected readonly removeBtnClasses = computed(() =>
    [
      'inline-flex items-center justify-center shrink-0',
      'w-3.5 h-3.5 rounded-full',
      'bg-text-muted text-white',
      'transition-colors duration-150',
      'hover:bg-text-primary',
      'border-0 p-0 cursor-pointer',
    ].join(' '),
  );

  protected onChipClick(): void {
    if (this.disabled()) return;
    this.chipClick.emit();
  }

  protected onRemoveClick(e: Event): void {
    e.stopPropagation();
    if (this.disabled()) return;
    this.remove.emit();
  }
}
