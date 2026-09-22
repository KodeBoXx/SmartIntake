import { expect, test } from '@playwright/test';

const sessionId = '11111111-1111-4111-8111-111111111111';
const token = '22222222-2222-4222-8222-222222222222';
const definition = {
  defaultLocale: 'en',
  data: { fields: [
    { id: 'name', type: 'text', constraints: { maxLength: 80 } },
    { id: 'age', type: 'integer', allowUnknown: true },
  ] },
  flow: { phases: [{ pages: [{ id: 'about', titleKey: 'about', sections: [{ nodes: [{ fieldId: 'name' }, { fieldId: 'age' }] }] }] }] },
  translations: { en: { messages: { about: 'About you' } } },
};

/** Public runtime uses only respondent bearer headers and canonical server projections. */
test('starts a respondent session, sends revisioned scalar autosaves, and enters review', async ({ page }) => {
  let revision = 0;
  await page.route('**/v1/public/forms/demo/sessions', async (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
    sessionId, respondentSession: token, revision, release: definition, answers: {}, status: 'DRAFT',
  }) }));
  await page.route(`**/v1/sessions/${sessionId}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      const request = route.request();
      expect(request.headers()['x-respondent-session']).toBe(token);
      const body = request.postDataJSON();
      expect(body.clientMutationId).toMatch(/^save-/);
      expect(body.baseRevision).toBe(revision);
      revision += 1;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ acceptedRevision: revision, answers: { name: { status: 'answered', type: 'text', value: 'Ada', provenance: { source: 'respondent', changedAt: '2026-09-22T00:00:00Z' } } }, invalidInputs: [], reachablePageIds: ['about'], requiredCount: 0, completedRequiredCount: 0 }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessionId, revision, definition, answers: {}, status: 'DRAFT', invalidInputs: [] }) });
  });
  await page.route(`**/v1/sessions/${sessionId}/validate`, async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ errors: [], review: { reviewGates: [] }, reviewDigest: 'sha256:review' }) }));

  await page.goto('/f/demo');
  await page.getByRole('button', { name: 'Start form' }).click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`));
  await page.locator('#name').fill('Ada');
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByTestId('review-response').click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}/review$`));
  await expect(page.getByTestId('public-review')).toBeVisible();
});
