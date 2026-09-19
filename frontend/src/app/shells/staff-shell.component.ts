import { Component } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { CuiAppShellComponent, CuiHeaderComponent, CuiHeaderDrawerDirective, CuiNavItemComponent, CuiSidebarShellComponent } from '@certinal/ui';

@Component({
  standalone: true,
  imports: [RouterOutlet, RouterLink, CuiAppShellComponent, CuiHeaderComponent, CuiHeaderDrawerDirective, CuiNavItemComponent, CuiSidebarShellComponent],
  template: `
    <cui-app-shell #staffAppShell data-testid="staff-shell" [desktopBreakpoint]="899">
      <!-- Cui 0.0.1 renders a native header inside a host that also declares
           role=banner. Suppress the duplicate host landmark at the consumer. -->
      <cui-header #staffHeader header role="presentation">
        <a logo routerLink="/workspaces/demo/forms" class="type-h4">SmartIntake</a>
        <nav avatar aria-label="Primary navigation" class="hidden min-[900px]:flex min-[1025px]:hidden items-center gap-1">
          <cui-nav-item label="Forms" icon="file-text" [active]="isFormsActive()" (navClick)="go('/workspaces/demo/forms')" />
          <cui-nav-item label="Responses" icon="inbox" [active]="isResponsesActive()" (navClick)="go('/workspaces/demo/submissions')" />
          <cui-nav-item label="Settings" icon="settings" [active]="isSettingsActive()" (navClick)="go('/settings/organization')" />
        </nav>
        <ng-template cuiHeaderDrawer>
          <nav aria-label="Primary navigation" class="py-2">
            <cui-nav-item label="Forms" icon="file-text" [active]="isFormsActive()" (navClick)="go('/workspaces/demo/forms', staffHeader)" />
            <cui-nav-item label="Responses" icon="inbox" [active]="isResponsesActive()" (navClick)="go('/workspaces/demo/submissions', staffHeader)" />
            <cui-nav-item label="Settings" icon="settings" [active]="isSettingsActive()" (navClick)="go('/settings/organization', staffHeader)" />
          </nav>
        </ng-template>
      </cui-header>
      <cui-sidebar-shell sidebar class="staff-desktop-sidebar" [collapsed]="staffAppShell.sidebarCollapsed()">
        <cui-nav-item label="Forms" icon="file-text" [collapsed]="staffAppShell.sidebarCollapsed()" [active]="isFormsActive()" (navClick)="go('/workspaces/demo/forms')" />
        <cui-nav-item label="Responses" icon="inbox" [collapsed]="staffAppShell.sidebarCollapsed()" [active]="isResponsesActive()" (navClick)="go('/workspaces/demo/submissions')" />
        <cui-nav-item label="Settings" icon="settings" [collapsed]="staffAppShell.sidebarCollapsed()" [active]="isSettingsActive()" (navClick)="go('/settings/organization')" />
      </cui-sidebar-shell>
      <router-outlet />
    </cui-app-shell>
  `,
})
export class StaffShellComponent {
  constructor(private readonly router: Router) {}

  go(url: string, header?: CuiHeaderComponent): void {
    header?.closeDrawer();
    void this.router.navigateByUrl(url);
  }

  isFormsActive(): boolean { return this.router.url.startsWith('/workspaces/') && this.router.url.includes('/forms'); }
  isResponsesActive(): boolean { return this.router.url.startsWith('/workspaces/') && this.router.url.includes('/submissions'); }
  isSettingsActive(): boolean { return this.router.url.startsWith('/settings/'); }
}
