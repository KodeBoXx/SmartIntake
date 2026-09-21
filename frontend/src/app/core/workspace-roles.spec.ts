import { describe, expect, it } from 'vitest';
import { hasWorkspaceRole, normalizeWorkspaceRoles, workspaceRoleContext } from './workspace-roles';

describe('workspace roles', () => {
  it('accepts legacy owner only as workspace-administrator compatibility input', () => {
    expect(normalizeWorkspaceRoles(['owner', 'author', 'administrator'])).toEqual(['workspace-administrator', 'author']);
  });
  it('does not allow organization-style administrator roles to grant workspace operations', () => {
    expect(hasWorkspaceRole(['administrator'], 'workspace-administrator')).toBe(false);
    expect(hasWorkspaceRole(['response-exporter'], 'response-viewer', 'response-exporter')).toBe(true);
    expect(hasWorkspaceRole(['response-viewer'], 'response-exporter')).toBe(false);
  });

  it('uses roles belonging to the route workspace rather than the selected workspace', () => {
    const organizations = [{ workspaces: [
      { workspaceId: 'selected', roles: ['workspace-administrator'] },
      { workspaceId: 'route', roles: ['author'] },
    ] }];

    expect(workspaceRoleContext(organizations, 'route', 'selected')).toMatchObject({ workspaceId: 'route', roles: ['author'] });
    expect(workspaceRoleContext(organizations, 'missing', 'selected')).toBeNull();
  });
});
