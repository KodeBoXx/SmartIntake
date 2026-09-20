import {
  type AnswerStatus,
  type AnswerValue,
  type InputAnswerCell,
  type ListItem,
  type ListValue,
  type RowPath,
  type RuntimeAnswerState,
  type RuntimeDefinition,
  type RuntimeFieldDefinition,
  type RuntimeMutationResult,
  type RuntimeOperation,
  type RuntimeRejection,
  type RuntimeTarget,
  type ServerAnswerCell,
  type ServerProjection,
} from './runtime-types';
import { PINNED_TIMEZONES } from '../expression/pinned-timezone-registry';

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const INTEGER = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/;
const DECIMAL = /^(?:0(?:\.[0-9]+)?|[1-9][0-9]*(?:\.[0-9]+)?|-[1-9][0-9]*(?:\.[0-9]+)?|-0\.[0-9]*[1-9][0-9]*)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.\d{1,9})?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const ANSWER_STATUSES: readonly AnswerStatus[] = [
  'answered', 'unanswered', 'unknown', 'declined', 'respondentNotApplicable', 'notApplicable',
];

export function createRuntimeAnswerState(projection: ServerProjection | null = null): RuntimeAnswerState {
  return projection === null
    ? { answers: {}, server: null, retiredItemIds: [], invalid: {} }
    : reconcileServerProjection({ answers: {}, server: null, retiredItemIds: [], invalid: {} }, projection);
}

/**
 * Applies only structural client-side mutations. It cannot write a type or
 * provenance: those exist exclusively on `state.server`, supplied by the
 * server's projection reconciliation.
 */
