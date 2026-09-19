/**
 * Browser implementation of the frozen Smart Form Builder Lite expression
 * contract. It deliberately has no numeric dependency: integers are BigInt
 * and decimals are coefficient/scale pairs backed by BigInt.
 */

export type ScalarType = 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'time' | 'dateTime' | 'choice';
export type ValueType = ScalarType | 'array' | 'list' | 'object';
import { PINNED_TIMEZONES } from './pinned-timezone-registry';
export type ExpressionResult =
  | { state: 'available'; type: ValueType; value: unknown }
  | { state: 'unknown'; reason: 'UNAVAILABLE_OPERAND' | 'UNKNOWN_CONDITION' | 'UNAVAILABLE_AGGREGATE_ITEM' }
  | { state: 'error'; code: string };

type TypeSpec = { kind: ValueType; item?: ScalarType; fields?: Map<string, FieldDefinition> };
export type FieldDefinition = { id: string; type: ValueType; itemType?: ScalarType; itemFields?: FieldDefinition[] };
type AnswerCell = { type: ValueType; itemType?: ScalarType; status: string; applicable: boolean; value?: unknown };
type ItemContext = { fields: Record<string, AnswerCell> };
type EvaluationContext = { sessionDate: string; sessionTimeZone: string; maximumSteps?: number };
type InternalValue = { type: ValueType; value: unknown; item?: ScalarType };
type InternalResult = { state: 'available'; value: InternalValue } | { state: 'unknown'; reason: 'UNAVAILABLE_OPERAND' | 'UNKNOWN_CONDITION' | 'UNAVAILABLE_AGGREGATE_ITEM' } | { state: 'error'; code: string };

const INTEGER = /^(0|-?[1-9][0-9]*)$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const STATUSES = new Set(['answered', 'unanswered', 'unknown', 'declined', 'respondentNotApplicable', 'notApplicable']);
const MAX_INT64 = 9223372036854775807n;
const MIN_INT64 = -9223372036854775808n;
const MAX_DEPTH = 20;
const MAX_ARGS = 100;
const DEFAULT_CONTEXT: EvaluationContext = { sessionDate: '2026-09-05', sessionTimeZone: 'UTC', maximumSteps: 100000 };

class Fault extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Exact signed decimal. scale is the number of digits after the decimal point. */
class ExactDecimal {
  private constructor(readonly coefficient: bigint, readonly scale: number) {}

  static parse(value: unknown): ExactDecimal {
    if (typeof value !== 'string' || !DECIMAL.test(value)) throw new Fault('INVALID_LITERAL');
    const negative = value.startsWith('-');
    const plain = negative ? value.slice(1) : value;
    const [whole, fraction = ''] = plain.split('.');
    const coefficient = BigInt(`${negative ? '-' : ''}${whole}${fraction}`);
    return ExactDecimal.normalized(coefficient, fraction.length);
  }

  static integer(value: bigint): ExactDecimal { return new ExactDecimal(value, 0); }

  private static normalized(coefficient: bigint, scale: number): ExactDecimal {
    if (coefficient === 0n) return new ExactDecimal(0n, 0);
    let c = coefficient;
    let s = scale;
    while (s > 0 && c % 10n === 0n) { c /= 10n; s--; }
    return new ExactDecimal(c, s);
  }

