import { Component, booleanAttribute, computed, input } from '@angular/core';

@Component({
  selector: 'cui-sidebar-shell',
  templateUrl: './sidebar-shell.component.html',
  styleUrl: './sidebar-shell.component.css',
  host: {
    class: 'block shrink-0 h-full',
  },
})
export class CuiSidebarShellComponent {
  readonly collapsed = input(false, { transform: booleanAttribute });
  readonly expandedWidth = input<string>('270px');
  readonly collapsedWidth = input<string>('72px');

  readonly currentYear = new Date().getFullYear();

  readonly asideStyle = computed(() => ({
    width: this.collapsed() ? this.collapsedWidth() : this.expandedWidth(),
    transition: 'width var(--dur-base) var(--ease-out)',
  }));
}
