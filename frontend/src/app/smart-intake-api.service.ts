import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { FormDefinition, ResponseSummary } from './models/form-definition.models';
import type { components, operations } from './generated/api-4.1.0';
import type { RuntimeOperation, ServerProjection } from './runtime/runtime-types';

export { AjvContractValidationAdapter } from './ajv-contract-validation.adapter';
export type { ContractDiagnostic, ContractValidationResult } from './ajv-contract-validation.adapter';
export type { CanonicalDecimal, CanonicalInt64 } from './generated/contracts';

type GeneratedSignInRequest = components['schemas']['SignInRequest'];
type GeneratedSessionMutation = components['schemas']['SessionMutation'];
type GeneratedAcknowledgment = components['schemas']['Acknowledgment'];
type GeneratedInputAnswer = components['schemas']['InputAnswerValue'];
export type StaffIdentity = components['schemas']['SafeAccountIdentity'];
export type StaffSession = { identity: StaffIdentity; csrfToken?: string };
export type CreatedForm = { id: string; draftId: string; revision: number; definition: FormDefinition };
export type SavedDraft = { revision: number; definition: FormDefinition; diagnostics: unknown[] };
export type PublishedForm = { releaseId: string; version: number; shareId: string; status: string };
export type FormSummary = { id: string; formKey: string; title: string; status: string; revision: number; updatedAt: string };
export type CurrentDraft = { id: string; revision: number; definition: FormDefinition; diagnostics: unknown[] };
export type PublishedSchema = operations['ON-get-v1-schemas-kind-version-4c108bde88']['responses'][200]['content']['application/schema+json'];
export type TypedSessionProjection = ServerProjection & {
  readonly acceptedRevision: number;
  readonly validation: readonly unknown[];
  readonly reachablePageIds: readonly string[];
  readonly requiredCount: number;
  readonly completedRequiredCount: number;
};

@Injectable({ providedIn: 'root' })
export class SmartIntakeApiService {
  constructor(private readonly http: HttpClient) {}

  /** Cookie-authenticated safe identity; a 401 issues the one-time login CSRF header. */
  session(): Observable<StaffSession> {
    return this.http.get<unknown>('/v1/auth/session', { withCredentials: true }).pipe(mapSession);
  }

  signIn(credentials: GeneratedSignInRequest, loginCsrfToken: string): Observable<void> {
    return this.http.post<unknown>('/v1/auth/sign-in', credentials, {
      withCredentials: true,
      headers: new HttpHeaders({ 'X-Login-CSRF-Token': loginCsrfToken }),
    }).pipe(map(() => void 0));
  }

  /** One-time setup is intentionally separate from the generated 4.1 sign-in contract. */
  bootstrap(input: { email: string; password: string; organizationName: string; workspaceName: string }): Observable<void> {
    return this.http.post('/v1/auth/bootstrap', input, { withCredentials: true }).pipe(map(() => void 0));
  }

  signOut(): Observable<void> {
    return this.http.post<void>('/v1/auth/sign-out', {}, { withCredentials: true });
  }

  activate(body: components['schemas']['AccountActivationRequest']): Observable<unknown> {
    return this.http.post('/v1/auth/activate', body, { withCredentials: true });
  }

  requestRecovery(body: components['schemas']['RecoveryRequest']): Observable<unknown> {
    return this.http.post('/v1/auth/recovery', body, { withCredentials: true });
  }

  resetPassword(body: components['schemas']['PasswordResetRequest']): Observable<unknown> {
    return this.http.post('/v1/auth/reset', body, { withCredentials: true });
  }

  listForms(): Observable<FormSummary[]> {
    return this.http.get<FormSummary[]>('/v1/workspaces/local/forms', this.staff());
  }

  currentDraft(formId: string, draftId: string): Observable<CurrentDraft> {
    return this.http.get<CurrentDraft>(`/v1/workspaces/local/forms/${formId}/drafts/${draftId}`, this.staff());
  }

  listResponses(): Observable<ResponseSummary[]> {
    return this.http.get<ResponseSummary[]>('/v1/workspaces/local/submissions', this.staff());
  }

  responseDetail(id: string): Observable<unknown> {
    return this.http.get<unknown>(`/v1/workspaces/local/submissions/${id}`, this.staff());
  }

  exportDefinition(formId: string): Observable<unknown> {
    return this.http.get<unknown>(`/v1/workspaces/local/forms/${formId}/definition-export`, this.staff());
  }

  importDefinition(formId: string, revision: number, definition: unknown): Observable<{ revision: number }> {
    return this.http.put<{ revision: number }>(`/v1/workspaces/local/forms/${formId}/definition-import`, definition, {
      headers: new HttpHeaders({ 'If-Match': this.etag(revision) }), withCredentials: true,
    });
  }

  exportResponses(): Observable<ResponseSummary[]> {
    return this.http.get<ResponseSummary[]>('/v1/workspaces/local/exports.json', this.staff());
  }