  add(other: ExactDecimal): ExactDecimal {
    const scale = Math.max(this.scale, other.scale);
    return ExactDecimal.normalized(this.coefficient * pow10(scale - this.scale) + other.coefficient * pow10(scale - other.scale), scale);
  }
  subtract(other: ExactDecimal): ExactDecimal { return this.add(new ExactDecimal(-other.coefficient, other.scale)); }
  multiply(other: ExactDecimal): ExactDecimal { return ExactDecimal.normalized(this.coefficient * other.coefficient, this.scale + other.scale); }
  compare(other: ExactDecimal): number {
    const scale = Math.max(this.scale, other.scale);
    const a = this.coefficient * pow10(scale - this.scale);
    const b = other.coefficient * pow10(scale - other.scale);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  divide(other: ExactDecimal): ExactDecimal {
    if (other.coefficient === 0n) throw new Fault('DIVIDE_BY_ZERO');
    let numerator = this.coefficient;
    let denominator = other.coefficient;
    if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
    const divisor = gcd(abs(numerator), denominator);
    numerator /= divisor;
    denominator /= divisor;
    let twos = 0;
    let fives = 0;
    while (denominator % 2n === 0n) { denominator /= 2n; twos++; }
    while (denominator % 5n === 0n) { denominator /= 5n; fives++; }
    if (denominator !== 1n) throw new Fault('CALC_PRECISION');
    const scale = Math.max(twos, fives) + this.scale - other.scale;
    let coefficient = numerator * powBig(2n, BigInt(Math.max(0, fives - twos))) * powBig(5n, BigInt(Math.max(0, twos - fives)));
    if (scale < 0) { coefficient *= pow10(-scale); return ExactDecimal.normalized(coefficient, 0); }
    return ExactDecimal.normalized(coefficient, scale);
  }
  round(scale: number): ExactDecimal {
    if (this.scale <= scale) return this;
    const unit = pow10(this.scale - scale);
    const sign = this.coefficient < 0n ? -1n : 1n;
    const magnitude = abs(this.coefficient);
    let quotient = magnitude / unit;
    const remainder = magnitude % unit;
    const doubled = remainder * 2n;
    if (doubled > unit || (doubled === unit && quotient % 2n !== 0n)) quotient++;
    return ExactDecimal.normalized(sign * quotient, scale);
  }
  canonical(): string {
    const sign = this.coefficient < 0n ? '-' : '';
    const digits = abs(this.coefficient).toString();
    if (this.scale === 0) return `${sign}${digits}`;
    if (digits.length <= this.scale) return `${sign}0.${'0'.repeat(this.scale - digits.length)}${digits}`;
    return `${sign}${digits.slice(0, -this.scale)}.${digits.slice(-this.scale)}`;
  }
  assertFinal(): ExactDecimal {
    if (this.coefficient === 0n) return this;
    const raw = abs(this.coefficient).toString();
    const significant = raw.replace(/0+$/, '').length;
    const adjustedExponent = raw.length - this.scale - 1;
    if (significant > 34) throw new Fault('CALC_PRECISION');
    if (adjustedExponent < -6143 || adjustedExponent > 6144) throw new Fault('CALC_OVERFLOW');
    return this;
  }
}

function abs(value: bigint): bigint { return value < 0n ? -value : value; }
function gcd(a: bigint, b: bigint): bigint { while (b) [a, b] = [b, a % b]; return a; }
function pow10(power: number): bigint { return powBig(10n, BigInt(power)); }
function powBig(base: bigint, power: bigint): bigint { let out = 1n; let factor = base; let exponent = power; while (exponent) { if (exponent & 1n) out *= factor; factor *= factor; exponent >>= 1n; } return out; }

export class ExpressionEngine {
  operatorNames(): string[] { return [...OPERATORS]; }

  compile(expression: unknown, definitions: FieldDefinition[] = []): ExpressionResult | { state: 'compiled' } {
    try {
      const output = this.compileNode(expression, environment(definitions), 1);
      // An array is a legal typed expression result, but a bare array literal
      // is not a top-level program in the frozen compile profile (EXPR-056).
      if (output.kind === 'array' && isObject(expression) && 'literal' in expression) throw new Fault('INVALID_LITERAL');
      return { state: 'compiled' };
    } catch (error) {
      return { state: 'error', code: codeOf(error) };
    }
  }

  evaluateVector(vector: { expression: unknown; fieldDefinitions?: FieldDefinition[]; answers?: Record<string, AnswerCell>; context?: Partial<EvaluationContext> }): ExpressionResult {
    const definitions = vector.fieldDefinitions ?? [];
    let outputType: TypeSpec;
    try {
      outputType = this.compileNode(vector.expression, environment(definitions), 1);
    } catch (error) {
      return { state: 'error', code: codeOf(error) };
    }
    const context = { ...DEFAULT_CONTEXT, ...(vector.context ?? {}) };
    if (!validDate(context.sessionDate) || !validZone(context.sessionTimeZone)) return { state: 'error', code: 'INVALID_LITERAL' };
    try { validateAnswerRecord(definitions, vector.answers ?? {}); } catch (error) { return { state: 'error', code: codeOf(error) }; }
    const state = { steps: 0, maximumSteps: context.maximumSteps ?? DEFAULT_CONTEXT.maximumSteps!, answers: vector.answers ?? {}, contexts: [] as ItemContext[], context };
    try {
      return external(this.evaluateNode(vector.expression, state), outputType!);
    } catch (error) {
      return { state: 'error', code: codeOf(error) };
    }
  }

