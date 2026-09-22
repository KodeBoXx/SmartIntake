import { Routes } from '@angular/router';
import { anonymousOnlyGuard, staffSessionGuard } from './core/m5-session.guards';

const auth = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/auth/auth-page.component').then((m) => m.AuthPageComponent) });
const adminStaff = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/staff/domains/admin-staff-page.component').then((m) => m.AdminStaffPageComponent) });
const catalogStaff = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/staff/domains/catalog-staff-page.component').then((m) => m.CatalogStaffPageComponent) });
const responseStaff = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/staff/domains/response-staff-page.component').then((m) => m.ResponseStaffPageComponent) });
const settingsStaff = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/staff/domains/settings-staff-page.component').then((m) => m.SettingsStaffPageComponent) });
const publicPage = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/public/public-page.component').then((m) => m.PublicPageComponent) });

export const appRoutes: Routes = [
  { ...auth('sign-in', 'sign-in'), canActivate: [anonymousOnlyGuard] },
  { ...auth('setup', 'setup'), canActivate: [anonymousOnlyGuard] },
  { ...auth('activation', 'activation'), canActivate: [anonymousOnlyGuard] },
  { ...auth('activation/:token', 'activation'), canActivate: [anonymousOnlyGuard] },
  { ...auth('invite/:token', 'invitation'), canActivate: [anonymousOnlyGuard] },
  { ...auth('invitation', 'invitation'), canActivate: [anonymousOnlyGuard] },
  { ...auth('recovery', 'recovery'), canActivate: [anonymousOnlyGuard] },
  // Frozen M1 lifecycle remains independently reachable, guarded, and shell-less.
  { path: 'catalog/builder', canActivate: [staffSessionGuard], loadComponent: () => import('./app.component').then((m) => m.AppComponent) },
  {
    path: '', canActivate: [staffSessionGuard], loadComponent: () => import('./shells/staff-shell.component').then((m) => m.StaffShellComponent), children: [
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
      { path: 'preview/:draftId', data: { screen: 'preview' }, loadComponent: () => import('./app.component').then((m) => m.AppComponent) },
      { path: 'workspaces/:workspaceId/forms/new', data: { screen: 'builder' }, loadComponent: () => import('./app.component').then((m) => m.AppComponent) },
      {
        path: 'workspaces/:workspaceId/forms/:formId/drafts/:draftId/author',
        loadComponent: () => import('./features/authoring/authoring-page.component').then((m) => m.AuthoringPageComponent),
        children: [
          { path: 'preview', data: { authoringTab: 'preview' } },
          { path: 'history', data: { authoringTab: 'history' } },
          { path: 'import', data: { authoringTab: 'import' } },
          { path: 'components', data: { authoringTab: 'components' } },
          { path: 'theme', data: { authoringTab: 'theme' } },
          { path: 'content', data: { authoringTab: 'content' } },
        ],
      },
      { path: 'workspaces/:workspaceId/forms/:formId/drafts/:draftId', data: { screen: 'builder' }, loadComponent: () => import('./app.component').then((m) => m.AppComponent) },
      { path: 'workspaces/:workspaceId/forms/:formId/drafts/:draftId/preview', data: { screen: 'preview' }, loadComponent: () => import('./app.component').then((m) => m.AppComponent) },
      { path: 'workspaces/:workspaceId/forms/:formId/review', data: { screen: 'review-publish' }, loadComponent: () => import('./app.component').then((m) => m.AppComponent) },
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
