import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CuiIconComponent } from '../../primitives/icon/icon.component';

@Component({
  selector: 'cui-app-shell',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './app-shell.component.html',
  host: {
    class: 'block h-screen',
  },
})
export class CuiAppShellComponent {
  readonly maxContentWidth = input<number>(1200);
  readonly contentPadding = input<number>(24);
  readonly contentPaddingMobile = input<number>(16);
  readonly desktopBreakpoint = input<number>(1024);

  readonly sidebarCollapsed = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly mediaQuery = window.matchMedia(
    `(min-width: ${this.desktopBreakpoint()}px)`,
  );

  readonly isDesktop = signal(this.mediaQuery.matches);

  readonly contentStyle = computed(() => ({
    'max-width': `${this.maxContentWidth()}px`,
    'padding': `${this.isDesktop() ? this.contentPadding() : this.contentPaddingMobile()}px`,
  }));

  constructor() {
    const handler = (e: MediaQueryListEvent) => this.isDesktop.set(e.matches);
    this.mediaQuery.addEventListener('change', handler);
    this.destroyRef.onDestroy(() =>
      this.mediaQuery.removeEventListener('change', handler),
    );
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }
}
