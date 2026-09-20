import { describe, expect, it } from 'vitest';
import {
  applyRuntimeOperation,
  createRuntimeAnswerState,
  isCanonicalInt64,
  isStoredDecimal,
  reconcileServerProjection,
} from './runtime-answers';
import type { RuntimeDefinition, ServerProjection } from './runtime-types';

const definition: RuntimeDefinition = {
  fields: [
    { id: 'age', type: 'integer', allowUnknown: true, allowDeclined: true, allowNotApplicable: true },
    { id: 'amount', type: 'decimal', scale: 2 },
    { id: 'score', type: 'decimal', calculated: true, scale: 2 },
    { id: 'readOnlyText', type: 'text', readOnly: true },
    { id: 'fixedRows', type: 'list', fixedRows: true, itemFields: [{ id: 'label', type: 'text' }] },
    {
      id: 'orders', type: 'list', maxItems: 60, itemFields: [
        { id: 'label', type: 'text' },
        { id: 'quantity', type: 'integer' },
        { id: 'meta', type: 'object', fields: [{ id: 'comment', type: 'text' }] },
        { id: 'parts', type: 'list', itemFields: [{ id: 'serial', type: 'text' }] },
      ],
    },
  ],
};

const server = (answers: ServerProjection['answers']): ServerProjection => ({ answers });
const respondent = { source: 'respondent' as const, changedAt: '2026-09-19T00:00:00Z' };

const emptyLists = server({
  orders: { status: 'answered', type: 'list', value: { items: [] }, provenance: respondent },
  fixedRows: { status: 'answered', type: 'list', value: { items: [] }, provenance: respondent },
});

