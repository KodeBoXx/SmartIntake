import { Component } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { CuiAppShellComponent, CuiHeaderComponent, CuiNavItemComponent, CuiSidebarShellComponent } from '@certinal/ui';

@Component({
  standalone: true,
  imports: [RouterOutlet, RouterLink, CuiAppShellComponent, CuiHeaderComponent, CuiNavItemComponent, CuiSidebarShellComponent],
  template: `
    <cui-app-shell data-testid="staff-shell">
      <cui-header header role="presentation">
        <a logo routerLink="/workspaces/demo/forms" class="type-h4">SmartIntake</a>
        <span avatar class="type-caption">M5 shell</span>
      </cui-header>
      <cui-sidebar-shell sidebar>
        <cui-nav-item label="Forms" icon="file-text" [active]="isFormsActive()" (navClick)="go('/workspaces/demo/forms')" />
        <cui-nav-item label="Responses" icon="inbox" [active]="isResponsesActive()" (navClick)="go('/workspaces/demo/submissions')" />
        <cui-nav-item label="Settings" icon="settings" [active]="isSettingsActive()" (navClick)="go('/settings/organization')" />
      </cui-sidebar-shell>
      <router-outlet />
    </cui-app-shell>
  `,
})
export class StaffShellComponent {
  constructor(private readonly router: Router) {}
  go(url: string): void { void this.router.navigateByUrl(url); }
  isFormsActive(): boolean { return this.router.url.startsWith('/workspaces/') && this.router.url.includes('/forms'); }
  isResponsesActive(): boolean { return this.router.url.startsWith('/workspaces/') && this.router.url.includes('/submissions'); }
  isSettingsActive(): boolean { return this.router.url.startsWith('/settings/'); }
}
