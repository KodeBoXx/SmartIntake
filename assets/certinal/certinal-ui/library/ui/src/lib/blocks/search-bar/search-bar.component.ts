import { Component, booleanAttribute, input, model } from '@angular/core';
import { CuiInputComponent, CuiInputSize } from '../../primitives/input/input.component';

@Component({
  selector: 'cui-search-bar',
  standalone: true,
  imports: [CuiInputComponent],
  template: `
    <cui-input
      type="search"
      [placeholder]="placeholder()"
      [(value)]="value"
      [size]="size()"
      [disabled]="disabled()"
      prefixIcon="search"
      autocomplete="off"
    />
  `,
  host: { class: 'block' },
})
export class CuiSearchBarComponent {
  readonly placeholder = input<string>('Search…');
  readonly value = model<string>('');
  readonly size = input<CuiInputSize>('md');
  readonly disabled = input(false, { transform: booleanAttribute });
}
