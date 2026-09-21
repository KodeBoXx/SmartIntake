import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const baseUrl = process.env.M7_REAL_ORACLE_URL;
const workspaceId = process.env.M7_REAL_ORACLE_WORKSPACE;
const email = process.env.M7_REAL_ORACLE_EMAIL;
const password = process.env.M7_REAL_ORACLE_PASSWORD;

/**
 * This is intentionally a live-environment check: it has no request routes, fixture
 * imports, seeded package mutations, or fulfilled command responses. Set all four
 * M7_REAL_ORACLE_* variables for an isolated authenticated backend before running it.
 */
test.describe('M7 real visual authoring oracle', () => {
  test.skip(!baseUrl || !workspaceId || !email || !password, 'requires an isolated real authoring backend');

  test('persists a compiler-approved thirty-field browser package', async ({ page }) => {
    await page.goto(`${baseUrl}/sign-in`);
    await page.getByRole('textbox', { name: 'Email' }).fill(email!);
    await page.getByRole('textbox', { name: 'Password' }).fill(password!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Forms' })).toBeVisible();

    // The normal new-form screen creates a canonical draft; Author opens its M7 UI.
    await page.goto(`${baseUrl}/workspaces/${encodeURIComponent(workspaceId!)}/forms/new`);
    await page.getByRole('button', { name: 'Author' }).click();
    await expect(page.getByTestId('authoring-page')).toBeVisible();

    // Each add creates three canonical patches plus required locale message patches.
    // Keep every real command batch below the server's 100-command limit.
    for (const additions of [6, 6, 6, 6, 4]) {
      for (let index = 0; index < additions; index++) await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('Canonical draft saved.')).toBeVisible();
    }

    const route = new URL(page.url()).pathname.match(/^\/workspaces\/([^/]+)\/forms\/([^/]+)\/drafts\/([^/]+)\/author/);
    expect(route).not.toBeNull();
    const definition = await page.evaluate(async ([workspace, form, draft]) => {
      const response = await fetch(`/v1/workspaces/${workspace}/forms/${form}/authoring/${draft}`);
      if (!response.ok) throw new Error(`Authoring document request failed: ${response.status}`);
      return (await response.json()).definition;
    }, route!.slice(1));

    expect(definition.data.fields).toHaveLength(30);
    // This is the actual persisted backend package, retained only as local acceptance evidence.
    writeFileSync('/var/tmp/smartintake-real-browser-30-field-package.json', JSON.stringify(definition, null, 2));
  });
});
