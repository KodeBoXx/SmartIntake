import { describe, expect, it } from 'vitest';
import { installExpressionTestSeam } from './expression-test-seam';
import { EXPRESSION_TEST_MODE_FLAG, EXPRESSION_TEST_SEAM } from './expression-test-mode';

describe('installExpressionTestSeam', () => {
  it('does not expose the evaluator unless the pre-bootstrap test flag is true', () => {
    const browserWindow = {} as Window;

    installExpressionTestSeam(browserWindow);

    expect((browserWindow as any)[EXPRESSION_TEST_SEAM]).toBeUndefined();
  });

  it('installs the evaluator for an explicitly activated browser test', () => {
    const browserWindow = { [EXPRESSION_TEST_MODE_FLAG]: true } as unknown as Window;

    installExpressionTestSeam(browserWindow);

    expect(typeof (browserWindow as any)[EXPRESSION_TEST_SEAM].evaluateVector).toBe('function');
  });
});
