import { Injectable, computed, signal } from '@angular/core';
import { AuthoringCommand, AuthoringConflict, AuthoringDocument, AuthoringHistoryEntry, AuthoringNode, DEFAULT_AUTHORING_DOCUMENT } from './authoring.types';
import { applyCanonicalPatches, canonicalPatches } from './authoring-patches';

const HISTORY_LIMIT = 120;

type PersistedAuthoringState = {
  document: AuthoringDocument;
  undo: readonly AuthoringDocument[];
  redo: readonly AuthoringDocument[];
  history: readonly AuthoringHistoryEntry[];
  selectedId: string | null;
  pending: readonly AuthoringCommand[];
  redoPending: readonly AuthoringCommand[];
  pendingMutationKey: string | null;
  componentInsertionKeys: Record<string, string>;
  operationKeys: Record<string, string>;
  conflict: AuthoringConflict | null;
};

@Injectable({ providedIn: 'root' })
export class AuthoringStore {
  readonly document = signal<AuthoringDocument>(DEFAULT_AUTHORING_DOCUMENT);
  readonly selectedId = signal<string | null>(DEFAULT_AUTHORING_DOCUMENT.phases[0].pages[0].sections[0].nodes[0].id);
  readonly undoStack = signal<readonly AuthoringDocument[]>([]);
  readonly redoStack = signal<readonly AuthoringDocument[]>([]);
  readonly history = signal<readonly AuthoringHistoryEntry[]>([]);
  readonly pendingCommands = signal<readonly AuthoringCommand[]>([]);
  /** Commands removed by a local undo; redoing must put them back into the save batch. */
  readonly redoPendingCommands = signal<readonly AuthoringCommand[]>([]);
  /** Kept with unsaved commands so a manual retry replays the same logical batch. */
  readonly pendingMutationKey = signal<string | null>(null);
  readonly componentInsertionKeys = signal<Record<string, string>>({});
  readonly operationKeys = signal<Record<string, string>>({});
  readonly conflict = signal<AuthoringConflict | null>(null);
  readonly loading = signal(true);
  readonly dirty = computed(() => this.pendingCommands().length > 0 || this.redoPendingCommands().length > 0);
  readonly canUndo = computed(() => this.undoStack().length > 0 || this.history().some((entry) => !entry.undone && !['UNDO', 'REDO'].includes(entry.label.replaceAll(' ', '_'))));
  readonly canRedo = computed(() => this.redoStack().length > 0 || this.history().some((entry) => entry.undone));

  hydrate(key: string, server: AuthoringDocument): void {
    const saved = this.read(key);
    if (saved && saved.document.id === server.id && saved.document.revision >= server.revision) {
      this.document.set(saved.document);
      this.undoStack.set(saved.undo.slice(-HISTORY_LIMIT));
      this.redoStack.set(saved.redo.slice(-HISTORY_LIMIT));
      this.history.set(saved.history.slice(-HISTORY_LIMIT));
      this.selectedId.set(saved.selectedId ?? firstSelectable(saved.document));
      this.pendingCommands.set(saved.pending ?? []);
      this.redoPendingCommands.set(saved.redoPending ?? []);
      this.pendingMutationKey.set(saved.pendingMutationKey ?? null);
      this.componentInsertionKeys.set(saved.componentInsertionKeys ?? {});
      this.operationKeys.set(saved.operationKeys ?? {});
      this.conflict.set(saved.conflict ?? null);
    } else {
      this.document.set(server);
      this.selectedId.set(firstSelectable(server));
      // A retained server conflict is evidence, not a cacheable draft projection. Keep both
      // packages available even when a newer server revision correctly wins hydration.
      this.conflict.set(saved?.conflict ?? null);
    }
    this.loading.set(false);
  }

  select(id: string | null): void { this.selectedId.set(id); }

  apply(command: AuthoringCommand, key: string): void {
    const before = this.document();
    const stable = materializeIds(command);
    const enriched = { ...stable, patches: stable.patches ?? canonicalPatches(before, stable) };
    const rendered = applyCommand(before, enriched);
    const next = { ...rendered, definition: applyCanonicalPatches(before.definition, enriched.patches ?? []) };
    if (next === before) return;
    this.undoStack.set([...this.undoStack(), before].slice(-HISTORY_LIMIT));
    this.redoStack.set([]);
    this.pendingCommands.set([...this.pendingCommands(), enriched]);
    this.redoPendingCommands.set([]);
    this.pendingMutationKey.set(null);
    this.componentInsertionKeys.set({});
    this.document.set(next);
    this.selectedId.set(enriched.node?.id ?? enriched.targetId ?? this.selectedId());
    this.history.set([{ id: crypto.randomUUID(), label: enriched.label ?? enriched.type, at: new Date().toISOString(), impact: impactFor(enriched) }, ...this.history()].slice(0, HISTORY_LIMIT));
    this.persist(key);
  }

