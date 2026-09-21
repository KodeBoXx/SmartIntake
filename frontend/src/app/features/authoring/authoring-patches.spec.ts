import { describe, expect, it } from 'vitest';
import { applyCanonicalPatches, canonicalPatches, deletionImpact, pageDeletionImpact } from './authoring-patches';
import { authoringDocument } from '../../smart-intake-api.service';
import type { AuthoringDocument } from './authoring.types';

const definition = {
  defaultLocale: 'en',
  data: { fields: [{ id: 'field-a', key: 'field-a', type: 'text', labelKey: 'field-a.label' }] },
  flow: { phases: [{ id: 'phase-a', titleKey: 'phase-a.label', pages: [{ id: 'page-a', titleKey: 'page-a.label', sections: [{ id: 'section-a', titleKey: 'section-a.label', nodes: [{ id: 'node-a', kind: 'question', fieldId: 'field-a', control: 'shortText' }] }] }] }] },
  translations: { en: { direction: 'ltr', messages: { 'field-a.label': 'Name', 'phase-a.label': 'Intake', 'page-a.label': 'Details', 'section-a.label': 'Questions' } } },
  expressions: { whenName: { op: 'eq', args: ['field-a', 'Ada'] } },
};
const document = authoringDocument({ draftId: 'draft-a', revision: 4, definition }) as AuthoringDocument;

