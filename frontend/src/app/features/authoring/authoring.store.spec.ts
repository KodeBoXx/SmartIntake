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
});
