import { describe, expect, it } from 'vitest';
import { ExpressionEngine } from './expression-engine';

describe('ExpressionEngine', () => {
  it('keeps BigInt and decimal arithmetic out of Number', () => {
    const engine = new ExpressionEngine();
    expect(engine.evaluateVector({ expression: { op: 'add', args: [
      { literal: { type: 'integer', value: '9007199254740993' } },
      { literal: { type: 'decimal', value: '0.1' } },
    ] } })).toEqual({ state: 'available', type: 'decimal', value: '9007199254740993.1' });
  });

  it('short-circuits a failing branch while compiling it', () => {
    const engine = new ExpressionEngine();
    const vector = { expression: { op: 'if', args: [
      { literal: { type: 'boolean', value: false } },
      { op: 'divide', args: [{ literal: { type: 'integer', value: '1' } }, { ref: { fieldId: 'zero', scope: 'root' } }] },
      { literal: { type: 'integer', value: '4' } },
    ] }, fieldDefinitions: [{ id: 'zero', type: 'decimal' as const }], answers: { zero: { type: 'decimal' as const, status: 'answered', applicable: true, value: '0' } } };
    expect(engine.evaluateVector(vector)).toEqual({ state: 'available', type: 'decimal', value: '4' });
  });

  it('uses stable nested item contexts for aggregates', () => {
    const engine = new ExpressionEngine();
    const vector = {
      expression: { op: 'sum', args: [
        { ref: { fieldId: 'orders', scope: 'root' } },
        { op: 'sum', args: [
          { ref: { fieldId: 'parts', scope: 'item' } },
          { ref: { fieldId: 'limit', scope: 'parentItem', parentDepth: 1 } },
        ] },
      ] },
      fieldDefinitions: [{ id: 'orders', type: 'list', itemFields: [
        { id: 'limit', type: 'integer' },
        { id: 'parts', type: 'list', itemFields: [{ id: 'amount', type: 'integer' }] },
      ] }],
      answers: { orders: { type: 'list', status: 'answered', applicable: true, value: { items: [{
        itemId: 'one', fields: {
          limit: { type: 'integer', status: 'answered', applicable: true, value: '2' },
          parts: { type: 'list', status: 'answered', applicable: true, value: { items: [{
            itemId: 'part', fields: { amount: { type: 'integer', status: 'answered', applicable: true, value: '1' } },
          }] } },
        },
      }] } } },
    } as any;
    expect(engine.evaluateVector(vector)).toEqual({ state: 'available', type: 'decimal', value: '2' });
  });
});
