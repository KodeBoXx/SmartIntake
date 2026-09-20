import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
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
export type StaffWorkspace = components['schemas']['PermittedWorkspaceChoice'];
export type StaffOrganization = components['schemas']['PermittedOrganizationChoice'];
export type StaffSession = { identity: StaffIdentity; organizations: StaffOrganization[]; currentOrganizationId: string | null; csrfToken?: string };
export type CreatedForm = { id: string; draftId: string; revision: number; definition: FormDefinition };
export type SavedDraft = { revision: number; definition: FormDefinition; diagnostics: unknown[] };
export type PublishedForm = { releaseId: string; version: number; shareId: string; status: string };
export type FormSummary = { id: string; formKey: string; title: string; status: string; revision: number; updatedAt: string };
export type CurrentDraft = { id: string; revision: number; definition: FormDefinition; diagnostics: unknown[] };
export type CatalogForm = components['schemas']['CatalogForm'];
export type CatalogFolder = components['schemas']['CatalogFolder'];
export type CatalogTag = components['schemas']['CatalogTag'];
export type CatalogSettings = components['schemas']['CatalogSettings'];
export type CatalogSearch = {
  q?: string; status?: string; owner?: string; folder?: string; tag?: readonly string[];
  archived?: boolean; limit?: number; cursor?: string;
};
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

  platformOrganizations(): Observable<components['schemas']['Organization'][]> { return this.http.get<components['schemas']['OrganizationCollection']>('/v1/platform/organizations', this.staff()).pipe(map((response) => response.items)); }
  createPlatformOrganization(body: components['schemas']['OrganizationCreateRequest']): Observable<components['schemas']['Organization']> { return this.http.post<components['schemas']['OrganizationResponse']>('/v1/platform/organizations', body, this.staff()).pipe(map((response) => response.organization)); }
  updateOrganization(organizationId: string, revision: number, body: components['schemas']['OrganizationUpdateRequest']): Observable<components['schemas']['Organization']> { return this.http.patch<components['schemas']['OrganizationResponse']>(`/v1/platform/organizations/${organizationId}`, body, { headers: new HttpHeaders({ 'If-Match': this.etag(revision) }), withCredentials: true }).pipe(map((response) => response.organization)); }
  organizationUsers(organizationId: string): Observable<components['schemas']['OrganizationUser'][]> { return this.http.get<components['schemas']['OrganizationUserCollection']>(`/v1/organizations/${organizationId}/users`, this.staff()).pipe(map((response) => response.items)); }
  addOrganizationUser(organizationId: string, body: components['schemas']['OrganizationUserCreateRequest']): Observable<components['schemas']['OrganizationUser']> { return this.http.post<components['schemas']['OrganizationUserResponse']>(`/v1/organizations/${organizationId}/users`, body, this.staff()).pipe(map((response) => response.organizationUser)); }
  updateOrganizationUser(organizationId: string, userId: string, revision: number, body: components['schemas']['OrganizationUserUpdateRequest']): Observable<components['schemas']['OrganizationUser']> { return this.http.patch<components['schemas']['OrganizationUserResponse']>(`/v1/organizations/${organizationId}/users/${userId}`, body, { headers: new HttpHeaders({ 'If-Match': this.etag(revision) }), withCredentials: true }).pipe(map((response) => response.organizationUser)); }
  assignWorkspaceRoles(workspaceId: string, userId: string, revision: number, body: components['schemas']['WorkspaceRoleAssignmentRequest']): Observable<components['schemas']['WorkspaceRole']> { return this.http.put<components['schemas']['WorkspaceRoleResponse']>(`/v1/workspaces/${workspaceId}/users/${userId}/roles`, body, { headers: new HttpHeaders({ 'If-Match': this.etag(revision), 'Idempotency-Key': crypto.randomUUID() }), withCredentials: true }).pipe(map((response) => response.workspaceRole)); }
  inviteOrganizationUser(organizationId: string, userId: string, name = 'Invitation'): Observable<components['schemas']['Invitation']> { return this.http.post<components['schemas']['InvitationResponse']>(`/v1/organizations/${organizationId}/users/${userId}/invitations`, { name }, this.staff()).pipe(map((response) => response.invitation)); }
  organizationPolicies(organizationId: string): Observable<unknown[]> { return this.http.get<{ items?: unknown[] }>(`/v1/organizations/${organizationId}/policies`, this.staff()).pipe(map((response) => response.items ?? [])); }

  catalogForms(workspaceId: string, search: CatalogSearch = {}): Observable<components['schemas']['CatalogPage']> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(search)) {
      if (value === undefined || value === '') continue;
      if (Array.isArray(value)) value.forEach((tag) => { params = params.append(key, tag); });
      else params = params.set(key, String(value));
    }
    return this.http.get<components['schemas']['CatalogPage']>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/catalog/forms`, { withCredentials: true, params });
  }
  duplicateCatalogForm(workspaceId: string, formId: string): Observable<CatalogForm> { return this.http.post<CatalogForm>(`/v1/workspaces/${workspaceId}/catalog/forms/${formId}/duplicate`, {}, this.staff()); }
  archiveCatalogForm(workspaceId: string, formId: string): Observable<CatalogForm> { return this.http.post<CatalogForm>(`/v1/workspaces/${workspaceId}/catalog/forms/${formId}/archive`, {}, this.staff()); }
  restoreCatalogForm(workspaceId: string, formId: string): Observable<CatalogForm> { return this.http.post<CatalogForm>(`/v1/workspaces/${workspaceId}/catalog/forms/${formId}/restore`, {}, this.staff()); }
  transferCatalogFormOwnership(workspaceId: string, formId: string, accountId: string): Observable<CatalogForm> { return this.http.put<CatalogForm>(`/v1/workspaces/${workspaceId}/catalog/forms/${formId}/ownership`, { accountId }, this.staff()); }
  classifyCatalogForm(workspaceId: string, formId: string, body: components['schemas']['CatalogClassification']): Observable<void> { return this.http.put<void>(`/v1/workspaces/${workspaceId}/catalog/forms/${formId}/classification`, body, this.staff()); }
  catalogFolders(workspaceId: string): Observable<CatalogFolder[]> { return this.http.get<CatalogFolder[]>(`/v1/workspaces/${workspaceId}/folders`, this.staff()); }
  createCatalogFolder(workspaceId: string, name: string): Observable<CatalogFolder> { return this.http.post<CatalogFolder>(`/v1/workspaces/${workspaceId}/folders`, { name }, this.staff()); }
  catalogTags(workspaceId: string): Observable<CatalogTag[]> { return this.http.get<CatalogTag[]>(`/v1/workspaces/${workspaceId}/tags`, this.staff()); }
  createCatalogTag(workspaceId: string, name: string, color?: string): Observable<CatalogTag> { return this.http.post<CatalogTag>(`/v1/workspaces/${workspaceId}/tags`, { name, ...(color ? { color } : {}) }, this.staff()); }
  effectiveCatalogSettings(workspaceId: string): Observable<CatalogSettings> { return this.http.get<CatalogSettings>(`/v1/workspaces/${workspaceId}/catalog/settings`, this.staff()); }
  updateCatalogSettings(workspaceId: string, body: components['schemas']['CatalogSettingsInput']): Observable<CatalogSettings> { return this.http.put<CatalogSettings>(`/v1/workspaces/${workspaceId}/catalog/settings`, body, this.staff()); }

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
    const value = body as { authenticatedSession?: { safeIdentity?: StaffIdentity; organizations?: StaffOrganization[]; currentOrganizationId?: string | null }; safeIdentity?: StaffIdentity };
    const authenticated = value.authenticatedSession;
    const identity = authenticated?.safeIdentity ?? value.safeIdentity;
    if (!identity?.accountId || !identity.username) throw new Error('The server returned an invalid staff session.');
    return { identity, organizations: authenticated?.organizations ?? [], currentOrganizationId: authenticated?.currentOrganizationId ?? null };
  }));
}
