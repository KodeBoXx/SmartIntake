import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { EXPRESSION_TEST_MODE_FLAG, EXPRESSION_TEST_SEAM } from '../src/app/expression/expression-test-mode';
import { PINNED_TIMEZONE_DATABASE } from '../src/app/expression/pinned-timezone-registry';

type Vector = { id: string; phase: 'compile' | 'evaluate'; expression: unknown; expected: unknown; [key: string]: unknown };

const corpusPath = resolve(process.cwd(), '../docs/source-handoff/smart-form-builder-lite-prd-v1.1/expression-contract.json');
const resultPath = resolve(process.cwd(), 'test-results/m3-expression-vectors.json');
const corpusBytes = readFileSync(corpusPath);
const corpus = JSON.parse(corpusBytes.toString()) as { operators: { name: string }[]; vectors: Vector[] };
const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(process.cwd(), '..'), encoding: 'utf8' }).trim();
const candidateTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: resolve(process.cwd(), '..'), encoding: 'utf8' }).trim();
function digestArtifact(artifact: Record<string, unknown>): string { const copy = { ...artifact }; delete copy.artifactSha256; return createHash('sha256').update(JSON.stringify(copy)).digest('hex'); }

test('does not expose the evaluator seam in an unprepared production browser', async ({ page }) => {
  await page.goto('/');

  expect(await page.evaluate((seam) => typeof (window as any)[seam], EXPRESSION_TEST_SEAM)).toBe('undefined');
});

test('executes every frozen expression contract vector in Chromium', async ({ page, browserName, browser }) => {
  expect(browserName).toBe('chromium');
  expect(corpus.vectors).toHaveLength(101);
  expect(new Set(corpus.vectors.map((vector) => vector.id)).size).toBe(101);
  expect(corpus.operators).toHaveLength(34);

  await page.addInitScript((flag) => { (window as any)[flag] = true; }, EXPRESSION_TEST_MODE_FLAG);
  await page.goto('/');
  await page.waitForFunction((seam) => typeof (window as any)[seam]?.evaluateVector === 'function', EXPRESSION_TEST_SEAM);
  const registeredOperators = await page.evaluate((seam) => (window as any)[seam].operatorNames(), EXPRESSION_TEST_SEAM);
  expect(registeredOperators).toEqual(corpus.operators.map((operator) => operator.name));
  const results = await page.evaluate(({ vectors, seam }) => vectors.map((vector: any) => ({
    id: vector.id,
    phase: vector.phase,
    expected: vector.expected,
    actual: vector.phase === 'compile'
      ? (window as any)[seam].compile(vector.expression, vector.fieldDefinitions)
      : (window as any)[seam].evaluateVector(vector),
  })), { vectors: corpus.vectors, seam: EXPRESSION_TEST_SEAM });
  const failures = results.filter((result: any) => JSON.stringify(result.actual) !== JSON.stringify(result.expected));
  const output = {
    runner: 'smart-intake-browser-expression-v1',
    browser: browserName,
    browserVersion: browser.version(),
    candidateCommit,
    candidateTree,
    executedAtUtc: new Date().toISOString(),
    invocation: 'playwright test e2e/expression-vectors.spec.ts',
    timezoneDatabase: PINNED_TIMEZONE_DATABASE,
    sourceHandoff: 'docs/source-handoff/smart-form-builder-lite-prd-v1.1/expression-contract.json',
    sourceSha256: createHash('sha256').update(corpusBytes).digest('hex'),
    vectorsDiscovered: corpus.vectors.length,
    operatorsDiscovered: registeredOperators,
    passed: results.length - failures.length,
    failed: failures.length,
    results: results.map(({ id, phase, actual }: any) => ({ id, phase, actual })),
  } as Record<string, unknown>;
  output.artifactSha256 = digestArtifact(output);
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`);
  expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
});
