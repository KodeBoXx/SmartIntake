import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { EMPTY, catchError, finalize, switchMap, take, takeWhile, timer } from 'rxjs';
import {
  type RespondentReview,
  type RespondentSession,
  type PublicReceipt,
  type StartedRespondentSession,
  type SubmissionOperation,
  type TypedSessionProjection,
  SmartIntakeApiService,
} from '../../smart-intake-api.service';
import {
  applyRuntimeOperation,
  createRuntimeAnswerState,
  reconcileServerProjection,
} from '../../runtime/runtime-answers';
import type {
  InputAnswerCell,
  RuntimeAnswerState,
  RuntimeDefinition,
  RuntimeFieldDefinition,
  RuntimeOperation,
  RowPath,
} from '../../runtime/runtime-types';

export type RespondentPhase = 'idle' | 'loading' | 'ready' | 'saving' | 'review' | 'submitting' | 'receipt' | 'error';

type QueuedMutation = { id: string; operation: RuntimeOperation };
type StoredSecret = { token: string; shareId: string; queue?: QueuedMutation[]; currentPageId?: string; attemptId?: string };
export type StoredReceipt = { receiptId: string; shareId: string; submittedAt: string; receiptCapability: string };
type CanonicalField = Record<string, unknown>;

/**
 * Respondent state is deliberately small and server-authoritative. The only durable
 * browser data is the bearer needed to resume the current session; answers and
 * progress always come back from the pinned session/release API.
 */
@Injectable({ providedIn: 'root' })
export class PublicSessionStore implements OnDestroy {
  readonly phase = signal<RespondentPhase>('idle');
  readonly session = signal<RespondentSession | null>(null);
  readonly shareId = signal<string | null>(null);
  readonly token = signal<string | null>(null);
  readonly state = signal<RuntimeAnswerState>(createRuntimeAnswerState());
  readonly currentPageId = signal<string | null>(null);
  readonly reachablePageIds = signal<readonly string[]>([]);
  readonly requiredCount = signal(0);
  readonly completedRequiredCount = signal(0);
  readonly review = signal<RespondentReview | null>(null);
  readonly receiptId = signal<string | null>(null);
  readonly attemptId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly receipt = signal<StoredReceipt | null>(null);
  readonly channelId = signal<string | null>(null);
  readonly queueSize = signal(0);
  readonly definition = computed<RuntimeDefinition>(() => runtimeDefinition(this.session()?.definition, this.session()?.locale));
  readonly pages = computed(() => canonicalPages(this.session()?.definition, this.session()?.locale));
  readonly currentPageIndex = computed(() => Math.max(0, this.reachablePageIds().indexOf(this.currentPageId() ?? '')));
  readonly progressLabel = computed(() => `${this.completedRequiredCount()} of ${this.requiredCount()} required answers complete`);
  readonly canMovePrevious = computed(() => this.currentPageIndex() > 0);
  readonly canMoveNext = computed(() => this.currentPageIndex() >= 0 && this.currentPageIndex() < this.reachablePageIds().length - 1);

  private queue: QueuedMutation[] = [];
  private inFlight: string | null = null;
  private navigationInFlight = false;
  private reviewAfterSave = false;
  private readonly channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('smart-intake.respondent.v1');
  constructor(private readonly api: SmartIntakeApiService, private readonly router: Router) {
    this.channel?.addEventListener('message', ({ data }) => {
      const current = this.session(); const message = data as { sessionId?: string; revision?: number };
      if (current && message?.sessionId === current.sessionId && (message.revision ?? 0) > current.revision) this.hydrate(current.sessionId);
    });
    addEventListener('storage', (event) => { const current = this.session(); if (current && event.key === secretKey(current.sessionId)) this.hydrate(current.sessionId); });
  }
  ngOnDestroy(): void { this.channel?.close(); }

