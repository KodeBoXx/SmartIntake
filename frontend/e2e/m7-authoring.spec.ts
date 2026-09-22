import { expect, test } from '@playwright/test';
const document = {
  formId: 'demo', draftId: 'draft', revision: 3, definition: {
    titleKey: 'form.title', defaultLocale: 'en',
    data: { fields: [{ id: 'field-name', key: 'field-name', type: 'text', labelKey: 'field-name.label' }] },
    flow: { phases: [{ id: 'phase-intake', titleKey: 'phase-intake.label', pages: [{ id: 'page-details', titleKey: 'page-details.label', sections: [{ id: 'section-page-details', titleKey: 'section-page-details.label', nodes: [{ id: 'field-name', kind: 'question', fieldId: 'field-name', control: 'shortText' }] }] }] }] },
    translations: { en: { direction: 'ltr', messages: { 'form.title': 'Employment intake', 'phase-intake.label': 'Intake', 'page-details.label': 'Details', 'section-page-details.label': 'Questions', 'field-name.label': 'Full name' } } },
    expressions: {},
  }, packageHash: 'package-hash', diagnostics: [], history: [],
};
const content = {
  revision: 3, guidance: { guidance: { id: 'guidance', messageKey: 'guidance.message' } },
  translations: {
    en: { direction: 'ltr', messages: { 'guidance.message': 'Use a legal name.' } },
    hi: { direction: 'ltr', messages: {} },
    ar: { direction: 'rtl', messages: {} },
  },
  localeCompleteness: { en: { present: true, complete: true }, hi: { present: true, complete: false }, ar: { present: true, complete: false } },
};
const base = '/workspaces/demo/forms/demo/drafts/draft/author';
let previewCalls = 0;
let currentDocument = document;
let commandBodies: Array<{ commands?: Array<{ op?: string; path?: string }>; definition?: unknown }> = [];

