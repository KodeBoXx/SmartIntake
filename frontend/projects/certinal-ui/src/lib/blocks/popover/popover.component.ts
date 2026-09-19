import {
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

export type CuiPopoverPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'top-start'
  | 'top-end';

@Component({
  selector: 'cui-popover',
  standalone: true,
  templateUrl: './popover.component.html',
  host: {
    class: 'inline-block relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
})
export class CuiPopoverComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly placement = input<CuiPopoverPlacement>('bottom-start');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly width = input<string>('320px');

  protected readonly isOpen = signal(false);

  readonly panelClasses = computed(() => {
    const base = [
      'absolute z-[100]',
      'bg-bg-surface border border-border-default rounded-lg shadow-lg',
      'p-4',
    ];
    switch (this.placement()) {
      case 'bottom-start': base.push('top-full left-0'); break;
      case 'bottom-end': base.push('top-full right-0'); break;
      case 'top-start': base.push('bottom-full left-0'); break;
      case 'top-end': base.push('bottom-full right-0'); break;
    }
    return base.join(' ');
  });

  protected toggle(): void {
    if (this.disabled()) return;
    this.isOpen.update((v) => !v);
  }

  close(): void {
    if (this.isOpen()) this.isOpen.set(false);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node;
    if (!this.elementRef.nativeElement.contains(target)) {
      this.close();
    }
  }
}