export function applyRuntimeOperation(
  definition: RuntimeDefinition,
  state: RuntimeAnswerState,
  operation: RuntimeOperation,
): RuntimeMutationResult {
  if (operation.kind === 'addItem' && (operation.target.rowPath?.length ?? 0) >= 3) {
    return rejected(state, 'ROW_PATH_DEPTH');
  }
  const resolved = resolveTarget(definition, state.answers, operation.target);
  if (resolved.rejection !== undefined) return rejected(state, resolved.rejection);
  const field = resolved.field!;
  if (serverTargetStatus(definition, state.server, operation.target) === 'notApplicable') {
    return rejected(state, 'INVALID_STATUS');
  }
  if (field.readOnly || field.calculated) {
    return rejected(state, 'PROTECTED_FIELD');
  }
  if (field.type === 'list' && (field.fixedRows || (field.fixedItemIds?.length ?? 0) > 0)
    && (operation.kind === 'set' || operation.kind === 'clear')) {
    return rejected(state, 'FIXED_ROWS');
  }

  if (operation.kind === 'markInvalid') {
    const key = targetKey(operation.target);
    const answers = replaceCell(state.answers, operation.target.rowPath ?? [], operation.target.fieldId,
      { status: 'unanswered' });
    return accepted({ ...state, answers, invalid: { ...state.invalid, [key]: operation.reason } });
  }

  if (operation.kind === 'set') {
    if (field.type === 'object' || field.type === 'list') return rejected(state, 'INVALID_VALUE');
    let proposed = operation.answer ?? (operation.value === undefined
      ? undefined
      : { status: 'answered' as const, value: operation.value });
    if (proposed === undefined) return rejected(state, 'INVALID_STATUS');
    if (proposed.status === 'unknown' && !field.allowUnknown
      || proposed.status === 'declined' && !field.allowDeclined
      || proposed.status === 'respondentNotApplicable' && !field.allowNotApplicable) {
      return rejected(state, 'INVALID_STATUS');
    }
    if (proposed.status === 'answered' && typeof proposed.value === 'string') {
      const value = normalizeText(field, proposed.value);
      proposed = { ...proposed, value };
    }
    if (!isInputCellForField(field, proposed, 0)) return rejected(state, 'INVALID_VALUE');
    const answers = replaceCell(state.answers, operation.target.rowPath ?? [], operation.target.fieldId, proposed);
    return finalize(state, answers, removeInvalid(state.invalid, targetKey(operation.target)));
  }

  if (operation.kind === 'clear') {
    const answers = replaceCell(state.answers, operation.target.rowPath ?? [], operation.target.fieldId, { status: 'unanswered' });
    const descendants = descendantFieldIds(field);
    const rowPrefix = rowPathKey(operation.target.rowPath ?? []);
    return finalize(state, answers, filterInvalid(state.invalid,
      (key) => !(key.startsWith(`${rowPrefix}/`) && descendants.has(key.slice(key.lastIndexOf('/') + 1)))));
  }

  if (field.type !== 'list') return rejected(state, 'INVALID_VALUE');
  if (field.fixedRows || (field.fixedItemIds?.length ?? 0) > 0) return rejected(state, 'FIXED_ROWS');
  const current = asList(resolved.cell);

  if (operation.kind === 'addItem') {
    const items = current ?? { items: [] };
    if (!ID.test(operation.itemId)) return rejected(state, 'ITEM_ID_INVALID');
    const used = new Set([...collectItemIds(state.answers), ...state.retiredItemIds]);
    if (used.has(operation.itemId)) return rejected(state, 'ITEM_ID_REUSED');
    if (field.maxItems !== undefined && items.items.length >= field.maxItems) return rejected(state, 'INVALID_VALUE');
    const itemFields = operation.fields ?? {};
    if (!isFieldsForDefinition(field.itemFields ?? [], itemFields, 1)) return rejected(state, 'INVALID_VALUE');
    const answers = replaceCell(state.answers, operation.target.rowPath ?? [], operation.target.fieldId, {
      status: 'answered', value: { items: [...items.items, { itemId: operation.itemId, fields: itemFields }] },
    });
    const removedPrefix = itemMarkerPrefix(operation.target, operation.itemId);
    return finalize(state, answers, filterInvalid(state.invalid, (key) => !key.startsWith(removedPrefix)));
  }

  if (current === undefined) return rejected(state, 'INVALID_VALUE');

  const index = current.items.findIndex((item) => item.itemId === operation.itemId);
  if (index < 0) return rejected(state, 'ITEM_NOT_FOUND');
  if (operation.kind === 'removeItem') {
    if (field.minItems !== undefined && current.items.length <= field.minItems) return rejected(state, 'INVALID_VALUE');
    const answers = replaceCell(state.answers, operation.target.rowPath ?? [], operation.target.fieldId, {
      status: 'answered', value: { items: current.items.filter((item) => item.itemId !== operation.itemId) },
    });
    const removedPrefix = itemMarkerPrefix(operation.target, operation.itemId);
    return finalize(state, answers,
      filterInvalid(state.invalid, (key) => key !== targetKey(operation.target) && !key.startsWith(removedPrefix)));
  }

  const moved = [...current.items];
  const [item] = moved.splice(index, 1);
  if (operation.beforeItemId === undefined) moved.push(item);
  else {
    const target = moved.findIndex((candidate) => candidate.itemId === operation.beforeItemId);
    if (target < 0) return rejected(state, 'ITEM_NOT_FOUND');
    moved.splice(target, 0, item);
  }
  const answers = replaceCell(state.answers, operation.target.rowPath ?? [], operation.target.fieldId, {
    status: 'answered', value: { items: moved },
  });
  return finalize(state, answers, removeInvalid(state.invalid, targetKey(operation.target)));
}

/**
 * Replaces optimistic input with a server projection deterministically.  The
 * server owns type/provenance; IDs missing from either client or server state
 * are retained as tombstones so a later client operation cannot reuse one.
 */
export function reconcileServerProjection(state: RuntimeAnswerState, projection: ServerProjection): RuntimeAnswerState {
  const previousIds = collectItemIds(state.answers);
  const projectedAnswers = serverAnswersToInput(projection.answers);
  const projectedIds = collectItemIds(projectedAnswers);
  const retired = new Set(state.retiredItemIds);
  for (const itemId of previousIds) if (!projectedIds.has(itemId)) retired.add(itemId);
  return {
    answers: projectedAnswers,
    server: projection,
    retiredItemIds: [...retired].sort(),
    invalid: Object.fromEntries((projection.invalidInputs ?? [])
      .map((marker) => [targetKey(marker), 'UNPARSEABLE_INPUT'])),
  };
}

