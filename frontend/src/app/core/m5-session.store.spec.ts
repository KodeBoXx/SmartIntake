import { describe, expect, it } from 'vitest';
import { M5StaffSessionStore } from './m5-session.store';

describe('M5StaffSessionStore', () => {
  it('holds only explicit stub authority and deep-link return state', () => {
    const store = new M5StaffSessionStore();
    expect(store.isAuthenticated()).toBe(true);
    store.setAuthority('expired');
    store.rememberReturnUrl('/workspaces/demo/submissions/demo');
    expect(store.isAuthenticated()).toBe(false);
    expect(store.returnUrl()).toBe('/workspaces/demo/submissions/demo');
  });
});
