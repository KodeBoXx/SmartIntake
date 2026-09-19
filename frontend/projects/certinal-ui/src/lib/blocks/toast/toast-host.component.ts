import { Component, computed, inject, input } from '@angular/core';
import { CuiToastComponent } from './toast.component';
import { CuiToastService } from './toast.service';

export type CuiToastPosition =
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'
  | 'bottom-center';

@Component({
  selector: 'cui-toast-host',
  standalone: true,
  imports: [CuiToastComponent],
  templateUrl: './toast-host.component.html',
  host: {
    class: 'contents',
  },
})
export class CuiToastHostComponent {
  protected readonly service = inject(CuiToastService);

  readonly position = input<CuiToastPosition>('top-right');

  readonly containerClasses = computed(() => {
    const base = ['fixed z-[400] flex flex-col gap-2 pointer-events-none'];
    switch (this.position()) {
      case 'top-right': base.push('top-4 right-4'); break;
      case 'top-left': base.push('top-4 left-4'); break;
      case 'bottom-right': base.push('bottom-4 right-4'); break;
      case 'bottom-left': base.push('bottom-4 left-4'); break;
      case 'top-center': base.push('top-4 left-1/2 -translate-x-1/2'); break;
      case 'bottom-center': base.push('bottom-4 left-1/2 -translate-x-1/2'); break;
    }
    return base.join(' ');
  });

  protected onClose(id: number): void {
    this.service.dismiss(id);
  }
}
