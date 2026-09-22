import { expect, test } from '@playwright/test';

const sessionId = '33333333-3333-4333-8333-333333333333';
const token = '44444444-4444-4444-8444-444444444444';

test('renders nested composite rows with stable row-path mutations', async ({ page }) => {
  const definition = { defaultLocale: 'en', data: { fields: [{ id: 'visits', type: 'list', itemSchema: { fields: [{ id: 'details', type: 'object', fields: [{ id: 'notes', type: 'list', itemSchema: { fields: [{ id: 'comment', type: 'text' }] } }] }] } }] }, flow: { phases: [{ pages: [{ id: 'page', titleKey: 'page', sections: [{ nodes: [{ fieldId: 'visits' }] }] }] }] }, translations: { en: { messages: { page: 'Visits' } } } };
  const comment = { status: 'answered', type: 'text', value: 'before' };
  const notes = { status: 'answered', type: 'list', value: { items: [{ itemId: 'note-a', fields: { comment } }] } };
  const details = { status: 'answered', type: 'object', value: { fields: { notes } } };
  const answers = { visits: { status: 'answered', type: 'list', value: { items: [{ itemId: 'visit-a', fields: { details } }] }, provenance: { source: 'respondent', changedAt: '2026-09-22T00:00:00Z' } } };
  await page.route('**/v1/public/forms/composite/sessions', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ sessionId, respondentSession: token, revision: 0, release: definition, answers, status: 'DRAFT' }) }));
  await page.route(`**/v1/sessions/${sessionId}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      const operation = route.request().postDataJSON().operations[0];
      expect({ fieldId: operation.fieldId, rowPath: operation.rowPath }).toEqual({ fieldId: 'comment', rowPath: [{ listFieldId: 'visits', itemId: 'visit-a' }, { listFieldId: 'notes', itemId: 'note-a' }] });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ acceptedRevision: 1, answers, invalidInputs: [], reachablePageIds: ['page'], requiredCount: 0, completedRequiredCount: 0 }) });
    } else await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessionId, revision: 0, definition, answers, status: 'DRAFT', invalidInputs: [] }) });
  });
  await page.goto('/f/composite');
  await page.getByRole('button', { name: 'Start form' }).click();
  await expect(page.getByTestId('dynamic-matrix-control').first()).toBeVisible();
  await page.locator('[data-row-path="visits:visit-a/notes:note-a"] input').fill('after');
});
