import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffCsrfContext } from './staff-csrf.interceptor';
import { StaffSessionStore } from './m5-session.store';

describe('StaffSessionStore', () => {
  beforeEach(() => localStorage.clear());
  it('bootstraps a safe identity from the authoritative server session', () => {
    const api = { session: vi.fn(() => of({ identity: { accountId: 'a1', username: 'owner' }, organizations: [], currentOrganizationId: null, csrfToken: 'csrf-1' })) } as any;
    const csrf = new StaffCsrfContext();
    const store = new StaffSessionStore(api, csrf);
    store.ensureLoaded().subscribe();
    expect(store.state()).toBe('authenticated');
    expect(store.identity()).toEqual({ accountId: 'a1', username: 'owner' });
    expect(csrf.token()).toBe('csrf-1');
  });

  it('treats a missing cookie as anonymous and retains only the login challenge', () => {
    const api = { session: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 401, headers: new HttpHeaders({ 'X-Login-CSRF-Token': 'challenge' }) }))) } as any;
    const store = new StaffSessionStore(api, new StaffCsrfContext());
    store.ensureLoaded().subscribe();
    expect(store.state()).toBe('anonymous');
    expect(store.identity()).toBeNull();
    expect(store.csrfToken()).toBe('challenge');
  });

  it('cleans local staff state even when a stale cookie has already expired', () => {
    const api = { signOut: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 401 }))) } as any;
    const csrf = new StaffCsrfContext();
    localStorage.setItem('smart-intake.authoring.account-1.workspace.form.draft', 'draft');
    const store = new StaffSessionStore(api, csrf);
    store.signOut().subscribe();
    expect(store.state()).toBe('anonymous');
    expect(csrf.token()).toBeNull();
    expect(localStorage.getItem('smart-intake.authoring.account-1.workspace.form.draft')).toBeNull();
  });

  it('clears authoring draft and conflict state when a session expires', () => {
    const api = { session: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 440 }))) } as any;
    localStorage.setItem('smart-intake.authoring.account-1.workspace.form.draft', 'draft');
    const store = new StaffSessionStore(api, new StaffCsrfContext());

    store.ensureLoaded().subscribe();

    expect(store.state()).toBe('expired');
    expect(localStorage.getItem('smart-intake.authoring.account-1.workspace.form.draft')).toBeNull();
  });

  it('clears authoring state when access is denied', () => {
    const api = { session: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403 }))) } as any;
    localStorage.setItem('smart-intake.authoring.account-1.workspace.form.draft', 'conflict');
    const store = new StaffSessionStore(api, new StaffCsrfContext());

    store.ensureLoaded().subscribe();

    expect(store.state()).toBe('denied');
    expect(localStorage.getItem('smart-intake.authoring.account-1.workspace.form.draft')).toBeNull();
  });

  it('clears authoring state when the authenticated account changes', () => {
    const api = { session: vi.fn(() => of({ identity: { accountId: 'account-2', username: 'next' }, organizations: [] })) } as any;
    localStorage.setItem('smart-intake.authoring.account-1.workspace.form.draft', 'draft');
    const store = new StaffSessionStore(api, new StaffCsrfContext());
    store.identity.set({ accountId: 'account-1', username: 'previous', displayName: 'Previous account' });

    store.ensureLoaded().subscribe();

    expect(store.identity()?.accountId).toBe('account-2');
    expect(localStorage.getItem('smart-intake.authoring.account-1.workspace.form.draft')).toBeNull();
  });

  it('derives organization, workspace, and role context only from the safe session', () => {
    const api = { session: vi.fn(() => of({ identity: { accountId: 'a1', username: 'owner' }, currentOrganizationId: 'org-2', organizations: [
      { organizationId: 'org-1', name: 'One', membershipState: 'active', workspaces: [{ workspaceId: 'work-1', name: 'One workspace', roles: ['editor'] }] },
      { organizationId: 'org-2', name: 'Two', membershipState: 'active', workspaces: [{ workspaceId: 'work-2', name: 'Two workspace', roles: ['administrator'] }] },
    ] })) } as any;
    const store = new StaffSessionStore(api, new StaffCsrfContext());
    store.ensureLoaded().subscribe();
    expect(store.currentOrganization()?.name).toBe('Two');
    expect(store.currentWorkspaceId()).toBe('work-2');
    expect(store.currentRoles()).toEqual(['administrator']);
    store.selectOrganization('org-1');
    expect(store.currentWorkspaceId()).toBe('work-1');
  });
});