test.describe('M7 visual authoring', () => {
  test.beforeEach(async ({ page }) => {
    previewCalls = 0;
    currentDocument = document;
    commandBodies = [];
    await page.route('**/v1/auth/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticatedSession: { safeIdentity: { accountId: 'author-1', username: 'author@example.test', displayName: 'Author' }, organizations: [{ organizationId: 'org', name: 'Org', membershipState: 'active', organizationRoles: ['owner'], workspaces: [{ workspaceId: 'demo', name: 'Demo', roles: ['author'] }] }], currentOrganizationId: 'org', currentWorkspaceId: 'demo' } }) }));
    await page.route('**/v1/workspaces/demo/reusable-components', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 'address', key: 'postal-address', version: 2, status: 'ACTIVE', hash: 'component-hash', updatedAt: '2026-09-21T00:00:00Z', name: 'Postal address' }]) }));
    await page.route(/\/v1\/workspaces\/demo\/forms\/demo\/authoring\/draft(?:\/.*)?$/, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/theme')) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ revision: 3, theme: { themeKey: 'Certinal', version: '1', tokens: {} }, locks: ['/tokens/accent'], preflight: [{ code: 'contrast', severity: 'warning', message: 'Review contrast.' }] }) }); return; }
      if (path.endsWith('/content')) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify(content) }); return; }
      if (path.endsWith('/history')) { await route.fulfill({ contentType: 'application/json', body: '[]' }); return; }
      if (path.endsWith('/comments') || path.endsWith('/presence')) { await route.fulfill({ contentType: 'application/json', body: '[]' }); return; }
      if (path.endsWith('/preview')) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mode: 'synthetic', packageHash: 'package-hash', diagnostics: [], syntheticAnswers: { 'field-name': 'Ada Lovelace' }, effects: { sessions: 0, submissions: 0, email: 0, webhooks: 0, providers: 0 } }) }); return; }
      if (path.endsWith('/imports/validate')) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidateId: 'candidate-1', digest: 'digest', baseRevision: 3, state: 'VALID', diagnostics: [] }) }); return; }
      if (path.endsWith('/commands')) {
        const body = route.request().postDataJSON() as { commands?: Array<{ op?: string; path?: string }>; definition?: unknown };
        commandBodies.push(body);
        currentDocument = { ...currentDocument, revision: currentDocument.revision + 1, definition: body.definition ?? currentDocument.definition };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(currentDocument) });
        return;
      }
      if (path.endsWith('/imports/commit') || path.endsWith('/undo') || path.endsWith('/redo') || path.endsWith('/resolve')) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify(currentDocument) }); return; }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(currentDocument) });
    });
    await page.route('**/v1/workspaces/demo/forms/demo/authoring/draft/preview', async (route) => {
      previewCalls++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'synthetic', packageHash: 'package-hash', diagnostics: [], syntheticAnswers: { 'field-name': 'Ada Lovelace' }, effects: { sessions: 0, submissions: 0, email: 0, webhooks: 0, providers: 0 } }) });
    });
    await page.route('**/v1/workspaces/demo/forms/demo/authoring/draft/theme', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: 3, theme: { themeKey: 'Certinal', version: '1', tokens: {} }, locks: ['/tokens/accent'], preflight: [{ code: 'contrast', severity: 'warning', message: 'Review contrast.' }] }) }));
    await page.route('**/v1/workspaces/demo/forms/demo/authoring/draft/content', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(content) }));
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
    // Dispatch genuine browser click events without Playwright's repeated actionability
    // wait as the tree intentionally grows beyond the 100-command history boundary.
    for (let index = 0; index < 101; index++) await page.getByRole('button', { name: 'Add phase' }).dispatchEvent('click');
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

  test('removes a newly saved canonical field after the server reprojects its stable placement', async ({ page }) => {
    await page.goto(base);
    await page.locator('[data-authoring-id="section-page-details"]').click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const canvas = page.locator('.authoring__canvas');
    await expect(canvas.getByRole('heading', { name: 'New field', exact: true, level: 3 })).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Draft revision 4 · Stable canonical IDs')).toBeVisible();

    // Locate the post-save card again. Holding the pre-save element reference hid
    // the real transition in the original manual walkthrough after Angular rerendered.
    const savedCard = canvas.getByRole('heading', { name: 'New field', exact: true, level: 3 }).locator('xpath=ancestor::article[1]');
    await savedCard.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(canvas.getByRole('heading', { name: 'New field', exact: true, level: 3 })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save changes' }).click();

    expect(commandBodies).toHaveLength(2);
    expect(commandBodies[1].commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'remove', path: '/flow/phases/0/pages/0/sections/0/nodes/1' }),
      expect.objectContaining({ op: 'remove', path: '/data/fields/1' }),
    ]));
  });

  test('keeps all authoring panes inside the 1280px staff workspace', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(base);
    const workspace = page.getByRole('region', { name: 'Three pane form editor' });
    const outline = page.getByRole('complementary', { name: 'Form hierarchy' });
    const canvas = page.locator('.authoring__canvas');
    const inspector = page.getByRole('complementary', { name: 'Selected element inspector' });
    await expect(outline).toBeVisible();
    await expect(canvas).toBeVisible();
    await expect(inspector).toBeVisible();

    const layout = await workspace.evaluate((element) => {
      const panes = [element.querySelector('.authoring__outline'), element.querySelector('.authoring__canvas'), element.querySelector('.authoring__inspector')] as HTMLElement[];
      return {
        fits: element.scrollWidth <= element.clientWidth,
        inspectorRight: panes[2].getBoundingClientRect().right,
        ordered: panes[0].compareDocumentPosition(panes[1]) === Node.DOCUMENT_POSITION_FOLLOWING
          && panes[1].compareDocumentPosition(panes[2]) === Node.DOCUMENT_POSITION_FOLLOWING,
      };
    });
    expect(layout.fits).toBe(true);
    expect(layout.inspectorRight).toBeLessThanOrEqual(1280);
    expect(layout.ordered).toBe(true);
  });
});
