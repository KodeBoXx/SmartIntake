import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const baseUrl = process.env.M7_REAL_ORACLE_URL;
const workspaceId = process.env.M7_REAL_ORACLE_WORKSPACE;
const email = process.env.M7_REAL_ORACLE_EMAIL;
const password = process.env.M7_REAL_ORACLE_PASSWORD;

/**
 * A live-only oracle. It has no routes, fixtures, database setup, fulfilled responses,
 * or direct package mutation. Every authored value below goes through a visible control.
 */
const FROZEN_CONTROLS = [
  'shortText', 'textarea', 'email', 'phone', 'url', 'identifier', 'integer', 'rating',
  'scale', 'amount', 'decimal', 'date', 'time', 'dateTime', 'yesNo', 'checkbox', 'radio',
  'dropdown', 'chips', 'ranking', 'address', 'contact', 'person', 'repeatingCards',
  'dynamicMatrix', 'fixedMatrix', 'fileUpload', 'drawing',
] as const;
const COMPOSITES = new Set(['address', 'contact', 'person', 'repeatingCards', 'dynamicMatrix', 'fixedMatrix']);
const ALL_OPERATORS = ['and', 'or', 'not', 'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'containsAll', 'exists', 'isAnswered', 'statusIs', 'add', 'subtract', 'multiply', 'divide', 'round', 'min', 'max', 'sum', 'count', 'any', 'all', 'concat', 'length', 'coalesce', 'if', 'dateDiffDays', 'ageYears', 'dateAddDays', 'today'] as const;

test.describe('M7 real visual authoring oracle', () => {
  test.skip(!baseUrl || !workspaceId || !email || !password, 'requires an isolated real authoring backend');

  test('persists the frozen visual package and has an independent compiler accept it', async ({ page }) => {
    await page.goto(`${baseUrl}/sign-in`);
    await page.getByRole('textbox', { name: 'Email' }).fill(email!);
    await page.getByRole('textbox', { name: 'Password' }).fill(password!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Forms' })).toBeVisible();

    await page.goto(`${baseUrl}/workspaces/${encodeURIComponent(workspaceId!)}/forms/new`);
    await page.getByRole('button', { name: 'Author' }).click();
    await expect(page.getByTestId('authoring-page')).toBeVisible();

    // The canonical starter has fld_name and fld_acknowledgment. Each additional
    // field is created, typed, and configured through the visual inspector, then
    // persisted before moving to the next browser action.
    for (const [index, control] of FROZEN_CONTROLS.entries()) {
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByLabel('Control').selectOption(control);
      await page.getByLabel('Stable integration key').fill(`frozen_${String(index + 1).padStart(2, '0')}`);
      if (COMPOSITES.has(control)) {
        await page.getByRole('button', { name: 'Add child field' }).click();
        await page.getByLabel('Nested child key').last().fill(`value_${index + 1}`);
        await page.getByLabel('Nested child label').last().fill(`Value ${index + 1}`);
      }
      if (control === 'radio' || control === 'dropdown' || control === 'chips' || control === 'ranking') {
        await page.getByLabel('Field options').fill('one: One\ntwo: Two');
      }
      if (control === 'fixedMatrix') await page.getByLabel('Fixed matrix rows').fill('row_one: Row one\nrow_two: Row two');
      if (control === 'integer' || control === 'decimal' || control === 'amount' || control === 'scale') {
        await page.getByLabel('Minimum constraint').fill('0');
        await page.getByLabel('Maximum constraint').fill('100');
      }
      await page.getByRole('button', { name: 'Apply field settings' }).click();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('Canonical draft saved.')).toBeVisible();
    }

    // A second visible placement of the canonical name field proves shared fields
    // retain one field definition while their placement identities stay distinct.
    await page.locator('[data-authoring-id="node_name"]').click();
    await page.getByLabel('Place existing field').selectOption('fld_name');
    await page.getByRole('button', { name: 'Place in selected section' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Canonical draft saved.')).toBeVisible();

    // All normative AST roots are authored from the operand controls. This deliberately
    // avoids JSON text entry and leaves the backend compiler as the only acceptance gate.
    await page.locator('[data-authoring-id="node_name"]').click();
    for (const operator of ALL_OPERATORS) {
      await page.getByLabel('Expression ID').fill(`frozen_${operator}`);
      await page.getByLabel('Operator').selectOption(operator);
      await page.getByRole('button', { name: 'Save expression' }).click();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('Canonical draft saved.')).toBeVisible();
    }

    const route = new URL(page.url()).pathname.match(/^\/workspaces\/([^/]+)\/forms\/([^/]+)\/drafts\/([^/]+)\/author/);
    expect(route).not.toBeNull();
    const persisted = await page.evaluate(async ([workspace, form, draft]) => {
      const response = await fetch(`/v1/workspaces/${workspace}/forms/${form}/authoring/${draft}`);
      if (!response.ok) throw new Error(`Authoring document request failed: ${response.status}`);
      return (await response.json()).definition;
    }, route!.slice(1));

    const fields = persisted.data.fields as Array<Record<string, unknown>>;
    const nodes = persisted.flow.phases[0].pages[0].sections[0].nodes as Array<Record<string, unknown>>;
    expect(fields.map((field) => field.key)).toEqual([
      'name', 'acknowledgment', ...FROZEN_CONTROLS.map((_, index) => `frozen_${String(index + 1).padStart(2, '0')}`),
    ]);
    expect(fields.map((field) => field.type)).toEqual([
      'text', 'boolean', 'text', 'text', 'text', 'text', 'text', 'text', 'integer', 'integer', 'integer', 'decimal', 'decimal', 'date', 'time', 'dateTime', 'boolean', 'boolean', 'choice', 'choice', 'multiChoice', 'multiChoice', 'object', 'object', 'object', 'list', 'list', 'list', 'attachments', 'drawing',
    ]);
    expect(nodes.filter((node) => node.fieldId === 'fld_name')).toHaveLength(2);
    const composites = nodes.filter((node) => COMPOSITES.has(String(node.control)));
    expect(composites.map((node) => Array.isArray(node.children) && node.children.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(fields.find((field) => field.key === 'frozen_26')?.constraints).toMatchObject({ fixedItemIds: ['row_one', 'row_two'] });
    expect(Object.keys(persisted.expressions).sort()).toEqual(ALL_OPERATORS.map((operator) => `frozen_${operator}`).sort());
    expect(persisted.diagnostics ?? []).toEqual([]);

    // The package is read back from the real persisted draft and submitted to the
    // backend's independent import/compiler path; this does not insert or alter it.
    const verdict = await page.evaluate(async ([workspace, form, draft, candidate]) => {
      const csrf = document.cookie.split('; ').find((cookie) => cookie.startsWith('SI_CSRF='))?.split('=').slice(1).join('=');
      const response = await fetch(`/v1/workspaces/${workspace}/forms/${form}/authoring/${draft}/imports/validate`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}) }, body: JSON.stringify({ candidate }),
      });
      if (!response.ok) throw new Error(`Independent compiler request failed: ${response.status}`);
      return response.json();
    }, [...route!.slice(1), persisted]);
    expect(verdict.state).toBe('VALID');
    expect(verdict.diagnostics).toEqual([]);
    writeFileSync('/var/tmp/smartintake-real-browser-frozen-package.json', JSON.stringify(persisted, null, 2));
  });
});
