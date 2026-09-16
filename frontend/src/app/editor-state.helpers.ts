import { Field, FormDefinition, Option, Page, RepeaterItem, Rule } from './models/form-definition.models';

export function createPage(id: string): Page {
  return { id, title: 'New section', fields: [] };
}

export function createField(id: string, type: string): Field {
  return {
    id,
    type,
    label: 'New question',
    constraints: {},
    options: type.includes('Choice') ? [{ id: 'option-1', label: 'Option 1' }] : undefined,
  };
}

export function moveItem<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) {
    return [...items];
  }

  const moved = [...items];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  return moved;
}

export function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export function addOption(options: readonly Option[] | undefined, id: string): Option[] {
  return [...(options ?? []), { id, label: 'New option' }];
}

export function normalizeField(field: Field): Field {
  return {
    ...field,
    options: (field.type === 'choice' || field.type === 'multiChoice') && !field.options
      ? [{ id: 'option-1', label: 'Option 1' }]
      : field.options,
    constraints: field.type === 'text' && !field.constraints ? {} : field.constraints,
  };
}

export function visibilityRule(visibleWhen: Rule | undefined): unknown {
  return visibleWhen?.fieldId
    ? { op: 'eq', args: [{ ref: { fieldId: visibleWhen.fieldId } }, { literal: { type: 'text', value: visibleWhen.equals || '' } }] }
    : undefined;
}

export function requirednessRule(fieldId: string | undefined, value: string | undefined): unknown {
  return fieldId
    ? { op: 'eq', args: [{ ref: { fieldId } }, { literal: { type: 'text', value: value || '' } }] }
    : undefined;
}

export function addRepeaterItem(items: readonly RepeaterItem[], id: string): RepeaterItem[] {
  return [...items, { id, value: '' }];
}

export function updatePage(definition: FormDefinition, pageIndex: number, page: Page): FormDefinition {
  return { ...definition, pages: definition.pages.map((current, index) => index === pageIndex ? page : current) };
}
