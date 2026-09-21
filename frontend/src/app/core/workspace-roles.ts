export const WORKSPACE_ROLES = ['workspace-administrator', 'author', 'reviewer', 'translator', 'publisher', 'response-viewer', 'response-exporter', 'auditor'] as const;
export type WorkspaceRole = typeof WORKSPACE_ROLES[number];

/** `owner` is accepted only when reading historical workspace membership. */
export function normalizeWorkspaceRoles(roles: readonly string[]): WorkspaceRole[] {
  return [...new Set(roles.map((role) => role === 'owner' ? 'workspace-administrator' : role).filter((role): role is WorkspaceRole => WORKSPACE_ROLES.includes(role as WorkspaceRole)))];
}
export function hasWorkspaceRole(roles: readonly string[], ...required: WorkspaceRole[]): boolean {
  return normalizeWorkspaceRoles(roles).some((role) => required.includes(role));
}

export interface WorkspaceRoleContext {
  readonly workspaceId: string;
  readonly name?: string;
  readonly roles: WorkspaceRole[];
}

/**
 * Route workspace IDs are the authority for staff screens.  A selected
 * workspace is only a fallback for compatibility routes with no workspace
 * parameter, never a source of roles for a different route workspace.
 */
export function workspaceRoleContext(
  organizations: readonly { workspaces: readonly { workspaceId: string; name?: string; roles: readonly string[] }[] }[],
  requestedWorkspaceId: string | null | undefined,
  selectedWorkspaceId: string | null | undefined,
): WorkspaceRoleContext | null {
  const workspaceId = requestedWorkspaceId ?? selectedWorkspaceId;
  if (!workspaceId) return null;
  const workspace = organizations.flatMap((organization) => organization.workspaces)
    .find((candidate) => candidate.workspaceId === workspaceId);
  return workspace
    ? { workspaceId, name: workspace.name, roles: normalizeWorkspaceRoles(workspace.roles) }
    : null;
}
