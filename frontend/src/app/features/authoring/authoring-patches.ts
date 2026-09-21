import type { AuthoringCommand, AuthoringDocument } from './authoring.types';

export type CanonicalPatch = { op: 'add' | 'replace' | 'remove'; path: string; value?: unknown };

const escape = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1');
const id = () => `id_${crypto.randomUUID().replaceAll('-', '')}`;

function pointer(document: Record<string, unknown>, target: string): { path: string; key?: string; fieldId?: string } | null {
  const flow = document.flow as { phases?: Record<string, unknown>[] } | undefined;
  for (const [pi, phase] of (flow?.phases ?? []).entries()) {
    if (phase.id === target) return { path: `/flow/phases/${pi}`, key: String(phase.titleKey ?? `authoring.${target}`) };
    for (const [pai, page] of ((phase.pages as Record<string, unknown>[] | undefined) ?? []).entries()) {
      if (page.id === target) return { path: `/flow/phases/${pi}/pages/${pai}`, key: String(page.titleKey ?? `authoring.${target}`) };
      for (const [si, section] of ((page.sections as Record<string, unknown>[] | undefined) ?? []).entries()) {
        if (section.id === target) return { path: `/flow/phases/${pi}/pages/${pai}/sections/${si}`, key: String(section.titleKey ?? `authoring.${target}`) };
        for (const [ni, node] of ((section.nodes as Record<string, unknown>[] | undefined) ?? []).entries()) if (node.id === target) return { path: `/flow/phases/${pi}/pages/${pai}/sections/${si}/nodes/${ni}`, fieldId: String(node.fieldId ?? '') };
      }
    }
  }
  return null;
}

/** Translate UI actions to the closed canonical package, never to UI metadata. */
export function canonicalPatches(authoring: AuthoringDocument, command: AuthoringCommand): CanonicalPatch[] {
  const document = (authoring.definition ?? {}) as Record<string, unknown>;
  const label = command.label?.trim() ?? '';
  const found = command.targetId ? pointer(document, command.targetId) : null;
  if (command.type === 'rename' && found && label) {
    const key = found.fieldId ? fieldKey(document, found.fieldId) : found.key;
    if (!key) return [];
    return [{ op: 'add', path: `/translations/en/messages/${escape(key)}`, value: label }];
  }
  if (command.type === 'remove-node' && found?.fieldId) return [{ op: 'remove', path: found.path }, ...fieldRemove(document, found.fieldId)];
  if (command.type === 'add-node' && command.targetId && command.node) {
    const section = pointer(document, command.targetId); if (!section) return [];
    const fieldId = id(), nodeId = id(), key = `authoring.${fieldId}`;
    return [{ op: 'add', path: '/data/fields/-', value: { id: fieldId, key: fieldId, type: 'text', labelKey: key } }, { op: 'add', path: `${section.path}/nodes/-`, value: { id: nodeId, kind: 'question', fieldId, control: 'shortText' } }, { op: 'add', path: `/translations/en/messages/${escape(key)}`, value: command.node.label }];
  }
  return [];
}

function fieldKey(document: Record<string, unknown>, fieldId: string): string | null { const field = ((document.data as { fields?: Record<string, unknown>[] } | undefined)?.fields ?? []).find((value) => value.id === fieldId); return field ? String(field.labelKey ?? '') : null; }
function fieldRemove(document: Record<string, unknown>, fieldId: string): CanonicalPatch[] { const fields = (document.data as { fields?: Record<string, unknown>[] } | undefined)?.fields ?? []; const index = fields.findIndex((field) => field.id === fieldId); return index < 0 ? [] : [{ op: 'remove', path: `/data/fields/${index}` }]; }

export function applyCanonicalPatches(definition: unknown, patches: readonly CanonicalPatch[]): unknown {
  const root = JSON.parse(JSON.stringify(definition ?? {})) as Record<string, unknown>;
  for (const patch of patches) {
    const segments = patch.path.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    let parent: Record<string, unknown> | unknown[] = root;
    for (const segment of segments.slice(0, -1)) parent = Array.isArray(parent) ? parent[Number(segment)] as Record<string, unknown> : parent[segment] as Record<string, unknown>;
    const key = segments.at(-1)!;
    if (Array.isArray(parent)) { if (patch.op === 'remove') parent.splice(Number(key), 1); else if (key === '-') parent.push(patch.value); else parent[Number(key)] = patch.value; }
    else if (patch.op === 'remove') delete parent[key]; else parent[key] = patch.value;
  }
  return root;
}