describe('canonical authoring patches', () => {
  it('uses the same stable IDs for phase/page/section/node projection and canonical package', () => {
    const command = { type: 'add-phase' as const, entityId: 'phase-new', label: 'New phase' };
    const next = applyCanonicalPatches(definition, canonicalPatches(document, command)) as typeof definition;
    expect(next.flow.phases.at(-1)?.id).toBe('phase-new');
    expect(next.flow.phases.at(-1)?.pages[0].id).toBe('phase-new_page');
    expect(next.flow.phases.at(-1)?.pages[0].sections[0].id).toBe('phase-new_section');
    expect(next.flow.phases.at(-1)?.pages[0].sections[0].nodes[0].id).toBe('phase-new_node');
    expect(next.data.fields.at(-1)?.id).toBe('phase-new_field');
  });

  it('creates valid nested canonical structures for page, section, and node additions', () => {
    let next = applyCanonicalPatches(definition, canonicalPatches(document, { type: 'add-page', targetId: 'phase-a', entityId: 'page-new', label: 'Follow up' })) as typeof definition;
    expect(next.flow.phases[0].pages.at(-1)?.id).toBe('page-new');
    const withPage = authoringDocument({ draftId: 'draft-a', revision: 4, definition: next });
    next = applyCanonicalPatches(next, canonicalPatches(withPage, { type: 'add-section', targetId: 'page-a', entityId: 'section-new', label: 'Extra' })) as typeof definition;
    expect(next.flow.phases[0].pages[0].sections.at(-1)?.id).toBe('section-new');
    const withSection = authoringDocument({ draftId: 'draft-a', revision: 4, definition: next });
    next = applyCanonicalPatches(next, canonicalPatches(withSection, { type: 'add-node', targetId: 'section-a', entityId: 'node-new', fieldId: 'field-new', node: { id: 'node-new', kind: 'field', label: 'Legal name', control: 'shortText' } })) as typeof definition;
    expect(next.flow.phases[0].pages[0].sections[0].nodes.at(-1)?.id).toBe('node-new');
    expect(next.data.fields.at(-1)?.id).toBe('field-new');
    expect((next.translations.en.messages as Record<string, string>)['authoring.field-new.label']).toBe('Legal name');
  });

  it('removes a non-start page and its incoming default and branch routes', () => {
    const withReview = structuredClone(definition) as Record<string, any>;
    withReview.flow.startPageId = 'page-a';
    withReview.flow.phases[0].pages[0].defaultNextPageId = 'page-review';
    withReview.flow.phases[0].pages[0].routes = [{ id: 'route-review', targetPageId: 'page-review', whenExpressionId: 'whenName' }];
    withReview.flow.phases[0].pages.push({ id: 'page-review', titleKey: 'page-review.label', sections: [], routes: [] });
    const projected = authoringDocument({ draftId: 'draft-a', revision: 4, definition: withReview });
    expect(canonicalPatches(projected, { type: 'remove-page', targetId: 'page-review' })).toEqual([]);
    const next = applyCanonicalPatches(withReview, canonicalPatches(projected, { type: 'remove-page', targetId: 'page-review', confirmed: true })) as Record<string, any>;
    expect(next.flow.phases[0].pages.map((page: { id: string }) => page.id)).toEqual(['page-a']);
    expect(next.flow.phases[0].pages[0]).not.toHaveProperty('defaultNextPageId');
    expect(next.flow.phases[0].pages[0].routes).toEqual([]);
    expect(canonicalPatches(projected, { type: 'remove-page', targetId: 'page-a', confirmed: true })).toEqual([]);
  });

  it('removes unique recursive page contents and only their now-orphaned translations after confirmation', () => {
    const unique = structuredClone(definition) as Record<string, any>;
    unique.flow.startPageId = 'page-a';
    unique.data.fields.push({ id: 'review-group', key: 'review-group', type: 'object', labelKey: 'review-group.label', itemSchema: { fields: [{ id: 'review-note', key: 'review-note', type: 'text', labelKey: 'review-note.label' }] } });
    unique.flow.phases[0].pages.push({ id: 'page-review', titleKey: 'page-review.label', sections: [{ id: 'section-review', titleKey: 'section-review.label', nodes: [{ id: 'review-group-node', kind: 'question', fieldId: 'review-group', children: [{ id: 'review-note-node', kind: 'question', fieldId: 'review-note' }] }] }] });
    Object.assign(unique.translations.en.messages, { 'review-group.label': 'Review group', 'review-note.label': 'Review note', 'page-review.label': 'Review', 'section-review.label': 'Review section' });
    const projected = authoringDocument({ draftId: 'draft-a', revision: 4, definition: unique });
    expect(pageDeletionImpact(projected, 'page-review')).toMatchObject({ placements: ['review-group-node', 'review-note-node'], fields: ['review-group', 'review-note'], translations: expect.arrayContaining(['review-group.label', 'review-note.label', 'page-review.label']) });
    const next = applyCanonicalPatches(unique, canonicalPatches(projected, { type: 'remove-page', targetId: 'page-review', confirmed: true })) as Record<string, any>;
    expect(next.data.fields.map((field: { id: string }) => field.id)).toEqual(['field-a']);
    expect(next.translations.en.messages).not.toHaveProperty('review-group.label');
    expect(next.translations.en.messages).not.toHaveProperty('review-note.label');
    expect(next.translations.en.messages).not.toHaveProperty('page-review.label');
  });

  it('preserves shared field definitions and translations when deleting one page placement', () => {
    const shared = structuredClone(definition) as Record<string, any>;
    shared.flow.startPageId = 'page-a';
    shared.flow.phases[0].pages.push({ id: 'page-review', titleKey: 'page-review.label', sections: [{ id: 'section-review', titleKey: 'section-review.label', nodes: [{ id: 'shared-node', kind: 'question', fieldId: 'field-a', control: 'shortText' }] }] });
    Object.assign(shared.translations.en.messages, { 'page-review.label': 'Review', 'section-review.label': 'Review section' });
    const projected = authoringDocument({ draftId: 'draft-a', revision: 4, definition: shared });
    expect(pageDeletionImpact(projected, 'page-review')).toMatchObject({ fields: [], translations: ['page-review.label', 'section-review.label'] });
    const next = applyCanonicalPatches(shared, canonicalPatches(projected, { type: 'remove-page', targetId: 'page-review', confirmed: true })) as Record<string, any>;
    expect(next.data.fields).toEqual([definition.data.fields[0]]);
    expect(next.translations.en.messages['field-a.label']).toBe('Name');
  });

  it('requires confirmation and retains dependent expressions while atomically deleting a unique page field', () => {
    const dependent = structuredClone(definition) as Record<string, any>;
    dependent.flow.startPageId = 'page-a';
    dependent.data.fields.push({ id: 'review-answer', key: 'review-answer', type: 'text', labelKey: 'review-answer.label' });
    dependent.expressions = { usesReview: { op: 'exists', args: [{ ref: { fieldId: 'review-answer', scope: 'root' } }] } };
    dependent.flow.phases[0].pages[0].routes = [{ id: 'route-dependent', targetPageId: 'page-a', whenExpressionId: 'usesReview' }];
    dependent.flow.phases[0].pages.push({ id: 'page-review', titleKey: 'page-review.label', sections: [{ id: 'section-review', titleKey: 'section-review.label', nodes: [{ id: 'review-answer-node', kind: 'question', fieldId: 'review-answer', control: 'shortText' }] }] });
    Object.assign(dependent.translations.en.messages, { 'review-answer.label': 'Review answer', 'page-review.label': 'Review', 'section-review.label': 'Review section' });
    const projected = authoringDocument({ draftId: 'draft-a', revision: 4, definition: dependent });
    expect(pageDeletionImpact(projected, 'page-review')).toMatchObject({ fields: ['review-answer'], expressions: ['usesReview'], routes: ['route-dependent'] });
    expect(canonicalPatches(projected, { type: 'remove-page', targetId: 'page-review' })).toEqual([]);
    const next = applyCanonicalPatches(dependent, canonicalPatches(projected, { type: 'remove-page', targetId: 'page-review', confirmed: true, acceptInvalidDraft: true })) as Record<string, any>;
    expect(next.data.fields.map((field: { id: string }) => field.id)).toEqual(['field-a']);
    expect(next.expressions).toHaveProperty('usesReview');
    expect(next.flow.phases[0].pages[0].routes).toEqual([{ id: 'route-dependent', targetPageId: 'page-a', whenExpressionId: 'usesReview' }]);
  });

  it('sets and clears a page default route through canonical pointers', () => {
    const projected = authoringDocument({ draftId: 'draft-a', revision: 4, definition });
    const added = applyCanonicalPatches(definition, canonicalPatches(projected, { type: 'set-default-next', targetId: 'page-a', destinationId: 'page-b' })) as Record<string, any>;
    expect(added.flow.phases[0].pages[0].defaultNextPageId).toBe('page-b');
    const next = authoringDocument({ draftId: 'draft-a', revision: 4, definition: added });
    const cleared = applyCanonicalPatches(added, canonicalPatches(next, { type: 'set-default-next', targetId: 'page-a', destinationId: '' })) as Record<string, any>;
    expect(cleared.flow.phases[0].pages[0]).not.toHaveProperty('defaultNextPageId');
  });

  it('renames through translations, preserves dependent expressions as repairable diagnostics, and moves nodes by canonical pointer', () => {
    const renamed = applyCanonicalPatches(definition, canonicalPatches(document, { type: 'rename', targetId: 'node-a', label: 'Legal name' })) as typeof definition;
    expect(renamed.data.fields[0].labelKey).toBe('field-a.label');
    expect((renamed.translations.en.messages as Record<string, string>)['field-a.label']).toBe('Legal name');
    const removed = applyCanonicalPatches(definition, canonicalPatches(document, { type: 'remove-node', targetId: 'node-a' })) as typeof definition;
    expect(removed.data.fields).toEqual([]);
    expect(removed.expressions).toEqual(definition.expressions);

    const withSecondSection = structuredClone(definition);
    withSecondSection.flow.phases[0].pages[0].sections.push({ id: 'section-b', titleKey: 'section-b.label', nodes: [{ id: 'node-b', kind: 'question', fieldId: 'field-a', control: 'shortText' }] });
    const moveDocument = authoringDocument({ draftId: 'draft-a', revision: 4, definition: withSecondSection });
    const moved = applyCanonicalPatches(withSecondSection, canonicalPatches(moveDocument, { type: 'move', targetId: 'node-a', destinationId: 'section-b' })) as typeof withSecondSection;
    expect(moved.flow.phases[0].pages[0].sections[0].nodes).toEqual([]);
    expect(moved.flow.phases[0].pages[0].sections[1].nodes.map((node) => node.id)).toEqual(['node-b', 'node-a']);
  });

  it('renames through an existing message key and resolves labels correctly in English, Hindi, and Arabic', () => {
    const localized = structuredClone(definition) as Record<string, any>;
    localized.supportedLocales = ['en', 'hi', 'ar'];
    localized.translations = {
      en: localized.translations.en,
      hi: { direction: 'ltr', messages: { ...localized.translations.en.messages, 'field-a.label': 'नाम', 'page-a.label': 'विवरण' } },
      ar: { direction: 'rtl', messages: { ...localized.translations.en.messages, 'field-a.label': 'الاسم', 'page-a.label': 'تفاصيل' } },
    };
    const beforeHindi = structuredClone(localized.translations.hi);
    const beforeArabic = structuredClone(localized.translations.ar);
    const hindi = applyCanonicalPatches(localized, canonicalPatches(authoringDocument({ draftId: 'draft-a', revision: 4, definition: localized }), { type: 'rename', targetId: 'node-a', label: 'नाम बदलें', locale: 'hi' })) as Record<string, any>;
    expect(hindi.data.fields[0].labelKey).toBe('field-a.label');
    expect(resolvedLabel(hindi, 'en', hindi.data.fields[0].labelKey)).toBe('Name');
    expect(resolvedLabel(hindi, 'hi', hindi.data.fields[0].labelKey)).toBe('नाम बदलें');
    expect(resolvedLabel(hindi, 'ar', hindi.data.fields[0].labelKey)).toBe('الاسم');
    expect(hindi.translations.ar).toEqual(beforeArabic);
    const hindiPage = applyCanonicalPatches(hindi, canonicalPatches(authoringDocument({ draftId: 'draft-a', revision: 4, definition: hindi }), { type: 'rename', targetId: 'page-a', label: 'पृष्ठ', locale: 'hi' })) as Record<string, any>;
    expect(hindiPage.flow.phases[0].pages[0].titleKey).toBe('page-a.label');
    expect(resolvedLabel(hindiPage, 'en', hindiPage.flow.phases[0].pages[0].titleKey)).toBe('Details');
    expect(resolvedLabel(hindiPage, 'hi', hindiPage.flow.phases[0].pages[0].titleKey)).toBe('पृष्ठ');
    expect(resolvedLabel(hindiPage, 'ar', hindiPage.flow.phases[0].pages[0].titleKey)).toBe('تفاصيل');
    const english = applyCanonicalPatches(hindiPage, canonicalPatches(authoringDocument({ draftId: 'draft-a', revision: 4, definition: hindiPage }), { type: 'rename', targetId: 'node-a', label: 'Renamed', locale: 'en' })) as Record<string, any>;
    expect(resolvedLabel(english, 'en', english.data.fields[0].labelKey)).toBe('Renamed');
    expect(resolvedLabel(english, 'hi', english.data.fields[0].labelKey)).toBe('नाम बदलें');
    expect(resolvedLabel(english, 'ar', english.data.fields[0].labelKey)).toBe('الاسم');
    expect(english.translations.hi).toEqual(hindiPage.translations.hi);
    expect(english.translations.ar).toEqual(beforeArabic);
    expect(beforeHindi.messages['field-a.label']).toBe('नाम');
  });

  it('writes typed field settings, canonical expressions, and branch routes without a JSON editor', () => {
    let next = applyCanonicalPatches(definition, canonicalPatches(document, {
      type: 'update-field', targetId: 'node-a', field: {
        control: 'radio', constraints: { required: true }, descriptionKey: 'field-a.label.help', help: 'Choose one option',
        options: [{ id: 'yes', labelKey: 'field-a.yes', label: 'Yes' }, { id: 'no', labelKey: 'field-a.no', label: 'No' }],
      },
    })) as typeof definition;
    expect(next.data.fields[0]).toMatchObject({ type: 'choice', constraints: { required: true }, options: [{ id: 'yes' }, { id: 'no' }] });
    expect(next.data.fields[0]).not.toHaveProperty('control');
    expect(next.data.fields[0]).not.toHaveProperty('help');
    expect(((next.data.fields[0] as unknown as { options: unknown[] }).options[0])).not.toHaveProperty('label');
    expect(next.flow.phases[0].pages[0].sections[0].nodes[0]).toMatchObject({ control: 'radio', fieldType: 'choice' });
    expect((next.translations.en.messages as Record<string, string>)['field-a.yes']).toBe('Yes');
    const configured = authoringDocument({ draftId: 'draft-a', revision: 4, definition: next });
    next = applyCanonicalPatches(next, canonicalPatches(configured, { type: 'set-expression', expressionId: 'isYes', expression: { op: 'eq', args: [{ ref: { fieldId: 'field-a', scope: 'root' } }, { literal: { type: 'choice', value: 'yes' } }] } })) as typeof definition;
    const withExpression = authoringDocument({ draftId: 'draft-a', revision: 4, definition: next });
    next = applyCanonicalPatches(next, canonicalPatches(withExpression, { type: 'set-route', targetId: 'page-a', route: { id: 'route-next', targetPageId: 'page-next', whenExpressionId: 'isYes' } })) as typeof definition;
    expect((next.expressions as Record<string, unknown>).isYes).toMatchObject({ op: 'eq' });
    expect((next.flow.phases[0].pages[0] as unknown as { routes?: unknown[] }).routes).toEqual([{ id: 'route-next', targetPageId: 'page-next', whenExpressionId: 'isYes' }]);
  });

  it('retains a shared field definition until its final visual placement is removed', () => {
    const shared = structuredClone(definition);
    shared.flow.phases[0].pages[0].sections[0].nodes.push({ id: 'node-b', kind: 'question', fieldId: 'field-a', control: 'shortText' });
    const sharedDocument = authoringDocument({ draftId: 'draft-a', revision: 4, definition: shared });
    const once = applyCanonicalPatches(shared, canonicalPatches(sharedDocument, { type: 'remove-node', targetId: 'node-a' })) as typeof shared;
    expect(once.data.fields).toHaveLength(1);
    const afterFirst = authoringDocument({ draftId: 'draft-a', revision: 4, definition: once });
    const final = applyCanonicalPatches(once, canonicalPatches(afterFirst, { type: 'remove-node', targetId: 'node-b' })) as typeof shared;
    expect(final.data.fields).toEqual([]);
  });

  it('finds nested field definitions and does not remove their expressions while any recursive placement survives', () => {
    const recursive = structuredClone(definition) as typeof definition & { data: { fields: Array<Record<string, unknown>> }; flow: { phases: Array<Record<string, unknown>> } };
    recursive.data.fields = [{ id: 'group', key: 'group', type: 'object', labelKey: 'group.label', itemSchema: { fields: [{ id: 'field-a', key: 'field-a', type: 'text', labelKey: 'field-a.label' }] } }];
    (recursive.flow.phases[0].pages[0].sections[0].nodes as unknown) = [{ id: 'outer', kind: 'group', children: [{ id: 'node-a', kind: 'question', fieldId: 'field-a', control: 'shortText' }, { id: 'node-b', kind: 'question', fieldId: 'field-a', control: 'shortText' }] }];
    const nestedDocument = authoringDocument({ draftId: 'draft-a', revision: 4, definition: recursive });
    const once = applyCanonicalPatches(recursive, canonicalPatches(nestedDocument, { type: 'remove-node', targetId: 'node-a' })) as typeof recursive;
    expect(once.data.fields[0].itemSchema).toBeDefined();
    expect(once.expressions).toHaveProperty('whenName');
    const finalDocument = authoringDocument({ draftId: 'draft-a', revision: 4, definition: once });
    const rejected = applyCanonicalPatches(once, canonicalPatches(finalDocument, { type: 'remove-node', targetId: 'node-b' })) as typeof recursive;
    // A final nested deletion must not silently cascade to its enclosing composite.
    expect(rejected.data.fields).toHaveLength(1);
    expect(rejected.data.fields[0].itemSchema).toBeDefined();
    const final = applyCanonicalPatches(once, canonicalPatches(finalDocument, { type: 'remove-node', targetId: 'node-b', cascade: true })) as typeof recursive;
    expect(final.data.fields).toEqual([]);
    expect(final.expressions).toEqual(definition.expressions);
  });

  it('projects each recursive placement separately and reports all destructive dependencies before deletion', () => {
    const recursive = structuredClone(definition) as typeof definition & { data: { fields: Array<Record<string, unknown>> }; flow: { phases: Array<Record<string, unknown>> } };
    recursive.data.fields = [{ id: 'group', key: 'group', type: 'object', labelKey: 'group.label', itemSchema: { fields: [{ id: 'shared-child', key: 'shared-child', type: 'text', labelKey: 'child.label' }] } }];
    (recursive.flow.phases[0].pages[0].sections[0].nodes as unknown) = [
      { id: 'placement-one', kind: 'question', fieldId: 'group', children: [{ id: 'placement-one-child', kind: 'question', fieldId: 'shared-child' }] },
      { id: 'placement-two', kind: 'question', fieldId: 'group', children: [{ id: 'placement-two-child', kind: 'question', fieldId: 'shared-child' }] },
    ];
    (recursive as unknown as { expressions: Record<string, unknown> }).expressions = { usesChild: { op: 'exists', args: [{ ref: { fieldId: 'shared-child', scope: 'root' } }] } };
    const projected = authoringDocument({ draftId: 'draft-a', revision: 4, definition: recursive });
    const children = projected.phases[0].pages[0].sections[0].nodes.flatMap((node) => node.children ?? []);
    expect(children.map((node) => [node.id, node.fieldId, node.placementId, node.placementPath])).toEqual([
      ['placement-one-child', 'shared-child', 'placement-one-child', '/flow/phases/0/pages/0/sections/0/nodes/0/children/0'],
      ['placement-two-child', 'shared-child', 'placement-two-child', '/flow/phases/0/pages/0/sections/0/nodes/1/children/0'],
    ]);
    expect(deletionImpact(projected, 'placement-one-child').placements).toEqual(['placement-one-child']);
    const afterOne = applyCanonicalPatches(recursive, canonicalPatches(projected, { type: 'remove-node', targetId: 'placement-one-child' }));
    const finalProjection = authoringDocument({ draftId: 'draft-a', revision: 4, definition: afterOne });
    expect(deletionImpact(finalProjection, 'placement-two-child')).toMatchObject({ placements: ['placement-two-child'], expressions: ['usesChild'], translations: ['child.label'] });
  });

  it('canonicalizes stale control-specific settings when an author changes destination', () => {
    const configured = structuredClone(definition);
    (configured.data.fields as unknown as Array<Record<string, unknown>>)[0] = { ...configured.data.fields[0], type: 'choice', options: [{ id: 'yes', labelKey: 'yes' }], itemSchema: { fields: [] }, unit: 'USD', ordered: true, calculated: true, mode: 'calculated', constraints: { min: 1, maxItems: 3, exclusiveOptionIds: ['yes'] } };
    const configuredDocument = authoringDocument({ draftId: 'draft-a', revision: 4, definition: configured });
    const next = applyCanonicalPatches(configured, canonicalPatches(configuredDocument, { type: 'update-field', targetId: 'node-a', field: { control: 'shortText' } })) as typeof configured;
    expect(next.data.fields[0]).toMatchObject({ type: 'text' });
    expect(next.data.fields[0]).not.toHaveProperty('options');
    expect(next.data.fields[0]).not.toHaveProperty('itemSchema');
    expect(next.data.fields[0]).not.toHaveProperty('unit');
    expect(next.data.fields[0]).not.toHaveProperty('calculated');
  });

  it('keeps composite labels in translations and creates a dependency-bound calculated extension', () => {
    const next = applyCanonicalPatches(definition, canonicalPatches(document, {
      type: 'update-field', targetId: 'node-a', field: {
        control: 'calculated', calculated: true, mode: 'calculated',
        extensions: { 'x-kodeboxx.calculation': { dependencyId: 'calculation_runtime', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}`, value: 'whenName' } },
      },
    })) as typeof definition & { dependencies: unknown[] };
    expect(next.data.fields[0]).not.toHaveProperty('control');
    expect(next.dependencies).toEqual([{ kind: 'extension', id: 'calculation_runtime', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` }]);
  });

  it('persists recursive question placements alongside composite fields', () => {
    const next = applyCanonicalPatches(definition, canonicalPatches(document, {
      type: 'update-field', targetId: 'node-a', field: {
        control: 'contact', itemSchema: { fields: [{ id: 'child-email', key: 'email', type: 'text', labelKey: 'authoring.field-a.child.email', __label: 'Email' }] },
      },
    })) as typeof definition;
    expect((next.data.fields[0] as unknown as { itemSchema: { fields: Array<Record<string, unknown>> } }).itemSchema.fields[0]).toMatchObject({ id: 'child-email', key: 'email', type: 'text' });
    expect(next.flow.phases[0].pages[0].sections[0].nodes[0]).toMatchObject({ children: [{ id: 'placement_child-email', kind: 'question', fieldId: 'child-email' }] });
    expect((next.translations.en.messages as Record<string, string>)['authoring.field-a.child.email']).toBe('Email');
  });

  it('serializes fixed matrix labels and clears optional destination settings', () => {
    const next = applyCanonicalPatches(definition, canonicalPatches(document, {
      type: 'update-field', targetId: 'node-a', field: {
        control: 'fixedMatrix', sensitivity: null, guidanceId: null, fixedRows: [{ id: 'row_one', labelKey: 'authoring.field-a.row.row_one', label: 'Row one' }],
        fixedRowLabels: { row_one: 'authoring.field-a.row.row_one' }, itemSchema: { fields: [{ id: 'row_value', key: 'value', type: 'text', labelKey: 'authoring.field-a.row.value' }] },
      },
    })) as typeof definition;
    expect((next.data.fields[0] as unknown as { constraints: { fixedItemIds: string[] } }).constraints.fixedItemIds).toEqual(['row_one']);
    expect((next.flow.phases[0].pages[0].sections[0].nodes[0] as unknown as { fixedRowLabels: Record<string, string> }).fixedRowLabels.row_one).toBe('authoring.field-a.row.row_one');
    expect((next.translations.en.messages as Record<string, string>)['authoring.field-a.row.row_one']).toBe('Row one');
    const clearedDocument = authoringDocument({ draftId: 'draft-a', revision: 4, definition: next });
    const cleared = applyCanonicalPatches(next, canonicalPatches(clearedDocument, {
      type: 'update-field', targetId: 'node-a', field: { control: 'fixedMatrix', fixedRows: [], fixedRowLabels: null },
    })) as typeof definition;
    expect((cleared.data.fields[0] as unknown as { constraints?: { fixedItemIds?: string[] } }).constraints?.fixedItemIds).toBeUndefined();
  });
});

function resolvedLabel(definition: Record<string, any>, locale: 'en' | 'hi' | 'ar', messageKey: string): string | undefined {
  return definition.translations[locale]?.messages?.[messageKey];
}
