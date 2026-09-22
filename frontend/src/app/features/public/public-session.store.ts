import { Injectable, computed, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { EMPTY, catchError, expand, map, switchMap, takeWhile, timer } from 'rxjs';
import {
  type RespondentReview,
  type RespondentSession,
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
  ServerProjection,
} from '../../runtime/runtime-types';

export type RespondentPhase = 'idle' | 'loading' | 'ready' | 'saving' | 'review' | 'submitting' | 'receipt' | 'error';

type StoredSecret = { token: string; shareId: string };
type CanonicalField = Record<string, unknown>;

/**
 * Respondent state is deliberately small and server-authoritative. The only durable
 * browser data is the bearer needed to resume the current session; answers and
 * progress always come back from the pinned session/release API.
 */
@Injectable({ providedIn: 'root' })
export class PublicSessionStore {
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
  readonly definition = computed<RuntimeDefinition>(() => runtimeDefinition(this.session()?.definition));
  readonly pages = computed(() => canonicalPages(this.session()?.definition));
  readonly currentPageIndex = computed(() => Math.max(0, this.reachablePageIds().indexOf(this.currentPageId() ?? '')));
  readonly progressLabel = computed(() => `${this.completedRequiredCount()} of ${this.requiredCount()} required answers complete`);
  readonly canMovePrevious = computed(() => this.currentPageIndex() > 0);
  readonly canMoveNext = computed(() => this.currentPageIndex() >= 0 && this.currentPageIndex() < this.reachablePageIds().length - 1);

  constructor(private readonly api: SmartIntakeApiService, private readonly router: Router) {}

  start(shareId: string): void {
    this.reset(false);
    this.phase.set('loading'); this.shareId.set(shareId);
    this.api.startSession(shareId, browserLocale(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').subscribe({
      next: (started) => {
        this.acceptStarted(shareId, started);
        void this.router.navigate(['/sessions', started.sessionId]);
      },
      error: (failure) => this.fail(startFailure(failure)),
    });
  }

  hydrate(sessionId: string): void {
    const stored = this.secret(sessionId);
    if (!stored) { this.fail('This response is not available on this device. Start a new response from the public link.'); return; }
    this.phase.set('loading'); this.shareId.set(stored.shareId); this.token.set(stored.token);
    this.api.respondentSession(sessionId, stored.token).subscribe({
      next: (session) => this.acceptSession(session),
      error: (failure) => this.fail(sessionFailure(failure)),
    });
  }

  setAnswer(field: RuntimeFieldDefinition, raw: string | boolean | readonly string[]): void {
    const answer = inputAnswer(field, raw);
    this.mutate({ kind: 'set', target: { fieldId: field.id }, answer });
  }

  setStatus(field: RuntimeFieldDefinition, status: 'unknown' | 'declined' | 'respondentNotApplicable'): void {
    this.mutate({ kind: 'set', target: { fieldId: field.id }, answer: { status } });
  }

  clear(field: RuntimeFieldDefinition): void { this.mutate({ kind: 'clear', target: { fieldId: field.id } }); }

  navigate(delta: -1 | 1): void {
    const pages = this.reachablePageIds();
    const next = pages[this.currentPageIndex() + delta];
    if (next) this.currentPageId.set(next);
  }

  openReview(): void {
    const current = this.session(); const token = this.token();
    if (!current || !token) return;
    this.phase.set('loading');
    this.api.validateRespondentSession(current.sessionId, token).subscribe({
      next: (review) => {
        if (review.errors.length) { this.phase.set('ready'); this.error.set('Complete the highlighted answers before reviewing your response.'); return; }
        this.review.set(review); this.phase.set('review');
        void this.router.navigate(['/sessions', current.sessionId, 'review']);
      },
      error: () => this.fail('We could not validate this response. Please try again.'),
    });
  }

  edit(fieldId: string): void {
    const current = this.session(); if (!current) return;
    this.phase.set('ready');
    const page = pageForField(current.definition, fieldId) ?? this.reachablePageIds()[0] ?? null;
    this.currentPageId.set(page);
    void this.router.navigate(['/sessions', current.sessionId], { queryParams: { focus: fieldId } });
  }

  submit(acknowledgments: readonly { fieldId: string; rowPath: { listFieldId: string; itemId: string }[]; expectedContentHash: string; accepted: true }[] = []): void {
    const current = this.session(); const token = this.token(); const review = this.review();
    if (!current || !token || !review?.reviewDigest) { this.fail('Review the current response before submitting it.'); return; }
    const attemptId = this.attemptId() ?? mutationId('submit');
    this.attemptId.set(attemptId); this.phase.set('submitting');
    this.api.submitSession(current.sessionId, token, current.revision, review.reviewDigest, attemptId, acknowledgments).subscribe({
      next: (receipt) => this.acceptReceipt(receipt.receiptId),
      error: (failure) => {
        if (failure.status === 0 || failure.status >= 500) { this.reconcileAttempt(attemptId); return; }
        this.phase.set('review'); this.error.set(submissionFailure(failure));
      },
    });
  }

  startAnother(): void {
    const shareId = this.shareId();
    this.reset(true);
    if (shareId) void this.router.navigate(['/f', shareId]);
  }

  reset(clearSecret: boolean): void {
    const current = this.session();
    if (clearSecret && current) sessionStorage.removeItem(secretKey(current.sessionId));
    this.phase.set('idle'); this.session.set(null); this.token.set(null); this.state.set(createRuntimeAnswerState());
    this.currentPageId.set(null); this.reachablePageIds.set([]); this.requiredCount.set(0); this.completedRequiredCount.set(0);
    this.review.set(null); this.receiptId.set(null); this.attemptId.set(null); this.error.set(null);
  }

  private mutate(operation: RuntimeOperation): void {
    const session = this.session(); const token = this.token();
    if (!session || !token || this.phase() === 'saving') return;
    const local = applyRuntimeOperation(this.definition(), this.state(), operation);
    if (!local.accepted) { this.error.set('That answer is not valid for this field.'); return; }
    this.state.set(local.state); this.phase.set('saving'); this.error.set(null);
    const clientMutationId = mutationId('save');
    this.api.patchTypedSession(session.sessionId, token, session.revision, clientMutationId, [operation], this.currentPageId() ?? undefined).subscribe({
      next: (projection) => this.acceptProjection(projection),
      error: (failure) => {
        if (failure.status === 409) { this.hydrate(session.sessionId); this.error.set('This response changed in another tab. The latest saved response has been restored.'); return; }
        this.phase.set('ready'); this.error.set('Your change has not been saved. Check your connection and try again.');
      },
    });
  }

  private acceptStarted(shareId: string, started: StartedRespondentSession): void {
    this.shareId.set(shareId); this.token.set(started.respondentSession);
    sessionStorage.setItem(secretKey(started.sessionId), JSON.stringify({ token: started.respondentSession, shareId } satisfies StoredSecret));
    this.acceptSession({ ...started, definition: started.release ?? started.definition ?? {}, answers: started.answers ?? {}, status: started.status ?? 'DRAFT' });
  }

  private acceptSession(session: RespondentSession): void {
    this.session.set(session);
    this.state.set(reconcileServerProjection(this.state(), { answers: session.answers, invalidInputs: session.invalidInputs }));
    const pages = canonicalPages(session.definition).map((page) => page.id);
    const reachable = session.reachablePageIds?.length ? session.reachablePageIds : pages;
    this.reachablePageIds.set(reachable); this.currentPageId.set(reachable.includes(this.currentPageId() ?? '') ? this.currentPageId() : reachable[0] ?? null);
    this.requiredCount.set(session.requiredCount ?? 0); this.completedRequiredCount.set(session.completedRequiredCount ?? 0);
    this.phase.set(session.status === 'SUBMITTED' ? 'receipt' : 'ready');
  }

  private acceptProjection(projection: TypedSessionProjection): void {
    const current = this.session(); if (!current) return;
    this.session.set({ ...current, revision: projection.acceptedRevision, answers: projection.answers });
    this.state.set(reconcileServerProjection(this.state(), { answers: projection.answers, invalidInputs: projection.invalidInputs }));
    this.reachablePageIds.set(projection.reachablePageIds);
    if (!projection.reachablePageIds.includes(this.currentPageId() ?? '')) this.currentPageId.set(projection.reachablePageIds[0] ?? null);
    this.requiredCount.set(projection.requiredCount); this.completedRequiredCount.set(projection.completedRequiredCount); this.phase.set('ready');
  }

  private reconcileAttempt(attemptId: string): void {
    const current = this.session(); const token = this.token();
    if (!current || !token) return;
    this.error.set('Checking whether your response was received…');
    timer(500, 1000).pipe(
      switchMap(() => this.api.submissionOperation(current.sessionId, token, attemptId)),
      expand((operation) => operation.state === 'started' ? timer(1000).pipe(switchMap(() => this.api.submissionOperation(current.sessionId, token, attemptId))) : EMPTY),
      takeWhile((operation) => operation.state === 'started', true),
      catchError(() => { this.phase.set('review'); this.error.set('We could not confirm submission. Please try again with the same response.'); return EMPTY; }),
    ).subscribe((operation) => this.acceptOperation(operation));
  }

  private acceptOperation(operation: SubmissionOperation): void {
    if (operation.state === 'succeeded' && (operation.receiptId ?? operation.submissionId)) this.acceptReceipt(operation.receiptId ?? operation.submissionId!);
    else if (operation.state === 'failed') { this.phase.set('review'); this.error.set('Submission was not completed. Please review and try again.'); }
  }

  private acceptReceipt(receiptId: string): void {
    const current = this.session(); if (!current) return;
    // A submitted response cannot be resumed from a shared device after receipt.
    sessionStorage.removeItem(secretKey(current.sessionId));
    this.receiptId.set(receiptId); this.phase.set('receipt'); this.error.set(null);
    void this.router.navigate(['/sessions', current.sessionId, 'receipt']);
  }

  private secret(sessionId: string): StoredSecret | null {
    try { const value = JSON.parse(sessionStorage.getItem(secretKey(sessionId)) ?? 'null'); return typeof value?.token === 'string' && typeof value?.shareId === 'string' ? value : null; } catch { return null; }
  }

  private fail(message: string): void { this.phase.set('error'); this.error.set(message); }
}

function secretKey(sessionId: string): string { return `smart-intake.respondent.${sessionId}`; }
function mutationId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function browserLocale(): string { return navigator.language.split('-')[0] || 'en'; }
function startFailure(error: HttpErrorResponse): string { return error.status === 410 ? 'This form is no longer accepting new responses.' : error.status === 404 ? 'This public form is unavailable.' : 'We could not start this form. Please try again.'; }
function sessionFailure(error: HttpErrorResponse): string { return error.status === 401 || error.status === 403 ? 'This response is no longer available on this device.' : 'We could not restore this response.'; }
function submissionFailure(error: HttpErrorResponse): string { return error.status === 409 ? 'Your review is out of date. Review the response again before submitting.' : error.status === 422 ? 'The response still needs attention before it can be submitted.' : 'Submission could not be completed.'; }

function runtimeDefinition(definition: Record<string, unknown> | undefined): RuntimeDefinition {
  const fields = ((definition?.['data'] as { fields?: CanonicalField[] } | undefined)?.fields ?? []);
  return { fields: fields.map(runtimeField) };
}
function runtimeField(field: CanonicalField): RuntimeFieldDefinition {
  const constraints = field['constraints'] as Record<string, unknown> | undefined;
  const options = Array.isArray(field['options']) ? field['options'].map((option) => typeof option === 'string' ? option : String((option as Record<string, unknown>)['id'])) : undefined;
  const type = String(field['type'] ?? 'text') as RuntimeFieldDefinition['type'];
  const itemFields = ((field['itemSchema'] as { fields?: CanonicalField[] } | undefined)?.fields ?? []).map(runtimeField);
  return {
    id: String(field['id']), type, readOnly: Boolean(field['readOnly']), calculated: Boolean(field['calculated']), allowUnknown: Boolean(field['allowUnknown']), allowDeclined: Boolean(field['allowDeclined']), allowNotApplicable: Boolean(field['allowNotApplicable']), options,
    min: stringValue(constraints?.['min']), max: stringValue(constraints?.['max']), step: stringValue(constraints?.['step']), scale: numberValue(constraints?.['scale']), minItems: numberValue(constraints?.['minItems']), maxItems: numberValue(constraints?.['maxItems']), minLength: numberValue(constraints?.['minLength']), maxLength: numberValue(constraints?.['maxLength']), exclusiveOptionIds: stringArray(constraints?.['exclusiveOptionIds']), normalizer: field['normalizer'] as RuntimeFieldDefinition['normalizer'], hiddenRetention: field['hiddenRetention'] as RuntimeFieldDefinition['hiddenRetention'], itemFields: itemFields.length ? itemFields : undefined,
  };
}
function canonicalPages(definition: Record<string, unknown> | undefined): { id: string; title: string; fieldIds: readonly string[] }[] {
  const messages = (((definition?.['translations'] as Record<string, { messages?: Record<string, string> }> | undefined)?.[String(definition?.['defaultLocale'] ?? 'en')] ?? {}).messages ?? {});
  const phases = ((definition?.['flow'] as { phases?: Record<string, unknown>[] } | undefined)?.phases ?? []);
  return phases.flatMap((phase) => (Array.isArray(phase['pages']) ? phase['pages'] as Record<string, unknown>[] : []).map((page) => ({ id: String(page['id']), title: messages[String(page['titleKey'])] ?? String(page['id']), fieldIds: (Array.isArray(page['sections']) ? page['sections'] as Record<string, unknown>[] : []).flatMap((section) => (Array.isArray(section['nodes']) ? section['nodes'] as Record<string, unknown>[] : []).map((node) => String(node['fieldId'] ?? ''))).filter(Boolean) })));
}
function pageForField(definition: Record<string, unknown>, fieldId: string): string | undefined { return canonicalPages(definition).find((page) => page.fieldIds.includes(fieldId))?.id; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' ? value : undefined; }
function stringArray(value: unknown): readonly string[] | undefined { return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined; }
function inputAnswer(field: RuntimeFieldDefinition, raw: string | boolean | readonly string[]): InputAnswerCell {
  if (field.type === 'boolean') return { status: 'answered', value: raw === true };
  if (field.type === 'multiChoice' || field.type === 'attachments') return { status: 'answered', value: Array.isArray(raw) ? raw : [] };
  return { status: 'answered', value: String(raw) };
}