  private compileNode(node: unknown, env: CompileEnvironment, depth: number): TypeSpec {
    if (depth > MAX_DEPTH || !isObject(node)) throw new Fault('EXPR_SHAPE');
    if ('literal' in node) { if (Object.keys(node).length !== 1) throw new Fault('EXPR_SHAPE'); return this.compileLiteral(node.literal); }
    if ('ref' in node) { if (Object.keys(node).length !== 1) throw new Fault('EXPR_SHAPE'); return this.compileReference(node.ref, env); }
    if ('context' in node) { if (Object.keys(node).length !== 1) throw new Fault('EXPR_SHAPE');
      if (node.context === 'sessionDate') return { kind: 'date' };
      if (node.context === 'sessionTimeZone') return { kind: 'text' };
      throw new Fault('UNSUPPORTED_CONTEXT');
    }
    if (!('op' in node) || !Array.isArray(node.args) || Object.keys(node).some((key) => key !== 'op' && key !== 'args')) throw new Fault('EXPR_SHAPE');
    const operator = node.op;
    if (typeof operator !== 'string' || !OPERATORS.has(operator)) throw new Fault('UNSUPPORTED_OPERATOR');
    if (node.args.length > MAX_ARGS || !arity(operator, node.args.length)) throw new Fault('EXPR_ARITY');
    // The list item expression has a deliberately deeper compile context.
    if (operator === 'sum' || operator === 'any' || operator === 'all') {
      const list = this.compileNode(node.args[0], env, depth + 1);
      if (list.kind !== 'list' || !list.fields) throw new Fault('EXPR_TYPE');
      const item = this.compileNode(node.args[1], { ...env, items: [...env.items, list.fields] }, depth + 1);
      if ((operator === 'sum' && !numeric(item)) || ((operator === 'any' || operator === 'all') && item.kind !== 'boolean')) throw new Fault('EXPR_TYPE');
      return operator === 'sum' ? { kind: 'decimal' } : { kind: 'boolean' };
    }
    const args = node.args.map((argument) => this.compileNode(argument, env, depth + 1));
    return operatorType(operator, args, node.args);
  }

  private compileLiteral(literal: unknown): TypeSpec {
    if (!isObject(literal) || !('type' in literal) || !('value' in literal)) throw new Fault('EXPR_SHAPE');
    const keys = Object.keys(literal);
    if (literal.type === 'array') {
      if (keys.length !== 3 || !('itemType' in literal) || typeof literal.itemType !== 'string' || !scalar(literal.itemType) || !Array.isArray(literal.value)) throw new Fault('INVALID_LITERAL');
      for (const item of literal.value) try { this.validateScalar(literal.itemType, item); } catch { throw new Fault('INVALID_LITERAL'); }
      return { kind: 'array', item: literal.itemType };
    }
    if (keys.length !== 2 || typeof literal.type !== 'string' || !scalar(literal.type)) throw new Fault('EXPR_SHAPE');
    this.validateScalar(literal.type, literal.value);
    return { kind: literal.type };
  }

  private validateScalar(type: ScalarType, value: unknown): void {
    if (type === 'integer') {
      if (typeof value !== 'string' || !INTEGER.test(value)) throw new Fault('INTEGER_ENCODING');
      const integer = BigInt(value);
      if (integer < MIN_INT64 || integer > MAX_INT64) throw new Fault('INTEGER_RANGE');
      return;
    }
    if (type === 'decimal') { ExactDecimal.parse(value).assertFinal(); return; }
    if (type === 'text' || type === 'choice') { if (typeof value !== 'string') throw new Fault('INVALID_LITERAL'); return; }
    if (type === 'boolean') { if (typeof value !== 'boolean') throw new Fault('INVALID_LITERAL'); return; }
    if (type === 'date') { if (!validDate(value)) throw new Fault('INVALID_LITERAL'); return; }
    if (type === 'time') { if (typeof value !== 'string' || !TIME.test(value)) throw new Fault('INVALID_LITERAL'); return; }
    if (type === 'dateTime') {
      if (!isObject(value) || Object.keys(value).length !== 2 || typeof value.instant !== 'string' || typeof value.timeZone !== 'string' || !validInstant(value.instant)) throw new Fault('INVALID_LITERAL');
      if (!validZone(value.timeZone)) throw new Fault('INVALID_TIMEZONE');
    }
  }

  private compileReference(reference: unknown, env: CompileEnvironment): TypeSpec {
    if (!isObject(reference) || typeof reference.fieldId !== 'string' || typeof reference.scope !== 'string') throw new Fault('EXPR_SHAPE');
    const keys = Object.keys(reference);
    if (keys.some((key) => key !== 'fieldId' && key !== 'scope' && key !== 'parentDepth')) throw new Fault('EXPR_SHAPE');
    if (reference.scope === 'root') {
      if ('parentDepth' in reference) throw new Fault('EXPR_SCOPE');
      const definition = env.root.get(reference.fieldId);
      if (!definition) throw new Fault(env.known.has(reference.fieldId) ? 'EXPR_SCOPE' : 'UNKNOWN_FIELD');
      return definitionType(definition);
    }
    if (reference.scope === 'item') {
      if ('parentDepth' in reference || env.items.length === 0) throw new Fault('EXPR_SCOPE');
      const definition = env.items.at(-1)!.get(reference.fieldId);
      if (!definition) throw new Fault(env.known.has(reference.fieldId) ? 'EXPR_SCOPE' : 'UNKNOWN_FIELD');
      return definitionType(definition);
    }
    if (reference.scope === 'parentItem') {
      const parentDepth = reference.parentDepth ?? 1;
      if (!Number.isInteger(parentDepth) || parentDepth < 1 || parentDepth > 3 || parentDepth >= env.items.length) throw new Fault('EXPR_SCOPE');
      const definition = env.items[env.items.length - 1 - parentDepth].get(reference.fieldId);
      if (!definition) throw new Fault('EXPR_SCOPE');
      return definitionType(definition);
    }
    throw new Fault('EXPR_SCOPE');
  }

