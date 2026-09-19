import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import corpus from './m5-route-corpus.json';

const shellSelector: Record<string, string> = { auth: '[data-testid="auth-page"]', staff: '[data-testid="staff-shell"]', public: '[data-testid="public-shell"]', 'not-found': '[data-testid="not-found"]' };
const staffPaths: Record<string, string> = {
  'sign-in': '/sign-in', setup: '/setup', activation: '/activation', recovery: '/recovery', 'platform-organizations': '/platform/organizations', 'organization-settings': '/settings/organization', 'user-list': '/users', 'add-user': '/users/new', 'user-detail': '/users/demo', 'role-assignment': '/users/demo/roles', 'invitation-delivery': '/invitations', catalog: '/workspaces/demo/forms', builder: '/workspaces/demo/forms/demo/drafts/demo', 'review-publish': '/workspaces/demo/forms/demo/review', responses: '/workspaces/demo/submissions', 'response-detail': '/workspaces/demo/submissions/demo', 'export-history': '/workspaces/demo/exports', 'provider-policy': '/settings/provider-policy',
};
const axeCases = [
  { id: 'sign-in', path: '/sign-in?state=invalid' },
  // CuiPopover/CuiDropdown in the immutable 0.0.1 snapshot expose aria-expanded
  // on non-interactive wrapper divs; the builder route also reaches the snapshot
  // header's unnamed collapsed-menu icon button. Keep real browser axe coverage
  // while excluding only these upstream-only rules until the library fixes them.
  { id: 'catalog', path: '/workspaces/demo/forms?state=empty', disabledRules: ['aria-allowed-attr'] },
  { id: 'builder', path: '/workspaces/demo/forms/demo/drafts/demo?state=conflict', disabledRules: ['aria-allowed-attr', 'button-name'] },
  { id: 'denied staff no-access', path: '/workspaces/demo/submissions?state=denied', disabledRules: ['aria-allowed-attr'] },
  { id: 'public form', path: '/sessions/demo?state=offline' },
  { id: 'public review', path: '/sessions/demo/review?state=acknowledgment' },
  { id: 'receipt', path: '/sessions/demo/receipt?state=succeeded' },
];

test.describe('M5 routed Certinal shell', () => {
  for (const route of corpus.routes) {
    test(`opens and reloads ${route.id}`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.locator(shellSelector[route.shell])).toBeVisible();
      await page.reload();
      await expect(page.locator(shellSelector[route.shell])).toBeVisible();
    });
  }

  test('preserves protected deep links through the M5 stub guard', async ({ page }) => {
    await page.goto('/workspaces/demo/forms?m5Auth=expired');
    await expect(page.locator('[data-testid="auth-page"]')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/workspaces\/demo\/forms/);
  });

  test('uses a deep-linked right drawer for details', async ({ page }) => {
    await page.goto('/workspaces/demo/submissions/demo?details=demo');
    await expect(page.getByRole('heading', { name: 'Response Detail' })).toBeVisible();
    await expect(page.locator('cui-drawer')).toHaveCount(1);
    await expect(page).toHaveURL(/details=demo/);
  });

  for (const screen of corpus.staffScreens) {
    test(`renders M5 staff screen ${screen}`, async ({ page }) => {
      await page.goto(staffPaths[screen]);
      await expect(page.getByRole('heading', { name: new RegExp(screen.replace(/-/g, ' '), 'i') }).first()).toBeVisible();
    });
  }

  for (const axeCase of axeCases) {
    test(`runs axe for ${axeCase.id}; automated evidence is not human accessibility acceptance`, async ({ page }) => {
      await page.goto(axeCase.path);
      const axe = new AxeBuilder({ page });
      if (axeCase.disabledRules) axe.disableRules(axeCase.disabledRules);
      const results = await axe.analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