export function isCanonicalInt64(value: string): boolean {
  if (!INTEGER.test(value)) return false;
  const parsed = BigInt(value);
  return parsed >= INT64_MIN && parsed <= INT64_MAX;
}

export function isStoredDecimal(value: string, scale?: number): boolean {
  if (!DECIMAL.test(value)) return false;
  if (scale === undefined) return true;
  if (!Number.isInteger(scale) || scale < 0) return false;
  const fraction = value.split('.')[1] ?? '';
  return fraction.length === scale;
}

function finalize(
  state: RuntimeAnswerState,
  answers: Readonly<Record<string, InputAnswerCell>>,
  invalid: Readonly<Record<string, string>>,
): RuntimeMutationResult {
  const oldIds = collectItemIds(state.answers);
  const newIdList = collectItemIdList(answers);
  const newIds = new Set(newIdList);
  if (newIds.size !== newIdList.length) return rejected(state, 'ITEM_ID_REUSED');
  for (const itemId of newIds) {
    if (state.retiredItemIds.includes(itemId) && !oldIds.has(itemId)) return rejected(state, 'ITEM_ID_REUSED');
  }
  const retired = new Set(state.retiredItemIds);
  for (const itemId of oldIds) if (!newIds.has(itemId)) retired.add(itemId);
  return accepted({ ...state, answers, invalid, retiredItemIds: [...retired].sort() });
}

function accepted(state: RuntimeAnswerState): RuntimeMutationResult {
  return { accepted: true, state };
}

function rejected(state: RuntimeAnswerState, rejection: RuntimeRejection): RuntimeMutationResult {
  return { accepted: false, state, rejection };
}

function resolveTarget(
  definition: RuntimeDefinition,
  answers: Readonly<Record<string, InputAnswerCell>>,
  target: RuntimeTarget,
): { readonly field?: RuntimeFieldDefinition; readonly cell?: InputAnswerCell; readonly rejection?: RuntimeRejection } {
  const path = target.rowPath ?? [];
  if (path.length > 3) return { rejection: 'ROW_PATH_DEPTH' };
  let fields = definition.fields;
  let cells = answers;
  for (const segment of path) {
    const located = findInObjects(fields, cells, segment.listFieldId);
    if (located.rejection !== undefined) return { rejection: located.rejection };
    const listField = located.field;
    if (listField?.type !== 'list') return { rejection: 'ROW_PATH_INVALID' };
    const list = asList(located.cell);
    const item = list?.items.find((candidate) => candidate.itemId === segment.itemId);
    if (item === undefined) return { rejection: 'ROW_PATH_INVALID' };
    fields = listField.itemFields ?? [];
    cells = item.fields;
  }
  const located = findInObjects(fields, cells, target.fieldId);
  return located.field === undefined ? { rejection: located.rejection ?? 'UNKNOWN_FIELD' } : located;
}

function findInObjects(
  fields: readonly RuntimeFieldDefinition[],
  cells: Readonly<Record<string, InputAnswerCell>>,
  fieldId: string,
): { readonly field?: RuntimeFieldDefinition; readonly cell?: InputAnswerCell; readonly rejection?: RuntimeRejection } {
  const direct = fields.find((candidate) => candidate.id === fieldId);
  if (direct !== undefined) return { field: direct, cell: cells[fieldId] };
  for (const object of fields.filter((candidate) => candidate.type === 'object')) {
    const objectCell = cells[object.id];
    const nestedCells = objectCell?.status === 'answered' && isObjectValue(objectCell.value)
      ? objectCell.value.fields : {};
    const nested = findInObjects(object.fields ?? [], nestedCells, fieldId);
    if (nested.field !== undefined || nested.rejection !== undefined) return nested;
  }
  return {};
}

function replaceCell(
  cells: Readonly<Record<string, InputAnswerCell>>,
  path: RowPath,
  fieldId: string,
  replacement: InputAnswerCell,
): Readonly<Record<string, InputAnswerCell>> {
  if (path.length === 0) return replaceInObjectTree(cells, fieldId, replacement);
  const [segment, ...rest] = path;
  const located = locateInputCell(cells, segment.listFieldId);
  const listCell = located!;
  const list = asList(listCell)!;
  return replaceInObjectTree(cells, segment.listFieldId, {
      status: 'answered',
      value: {
        items: list.items.map((item) => item.itemId === segment.itemId
          ? { ...item, fields: replaceCell(item.fields, rest, fieldId, replacement) }
          : item),
      },
    });
}

