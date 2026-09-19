import { Component, input, model, output } from '@angular/core';
import { CuiProductTabComponent } from '../../primitives/product-tab/product-tab.component';
import { CuiIconComponent, CuiIconName } from '../../primitives/icon/icon.component';

export interface CuiPlatformTab {
  id: string;
  label: string;
  icon?: CuiIconName;
  disabled?: boolean;
}

@Component({
  selector: 'cui-platform-tabs',
  standalone: true,
  imports: [CuiProductTabComponent, CuiIconComponent],
  templateUrl: './platform-tabs.component.html',
  host: {
    class: 'block',
  },
})
export class CuiPlatformTabsComponent {
  readonly tabs = input.required<CuiPlatformTab[]>();
  readonly activeId = model<string>('');

  readonly activeChange = output<string>();

  protected onTabClick(id: string): void {
    this.activeId.set(id);
    this.activeChange.emit(id);
  }
}