  /** M2 publication route; use the generated OpenAPI operation response type. */
  publishedSchema(kind: string, version = '4.0.0'): Observable<PublishedSchema> {
    return this.http.get<PublishedSchema>(`/v1/schemas/${encodeURIComponent(kind)}/${encodeURIComponent(version)}`);
  }

  createForm(formKey: string, title: string): Observable<CreatedForm> {
    return this.http.post<CreatedForm>('/v1/workspaces/local/forms', { formKey, title }, this.staff());
  }

  updateDraft(formId: string, draftId: string, revision: number, definition: FormDefinition): Observable<SavedDraft> {
    return this.http.put<SavedDraft>(`/v1/workspaces/local/forms/${formId}/drafts/${draftId}`, { definition }, {
      headers: new HttpHeaders({ 'If-Match': this.etag(revision) }), withCredentials: true,
    });
  }

  publish(formId: string): Observable<PublishedForm> {
    return this.http.post<PublishedForm>(`/v1/workspaces/local/forms/${formId}/releases`, {}, this.staff());
  }

  startSession(formId: string): Observable<{ sessionId: string; respondentSession: string; revision: number }> {
    return this.http.post<{ sessionId: string; respondentSession: string; revision: number }>(`/v1/public/forms/${formId}/sessions`, {});
  }

  patchSession(sessionId: string, respondentToken: string, body: unknown): Observable<{ acceptedRevision: number }> {
    return this.http.patch<{ acceptedRevision: number }>(`/v1/sessions/${sessionId}`, body, this.respondent(respondentToken));
  }

  patchTypedSession(
    sessionId: string,
    respondentToken: string,
    baseRevision: number,
    clientMutationId: string,
    operations: readonly RuntimeOperation[],
    currentPageId?: string,
  ): Observable<TypedSessionProjection> {
    return this.http.patch<TypedSessionProjection>(`/v1/sessions/${sessionId}`, {
      baseRevision,
      clientMutationId,
      operations: operations.map((operation) => this.wireOperation(operation)),
      ...(currentPageId === undefined ? {} : { currentPageId }),
    }, this.respondent(respondentToken));
  }

  submitSession(
    sessionId: string,
    respondentToken: string,
    sessionRevision: number,
    reviewDigest?: string,
    attemptId?: string,
    acknowledgments: readonly GeneratedAcknowledgment[] = [],
  ): Observable<{ receiptId: string }> {
    return this.http.post<{ receiptId: string }>(`/v1/sessions/${sessionId}/submissions`, {
      sessionRevision,
      ...(reviewDigest === undefined ? {} : { reviewDigest, attemptId, acknowledgments }),
    }, this.respondent(respondentToken));
  }

  private staff() {
    return { withCredentials: true };
  }

  private respondent(respondentToken: string) {
    return { headers: new HttpHeaders({ 'X-Respondent-Session': respondentToken }) };
  }

  private wireOperation(operation: RuntimeOperation): GeneratedSessionMutation {
    const target = {
      fieldId: operation.target.fieldId,
      ...(operation.target.rowPath === undefined ? {} : {
        rowPath: operation.target.rowPath.map((segment) => ({ ...segment })),
      }),
    };
    switch (operation.kind) {
      case 'set': return {
        op: 'set', ...target,
        value: wireInputAnswer(operation.answer ?? { status: 'answered', value: operation.value }),
      };
      case 'clear': return { op: 'clear', ...target };
      case 'markInvalid': return { op: 'markInvalid', ...target, reason: operation.reason };
      case 'addItem': return {
        op: 'addItem', ...target, itemId: operation.itemId,
        initialFields: Object.fromEntries(Object.entries(operation.fields ?? {})
          .map(([fieldId, answer]) => [fieldId, wireInputAnswer(answer)])),
      };
      case 'removeItem': return { op: 'removeItem', ...target, itemId: operation.itemId };
      case 'moveItem': return {
        op: 'moveItem', ...target, itemId: operation.itemId,
        ...(operation.beforeItemId === undefined ? {} : { beforeItemId: operation.beforeItemId }),
      };
    }
  }

  private etag(revision: number) {
    return `"${revision}"`;
  }
}

function wireInputAnswer(answer: unknown): GeneratedInputAnswer {
  return JSON.parse(JSON.stringify(answer)) as GeneratedInputAnswer;
}

function mapSession(source: Observable<unknown>): Observable<StaffSession> {
  return source.pipe(map((body) => {
    const value = body as { authenticatedSession?: { safeIdentity?: StaffIdentity }; safeIdentity?: StaffIdentity };
    const authenticated = value.authenticatedSession;
    const identity = authenticated?.safeIdentity ?? value.safeIdentity;
    if (!identity?.accountId || !identity.username) throw new Error('The server returned an invalid staff session.');
    return { identity };
  }));
}
