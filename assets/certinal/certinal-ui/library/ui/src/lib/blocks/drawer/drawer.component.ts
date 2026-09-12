
import {
  Component,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  DOCUMENT
} from '@angular/core';
import { CuiIconComponent } from '../../primitives/icon/icon.component';
import { CuiIconButtonComponent } from '../../primitives/icon-button/icon-button.component';

export type CuiDrawerPosition = 'left' | 'right' | 'top' | 'bottom';
export type CuiDrawerSize = 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'cui-drawer',
  standalone: true,
  imports: [CuiIconComponent, CuiIconButtonComponent],
  templateUrl: './drawer.component.html',
  styleUrl: './drawer.component.css',
})
export class CuiDrawerComponent {
  private readonly document = inject(DOCUMENT);

  readonly open = model(false);
  readonly position = input<CuiDrawerPosition>('right');
  readonly size = input<CuiDrawerSize>('md');
  readonly title = input<string | undefined>(undefined);
  readonly closeOnOverlay = input(true, { transform: booleanAttribute });
  readonly closeOnEsc = input(true, { transform: booleanAttribute });
  readonly showClose = input(true, { transform: booleanAttribute });

  readonly closed = output<void>();

  readonly panelClasses = computed(() => {
    const base = [
      'fixed bg-bg-surface shadow-xl flex flex-col',
      'animate-cui-drawer-in',
    ];
    const pos = this.position();
    const size = this.size();

    if (pos === 'left' || pos === 'right') {
      base.push('top-0 bottom-0 h-full');
      switch (size) {
        case 'sm': base.push('w-80'); break;
        case 'lg': base.push('w-[600px] max-w-[90vw]'); break;
        case 'xl': base.push('w-[800px] max-w-[95vw]'); break;
        default: base.push('w-[480px] max-w-[90vw]');
      }
      if (pos === 'left') base.push('left-0 origin-left');
      else base.push('right-0 origin-right');
    } else {
      base.push('left-0 right-0 w-full');
      switch (size) {
        case 'sm': base.push('h-64'); break;
        case 'lg': base.push('h-[60vh]'); break;
        case 'xl': base.push('h-[80vh]'); break;
        default: base.push('h-[40vh]');
      }
      if (pos === 'top') base.push('top-0 origin-top');
      else base.push('bottom-0 origin-bottom');
    }
    return base.join(' ');
  });

  constructor() {
    effect(() => {
      if (this.open()) {
        this.document.body.style.overflow = 'hidden';
      } else {
        this.document.body.style.overflow = '';
        this.closed.emit();
      }
    });
  }

  protected close(): void {
    if (this.open()) this.open.set(false);
  }

  protected onOverlayClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    if (!this.closeOnOverlay()) return;
    this.close();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.closeOnEsc()) {
      event.preventDefault();
      this.close();
    }
  }
}
