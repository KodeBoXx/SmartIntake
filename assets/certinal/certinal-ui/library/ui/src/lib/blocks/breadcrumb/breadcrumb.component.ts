import { Component, input, output } from '@angular/core';
import { CuiIconComponent } from '../../primitives/icon/icon.component';

export interface CuiBreadcrumbItem {
  label: string;
  href?: string;
}

export interface CuiBreadcrumbClickEvent {
  item: CuiBreadcrumbItem;
  event: MouseEvent;
}

@Component({
  selector: 'cui-breadcrumb',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './breadcrumb.component.html',
  host: { class: 'block' },
})
export class CuiBreadcrumbComponent {
  readonly items = input.required<CuiBreadcrumbItem[]>();

  readonly itemClick = output<CuiBreadcrumbClickEvent>();

  protected onClick(item: CuiBreadcrumbItem, event: MouseEvent): void {
    this.itemClick.emit({ item, event });
  }
}
