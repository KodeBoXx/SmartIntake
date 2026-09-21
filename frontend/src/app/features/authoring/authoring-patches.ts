import type { AuthoringCommand, AuthoringDocument } from './authoring.types';

export type CanonicalPatch = { op: 'add' | 'replace' | 'remove' | 'move'; path: string; from?: string; value?: unknown };

type CanonicalObject = Record<string, unknown>;
type Located = { path: string; kind: 'phase' | 'page' | 'section' | 'node'; key?: string; fieldId?: string };

const escape = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1');
const generatedId = () => `id_${crypto.randomUUID().replaceAll('-', '')}`;
const labelKey = (id: string) => `authoring.${id}.label`;

function flow(document: CanonicalObject): CanonicalObject[] { return ((document.flow as CanonicalObject | undefined)?.phases as CanonicalObject[] | undefined) ?? []; }
function children(value: CanonicalObject, name: string): CanonicalObject[] { return value[name] as CanonicalObject[] ?? []; }

function locate(document: CanonicalObject, target: string): Located | null {
  for (const [phaseIndex, phase] of flow(document).entries()) {
    if (phase.id === target) return { path: `/flow/phases/${phaseIndex}`, kind: 'phase', key: String(phase.titleKey ?? '') };
    for (const [pageIndex, page] of children(phase, 'pages').entries()) {
      if (page.id === target) return { path: `/flow/phases/${phaseIndex}/pages/${pageIndex}`, kind: 'page', key: String(page.titleKey ?? '') };
      for (const [sectionIndex, section] of children(page, 'sections').entries()) {
        if (section.id === target) return { path: `/flow/phases/${phaseIndex}/pages/${pageIndex}/sections/${sectionIndex}`, kind: 'section', key: String(section.titleKey ?? '') };
        for (const [nodeIndex, node] of children(section, 'nodes').entries()) {
          if (node.id === target) return { path: `/flow/phases/${phaseIndex}/pages/${pageIndex}/sections/${sectionIndex}/nodes/${nodeIndex}`, kind: 'node', fieldId: String(node.fieldId ?? '') };
        }
      }
    }
  }
  return null;
}

function field(document: CanonicalObject, fieldId: string): { value: CanonicalObject; index: number } | null {
  const fields = ((document.data as CanonicalObject | undefined)?.fields as CanonicalObject[] | undefined) ?? [];
  const index = fields.findIndex((candidate) => candidate.id === fieldId);
  return index < 0 ? null : { value: fields[index], index };
}

function translation(path: string, value: string): CanonicalPatch {
  return { op: 'add', path: `/translations/en/messages/${escape(path)}`, value };
}

function firstQuestion(seed: string, label: string): { field: CanonicalObject; node: CanonicalObject; message: CanonicalPatch } {
  const fieldId = `${seed}_field`;
  const nodeId = `${seed}_node`;
  const key = labelKey(fieldId);
  return {
    field: { id: fieldId, key: fieldId, type: 'text', labelKey: key },
    node: { id: nodeId, kind: 'question', fieldId, control: 'shortText' },
    message: translation(key, label),
  };
}

function expressionReferences(node: unknown, fieldId: string): boolean {
  if (node === fieldId) return true;
  if (Array.isArray(node)) return node.some((value) => expressionReferences(value, fieldId));
  return !!node && typeof node === 'object' && Object.values(node as CanonicalObject).some((value) => expressionReferences(value, fieldId));
}

