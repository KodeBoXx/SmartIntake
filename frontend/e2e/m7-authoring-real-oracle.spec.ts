import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const baseUrl = process.env.M7_REAL_ORACLE_URL;
const workspaceId = process.env.M7_REAL_ORACLE_WORKSPACE;
const email = process.env.M7_REAL_ORACLE_EMAIL;
const password = process.env.M7_REAL_ORACLE_PASSWORD;
const runSuffix = process.env.M7_REAL_ORACLE_KEY_SUFFIX?.trim();

type OracleField = { expected: { n: number; key: string; canonicalType: string; parentKey: string | null; config: Record<string, unknown> } };
type AuthorOracle = { formKey: string; formName: string; canonicalFieldCount: number; phases: number; pages: { phase: string; page: string; fieldNumbers: number[] }[]; fields: OracleField[] };
const oracle = JSON.parse(readFileSync('../docs/acceptance/v1.1/evaluator/oracles/author-oracle.json', 'utf8')) as AuthorOracle;
const activeFormKey = runSuffix ? `${oracle.formKey}-${runSuffix}` : oracle.formKey;
const expressionOperators = ['and', 'or', 'not', 'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'containsAll', 'exists', 'isAnswered', 'statusIs', 'add', 'subtract', 'multiply', 'divide', 'round', 'min', 'max', 'sum', 'count', 'any', 'all', 'concat', 'length', 'coalesce', 'if', 'dateDiffDays', 'ageYears', 'dateAddDays', 'today'] as const;

/**
 * This is deliberately a live-only browser oracle. It starts with a newly created
 * canonical draft and uses only authoring controls: no seed package alteration,
 * request fulfilment, database setup, JSON editor, or API mutation is permitted.
 */
test.describe('M7 authoritative visual authoring oracle', () => {
  test.skip(!baseUrl || !workspaceId || !email || !password, 'requires an isolated real authoring backend');
  test.setTimeout(20 * 60_000);

  test('constructs and independently compiles the authoritative 30-field package', async ({ page }) => {
    page.setDefaultTimeout(7_000);
    await page.goto(`${baseUrl}/sign-in`);
    await page.getByRole('textbox', { name: 'Email' }).fill(email!);
    await page.getByRole('textbox', { name: 'Password' }).fill(password!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Forms' })).toBeVisible();
    await page.goto(`${baseUrl}/workspaces/${encodeURIComponent(workspaceId!)}/forms/new`);
    await page.getByTestId('form-key').fill(activeFormKey);
    await page.locator('.title-input').fill(oracle.formName);
    await page.getByRole('button', { name: 'Author' }).click();
    await expect(page.getByTestId('authoring-page')).toBeVisible();

    // About your request / About. The two visible starter controls are authored,
    // not replaced or seeded. Every following call targets an exact named oracle field.
    await selectNode(page, 'phase_request'); await rename(page, 'About your request');
    await selectNode(page, 'page_name'); await rename(page, 'About');
    await selectNode(page, 'section_name'); await rename(page, 'About');
    await selectNode(page, 'node_name'); await rename(page, 'respondentName');
    await configure(page, { key: 'respondentName', control: 'shortText', required: true, maxLength: '120' });
    await selectNode(page, 'node_acknowledgment'); await rename(page, 'referenceCode'); await configure(page, { key: 'referenceCode', control: 'identifier', required: true, maxLength: '20' });
    await addAndConfigure(page, { key: 'email', control: 'email', required: true });
    await addAndConfigure(page, { key: 'needsSetup', control: 'yesNo', required: true });
    await addAndConfigure(page, { key: 'setupDetails', control: 'textarea', sensitivity: 'sensitive', hiddenRetention: 'clear', visibility: 'operator_eq', requiredExpression: 'operator_eq' });
    await addAndConfigure(page, { key: 'services', control: 'chips', options: 'opt_collection: Collection\nopt_setup: Setup\nopt_other: Other\nopt_none: None', minItems: 1, exclusive: 'opt_none' });
    await addAndConfigure(page, { key: 'otherServiceDetails', control: 'shortText', hiddenRetention: 'clear', visibility: 'operator_contains', requiredExpression: 'operator_contains' });
    await addAndConfigure(page, { key: 'visitDate', control: 'date', required: true });
    await addAndConfigure(page, { key: 'extraAttendees', control: 'integer', required: true, min: '0', max: '10', step: '1' });
    await addAndConfigure(page, { key: 'priority', control: 'rating', required: true, min: '1', max: '5' });
    await addAndConfigure(page, { key: 'priorityOrder', control: 'ranking', options: 'opt_reliability: Reliability\nopt_portability: Portability\nopt_price: Price', ordered: true });
    await addAndConfigure(page, { key: 'entryMode', control: 'modeSelector', required: true, options: 'opt_cards: Cards\nopt_table: Table', defaultValue: 'opt_cards' });

    // A named Equipment phase is created with the visual add-phase control. Its
    // generated first field becomes the authoritative equipment list, then its
    // nested child editor creates fields 14–20 without duplicated answer IDs.
    await page.getByRole('button', { name: 'Add phase' }).click();
    await page.getByRole('treeitem', { name: 'New phase', exact: true }).click(); await rename(page, 'Equipment');
    await page.getByRole('treeitem', { name: 'New page', exact: true }).click(); await rename(page, 'Equipment');
    await page.getByRole('treeitem', { name: 'New section', exact: true }).last().click(); await rename(page, 'Equipment');
    await page.getByRole('treeitem', { name: 'New field', exact: true }).last().click();
    await rename(page, 'equipment');
    await configure(page, { key: 'equipment', control: 'repeatingCards', minItems: 1, maxItems: 50, summary: 'equipmentName, quantity' });
    await configureCompositeChildren(page, [
      { key: 'equipmentName', control: 'shortText', required: true, maxLength: 80 },
      { key: 'quantity', control: 'integer', required: true, min: '1', max: '10' },
      { key: 'unitCost', control: 'currency', required: true, min: '0', max: '1000000', scale: 2, unit: 'USD' },
      { key: 'accessories', control: 'repeatingCards', maxItems: 10, children: [{ key: 'accessoryName', control: 'shortText', required: true }, { key: 'tests', control: 'repeatingCards', maxItems: 5, children: [{ key: 'testResult', control: 'radio', required: true, options: 'opt_pass: Pass\nopt_fail: Fail', visibility: 'operator_isAnswered' }] }] },
    ]);
    await page.getByRole('button', { name: 'Apply field settings' }).click();
    await page.getByLabel('Place existing field').selectOption({ label: 'email' });
    await page.getByRole('button', { name: 'Place in selected section' }).click();

    await addAndConfigure(page, { key: 'checks', control: 'fixedMatrix', fixedRows: 'row_power: Power available\nrow_space: Space available' });
    await configureCompositeChildren(page, [{ key: 'checkResult', control: 'yesNo', required: true }, { key: 'checkDetails', control: 'shortText', hiddenRetention: 'clear', visibility: 'operator_not', requiredExpression: 'operator_not' }]);
    await page.getByRole('button', { name: 'Apply field settings' }).click();
    await addAndConfigure(page, { key: 'shipping', control: 'address', roles: 'postalCode: postalCode, country: country' });
    await configureCompositeChildren(page, [{ key: 'postalCode', control: 'identifier', required: true }, { key: 'country', control: 'combobox', required: true, options: 'opt_in: India\nopt_gb: United Kingdom' }]);
    await page.getByLabel('Composite roles').fill('postalCode: postalCode, country: country');
    await page.getByRole('button', { name: 'Apply field settings' }).click();
    await addAndConfigure(page, { key: 'note', control: 'shortText', statuses: 'unknown, declined' });
    await addAndConfigure(page, { key: 'total', control: 'currency', readOnly: true, calculated: true, min: '0', max: '1000000', scale: 2, unit: 'USD', calculationExpressionId: 'operator_sum', calculationDependencyId: 'authoring-calculations' });
    await addAndConfigure(page, { key: 'supportingFiles', control: 'fileUpload', maxItems: 2 });

    // The final acknowledgement uses the existing canonical answer definition,
    // placed in the separately authored Review phase. This is a shared placement,
    // not a second answer definition.
    await page.getByRole('button', { name: 'Add phase' }).click();
    await page.getByRole('treeitem', { name: 'New phase', exact: true }).last().click(); await rename(page, 'Review');
    await page.getByRole('treeitem', { name: 'New page', exact: true }).last().click(); await rename(page, 'Review and submit');
    await page.getByRole('treeitem', { name: 'New section', exact: true }).last().click(); await rename(page, 'Review and submit');
    await page.getByRole('treeitem', { name: 'New field', exact: true }).last().click();
    await rename(page, 'reviewAcknowledged');
    await configure(page, { key: 'reviewAcknowledged', control: 'acknowledgment', required: true, acknowledgmentContent: 'I confirm this information is accurate.' });

    // Operator-specific trees use the actual nested operand controls. Each shape
    // exercises its own literal/reference type, variable arity, and aggregate/item scope.
    await authorOperators(page);
    await selectNode(page, 'page_name');
    await page.getByLabel('Destination page').selectOption({ label: 'Equipment' });
    await page.getByLabel('Route expression ID').fill('operator_eq');
    await page.getByRole('button', { name: 'Save branch route' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Canonical draft saved.')).toBeVisible();

    const persisted = await readPersisted(page);
    assertAuthoritativeShape(persisted);
    await assertIndependentCompiler(page, persisted);
    writeFileSync('/var/tmp/smartintake-real-browser-author-oracle-package.json', JSON.stringify(persisted, null, 2));
  });
});

type FieldConfig = { key: string; control: string; required?: boolean; readOnly?: boolean; calculated?: boolean; maxLength?: string; min?: string; max?: string; step?: string; scale?: number; minItems?: number; maxItems?: number; options?: string; fixedRows?: string; exclusive?: string; sensitivity?: string; hiddenRetention?: 'clear' | 'memory' | 'draft'; statuses?: string; summary?: string; roles?: string; ordered?: boolean; unit?: string; defaultValue?: string; visibility?: string; requiredExpression?: string; acknowledgmentContent?: string; calculationExpressionId?: string; calculationDependencyId?: string };
type CompositeConfig = { key: string; control: string; required?: boolean; options?: string; min?: string; max?: string; scale?: number; maxItems?: number; maxLength?: number; unit?: string; hiddenRetention?: 'clear' | 'memory' | 'draft'; visibility?: string; requiredExpression?: string; children?: CompositeConfig[] };
const controlLabel = (control: string): string => ({ shortText: 'Short text', textarea: 'Long text', email: 'Email', identifier: 'Identifier', yesNo: 'Yes / no', chips: 'Chips', date: 'Date', integer: 'Integer', rating: 'Rating', ranking: 'Ranking', modeSelector: 'Mode selector', repeatingCards: 'Repeating cards', currency: 'Currency', fixedMatrix: 'Fixed matrix', address: 'Address', combobox: 'Combobox', acknowledgment: 'Acknowledgment', decimal: 'Decimal', fileUpload: 'File upload', radio: 'Radio choice' }[control] ?? control);

async function selectNode(page: import('@playwright/test').Page, id: string): Promise<void> { await page.locator(`[data-authoring-id="${id}"]`).click(); }
async function rename(page: import('@playwright/test').Page, label: string): Promise<void> { await page.getByLabel('Label').fill(label); await page.getByRole('button', { name: 'Rename', exact: true }).click(); }
async function addAndConfigure(page: import('@playwright/test').Page, config: FieldConfig): Promise<void> { await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.getByRole('treeitem', { name: 'New field', exact: true }).last().click(); await expect(page.getByRole('heading', { name: 'FIELD SETTINGS', exact: true })).toBeVisible(); await rename(page, config.key); await configure(page, config); }
async function configure(page: import('@playwright/test').Page, config: FieldConfig): Promise<void> {
  await page.getByLabel('Control').selectOption({ label: controlLabel(config.control) }); await page.getByLabel('Stable integration key').fill(config.key);
  if (config.required) await page.getByLabel('Required answer').check();
  if (config.readOnly) await page.getByLabel('Read only').check();
  if (config.calculated) await page.getByLabel('Calculated value').check();
  if (config.maxLength) await page.getByLabel('Maximum length').fill(config.maxLength);
  if (config.min) await page.getByLabel('Minimum constraint').fill(config.min);
  if (config.max) await page.getByLabel('Maximum constraint').fill(config.max);
  if (config.step) await page.getByLabel('Field step').fill(config.step);
  if (config.scale !== undefined) await page.getByLabel('Decimal scale').fill(String(config.scale));
  if (config.minItems !== undefined) await page.getByLabel('Minimum items').fill(String(config.minItems));
  if (config.maxItems !== undefined) await page.getByLabel('Maximum items').fill(String(config.maxItems));
  if (config.options) await page.getByLabel('Field options').fill(config.options);
  if (config.fixedRows) await page.getByLabel('Fixed matrix rows').fill(config.fixedRows);
  if (config.exclusive) await page.getByLabel('Exclusive option IDs').fill(config.exclusive);
  if (config.sensitivity) await page.getByLabel('Field sensitivity').fill(config.sensitivity);
  if (config.hiddenRetention) await page.getByLabel('Hidden retention').selectOption(config.hiddenRetention);
  if (config.statuses) await page.getByLabel('Allowed statuses').fill(config.statuses);
  if (config.summary) await page.getByLabel('Summary field IDs').fill(config.summary);
  if (config.roles) await page.getByLabel('Composite roles').fill(config.roles);
  if (config.ordered) await page.getByLabel('Preserve ordering').check();
  if (config.unit) await page.getByLabel('Field unit').fill(config.unit);
  if (config.defaultValue) await page.getByLabel('Default value').fill(config.defaultValue);
  if (config.visibility) await page.getByLabel('Visibility expression ID').fill(config.visibility);
  if (config.requiredExpression) await page.getByLabel('Required expression ID').fill(config.requiredExpression);
  if (config.acknowledgmentContent) await page.getByLabel('Acknowledgment content').fill(config.acknowledgmentContent);
  if (config.calculationExpressionId) await page.getByLabel('Calculation expression ID').fill(config.calculationExpressionId);
  if (config.calculationDependencyId) await page.getByLabel('Calculation dependency ID').fill(config.calculationDependencyId);
  if (!['address', 'contact', 'person', 'repeatingCards', 'dynamicMatrix', 'fixedMatrix'].includes(config.control)) await page.getByRole('button', { name: 'Apply field settings' }).click();
}
async function configureCompositeChildren(page: import('@playwright/test').Page, children: CompositeConfig[]): Promise<void> {
  for (const child of children) await addCompositeChild(page, child);
}
async function addCompositeChild(page: import('@playwright/test').Page, child: CompositeConfig, parent?: import('@playwright/test').Locator): Promise<void> {
  const childIndex = await page.getByLabel('Nested child key').count();
  await (parent ? parent.locator(':scope > button', { hasText: 'Add descendant' }) : page.getByRole('button', { name: 'Add child field', exact: true })).click();
  const key = page.getByLabel('Nested child key').nth(childIndex);
  const article = key.locator('xpath=ancestor::article[1]');
  await key.fill(child.key);
  await article.getByLabel('Nested child label').fill(child.key);
  await article.getByLabel('Nested child control').selectOption({ label: controlLabel(child.control) });
  if (child.required) await article.getByRole('checkbox', { name: 'Nested child required', exact: true }).check();
  if (child.options) await article.getByLabel('Nested child options').fill(child.options);
  if (child.min) await article.getByLabel('Nested child minimum', { exact: true }).fill(child.min);
  if (child.max) await article.getByLabel('Nested child maximum', { exact: true }).fill(child.max);
  if (child.scale !== undefined) await article.getByLabel('Nested child scale', { exact: true }).fill(String(child.scale));
  if (child.maxItems !== undefined) await article.getByLabel('Nested child maximum items', { exact: true }).fill(String(child.maxItems));
  if (child.maxLength !== undefined) await article.getByLabel('Nested child maximum length', { exact: true }).fill(String(child.maxLength));
  if (child.unit) await article.getByLabel('Nested child unit', { exact: true }).fill(child.unit);
  if (child.hiddenRetention) await article.getByLabel('Nested child hidden retention', { exact: true }).selectOption(child.hiddenRetention);
  if (child.visibility) await article.getByLabel('Nested child visibility expression ID', { exact: true }).fill(child.visibility);
  if (child.requiredExpression) await article.getByLabel('Nested child required expression ID', { exact: true }).fill(child.requiredExpression);
  for (const descendant of child.children ?? []) await addCompositeChild(page, descendant, article);
}

async function authorOperators(page: import('@playwright/test').Page): Promise<void> {
  await authorOperator(page, 'and'); await authorOperator(page, 'or'); await authorOperator(page, 'not');
  await authorOperator(page, 'eq'); await authorOperator(page, 'ne'); await authorOperator(page, 'lt');
  await authorOperator(page, 'lte'); await authorOperator(page, 'gt'); await authorOperator(page, 'gte');
  await authorOperator(page, 'in'); await authorOperator(page, 'contains'); await authorOperator(page, 'containsAll');
  await authorOperator(page, 'exists'); await authorOperator(page, 'isAnswered'); await authorOperator(page, 'statusIs');
  await authorOperator(page, 'add'); await authorOperator(page, 'subtract'); await authorOperator(page, 'multiply');
  await authorOperator(page, 'divide'); await authorOperator(page, 'round'); await authorOperator(page, 'min');
  await authorOperator(page, 'max'); await authorOperator(page, 'sum'); await authorOperator(page, 'count');
  await authorOperator(page, 'any'); await authorOperator(page, 'all'); await authorOperator(page, 'concat');
  await authorOperator(page, 'length'); await authorOperator(page, 'coalesce'); await authorOperator(page, 'if');
  await authorOperator(page, 'dateDiffDays'); await authorOperator(page, 'ageYears'); await authorOperator(page, 'dateAddDays');
  await authorOperator(page, 'today');
}

async function authorOperator(page: import('@playwright/test').Page, operator: typeof expressionOperators[number]): Promise<void> {
  await page.getByLabel('Expression ID', { exact: true }).fill(`operator_${operator}`);
  const expressionSection = page.getByRole('heading', { name: 'VISUAL EXPRESSION BUILDER' }).locator('xpath=ancestor::section[1]');
  const operatorSelect = expressionSection.locator(':scope > label select').first();
  await operatorSelect.selectOption({ index: expressionOperators.indexOf(operator) });
  const operands = expressionSection.locator(':scope > article.authoring__operand');
  const first = operands.nth(0); const second = operands.nth(1); const third = operands.nth(2);
  if (['and', 'or'].includes(operator)) { await setLiteral(first, 'boolean', 'true'); await setLiteral(second, 'boolean', 'false'); }
  else if (operator === 'not') await setField(first, 'checkResult', 'item');
  else if (operator === 'eq') { await setField(first, 'needsSetup'); await setLiteral(second, 'boolean', 'true'); }
  else if (operator === 'ne') { await setField(first, 'respondentName'); await setLiteral(second, 'text', 'Ada'); }
  else if (['lt', 'lte', 'gt', 'gte'].includes(operator)) { await setField(first, 'extraAttendees'); await setLiteral(second, 'integer', '1'); }
  else if (operator === 'in') { await setLiteral(first, 'text', 'Ada'); await setList(second, 'text', 'Ada, Grace'); }
  else if (operator === 'contains') { await setField(first, 'services'); await setLiteral(second, 'choice', 'opt_other'); }
  else if (operator === 'containsAll') { await setField(first, 'services'); await setList(second, 'choice', 'opt_setup, opt_other'); }
  else if (operator === 'exists') await setField(first, 'respondentName');
  else if (operator === 'isAnswered') await setField(first, 'accessoryName', 'parentItem');
  else if (operator === 'statusIs') { await setField(first, 'respondentName'); await setLiteral(second, 'text', 'answered'); }
  else if (['add', 'subtract', 'multiply', 'divide', 'min', 'max'].includes(operator)) { await setLiteral(first, 'decimal', '4'); await setLiteral(second, 'integer', '2'); }
  else if (operator === 'round') { await setLiteral(first, 'decimal', '4.25'); await setLiteral(second, 'integer', '1'); }
  else if (operator === 'sum') { await setField(first, 'equipment'); await setNested(second, 'multiply', async (nested) => { await setField(nested.nth(0), 'quantity', 'item'); await setField(nested.nth(1), 'unitCost', 'item'); }); }
  else if (operator === 'count') await setField(first, 'equipment');
  else if (['any', 'all'].includes(operator)) { await setField(first, 'equipment'); await setNested(second, 'gt', async (nested) => { await setField(nested.nth(0), 'quantity', 'item'); await setLiteral(nested.nth(1), 'integer', '0'); }); }
  else if (operator === 'concat') { await setField(first, 'respondentName'); await setLiteral(second, 'text', ' request'); }
  else if (operator === 'length') await setField(first, 'respondentName');
  else if (operator === 'coalesce') { await setField(first, 'respondentName'); await setLiteral(second, 'text', 'Unknown'); }
  else if (operator === 'if') { await setField(first, 'needsSetup'); await setLiteral(second, 'text', 'yes'); await setLiteral(third, 'text', 'no'); }
  else if (operator === 'dateDiffDays') { await setField(first, 'visitDate'); await setLiteral(second, 'date', '2026-12-31'); }
  else if (operator === 'ageYears') { await setLiteral(first, 'date', '2000-01-01'); await setLiteral(second, 'date', '2026-12-31'); }
  else if (operator === 'dateAddDays') { await setField(first, 'visitDate'); await setLiteral(second, 'integer', '1'); }
  await page.getByRole('button', { name: 'Save expression', exact: true }).click();
}

async function setField(article: import('@playwright/test').Locator, field: string, scope: 'root' | 'item' | 'parentItem' = 'root'): Promise<void> { const selects = article.locator(':scope > label select'); await selects.nth(0).selectOption('field'); await selects.nth(1).selectOption({ label: field }); await selects.nth(2).selectOption(scope); }
async function setLiteral(article: import('@playwright/test').Locator, type: string, value: string): Promise<void> { const selects = article.locator(':scope > label select'); await selects.nth(0).selectOption('literal'); await selects.nth(1).selectOption(type); await article.locator(':scope > label input').fill(value); }
async function setList(article: import('@playwright/test').Locator, type: string, value: string): Promise<void> { const selects = article.locator(':scope > label select'); await selects.nth(0).selectOption('list'); await selects.nth(1).selectOption(type); await article.locator(':scope > label input').fill(value); }
async function setNested(article: import('@playwright/test').Locator, operator: typeof expressionOperators[number], configure: (operands: import('@playwright/test').Locator) => Promise<void>): Promise<void> { const selects = article.locator(':scope > label select'); await selects.nth(0).selectOption('operator'); await selects.nth(1).selectOption({ index: expressionOperators.indexOf(operator) }); await configure(article.locator(':scope > article.authoring__operand')); }

async function readPersisted(page: import('@playwright/test').Page): Promise<Record<string, any>> {
  const route = new URL(page.url()).pathname.match(/^\/workspaces\/([^/]+)\/forms\/([^/]+)\/drafts\/([^/]+)\/author/);
  expect(route).not.toBeNull();
  return page.evaluate(async ([workspace, form, draft]) => { const response = await fetch(`/v1/workspaces/${workspace}/forms/${form}/authoring/${draft}`); if (!response.ok) throw new Error(`Authoring document request failed: ${response.status}`); return (await response.json()).definition; }, route!.slice(1));
}

function assertAuthoritativeShape(persisted: Record<string, any>): void {
  expect(persisted.formKey).toBe(activeFormKey);
  expect(persisted.flow.phases).toHaveLength(oracle.phases);
  expect(persisted.flow.phases.map((phase: any) => phase.pages[0].titleKey)).toHaveLength(3);
  const flatten = (fields: any[], prefix = ''): any[] => fields.flatMap((field) => {
    const qualifiedKey = prefix ? `${prefix}.${field.key}` : field.key;
    return [{ ...field, qualifiedKey }, ...flatten(field.itemSchema?.fields ?? [], qualifiedKey)];
  });
  const actual = flatten(persisted.data.fields);
  expect(actual).toHaveLength(oracle.canonicalFieldCount);
  const expected = oracle.fields.map(({ expected }) => ({ key: expected.key, type: expected.canonicalType }));
  expect(actual.map((field) => ({ key: field.qualifiedKey, type: field.type }))).toEqual(expected);
  expect(new Set(actual.map((field) => field.id)).size).toBe(oracle.canonicalFieldCount);
  const byKey = (key: string): any => actual.find((field) => field.qualifiedKey === key);
  expect(persisted.flow.phases.map((phase: any) => persisted.translations.en.messages[phase.titleKey])).toEqual(['About your request', 'Equipment', 'Review']);
  expect(persisted.flow.phases.map((phase: any) => persisted.translations.en.messages[phase.pages[0].titleKey])).toEqual(['About', 'Equipment', 'Review and submit']);
  expect(byKey('respondentName')).toMatchObject({ required: true, constraints: { maxLength: 120 } });
  expect(byKey('referenceCode')).toMatchObject({ required: true, constraints: { maxLength: 20 }, normalizer: 'preserve' });
  expect(byKey('services')).toMatchObject({ constraints: { minItems: 1, exclusiveOptionIds: ['opt_none'] }, options: [{ id: 'opt_collection' }, { id: 'opt_setup' }, { id: 'opt_other' }, { id: 'opt_none' }] });
  expect(byKey('priorityOrder')).toMatchObject({ ordered: true, options: [{ id: 'opt_reliability' }, { id: 'opt_portability' }, { id: 'opt_price' }] });
  expect(byKey('entryMode')).toMatchObject({ required: true, default: { status: 'answered', value: 'opt_cards' } });
  expect(byKey('equipment')).toMatchObject({ constraints: { minItems: 1, maxItems: 50 } });
  expect(byKey('equipment.equipmentName')).toMatchObject({ constraints: { required: true, maxLength: 80 } });
  expect(byKey('equipment.quantity')).toMatchObject({ constraints: { required: true, min: '1', max: '10' } });
  expect(byKey('equipment.unitCost')).toMatchObject({ unit: 'USD', constraints: { required: true, min: '0', max: '1000000', scale: 2 } });
  expect(byKey('equipment.accessories')).toMatchObject({ constraints: { required: false, maxItems: 10 } });
  expect(byKey('equipment.accessories.tests')).toMatchObject({ constraints: { required: false, maxItems: 5 } });
  expect(byKey('equipment.accessories.tests.testResult')).toMatchObject({ constraints: { required: true }, visibilityExpressionId: 'operator_isAnswered', options: [{ id: 'opt_pass' }, { id: 'opt_fail' }] });
  expect(byKey('checks.checkDetails')).toMatchObject({ hiddenRetention: 'clear', visibilityExpressionId: 'operator_not', requiredExpressionId: 'operator_not' });
  expect(byKey('shipping.postalCode')).toMatchObject({ constraints: { required: true }, normalizer: 'preserve' });
  expect(byKey('shipping.country')).toMatchObject({ constraints: { required: true }, options: [{ id: 'opt_in' }, { id: 'opt_gb' }] });
  expect(byKey('note')).toMatchObject({ allowUnknown: true, allowDeclined: true });
  expect(byKey('total')).toMatchObject({ type: 'decimal', readOnly: true, calculated: true, mode: 'calculated', unit: 'USD', constraints: { min: '0', max: '1000000', scale: 2 }, extensions: { 'x-kodeboxx.calculation': { value: 'operator_sum', dependencyId: 'authoring-calculations' } } });
  expect(byKey('supportingFiles')).toMatchObject({ constraints: { maxItems: 2 } });
  expect(byKey('reviewAcknowledged')).toMatchObject({ required: true, type: 'boolean' });
  const nodes = persisted.flow.phases.flatMap((phase: any) => phase.pages.flatMap((candidatePage: any) => candidatePage.sections.flatMap((section: any) => section.nodes)));
  const emailPlacements = nodes.filter((node: any) => node.fieldId === byKey('email').id);
  expect(emailPlacements).toHaveLength(2);
  const equipmentNode = nodes.find((node: any) => node.fieldId === byKey('equipment').id);
  expect(equipmentNode.summaryFieldIds).toEqual([byKey('equipment.equipmentName').id, byKey('equipment.quantity').id]);
  const shippingNode = nodes.find((node: any) => node.fieldId === byKey('shipping').id);
  expect(shippingNode.roles).toEqual({ postalCode: byKey('shipping.postalCode').id, country: byKey('shipping.country').id });
  expect(persisted.flow.phases[0].pages[0].routes).toContainEqual(expect.objectContaining({ targetPageId: persisted.flow.phases[1].pages[0].id, whenExpressionId: 'operator_eq' }));
  expect(persisted.expressions.operator_sum).toMatchObject({ op: 'sum', args: [{ ref: { fieldId: byKey('equipment').id, scope: 'root' } }, { op: 'multiply', args: [{ ref: { fieldId: byKey('equipment.quantity').id, scope: 'item' } }, { ref: { fieldId: byKey('equipment.unitCost').id, scope: 'item' } }] }] });
  expect(persisted.dependencies).toContainEqual(expect.objectContaining({ kind: 'extension', id: 'authoring-calculations' }));
  expect(Object.keys(persisted.expressions).sort()).toEqual(['and', 'or', 'not', 'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'containsAll', 'exists', 'isAnswered', 'statusIs', 'add', 'subtract', 'multiply', 'divide', 'round', 'min', 'max', 'sum', 'count', 'any', 'all', 'concat', 'length', 'coalesce', 'if', 'dateDiffDays', 'ageYears', 'dateAddDays', 'today'].map((operator) => `operator_${operator}`).sort());
  expect(persisted.diagnostics ?? []).toEqual([]);
}

async function assertIndependentCompiler(page: import('@playwright/test').Page, candidate: Record<string, any>): Promise<void> {
  const route = new URL(page.url()).pathname.match(/^\/workspaces\/([^/]+)\/forms\/([^/]+)\/drafts\/([^/]+)\/author/)!;
  const verdict = await page.evaluate(async ([workspace, form, draft, candidate]) => { const csrf = document.cookie.split('; ').find((cookie) => cookie.startsWith('SI_CSRF='))?.split('=').slice(1).join('='); const response = await fetch(`/v1/workspaces/${workspace}/forms/${form}/authoring/${draft}/imports/validate`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}) }, body: JSON.stringify({ candidate }) }); if (!response.ok) throw new Error(`Independent compiler request failed: ${response.status}`); return response.json(); }, [...route.slice(1), candidate]);
  expect(verdict.state).toBe('VALID'); expect(verdict.diagnostics).toEqual([]);
}
