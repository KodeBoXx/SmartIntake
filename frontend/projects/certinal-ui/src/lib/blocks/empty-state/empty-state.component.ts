import { Component, input } from '@angular/core';
import { CuiIconComponent, CuiIconName } from '../../primitives/icon/icon.component';

@Component({
  selector: 'cui-empty-state',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './empty-state.component.html',
  host: { class: 'block' },
})
export class CuiEmptyStateComponent {
  readonly icon = input<CuiIconName>('inbox');
  readonly title = input.required<string>();
  readonly description = input<string | undefined>(undefined);
}
