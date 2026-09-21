import type { AuthoringCommand, AuthoringDocument } from './authoring.types';

export type CanonicalPatch = { op: 'add' | 'replace' | 'remove' | 'move'; path: string; from?: string; value?: unknown };

type CanonicalObject = Record<string, unknown>;
type Located = { path: string; kind: 'phase' | 'page' | 'section' | 'node'; key?: string; fieldId?: string };

const escape = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1');
const generatedId = () => `id_${crypto.randomUUID().replaceAll('-', '')}`;
const labelKey = (id: string) => `authoring.${id}.label`;

const CONTROL_TYPES: Record<string, string> = {
  text: 'text', shortText: 'text', textarea: 'text', email: 'text', phone: 'text', url: 'text', identifier: 'text',
  integer: 'integer', rating: 'integer', scale: 'integer', integerSlider: 'integer',
  decimal: 'decimal', amount: 'decimal', currency: 'decimal', fractionalSlider: 'decimal',
  date: 'date', time: 'time', dateTime: 'dateTime', yesNo: 'boolean', checkbox: 'boolean', acknowledgment: 'boolean',
  radio: 'choice', dropdown: 'choice', combobox: 'choice', imageChoice: 'choice', modeSelector: 'choice',
  chips: 'multiChoice', checkboxGroup: 'multiChoice', multipleImageChoice: 'multiChoice', ranking: 'multiChoice',
  address: 'object', contact: 'object', person: 'object', repeatingCards: 'list', dynamicMatrix: 'list', fixedMatrix: 'list',
  fileUpload: 'attachments', drawing: 'drawing', calculated: 'text',
};

/** Field objects are closed-schema data. Presentation belongs only on question nodes. */
const FIELD_KEYS = new Set([
  'id', 'key', 'type', 'labelKey', 'descriptionKey', 'required', 'readOnly', 'calculated',
  'hiddenRetention', 'allowUnknown', 'allowDeclined', 'allowNotApplicable', 'ordered', 'unit',
  'options', 'constraints', 'default', 'itemSchema', 'extensions', 'guidanceId',
  'visibilityExpressionId', 'requiredExpressionId', 'validationExpressionId', 'sensitivity',
  'mode', 'normalizer',
]);

function fieldOnly(value: CanonicalObject): CanonicalObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => FIELD_KEYS.has(key)));
}

function canonicalOptions(value: unknown): CanonicalObject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((option): option is CanonicalObject => !!option && typeof option === 'object')
    .map((option) => {
      const result: CanonicalObject = { id: option.id, labelKey: option.labelKey };
      if (typeof option.disabled === 'boolean') result.disabled = option.disabled;
      return result;
    });
}

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

function firstQuestion(seed: string, label: string, control = 'shortText'): { field: CanonicalObject; node: CanonicalObject; message: CanonicalPatch } {
  const fieldId = `${seed}_field`;
  const nodeId = `${seed}_node`;
  const key = labelKey(fieldId);
  return {
    field: { id: fieldId, key: fieldId, type: CONTROL_TYPES[control] ?? 'text', labelKey: key, constraints: { required: false }, ...(choiceControl(control) ? { options: [] } : {}) },
    node: { id: nodeId, kind: 'question', fieldId, fieldType: CONTROL_TYPES[control] ?? 'text', control },
    message: translation(key, label),
  };
}

function choiceControl(control: string): boolean { return (CONTROL_TYPES[control] ?? '') === 'choice' || (CONTROL_TYPES[control] ?? '') === 'multiChoice'; }

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
    const control = command.node?.control ?? 'shortText';
    const fieldType = CONTROL_TYPES[control] ?? 'text';
    return [
      { op: 'add', path: '/data/fields/-', value: { id: fieldId, key: fieldId, type: fieldType, labelKey: key, constraints: { required: false }, ...(choiceControl(control) ? { options: [] } : {}) } },
      { op: 'add', path: `${found.path}/nodes/-`, value: { id, kind: 'question', fieldId, fieldType, control } },
      translation(key, command.node?.label || label || 'New field'),
    ];
  }
  if (command.type === 'update-field' && found?.kind === 'node' && command.field) {
    const current = field(document, found.fieldId ?? '');
    if (!current) return [];
    const supplied = command.field as CanonicalObject;
    const configured = fieldOnly({ ...fieldOnly(current.value), ...fieldOnly(supplied) });
    const control = String(command.field.control ?? atNode(document, found.path)?.control ?? 'shortText');
    const fieldType = CONTROL_TYPES[control] ?? String(configured.type ?? 'text');
    const options = canonicalOptions(supplied.options);
    if (options) configured.options = options;
    const patches: CanonicalPatch[] = [{ op: 'replace', path: `/data/fields/${current.index}`, value: { ...configured, type: fieldType } }, { op: 'replace', path: found.path, value: { ...atNode(document, found.path), control, fieldType } }];
    if (typeof supplied.help === 'string' && typeof configured.descriptionKey === 'string') patches.push(translation(configured.descriptionKey, supplied.help));
    if (Array.isArray(supplied.options)) for (const option of supplied.options) if (option && typeof option === 'object' && typeof (option as CanonicalObject).label === 'string') patches.push(translation(String((option as CanonicalObject).labelKey), String((option as CanonicalObject).label)));
    return patches;
  }
  if (command.type === 'set-expression' && command.expressionId && command.expression) return [{ op: document.expressions && Object.prototype.hasOwnProperty.call(document.expressions, command.expressionId) ? 'replace' : 'add', path: `/expressions/${escape(command.expressionId)}`, value: command.expression }];
  if (command.type === 'set-route' && found?.kind === 'page' && command.route) {
    const page = atNode(document, found.path) as CanonicalObject;
    const routes = Array.isArray(page.routes) ? page.routes as CanonicalObject[] : [];
    const existing = routes.findIndex((route) => route.id === command.route!.id);
    return [{ op: existing < 0 ? 'add' : 'replace', path: existing < 0 ? Array.isArray(page.routes) ? `${found.path}/routes/-` : `${found.path}/routes` : `${found.path}/routes/${existing}`, value: existing < 0 && !Array.isArray(page.routes) ? [command.route] : command.route }];
  }
  if (command.type === 'remove-node' && found?.kind === 'node') {
    const fieldId = found.fieldId ?? '';
    const currentField = field(document, fieldId);
    const patches: CanonicalPatch[] = [{ op: 'remove', path: found.path }];
    const remainingPlacements = allQuestionNodes(document).filter((node) => node.fieldId === fieldId && node.id !== command.targetId).length;
    if (currentField && remainingPlacements === 0) {
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

function allQuestionNodes(document: CanonicalObject): CanonicalObject[] {
  return flow(document).flatMap((phase) => children(phase, 'pages').flatMap((page) =>
    children(page, 'sections').flatMap((section) => children(section, 'nodes'))));
}

function atNode(document: CanonicalObject, pointer: string): CanonicalObject {
  let node: unknown = document;
  for (const part of pointer.slice(1).split('/')) node = (node as CanonicalObject)[part];
  return (node ?? {}) as CanonicalObject;
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
