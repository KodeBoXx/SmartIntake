import { describe, expect, it } from 'vitest';
import { additiveWorkspaceRoleAssignment } from './administration-page.component';

describe('workspace role assignment', () => {
  it('uses the account identity and preserves last-administrator authority', () => {
    expect(additiveWorkspaceRoleAssignment(
      'organizationuser-00000000-0000-0000-0000-000000000001',
      ['workspace-administrator'],
      'author',
    )).toEqual({
      accountId: 'account-00000000-0000-0000-0000-000000000001',
      roles: ['workspace-administrator', 'author'],
    });
  });

  it('does not duplicate an existing role', () => {
    expect(additiveWorkspaceRoleAssignment('account-1', ['author'], 'author').roles).toEqual(['author']);
  });
});
