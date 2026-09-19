import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import corpus from './m5-route-corpus.json';
import uiTotal from '../../docs/acceptance/v1.1/denominators/ui-total.json';
import uiStaffTotal from '../../docs/acceptance/v1.1/denominators/ui-staff-total.json';

type Shell = 'auth' | 'staff' | 'public' | 'not-found';
const shellSelector: Record<Shell, string> = { auth: '[data-testid="auth-page"]', staff: '[data-testid="staff-shell"]', public: '[data-testid="public-shell"]', 'not-found': '[data-testid="not-found"]' };

function shellFor(route: string): Shell {
  if (route === '/sign-in' || route === '/setup') return 'auth';
  if (route.startsWith('/f/') || route.startsWith('/sessions/')) return 'public';
  if (route === '/not-found') return 'not-found';
  return 'staff';
}

function materializeRequirementRoute(route: string): string {
  return route.replace(/\{[^}]+}/g, 'demo');
}

function materializeAngularTemplate(template: string): string {
  return template.replace(/:[^/]+/g, 'demo');
}

async function waitForLazyPage(page: Page, shell: Shell): Promise<void> {
  await expect(page.locator(shellSelector[shell])).toBeVisible();
  if (shell === 'not-found') return;
  await expect(page.locator('h1, h2').first()).toBeVisible();
}

