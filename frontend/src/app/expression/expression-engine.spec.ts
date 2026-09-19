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

  it('rejects two-argument if expressions before evaluating them', () => {
    expect(new ExpressionEngine().compile({ op: 'if', args: [
      { literal: { type: 'boolean', value: true } },
      { literal: { type: 'text', value: 'missing else' } },
    ] })).toEqual({ state: 'error', code: 'EXPR_ARITY' });
  });

  it('validates an answered value against its static field type before predicates', () => {
    const result = new ExpressionEngine().evaluateVector({
      expression: { op: 'exists', args: [{ ref: { fieldId: 'age', scope: 'root' } }] },
      fieldDefinitions: [{ id: 'age', type: 'integer' }],
      answers: { age: { type: 'integer', status: 'answered', applicable: true, value: '01' } },
    });
    expect(result).toEqual({ state: 'error', code: 'INTEGER_ENCODING' });
  });

  it('retains scalar array item types and permits an array result', () => {
    const result = new ExpressionEngine().evaluateVector({
      expression: { ref: { fieldId: 'tags', scope: 'root' } },
      fieldDefinitions: [{ id: 'tags', type: 'array', itemType: 'integer' }],
      answers: { tags: { type: 'array', itemType: 'integer', status: 'answered', applicable: true, value: ['1', '2'] } },
    });
    expect(result).toEqual({ state: 'available', type: 'array', value: ['1', '2'] });
  });
});