/** Translate visual authoring actions to closed-package JSON Pointer operations. */
export function canonicalPatches(authoring: AuthoringDocument, command: AuthoringCommand): CanonicalPatch[] {
  const document = (authoring.definition ?? {}) as CanonicalObject;
  const label = command.label?.trim() ?? '';
  const found = command.targetId ? locate(document, command.targetId) : null;
  const id = command.entityId ?? command.node?.id ?? generatedId();

  if (command.type === 'rename' && found && label) {
    const key = found.kind === 'node' ? field(document, found.fieldId ?? '')?.value.labelKey : found.key;
    return typeof key === 'string' && key ? [translation(key, label)] : [];
  }
  if (command.type === 'add-phase') {
    const question = firstQuestion(id, 'New field');
    return [
      { op: 'add', path: '/data/fields/-', value: question.field },
      { op: 'add', path: '/flow/phases/-', value: { id, titleKey: labelKey(id), pages: [{ id: `${id}_page`, titleKey: labelKey(`${id}_page`), sections: [{ id: `${id}_section`, titleKey: labelKey(`${id}_section`), nodes: [question.node] }] }] } },
      translation(labelKey(id), label || 'New phase'), translation(labelKey(`${id}_page`), 'New page'), translation(labelKey(`${id}_section`), 'New section'), question.message,
    ];
  }
  if (command.type === 'add-page' && found?.kind === 'phase') {
    const question = firstQuestion(id, 'New field');
    return [
      { op: 'add', path: '/data/fields/-', value: question.field },
      { op: 'add', path: `${found.path}/pages/-`, value: { id, titleKey: labelKey(id), sections: [{ id: `${id}_section`, titleKey: labelKey(`${id}_section`), nodes: [question.node] }] } },
      translation(labelKey(id), label || 'New page'), translation(labelKey(`${id}_section`), 'New section'), question.message,
    ];
  }
  if (command.type === 'add-section' && found?.kind === 'page') {
    const question = firstQuestion(id, 'New field');
    return [
      { op: 'add', path: '/data/fields/-', value: question.field },
      { op: 'add', path: `${found.path}/sections/-`, value: { id, titleKey: labelKey(id), nodes: [question.node] } },
      translation(labelKey(id), label || 'New section'), question.message,
    ];
  }
  if (command.type === 'add-node' && found?.kind === 'section') {
    const fieldId = command.fieldId ?? `${id}_field`;
    const key = labelKey(fieldId);
    return [
      { op: 'add', path: '/data/fields/-', value: { id: fieldId, key: fieldId, type: 'text', labelKey: key } },
      { op: 'add', path: `${found.path}/nodes/-`, value: { id, kind: 'question', fieldId, control: command.node?.control === 'text' ? 'shortText' : command.node?.control ?? 'shortText' } },
      translation(key, command.node?.label || label || 'New field'),
    ];
  }
  if (command.type === 'remove-node' && found?.kind === 'node') {
    const fieldId = found.fieldId ?? '';
    const currentField = field(document, fieldId);
    const patches: CanonicalPatch[] = [{ op: 'remove', path: found.path }];
    if (currentField) {
      patches.push({ op: 'remove', path: `/data/fields/${currentField.index}` });
      const key = currentField.value.labelKey;
      if (typeof key === 'string') patches.push({ op: 'remove', path: `/translations/en/messages/${escape(key)}` });
    }
    const expressions = document.expressions as CanonicalObject | undefined;
    for (const [key, expression] of Object.entries(expressions ?? {})) if (expressionReferences(expression, fieldId)) patches.push({ op: 'remove', path: `/expressions/${escape(key)}` });
    return patches;
  }
  if (command.type === 'move' && found && command.destinationId) {
    const destination = locate(document, command.destinationId);
    if (!destination) return [];
    const arrayPath = found.kind === 'phase' ? '/flow/phases' : found.kind === 'page' ? `${destination.path}/pages` : found.kind === 'section' ? `${destination.path}/sections` : `${destination.path}/nodes`;
    return [{ op: 'move', from: found.path, path: `${arrayPath}/-` }];
  }
  return [];
}

/** Apply the same RFC-6902 subset used by the authoring endpoint for immediate local projection. */
export function applyCanonicalPatches(definition: unknown, patches: readonly CanonicalPatch[]): unknown {
  const root = JSON.parse(JSON.stringify(definition ?? {})) as CanonicalObject;
  for (const patch of patches) {
    if (patch.op === 'move') {
      if (!patch.from) continue;
      const value = take(root, patch.from);
      put(root, patch.path, value, true);
    } else if (patch.op === 'remove') take(root, patch.path);
    else put(root, patch.path, patch.value, patch.op === 'add');
  }
  return root;
}

function parts(pointer: string): string[] { return pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~')); }
function parent(root: CanonicalObject, pointer: string): { value: CanonicalObject | unknown[]; key: string } {
  const tokens = parts(pointer);
  let value: CanonicalObject | unknown[] = root;
  for (const token of tokens.slice(0, -1)) value = Array.isArray(value) ? value[Number(token)] as CanonicalObject | unknown[] : value[token] as CanonicalObject | unknown[];
  return { value, key: tokens.at(-1)! };
}
function take(root: CanonicalObject, pointer: string): unknown {
  const target = parent(root, pointer);
  return Array.isArray(target.value) ? target.value.splice(Number(target.key), 1)[0] : (() => { const value = target.value[target.key]; delete target.value[target.key]; return value; })();
}
function put(root: CanonicalObject, pointer: string, value: unknown, add: boolean): void {
  const target = parent(root, pointer);
  if (Array.isArray(target.value)) {
    if (target.key === '-') target.value.push(value);
    else if (add) target.value.splice(Number(target.key), 0, value);
    else target.value[Number(target.key)] = value;
  } else target.value[target.key] = value;
}