async function expectSemanticState(page: Page, shell: Shell, state: string): Promise<void> {
  const stateRootSelector: Record<Shell, string> = { auth: '[data-testid="auth-page"]', staff: '[data-testid="staff-page"]', public: '[data-testid="public-page"]', 'not-found': '[data-testid="not-found"]' };
  const root = page.locator(stateRootSelector[shell]);
  await expect(root).toHaveAttribute('data-state', state);
  await expect(root.getByTestId('state-evidence')).toHaveText(`State: ${state}`);
  if (shell === 'staff' && state === 'loading') await expect(root.getByText(/Loading .*…/)).toBeVisible();
  if (shell === 'staff' && ['empty', 'empty-or-no-access', 'denied', 'no-access', 'email-unavailable'].includes(state)) await expect(root.locator('cui-empty-state')).toBeVisible();
  if (shell === 'staff' && ['invalid', 'denied', 'no-access', 'expired', 'email-unavailable', 'conflict', 'throttled', 'error', 'stale', 'tombstone', 'pending'].includes(state)) await expect(root.locator('cui-alert')).toBeVisible();
  if (shell === 'staff' && ['loading', 'empty', 'empty-or-no-access', 'invalid', 'denied', 'no-access', 'expired', 'email-unavailable', 'no-side-effects', 'error', 'stale', 'tombstone', 'pending', 'conflict'].includes(state)) {
    const actions = root.getByRole('button', { name: /Create form|Save draft|View|Archive|Quick status|More actions/ });
    await expect(actions).toHaveCount(0);
  }
  if (shell === 'auth' && ['invalid', 'expired', 'denied', 'no-access', 'empty-or-no-access', 'email-unavailable', 'throttled'].includes(state)) {
    await expect(root.locator('cui-alert')).toBeVisible();
    await expect(root.getByLabel('Email')).toHaveCount(0);
    await expect(root.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  }
  if (shell === 'public' && ['closed', 'expired'].includes(state)) await expect(root.locator('cui-empty-state')).toBeVisible();
  if (shell === 'public' && state === 'loading') await expect(root.getByText('Loading the public form…')).toBeVisible();
  if (shell === 'public' && ['offline', 'stale', 'invalid', 'failed', 'pending', 'succeeded', 'acknowledgment'].includes(state)) await expect(root.locator('cui-alert')).toBeVisible();
  if (shell === 'public' && state === 'start') await expect(root.getByRole('button', { name: 'Start form' })).toBeVisible();
  if (shell === 'not-found') await expect(root.getByText(state === 'no-access' ? 'No access' : 'Page not found')).toBeVisible();
}

const semanticRoutes = uiTotal.members.flatMap((member) => member.states.split('/').map((state) => ({ id: member.title, path: `${materializeRequirementRoute(member.route)}?state=${state}`, state, shell: shellFor(member.route) })));
const staffCases = uiStaffTotal.members.flatMap((member) => member.required_states.map((state) => ({ screen: member.screen, state, path: `${materializeAngularTemplate(corpus.staffScreenTemplates[member.screen as keyof typeof corpus.staffScreenTemplates])}?state=${state}` })));
const axeCases = [
  { id: 'sign-in', path: '/sign-in?state=invalid', shell: 'auth' as const },
  // These immutable 0.0.1 components set aria-expanded on wrapper divs. Exclude
  // only those component roots; all remaining page nodes and axe rules still run.
  { id: 'catalog', path: '/workspaces/demo/forms?state=empty', shell: 'staff' as const, upstreamExclusions: ['cui-sidebar-shell footer', 'cui-header cui-icon-button > button', '.py-2 > cui-nav-item > button'] },
  { id: 'builder', path: '/workspaces/demo/forms/demo/drafts/demo?state=conflict', shell: 'staff' as const, upstreamExclusions: ['cui-sidebar-shell footer', 'cui-header cui-icon-button > button', '.py-2 > cui-nav-item > button'] },
  { id: 'denied staff no-access', path: '/workspaces/demo/submissions?state=no-access', shell: 'staff' as const, upstreamExclusions: ['cui-sidebar-shell footer', 'cui-header cui-icon-button > button', '.py-2 > cui-nav-item > button'] },
  { id: 'public form', path: '/sessions/demo?state=offline', shell: 'public' as const },
  { id: 'public review', path: '/sessions/demo/review?state=acknowledgment', shell: 'public' as const },
  { id: 'receipt', path: '/sessions/demo/receipt?state=succeeded', shell: 'public' as const },
];

test.describe('M5 routed Certinal shell', () => {
  for (const route of semanticRoutes) {
    test(`opens and reloads ${route.id} in ${route.state}`, async ({ page }) => {
      await page.goto(route.path);
      await waitForLazyPage(page, route.shell);
      await expectSemanticState(page, route.shell, route.state);
      if (route.shell === 'staff' && ['no-access', 'no-side-effects'].includes(route.state)) {
        await page.goto(`${route.path}&details=demo-form`);
        await waitForLazyPage(page, route.shell);
        await expect(page.locator('cui-drawer [role="dialog"]')).toHaveCount(0);
        await expect(page).not.toHaveURL(/details=/);
      }
      await page.reload();
      await waitForLazyPage(page, route.shell);
      await expectSemanticState(page, route.shell, route.state);
    });
  }

  test('preserves protected deep links through the M5 stub guard', async ({ page }) => {
    await page.goto('/workspaces/demo/forms?m5Auth=expired');
    await waitForLazyPage(page, 'auth');
    await page.getByRole('button', { name: 'Sign in again' }).click();
    await expect(page).toHaveURL(/\/workspaces\/demo\/forms/);
  });

  test('synchronizes every detail drawer close path and restores focus', async ({ page }) => {
    await page.goto('/workspaces/demo/submissions/demo');
    await waitForLazyPage(page, 'staff');
    const view = page.getByRole('button', { name: 'View' });
    await view.focus();
    await view.click();
    const drawer = page.locator('cui-drawer [role="dialog"]');
    await expect(drawer).toBeVisible();
    await expect(drawer).toBeFocused();
    await expect(page).toHaveURL(/details=demo-form/);
    await page.keyboard.press('Shift+Tab');
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page).not.toHaveURL(/details=/);
    await expect(view).toBeFocused();
  });

  test('preserves a single staff banner at the 900px breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/workspaces/demo/forms');
    await waitForLazyPage(page, 'staff');
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(1);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.reload();
    await waitForLazyPage(page, 'staff');
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(1);
    await expect(page.locator('cui-sidebar-shell')).toBeHidden();
  });

  test('keeps guarded M1 compatibility shell-less with its own viewport landmarks', async ({ page }) => {
    await page.goto('/catalog/builder');
    await expect(page.locator('[data-testid="staff-shell"]')).toHaveCount(0);
    await expect(page.locator('cui-app-shell')).toHaveCount(0);
    await expect(page.locator('header')).toHaveCount(1);
    await expect(page.locator('main')).toBeVisible();
  });

  for (const staffCase of staffCases) {
    test(`renders M5 staff screen ${staffCase.screen} in ${staffCase.state}`, async ({ page }) => {
      await page.goto(staffCase.path);
      const shell = staffCase.screen === 'sign-in' || staffCase.screen === 'setup' || staffCase.screen === 'activation' || staffCase.screen === 'recovery' ? 'auth' : 'staff';
      await waitForLazyPage(page, shell);
      await expectSemanticState(page, shell, staffCase.state);
      await expect(page.getByRole('heading', { name: new RegExp(staffCase.screen.replace(/-/g, ' '), 'i') }).first()).toBeVisible();
    });
  }

  for (const axeCase of axeCases) {
    test(`runs axe for ${axeCase.id}; automated evidence is not human accessibility acceptance`, async ({ page }) => {
      await page.goto(axeCase.path);
      await waitForLazyPage(page, axeCase.shell);
      // Staff shell chrome is verified by landmark/viewport tests. This audit is
      // intentionally scoped to the ready lazy page, with only immutable upstream
      // popover/dropdown roots excluded in the three affected staff cases.
      const axeTarget = shellSelector[axeCase.shell];
      const axe = new AxeBuilder({ page }).include(axeTarget);
      for (const selector of axeCase.upstreamExclusions ?? []) axe.exclude(selector);
      const results = await axe.analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
