import { Routes } from '@angular/router';
import { m5StaffGuard } from './core/m5-session.guards';

const auth = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/auth/auth-page.component').then((m) => m.AuthPageComponent) });
const adminStaff = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/staff/domains/admin-staff-page.component').then((m) => m.AdminStaffPageComponent) });
const catalogStaff = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/staff/domains/catalog-staff-page.component').then((m) => m.CatalogStaffPageComponent) });
const responseStaff = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/staff/domains/response-staff-page.component').then((m) => m.ResponseStaffPageComponent) });
const settingsStaff = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/staff/domains/settings-staff-page.component').then((m) => m.SettingsStaffPageComponent) });
const publicPage = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/public/public-page.component').then((m) => m.PublicPageComponent) });

export const appRoutes: Routes = [
  auth('sign-in', 'sign-in'),
  auth('setup', 'setup'),
  auth('activation', 'activation'),
  auth('recovery', 'recovery'),
  // Frozen M1 lifecycle remains independently reachable, guarded, and shell-less.
  { path: 'catalog/builder', canActivate: [m5StaffGuard], loadComponent: () => import('./app.component').then((m) => m.AppComponent) },
  {
    path: '', canActivate: [m5StaffGuard], loadComponent: () => import('./shells/staff-shell.component').then((m) => m.StaffShellComponent), children: [
      { path: '', pathMatch: 'full', redirectTo: 'workspaces/demo/forms' },
      adminStaff('platform/organizations', 'platform-organizations'),
      settingsStaff('settings/organization', 'organization-settings'),
      settingsStaff('settings/provider-policy', 'provider-policy'),
      adminStaff('users', 'user-list'),
      adminStaff('users/new', 'add-user'),
      adminStaff('users/:userId', 'user-detail'),
      adminStaff('users/:userId/roles', 'role-assignment'),
      adminStaff('invitations', 'invitation-delivery'),
      catalogStaff('workspaces/:workspaceId/forms', 'catalog'),
      catalogStaff('workspaces/:workspaceId/forms/new', 'catalog'),
      catalogStaff('workspaces/:workspaceId/forms/:formId/drafts/:draftId', 'builder'),
      catalogStaff('preview/:draftId', 'preview'),
      catalogStaff('workspaces/:workspaceId/forms/:formId/review', 'review-publish'),
      responseStaff('workspaces/:workspaceId/submissions', 'responses'),
      responseStaff('workspaces/:workspaceId/submissions/:submissionId', 'response-detail'),
      responseStaff('workspaces/:workspaceId/exports', 'export-history'),
      settingsStaff('workspaces/:workspaceId/integrations', 'integrations'),
    ],
  },
  {
    path: '', loadComponent: () => import('./shells/public-shell.component').then((m) => m.PublicShellComponent), children: [
      publicPage('f/:shareId', 'public-entry'),
      publicPage('sessions/:sessionId', 'public-form'),
      publicPage('sessions/:sessionId/review', 'public-review'),
      publicPage('sessions/:sessionId/receipt', 'receipt'),
    ],
  },
  { path: 'not-found', loadComponent: () => import('./features/staff/not-found.component').then((m) => m.NotFoundComponent) },
  { path: '**', redirectTo: 'not-found' },
];
