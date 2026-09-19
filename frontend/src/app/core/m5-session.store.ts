import { Injectable, computed, signal } from '@angular/core';

export type M5Authority = 'authenticated' | 'anonymous' | 'expired' | 'denied';
export type M5StubState = 'ready' | 'sign-in' | 'loading' | 'empty' | 'empty-or-no-access' | 'invalid' | 'denied' | 'no-access' | 'expired' | 'email-unavailable' | 'throttled' | 'offline' | 'stale' | 'closed' | 'start' | 'pending' | 'succeeded' | 'failed' | 'tombstone' | 'conflict' | 'error' | 'no-side-effects' | 'acknowledgment' | 'not-found';

/**
 * M5 shell-only state. This intentionally has no API authority: M6 owns real
 * session expiry, permissions, roles, CSRF and tenant-bound authorization.
 */
@Injectable({ providedIn: 'root' })
export class M5StaffSessionStore {
  readonly authority = signal<M5Authority>('authenticated');
  readonly returnUrl = signal('/workspaces/demo/forms');
  readonly isAuthenticated = computed(() => this.authority() === 'authenticated');

  setAuthority(authority: M5Authority): void { this.authority.set(authority); }
  rememberReturnUrl(url: string): void { this.returnUrl.set(url); }
}

@Injectable({ providedIn: 'root' })
export class M5PublicSessionStore {
  readonly state = signal<M5StubState>('ready');
  setState(state: M5StubState): void { this.state.set(state); }
}
