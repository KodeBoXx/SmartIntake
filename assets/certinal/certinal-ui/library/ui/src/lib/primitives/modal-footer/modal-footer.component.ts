import { Component, input } from '@angular/core';

export type CuiModalFooterAlign = 'end' | 'start' | 'center' | 'between';

@Component({
  selector: 'cui-modal-footer',
  standalone: true,
  templateUrl: './modal-footer.component.html',
  styleUrl: './modal-footer.component.css',
  host: {
    class: 'cui-modal-footer',
    '[class]': 'hostClasses()',
  },
})
export class CuiModalFooterComponent {
  readonly align = input<CuiModalFooterAlign>('end');

  protected hostClasses() {
    return `cui-modal-footer cui-modal-footer--align-${this.align()}`;
  }
}
