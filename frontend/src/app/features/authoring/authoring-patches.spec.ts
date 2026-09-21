import { describe, expect, it } from 'vitest';
import { applyCanonicalPatches, canonicalPatches } from './authoring-patches';
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

  it('renames through translations, removes data and dependent expressions, and moves nodes by canonical pointer', () => {
    const renamed = applyCanonicalPatches(definition, canonicalPatches(document, { type: 'rename', targetId: 'node-a', label: 'Legal name' })) as typeof definition;
    expect(renamed.translations.en.messages['field-a.label']).toBe('Legal name');
    const removed = applyCanonicalPatches(definition, canonicalPatches(document, { type: 'remove-node', targetId: 'node-a' })) as typeof definition;
    expect(removed.data.fields).toEqual([]);
    expect(removed.expressions).toEqual({});

    const withSecondSection = structuredClone(definition);
    withSecondSection.flow.phases[0].pages[0].sections.push({ id: 'section-b', titleKey: 'section-b.label', nodes: [{ id: 'node-b', kind: 'question', fieldId: 'field-a', control: 'shortText' }] });
    const moveDocument = authoringDocument({ draftId: 'draft-a', revision: 4, definition: withSecondSection });
    const moved = applyCanonicalPatches(withSecondSection, canonicalPatches(moveDocument, { type: 'move', targetId: 'node-a', destinationId: 'section-b' })) as typeof withSecondSection;
    expect(moved.flow.phases[0].pages[0].sections[0].nodes).toEqual([]);
    expect(moved.flow.phases[0].pages[0].sections[1].nodes.map((node) => node.id)).toEqual(['node-b', 'node-a']);
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
});
