import { describe, expect, it } from 'vitest';
import { RetainedMutationKeys, canonicalJson } from './mutation-retry';

describe('RetainedMutationKeys', () => {
  it('reuses a key only for the same action, resource, and canonical payload', () => {
    const keys = new RetainedMutationKeys();
    let issued = 0;
    const create = () => `key-${++issued}`;

    expect(keys.key('invite', 'org-1/user-1', { name: 'Invitation', metadata: { source: 'staff' } }, create)).toBe('key-1');
    expect(keys.key('invite', 'org-1/user-1', { metadata: { source: 'staff' }, name: 'Invitation' }, create)).toBe('key-1');
    expect(keys.key('invite', 'org-1/user-1', { name: 'Replacement' }, create)).toBe('key-2');
    expect(keys.key('invite', 'org-1/user-2', { name: 'Replacement' }, create)).toBe('key-3');
  });

  it('produces an unambiguous canonical payload', () => {
    expect(canonicalJson({ b: [true, null], a: 1 })).toBe('{"a":1,"b":[true,null]}');
  });
});
