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
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/forms`));
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
    await addAndConfigure(page, { key: 'priority', control: 'rating', required: true, min: '1', max: '5', endpointLow: 'Low priority', endpointHigh: 'High priority' });
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
    await configure(page, { key: 'equipment', control: 'repeatingCards', minItems: 1, maxItems: 50, summary: 'equipmentName, quantity', allowAdd: true, allowRemove: true, allowReorder: true, alternateInstancesBindSameField: true });
    await configureCompositeChildren(page, [
      { key: 'equipmentName', control: 'shortText', required: true, maxLength: 80 },
      { key: 'quantity', control: 'integer', required: true, min: '1', max: '10' },
      { key: 'unitCost', control: 'currency', required: true, min: '0', max: '1000000', scale: 2, unit: 'USD' },
      { key: 'accessories', control: 'repeatingCards', maxItems: 10, children: [{ key: 'accessoryName', control: 'shortText', required: true }, { key: 'tests', control: 'repeatingCards', maxItems: 5, children: [{ key: 'testResult', control: 'radio', required: true, options: 'opt_pass: Pass\nopt_fail: Fail', visibility: 'operator_isAnswered' }] }] },
    ]);
    await page.getByRole('button', { name: 'Apply field settings' }).click();
    await page.getByLabel('Place existing field').selectOption({ label: 'email' });
    await page.getByRole('button', { name: 'Place in selected section' }).click();
    await page.getByRole('treeitem', { name: 'email', exact: true }).last().click();
    await configure(page, { key: 'email', control: 'email', required: true, placementReadOnly: true });

    await addAndConfigure(page, { key: 'checks', control: 'fixedMatrix', fixedRows: 'row_power: Power available\nrow_space: Space available', allowAdd: false, allowRemove: false });
    await configureCompositeChildren(page, [{ key: 'checkResult', control: 'yesNo', required: true }, { key: 'checkDetails', control: 'shortText', hiddenRetention: 'clear', visibility: 'operator_not', requiredExpression: 'operator_not' }]);
    await page.getByRole('button', { name: 'Apply field settings' }).click();
    await addAndConfigure(page, { key: 'shipping', control: 'address', roles: 'postalCode: postalCode, country: country' });
    await configureCompositeChildren(page, [{ key: 'postalCode', control: 'identifier', required: true }, { key: 'country', control: 'combobox', required: true, options: 'opt_in: India\nopt_gb: United Kingdom' }]);
    await page.getByLabel('Composite roles').fill('postalCode: postalCode, country: country');
    await page.getByRole('button', { name: 'Apply field settings' }).click();
    await addAndConfigure(page, { key: 'note', control: 'shortText', statuses: 'unknown, declined' });
    await addAndConfigure(page, { key: 'total', control: 'currency', readOnly: true, calculated: true, min: '0', max: '1000000', scale: 2, unit: 'USD', calculationExpressionId: 'operator_sum', calculationDependencyId: 'authoring-calculations' });
    await addAndConfigure(page, { key: 'supportingFiles', control: 'fileUpload', maxItems: 2, allowedMime: 'text/plain', scanReadiness: 'normal' });

    // The final acknowledgement uses the existing canonical answer definition,
    // placed in the separately authored Review phase. This is a shared placement,
    // not a second answer definition.
    await page.getByRole('button', { name: 'Add phase' }).click();
    await page.getByRole('treeitem', { name: 'New phase', exact: true }).last().click(); await rename(page, 'Review');
    await page.getByRole('treeitem', { name: 'New page', exact: true }).last().click(); await rename(page, 'Review and submit');
    await page.getByRole('treeitem', { name: 'New section', exact: true }).last().click(); await rename(page, 'Review and submit');
    await page.getByRole('treeitem', { name: 'New field', exact: true }).last().click();
    await rename(page, 'reviewAcknowledged');
    await configure(page, { key: 'reviewAcknowledged', control: 'acknowledgment', required: true, acknowledgmentContent: 'I confirm this information is accurate.', requireTrue: true, finalReviewOnly: true, voiceSupplyProhibited: true });
    await selectNode(page, 'node_review');
    await page.getByLabel('Destination section').selectOption({ label: 'Review / Review and submit / Review and submit' });
    await page.getByRole('button', { name: 'Move node', exact: true }).click();
    await selectNode(page, 'page_review');
    await page.getByRole('button', { name: 'Remove page', exact: true }).click();
    await page.getByRole('treeitem', { name: 'Equipment', exact: true }).nth(1).click();
    await page.getByLabel('Default next page').selectOption({ label: 'Review and submit' });
    await page.getByRole('button', { name: 'Save default route', exact: true }).click();

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
    assertUntranslatedStructuralPlaceholders(persisted);
    await assertIndependentCompiler(page, persisted);
    writeFileSync('/var/tmp/smartintake-real-browser-author-oracle-package.json', JSON.stringify(persisted, null, 2));
  });
});

type FieldConfig = { key: string; control: string; required?: boolean; readOnly?: boolean; calculated?: boolean; maxLength?: string; min?: string; max?: string; step?: string; scale?: number; minItems?: number; maxItems?: number; options?: string; fixedRows?: string; exclusive?: string; sensitivity?: string; hiddenRetention?: 'clear' | 'memory' | 'draft'; statuses?: string; summary?: string; roles?: string; ordered?: boolean; unit?: string; defaultValue?: string; visibility?: string; requiredExpression?: string; acknowledgmentContent?: string; calculationExpressionId?: string; calculationDependencyId?: string; placementReadOnly?: boolean; allowAdd?: boolean; allowRemove?: boolean; allowReorder?: boolean; alternateInstancesBindSameField?: boolean; endpointLow?: string; endpointHigh?: string; allowedMime?: string; scanReadiness?: 'normal' | 'required'; requireTrue?: boolean; finalReviewOnly?: boolean; voiceSupplyProhibited?: boolean };
type CompositeConfig = { key: string; control: string; required?: boolean; options?: string; min?: string; max?: string; scale?: number; maxItems?: number; maxLength?: number; unit?: string; hiddenRetention?: 'clear' | 'memory' | 'draft'; visibility?: string; requiredExpression?: string; children?: CompositeConfig[] };
const controlLabel = (control: string): string => ({ shortText: 'Short text', textarea: 'Long text', email: 'Email', identifier: 'Identifier', yesNo: 'Yes / no', chips: 'Chips', date: 'Date', integer: 'Integer', rating: 'Rating', ranking: 'Ranking', modeSelector: 'Mode selector', repeatingCards: 'Repeating cards', currency: 'Currency', fixedMatrix: 'Fixed matrix', address: 'Address', combobox: 'Combobox', acknowledgment: 'Acknowledgment', decimal: 'Decimal', fileUpload: 'File upload', radio: 'Radio choice' }[control] ?? control);

async function selectNode(page: import('@playwright/test').Page, id: string): Promise<void> { await page.locator(`[data-authoring-id="${id}"]`).click(); }
async function rename(page: import('@playwright/test').Page, label: string): Promise<void> { await page.getByLabel('Label').fill(label); await page.getByRole('button', { name: 'Rename', exact: true }).click(); }
async function addAndConfigure(page: import('@playwright/test').Page, config: FieldConfig): Promise<void> { await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.getByRole('treeitem', { name: 'New field', exact: true }).last().click(); await expect(page.getByRole('heading', { name: 'FIELD SETTINGS', exact: true })).toBeVisible(); await rename(page, config.key); await configure(page, config); }
async function configure(page: import('@playwright/test').Page, config: FieldConfig): Promise<void> {
  await page.getByLabel('Control').selectOption({ label: controlLabel(config.control) }); await page.getByLabel('Stable integration key').fill(config.key);
  if (config.required) await page.getByLabel('Required answer').check();
  if (config.readOnly) await page.getByLabel('Read only', { exact: true }).check();
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
  if (config.placementReadOnly) await page.getByRole('checkbox', { name: 'Placement read only' }).check();
  for (const [label, selected] of [['Allow add', config.allowAdd], ['Allow remove', config.allowRemove], ['Allow reorder', config.allowReorder], ['Alternate instances bind same field', config.alternateInstancesBindSameField]] as const) if (selected !== undefined) { const box = page.getByRole('checkbox', { name: label }); if (selected) await box.check(); else await box.uncheck(); }
  if (config.endpointLow) await page.getByLabel('Low endpoint label').fill(config.endpointLow);
  if (config.endpointHigh) await page.getByLabel('High endpoint label').fill(config.endpointHigh);
  if (config.allowedMime) await page.getByLabel('Allowed MIME types').fill(config.allowedMime);
  if (config.scanReadiness) await page.getByLabel('Scan readiness').selectOption(config.scanReadiness);
  for (const [label, selected] of [['Require true', config.requireTrue], ['Final review only', config.finalReviewOnly], ['Prohibit voice supply', config.voiceSupplyProhibited]] as const) if (selected) await page.getByRole('checkbox', { name: label }).check();
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
  expect(normalizeAuthoringPackage(persisted)).toEqual(expectedAuthoringPackage());
}

/**
 * The frozen oracle intentionally describes author-facing semantics. Normalize the
 * persisted closed package back to that vocabulary (including resolved labels and
 * stable field keys) so one equality assertion covers every frozen dimension.
 */
function normalizeAuthoringPackage(persisted: Record<string, any>): Record<string, unknown> {
  const messages = persisted.translations?.en?.messages ?? {};
  const fields = flattenFields(persisted.data?.fields ?? []);
  const byId = new Map(fields.map((field) => [field.id, field]));
  const keyFor = (id: unknown) => byId.get(String(id))?.qualifiedKey ?? String(id);
  const expressions = Object.fromEntries(Object.entries(persisted.expressions ?? {}).map(([id, expression]) => [id, normalizeExpression(expression, keyFor)]));
  const placements = flattenPlacements(persisted.flow?.phases ?? []).filter(({ node }) => typeof node.fieldId === 'string').map(({ node, page, section }) => normalizePlacement(node, page, section, keyFor, messages));
  return {
    formKey: persisted.formKey,
    title: messages[persisted.titleKey],
    phases: (persisted.flow?.phases ?? []).map((phase: any) => ({
      label: messages[phase.titleKey], pages: (phase.pages ?? []).map((page: any) => ({
        label: messages[page.titleKey], sections: (page.sections ?? []).map((section: any) => messages[section.titleKey]),
        routes: (page.routes ?? []).map((route: any) => ({ targetPage: pageLabel(persisted, route.targetPageId, messages), whenExpressionId: route.whenExpressionId })),
      })),
    })),
    fields: fields.map((field) => ({ key: field.qualifiedKey, canonicalType: field.type, parentKey: field.parentKey, config: oracleConfigFromField(field, placements, expressions, keyFor, messages) })),
    placements,
    expressions,
    dependencies: (persisted.dependencies ?? []).map((dependency: any) => ({ kind: dependency.kind, id: dependency.id, version: dependency.version, digest: dependency.digest })),
    diagnostics: persisted.diagnostics ?? [],
  };
}

function expectedAuthoringPackage(): Record<string, unknown> {
  return {
    formKey: activeFormKey,
    title: oracle.formName,
    phases: [
      { label: 'About your request', pages: [{ label: 'About', sections: ['About'], routes: [{ targetPage: 'Equipment', whenExpressionId: 'operator_eq' }] }] },
      { label: 'Equipment', pages: [{ label: 'Equipment', sections: ['Equipment'], routes: [] }] },
      { label: 'Review', pages: [{ label: 'Review and submit', sections: ['Review and submit'], routes: [] }] },
    ],
    fields: oracle.fields.map(({ expected }) => ({ key: expected.key, canonicalType: expected.canonicalType, parentKey: expected.parentKey, config: expected.config })),
    placements: expectedPlacements(),
    expressions: expectedExpressions(),
    dependencies: [{ kind: 'extension', id: 'authoring-calculations', version: '1.0.0', digest: `sha256:${'0'.repeat(64)}` }],
    diagnostics: [],
  };
}

function flattenFields(fields: any[], parentKey: string | null = null, prefix = ''): any[] {
  return fields.flatMap((field) => {
    const qualifiedKey = prefix ? `${prefix}.${field.key}` : field.key;
    return [{ ...field, parentKey, qualifiedKey }, ...flattenFields(field.itemSchema?.fields ?? [], qualifiedKey, qualifiedKey)];
  });
}

function flattenPlacements(phases: any[]): { node: any; page: any; section: any }[] {
  const descend = (nodes: any[], page: any, section: any): { node: any; page: any; section: any }[] => nodes.flatMap((node) => [{ node, page, section }, ...descend(node.children ?? [], page, section)]);
  return phases.flatMap((phase) => (phase.pages ?? []).flatMap((page: any) => (page.sections ?? []).flatMap((section: any) => descend(section.nodes ?? [], page, section))));
}

function normalizePlacement(node: any, page: any, section: any, keyFor: (id: unknown) => string, messages: Record<string, string>): Record<string, unknown> {
  const settings = node.presentation?.settings ?? {};
  const normalizedSettings = Object.fromEntries(Object.entries(settings).map(([key, value]) => [key === 'endpointLowLabelKey' ? 'endpointLowLabel' : key === 'endpointHighLabelKey' ? 'endpointHighLabel' : key, key.endsWith('LabelKey') ? messages[String(value)] : value]));
  return compact({ key: keyFor(node.fieldId), page: messages[page.titleKey], section: messages[section.titleKey], control: node.control,
    settings: normalizedSettings, roles: node.roles && Object.fromEntries(Object.entries(node.roles).map(([role, fieldId]) => [role, keyFor(fieldId)])),
    summaryFieldIds: node.summaryFieldIds?.map(keyFor), fixedRowLabels: node.fixedRowLabels && Object.fromEntries(Object.entries(node.fixedRowLabels).map(([id, labelKey]) => [id, messages[String(labelKey)]])),
    acknowledgmentContent: node.acknowledgmentContentKey && messages[node.acknowledgmentContentKey] });
}

function oracleConfigFromField(field: any, placements: Record<string, unknown>[], expressions: Record<string, unknown>, keyFor: (id: unknown) => string, messages: Record<string, string>): Record<string, unknown> {
  const constraints = field.constraints ?? {}; const placement = placements.find((candidate) => candidate.key === field.qualifiedKey) ?? {}; const settings = placement.settings as Record<string, unknown> ?? {};
  const options = (field.options ?? []).map((option: any) => option.id);
  const expected = oracle.fields.find(({ expected: candidate }) => candidate.key === field.qualifiedKey)?.expected.config ?? {};
  const config: Record<string, unknown> = {};
  for (const dimension of Object.keys(expected)) {
    const value = ({
      maxLength: constraints.maxLength, required: Boolean(field.required ?? constraints.required), preserveLeadingZeros: field.normalizer === 'preserve',
      answerCells: placements.filter((candidate) => candidate.key === field.qualifiedKey).length - 1,
      instances: placements.filter((candidate) => candidate.key === field.qualifiedKey).map((candidate) => compact({ page: candidate.page, editable: !(candidate.settings as Record<string, unknown>).readOnly || undefined, readOnly: (candidate.settings as Record<string, unknown>).readOnly || undefined })),
      falseIsValidAnswer: field.type === 'boolean', hiddenRetention: field.hiddenRetention, sensitive: field.sensitivity === 'sensitive',
      requiredWhile: requiredWhile(field.requiredExpressionId, expressions), minSelected: constraints.minItems, minItems: constraints.minItems, exclusiveOptionIds: constraints.exclusiveOptionIds, options,
      format: field.type === 'date' ? 'ISO calendar date' : undefined, informationOnly: field.type === 'date', min: constraints.min, max: constraints.max, step: constraints.step,
      endpointLabels: [settings.endpointLowLabel, settings.endpointHighLabel], keyboardMoveControls: field.ordered === true, ordered: field.ordered,
      default: field.default?.value, allowAdd: settings.allowAdd, allowRemove: settings.allowRemove, allowReorder: settings.allowReorder, alternateInstancesBindSameField: settings.alternateInstancesBindSameField,
      summaryFieldIds: (placement.summaryFieldIds as string[] | undefined)?.map((key) => key.split('.').at(-1)), currency: field.unit,
      depth: field.qualifiedKey.split('.').length, maxPerItem: constraints.maxItems, optional: !Boolean(field.required ?? constraints.required),
      requiredWithinExistingAccessory: Boolean(field.required ?? constraints.required), maxItems: constraints.maxItems,
      requiredWithinTest: Boolean(field.required ?? constraints.required), visibility: visibility(field.visibilityExpressionId, expressions),
      fixedItemIds: constraints.fixedItemIds, labels: Object.values((placement.fixedRowLabels as Record<string, string> | undefined) ?? {}).length ? Object.values(placement.fixedRowLabels as Record<string, string>) : (field.options ?? []).map((option: any) => messages[option.labelKey]),
      initialStatus: field.default?.status ?? 'unanswered', requiredPerFixedRow: Boolean(field.required ?? constraints.required), scope: field.qualifiedKey === 'checks.checkDetails' ? 'item' : undefined,
      noImplicitRegionRequirement: field.type === 'object', roles: normalizedRoles(placement.roles, expected.roles), noUSFormatRule: field.normalizer === 'preserve',
      allowDeclined: field.allowDeclined, allowUnknown: field.allowUnknown, distinctFromUnanswered: field.allowUnknown && field.allowDeclined, respondentOverride: !field.readOnly, serverRecomputes: field.calculated === true,
      applicableItemsOnly: field.extensions?.['x-kodeboxx.calculation']?.value === 'operator_sum', expression: field.extensions?.['x-kodeboxx.calculation']?.value === 'operator_sum' ? 'sum(ref(equipment,root), multiply(ref(quantity,item), ref(unitCost,item)))' : undefined,
      scale: constraints.scale, allowedMime: settings.allowedMime, maxFiles: constraints.maxItems, scanReadiness: settings.scanReadiness,
      finalReviewOnly: settings.finalReviewOnly, requireTrue: settings.requireTrue, voiceSupplyProhibited: settings.voiceSupplyProhibited,
    } as Record<string, unknown>)[dimension];
    config[dimension] = typeof expected[dimension] === 'number' && typeof value === 'string' ? Number(value) : value;
  }
  return config;
}

function requiredWhile(id: string | undefined, expressions: Record<string, unknown>): string | undefined { const expression = expressions[id ?? '']; if (id === 'operator_eq' && JSON.stringify(expression).includes('needsSetup')) return 'needsSetup == true'; if (id === 'operator_contains') return 'opt_other selected'; if (id === 'operator_not') return 'same row checkResult == false'; return id; }
function visibility(id: string | undefined, expressions: Record<string, unknown>): string | undefined { if (id === 'operator_isAnswered' && JSON.stringify(expressions[id]).includes('accessoryName')) return 'isAnswered(ref(accessoryName, scope=parentItem))'; return id; }
function compact(value: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== undefined)); }
function pageLabel(persisted: any, pageId: string, messages: Record<string, string>): string | undefined { return persisted.flow.phases.flatMap((phase: any) => phase.pages).find((page: any) => page.id === pageId)?.titleKey && messages[persisted.flow.phases.flatMap((phase: any) => phase.pages).find((page: any) => page.id === pageId).titleKey]; }
function normalizeExpression(value: any, keyFor: (id: unknown) => string): any { if (Array.isArray(value)) return value.map((item) => normalizeExpression(item, keyFor)); if (!value || typeof value !== 'object') return value; if (value.ref?.fieldId) { const { parentDepth, ...ref } = value.ref; return { ...value, ref: { ...ref, fieldId: keyFor(value.ref.fieldId), ...(parentDepth && parentDepth !== 1 ? { parentDepth } : {}) } }; } return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeExpression(child, keyFor)])); }

function normalizedRoles(value: unknown, expected: unknown): string[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const actual = Object.keys(value as Record<string, unknown>);
  const authoritative = Array.isArray(expected) ? expected.filter((role): role is string => typeof role === 'string') : [];
  return [...authoritative.filter((role) => actual.includes(role)), ...actual.filter((role) => !authoritative.includes(role)).sort()];
}

function assertUntranslatedStructuralPlaceholders(persisted: Record<string, any>): void {
  const translations = persisted.translations ?? {};
  const authoredKeys = Object.keys(translations.en?.messages ?? {}).filter((key) => key.startsWith('authoring.'));
  expect(authoredKeys.length).toBeGreaterThan(0);
  for (const locale of ['hi', 'ar']) {
    const messages = translations[locale]?.messages ?? {};
    for (const key of authoredKeys) {
      expect(Object.prototype.hasOwnProperty.call(messages, key)).toBe(true);
      expect(messages[key]).toBe('');
    }
  }
}

function expectedPlacements(): Record<string, unknown>[] {
  const placement = (key: string, page: string, section: string, control: string, extras: Record<string, unknown> = {}) => {
    const { settings: extraSettings = {}, ...rest } = extras as { settings?: Record<string, unknown> };
    const defaultSettings = key.includes('.') ? {} : {
      allowAdd: false, readOnly: false, allowRemove: false, allowedMime: [], allowReorder: false, alternateInstancesBindSameField: false,
    };
    return { key, page, section, control, settings: { ...defaultSettings, ...extraSettings }, ...rest };
  };
  return [
    ...['respondentName', 'referenceCode', 'email', 'needsSetup', 'setupDetails', 'services', 'otherServiceDetails', 'visitDate', 'extraAttendees'].map((key, index) => placement(key, 'About', 'About', ['shortText', 'identifier', 'email', 'yesNo', 'textarea', 'chips', 'shortText', 'date', 'integer'][index])),
    placement('priority', 'About', 'About', 'rating', { settings: { endpointLowLabel: 'Low priority', endpointHighLabel: 'High priority' } }),
    placement('priorityOrder', 'About', 'About', 'ranking'), placement('entryMode', 'About', 'About', 'modeSelector'),
    placement('equipment', 'Equipment', 'Equipment', 'repeatingCards', { settings: { allowAdd: true, allowRemove: true, allowReorder: true, alternateInstancesBindSameField: true }, summaryFieldIds: ['equipment.equipmentName', 'equipment.quantity'] }),
    placement('equipment.equipmentName', 'Equipment', 'Equipment', 'shortText'), placement('equipment.quantity', 'Equipment', 'Equipment', 'integer'), placement('equipment.unitCost', 'Equipment', 'Equipment', 'currency'), placement('equipment.accessories', 'Equipment', 'Equipment', 'repeatingCards'), placement('equipment.accessories.accessoryName', 'Equipment', 'Equipment', 'shortText'), placement('equipment.accessories.tests', 'Equipment', 'Equipment', 'repeatingCards'), placement('equipment.accessories.tests.testResult', 'Equipment', 'Equipment', 'radio'),
    placement('email', 'Equipment', 'Equipment', 'email', { settings: { readOnly: true } }),
    placement('checks', 'Equipment', 'Equipment', 'fixedMatrix', { settings: { allowAdd: false, allowRemove: false }, fixedRowLabels: { row_power: 'Power available', row_space: 'Space available' } }), placement('checks.checkResult', 'Equipment', 'Equipment', 'yesNo'), placement('checks.checkDetails', 'Equipment', 'Equipment', 'shortText'),
    placement('shipping', 'Equipment', 'Equipment', 'address', { roles: { postalCode: 'shipping.postalCode', country: 'shipping.country' } }), placement('shipping.postalCode', 'Equipment', 'Equipment', 'identifier'), placement('shipping.country', 'Equipment', 'Equipment', 'combobox'), placement('note', 'Equipment', 'Equipment', 'shortText'), placement('total', 'Equipment', 'Equipment', 'currency'), placement('supportingFiles', 'Equipment', 'Equipment', 'fileUpload', { settings: { allowedMime: ['text/plain'], scanReadiness: 'normal' } }),
    placement('reviewAcknowledged', 'Review and submit', 'Review and submit', 'acknowledgment', { settings: { requireTrue: true, finalReviewOnly: true, voiceSupplyProhibited: true }, acknowledgmentContent: 'I confirm this information is accurate.' }),
  ];
}

function expectedExpressions(): Record<string, unknown> {
  const ref = (fieldId: string, scope: 'root' | 'item' | 'parentItem' = 'root') => ({ ref: { fieldId, scope } });
  const literal = (type: string, value: unknown) => ({ literal: { type, value } });
  const binary = (op: string, left: unknown, right: unknown) => ({ op, args: [left, right] });
  const booleans = (op: string) => binary(op, literal('boolean', true), literal('boolean', false));
  return {
    operator_and: booleans('and'), operator_or: booleans('or'), operator_not: { op: 'not', args: [ref('checks.checkResult', 'item')] },
    operator_eq: binary('eq', ref('needsSetup'), literal('boolean', true)), operator_ne: binary('ne', ref('respondentName'), literal('text', 'Ada')),
    operator_lt: binary('lt', ref('extraAttendees'), literal('integer', '1')), operator_lte: binary('lte', ref('extraAttendees'), literal('integer', '1')), operator_gt: binary('gt', ref('extraAttendees'), literal('integer', '1')), operator_gte: binary('gte', ref('extraAttendees'), literal('integer', '1')),
    operator_in: binary('in', literal('text', 'Ada'), { literal: { type: 'array', itemType: 'text', value: ['Ada', 'Grace'] } }), operator_contains: binary('contains', ref('services'), literal('choice', 'opt_other')), operator_containsAll: binary('containsAll', ref('services'), { literal: { type: 'array', itemType: 'choice', value: ['opt_setup', 'opt_other'] } }),
    operator_exists: { op: 'exists', args: [ref('respondentName')] }, operator_isAnswered: { op: 'isAnswered', args: [ref('equipment.accessories.accessoryName', 'parentItem')] }, operator_statusIs: binary('statusIs', ref('respondentName'), literal('text', 'answered')),
    operator_add: binary('add', literal('decimal', '4'), literal('integer', '2')), operator_subtract: binary('subtract', literal('decimal', '4'), literal('integer', '2')), operator_multiply: binary('multiply', literal('decimal', '4'), literal('integer', '2')), operator_divide: binary('divide', literal('decimal', '4'), literal('integer', '2')), operator_round: binary('round', literal('decimal', '4.25'), literal('integer', '1')), operator_min: binary('min', literal('decimal', '4'), literal('integer', '2')), operator_max: binary('max', literal('decimal', '4'), literal('integer', '2')),
    operator_sum: binary('sum', ref('equipment'), binary('multiply', ref('equipment.quantity', 'item'), ref('equipment.unitCost', 'item'))), operator_count: { op: 'count', args: [ref('equipment')] }, operator_any: binary('any', ref('equipment'), binary('gt', ref('equipment.quantity', 'item'), literal('integer', '0'))), operator_all: binary('all', ref('equipment'), binary('gt', ref('equipment.quantity', 'item'), literal('integer', '0'))),
    operator_concat: binary('concat', ref('respondentName'), literal('text', ' request')), operator_length: { op: 'length', args: [ref('respondentName')] }, operator_coalesce: binary('coalesce', ref('respondentName'), literal('text', 'Unknown')), operator_if: { op: 'if', args: [ref('needsSetup'), literal('text', 'yes'), literal('text', 'no')] }, operator_dateDiffDays: binary('dateDiffDays', ref('visitDate'), literal('date', '2026-12-31')), operator_ageYears: binary('ageYears', literal('date', '2000-01-01'), literal('date', '2026-12-31')), operator_dateAddDays: binary('dateAddDays', ref('visitDate'), literal('integer', '1')), operator_today: { op: 'today', args: [] },
  };
}

async function assertIndependentCompiler(page: import('@playwright/test').Page, candidate: Record<string, any>): Promise<void> {
  const route = new URL(page.url()).pathname.match(/^\/workspaces\/([^/]+)\/forms\/([^/]+)\/drafts\/([^/]+)\/author/)!;
  const verdict = await page.evaluate(async ([workspace, form, draft, candidate]) => { const csrf = document.cookie.split('; ').find((cookie) => cookie.startsWith('SI_CSRF='))?.split('=').slice(1).join('='); const response = await fetch(`/v1/workspaces/${workspace}/forms/${form}/authoring/${draft}/imports/validate`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}) }, body: JSON.stringify({ candidate }) }); if (!response.ok) throw new Error(`Independent compiler request failed: ${response.status}`); return response.json(); }, [...route.slice(1), candidate]);
  expect(verdict.state).toBe('VALID'); expect(verdict.diagnostics).toEqual([]);
}
