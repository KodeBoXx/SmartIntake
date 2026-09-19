import { ExpressionEngine } from './expression-engine';
import { EXPRESSION_TEST_MODE_FLAG, EXPRESSION_TEST_SEAM } from './expression-test-mode';

type ExpressionTestWindow = Window & {
  [EXPRESSION_TEST_MODE_FLAG]?: boolean;
  [EXPRESSION_TEST_SEAM]?: ExpressionEngine;
};

/** Installs the evaluator only for a browser explicitly prepared by a test. */
export function installExpressionTestSeam(browserWindow: ExpressionTestWindow): void {
  if (browserWindow[EXPRESSION_TEST_MODE_FLAG] === true) {
    browserWindow[EXPRESSION_TEST_SEAM] = new ExpressionEngine();
  }
}
