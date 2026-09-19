import { Component, input, model } from '@angular/core';
import { CuiTabComponent, CuiTabSize } from '../../primitives/tab/tab.component';

export interface CuiTabsItem {
  label: string;
  disabled?: boolean;
}

@Component({
  selector: 'cui-tabs',
  standalone: true,
  imports: [CuiTabComponent],
  templateUrl: './tabs.component.html',
  host: {
    class: 'block',
  },
})
export class CuiTabsComponent {
  readonly tabs = input.required<CuiTabsItem[]>();
  readonly activeIndex = model<number>(0);
  readonly size = input<CuiTabSize>('md');

  protected onTabClick(index: number): void {
    this.activeIndex.set(index);
  }
}
