import { Injectable, computed, signal } from '@angular/core';
import { AuthoringCommand, AuthoringConflict, AuthoringDocument, AuthoringHistoryEntry, DEFAULT_AUTHORING_DOCUMENT } from './authoring.types';

const HISTORY_LIMIT = 120;

type PersistedAuthoringState = {
  document: AuthoringDocument;
  undo: readonly AuthoringDocument[];
  redo: readonly AuthoringDocument[];
  history: readonly AuthoringHistoryEntry[];
  selectedId: string | null;
  pending: readonly AuthoringCommand[];
  pendingMutationKey: string | null;
  componentInsertionKeys: Record<string, string>;
};

@Injectable({ providedIn: 'root' })
export class AuthoringStore {
  readonly document = signal<AuthoringDocument>(DEFAULT_AUTHORING_DOCUMENT);
  readonly selectedId = signal<string | null>(DEFAULT_AUTHORING_DOCUMENT.phases[0].pages[0].sections[0].nodes[0].id);
  readonly undoStack = signal<readonly AuthoringDocument[]>([]);
  readonly redoStack = signal<readonly AuthoringDocument[]>([]);
  readonly history = signal<readonly AuthoringHistoryEntry[]>([]);
  readonly pendingCommands = signal<readonly AuthoringCommand[]>([]);
  /** Kept with unsaved commands so a manual retry replays the same logical batch. */
  readonly pendingMutationKey = signal<string | null>(null);
  readonly componentInsertionKeys = signal<Record<string, string>>({});
  readonly conflict = signal<AuthoringConflict | null>(null);
  readonly loading = signal(true);
  readonly dirty = computed(() => this.undoStack().length > 0);
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);

  hydrate(key: string, server: AuthoringDocument): void {
    const saved = this.read(key);
    if (saved && saved.document.id === server.id) {
      this.document.set(saved.document);
      this.undoStack.set(saved.undo.slice(-HISTORY_LIMIT));
      this.redoStack.set(saved.redo.slice(-HISTORY_LIMIT));
      this.history.set(saved.history.slice(-HISTORY_LIMIT));
      this.selectedId.set(saved.selectedId ?? firstSelectable(saved.document));
      this.pendingCommands.set(saved.pending ?? []);
      this.pendingMutationKey.set(saved.pendingMutationKey ?? null);
      this.componentInsertionKeys.set(saved.componentInsertionKeys ?? {});
    } else {
      this.document.set(server);
      this.selectedId.set(firstSelectable(server));
    }
    this.loading.set(false);
  }

  select(id: string | null): void { this.selectedId.set(id); }

  apply(command: AuthoringCommand, key: string): void {
    const before = this.document();
    const next = applyCommand(before, command);
    if (next === before) return;
    this.undoStack.set([...this.undoStack(), before].slice(-HISTORY_LIMIT));
    this.redoStack.set([]);
    this.pendingCommands.set([...this.pendingCommands(), command]);
    this.pendingMutationKey.set(null);
    this.componentInsertionKeys.set({});
    this.document.set(next);
    this.selectedId.set(command.node?.id ?? command.targetId ?? this.selectedId());
    this.history.set([{ id: crypto.randomUUID(), label: command.label ?? command.type, at: new Date().toISOString(), impact: impactFor(command) }, ...this.history()].slice(0, HISTORY_LIMIT));
    this.persist(key);
  }

  undo(key: string): AuthoringDocument | null {
    const previous = this.undoStack().at(-1);
    if (!previous) return null;
    this.undoStack.set(this.undoStack().slice(0, -1));
    this.redoStack.set([...this.redoStack(), this.document()].slice(-HISTORY_LIMIT));
    this.document.set(previous);
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
    this.history.set([{ id: crypto.randomUUID(), label: 'Redo', at: new Date().toISOString() }, ...this.history()].slice(0, HISTORY_LIMIT));
    this.persist(key);
    return next;
  }

  acceptServer(document: AuthoringDocument, key: string): void {
    this.document.set(document);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.pendingCommands.set([]);
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

  setConflict(client: AuthoringDocument, server: AuthoringDocument, id = '', message = 'This draft changed on the server. Choose a version to continue.'): void {
    this.conflict.set({ id, client, server, message });
  }

  persist(key: string): void {
    try { localStorage.setItem(key, JSON.stringify({ document: this.document(), undo: this.undoStack(), redo: this.redoStack(), history: this.history(), selectedId: this.selectedId(), pending: this.pendingCommands(), pendingMutationKey: this.pendingMutationKey(), componentInsertionKeys: this.componentInsertionKeys() } satisfies PersistedAuthoringState)); } catch { /* storage can be unavailable in private contexts */ }
  }

  private read(key: string): PersistedAuthoringState | null {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') as PersistedAuthoringState | null; } catch { return null; }
  }
}

function applyCommand(document: AuthoringDocument, command: AuthoringCommand): AuthoringDocument {
  const label = command.label?.trim();
  if (command.type === 'rename' && command.targetId && label) return mapDocument(document, command.targetId, (value) => ({ ...value, title: label }), (value) => ({ ...value, label }));
  if (command.type === 'add-phase') return { ...document, phases: [...document.phases, { id: crypto.randomUUID(), title: label || 'New phase', pages: [] }] };
  if (command.type === 'add-page' && command.targetId) return { ...document, phases: document.phases.map((phase) => phase.id === command.targetId ? { ...phase, pages: [...phase.pages, { id: crypto.randomUUID(), title: label || 'New page', sections: [] }] } : phase) };
  if (command.type === 'add-section' && command.targetId) return { ...document, phases: document.phases.map((phase) => ({ ...phase, pages: phase.pages.map((page) => page.id === command.targetId ? { ...page, sections: [...page.sections, { id: crypto.randomUUID(), title: label || 'New section', nodes: [] }] } : page) })) };
  if ((command.type === 'add-node' || command.type === 'insert-component') && command.targetId && command.node) return { ...document, phases: document.phases.map((phase) => ({ ...phase, pages: phase.pages.map((page) => ({ ...page, sections: page.sections.map((section) => section.id === command.targetId ? { ...section, nodes: [...section.nodes, command.node!] } : section) })) })) };
  if (command.type === 'remove-node' && command.targetId) return { ...document, phases: document.phases.map((phase) => ({ ...phase, pages: phase.pages.map((page) => ({ ...page, sections: page.sections.map((section) => ({ ...section, nodes: section.nodes.filter((node) => node.id !== command.targetId) })) })) })) };
  return document;
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
