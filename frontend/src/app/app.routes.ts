import { Routes } from '@angular/router';
import { m5StaffGuard } from './core/m5-session.guards';
import { StaffShellComponent } from './shells/staff-shell.component';
import { PublicShellComponent } from './shells/public-shell.component';

const auth = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/auth/auth-page.component').then((m) => m.AuthPageComponent) });
const staff = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/staff/staff-page.component').then((m) => m.StaffPageComponent) });
const publicPage = (path: string, screen: string) => ({ path, data: { screen }, loadComponent: () => import('./features/public/public-page.component').then((m) => m.PublicPageComponent) });

export const appRoutes: Routes = [
  auth('sign-in', 'sign-in'),
  auth('setup', 'setup'),
  auth('activation', 'activation'),
  auth('recovery', 'recovery'),
  {
    path: '', component: StaffShellComponent, canActivate: [m5StaffGuard], children: [
      { path: '', pathMatch: 'full', redirectTo: 'workspaces/demo/forms' },
      staff('platform/organizations', 'platform-organizations'),
      staff('settings/organization', 'organization-settings'),
      staff('settings/provider-policy', 'provider-policy'),
      staff('users', 'user-list'),
      staff('users/new', 'add-user'),
      staff('users/:userId', 'user-detail'),
      staff('users/:userId/roles', 'role-assignment'),
      staff('invitations', 'invitation-delivery'),
      staff('workspaces/:workspaceId/forms', 'catalog'),
      staff('workspaces/:workspaceId/forms/new', 'catalog'),
      staff('workspaces/:workspaceId/forms/:formId/drafts/:draftId', 'builder'),
      staff('preview/:draftId', 'preview'),
      staff('workspaces/:workspaceId/forms/:formId/review', 'review-publish'),
      staff('workspaces/:workspaceId/submissions', 'responses'),
      staff('workspaces/:workspaceId/submissions/:submissionId', 'response-detail'),
      staff('workspaces/:workspaceId/exports', 'export-history'),
      staff('workspaces/:workspaceId/integrations', 'integrations'),
      // Frozen M1 lifecycle remains intact behind this compatibility route.
      { path: 'catalog/builder', loadComponent: () => import('./app.component').then((m) => m.AppComponent) },
    ],
  },
  {
    path: '', component: PublicShellComponent, children: [
      publicPage('f/:shareId', 'public-entry'),
      publicPage('sessions/:sessionId', 'public-form'),
      publicPage('sessions/:sessionId/review', 'public-review'),
      publicPage('sessions/:sessionId/receipt', 'receipt'),
    ],
  },
  { path: 'not-found', loadComponent: () => import('./features/staff/not-found.component').then((m) => m.NotFoundComponent) },
  { path: '**', redirectTo: 'not-found' },
];