function locateInputCell(cells: Readonly<Record<string, InputAnswerCell>>, fieldId: string): InputAnswerCell | undefined {
  if (cells[fieldId] !== undefined) return cells[fieldId];
  for (const cell of Object.values(cells)) {
    if (cell.status === 'answered' && isObjectValue(cell.value)) {
      const nested = locateInputCell(cell.value.fields, fieldId);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function replaceInObjectTree(
  cells: Readonly<Record<string, InputAnswerCell>>,
  fieldId: string,
  replacement: InputAnswerCell,
): Readonly<Record<string, InputAnswerCell>> {
  if (Object.prototype.hasOwnProperty.call(cells, fieldId)) return { ...cells, [fieldId]: replacement };
  for (const [id, cell] of Object.entries(cells)) {
    if (cell.status === 'answered' && isObjectValue(cell.value)
      && locateInputCell(cell.value.fields, fieldId) !== undefined) {
      return { ...cells, [id]: { ...cell, value: {
        fields: replaceInObjectTree(cell.value.fields, fieldId, replacement),
      } } };
    }
  }
  return { ...cells, [fieldId]: replacement };
}

function isValueForField(field: RuntimeFieldDefinition, value: AnswerValue<InputAnswerCell>, depth: number): boolean {
  if (depth > 3) return false;
  switch (field.type) {
    case 'integer': return typeof value === 'string' && isCanonicalInt64(value) && numericConstraints(field, value);
    case 'decimal': return typeof value === 'string' && isStoredDecimal(value, field.scale) && numericConstraints(field, value);
    case 'boolean': return typeof value === 'boolean';
    case 'date': return typeof value === 'string' && isCalendarDate(value);
    case 'time': return typeof value === 'string' && TIME.test(value);
    case 'dateTime': return isDateTime(value);
    case 'choice': return typeof value === 'string' && (field.options === undefined || field.options.includes(value));
    case 'multiChoice': return Array.isArray(value) && value.every((item) => typeof item === 'string')
      && new Set(value).size === value.length && collectionConstraints(field, value.length)
      && (field.options === undefined || value.every((item) => field.options!.includes(item)))
      && !(value.some((item) => field.exclusiveOptionIds?.includes(item)) && value.length > 1);
    case 'attachments': return Array.isArray(value) && value.every((item) => typeof item === 'string')
      && new Set(value).size === value.length && collectionConstraints(field, value.length);
    case 'drawing':
    case 'text': return typeof value === 'string' && lengthConstraints(field, [...value].length);
    case 'object': return isObjectValue(value) && isFieldsForDefinition(field.fields ?? [], value.fields, depth + 1);
    case 'list': return isListValue(value) && isListForDefinition(field, value, depth + 1);
  }
}

function normalizeText(field: RuntimeFieldDefinition, value: string): string {
  switch (field.normalizer) {
    case 'trim': return value.trim();
    case 'lowercase': return value.toLocaleLowerCase('und');
    case 'uppercase': return value.toLocaleUpperCase('und');
    default: return value;
  }
}

function lengthConstraints(field: RuntimeFieldDefinition, length: number): boolean {
  return (field.minLength === undefined || length >= field.minLength)
    && (field.maxLength === undefined || length <= field.maxLength);
}

function collectionConstraints(field: RuntimeFieldDefinition, length: number): boolean {
  return (field.minItems === undefined || length >= field.minItems)
    && (field.maxItems === undefined || length <= field.maxItems);
}

function numericConstraints(field: RuntimeFieldDefinition, value: string): boolean {
  try {
    if (field.min !== undefined && compareDecimal(value, field.min) < 0) return false;
    if (field.max !== undefined && compareDecimal(value, field.max) > 0) return false;
    return field.step === undefined || decimalStepMatches(value, field.min ?? '0', field.step);
  } catch {
    return false;
  }
}

function decimalParts(value: string): { coefficient: bigint; scale: number } {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) throw new Error('INVALID_DECIMAL');
  const fraction = match[3] ?? '';
  const magnitude = BigInt(`${match[2]}${fraction}`);
  return { coefficient: match[1] === '-' ? -magnitude : magnitude, scale: fraction.length };
}

function scaledCoefficient(value: string, scale: number): bigint {
  const parts = decimalParts(value);
  return parts.coefficient * (10n ** BigInt(scale - parts.scale));
}

function compareDecimal(left: string, right: string): number {
  const scale = Math.max(decimalParts(left).scale, decimalParts(right).scale);
  const difference = scaledCoefficient(left, scale) - scaledCoefficient(right, scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function decimalStepMatches(value: string, base: string, step: string): boolean {
  const scale = Math.max(decimalParts(value).scale, decimalParts(base).scale, decimalParts(step).scale);
  const divisor = scaledCoefficient(step, scale);
  return divisor > 0n && (scaledCoefficient(value, scale) - scaledCoefficient(base, scale)) % divisor === 0n;
}

function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isFieldsForDefinition(
  fields: readonly RuntimeFieldDefinition[],
  values: Readonly<Record<string, InputAnswerCell>>,
  depth: number,
): boolean {
  return Object.entries(values).every(([id, cell]) => {
    const field = fields.find((candidate) => candidate.id === id);
    return field !== undefined && isInputCellForField(field, cell, depth);
  });
}

function isInputCellForField(field: RuntimeFieldDefinition, cell: InputAnswerCell, depth: number): boolean {
  if (!ANSWER_STATUSES.includes(cell.status)) return false;
  return cell.status !== 'answered' || isValueForField(field, cell.value, depth);
}

function isListForDefinition(field: RuntimeFieldDefinition, value: ListValue<InputAnswerCell>, depth: number): boolean {
  if (depth > 3 || (field.minItems !== undefined && value.items.length < field.minItems)
    || (field.maxItems !== undefined && value.items.length > field.maxItems)) return false;
  const ids = new Set<string>();
  return value.items.every((item) => ID.test(item.itemId) && !ids.has(item.itemId)
    && (ids.add(item.itemId), isFieldsForDefinition(field.itemFields ?? [], item.fields, depth)));
}

function asList(cell: InputAnswerCell | undefined): ListValue<InputAnswerCell> | undefined {
  return cell?.status === 'answered' && isListValue(cell.value) ? cell.value : undefined;
}

function isListValue(value: AnswerValue<InputAnswerCell>): value is ListValue<InputAnswerCell> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'items' in value
    && Array.isArray((value as ListValue<InputAnswerCell>).items);
}

function isObjectValue(value: AnswerValue<InputAnswerCell>): value is { readonly fields: Readonly<Record<string, InputAnswerCell>> } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'fields' in value;
}

function isDateTime(value: AnswerValue<InputAnswerCell>): value is { readonly instant: string; readonly timeZone: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'instant' in value && 'timeZone' in value
    && typeof value.instant === 'string' && typeof value.timeZone === 'string'
    && INSTANT.test(value.instant) && PINNED_TIMEZONES.has(value.timeZone);
}

function collectItemIds(cells: Readonly<Record<string, InputAnswerCell>>): Set<string> {
  return new Set(collectItemIdList(cells));
}

function collectItemIdList(cells: Readonly<Record<string, InputAnswerCell>>): string[] {
  const ids: string[] = [];
  const visit = (cell: InputAnswerCell): void => {
    if (cell.status !== 'answered' || typeof cell.value !== 'object' || cell.value === null || Array.isArray(cell.value)) return;
    if (isListValue(cell.value)) {
      for (const item of cell.value.items) {
        ids.push(item.itemId);
        Object.values(item.fields).forEach(visit);
      }
    } else if (isObjectValue(cell.value)) Object.values(cell.value.fields).forEach(visit);
  };
  Object.values(cells).forEach(visit);
  return ids;
}

function serverAnswersToInput(cells: Readonly<Record<string, ServerAnswerCell>>): Readonly<Record<string, InputAnswerCell>> {
  return Object.fromEntries(Object.entries(cells).map(([id, cell]) => [id, serverCellToInput(cell)]));
}

function serverTargetStatus(
  definition: RuntimeDefinition,
  projection: ServerProjection | null,
  target: RuntimeTarget,
): ServerAnswerCell['status'] | undefined {
  if (projection === null) return undefined;
  let fields = projection.answers;
  for (const segment of target.rowPath ?? []) {
    const listCell = findServerCell(fields, segment.listFieldId);
    if (listCell?.status !== 'answered' || typeof listCell.value !== 'object'
      || listCell.value === null || !('items' in listCell.value)) return undefined;
    const item = listCell.value.items.find((candidate) => candidate.itemId === segment.itemId);
    if (item === undefined) return undefined;
    fields = item.fields;
  }
  for (const ancestorId of fieldAncestorIds(definition.fields, target.fieldId) ?? []) {
    if (findServerCell(fields, ancestorId)?.status === 'notApplicable') return 'notApplicable';
  }
  return findServerCell(fields, target.fieldId)?.status;
}

function fieldAncestorIds(
  fields: readonly RuntimeFieldDefinition[],
  targetId: string,
  ancestors: readonly string[] = [],
): readonly string[] | undefined {
  for (const field of fields) {
    if (field.id === targetId) return ancestors;
    const children = [...(field.fields ?? []), ...(field.itemFields ?? [])];
    const found = fieldAncestorIds(children, targetId, [...ancestors, field.id]);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findServerCell(
  fields: Readonly<Record<string, ServerAnswerCell>>,
  fieldId: string,
): ServerAnswerCell | undefined {
  if (fields[fieldId] !== undefined) return fields[fieldId];
  for (const cell of Object.values(fields)) {
    if (cell.status === 'answered' && typeof cell.value === 'object' && cell.value !== null
      && 'fields' in cell.value) {
      const nested = findServerCell(cell.value.fields, fieldId);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function serverCellToInput(cell: ServerAnswerCell): InputAnswerCell {
  if (cell.status === 'notApplicable') return { status: 'unanswered' };
  if (cell.status !== 'answered') return { status: cell.status };
  return { status: 'answered', value: serverValueToInput(cell.value) };
}

function serverValueToInput(value: AnswerValue<ServerAnswerCell>): AnswerValue<InputAnswerCell> {
  if (Array.isArray(value)) return [...value];
  if (typeof value !== 'object' || value === null) return value;
  if ('items' in value) return {
    items: value.items.map((item): ListItem<InputAnswerCell> => ({
      itemId: item.itemId,
      fields: serverAnswersToInput(item.fields),
    })),
  };
  if ('fields' in value) return { fields: serverAnswersToInput(value.fields) };
  const dateTime = value as { readonly instant: string; readonly timeZone: string };
  return { instant: dateTime.instant, timeZone: dateTime.timeZone };
}

function targetKey(target: RuntimeTarget): string {
  return `${rowPathKey(target.rowPath ?? [])}/${target.fieldId}`;
}

function itemMarkerPrefix(target: RuntimeTarget, itemId: string): string {
  const parent = rowPathKey(target.rowPath ?? []);
  return `${parent === '' ? '' : `${parent}/`}${target.fieldId}:${itemId}/`;
}

function rowPathKey(path: RowPath): string {
  return path.map((segment) => `${segment.listFieldId}:${segment.itemId}`).join('/');
}

function descendantFieldIds(field: RuntimeFieldDefinition): Set<string> {
  const result = new Set<string>([field.id]);
  const collect = (candidate: RuntimeFieldDefinition): void => {
    result.add(candidate.id);
    for (const child of candidate.fields ?? []) collect(child);
    for (const child of candidate.itemFields ?? []) collect(child);
  };
  for (const child of field.fields ?? []) collect(child);
  for (const child of field.itemFields ?? []) collect(child);
  return result;
}

function filterInvalid(
  invalid: Readonly<Record<string, string>>,
  keep: (key: string) => boolean,
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(invalid).filter(([key]) => keep(key)));
}

function removeInvalid(invalid: Readonly<Record<string, string>>, key: string): Readonly<Record<string, string>> {
  if (!(key in invalid)) return invalid;
  const { [key]: _, ...rest } = invalid;
  return rest;
}
