import { describe, expect, it } from 'vitest';
import { hasWorkspaceRole, normalizeWorkspaceRoles } from './workspace-roles';

describe('workspace roles', () => {
  it('accepts legacy owner only as workspace-administrator compatibility input', () => {
    expect(normalizeWorkspaceRoles(['owner', 'author', 'administrator'])).toEqual(['workspace-administrator', 'author']);
  });
  it('does not allow organization-style administrator roles to grant workspace operations', () => {
    expect(hasWorkspaceRole(['administrator'], 'workspace-administrator')).toBe(false);
    expect(hasWorkspaceRole(['response-exporter'], 'response-viewer', 'response-exporter')).toBe(true);
    expect(hasWorkspaceRole(['response-viewer'], 'response-exporter')).toBe(false);
  });
});
