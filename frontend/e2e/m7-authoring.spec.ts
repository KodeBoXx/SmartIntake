import { expect, test } from '@playwright/test';

const document = {
  formId: 'demo', draftId: 'draft', revision: 3, definition: { title: 'Employment intake', pages: [{ id: 'page-details', title: 'Details', fields: [{ id: 'field-name', label: 'Full name', type: 'text' }] }] }, packageHash: 'package-hash', diagnostics: [], history: [],
};
const base = '/workspaces/demo/forms/demo/drafts/draft/author';
let previewCalls = 0;

test.describe('M7 visual authoring', () => {
  test.beforeEach(async ({ page }) => {
    previewCalls = 0;
    await page.route('**/v1/auth/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticatedSession: { safeIdentity: { accountId: 'author-1', username: 'author@example.test', displayName: 'Author' }, organizations: [{ organizationId: 'org', name: 'Org', membershipState: 'active', organizationRoles: ['owner'], workspaces: [{ workspaceId: 'demo', name: 'Demo', roles: ['author'] }] }], currentOrganizationId: 'org', currentWorkspaceId: 'demo' } }) }));
    await page.route('**/v1/workspaces/demo/reusable-components', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 'address', key: 'postal-address', version: 2, status: 'ACTIVE', hash: 'component-hash', updatedAt: '2026-09-21T00:00:00Z', name: 'Postal address' }]) }));
    await page.route('**/v1/workspaces/demo/forms/demo/authoring/draft**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/theme')) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ revision: 3, theme: { themeKey: 'Certinal', tokens: {} }, locks: ['/tokens/accent'], preflight: [{ code: 'contrast', severity: 'warning', message: 'Review contrast.' }] }) }); return; }
      if (path.endsWith('/content')) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ revision: 3, guidance: { narration: 'Complete the fields.' }, translations: { en: { guidance: 'Use a legal name.' }, hi: {}, ar: {} }, localeCompleteness: { en: { present: true, complete: true }, hi: { present: true, complete: false }, ar: { present: true, complete: false } } }) }); return; }
      if (path.endsWith('/history')) { await route.fulfill({ contentType: 'application/json', body: '[]' }); return; }
      if (path.endsWith('/comments') || path.endsWith('/presence')) { await route.fulfill({ contentType: 'application/json', body: '[]' }); return; }
      if (path.endsWith('/preview')) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mode: 'synthetic', packageHash: 'package-hash', diagnostics: [], syntheticAnswers: { 'field-name': 'Ada Lovelace' }, effects: { sessions: 0, submissions: 0, email: 0, webhooks: 0, providers: 0 } }) }); return; }
      if (path.endsWith('/imports/validate')) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidateId: 'candidate-1', digest: 'digest', baseRevision: 3, state: 'VALID', diagnostics: [] }) }); return; }
      if (path.endsWith('/imports/commit') || path.endsWith('/commands') || path.endsWith('/undo') || path.endsWith('/redo') || path.endsWith('/resolve')) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify(document) }); return; }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(document) });
    });
    await page.route('**/v1/workspaces/demo/forms/demo/authoring/draft/preview', async (route) => {
      previewCalls++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'synthetic', packageHash: 'package-hash', diagnostics: [], syntheticAnswers: { 'field-name': 'Ada Lovelace' }, effects: { sessions: 0, submissions: 0, email: 0, webhooks: 0, providers: 0 } }) });
    });
    await page.route('**/v1/workspaces/demo/forms/demo/authoring/draft/theme', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: 3, theme: { themeKey: 'Certinal', tokens: {} }, locks: ['/tokens/accent'], preflight: [{ code: 'contrast', severity: 'warning', message: 'Review contrast.' }] }) }));
    await page.route('**/v1/workspaces/demo/forms/demo/authoring/draft/content', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: 3, guidance: { narration: 'Complete the fields.' }, translations: { en: { guidance: 'Use a legal name.' }, hi: {}, ar: {} }, localeCompleteness: { en: { present: true, complete: true }, hi: { present: true, complete: false }, ar: { present: true, complete: false } } }) }));
  });

  test('renders the canonical hierarchy, keyboard focus and local 100-command history', async ({ page }) => {
    await page.goto(base);
    await expect(page.getByTestId('authoring-page')).toBeVisible();
    await expect(page.locator('[data-authoring-id="phase-intake"]')).toBeVisible();
    await expect(page.locator('[data-authoring-id="page-details"]')).toBeVisible();
    await expect(page.locator('[data-authoring-id="section-page-details"]')).toBeVisible();
    const field = page.locator('[data-authoring-id="field-name"]');
    await field.focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('[data-authoring-id="section-page-details"]')).toBeFocused();
    for (let index = 0; index < 101; index++) await page.getByRole('button', { name: 'Add phase' }).click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await page.keyboard.press('Control+z');
  });

  test('isolates synthetic preview and presents reuse, theme, translation and RTL affordances', async ({ page }) => {
    const forbidden: string[] = [];
    page.on('request', (request) => { if (/\/sessions|\/releases|\/email|\/webhook|speech/i.test(new URL(request.url()).pathname)) forbidden.push(request.url()); });
    await page.goto(`${base}/preview`);
    await page.getByRole('button', { name: 'Run preview' }).click();
    await expect(page.getByText(/Preview completed through the authoring endpoint/i)).toBeVisible();
    expect(previewCalls).toBe(1);
    expect(forbidden).toEqual([]);
    await page.goto(`${base}/components`);
    await expect(page.getByText('Postal address')).toBeVisible();
    await page.goto(`${base}/theme`);
    await expect(page.getByText('Locked tokens: /tokens/accent')).toBeVisible();
    await page.goto(`${base}/content`);
    await page.getByRole('button', { name: 'العربية' }).click();
    await expect(page.getByTestId('authoring-page')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText(/Speech is unavailable/i)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('authoring-page')).toBeVisible();
  });
});
