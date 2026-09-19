import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type Vector = { id: string; phase: 'compile' | 'evaluate'; expression: unknown; expected: unknown; [key: string]: unknown };

const corpusPath = resolve(process.cwd(), '../docs/source-handoff/smart-form-builder-lite-prd-v1.1/expression-contract.json');
const resultPath = resolve(process.cwd(), 'test-results/m3-expression-vectors.json');
const corpusBytes = readFileSync(corpusPath);
const corpus = JSON.parse(corpusBytes.toString()) as { operators: { name: string }[]; vectors: Vector[] };

test('executes every frozen expression contract vector in Chromium', async ({ page, browserName }) => {
  expect(browserName).toBe('chromium');
  expect(corpus.vectors).toHaveLength(101);
  expect(new Set(corpus.vectors.map((vector) => vector.id)).size).toBe(101);
  expect(corpus.operators).toHaveLength(34);

  await page.goto('/');
  await page.waitForFunction(() => typeof (window as any).__smartIntakeExpression?.evaluateVector === 'function');
  const registeredOperators = await page.evaluate(() => (window as any).__smartIntakeExpression.operatorNames());
  expect(registeredOperators).toEqual(corpus.operators.map((operator) => operator.name));
  const results = await page.evaluate((vectors) => vectors.map((vector: any) => ({
    id: vector.id,
    phase: vector.phase,
    expected: vector.expected,
    actual: vector.phase === 'compile'
      ? (window as any).__smartIntakeExpression.compile(vector.expression, vector.fieldDefinitions)
      : (window as any).__smartIntakeExpression.evaluateVector(vector),
  })), corpus.vectors);
  const failures = results.filter((result: any) => JSON.stringify(result.actual) !== JSON.stringify(result.expected));
  const output = {
    runner: 'smart-intake-browser-expression-v1',
    browser: browserName,
    sourceHandoff: 'docs/source-handoff/smart-form-builder-lite-prd-v1.1/expression-contract.json',
    sourceSha256: createHash('sha256').update(corpusBytes).digest('hex'),
    vectorsDiscovered: corpus.vectors.length,
    operatorsDiscovered: registeredOperators,
    passed: results.length - failures.length,
    failed: failures.length,
    results: results.map(({ id, phase, actual }: any) => ({ id, phase, actual })),
  };
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`);
  expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
});