describe('M4 runtime typed answers', () => {
  it('accepts only exact canonical int64s and declared stored-decimal scales', () => {
    expect(isCanonicalInt64('9007199254740993')).toBe(true);
    expect(isCanonicalInt64('9223372036854775807')).toBe(true);
    expect(isCanonicalInt64('-9223372036854775808')).toBe(true);
    expect(isCanonicalInt64('01')).toBe(false);
    expect(isCanonicalInt64('-0')).toBe(false);
    expect(isCanonicalInt64('9223372036854775808')).toBe(false);
    expect(isStoredDecimal('-0.50', 2)).toBe(true);
    expect(isStoredDecimal('-0.00', 2)).toBe(false);
    expect(isStoredDecimal('1.2', 2)).toBe(false);
    expect(isStoredDecimal('1.20', 2)).toBe(true);

    let state = createRuntimeAnswerState(emptyLists);
    const valid = applyRuntimeOperation(definition, state, { kind: 'set', target: { fieldId: 'amount' }, value: '12.30' });
    expect(valid.accepted).toBe(true);
    state = applyRuntimeOperation(definition, valid.state, { kind: 'set', target: { fieldId: 'amount' }, value: '12.3' }).state;
    expect(state.answers.amount).toEqual({ status: 'answered', value: '12.30' });
  });

  it('checks numeric constraints without losing int64 or decimal precision', () => {
    const exact: RuntimeDefinition = { fields: [
      { id: 'integer', type: 'integer', min: '9223372036854775806', max: '9223372036854775807', step: '1' },
      { id: 'decimal', type: 'decimal', min: '0.1', step: '0.000000000000000001' },
    ] };
    let state = createRuntimeAnswerState();
    const integer = applyRuntimeOperation(exact, state, { kind: 'set', target: { fieldId: 'integer' }, value: '9223372036854775807' });
    expect(integer.accepted).toBe(true);
    state = integer.state;
    expect(applyRuntimeOperation(exact, state, { kind: 'set', target: { fieldId: 'integer' }, value: '9223372036854775805' }).accepted).toBe(false);
    expect(applyRuntimeOperation(exact, state, { kind: 'set', target: { fieldId: 'decimal' }, value: '0.100000000000000001' }).accepted).toBe(true);
  });

  it('models exactly six statuses while preserving server-owned provenance outside client input', () => {
    const state = createRuntimeAnswerState(server({
      age: { status: 'unknown', type: 'integer', provenance: respondent },
    }));
    expect(state.answers.age).toEqual({ status: 'unknown' });
    expect(state.server?.answers.age).toEqual({ status: 'unknown', type: 'integer', provenance: respondent });
    expect(Object.keys(state.answers.age!)).toEqual(['status']);
    expect(applyRuntimeOperation(definition, state, {
      kind: 'set', target: { fieldId: 'age' }, answer: { status: 'declined' },
    }).state.answers.age).toEqual({ status: 'declined' });
    expect(applyRuntimeOperation(definition, state, {
      kind: 'set', target: { fieldId: 'age' }, answer: { status: 'respondentNotApplicable' },
    }).state.answers.age).toEqual({ status: 'respondentNotApplicable' });
    expect(applyRuntimeOperation(definition, state, {
      kind: 'set', target: { fieldId: 'age' }, answer: { status: 'notApplicable' },
    })).toMatchObject({ accepted: false, rejection: 'INVALID_STATUS' });
  });

  it('rejects forged calculated and read-only values every time', () => {
    let state = createRuntimeAnswerState(emptyLists);
    let accepted = 0;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const score = applyRuntimeOperation(definition, state, {
        kind: 'set', target: { fieldId: 'score' }, value: `${attempt}.00`,
      });
      const readOnly = applyRuntimeOperation(definition, state, {
        kind: 'clear', target: { fieldId: 'readOnlyText' },
      });
      const invalidCalculated = applyRuntimeOperation(definition, state, {
        kind: 'markInvalid', target: { fieldId: 'score' }, reason: 'UNPARSEABLE_INPUT',
      });
      accepted += Number(score.accepted) + Number(readOnly.accepted) + Number(invalidCalculated.accepted);
      expect(score.rejection).toBe('PROTECTED_FIELD');
      expect(readOnly.rejection).toBe('PROTECTED_FIELD');
      expect(invalidCalculated.rejection).toBe('PROTECTED_FIELD');
      state = score.state;
    }
    expect(accepted).toBe(0);
  });

  it('uses stable item IDs through fifty add/delete/reorder operations and never reuses one', () => {
    let state = createRuntimeAnswerState(emptyLists);
    for (let index = 0; index < 50; index += 1) {
      const result = applyRuntimeOperation(definition, state, {
        kind: 'addItem', target: { fieldId: 'orders' }, itemId: `item${index}`, fields: {
          label: { status: 'answered', value: `row ${index}` },
          quantity: { status: 'answered', value: `${index}` },
        },
      });
      expect(result.accepted).toBe(true);
      state = result.state;
    }

    const before = (state.answers.orders as { status: 'answered'; value: { items: readonly { itemId: string; fields: { label?: { value: string } } }[] } }).value.items;
    expect(before).toHaveLength(50);
    expect(before.map((item) => item.itemId)).toEqual(Array.from({ length: 50 }, (_, index) => `item${index}`));

    state = applyRuntimeOperation(definition, state, { kind: 'removeItem', target: { fieldId: 'orders' }, itemId: 'item17' }).state;
    state = applyRuntimeOperation(definition, state, {
      kind: 'moveItem', target: { fieldId: 'orders' }, itemId: 'item49', beforeItemId: 'item0',
    }).state;
    const after = (state.answers.orders as { status: 'answered'; value: { items: readonly { itemId: string; fields: { label?: { value: string } } }[] } }).value.items;
    expect(after).toHaveLength(49);
    expect(after[0].itemId).toBe('item49');
    expect(after.find((item) => item.itemId === 'item42')?.fields.label?.value).toBe('row 42');
    expect(after.some((item) => item.itemId === 'item17')).toBe(false);
    expect(state.retiredItemIds).toContain('item17');
    expect(applyRuntimeOperation(definition, state, {
      kind: 'addItem', target: { fieldId: 'orders' }, itemId: 'item17', fields: {},
    })).toMatchObject({ accepted: false, rejection: 'ITEM_ID_REUSED' });
  });

  it('addresses nested values by stable row paths through exactly three list levels', () => {
    let state = createRuntimeAnswerState(emptyLists);
    state = applyRuntimeOperation(definition, state, {
      kind: 'addItem', target: { fieldId: 'orders' }, itemId: 'orderA', fields: {
        parts: { status: 'answered', value: { items: [{ itemId: 'partA', fields: {} }] } },
      },
    }).state;
    // A third repeater is permitted only when the target row path has two segments.
    const threeLevels: RuntimeDefinition = {
      fields: [{ id: 'outer', type: 'list', itemFields: [{ id: 'middle', type: 'list', itemFields: [{ id: 'inner', type: 'list', itemFields: [{ id: 'value', type: 'text' }] }] }] }],
    };
    const nestedProjection = {
      answers: {
        outer: {
          status: 'answered', type: 'list', provenance: respondent, value: {
            items: [{ itemId: 'o', fields: {
              middle: {
                status: 'answered', type: 'list', provenance: respondent, value: {
                  items: [{ itemId: 'm', fields: {
                    inner: { status: 'answered', type: 'list', provenance: respondent, value: { items: [] } },
                  } }],
                },
              },
            } }],
          },
        },
      },
    } as ServerProjection;
    let nested = createRuntimeAnswerState(nestedProjection);
    const path = [{ listFieldId: 'outer', itemId: 'o' }, { listFieldId: 'middle', itemId: 'm' }] as const;
    nested = applyRuntimeOperation(threeLevels, nested, { kind: 'addItem', target: { fieldId: 'inner', rowPath: path }, itemId: 'i', fields: { value: { status: 'answered', value: 'ok' } } }).state;
    expect(applyRuntimeOperation(threeLevels, nested, {
      kind: 'addItem', target: { fieldId: 'inner', rowPath: [...path, { listFieldId: 'inner', itemId: 'i' }] }, itemId: 'tooDeep', fields: {},
    })).toMatchObject({ accepted: false, rejection: 'ROW_PATH_DEPTH' });
  });

  it('rejects fixed rows and reconciles projections deterministically without client provenance', () => {
    let state = createRuntimeAnswerState(emptyLists);
    expect(applyRuntimeOperation(definition, state, {
      kind: 'addItem', target: { fieldId: 'fixedRows' }, itemId: 'forged', fields: {},
    })).toMatchObject({ accepted: false, rejection: 'FIXED_ROWS' });

    state = applyRuntimeOperation(definition, state, {
      kind: 'addItem', target: { fieldId: 'orders' }, itemId: 'local', fields: {},
    }).state;
    const projection = server({
      orders: { status: 'answered', type: 'list', provenance: { source: 'system', changedAt: '2026-09-19T01:00:00Z' }, value: {
        items: [{ itemId: 'serverItem', fields: { label: { status: 'answered', type: 'text', provenance: respondent, value: 'authoritative' } } }],
      } },
    });
    const first = reconcileServerProjection(state, projection);
    const second = reconcileServerProjection(first, projection);
    expect(first).toEqual(second);
    expect(first.answers.orders).toEqual({ status: 'answered', value: { items: [{ itemId: 'serverItem', fields: { label: { status: 'answered', value: 'authoritative' } } }] } });
    expect(first.server).toBe(projection);
    expect(first.retiredItemIds).toContain('local');
  });

  it('rejects optimistic mutations against system-not-applicable fields', () => {
    const state = createRuntimeAnswerState(server({
      orders: { status: 'notApplicable', type: 'list', provenance: { source: 'system', changedAt: '2026-09-19T01:00:00Z' } },
    }));
    expect(applyRuntimeOperation(definition, state, {
      kind: 'addItem', target: { fieldId: 'orders' }, itemId: 'forged', fields: {},
    })).toMatchObject({ accepted: false, rejection: 'INVALID_STATUS' });
  });
});
