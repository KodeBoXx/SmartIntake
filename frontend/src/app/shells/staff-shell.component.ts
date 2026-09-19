import { Component } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { CuiAppShellComponent, CuiButtonComponent, CuiHeaderComponent, CuiHeaderDrawerDirective, CuiIconComponent, CuiNavItemComponent, CuiSidebarShellComponent } from '@certinal/ui';

@Component({
  standalone: true,
  imports: [RouterOutlet, RouterLink, CuiAppShellComponent, CuiButtonComponent, CuiHeaderComponent, CuiHeaderDrawerDirective, CuiIconComponent, CuiNavItemComponent, CuiSidebarShellComponent],
  template: `
    <div data-testid="staff-shell">
    <cui-app-shell>
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
          <nav aria-label="Primary navigation" class="flex flex-col items-stretch gap-2 p-4">
            <cui-button [attr.aria-current]="isFormsActive() ? 'page' : null" [variant]="isFormsActive() ? 'secondary02' : 'secondary'" (buttonClick)="go('/workspaces/demo/forms', staffHeader)"><span class="flex items-center gap-2"><cui-icon name="file-text" size="sm" />Forms</span></cui-button>
            <cui-button [attr.aria-current]="isResponsesActive() ? 'page' : null" [variant]="isResponsesActive() ? 'secondary02' : 'secondary'" (buttonClick)="go('/workspaces/demo/submissions', staffHeader)"><span class="flex items-center gap-2"><cui-icon name="inbox" size="sm" />Responses</span></cui-button>
            <cui-button [attr.aria-current]="isSettingsActive() ? 'page' : null" [variant]="isSettingsActive() ? 'secondary02' : 'secondary'" (buttonClick)="go('/settings/organization', staffHeader)"><span class="flex items-center gap-2"><cui-icon name="settings" size="sm" />Settings</span></cui-button>
          </nav>
        </ng-template>
      </cui-header>
      <router-outlet />
    </cui-app-shell>
    <cui-sidebar-shell class="staff-desktop-sidebar" [collapsed]="false">
      <div class="flex flex-col items-stretch gap-2 p-3">
        <cui-button [attr.aria-current]="isFormsActive() ? 'page' : null" [variant]="isFormsActive() ? 'secondary02' : 'secondary'" (buttonClick)="go('/workspaces/demo/forms')"><span class="flex items-center gap-2"><cui-icon name="file-text" size="sm" />Forms</span></cui-button>
        <cui-button [attr.aria-current]="isResponsesActive() ? 'page' : null" [variant]="isResponsesActive() ? 'secondary02' : 'secondary'" (buttonClick)="go('/workspaces/demo/submissions')"><span class="flex items-center gap-2"><cui-icon name="inbox" size="sm" />Responses</span></cui-button>
        <cui-button [attr.aria-current]="isSettingsActive() ? 'page' : null" [variant]="isSettingsActive() ? 'secondary02' : 'secondary'" (buttonClick)="go('/settings/organization')"><span class="flex items-center gap-2"><cui-icon name="settings" size="sm" />Settings</span></cui-button>
      </div>
    </cui-sidebar-shell>
    </div>
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
