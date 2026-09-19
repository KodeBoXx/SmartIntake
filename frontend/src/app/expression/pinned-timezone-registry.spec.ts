import { describe, expect, it } from 'vitest';
import { PINNED_TIMEZONE_DATABASE, PINNED_TIMEZONE_REGISTRY_SHA256, PINNED_TIMEZONES } from './pinned-timezone-registry';

describe('pinned timezone registry', () => {
  it('uses the complete checked-in IANA 2025b registry and aliases', () => {
    expect(PINNED_TIMEZONE_DATABASE).toBe('IANA-tzdb-2025b-m3-complete-1');
    expect(PINNED_TIMEZONE_REGISTRY_SHA256).toBe('8725722643bf1f4ff4fc4b22268ade98b6fae047a86897219c3a13d4c4ced93d');
    expect(PINNED_TIMEZONES.size).toBe(598);
    expect(PINNED_TIMEZONES.has('Asia/Kathmandu')).toBe(true);
    expect(PINNED_TIMEZONES.has('Asia/Katmandu')).toBe(true);
    expect(PINNED_TIMEZONES.has('US/Eastern')).toBe(true);
  });
});
