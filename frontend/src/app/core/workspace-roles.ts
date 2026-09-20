export const WORKSPACE_ROLES = ['workspace-administrator', 'author', 'reviewer', 'translator', 'publisher', 'response-viewer', 'response-exporter', 'auditor'] as const;
export type WorkspaceRole = typeof WORKSPACE_ROLES[number];

/** `owner` is accepted only when reading historical workspace membership. */
export function normalizeWorkspaceRoles(roles: readonly string[]): WorkspaceRole[] {
  return [...new Set(roles.map((role) => role === 'owner' ? 'workspace-administrator' : role).filter((role): role is WorkspaceRole => WORKSPACE_ROLES.includes(role as WorkspaceRole)))];
}
export function hasWorkspaceRole(roles: readonly string[], ...required: WorkspaceRole[]): boolean {
  return normalizeWorkspaceRoles(roles).some((role) => required.includes(role));
}