  undo(key: string): AuthoringDocument | null {
    const previous = this.undoStack().at(-1);
    if (!previous) return null;
    const undone = this.pendingCommands().at(-1);
    this.undoStack.set(this.undoStack().slice(0, -1));
    this.redoStack.set([...this.redoStack(), this.document()].slice(-HISTORY_LIMIT));
    this.document.set(previous);
    this.pendingCommands.set(this.pendingCommands().slice(0, -1));
    if (undone) this.redoPendingCommands.set([...this.redoPendingCommands(), undone]);
    this.pendingMutationKey.set(null);
    this.history.set([{ id: crypto.randomUUID(), label: 'Undo', at: new Date().toISOString() }, ...this.history()].slice(0, HISTORY_LIMIT));
    this.persist(key);
    return previous;
  }

  redo(key: string): AuthoringDocument | null {
    const next = this.redoStack().at(-1);
    if (!next) return null;
    this.redoStack.set(this.redoStack().slice(0, -1));
    this.undoStack.set([...this.undoStack(), this.document()].slice(-HISTORY_LIMIT));
    this.document.set(next);
    const restored = this.redoPendingCommands().at(-1);
    if (restored) {
      this.redoPendingCommands.set(this.redoPendingCommands().slice(0, -1));
      this.pendingCommands.set([...this.pendingCommands(), restored]);
      this.pendingMutationKey.set(null);
    }
    this.history.set([{ id: crypto.randomUUID(), label: 'Redo', at: new Date().toISOString() }, ...this.history()].slice(0, HISTORY_LIMIT));
    this.persist(key);
    return next;
  }

  acceptServer(document: AuthoringDocument, key: string): void {
    this.document.set(document);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.pendingCommands.set([]);
    this.redoPendingCommands.set([]);
    this.pendingMutationKey.set(null);
    this.conflict.set(null);
    this.persist(key);
  }

  commandBatchKey(key: string): string {
    const existing = this.pendingMutationKey();
    if (existing) return existing;
    const next = crypto.randomUUID();
    this.pendingMutationKey.set(next);
    this.persist(key);
    return next;
  }

  componentInsertionKey(storageKey: string, revision: number, componentKey: string, path: string): string {
    const mutation = `${revision}:${componentKey}:${path}`;
    const existing = this.componentInsertionKeys()[mutation];
    if (existing) return existing;
    const next = crypto.randomUUID();
    this.componentInsertionKeys.update((keys) => ({ ...keys, [mutation]: next }));
    this.persist(storageKey);
    return next;
  }

  operationKey(storageKey: string, operation: string, identity: string): string {
    const key = `${operation}:${identity}`;
    const existing = this.operationKeys()[key];
    if (existing) return existing;
    const next = crypto.randomUUID();
    this.operationKeys.update((keys) => ({ ...keys, [key]: next }));
    this.persist(storageKey);
    return next;
  }

  setConflict(client: AuthoringDocument, server: AuthoringDocument, id = '', message = 'This draft changed on the server. Choose a version to continue.', storageKey?: string): void {
    this.conflict.set({ id, client, server, message });
    if (storageKey) this.persist(storageKey);
  }

  persist(key: string): void {
    try { localStorage.setItem(key, JSON.stringify({ document: this.document(), undo: this.undoStack(), redo: this.redoStack(), history: this.history(), selectedId: this.selectedId(), pending: this.pendingCommands(), redoPending: this.redoPendingCommands(), pendingMutationKey: this.pendingMutationKey(), componentInsertionKeys: this.componentInsertionKeys(), operationKeys: this.operationKeys(), conflict: this.conflict() } satisfies PersistedAuthoringState)); } catch { /* storage can be unavailable in private contexts */ }
  }

  private read(key: string): PersistedAuthoringState | null {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') as PersistedAuthoringState | null; } catch { return null; }
  }
}

