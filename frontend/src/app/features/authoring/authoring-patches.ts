import type { AuthoringCommand, AuthoringDocument } from './authoring.types';

export type CanonicalPatch = { op: 'add' | 'replace' | 'remove' | 'move'; path: string; from?: string; value?: unknown };

type CanonicalObject = Record<string, unknown>;
type Located = { path: string; kind: 'phase' | 'page' | 'section' | 'node'; key?: string; fieldId?: string };
type FieldLocation = { value: CanonicalObject; path: string; ancestors: { value: CanonicalObject; path: string }[] };

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

const CONSTRAINT_KEYS = new Set(['min', 'max', 'step', 'scale', 'minItems', 'maxItems', 'fixedItemIds', 'exclusiveOptionIds', 'required', 'minLength', 'maxLength']);

function fieldOnly(value: CanonicalObject): CanonicalObject {
  const field = Object.fromEntries(Object.entries(value).filter(([key, candidate]) => FIELD_KEYS.has(key) && candidate !== null && candidate !== undefined)) as CanonicalObject;
  if (field.itemSchema && typeof field.itemSchema === 'object' && !Array.isArray(field.itemSchema)) {
    const itemSchema = field.itemSchema as CanonicalObject;
    const nested = Array.isArray(itemSchema.fields) ? itemSchema.fields : [];
    field.itemSchema = { fields: nested.filter((child): child is CanonicalObject => !!child && typeof child === 'object' && !Array.isArray(child)).map(fieldOnly) };
  }
  if (Array.isArray(field.options)) field.options = canonicalOptions(field.options);
  return field;
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

/** The schema is closed, so a control switch must remove settings that belong to its old destination. */
function canonicalFieldForControl(value: CanonicalObject, control: string, preserveCalculated = false): CanonicalObject {
  const type = CONTROL_TYPES[control] ?? String(value.type ?? 'text');
  const result = fieldOnly(value);
  const constraints = result.constraints && typeof result.constraints === 'object' && !Array.isArray(result.constraints)
    ? Object.fromEntries(Object.entries(result.constraints as CanonicalObject).filter(([key]) => CONSTRAINT_KEYS.has(key))) : undefined;
  if (constraints && Object.keys(constraints).length) result.constraints = constraints;
  else delete result.constraints;
  const choices = choiceControl(control);
  const composite = ['address', 'contact', 'person', 'repeatingCards', 'dynamicMatrix', 'fixedMatrix'].includes(control);
  const numeric = ['integer', 'rating', 'scale', 'integerSlider', 'decimal', 'amount', 'currency', 'fractionalSlider'].includes(control);
  const attachment = control === 'fileUpload';
  if (!choices) delete result.options;
  if (!composite) delete result.itemSchema;
  if (!numeric) {
    const next = result.constraints as CanonicalObject | undefined;
    if (next) for (const key of ['min', 'max', 'step', 'scale']) delete next[key];
  }
  if (!choices && !composite && !attachment) {
    const next = result.constraints as CanonicalObject | undefined;
    if (next) for (const key of ['minItems', 'maxItems', 'fixedItemIds', 'exclusiveOptionIds']) delete next[key];
  }
  if (!['amount', 'currency'].includes(control)) delete result.unit;
  if (!['ranking', 'fixedMatrix'].includes(control)) delete result.ordered;
  if (control !== 'calculated' && !preserveCalculated) {
    delete result.calculated;
    if (result.mode === 'calculated') result.mode = 'input';
  }
  for (const key of ['guidanceId', 'sensitivity', 'unit', 'descriptionKey']) {
    if (result[key] === '' || result[key] === null) delete result[key];
  }
  for (const key of ['allowUnknown', 'allowDeclined', 'allowNotApplicable', 'ordered', 'required', 'readOnly', 'calculated']) {
    if (result[key] === undefined) delete result[key];
  }
  result.type = type;
  return result;
}

function flow(document: CanonicalObject): CanonicalObject[] { return ((document.flow as CanonicalObject | undefined)?.phases as CanonicalObject[] | undefined) ?? []; }
function children(value: CanonicalObject, name: string): CanonicalObject[] { return value[name] as CanonicalObject[] ?? []; }

function locate(document: CanonicalObject, target: string): Located | null {
  const locateNode = (nodes: CanonicalObject[], path: string): Located | null => {
    for (const [nodeIndex, node] of nodes.entries()) {
      const nodePath = `${path}/${nodeIndex}`;
      if (node.id === target) return { path: nodePath, kind: 'node', fieldId: String(node.fieldId ?? '') };
      for (const key of ['nodes', 'children']) {
        const nested = locateNode(children(node, key), `${nodePath}/${key}`);
        if (nested) return nested;
      }
    }
    return null;
  };
  for (const [phaseIndex, phase] of flow(document).entries()) {
    if (phase.id === target) return { path: `/flow/phases/${phaseIndex}`, kind: 'phase', key: String(phase.titleKey ?? '') };
    for (const [pageIndex, page] of children(phase, 'pages').entries()) {
      if (page.id === target) return { path: `/flow/phases/${phaseIndex}/pages/${pageIndex}`, kind: 'page', key: String(page.titleKey ?? '') };
      for (const [sectionIndex, section] of children(page, 'sections').entries()) {
        if (section.id === target) return { path: `/flow/phases/${phaseIndex}/pages/${pageIndex}/sections/${sectionIndex}`, kind: 'section', key: String(section.titleKey ?? '') };
        const nested = locateNode(children(section, 'nodes'), `/flow/phases/${phaseIndex}/pages/${pageIndex}/sections/${sectionIndex}/nodes`);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function field(document: CanonicalObject, fieldId: string): FieldLocation | null {
  const visit = (fields: CanonicalObject[], path: string, ancestors: { value: CanonicalObject; path: string }[]): FieldLocation | null => {
    for (const [index, candidate] of fields.entries()) {
      const candidatePath = `${path}/${index}`;
      if (candidate.id === fieldId) return { value: candidate, path: candidatePath, ancestors };
      const children = ((candidate.itemSchema as CanonicalObject | undefined)?.fields as CanonicalObject[] | undefined) ?? [];
      const nested = visit(children, `${candidatePath}/itemSchema/fields`, [...ancestors, { value: candidate, path: candidatePath }]);
      if (nested) return nested;
    }
    return null;
  };
  return visit((((document.data as CanonicalObject | undefined)?.fields as CanonicalObject[] | undefined) ?? []), '/data/fields', []);
}

function translations(document: CanonicalObject, path: string, value: string, activeLocale?: string): CanonicalPatch[] {
  const locale = activeLocale ?? (typeof document.defaultLocale === 'string' ? document.defaultLocale : 'en');
  return [{ op: 'add', path: `/translations/${escape(locale)}/messages/${escape(path)}`, value }];
}

function firstQuestion(document: CanonicalObject, seed: string, label: string, control = 'shortText', locale?: string): { field: CanonicalObject; node: CanonicalObject; messages: CanonicalPatch[] } {
  const fieldId = `${seed}_field`;
  const nodeId = `${seed}_node`;
  const key = labelKey(fieldId);
  return {
    field: { id: fieldId, key: fieldId, type: CONTROL_TYPES[control] ?? 'text', labelKey: key, constraints: { required: false }, ...(choiceControl(control) ? { options: [] } : {}) },
    node: { id: nodeId, kind: 'question', fieldId, fieldType: CONTROL_TYPES[control] ?? 'text', control },
    messages: translations(document, key, label, locale),
  };
}

function choiceControl(control: string): boolean { return (CONTROL_TYPES[control] ?? '') === 'choice' || (CONTROL_TYPES[control] ?? '') === 'multiChoice'; }

function expressionReferences(node: unknown, fieldId: string): boolean {
  if (node === fieldId) return true;
  if (Array.isArray(node)) return node.some((value) => expressionReferences(value, fieldId));
  return !!node && typeof node === 'object' && Object.values(node as CanonicalObject).some((value) => expressionReferences(value, fieldId));
}

/** Exact prospective consequences shown before a destructive visual command. */
export function deletionImpact(authoring: AuthoringDocument, targetId: string): { placements: string[]; routes: string[]; calculations: string[]; expressions: string[]; translations: string[] } {
  const document = (authoring.definition ?? {}) as CanonicalObject;
  const located = locate(document, targetId);
  const fieldId = located?.fieldId ?? '';
  if (!fieldId) return { placements: [], routes: [], calculations: [], expressions: [], translations: [] };
  const fieldLocation = field(document, fieldId);
  const finalPlacement = allQuestionNodes(document).filter((node) => node.fieldId === fieldId && node.id !== targetId).length === 0;
  if (!finalPlacement || !fieldLocation) return { placements: [targetId], routes: [], calculations: [], expressions: [], translations: [] };
  const ids = new Set(fieldsIn(fieldLocation.value).map((candidate) => String(candidate.id)));
  const expressions = Object.entries(document.expressions as CanonicalObject ?? {}).filter(([, value]) => [...ids].some((id) => expressionReferences(value, id))).map(([id]) => id);
  const routes = flow(document).flatMap((phase) => children(phase, 'pages')).flatMap((page) => children(page, 'routes')).filter((route) => expressions.includes(String(route.whenExpressionId))).map((route) => String(route.id));
  const calculations = [...ids].filter((id) => {
    const candidate = field(document, id)?.value;
    return !!(candidate?.extensions as CanonicalObject | undefined)?.['x-kodeboxx.calculation'];
  });
  return { placements: allQuestionNodeLocations(document).filter((node) => ids.has(String(node.value.fieldId))).map((node) => String(node.value.id)), routes, calculations, expressions, translations: [...ids].map((id) => String(field(document, id)?.value.labelKey ?? '')).filter(Boolean) };
}

/** Translate visual authoring actions to closed-package JSON Pointer operations. */
export function canonicalPatches(authoring: AuthoringDocument, command: AuthoringCommand): CanonicalPatch[] {
  const document = (authoring.definition ?? {}) as CanonicalObject;
  const label = command.label?.trim() ?? '';
  const found = command.targetId ? locate(document, command.targetId) : null;
  const id = command.entityId ?? command.node?.id ?? generatedId();

  if (command.type === 'rename' && found && label) {
    if (found.kind === 'node') {
      const locatedField = field(document, found.fieldId ?? '');
      if (!locatedField) return [];
      // Label keys are shared by every locale.  Keep the existing canonical key so
      // an active-locale rename cannot strand Hindi/Arabic behind a new English-only
      // message key.
      const key = typeof locatedField.value.labelKey === 'string'
        ? locatedField.value.labelKey : labelKey(String(locatedField.value.id));
      return [
        ...(locatedField.value.labelKey === key ? [] : [{ op: 'add' as const, path: `${locatedField.path}/labelKey`, value: key }]),
        ...translations(document, key, label, command.locale),
      ];
    }
    const key = found.key || labelKey(String(command.targetId));
    return [
      ...(found.key === key ? [] : [{ op: 'add' as const, path: `${found.path}/titleKey`, value: key }]),
      ...translations(document, key, label, command.locale),
    ];
  }
  if (command.type === 'add-phase') {
    const question = firstQuestion(document, id, 'New field', 'shortText', command.locale);
    return [
      { op: 'add', path: '/data/fields/-', value: question.field },
      { op: 'add', path: '/flow/phases/-', value: { id, titleKey: labelKey(id), pages: [{ id: `${id}_page`, titleKey: labelKey(`${id}_page`), sections: [{ id: `${id}_section`, titleKey: labelKey(`${id}_section`), nodes: [question.node] }] }] } },
      ...translations(document, labelKey(id), label || 'New phase', command.locale), ...translations(document, labelKey(`${id}_page`), 'New page', command.locale), ...translations(document, labelKey(`${id}_section`), 'New section', command.locale), ...question.messages,
    ];
  }
  if (command.type === 'add-page' && found?.kind === 'phase') {
    const question = firstQuestion(document, id, 'New field', 'shortText', command.locale);
    return [
      { op: 'add', path: '/data/fields/-', value: question.field },
      { op: 'add', path: `${found.path}/pages/-`, value: { id, titleKey: labelKey(id), sections: [{ id: `${id}_section`, titleKey: labelKey(`${id}_section`), nodes: [question.node] }] } },
      ...translations(document, labelKey(id), label || 'New page', command.locale), ...translations(document, labelKey(`${id}_section`), 'New section', command.locale), ...question.messages,
    ];
  }
  if (command.type === 'add-section' && found?.kind === 'page') {
    const question = firstQuestion(document, id, 'New field', 'shortText', command.locale);
    return [
      { op: 'add', path: '/data/fields/-', value: question.field },
      { op: 'add', path: `${found.path}/sections/-`, value: { id, titleKey: labelKey(id), nodes: [question.node] } },
      ...translations(document, labelKey(id), label || 'New section', command.locale), ...question.messages,
    ];
  }
  if (command.type === 'add-node' && found?.kind === 'section') {
    const fieldId = command.fieldId ?? `${id}_field`;
    const key = labelKey(fieldId);
    const control = command.node?.control ?? 'shortText';
    const existing = field(document, fieldId);
    const fieldType = existing?.value.type as string ?? CONTROL_TYPES[control] ?? 'text';
    const node = { id, kind: 'question', fieldId, fieldType, control };
    if (existing) return [{ op: 'add', path: `${found.path}/nodes/-`, value: node }];
    return [
      { op: 'add', path: '/data/fields/-', value: { id: fieldId, key: fieldId, type: fieldType, labelKey: key, constraints: { required: false }, ...(choiceControl(control) ? { options: [] } : {}) } },
      { op: 'add', path: `${found.path}/nodes/-`, value: node },
      ...translations(document, key, command.node?.label || label || 'New field', command.locale),
    ];
  }
  if (command.type === 'update-field' && found?.kind === 'node' && command.field) {
    const current = field(document, command.fieldId ?? found.fieldId ?? '');
    if (!current) return [];
    const supplied = command.field as CanonicalObject;
    const configured = fieldOnly({ ...fieldOnly(current.value), ...fieldOnly(supplied) });
    if (Array.isArray(supplied.fixedRows)) {
      const ids = supplied.fixedRows.filter((row): row is CanonicalObject => !!row && typeof row === 'object').map((row) => row.id).filter((id): id is string => typeof id === 'string');
      const constraints = { ...(configured.constraints as CanonicalObject ?? {}) };
      if (ids.length) constraints.fixedItemIds = ids;
      else delete constraints.fixedItemIds;
      if (Object.keys(constraints).length) configured.constraints = constraints;
      else delete configured.constraints;
    }
    const control = String(command.field.control ?? atNode(document, found.path)?.control ?? 'shortText');
    const fieldType = CONTROL_TYPES[control] ?? String(configured.type ?? 'text');
    const options = canonicalOptions(supplied.options);
    if (options) configured.options = options;
    const canonical = canonicalFieldForControl({ ...configured, type: fieldType }, control, supplied.calculated === true);
    const existingNode = atNode(document, found.path);
    const nextNode: CanonicalObject = { ...existingNode, control, fieldType };
    const childFields = ((canonical.itemSchema as CanonicalObject | undefined)?.fields as CanonicalObject[] | undefined) ?? [];
    const visualChildren = (((supplied.itemSchema as CanonicalObject | undefined)?.fields as CanonicalObject[] | undefined) ?? []);
    if (childFields.length) nextNode.children = questionPlacements(childFields, children(existingNode, 'children'), visualChildren);
    else delete nextNode.children;
    for (const key of ['roles', 'summaryFieldIds', 'children', 'fixedRowLabels', 'acknowledgmentContentKey']) {
      if (Object.prototype.hasOwnProperty.call(supplied, key)) {
        const value = supplied[key];
        if (value === null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && value && !Object.keys(value as CanonicalObject).length)) delete nextNode[key];
        else nextNode[key] = value;
      }
    }
    if (supplied.presentationSettings && typeof supplied.presentationSettings === 'object' && !Array.isArray(supplied.presentationSettings)) {
      const settings = Object.fromEntries(Object.entries(supplied.presentationSettings as CanonicalObject).filter(([, value]) => value !== null && value !== undefined && value !== ''));
      if (Object.keys(settings).length) nextNode.presentation = { settings };
      else delete nextNode.presentation;
    }
    const patches: CanonicalPatch[] = [{ op: 'replace', path: current.path, value: canonical }, { op: 'replace', path: found.path, value: nextNode }];
    if (typeof supplied.help === 'string' && typeof configured.descriptionKey === 'string') patches.push(...translations(document, configured.descriptionKey, supplied.help, command.locale));
    if (typeof supplied.acknowledgmentContent === 'string' && typeof nextNode.acknowledgmentContentKey === 'string' && supplied.acknowledgmentContent) patches.push(...translations(document, nextNode.acknowledgmentContentKey, supplied.acknowledgmentContent, command.locale));
    const presentation = nextNode.presentation as CanonicalObject | undefined;
    const presentationSettings = presentation?.settings as CanonicalObject | undefined;
    if (typeof supplied.endpointLowLabel === 'string' && typeof presentationSettings?.endpointLowLabelKey === 'string') patches.push(...translations(document, presentationSettings.endpointLowLabelKey, supplied.endpointLowLabel, command.locale));
    if (typeof supplied.endpointHighLabel === 'string' && typeof presentationSettings?.endpointHighLabelKey === 'string') patches.push(...translations(document, presentationSettings.endpointHighLabelKey, supplied.endpointHighLabel, command.locale));
    if (Array.isArray(supplied.options)) for (const option of supplied.options) if (option && typeof option === 'object' && typeof (option as CanonicalObject).label === 'string') patches.push(...translations(document, String((option as CanonicalObject).labelKey), String((option as CanonicalObject).label), command.locale));
    const childTranslations = (children: CanonicalObject[]): CanonicalPatch[] => children.flatMap((child) => {
      const nested = ((child.itemSchema as CanonicalObject | undefined)?.fields as CanonicalObject[] | undefined) ?? [];
      return [
        ...(typeof child.labelKey === 'string' && typeof child.__label === 'string' ? translations(document, child.labelKey, child.__label, command.locale) : []),
        ...(Array.isArray(child.options) ? child.options.flatMap((option) => option && typeof option === 'object' && typeof (option as CanonicalObject).label === 'string' ? translations(document, String((option as CanonicalObject).labelKey), String((option as CanonicalObject).label), command.locale) : []) : []),
        ...childTranslations(nested),
      ];
    });
    patches.push(...childTranslations(visualChildren));
    const rows = supplied.fixedRows;
    if (Array.isArray(rows)) for (const row of rows) if (row && typeof row === 'object' && typeof (row as CanonicalObject).label === 'string') patches.push(...translations(document, String((row as CanonicalObject).labelKey), String((row as CanonicalObject).label), command.locale));
    const calculation = canonical.extensions && typeof canonical.extensions === 'object'
      ? (canonical.extensions as CanonicalObject)['x-kodeboxx.calculation'] as CanonicalObject | undefined : undefined;
    if (calculation?.dependencyId && calculation.version && calculation.digest) {
      const dependencies = Array.isArray(document.dependencies) ? document.dependencies as CanonicalObject[] : [];
      const index = dependencies.findIndex((dependency) => dependency.id === calculation.dependencyId);
      const dependency = { kind: 'extension', id: calculation.dependencyId, version: calculation.version, digest: calculation.digest };
      patches.push({ op: index < 0 ? 'add' : 'replace', path: index < 0 ? Array.isArray(document.dependencies) ? '/dependencies/-' : '/dependencies' : `/dependencies/${index}`, value: index < 0 && !Array.isArray(document.dependencies) ? [dependency] : dependency });
    }
    return patches;
  }
  if (command.type === 'set-expression' && command.expressionId && command.expression) return [{ op: document.expressions && Object.prototype.hasOwnProperty.call(document.expressions, command.expressionId) ? 'replace' : 'add', path: `/expressions/${escape(command.expressionId)}`, value: command.expression }];
  if (command.type === 'set-route' && found?.kind === 'page' && command.route) {
    const page = atNode(document, found.path) as CanonicalObject;
    const routes = Array.isArray(page.routes) ? page.routes as CanonicalObject[] : [];
    const existing = routes.findIndex((route) => route.id === command.route!.id);
    return [{ op: existing < 0 ? 'add' : 'replace', path: existing < 0 ? Array.isArray(page.routes) ? `${found.path}/routes/-` : `${found.path}/routes` : `${found.path}/routes/${existing}`, value: existing < 0 && !Array.isArray(page.routes) ? [command.route] : command.route }];
  }
  if (command.type === 'set-default-next' && found?.kind === 'page') {
    const page = atNode(document, found.path) as CanonicalObject;
    const hasDefault = typeof page.defaultNextPageId === 'string';
    if (!command.destinationId) return hasDefault ? [{ op: 'remove', path: `${found.path}/defaultNextPageId` }] : [];
    return [{ op: hasDefault ? 'replace' : 'add', path: `${found.path}/defaultNextPageId`, value: command.destinationId }];
  }
  if (command.type === 'remove-page' && found?.kind === 'page') {
    if ((document.flow as CanonicalObject | undefined)?.startPageId === command.targetId) return [];
    const references: CanonicalPatch[] = [];
    for (const [phaseIndex, phase] of flow(document).entries()) {
      for (const [pageIndex, page] of children(phase, 'pages').entries()) {
        const pagePath = `/flow/phases/${phaseIndex}/pages/${pageIndex}`;
        const routes = children(page, 'routes');
        for (let routeIndex = routes.length - 1; routeIndex >= 0; routeIndex--)
          if (routes[routeIndex].targetPageId === command.targetId) references.push({ op: 'remove', path: `${pagePath}/routes/${routeIndex}` });
        if (page.defaultNextPageId === command.targetId) references.push({ op: 'remove', path: `${pagePath}/defaultNextPageId` });
      }
    }
    return [...references, { op: 'remove', path: found.path }];
  }
  if (command.type === 'remove-node' && found?.kind === 'node') {
    const fieldId = found.fieldId ?? '';
    const currentField = field(document, fieldId);
    const patches: CanonicalPatch[] = [];
    const remainingPlacements = allQuestionNodes(document).filter((node) => node.fieldId === fieldId && node.id !== command.targetId).length;
    if (currentField && remainingPlacements === 0) {
      // itemSchema.fields has minItems: 1. Removing its final child must remove the
      // enclosing composite definition (and its placements), never serialize fields: [].
      const removal = currentField.ancestors.length && siblingsAt(document, currentField.path).length === 1
        ? currentField.ancestors.at(-1)! : { value: currentField.value, path: currentField.path };
      // The only schema-valid outcome for a final composite child is an explicit
      // cascade/restructure.  Never turn a click on a child into a hidden parent
      // deletion; the inspector asks for this confirmation before emitting it.
      if (removal.path !== currentField.path && !command.cascade) return [];
      const removedFields = fieldsIn(removal.value);
      const removedIds = new Set(removedFields.map((candidate) => String(candidate.id)));
      const placementRemovals = allQuestionNodeLocations(document)
        .filter((node) => removedIds.has(String(node.value.fieldId)))
        .sort((left, right) => right.path.localeCompare(left.path, undefined, { numeric: true }));
      for (const placement of placementRemovals) patches.push({ op: 'remove', path: placement.path });
      patches.push({ op: 'remove', path: removal.path });
      for (const removed of removedFields) {
        const key = removed.labelKey;
        const locale = command.locale ?? (typeof document.defaultLocale === 'string' ? document.defaultLocale : 'en');
        const messages = ((document.translations as CanonicalObject | undefined)?.[locale] as CanonicalObject | undefined)?.messages as CanonicalObject | undefined;
        if (typeof key === 'string' && messages && Object.prototype.hasOwnProperty.call(messages, key))
          patches.push({ op: 'remove', path: `/translations/${escape(locale)}/messages/${escape(key)}` });
      }
      // Dependents are deliberately retained. The compiler reports the invalid draft
      // until the author repairs/removes each dependency after accepting its impact.
    } else patches.push({ op: 'remove', path: found.path });
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

function questionPlacements(fields: readonly CanonicalObject[], existing: readonly CanonicalObject[], visualFields: readonly CanonicalObject[]): CanonicalObject[] {
  return fields.map((field) => {
    const present = existing.find((node) => node.fieldId === field.id);
    const visual = visualFields.find((candidate) => candidate.id === field.id);
    const id = String(present?.id ?? `placement_${String(field.id)}`);
    const nested = ((field.itemSchema as CanonicalObject | undefined)?.fields as CanonicalObject[] | undefined) ?? [];
    const visualNested = ((visual?.itemSchema as CanonicalObject | undefined)?.fields as CanonicalObject[] | undefined) ?? [];
    return { id, kind: 'question', fieldId: field.id, fieldType: field.type, control: present?.control ?? visual?.__control ?? controlForFieldType(String(field.type ?? 'text')), ...(nested.length ? { children: questionPlacements(nested, children(present ?? {}, 'children'), visualNested) } : {}) };
  });
}

function controlForFieldType(type: string): string { return ({ text: 'shortText', integer: 'integer', decimal: 'decimal', boolean: 'checkbox', date: 'date', time: 'time', dateTime: 'dateTime', choice: 'radio', multiChoice: 'checkboxGroup', attachments: 'fileUpload', drawing: 'drawing', object: 'contact', list: 'repeatingCards' } as Record<string, string>)[type] ?? 'shortText'; }

function allQuestionNodes(document: CanonicalObject): CanonicalObject[] {
  const visit = (nodes: CanonicalObject[]): CanonicalObject[] => nodes.flatMap((node) => [node, ...visit(children(node, 'nodes')), ...visit(children(node, 'children'))]);
  return flow(document).flatMap((phase) => children(phase, 'pages').flatMap((page) =>
    children(page, 'sections').flatMap((section) => visit(children(section, 'nodes')))));
}

function allQuestionNodeLocations(document: CanonicalObject): { value: CanonicalObject; path: string }[] {
  const visit = (nodes: CanonicalObject[], path: string): { value: CanonicalObject; path: string }[] => nodes.flatMap((node, index) => {
    const nodePath = `${path}/${index}`;
    return [{ value: node, path: nodePath }, ...visit(children(node, 'nodes'), `${nodePath}/nodes`), ...visit(children(node, 'children'), `${nodePath}/children`)];
  });
  return flow(document).flatMap((phase, phaseIndex) => children(phase, 'pages').flatMap((page, pageIndex) =>
    children(page, 'sections').flatMap((section, sectionIndex) => visit(children(section, 'nodes'), `/flow/phases/${phaseIndex}/pages/${pageIndex}/sections/${sectionIndex}/nodes`))));
}

function fieldsIn(value: CanonicalObject): CanonicalObject[] {
  const nested = ((value.itemSchema as CanonicalObject | undefined)?.fields as CanonicalObject[] | undefined) ?? [];
  return [value, ...nested.flatMap(fieldsIn)];
}

function siblingsAt(document: CanonicalObject, path: string): CanonicalObject[] {
  const tokens = path.split('/');
  const collection = atNode(document, tokens.slice(0, -1).join('/'));
  return Array.isArray(collection) ? collection as CanonicalObject[] : [];
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
