import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ContentChild,
  HostListener,
  booleanAttribute,
  input,
  output,
  signal,
} from '@angular/core';
import { CuiIconComponent } from '../../primitives/icon/icon.component';
import { CuiIconButtonComponent } from '../../primitives/icon-button/icon-button.component';
import {
  CuiHeaderDrawerDirective,
  CuiHeaderIconsDirective,
  CuiHeaderTabsDirective,
} from './header.directives';

@Component({
  selector: 'cui-header',
  standalone: true,
  imports: [NgTemplateOutlet, CuiIconComponent, CuiIconButtonComponent],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css',
  host: {
    role: 'banner',
    class: 'block',
  },
})
export class CuiHeaderComponent {
  readonly sticky = input(true, { transform: booleanAttribute });
  readonly elevated = input(true, { transform: booleanAttribute });

  @ContentChild(CuiHeaderTabsDirective) tabs?: CuiHeaderTabsDirective;
  @ContentChild(CuiHeaderIconsDirective) icons?: CuiHeaderIconsDirective;
  @ContentChild(CuiHeaderDrawerDirective) drawer?: CuiHeaderDrawerDirective;

  readonly hamburgerClick = output<void>();
  readonly isDrawerOpen = signal(false);
  readonly currentYear = new Date().getFullYear();

  openDrawer(): void {
    this.isDrawerOpen.set(true);
    this.hamburgerClick.emit();
  }

  closeDrawer(): void {
    this.isDrawerOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isDrawerOpen()) {
      this.closeDrawer();
    }
  }
}
