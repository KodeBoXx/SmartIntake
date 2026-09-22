import { describe, expect, it } from 'vitest';
import { settingsUrl } from './staff-shell.component';

describe('Settings navigation', () => {
  it('routes a fresh organization administrator to Users', () => {
    expect(settingsUrl(false, ['administrator'])).toBe('/users');
    expect(settingsUrl(true, ['owner'])).toBe('/users');
  });

  it('keeps platform-only administrators on Platform organizations', () => {
    expect(settingsUrl(true, [])).toBe('/platform/organizations');
  });
});
