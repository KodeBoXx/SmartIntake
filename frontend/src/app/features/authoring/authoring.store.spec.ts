import { describe, expect, it, beforeEach } from 'vitest';
import { AuthoringStore } from './authoring.store';
import { DEFAULT_AUTHORING_DOCUMENT } from './authoring.types';

describe('AuthoringStore', () => {
  beforeEach(() => localStorage.clear());

  it('keeps canonical phase/page/section/node hierarchy and at least 100 undo steps across reload', () => {
    const key = 'authoring.test';
    const store = new AuthoringStore();
    store.hydrate(key, { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-1' });
    const nodeId = DEFAULT_AUTHORING_DOCUMENT.phases[0].pages[0].sections[0].nodes[0].id;
    for (let index = 0; index < 105; index++) store.apply({ type: 'rename', targetId: nodeId, label: `Name ${index}` }, key);
    expect(store.document().phases[0].pages[0].sections[0].nodes[0].id).toBe(nodeId);
    expect(store.canUndo()).toBe(true);
    for (let index = 0; index < 100; index++) store.undo(key);
    expect(store.document().phases[0].pages[0].sections[0].nodes[0].label).toBe('Name 4');

    const reloaded = new AuthoringStore();
    reloaded.hydrate(key, { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-1' });
    expect(reloaded.canRedo()).toBe(true);
    expect(reloaded.document().phases[0].pages[0].sections[0].nodes[0].id).toBe(nodeId);
  });

  it('links newly added visual nodes to their canonical fields immediately', () => {
    const key = 'authoring.new-field-selection';
    const store = new AuthoringStore();
    const server = {
      ...DEFAULT_AUTHORING_DOCUMENT,
      id: 'draft-new-field',
      definition: {
        contractVersion: '4.0.0',
        data: { fields: [] },
        flow: { phases: [{ id: 'phase-intake', pages: [{ id: 'page-details', sections: [{ id: 'section-main', nodes: [] }] }] }] },
        translations: { en: { messages: {} } },
      },
    };
    store.hydrate(key, server);

    store.apply({ type: 'add-node', targetId: 'section-main', entityId: 'node-new', label: 'New field', node: { id: 'node-new', kind: 'field', label: 'New field', control: 'shortText' } }, key);

    expect(store.document().phases[0].pages[0].sections[0].nodes.at(-1)).toMatchObject({
      id: 'node-new',
      fieldId: 'node-new_field',
      placementId: 'node-new',
    });
    expect((store.document().definition as { data: { fields: { id: string }[] } }).data.fields.at(-1)?.id).toBe('node-new_field');
  });

  it('links starter questions created with new structural containers', () => {
    const key = 'authoring.new-structure-selection';
    const store = new AuthoringStore();
    const server = {
      ...DEFAULT_AUTHORING_DOCUMENT,
      id: 'draft-new-structure',
      definition: {
        contractVersion: '4.0.0',
        data: { fields: [] },
        flow: { phases: [] },
        translations: { en: { messages: {} } },
      },
    };
    store.hydrate(key, server);

    store.apply({ type: 'add-phase', entityId: 'phase-new', label: 'New phase' }, key);

    expect(store.document().phases.at(-1)?.pages[0].sections[0].nodes[0]).toMatchObject({
      id: 'phase-new_node',
      fieldId: 'phase-new_field',
      placementId: 'phase-new_node',
    });
  });

  it('renames only the selected structural container', () => {
    const key = 'authoring.structure-rename';
    const store = new AuthoringStore();
    store.hydrate(key, { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-structure-rename' });
    const original = store.document().phases[0];

    store.apply({ type: 'rename', targetId: original.id, label: 'Request' }, key);

    const renamed = store.document().phases[0];
    expect(renamed.title).toBe('Request');
    expect(renamed.pages[0].title).toBe(original.pages[0].title);
    expect(renamed.pages[0].sections[0].title).toBe(original.pages[0].sections[0].title);
  });

  it('retains both documents when a revision conflict occurs', () => {
    const store = new AuthoringStore();
    const client = { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-2', title: 'Client' };
    const server = { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-2', title: 'Server', revision: 4 };
    store.setConflict(client, server);
    expect(store.conflict()?.client.title).toBe('Client');
    expect(store.conflict()?.server.title).toBe('Server');
  });

  it('persists one command-batch idempotency key until the server accepts the batch', () => {
    const key = 'authoring.idempotency';
    const store = new AuthoringStore();
    store.hydrate(key, { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-3' });
    store.apply({ type: 'rename', targetId: 'field-name', label: 'Legal name' }, key);
    const mutationKey = store.commandBatchKey(key);
    expect(store.commandBatchKey(key)).toBe(mutationKey);

    const reloaded = new AuthoringStore();
    reloaded.hydrate(key, { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-3' });
    expect(reloaded.commandBatchKey(key)).toBe(mutationKey);
    reloaded.acceptServer({ ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-3', revision: 1 }, key);
    expect(reloaded.pendingMutationKey()).toBeNull();
  });

  it('rotates a command key when undo or redo changes the pending batch and restores redo work', () => {
    const key = 'authoring.pending-redo';
    const store = new AuthoringStore();
    store.hydrate(key, { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-5' });
    store.apply({ type: 'rename', targetId: 'field-name', label: 'Legal name' }, key);
    const beforeUndo = store.commandBatchKey(key);
    store.undo(key);
    expect(store.pendingCommands()).toEqual([]);
    expect(store.redoPendingCommands()).toHaveLength(1);
    expect(store.pendingMutationKey()).toBeNull();
    store.redo(key);
    expect(store.pendingCommands()).toHaveLength(1);
    expect(store.commandBatchKey(key)).not.toBe(beforeUndo);
  });

  it('keeps retained conflict evidence across reload even when the server revision advances', () => {
    const key = 'authoring.conflict-reload';
    const store = new AuthoringStore();
    const client = { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-6', title: 'Client version' };
    const server = { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-6', title: 'Server version', revision: 4 };
    store.hydrate(key, client);
    store.setConflict(client, server, 'conflict-1', 'Retained server conflict', key);

    const reloaded = new AuthoringStore();
    reloaded.hydrate(key, { ...server, revision: 5 });
    expect(reloaded.document().revision).toBe(5);
    expect(reloaded.conflict()).toMatchObject({ id: 'conflict-1', client: { title: 'Client version' }, server: { title: 'Server version' } });
  });

  it('retains a pinned component insertion key for the same revision and path', () => {
    const key = 'authoring.component-idempotency';
    const store = new AuthoringStore();
    store.hydrate(key, { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-4' });
    const insertionKey = store.componentInsertionKey(key, 2, 'address', '/flow/phases/0/pages/0/sections/0/nodes/-');
    expect(store.componentInsertionKey(key, 2, 'address', '/flow/phases/0/pages/0/sections/0/nodes/-')).toBe(insertionKey);
    expect(store.componentInsertionKey(key, 3, 'address', '/flow/phases/0/pages/0/sections/0/nodes/-')).not.toBe(insertionKey);
  });

  it('retires completed comment keys and clears denied-resource cache state', () => {
    const key = 'authoring.completed-comment';
    const store = new AuthoringStore();
    store.hydrate(key, { ...DEFAULT_AUTHORING_DOCUMENT, id: 'draft-7' });
    const first = store.operationKey(key, 'comment', 'same-body');
    store.completeOperation(key, 'comment', 'same-body');
    expect(store.operationKey(key, 'comment', 'same-body')).not.toBe(first);

    store.clearCachedState(key);
    expect(localStorage.getItem(key)).toBeNull();
    expect(store.operationKeys()).toEqual({});
    expect(store.document()).toEqual(DEFAULT_AUTHORING_DOCUMENT);
  });
});
