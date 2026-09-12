import { Component, input } from '@angular/core';

@Component({
  selector: 'cui-modal-header',
  standalone: true,
  templateUrl: './modal-header.component.html',
  styleUrl: './modal-header.component.css',
  host: {
    class: 'cui-modal-header',
  },
})
export class CuiModalHeaderComponent {
  readonly title = input<string | undefined>(undefined);
  readonly subtitle = input<string | undefined>(undefined);
  readonly titleId = input<string | undefined>(undefined);
}