  start(shareId: string): void {
    this.reset(true);
    this.phase.set('loading'); this.shareId.set(shareId);
    this.api.startSession(shareId, browserLocale(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').subscribe({
      next: (started) => {
        this.acceptStarted(shareId, started);
        void this.router.navigate(['/sessions', started.sessionId]);
      },
      error: (failure) => this.fail(startFailure(failure)),
    });
  }
  startFromChannel(shareId: string, channelId: string, bootstrap: string, parentOrigin: string): void {
    this.reset(true); this.phase.set('loading'); this.shareId.set(shareId); this.channelId.set(channelId);
    this.api.startChannel(channelId, bootstrap, parentOrigin, browserLocale(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').subscribe({ next: (started) => { this.acceptStarted(shareId, started); void this.router.navigate(['/sessions', started.sessionId]); }, error: (failure) => this.fail(startFailure(failure)) });
  }

  hydrate(sessionId: string, reviewAfter = false): void {
    const stored = this.secret(sessionId);
    if (!stored) { this.fail('This response is not available on this device. Start a new response from the public link.'); return; }
    this.phase.set('loading'); this.shareId.set(stored.shareId); this.token.set(stored.token); this.queue = stored.queue ?? []; this.queueSize.set(this.queue.length); this.currentPageId.set(stored.currentPageId ?? null); this.attemptId.set(stored.attemptId ?? null);
    this.api.respondentSession(sessionId, stored.token).subscribe({
      next: (session) => {
        this.acceptSession(session);
        if (session.status === 'SUBMITTED') { this.recoverAuthenticatedReceipt(sessionId, stored); return; }
        if (stored.attemptId) { this.phase.set('submitting'); this.reconcileAttempt(stored.attemptId); return; }
        if (reviewAfter) this.openReview(); else this.flushQueue();
      },
      error: (failure) => { if (failure.status === 401 || failure.status === 403) sessionStorage.removeItem(secretKey(sessionId)); this.fail(sessionFailure(failure)); },
    });
  }

  setAnswer(field: RuntimeFieldDefinition, raw: string | boolean | readonly string[], rowPath?: RowPath): void {
    const answer = inputAnswer(field, raw);
    this.mutate({ kind: 'set', target: { fieldId: field.id, rowPath }, answer });
  }

  /** Allows recursive controls to submit a fully addressed typed operation. */
  apply(operation: RuntimeOperation): void { this.mutate(operation); }

  setStatus(field: RuntimeFieldDefinition, status: 'unknown' | 'declined' | 'respondentNotApplicable'): void {
    this.mutate({ kind: 'set', target: { fieldId: field.id }, answer: { status } });
  }

  clear(field: RuntimeFieldDefinition): void { this.mutate({ kind: 'clear', target: { fieldId: field.id } }); }
  addItem(field: RuntimeFieldDefinition, rowPath?: RowPath): void { this.mutate({ kind: 'addItem', target: { fieldId: field.id, rowPath }, itemId: `item_${crypto.randomUUID().replaceAll('-', '')}` }); }
  removeItem(field: RuntimeFieldDefinition, itemId: string, rowPath?: RowPath): void { this.mutate({ kind: 'removeItem', target: { fieldId: field.id, rowPath }, itemId }); }
  moveItem(field: RuntimeFieldDefinition, itemId: string, beforeItemId?: string, rowPath?: RowPath): void { this.mutate({ kind: 'moveItem', target: { fieldId: field.id, rowPath }, itemId, beforeItemId }); }

  navigate(delta: -1 | 1): void {
    if (this.queue.length || this.inFlight || this.navigationInFlight) { this.error.set('Wait for the current change to finish before changing pages.'); return; }
    const pages = this.reachablePageIds();
    const next = pages[this.currentPageIndex() + delta];
    if (!next) return;
    const session = this.session(); const token = this.token();
    if (session && token) { this.navigationInFlight = true; this.phase.set('saving'); this.api.navigateRespondentSession(session.sessionId, token, session.revision, next).subscribe({ next: (projection) => { this.navigationInFlight = false; this.acceptProjection(projection); }, error: () => { this.navigationInFlight = false; this.phase.set('ready'); this.error.set('We could not save your current page. Your answers remain available.'); } }); }
  }

  openReview(): void {
    const current = this.session(); const token = this.token();
    if (!current || !token) return;
    if (this.queue.length || this.inFlight || this.navigationInFlight) { this.reviewAfterSave = true; this.error.set('Saving the current change before review.'); this.flushQueue(); return; }
    this.reviewAfterSave = false;
    this.phase.set('loading');
    this.api.validateRespondentSession(current.sessionId, token).subscribe({
      next: (review) => {
        if (review.errors.length) { this.phase.set('ready'); this.markReviewErrors(review.errors); this.error.set('Complete the highlighted answers before reviewing your response.'); return; }
        this.review.set(review); this.phase.set('review');
        void this.router.navigate(['/sessions', current.sessionId, 'review']);
      },
      error: () => this.fail('We could not validate this response. Please try again.'),
    });
  }
  ensureReview(): void { if (!this.review()?.reviewDigest) this.openReview(); }
  isBusy(): boolean { return Boolean(this.inFlight || this.navigationInFlight || this.phase() === 'saving' || this.phase() === 'submitting' || this.phase() === 'loading'); }

  edit(fieldId: string, rowPath: RowPath = [], instanceId?: string): void {
    const current = this.session(); if (!current) return;
    this.review.set(null);
    const page = pageForPlacement(current.definition, instanceId, fieldId) ?? this.reachablePageIds()[0] ?? null;
    const focusInstance = repeatedRootInstanceForPlacement(current.definition, instanceId);
    this.persistReviewEdit(page, () => { this.phase.set('ready'); void this.router.navigate(['/sessions', current.sessionId], { queryParams: { focus: controlId(fieldId, rowPath, focusInstance) } }); });
  }

  submit(acknowledgments: readonly { fieldId: string; rowPath: { listFieldId: string; itemId: string }[]; expectedContentHash: string; accepted: true }[] = []): void {
    const current = this.session(); const token = this.token(); const review = this.review();
    if (!current || !token || !review?.reviewDigest) { this.fail('Review the current response before submitting it.'); return; }
    if (this.queue.length || this.inFlight || this.navigationInFlight) { this.phase.set('review'); this.error.set('Wait for the current change to finish before submitting.'); return; }
    const attemptId = this.attemptId() ?? mutationId('submit');
    this.attemptId.set(attemptId); this.persist(); this.phase.set('submitting');
    this.api.submitSession(current.sessionId, token, current.revision, review.reviewDigest, attemptId, acknowledgments).subscribe({
      next: (receipt) => this.acceptReceipt(receipt),
      error: (failure) => {
        if (failure.status === 0 || failure.status >= 500) { this.reconcileAttempt(attemptId); return; }
        this.phase.set('review'); this.error.set(submissionFailure(failure));
      },
    });
  }

  startAnother(): void {
    const shareId = this.shareId(); const channelId = this.channelId();
    this.reset(true);
    if (shareId) void this.router.navigate(['/f', shareId], { queryParams: channelId ? { channel: channelId } : undefined });
  }

  retrySave(): void { this.error.set(null); this.flushQueue(); }
  clearAndExit(): void { const share = this.shareId(); const channel = this.channelId(); this.reset(true); void this.router.navigate(share ? ['/f', share] : ['/'], { queryParams: channel ? { channel } : undefined }); }

  reset(clearSecret: boolean): void {
    const current = this.session();
    if (clearSecret && current) sessionStorage.removeItem(secretKey(current.sessionId));
    this.phase.set('idle'); this.session.set(null); this.shareId.set(null); this.channelId.set(null); this.token.set(null); this.state.set(createRuntimeAnswerState()); this.receipt.set(null);
    this.currentPageId.set(null); this.reachablePageIds.set([]); this.requiredCount.set(0); this.completedRequiredCount.set(0);
    this.review.set(null); this.receiptId.set(null); this.attemptId.set(null); this.queue = []; this.inFlight = null; this.navigationInFlight = false; this.reviewAfterSave = false; this.queueSize.set(0); this.error.set(null);
  }

  private mutate(operation: RuntimeOperation): void {
    const session = this.session(); const token = this.token();
    if (!session || !token) return;
    if (this.navigationInFlight) { this.error.set('Wait for the page change to finish before editing an answer.'); return; }
    const local = applyRuntimeOperation(this.definition(), this.state(), operation);
    if (!local.accepted) { this.error.set('That answer is not valid for this field.'); return; }
    this.state.set(local.state); this.review.set(null); this.error.set(null);
    this.queue.push({ id: mutationId('save'), operation }); this.queueSize.set(this.queue.length); this.persist(); this.flushQueue();
  }

  private flushQueue(): void {
    const session = this.session(); const token = this.token(); const queued = this.queue[0];
    if (!session || !token || !queued || this.inFlight) return;
    this.inFlight = queued.id; this.phase.set('saving');
    this.api.patchTypedSession(session.sessionId, token, session.revision, queued.id, [queued.operation], this.currentPageId() ?? undefined).subscribe({
      next: (projection) => this.acceptProjection(projection),
      error: (failure) => {
        this.inFlight = null;
        if (failure.status === 409) { this.hydrate(session.sessionId); this.error.set('This response changed in another tab. The latest saved response has been restored.'); return; }
        this.phase.set('ready'); this.error.set('Your change has not been saved. Check your connection and try again.');
      },
    });
  }

  private acceptStarted(shareId: string, started: StartedRespondentSession): void {
    this.shareId.set(shareId); this.token.set(started.respondentSession);
    this.queue = []; this.queueSize.set(0);
    sessionStorage.setItem(secretKey(started.sessionId), JSON.stringify({ token: started.respondentSession, shareId, queue: [] } satisfies StoredSecret));
    this.acceptSession({ ...started, definition: started.release ?? started.definition ?? {}, answers: started.answers ?? {}, status: started.status ?? 'DRAFT' });
  }

  private acceptSession(session: RespondentSession): void {
    this.session.set(session);
    this.state.set(reconcileServerProjection(this.state(), { answers: session.answers, invalidInputs: session.invalidInputs }));
    const pages = canonicalPages(session.definition, session.locale).map((page) => page.id);
    const reachable = session.reachablePageIds?.length ? session.reachablePageIds : pages;
    this.reachablePageIds.set(reachable);
    const authoritativePage = session.currentPageId;
    this.currentPageId.set(authoritativePage && reachable.includes(authoritativePage) ? authoritativePage : reachable.includes(this.currentPageId() ?? '') ? this.currentPageId() : reachable[0] ?? null);
    this.requiredCount.set(session.requiredCount ?? 0); this.completedRequiredCount.set(session.completedRequiredCount ?? 0);
    this.phase.set(session.status === 'SUBMITTED' ? 'receipt' : 'ready');
  }

  private recoverAuthenticatedReceipt(sessionId: string, stored: StoredSecret): void {
    this.phase.set('loading');
    this.api.respondentReceipt(sessionId, stored.token, stored.attemptId).subscribe({ next: (receipt) => this.acceptReceipt(receipt), error: () => this.fail('This receipt is not available on this device.') });
  }

  private persistReviewEdit(page: string | null, done: () => void): void {
    const current = this.session(); const token = this.token(); const reachable = this.reachablePageIds();
    if (!current || !token || !page || this.currentPageId() === page) { if (page) this.currentPageId.set(page); done(); return; }
    const from = reachable.indexOf(this.currentPageId() ?? ''); const to = reachable.indexOf(page);
    if (from < 0 || to < 0) { this.error.set('We could not locate that answer.'); return; }
    const adjacent = reachable[from + Math.sign(to - from)];
    this.navigationInFlight = true; this.phase.set('saving');
    this.api.navigateRespondentSession(current.sessionId, token, current.revision, adjacent).subscribe({
      next: (projection) => { this.navigationInFlight = false; this.acceptProjection(projection); this.persistReviewEdit(page, done); },
      error: () => { this.navigationInFlight = false; this.phase.set('review'); this.error.set('We could not return to that answer.'); },
    });
  }

  private acceptProjection(projection: TypedSessionProjection): void {
    const current = this.session(); if (!current) return;
    if (projection.acceptedRevision < current.revision) return;
    // The server can replay an already accepted idempotency key after transport loss.
    if (projection.acceptedRevision === current.revision && this.queue[0]?.id !== this.inFlight) return;
    this.session.set({ ...current, revision: projection.acceptedRevision, answers: projection.answers, currentPageId: projection.currentPageId });
    this.state.set(reconcileServerProjection(this.state(), { answers: projection.answers, invalidInputs: projection.invalidInputs }));
    this.reachablePageIds.set(projection.reachablePageIds);
    if (projection.currentPageId && projection.reachablePageIds.includes(projection.currentPageId)) this.currentPageId.set(projection.currentPageId);
    else if (!projection.reachablePageIds.includes(this.currentPageId() ?? '')) this.currentPageId.set(projection.reachablePageIds[0] ?? null);
    this.requiredCount.set(projection.requiredCount); this.completedRequiredCount.set(projection.completedRequiredCount);
    if (this.queue[0]?.id === this.inFlight) this.queue.shift();
    this.inFlight = null; this.queueSize.set(this.queue.length); this.persist(); this.channel?.postMessage({ sessionId: current.sessionId, revision: projection.acceptedRevision });
    this.phase.set('ready'); this.flushQueue();
    if (!this.queue.length && !this.inFlight && this.reviewAfterSave) this.openReview();
  }

  private reconcileAttempt(attemptId: string): void {
    const current = this.session(); const token = this.token();
    if (!current || !token) return;
    this.error.set('Checking whether your response was received…');
    timer(500, 1000).pipe(
      take(30),
      switchMap(() => this.api.submissionOperation(current.sessionId, token, attemptId)),
      takeWhile((operation) => operation.state === 'started', true),
      catchError(() => { this.phase.set('review'); this.error.set('We could not confirm submission. Please try again with the same response.'); return EMPTY; }),
      finalize(() => { if (this.phase() === 'submitting') { this.phase.set('review'); this.error.set('Submission remains uncertain. Retry to check the same attempt safely.'); } }),
    ).subscribe((operation) => this.acceptOperation(operation));
  }

  private acceptOperation(operation: SubmissionOperation): void {
    if (operation.state === 'succeeded' && (operation.receiptId ?? operation.submissionId)) { this.phase.set('loading'); this.resolveReceipt(operation.receiptId ?? operation.submissionId!); }
    else if (operation.state === 'failed' || operation.state === 'notStarted') { this.phase.set('review'); this.error.set('Submission was not completed. Please review and try again.'); }
  }

  private resolveReceipt(receiptId: string): void {
    const current = this.session(); const token = this.token();
    if (!current || !token) return;
    this.api.respondentReceipt(current.sessionId, token, this.attemptId() ?? undefined).subscribe({ next: (receipt) => this.acceptReceipt(receipt), error: () => { this.phase.set('review'); this.error.set(`Submission succeeded with receipt ${receiptId}, but receipt recovery is unavailable. Try again safely.`); } });
  }

  private markReviewErrors(errors: readonly unknown[]): void {
    const invalid = { ...this.state().invalid };
    let first: { fieldId: string; rowPath: RowPath } | null = null;
    for (const error of errors) {
      if (!error || typeof error !== 'object') continue;
      const value = error as Record<string, unknown>; const fieldId = typeof value['fieldId'] === 'string' ? value['fieldId'] : '';
      const rowPath = Array.isArray(value['rowPath']) ? value['rowPath'].filter(isRowSegment) : [];
      if (!fieldId) continue;
      invalid[`${rowPath.map((segment) => `${segment.listFieldId}:${segment.itemId}`).join('/')}/${fieldId}`] = String(value['code'] ?? 'INVALID');
      first ??= { fieldId, rowPath };
    }
    this.state.set({ ...this.state(), invalid });
    if (first) this.edit(first.fieldId, first.rowPath);
  }

  private acceptReceipt(response: PublicReceipt): void {
    const current = this.session(); if (!current) return;
    const receiptId = response.submissionId ?? response.receiptId;
    if (!receiptId || !response.receiptCapability) { this.phase.set('review'); this.error.set('Submission succeeded, but secure receipt recovery is unavailable. Try again safely.'); return; }
    // A submitted response cannot be resumed from a shared device after receipt.
    sessionStorage.removeItem(secretKey(current.sessionId));
    const receipt: StoredReceipt = { receiptId, receiptCapability: response.receiptCapability, shareId: response.shareId ?? this.shareId() ?? '', submittedAt: response.submittedAt ?? new Date().toISOString() };
    sessionStorage.setItem(receiptKey(current.sessionId), JSON.stringify(receipt)); this.receipt.set(receipt); this.review.set(null);
    this.receiptId.set(receiptId); this.phase.set('receipt'); this.error.set(null);
    void this.router.navigate(['/sessions', current.sessionId, 'receipt']);
  }

  private secret(sessionId: string): StoredSecret | null {
    try { const value = JSON.parse(sessionStorage.getItem(secretKey(sessionId)) ?? 'null'); return typeof value?.token === 'string' && typeof value?.shareId === 'string' ? value : null; } catch { return null; }
  }

  restoreReceipt(sessionId: string): void {
    const accepted = storedReceipt(sessionId);
    if (accepted) { this.phase.set('loading'); this.api.publicReceipt(accepted.receiptCapability).subscribe({ next: (verified) => { if ((verified.submissionId ?? verified.receiptId) !== accepted.receiptId || verified.status !== 'accepted') { this.fail('This receipt is not available on this device.'); return; } this.receipt.set(accepted); this.receiptId.set(accepted.receiptId); this.shareId.set(accepted.shareId); this.phase.set('receipt'); }, error: () => this.fail('This receipt is not available on this device.') }); return; }
    const stored = this.secret(sessionId);
    if (!stored) { this.fail('This receipt is not available on this device.'); return; }
    this.api.respondentReceipt(sessionId, stored.token, stored.attemptId).subscribe({ next: (receipt) => {
      const receiptId = receipt.submissionId ?? receipt.receiptId;
      if (!receiptId) { this.fail('This receipt is not available on this device.'); return; }
      if (!receipt.receiptCapability) { this.fail('This receipt is not available on this device.'); return; }
      const verified: StoredReceipt = { receiptId, receiptCapability: receipt.receiptCapability, shareId: receipt.shareId ?? stored.shareId, submittedAt: receipt.submittedAt ?? new Date().toISOString() };
      sessionStorage.setItem(receiptKey(sessionId), JSON.stringify(verified)); this.receipt.set(verified); this.receiptId.set(verified.receiptId); this.phase.set('receipt');
    }, error: () => this.fail('This receipt is not available on this device.') });
  }
  private persist(): void {
    const current = this.session(); const token = this.token(); const shareId = this.shareId();
    if (current && token && shareId) sessionStorage.setItem(secretKey(current.sessionId), JSON.stringify({ token, shareId, queue: this.queue, currentPageId: this.currentPageId() ?? undefined, attemptId: this.attemptId() ?? undefined } satisfies StoredSecret));
  }

  private fail(message: string): void { if (message === 'This response is no longer available on this device.') this.reset(true); this.phase.set('error'); this.error.set(message); }
}

function secretKey(sessionId: string): string { return `smart-intake.respondent.${sessionId}`; }
function receiptKey(sessionId: string): string { return `smart-intake.receipt.${sessionId}`; }
function mutationId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function controlId(fieldId: string, rowPath: RowPath, instanceId?: string): string {
  const path = rowPath.map((segment) => `${segment.listFieldId}:${segment.itemId}`).join('/');
  const value = `${instanceId ? `${instanceId}-` : ''}${fieldId}${path ? `-${path}` : ''}`;
  return value.replaceAll(/[^A-Za-z0-9_-]/g, '-');
}
function browserLocale(): string { return navigator.language.split('-')[0] || 'en'; }
function startFailure(error: HttpErrorResponse): string { return error.status === 410 ? 'This form is no longer accepting new responses.' : error.status === 404 ? 'This public form is unavailable.' : 'We could not start this form. Please try again.'; }
function sessionFailure(error: HttpErrorResponse): string { return error.status === 401 || error.status === 403 ? 'This response is no longer available on this device.' : 'We could not restore this response.'; }
function submissionFailure(error: HttpErrorResponse): string { return error.status === 409 ? 'Your review is out of date. Review the response again before submitting.' : error.status === 422 ? 'The response still needs attention before it can be submitted.' : 'Submission could not be completed.'; }

function runtimeDefinition(definition: Record<string, unknown> | undefined, pinnedLocale?: string): RuntimeDefinition {
  const fields = ((definition?.['data'] as { fields?: CanonicalField[] } | undefined)?.fields ?? []);
  const locale = pinnedLocale ?? String(definition?.['defaultLocale'] ?? 'en');
  const messages = ((definition?.['translations'] as Record<string, { messages?: Record<string, string> }> | undefined)?.[locale]?.messages ?? {});
  return { fields: fields.map((field) => runtimeField(field, messages)) };
}
function runtimeField(field: CanonicalField, messages: Record<string, string>): RuntimeFieldDefinition {
  const constraints = field['constraints'] as Record<string, unknown> | undefined;
  const options = Array.isArray(field['options']) ? field['options'].map((option) => typeof option === 'string' ? option : String((option as Record<string, unknown>)['id'])) : undefined;
  const type = String(field['type'] ?? 'text') as RuntimeFieldDefinition['type'];
  const rawOptions = Array.isArray(field['options']) ? field['options'] as unknown[] : [];
  const optionLabels = Object.fromEntries(rawOptions.flatMap((option) => { if (!option || typeof option !== 'object') return []; const value = option as Record<string, unknown>; const id = String(value['id'] ?? ''); const key = String(value['labelKey'] ?? ''); return id ? [[id, messages[key] ?? id]] : []; }));
  const itemFields = ((field['itemSchema'] as { fields?: CanonicalField[] } | undefined)?.fields ?? []).map((child) => runtimeField(child, messages));
  const fields = ((field['fields'] as CanonicalField[] | undefined) ?? []).map((child) => runtimeField(child, messages));
  return {
    id: String(field['id']), label: messages[String(field['labelKey'] ?? '')] ?? undefined, type, readOnly: Boolean(field['readOnly']), calculated: Boolean(field['calculated']), allowUnknown: Boolean(field['allowUnknown']), allowDeclined: Boolean(field['allowDeclined']), allowNotApplicable: Boolean(field['allowNotApplicable']), options, optionLabels,
    min: stringValue(constraints?.['min']), max: stringValue(constraints?.['max']), step: stringValue(constraints?.['step']), scale: numberValue(constraints?.['scale']), minItems: numberValue(constraints?.['minItems']), maxItems: numberValue(constraints?.['maxItems']), minLength: numberValue(constraints?.['minLength']), maxLength: numberValue(constraints?.['maxLength']), exclusiveOptionIds: stringArray(constraints?.['exclusiveOptionIds']), normalizer: field['normalizer'] as RuntimeFieldDefinition['normalizer'], hiddenRetention: field['hiddenRetention'] as RuntimeFieldDefinition['hiddenRetention'], hidden: Boolean(field['hidden'] ?? field['visible'] === false), fixedRows: Boolean(field['fixedRows'] ?? field['matrix']), fixedItemIds: stringArray(field['fixedItemIds']), fields: fields.length ? fields : undefined, itemFields: itemFields.length ? itemFields : undefined,
  };
}
function canonicalPages(definition: Record<string, unknown> | undefined, pinnedLocale?: string): { id: string; title: string; fieldIds: readonly string[]; placements: readonly { instanceId: string; fieldId: string }[] }[] {
  const messages = (((definition?.['translations'] as Record<string, { messages?: Record<string, string> }> | undefined)?.[pinnedLocale ?? String(definition?.['defaultLocale'] ?? 'en')] ?? {}).messages ?? {});
  const phases = ((definition?.['flow'] as { phases?: Record<string, unknown>[] } | undefined)?.phases ?? []);
  return phases.flatMap((phase) => (Array.isArray(phase['pages']) ? phase['pages'] as Record<string, unknown>[] : []).map((page) => {
    const placements = (Array.isArray(page['sections']) ? page['sections'] as Record<string, unknown>[] : []).flatMap((section) => (Array.isArray(section['nodes']) ? section['nodes'] as Record<string, unknown>[] : []).flatMap(topPlacement));
    return { id: String(page['id']), title: messages[String(page['titleKey'])] ?? String(page['id']), fieldIds: placements.map((placement) => placement.fieldId), placements };
  }));
}
function topPlacement(node: Record<string, unknown>): { instanceId: string; fieldId: string }[] { const fieldId = String(node['fieldId'] ?? ''); return fieldId ? [{ instanceId: String(node['id'] ?? fieldId), fieldId }] : (Array.isArray(node['children']) ? node['children'] as Record<string, unknown>[] : []).flatMap(topPlacement); }
function pageForPlacement(definition: Record<string, unknown>, instanceId: string | undefined, fieldId: string): string | undefined {
  const phases = ((definition?.['flow'] as { phases?: Record<string, unknown>[] } | undefined)?.phases ?? []);
  for (const phase of phases) for (const page of (Array.isArray(phase['pages']) ? phase['pages'] as Record<string, unknown>[] : [])) {
    const nodes = (Array.isArray(page['sections']) ? page['sections'] as Record<string, unknown>[] : []).flatMap((section) => Array.isArray(section['nodes']) ? section['nodes'] as Record<string, unknown>[] : []);
    if (nodes.some((node) => nodeMatches(node, instanceId, fieldId))) return String(page['id']);
  }
  return undefined;
}
function nodeMatches(node: Record<string, unknown>, instanceId: string | undefined, fieldId: string): boolean {
  if ((instanceId && node['id'] === instanceId) || (!instanceId && node['fieldId'] === fieldId)) return true;
  return (Array.isArray(node['children']) ? node['children'] as Record<string, unknown>[] : []).some((child) => nodeMatches(child, instanceId, fieldId));
}
function repeatedRootInstanceForPlacement(definition: Record<string, unknown>, instanceId?: string): string | undefined {
  if (!instanceId) return undefined;
  const phases = ((definition?.['flow'] as { phases?: Record<string, unknown>[] } | undefined)?.phases ?? []);
  for (const phase of phases) for (const page of (Array.isArray(phase['pages']) ? phase['pages'] as Record<string, unknown>[] : []))
    for (const section of (Array.isArray(page['sections']) ? page['sections'] as Record<string, unknown>[] : []))
      { const roots = (Array.isArray(section['nodes']) ? section['nodes'] as Record<string, unknown>[] : []); for (const node of roots) if (nodeContainsInstance(node, instanceId)) { const fieldId = String(node['fieldId'] ?? ''); return roots.filter((candidate) => candidate['fieldId'] === fieldId).length > 1 ? String(node['id']) : undefined; } }
  return undefined;
}
function nodeContainsInstance(node: Record<string, unknown>, instanceId: string): boolean { return node['id'] === instanceId || (Array.isArray(node['children']) ? node['children'] as Record<string, unknown>[] : []).some((child) => nodeContainsInstance(child, instanceId)); }
function storedReceipt(sessionId: string): StoredReceipt | null { try { const value = JSON.parse(sessionStorage.getItem(receiptKey(sessionId)) ?? 'null'); return typeof value?.receiptId === 'string' && typeof value?.shareId === 'string' && typeof value?.submittedAt === 'string' && typeof value?.receiptCapability === 'string' ? value : null; } catch { return null; } }
function isRowSegment(value: unknown): value is { listFieldId: string; itemId: string } { return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>)['listFieldId'] === 'string' && typeof (value as Record<string, unknown>)['itemId'] === 'string'); }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' ? value : undefined; }
function stringArray(value: unknown): readonly string[] | undefined { return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined; }
function inputAnswer(field: RuntimeFieldDefinition, raw: string | boolean | readonly string[]): InputAnswerCell {
  if (field.type === 'boolean') return { status: 'answered', value: raw === true };
  if (field.type === 'multiChoice' || field.type === 'attachments') return { status: 'answered', value: Array.isArray(raw) ? raw : [] };
  return { status: 'answered', value: String(raw) };
}
