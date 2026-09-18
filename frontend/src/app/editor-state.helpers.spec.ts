import { describe, expect, it } from 'vitest';
import { addOption, addRepeaterItem, createField, createPage, moveItem, normalizeField, requirednessRule, visibilityRule } from './editor-state.helpers';

describe('editor state helpers', () => {
  it('creates the current page and field defaults', () => {
    expect(createPage('page-1')).toEqual({ id: 'page-1', title: 'New section', fields: [] });
    expect(createField('field-1', 'choice')).toEqual({ id: 'field-1', type: 'choice', label: 'New question', constraints: {}, options: undefined });
  });

  it('moves data without changing the input list', () => {
    const values = ['first', 'second', 'third'];
    expect(moveItem(values, 1, 1)).toEqual(['first', 'third', 'second']);
    expect(moveItem(values, 0, -1)).toEqual(values);
    expect(values).toEqual(['first', 'second', 'third']);
  });

  it('normalizes choice/text fields and creates exact rule objects', () => {
    expect(normalizeField({ id: 'choice', type: 'choice', label: 'Choice' }).options).toEqual([{ id: 'option-1', label: 'Option 1' }]);
    expect(normalizeField({ id: 'text', type: 'text', label: 'Text' }).constraints).toEqual({});
    expect(addOption(undefined, 'option-2')).toEqual([{ id: 'option-2', label: 'New option' }]);
    expect(addRepeaterItem([], 'item-1')).toEqual([{ id: 'item-1', value: '' }]);
    expect(visibilityRule({ fieldId: 'contact', equals: 'email' })).toEqual({ op: 'eq', args: [{ ref: { fieldId: 'contact' } }, { literal: { type: 'text', value: 'email' } }] });
    expect(requirednessRule('contact', 'phone')).toEqual({ op: 'eq', args: [{ ref: { fieldId: 'contact' } }, { literal: { type: 'text', value: 'phone' } }] });
  });
});
