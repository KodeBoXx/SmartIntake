import { expect, test } from '@playwright/test';

const definition = { formKey: 'clinical-history-intake', title: 'Clinical history intake', pages: [{ id: 'page-1', title: 'About you', fields: [{ id: 'full-name', label: 'Full name', type: 'text', required: true, constraints: { minLength: 0, maxLength: 120 } }] }] };

test('M1 author, save, publish, respondent, and response administration remain reachable', async ({ page }) => {
  await page.route('**/v1/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/auth/bootstrap')) return json({ staffSession: 'staff-token' });
    if (path.endsWith('/workspaces/local/forms') && request.method() === 'GET') return json([]);
    if (path.endsWith('/workspaces/local/forms') && request.method() === 'POST') return json({ id: 'form-1', draftId: 'form-1', revision: 1, definition });
    if (path.endsWith('/drafts/form-1') && request.method() === 'PUT') return json({ revision: 2, definition, diagnostics: [] });
    if (path.endsWith('/releases')) return json({ releaseId: 'release-1', version: 1, shareId: 'share-1', status: 'PUBLISHED' });
    if (path.endsWith('/public/forms/form-1/sessions')) return json({ sessionId: 'session-1', respondentSession: 'respondent-token', revision: 1 });
    if (path.endsWith('/sessions/session-1') && request.method() === 'PATCH') return json({ acceptedRevision: 2 });
    if (path.endsWith('/sessions/session-1/submissions')) return json({ receiptId: 'receipt-1' });
    if (path.endsWith('/workspaces/local/submissions') && request.method() === 'GET') return json([{ id: 'submission-1', submittedAt: '2026-09-19T00:00:00Z' }]);
    if (path.endsWith('/submissions/submission-1')) return json({ id: 'submission-1', receiptId: 'receipt-1' });
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.goto('/catalog/builder');
  await expect(page.getByRole('button', { name: 'Author' })).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Form published.')).toBeVisible();
  await page.getByRole('button', { name: 'Public preview' }).click();
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Response received.')).toBeVisible();
  await page.getByRole('button', { name: 'Author' }).click();
  await page.getByRole('button', { name: 'Response admin' }).click();
  await page.getByText('submission-1').click();
  await expect(page.getByText('Authorized response detail')).toBeVisible();
});
