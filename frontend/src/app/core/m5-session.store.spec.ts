import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StaffCsrfContext } from './staff-csrf.interceptor';
import { StaffSessionStore } from './m5-session.store';

describe('StaffSessionStore', () => {
  it('bootstraps a safe identity from the authoritative server session', () => {
    const api = { session: vi.fn(() => of({ identity: { accountId: 'a1', username: 'owner' }, csrfToken: 'csrf-1' })) } as any;
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
    const store = new StaffSessionStore(api, csrf);
    store.signOut().subscribe();
    expect(store.state()).toBe('anonymous');
    expect(csrf.token()).toBeNull();
  });
});