  private evaluateNode(node: any, state: RuntimeState): InternalResult {
    this.step(state);
    if ('literal' in node) return { state: 'available', value: literalValue(node.literal) };
    if ('context' in node) return { state: 'available', value: { type: node.context === 'sessionDate' ? 'date' : 'text', value: node.context === 'sessionDate' ? state.context.sessionDate : state.context.sessionTimeZone } };
    if ('ref' in node) return this.referenceValue(node.ref, state);
    const op = node.op as string;
    if (op === 'today') return available('date', state.context.sessionDate);
    if (op === 'and' || op === 'or') return this.logical(op, node.args, state);
    if (op === 'not') return mapAvailable(this.evaluateNode(node.args[0], state), (value) => available('boolean', !bool(value)));
    if (op === 'if') {
      const condition = this.evaluateNode(node.args[0], state);
      if (condition.state !== 'available') return condition.state === 'unknown' ? unknown('UNKNOWN_CONDITION') : condition;
      return this.evaluateNode(node.args[bool(condition.value) ? 1 : 2], state);
    }
    if (op === 'coalesce') {
      let unavailable: InternalResult | undefined;
      for (const argument of node.args) { const result = this.evaluateNode(argument, state); if (result.state === 'error') return result; if (result.state === 'available') return result; unavailable = result; }
      return unavailable ?? unknown('UNAVAILABLE_OPERAND');
    }
    if (op === 'exists' || op === 'isAnswered' || op === 'statusIs') return this.statusOperation(op, node.args, state);
    if (op === 'sum' || op === 'any' || op === 'all' || op === 'count') return this.aggregate(op, node.args, state);
    const values = strict(node.args, state, (argument) => this.evaluateNode(argument, state));
    if (values.state !== 'available') return values;
    return this.apply(op, values.value);
  }

  private step(state: RuntimeState): void { if (++state.steps > state.maximumSteps) throw new Fault('EVALUATION_BUDGET'); }

  private referenceValue(reference: any, state: RuntimeState): InternalResult {
    const cell = this.cell(reference, state);
    if (!cell || !cell.applicable || cell.status !== 'answered' || cell.value === undefined) return unknown('UNAVAILABLE_OPERAND');
    try { return { state: 'available', value: answerValue(cell) }; } catch (error) { return { state: 'error', code: codeOf(error) }; }
  }

  private cell(reference: any, state: RuntimeState): AnswerCell | undefined {
    if (reference.scope === 'root') return state.answers[reference.fieldId];
    if (reference.scope === 'item') return state.contexts.at(-1)?.fields[reference.fieldId];
    return state.contexts[state.contexts.length - 1 - (reference.parentDepth ?? 1)]?.fields[reference.fieldId];
  }

  private logical(op: 'and' | 'or', args: any[], state: RuntimeState): InternalResult {
    let unknownSeen = false;
    for (const argument of args) {
      const result = this.evaluateNode(argument, state);
      if (result.state === 'error') return result;
      if (result.state === 'unknown') { unknownSeen = true; continue; }
      const value = bool(result.value);
      if ((op === 'and' && !value) || (op === 'or' && value)) return available('boolean', value);
    }
    return unknownSeen ? unknown('UNAVAILABLE_OPERAND') : available('boolean', op === 'and');
  }

  private statusOperation(op: string, args: any[], state: RuntimeState): InternalResult {
    const cell = this.cell(args[0].ref, state);
    if (op === 'statusIs') return available('boolean', cell?.status === args[1].literal.value);
    return available('boolean', !!cell && cell.applicable && cell.status === 'answered' && cell.value !== undefined);
  }

  private aggregate(op: string, args: any[], state: RuntimeState): InternalResult {
    const list = this.evaluateNode(args[0], state);
    if (list.state !== 'available') return list;
    const items = ((list.value.value as any)?.items ?? []) as ItemContext[];
    if (!Array.isArray(items)) return { state: 'error', code: 'EXPR_TYPE' };
    if (op === 'count') return available('integer', BigInt(items.length));
    if (op === 'sum') {
      let total = ExactDecimal.integer(0n); let unavailableSeen = false;
      for (const item of items) { state.contexts.push(item); const value = this.evaluateNode(args[1], state); state.contexts.pop(); if (value.state === 'error') return value; if (value.state === 'unknown') { unavailableSeen = true; continue; } total = total.add(decimal(value.value)); }
      return unavailableSeen ? unknown('UNAVAILABLE_AGGREGATE_ITEM') : available('decimal', total.assertFinal());
    }
    let unknownSeen = false;
    for (const item of items) {
      state.contexts.push(item); const result = this.evaluateNode(args[1], state); state.contexts.pop();
      if (result.state === 'error') return result;
      if (result.state === 'unknown') { unknownSeen = true; continue; }
      const predicate = bool(result.value);
      if ((op === 'any' && predicate) || (op === 'all' && !predicate)) return available('boolean', predicate);
    }
    return unknownSeen ? unknown('UNAVAILABLE_AGGREGATE_ITEM') : available('boolean', op === 'all');
  }