function applyCommand(document: AuthoringDocument, command: AuthoringCommand): AuthoringDocument {
  const label = command.label?.trim();
  if (command.type === 'rename' && command.targetId && label) return mapDocument(document, command.targetId, (value) => ({ ...value, title: label }), (value) => ({ ...value, label }));
  if (command.type === 'add-phase') return { ...document, phases: [...document.phases, { id: command.entityId!, title: label || 'New phase', pages: [{ id: `${command.entityId}_page`, title: 'New page', sections: [{ id: `${command.entityId}_section`, title: 'New section', nodes: [{ id: `${command.entityId}_node`, kind: 'field', label: 'New field', control: 'shortText' }] }] }] }] };
  if (command.type === 'add-page' && command.targetId) return { ...document, phases: document.phases.map((phase) => phase.id === command.targetId ? { ...phase, pages: [...phase.pages, { id: command.entityId!, title: label || 'New page', sections: [{ id: `${command.entityId}_section`, title: 'New section', nodes: [{ id: `${command.entityId}_node`, kind: 'field', label: 'New field', control: 'shortText' }] }] }] } : phase) };
  if (command.type === 'add-section' && command.targetId) return { ...document, phases: document.phases.map((phase) => ({ ...phase, pages: phase.pages.map((page) => page.id === command.targetId ? { ...page, sections: [...page.sections, { id: command.entityId!, title: label || 'New section', nodes: [{ id: `${command.entityId}_node`, kind: 'field', label: 'New field', control: 'shortText' }] }] } : page) })) };
  if ((command.type === 'add-node' || command.type === 'insert-component') && command.targetId && command.node) return { ...document, phases: document.phases.map((phase) => ({ ...phase, pages: phase.pages.map((page) => ({ ...page, sections: page.sections.map((section) => section.id === command.targetId ? { ...section, nodes: [...section.nodes, command.node!] } : section) })) })) };
  if (command.type === 'remove-node' && command.targetId) return { ...document, phases: document.phases.map((phase) => ({ ...phase, pages: phase.pages.map((page) => ({ ...page, sections: page.sections.map((section) => ({ ...section, nodes: section.nodes.filter((node) => node.id !== command.targetId) })) })) })) };
  if (command.type === 'move' && command.targetId && command.destinationId) return moveDocumentNode(document, command.targetId, command.destinationId);
  return document;
}

function materializeIds(command: AuthoringCommand): AuthoringCommand {
  if (!['add-phase', 'add-page', 'add-section', 'add-node'].includes(command.type) || command.entityId) return command;
  const entityId = command.node?.id ?? `id_${crypto.randomUUID().replaceAll('-', '')}`;
  const node = command.type === 'add-node' ? { ...command.node!, id: entityId } : command.node;
  return { ...command, entityId, node, fieldId: command.fieldId ?? (command.type === 'add-node' ? `${entityId}_field` : undefined) };
}

function moveDocumentNode(document: AuthoringDocument, targetId: string, destinationId: string): AuthoringDocument {
  let moved: AuthoringNode | undefined;
  const without = { ...document, phases: document.phases.map((phase) => ({ ...phase, pages: phase.pages.map((page) => ({ ...page, sections: page.sections.map((section) => ({ ...section, nodes: section.nodes.filter((node) => { if (node.id === targetId) moved = node; return node.id !== targetId; }) })) })) })) };
  if (!moved) return document;
  return { ...without, phases: without.phases.map((phase) => ({ ...phase, pages: phase.pages.map((page) => ({ ...page, sections: page.sections.map((section) => section.id === destinationId ? { ...section, nodes: [...section.nodes, moved!] } : section) })) })) };
}

function mapDocument(document: AuthoringDocument, id: string, sectionMapper: (value: { id: string; title: string }) => { id: string; title: string }, nodeMapper: (value: { id: string; label: string }) => { id: string; label: string }): AuthoringDocument {
  return { ...document, phases: document.phases.map((phase) => ({ ...sectionMapper(phase), pages: phase.pages.map((page) => ({ ...sectionMapper(page), sections: page.sections.map((section) => ({ ...sectionMapper(section), nodes: section.nodes.map((node) => node.id === id ? { ...node, ...nodeMapper(node) } : node) })) })) })) };
}

function impactFor(command: AuthoringCommand): readonly string[] {
  if (command.type === 'remove-node') return ['This may change expressions, validation and preview answers.'];
  if (command.type === 'insert-component') return ['Adds a version-pinned reusable component.'];
  return ['Draft structure changed; review dependent expressions before publishing.'];
}

function firstSelectable(document: AuthoringDocument): string | null {
  const phase = document.phases[0];
  const page = phase?.pages[0];
  const section = page?.sections[0];
  return section?.nodes[0]?.id ?? section?.id ?? page?.id ?? phase?.id ?? null;
}
