import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { CuiAppShellComponent, CuiButtonComponent, CuiHeaderComponent, CuiHeaderDrawerDirective, CuiIconComponent, CuiNavItemComponent, CuiSelectComponent, CuiSidebarShellComponent } from '@certinal/ui';
import { StaffSessionStore } from '../core/m5-session.store';

@Component({
  standalone: true,
  imports: [RouterOutlet, RouterLink, CuiAppShellComponent, CuiButtonComponent, CuiHeaderComponent, CuiHeaderDrawerDirective, CuiIconComponent, CuiNavItemComponent, CuiSelectComponent, CuiSidebarShellComponent],
  template: `
    <div data-testid="staff-shell"><cui-app-shell>
      <cui-header #staffHeader header role="presentation">
        <a logo [routerLink]="formsUrl()" class="type-h4">SmartIntake</a>
        @if (session.currentOrganization()) {
          <div class="hidden min-[900px]:flex items-center gap-2" data-testid="session-context">
            <cui-select size="sm" aria-label="Organization" [options]="organizationOptions()" [value]="session.currentOrganizationId()" (valueChange)="selectOrganization($event)" />
            <cui-select size="sm" aria-label="Workspace" [options]="workspaceOptions()" [value]="session.currentWorkspaceId()" (valueChange)="selectWorkspace($event)" />
          </div>
        }
        <nav avatar aria-label="Primary navigation" class="hidden min-[900px]:flex min-[1025px]:hidden items-center gap-1">
          <cui-nav-item label="Forms" icon="file-text" [active]="isFormsActive()" (navClick)="go(formsUrl())" />
          <cui-nav-item label="Responses" icon="inbox" [active]="isResponsesActive()" (navClick)="go(responsesUrl())" />
          <cui-nav-item label="Settings" icon="settings" [active]="isSettingsActive()" (navClick)="go('/settings/organization')" />
          <cui-button size="sm" variant="tertiary" (buttonClick)="logout()">Sign out</cui-button>
        </nav>
        <ng-template cuiHeaderDrawer><nav aria-label="Primary navigation" class="flex flex-col items-stretch gap-2 p-4">
          <cui-button [attr.aria-current]="isFormsActive() ? 'page' : null" [variant]="isFormsActive() ? 'secondary02' : 'secondary'" (buttonClick)="go(formsUrl(), staffHeader)">Forms</cui-button>
          <cui-button [attr.aria-current]="isResponsesActive() ? 'page' : null" [variant]="isResponsesActive() ? 'secondary02' : 'secondary'" (buttonClick)="go(responsesUrl(), staffHeader)">Responses</cui-button>
          <cui-button (buttonClick)="go('/settings/organization', staffHeader)">Settings</cui-button><cui-button variant="tertiary" (buttonClick)="logout()">Sign out</cui-button>
        </nav></ng-template>
      </cui-header><router-outlet /></cui-app-shell>
      <cui-sidebar-shell class="staff-desktop-sidebar" [collapsed]="false"><div class="flex flex-col items-stretch gap-2 p-3">
        <p class="type-caption">{{ session.currentOrganization()?.name || 'No organization' }}</p><p class="type-caption">{{ session.currentWorkspace()?.name || 'No workspace' }}</p>
        <cui-button [attr.aria-current]="isFormsActive() ? 'page' : null" [variant]="isFormsActive() ? 'secondary02' : 'secondary'" (buttonClick)="go(formsUrl())"><span class="flex items-center gap-2"><cui-icon name="file-text" size="sm" />Forms</span></cui-button>
        <cui-button [attr.aria-current]="isResponsesActive() ? 'page' : null" [variant]="isResponsesActive() ? 'secondary02' : 'secondary'" (buttonClick)="go(responsesUrl())"><span class="flex items-center gap-2"><cui-icon name="inbox" size="sm" />Responses</span></cui-button>
        @if (canAdmin()) { <cui-button [attr.aria-current]="isSettingsActive() ? 'page' : null" [variant]="isSettingsActive() ? 'secondary02' : 'secondary'" (buttonClick)="go('/settings/organization')"><span class="flex items-center gap-2"><cui-icon name="settings" size="sm" />Settings</span></cui-button> }
        <cui-button variant="tertiary" (buttonClick)="logout()">Sign out</cui-button>
      </div></cui-sidebar-shell>
    </div>`,
})
export class StaffShellComponent {
  readonly session = inject(StaffSessionStore);
  private readonly router = inject(Router);
  readonly organizationOptions = computed(() => this.session.organizations().map((item) => ({ label: item.name, value: item.organizationId })));
  readonly workspaceOptions = computed(() => this.session.currentOrganization()?.workspaces.map((item) => ({ label: item.name, value: item.workspaceId })) ?? []);
  canAdmin(): boolean { return this.session.currentRoles().some((role) => ['administrator', 'owner'].includes(role)); }
  formsUrl(): string { const id = this.session.currentWorkspaceId(); return id ? `/workspaces/${id}/forms` : '/settings/organization'; }
  responsesUrl(): string { const id = this.session.currentWorkspaceId(); return id ? `/workspaces/${id}/submissions` : '/settings/organization'; }
  selectOrganization(id: string | null): void { if (id) { this.session.selectOrganization(id); void this.router.navigateByUrl(this.formsUrl()); } }
  selectWorkspace(id: string | null): void { if (id) { this.session.selectWorkspace(id); void this.router.navigateByUrl(this.formsUrl()); } }
  go(url: string, header?: CuiHeaderComponent): void { header?.closeDrawer(); void this.router.navigateByUrl(url); }
  logout(): void { this.session.signOut().subscribe(() => void this.router.navigate(['/sign-in'])); }
  isFormsActive(): boolean { return this.router.url.includes('/forms'); }
  isResponsesActive(): boolean { return this.router.url.includes('/submissions'); }
  isSettingsActive(): boolean { return this.router.url.startsWith('/settings/') || this.router.url.startsWith('/users') || this.router.url.startsWith('/invitations') || this.router.url.startsWith('/platform/'); }
}