  private apply(op: string, args: InternalValue[]): InternalResult {
    try {
      if (['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(op)) {
        const comparison = compare(args[0], args[1]);
        const value = op === 'eq' ? comparison === 0 : op === 'ne' ? comparison !== 0 : op === 'lt' ? comparison < 0 : op === 'lte' ? comparison <= 0 : op === 'gt' ? comparison > 0 : comparison >= 0;
        return available('boolean', value);
      }
      if (op === 'in' || op === 'contains') {
        const scalarValue = op === 'in' ? args[0] : args[1]; const array = op === 'in' ? args[1] : args[0];
        return available('boolean', (array.value as unknown[]).some((item) => compare(scalarValue, { type: array.item!, value: item }) === 0));
      }
      if (op === 'containsAll') return available('boolean', (args[1].value as unknown[]).every((wanted) => (args[0].value as unknown[]).some((item) => compare({ type: args[0].item!, value: item }, { type: args[1].item!, value: wanted }) === 0)));
      if (op === 'add') return available('decimal', decimal(args[0]).add(decimal(args[1])).assertFinal());
      if (op === 'subtract') return available('decimal', decimal(args[0]).subtract(decimal(args[1])).assertFinal());
      if (op === 'multiply') return available('decimal', decimal(args[0]).multiply(decimal(args[1])).assertFinal());
      if (op === 'divide') return available('decimal', decimal(args[0]).divide(decimal(args[1])).assertFinal());
      if (op === 'round') { const scale = integer(args[1]); if (scale < 0n || scale > 12n) throw new Fault('INVALID_SCALE'); return available('decimal', decimal(args[0]).round(Number(scale)).assertFinal()); }
      if (op === 'min' || op === 'max') return available('decimal', args.map(decimal).reduce((best, candidate) => (op === 'min' ? best.compare(candidate) <= 0 : best.compare(candidate) >= 0) ? best : candidate).assertFinal());
      if (op === 'concat') return available('text', args.map((value) => value.value as string).join(''));
      if (op === 'length') return available('integer', BigInt(args[0].type === 'text' ? Array.from(args[0].value as string).length : (args[0].value as unknown[]).length));
      if (op === 'dateDiffDays') return available('integer', BigInt(dayOrdinal(args[1].value as string) - dayOrdinal(args[0].value as string)));
      if (op === 'ageYears') return available('integer', BigInt(ageYears(args[0].value as string, args[1].value as string)));
      if (op === 'dateAddDays') return available('date', dateAdd(args[0].value as string, integer(args[1])));
      throw new Fault('UNSUPPORTED_OPERATOR');
    } catch (error) { return { state: 'error', code: codeOf(error) }; }
  }
}

type CompileEnvironment = { root: Map<string, FieldDefinition>; items: Map<string, FieldDefinition>[]; known: Set<string> };
type RuntimeState = { steps: number; maximumSteps: number; answers: Record<string, AnswerCell>; contexts: ItemContext[]; context: EvaluationContext };
const OPERATORS = new Set(['and', 'or', 'not', 'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'containsAll', 'exists', 'isAnswered', 'statusIs', 'add', 'subtract', 'multiply', 'divide', 'round', 'min', 'max', 'sum', 'count', 'any', 'all', 'concat', 'length', 'coalesce', 'if', 'dateDiffDays', 'ageYears', 'dateAddDays', 'today']);

function arity(operator: string, count: number): boolean { if (operator === 'if') return count === 3; if (['and', 'or', 'min', 'max', 'concat', 'coalesce'].includes(operator)) return count >= 2 && count <= MAX_ARGS; if (operator === 'today') return count === 0; return ['not', 'exists', 'isAnswered', 'count', 'length'].includes(operator) ? count === 1 : count === 2; }
function operatorType(operator: string, args: TypeSpec[], raw: any[]): TypeSpec {
  const same = () => { if (!compatible(args[0], args[1])) throw new Fault('EXPR_TYPE'); };
  if (['and', 'or', 'not'].includes(operator)) { if (!args.every((arg) => arg.kind === 'boolean')) throw new Fault('EXPR_TYPE'); return { kind: 'boolean' }; }
  if (['eq', 'ne'].includes(operator)) { same(); if (!scalarType(args[0]) || args[0].kind === 'array') throw new Fault('EXPR_TYPE'); return { kind: 'boolean' }; }
  if (['lt', 'lte', 'gt', 'gte'].includes(operator)) { same(); if (!(numeric(args[0]) || args[0].kind === 'date' || args[0].kind === 'time' || args[0].kind === 'dateTime')) throw new Fault('EXPR_TYPE'); return { kind: 'boolean' }; }
  if (operator === 'in' || operator === 'contains') { const scalarArg = operator === 'in' ? args[0] : args[1]; const arrayArg = operator === 'in' ? args[1] : args[0]; if (arrayArg.kind !== 'array' || !compatible(scalarArg, { kind: arrayArg.item! })) throw new Fault('EXPR_TYPE'); return { kind: 'boolean' }; }
  if (operator === 'containsAll') { if (args[0].kind !== 'array' || args[1].kind !== 'array' || !compatible({ kind: args[0].item! }, { kind: args[1].item! })) throw new Fault('EXPR_TYPE'); return { kind: 'boolean' }; }
  if (['exists', 'isAnswered'].includes(operator)) { if (!isReference(raw[0])) throw new Fault('EXPR_TYPE'); return { kind: 'boolean' }; }
  if (operator === 'statusIs') { if (!isReference(raw[0]) || args[1].kind !== 'text' || raw[1]?.literal?.value === undefined || !STATUSES.has(raw[1].literal.value)) throw new Fault('INVALID_STATUS'); return { kind: 'boolean' }; }
  if (operator === 'count') { if (args[0].kind !== 'list') throw new Fault('EXPR_TYPE'); return { kind: 'integer' }; }
  if (['add', 'subtract', 'multiply', 'divide', 'round', 'min', 'max'].includes(operator)) { if (!args.every(numeric) || (operator === 'round' && args[1].kind !== 'integer')) throw new Fault('EXPR_TYPE'); if (operator === 'divide' && raw[1]?.literal?.type && decimal(literalValue(raw[1].literal)).coefficient === 0n) throw new Fault('DIVIDE_BY_ZERO'); if (operator === 'round' && raw[1]?.literal?.type === 'integer' && (BigInt(raw[1].literal.value) < 0n || BigInt(raw[1].literal.value) > 12n)) throw new Fault('INVALID_SCALE'); return { kind: 'decimal' }; }
  if (operator === 'concat') { if (!args.every((arg) => arg.kind === 'text')) throw new Fault('EXPR_TYPE'); return { kind: 'text' }; }
  if (operator === 'length') { if (args[0].kind !== 'text' && args[0].kind !== 'array') throw new Fault('EXPR_TYPE'); return { kind: 'integer' }; }
  if (operator === 'coalesce') return unified(args);
  if (operator === 'if') { if (args[0].kind !== 'boolean') throw new Fault('EXPR_TYPE'); return unified(args.slice(1)); }
  if (operator === 'dateDiffDays') { if (!args.every((arg) => arg.kind === 'date')) throw new Fault('EXPR_TYPE'); return { kind: 'integer' }; }
  if (operator === 'ageYears') { if (!args.every((arg) => arg.kind === 'date')) throw new Fault('EXPR_TYPE'); return { kind: 'integer' }; }
  if (operator === 'dateAddDays') { if (args[0].kind !== 'date' || args[1].kind !== 'integer') throw new Fault('EXPR_TYPE'); return { kind: 'date' }; }
  if (operator === 'today') return { kind: 'date' };
  throw new Fault('UNSUPPORTED_OPERATOR');
}
function unified(args: TypeSpec[]): TypeSpec { if (args.some((arg) => arg.kind === 'object' || arg.kind === 'list') || !args.every((arg) => compatible(args[0], arg))) throw new Fault('EXPR_TYPE'); return args.some((arg) => arg.kind === 'decimal') && args.every(numeric) ? { kind: 'decimal' } : args[0]; }
function compatible(a: TypeSpec, b: TypeSpec): boolean { return a.kind === b.kind || (numeric(a) && numeric(b)) || (a.kind === 'array' && b.kind === 'array' && a.item === b.item); }
function numeric(type: TypeSpec): boolean { return type.kind === 'integer' || type.kind === 'decimal'; }
function scalarType(type: TypeSpec): boolean { return scalar(type.kind); }
function scalar(type: unknown): type is ScalarType { return ['text', 'integer', 'decimal', 'boolean', 'date', 'time', 'dateTime', 'choice'].includes(type as string); }
function definitionType(definition: FieldDefinition): TypeSpec { if (definition.type === 'list') return { kind: 'list', fields: toMap(definition.itemFields ?? []) }; if (definition.type === 'array') { if (!definition.itemType || !scalar(definition.itemType)) throw new Fault('EXPR_TYPE'); return { kind: 'array', item: definition.itemType }; } return { kind: definition.type }; }
function toMap(definitions: FieldDefinition[]): Map<string, FieldDefinition> { return new Map(definitions.map((definition) => [definition.id, definition])); }
function environment(definitions: FieldDefinition[]): CompileEnvironment { const known = new Set<string>(); const walk = (items: FieldDefinition[]) => items.forEach((item) => { known.add(item.id); if (item.itemFields) walk(item.itemFields); }); walk(definitions); return { root: toMap(definitions), items: [], known }; }
function isObject(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isReference(node: unknown): boolean { return isObject(node) && isObject(node.ref); }
function codeOf(error: unknown): string { return error instanceof Fault ? error.code : 'EXPR_SHAPE'; }
function unknown(reason: 'UNAVAILABLE_OPERAND' | 'UNKNOWN_CONDITION' | 'UNAVAILABLE_AGGREGATE_ITEM'): InternalResult { return { state: 'unknown', reason }; }
function available(type: ValueType, value: unknown, item?: ScalarType): InternalResult { return { state: 'available', value: { type, value, item } }; }
function mapAvailable(result: InternalResult, transform: (value: InternalValue) => InternalResult): InternalResult { return result.state === 'available' ? transform(result.value) : result; }
function strict(args: any[], state: RuntimeState, evaluate: (argument: any) => InternalResult): { state: 'available'; value: InternalValue[] } | Exclude<InternalResult, { state: 'available' }> { let unavailable: Exclude<InternalResult, { state: 'available' }> | undefined; const values: InternalValue[] = []; for (const argument of args) { const result = evaluate(argument); if (result.state === 'error') return result; if (result.state === 'unknown') unavailable = result; else values.push(result.value); } return unavailable ?? { state: 'available', value: values }; }
function literalValue(literal: any): InternalValue { if (literal.type === 'array') return { type: 'array', item: literal.itemType, value: literal.value.map((value: unknown) => rawScalar(literal.itemType, value)) }; return { type: literal.type, value: rawScalar(literal.type, literal.value) }; }
function rawScalar(type: ValueType, value: any): unknown { if (type === 'integer') return BigInt(value); if (type === 'decimal') return ExactDecimal.parse(value); return value; }
function validateAnswerRecord(definitions: FieldDefinition[], answers: Record<string, AnswerCell>): void {
  for (const definition of definitions) {
    const cell = answers[definition.id];
    if (!cell) continue;
    if (cell.type !== definition.type || typeof cell.applicable !== 'boolean' || !STATUSES.has(cell.status)) throw new Fault('INVALID_LITERAL');
    if (cell.status !== 'answered' || cell.value === undefined) continue;
    if (definition.type === 'array') {
      if (!definition.itemType || cell.itemType !== definition.itemType || !Array.isArray(cell.value)) throw new Fault('INVALID_LITERAL');
      for (const value of cell.value) validateAnswerScalar(definition.itemType, value);
      continue;
    }
    if (definition.type === 'list') {
      const items = (cell.value as any)?.items;
      if (!Array.isArray(items)) throw new Fault('INVALID_LITERAL');
      for (const item of items) { if (!isObject(item) || !isObject(item.fields)) throw new Fault('INVALID_LITERAL'); validateAnswerRecord(definition.itemFields ?? [], item.fields); }
      continue;
    }
    if (definition.type === 'object') { if (!isObject(cell.value)) throw new Fault('INVALID_LITERAL'); continue; }
    validateAnswerScalar(definition.type, cell.value);
  }
}
function validateAnswerScalar(type: ScalarType, value: unknown): void {
  if (type === 'integer') { if (typeof value !== 'string' || !INTEGER.test(value)) throw new Fault('INTEGER_ENCODING'); const parsed = BigInt(value); if (parsed < MIN_INT64 || parsed > MAX_INT64) throw new Fault('INTEGER_RANGE'); return; }
  // Expression literals retain the contract's input-decimal grammar, including
  // EXPR-081's -0.000. Answer wire values are final canonical values and must
  // reject negative zero before ExactDecimal normalizes it to zero.
  if (type === 'decimal') { if (negativeZeroWire(value)) throw new Fault('INVALID_LITERAL'); ExactDecimal.parse(value).assertFinal(); return; }
  if (type === 'text' || type === 'choice') { if (typeof value !== 'string') throw new Fault('INVALID_LITERAL'); return; }
  if (type === 'boolean') { if (typeof value !== 'boolean') throw new Fault('INVALID_LITERAL'); return; }
  if (type === 'date') { if (!validDate(value)) throw new Fault('INVALID_LITERAL'); return; }
  if (type === 'time') { if (typeof value !== 'string' || !TIME.test(value)) throw new Fault('INVALID_LITERAL'); return; }
  if (!isObject(value) || Object.keys(value).length !== 2 || typeof value.instant !== 'string' || typeof value.timeZone !== 'string' || !validInstant(value.instant) || !validZone(value.timeZone)) throw new Fault('INVALID_LITERAL');
}
function negativeZeroWire(value: unknown): boolean { return typeof value === 'string' && /^-0(?:\.0+)?$/.test(value); }
function answerValue(cell: AnswerCell): InternalValue { if (cell.type === 'array') return { type: 'array', item: (cell as AnswerCell & { itemType: ScalarType }).itemType, value: (cell.value as unknown[]).map((value) => rawScalar((cell as AnswerCell & { itemType: ScalarType }).itemType, value)) }; if (cell.type === 'list') return { type: 'list', value: cell.value }; return { type: cell.type, value: rawScalar(cell.type, cell.value) }; }
function integer(value: InternalValue): bigint { if (value.type !== 'integer') throw new Fault('EXPR_TYPE'); return value.value as bigint; }
function decimal(value: InternalValue): ExactDecimal { if (value.type === 'integer') return ExactDecimal.integer(value.value as bigint); if (value.type === 'decimal') return value.value as ExactDecimal; throw new Fault('EXPR_TYPE'); }
function bool(value: InternalValue): boolean { if (value.type !== 'boolean') throw new Fault('EXPR_TYPE'); return value.value as boolean; }
function compare(a: InternalValue, b: InternalValue): number { if (a.type === 'integer' || a.type === 'decimal') return decimal(a).compare(decimal(b)); const av: string = a.type === 'dateTime' ? instantKey((a.value as any).instant) : a.value as string; const bv: string = b.type === 'dateTime' ? instantKey((b.value as any).instant) : b.value as string; return av < bv ? -1 : av > bv ? 1 : 0; }
function instantKey(value: string): string { const [whole, fraction = ''] = value.slice(0, -1).split('.'); return `${whole}.${fraction.padEnd(9, '0')}`; }
function external(result: InternalResult, outputType?: TypeSpec): ExpressionResult { if (result.state !== 'available') return result; let { type, value, item } = result.value; if (outputType?.kind === 'decimal' && type === 'integer') { type = 'decimal'; value = ExactDecimal.integer(value as bigint); } if (type === 'integer') return { state: 'available', type, value: (value as bigint).toString() }; if (type === 'decimal') return { state: 'available', type, value: (value as ExactDecimal).canonical() }; if (type === 'array') return { state: 'available', type, value: (value as unknown[]).map((entry) => item === 'integer' ? (entry as bigint).toString() : item === 'decimal' ? (entry as ExactDecimal).canonical() : entry) }; return { state: 'available', type, value }; }
function validDate(value: unknown): value is string { if (typeof value !== 'string') return false; const match = DATE.exec(value); if (!match) return false; const [year, month, day] = match.slice(1).map(Number); return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month); }
function validInstant(value: string): boolean { if (!INSTANT.test(value)) return false; return validDate(value.slice(0, 10)) && !Number.isNaN(Date.parse(value)); }
function validZone(value: string): boolean { return PINNED_TIMEZONES.has(value); }
function dayOrdinal(value: string): number { const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); const day = Number(value.slice(8, 10)); return daysBeforeYear(year) + daysBeforeMonth(year, month) + day - 1; }
function dateAdd(date: string, days: bigint): string { const ordinal = BigInt(dayOrdinal(date)) + days; const maximum = BigInt(dayOrdinal('9999-12-31')); if (ordinal < 0n || ordinal > maximum) throw new Fault('DATE_RANGE'); return dateAtOrdinal(Number(ordinal)); }
function ageYears(birth: string, asOf: string): number { if (asOf < birth) throw new Fault('DATE_RANGE'); const [by, bm, bd] = birth.split('-').map(Number); const [ay, am, ad] = asOf.split('-').map(Number); let anniversaryMonth = bm; let anniversaryDay = bd; if (bm === 2 && bd === 29 && !leap(ay)) { anniversaryMonth = 3; anniversaryDay = 1; } return ay - by - (am < anniversaryMonth || (am === anniversaryMonth && ad < anniversaryDay) ? 1 : 0); }
function leap(year: number): boolean { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
function daysInMonth(year: number, month: number): number { return month === 2 ? (leap(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31; }
function daysBeforeYear(year: number): number { const prior = year - 1; return prior * 365 + Math.floor(prior / 4) - Math.floor(prior / 100) + Math.floor(prior / 400); }
function daysBeforeMonth(year: number, month: number): number { let days = 0; for (let current = 1; current < month; current++) days += daysInMonth(year, current); return days; }
function dateAtOrdinal(ordinal: number): string { let year = Math.floor(ordinal / 365.2425) + 1; while (daysBeforeYear(year + 1) <= ordinal) year++; while (daysBeforeYear(year) > ordinal) year--; let remaining = ordinal - daysBeforeYear(year); let month = 1; while (remaining >= daysInMonth(year, month)) { remaining -= daysInMonth(year, month++); } return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${(remaining + 1).toString().padStart(2, '0')}`; }
