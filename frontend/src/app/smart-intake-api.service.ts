import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { EMPTY, Observable, expand, map, reduce, switchMap, tap } from 'rxjs';
import { FormDefinition, ResponseSummary } from './models/form-definition.models';
import type { components, operations } from './generated/api-4.1.0';
import type { RuntimeOperation, ServerProjection } from './runtime/runtime-types';
import type { AuthoringComment, AuthoringCommand, AuthoringDocument, AuthoringHistoryEntry, AuthoringImportCandidate, ContentSettings, GovernedContentScope, LocaleBundle, LocaleReview, PresenceMember, PreviewResult, ReusableComponent, SpeechResult, SupportedAuthoringLocale, ThemeSettings } from './features/authoring/authoring.types';
import { canonicalPatches } from './features/authoring/authoring-patches';

export { AjvContractValidationAdapter } from './ajv-contract-validation.adapter';
export type { ContractDiagnostic, ContractValidationResult } from './ajv-contract-validation.adapter';
export type { CanonicalDecimal, CanonicalInt64 } from './generated/contracts';

type GeneratedSignInRequest = components['schemas']['SignInRequest'];
type GeneratedSessionMutation = components['schemas']['SessionMutation'];
type GeneratedAcknowledgment = components['schemas']['Acknowledgment'];
type GeneratedInputAnswer = components['schemas']['InputAnswerValue'];
export type StaffIdentity = components['schemas']['SafeAccountIdentity'];
export type StaffWorkspace = components['schemas']['PermittedWorkspaceChoice'];
export type StaffOrganization = components['schemas']['PermittedOrganizationChoice'] & { organizationRoles: ('owner' | 'administrator' | 'member')[] };
export type StaffSession = { identity: StaffIdentity; platformRoles: ('administrator')[]; organizations: StaffOrganization[]; currentOrganizationId: string | null; currentWorkspaceId?: string | null; csrfToken?: string };
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
export type AuthorizedDeliveryCopies = {
  activationCopyLink?: string;
  invitationCopyLink?: string;
  recoveryCopyLink?: string;
  temporaryPasswordCopy?: string;
};

type BackendComment = { id: string; pointer: string; body: string; authorId?: string; createdAt?: string };
type BackendPresence = { accountId: string; cursor?: string; displayName: string; expiresAt?: string };
type BackendHistory = { id: string; revision: number; operation: string; createdAt: string; beforeHash?: string; afterHash?: string; undone?: boolean };
type BackendComponent = { id: string; key: string; name: string; version: number; status: string; hash: string; updatedAt: string };
type BackendTheme = { revision: number; theme?: { themeKey?: string; preset?: string; version?: string; tokens?: Record<string, string> }; locks?: string[]; preflight?: ThemeSettings['preflight'] };
type BackendContent = { revision: number; guidance?: ContentSettings['guidance']; translations?: ContentSettings['translations']; localeCompleteness?: Record<string, { present: boolean; complete: boolean }>; localeReviews?: LocaleReview[] };

function authoringComment(comment: BackendComment): AuthoringComment {
  return { id: comment.id, targetId: comment.pointer, body: comment.body, author: comment.authorId ?? 'Current collaborator', createdAt: comment.createdAt ?? '' };
}

function authoringHistory(entry: BackendHistory): AuthoringHistoryEntry {
  return { id: entry.id, revision: entry.revision, label: entry.operation.replaceAll('_', ' '), at: entry.createdAt, undone: entry.undone, impact: entry.beforeHash === entry.afterHash ? [] : ['Canonical package changed.'] };
}

function authoringTheme(value: BackendTheme): ThemeSettings {
  const theme = value.theme ?? {};
  const legacy = theme as { locks?: string[]; preflight?: ThemeSettings['preflight'] };
  return { preset: theme.preset ?? theme.themeKey ?? 'Certinal', themeKey: theme.themeKey ?? theme.preset, version: String(theme.version ?? '1'), revision: value.revision, tokens: theme.tokens ?? {}, locks: value.locks ?? legacy.locks ?? [], preflight: value.preflight ?? legacy.preflight ?? [] };
}

function authoringContent(value: BackendContent): ContentSettings {
  const translations = value.translations ?? {};
  const canonicalBundles = Object.fromEntries(
    (['en', 'hi', 'ar'] as const)
      .filter((locale) => translations[locale] !== undefined)
      .map((locale) => [locale, canonicalBundle(translations[locale])]),
  ) as Partial<Record<SupportedAuthoringLocale, LocaleBundle>>;
  return { locale: 'en', translations: canonicalBundles, guidance: value.guidance ?? {}, revision: value.revision, localeCompleteness: value.localeCompleteness, localeReviews: value.localeReviews ?? [] };
}

function canonicalBundle(value: unknown): LocaleBundle {
  const bundle = (value ?? {}) as Partial<LocaleBundle>;
  return { direction: bundle.direction === 'rtl' ? 'rtl' : 'ltr', messages: bundle.messages ?? {}, ...(bundle.pronunciations ? { pronunciations: bundle.pronunciations } : {}), ...(bundle.reviewState ? { reviewState: bundle.reviewState } : {}) };
}

export function authoringDocument(value: unknown): AuthoringDocument {
  const response = value as { formId?: string; draftId?: string; revision?: number; definition?: unknown; packageHash?: string; diagnostics?: AuthoringDocument['diagnostics'] };
  const definition = (response.definition ?? value) as Record<string, unknown>;
  if (Array.isArray(definition['phases'])) return {
    id: response.draftId ?? String(definition['id'] ?? 'draft'), revision: response.revision ?? Number(definition['revision'] ?? 0), title: String(definition['title'] ?? 'Untitled intake form'),
    phases: definition['phases'] as AuthoringDocument['phases'], definition, packageHash: response.packageHash, diagnostics: response.diagnostics,
  };
  const flow = definition['flow'] as { phases?: Record<string, unknown>[] } | undefined;
  if (Array.isArray(flow?.phases)) return {
    id: response.draftId ?? String(definition['id'] ?? 'draft'), revision: response.revision ?? 0, title: String(definition['formKey'] ?? 'Untitled intake form'), definition, packageHash: response.packageHash, diagnostics: response.diagnostics,
    phases: flow.phases.map((phase, phaseIndex) => ({ id: String(phase['id'] ?? `phase-${phaseIndex + 1}`), title: translated(definition, String(phase['titleKey'] ?? ''), `Phase ${phaseIndex + 1}`), pages: (Array.isArray(phase['pages']) ? phase['pages'] as Record<string, unknown>[] : []).map((page, pageIndex) => ({ id: String(page['id'] ?? `page-${pageIndex + 1}`), title: translated(definition, String(page['titleKey'] ?? ''), `Page ${pageIndex + 1}`), sections: (Array.isArray(page['sections']) ? page['sections'] as Record<string, unknown>[] : []).map((section, sectionIndex) => ({ id: String(section['id'] ?? `section-${sectionIndex + 1}`), title: translated(definition, String(section['titleKey'] ?? ''), `Section ${sectionIndex + 1}`), nodes: (Array.isArray(section['nodes']) ? section['nodes'] as Record<string, unknown>[] : []).map((node, nodeIndex) => projectedNode(definition, node, String(node['id'] ?? `node-${nodeIndex + 1}`), `/flow/phases/${phaseIndex}/pages/${pageIndex}/sections/${sectionIndex}/nodes/${nodeIndex}`)) })) })) })),
  };
  const pages = Array.isArray(definition['pages']) ? definition['pages'] as Record<string, unknown>[] : [];
  return {
    id: response.draftId ?? String(definition['id'] ?? 'draft'), revision: response.revision ?? 0, title: String(definition['title'] ?? definition['formKey'] ?? 'Untitled intake form'), definition,
    phases: [{ id: 'phase-intake', title: 'Intake', pages: pages.map((page, pageIndex) => {
      const pageId = String(page['id'] ?? `page-${pageIndex + 1}`); const fields = Array.isArray(page['fields']) ? page['fields'] as Record<string, unknown>[] : [];
      return { id: pageId, title: String(page['title'] ?? `Page ${pageIndex + 1}`), sections: [{ id: `section-${pageId}`, title: 'Questions', nodes: fields.map((field, fieldIndex) => ({ id: String(field['id'] ?? `field-${fieldIndex + 1}`), kind: 'field' as const, label: String(field['label'] ?? field['title'] ?? field['key'] ?? `Field ${fieldIndex + 1}`), control: String(field['control'] ?? field['type'] ?? 'field') })) }] };
    }) }],
  };
}

function fieldLabelKey(definition: Record<string, unknown>, fieldId: string): unknown {
  const fields = ((definition.data as { fields?: Record<string, unknown>[] } | undefined)?.fields ?? []);
  return fields.find((field) => field.id === fieldId)?.labelKey;
}

function canonicalField(definition: Record<string, unknown>, fieldId: string): Record<string, unknown> | undefined {
  const visit = (fields: readonly Record<string, unknown>[]): Record<string, unknown> | undefined => {
    for (const field of fields) {
      if (field.id === fieldId) return field;
      const nested = ((field.itemSchema as { fields?: Record<string, unknown>[] } | undefined)?.fields ?? []);
      const found = visit(nested);
      if (found) return found;
    }
    return undefined;
  };
  return visit(((definition.data as { fields?: Record<string, unknown>[] } | undefined)?.fields ?? []));
}

/** Projects canonical child schemas as selectable visual descendants without mutating the package. */
function projectedNode(definition: Record<string, unknown>, node: Record<string, unknown>, id: string, path: string): AuthoringDocument['phases'][number]['pages'][number]['sections'][number]['nodes'][number] {
  const fieldId = String(node.fieldId ?? '');
  const field = canonicalField(definition, fieldId);
  const placements = Array.isArray(node.children) ? node.children as Record<string, unknown>[] : [];
  const children = ((field?.itemSchema as { fields?: Record<string, unknown>[] } | undefined)?.fields ?? []).map((child, index) => {
    const placement = placements.find((candidate) => candidate.fieldId === child.id);
    return projectedChild(definition, child, id, placement, `${path}/children/${placement ? placements.indexOf(placement) : index}`);
  });
  return {
    id,
    kind: String(node.kind ?? 'field') === 'question' ? 'field' : 'display',
    label: translated(definition, String(field?.labelKey ?? node.labelKey ?? ''), String(node.kind ?? 'content')),
    control: String(node.control ?? node.kind ?? 'content'), fieldId, placementId: String(node.id ?? id), placementPath: path,
    ...(children.length ? { children } : {}),
  };
}

function projectedChild(definition: Record<string, unknown>, field: Record<string, unknown>, parentNodeId: string, placement: Record<string, unknown> | undefined, path: string): AuthoringDocument['phases'][number]['pages'][number]['sections'][number]['nodes'][number] {
  const id = placement ? String(placement.id) : `${parentNodeId}__${String(field.id)}`;
  const placements = Array.isArray(placement?.children) ? placement.children as Record<string, unknown>[] : [];
  const nested = ((field.itemSchema as { fields?: Record<string, unknown>[] } | undefined)?.fields ?? []).map((child, index) => {
    const childPlacement = placements.find((candidate) => candidate.fieldId === child.id);
    return projectedChild(definition, child, id, childPlacement, `${path}/children/${childPlacement ? placements.indexOf(childPlacement) : index}`);
  });
  return { id, kind: 'field', label: translated(definition, String(field.labelKey ?? ''), String(field.key ?? field.id)), control: String(placement?.control ?? field.type ?? 'text'), fieldId: String(field.id), ...(placement ? { placementId: String(placement.id), placementPath: path } : {}), ...(nested.length ? { children: nested } : {}) };
}

function translated(definition: Record<string, unknown>, key: string, fallback: string): string {
  const locale = String(definition.defaultLocale ?? 'en');
  const messages = (((definition.translations as Record<string, { messages?: Record<string, unknown> }> | undefined)?.[locale] ?? {}).messages ?? {});
  const value = messages[key];
  return typeof value === 'string' ? value : fallback;
}

function authoringPatch(command: AuthoringCommand, document: AuthoringDocument): readonly unknown[] {
  // M7's server persists bounded JSON-pointer commands. The UI's local grouping is
  // presentation-only, so persist its human-readable semantic log in the package's
  // permitted metadata extension rather than invoking any respondent endpoint.
  const patches = command.patches ?? canonicalPatches(document, command);
  const bundles = ((document.definition as { translations?: Record<string, { messages?: Record<string, unknown> }> }).translations ?? {});
  const structural: unknown[] = [];
  for (const patch of patches) {
    if (!patch || typeof patch !== 'object') continue;
    const path = (patch as { path?: string }).path ?? '';
    const match = path.match(/^\/translations\/([^/]+)\/messages\/(.+)$/);
    if (!match) continue;
    const activeLocale = match[1];
    const key = match[2];
    for (const [locale, bundle] of Object.entries(bundles)) {
      if (locale !== activeLocale && bundle.messages?.[key] === undefined) {
        structural.push({ op: 'add', path: `/translations/${locale}/messages/${key}`, value: '' });
      }
    }
  }
  return [...patches, ...structural];
}
export type PublishedSchema = operations['ON-get-v1-schemas-kind-version-4c108bde88']['responses'][200]['content']['application/schema+json'];
export type TypedSessionProjection = ServerProjection & {
  readonly acceptedRevision: number;
  readonly validation: readonly unknown[];
  readonly reachablePageIds: readonly string[];
  readonly requiredCount: number;
  readonly completedRequiredCount: number;
};

/** Public respondent data is always hydrated from the pinned release/session response. */
export type RespondentSession = TypedSessionProjection & {
  readonly sessionId: string;
  readonly revision: number;
  readonly status: 'DRAFT' | 'SUBMITTED' | string;
  readonly definition: Record<string, unknown>;
  readonly runtimeManifest?: { readonly sessionDate: string; readonly timeZone: string; readonly timeZoneDatabaseVersion: string };
};

export type StartedRespondentSession = RespondentSession & {
  readonly respondentSession: string;
  readonly locale?: string;
  readonly expiresAt?: string;
  readonly release?: Record<string, unknown>;
};

export type PublicReceipt = { readonly receiptId: string; readonly submittedAt?: string; readonly sessionId?: string; readonly shareId?: string };

export type RespondentReview = {
  readonly errors: readonly unknown[];
  readonly review?: Record<string, unknown>;
  readonly reviewDigest?: string;
};

export type SubmissionOperation = {
  readonly attemptId: string;
  readonly state: 'notStarted' | 'started' | 'succeeded' | 'failed' | string;
  readonly submissionId?: string;
  readonly receiptId?: string;
  readonly errorCode?: string;
};

@Injectable({ providedIn: 'root' })
export class SmartIntakeApiService {
  private readonly revisionEtags = new Map<string, string>();
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
  bootstrap(input: { email: string; password: string; organizationName: string; workspaceName: string; bootstrapToken?: string }): Observable<AuthorizedDeliveryCopies> {
    const { bootstrapToken, ...body } = input;
    return this.http.post<unknown>('/v1/auth/bootstrap', body, {
      withCredentials: true,
      ...(bootstrapToken ? { headers: new HttpHeaders({ 'X-Bootstrap-Token': bootstrapToken }) } : {}),
      observe: 'response',
    }).pipe(map((response) => authorizedDeliveryCopies(response, 'activationCopyLink', 'temporaryPasswordCopy')));
  }

  signOut(): Observable<void> {
    return this.http.post<void>('/v1/auth/sign-out', {}, { withCredentials: true });
  }

  platformOrganizationPage(cursor?: string): Observable<components['schemas']['OrganizationCollection']> {
    const params = new HttpParams().set('limit', 200).set('cursor', cursor ?? '');
    return this.http.get<components['schemas']['OrganizationCollection']>('/v1/platform/organizations', { ...this.staff(), params });
  }
  platformOrganizations(): Observable<components['schemas']['Organization'][]> {
    return this.platformOrganizationPage().pipe(
      expand((page) => page.page.nextCursor ? this.platformOrganizationPage(page.page.nextCursor) : EMPTY),
      reduce((items, page) => items.concat(page.items), [] as components['schemas']['Organization'][]),
    );
  }
  createPlatformOrganization(body: components['schemas']['OrganizationCreateRequest'], retryKey?: string): Observable<components['schemas']['Organization'] & AuthorizedDeliveryCopies> {
    return this.http.post<components['schemas']['OrganizationResponse']>('/v1/platform/organizations', body, this.mutation('POST', '/v1/platform/organizations', body, retryKey)).pipe(
      tap((response) => this.rememberEtag(response)),
      map((response) => ({ ...response.body!.organization, ...authorizedDeliveryCopies(response, 'activationCopyLink', 'invitationCopyLink', 'temporaryPasswordCopy') })),
    );
  }
  updateOrganization(organizationId: string, revision: number, body: components['schemas']['OrganizationUpdateRequest'], retryKey?: string): Observable<components['schemas']['Organization']> { const url = `/v1/platform/organizations/${organizationId}`; return this.revisioned(this.http.patch<components['schemas']['OrganizationResponse']>(url, body, this.mutation('PATCH', url, body, retryKey, revision))).pipe(map((response) => response.organization)); }
  organizationUsers(organizationId: string): Observable<components['schemas']['OrganizationUser'][]> { return this.http.get<components['schemas']['OrganizationUserCollection']>(`/v1/organizations/${organizationId}/users`, this.staff()).pipe(map((response) => response.items)); }
  addOrganizationUser(organizationId: string, body: components['schemas']['OrganizationUserCreateRequest'], retryKey?: string): Observable<AuthorizedDeliveryCopies> {
    const url = `/v1/organizations/${organizationId}/users`;
    return this.http.post<components['schemas']['InvitationResponse']>(url, body, this.mutation('POST', url, body, retryKey)).pipe(
      tap((response) => this.rememberEtag(response)),
      map((response) => authorizedDeliveryCopies(response, 'invitationCopyLink')),
    );
  }
  updateOrganizationUser(organizationId: string, userId: string, revision: number, body: components['schemas']['OrganizationUserUpdateRequest'], retryKey?: string): Observable<components['schemas']['OrganizationUser']> { const url = `/v1/organizations/${organizationId}/users/${userId}`; return this.revisioned(this.http.patch<components['schemas']['OrganizationUserResponse']>(url, body, this.mutation('PATCH', url, body, retryKey, revision))).pipe(map((response) => response.organizationUser)); }
  assignWorkspaceRoles(workspaceId: string, userId: string, revision: number, body: components['schemas']['WorkspaceRoleAssignmentRequest'], retryKey?: string): Observable<components['schemas']['WorkspaceRole']> { const url = `/v1/workspaces/${workspaceId}/users/${userId}/roles`; return this.revisioned(this.http.put<components['schemas']['WorkspaceRoleResponse']>(url, body, this.mutation('PUT', url, body, retryKey, revision))).pipe(map((response) => response.workspaceRole)); }
  inviteOrganizationUser(organizationId: string, userId: string, name = 'Invitation', retryKey?: string): Observable<components['schemas']['Invitation'] & AuthorizedDeliveryCopies> {
    const url = `/v1/organizations/${organizationId}/users/${userId}/invitations`;
    const body = { name };
    return this.http.post<components['schemas']['InvitationResponse']>(url, body, this.mutation('POST', url, body, retryKey)).pipe(
      tap((response) => this.rememberEtag(response)),
      map((response) => ({
        ...response.body!.invitation,
        ...authorizedDeliveryCopies(response, 'invitationCopyLink'),
      })),
    );
  }
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
  workspaceMembers(workspaceId: string): Observable<{ id: string; accountId: string; revision: number; roles: string[]; email?: string; displayName?: string }[]> { return this.http.get<{ items?: { accountId: string; revision: number; roles: string[]; email?: string; displayName?: string }[] }>(`/v1/workspaces/${workspaceId}/members`, this.staff()).pipe(map((response) => (response.items ?? []).map((item) => ({ ...item, id: item.accountId })))); }

  activate(body: components['schemas']['AccountActivationRequest']): Observable<AuthorizedDeliveryCopies> {
    return this.http.post<unknown>('/v1/auth/activate', body, { withCredentials: true, observe: 'response' }).pipe(map((response) => authorizedDeliveryCopies(response, 'activationCopyLink', 'temporaryPasswordCopy')));
  }

  requestRecovery(body: components['schemas']['RecoveryRequest']): Observable<AuthorizedDeliveryCopies> {
    return this.http.post<unknown>('/v1/auth/recovery', body, { withCredentials: true, observe: 'response' }).pipe(map((response) => authorizedDeliveryCopies(response, 'recoveryCopyLink')));
  }

  resetPassword(body: components['schemas']['PasswordResetRequest']): Observable<AuthorizedDeliveryCopies> {
    return this.http.post<unknown>('/v1/auth/reset', body, { withCredentials: true, observe: 'response' }).pipe(map((response) => authorizedDeliveryCopies(response, 'activationCopyLink', 'temporaryPasswordCopy')));
  }

  acceptInvitation(body: components['schemas']['InvitationAcceptanceRequest']): Observable<AuthorizedDeliveryCopies> {
    return this.http.post<void>('/v1/invitations/accept', body, { withCredentials: true }).pipe(map(() => ({})));
  }

  listForms(workspaceId: string): Observable<FormSummary[]> {
    return this.http.get<FormSummary[]>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/forms`, this.staff());
  }

  currentDraft(workspaceId: string, formId: string, draftId: string): Observable<CurrentDraft> {
    return this.http.get<CurrentDraft>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/forms/${formId}/drafts/${draftId}`, this.staff());
  }

  /** M7 authoring API: deliberately separate from public/respondent session APIs. */
  authoringDocument(workspaceId: string, formId: string, draftId: string): Observable<AuthoringDocument> {
    return this.http.get<unknown>(this.authoringBase(workspaceId, formId, draftId), this.staff()).pipe(map(authoringDocument));
  }

  authoringCommands(workspaceId: string, formId: string, draftId: string, revision: number, document: AuthoringDocument, commands: readonly AuthoringCommand[], idempotencyKey = this.createMutationAction()): Observable<AuthoringDocument> {
    const url = `${this.authoringBase(workspaceId, formId, draftId)}/commands`;
    const acceptedDependencyBreak = commands.some((command) =>
      (command.type === 'remove-node' || command.type === 'remove-page') && command.acceptInvalidDraft === true);
    return this.http.post<unknown>(url, {
      commands: commands.flatMap((command) => authoringPatch(command, document)), definition: document.definition,
      expectedHash: document.packageHash, ...(acceptedDependencyBreak ? { acceptInvalidDraft: true } : {}),
    }, { withCredentials: true, headers: new HttpHeaders({ 'If-Match': this.formRevisionEtag(revision), 'Idempotency-Key': idempotencyKey }) }).pipe(map(authoringDocument));
  }

  authoringHistory(workspaceId: string, formId: string, draftId: string): Observable<AuthoringHistoryEntry[]> {
    return this.http.get<BackendHistory[]>(`${this.authoringBase(workspaceId, formId, draftId)}/history`, this.staff()).pipe(map((history) => history.map(authoringHistory)));
  }

  authoringUndo(workspaceId: string, formId: string, draftId: string, revision: number, idempotencyKey = this.createMutationAction()): Observable<AuthoringDocument> {
    return this.authoringAction(workspaceId, formId, draftId, revision, 'undo', idempotencyKey);
  }

  authoringRedo(workspaceId: string, formId: string, draftId: string, revision: number, idempotencyKey = this.createMutationAction()): Observable<AuthoringDocument> {
    return this.authoringAction(workspaceId, formId, draftId, revision, 'redo', idempotencyKey);
  }

  resolveAuthoringConflict(workspaceId: string, formId: string, draftId: string, revision: number, conflictId: string, definition: unknown, idempotencyKey = this.createMutationAction()): Observable<AuthoringDocument> {
    const url = `${this.authoringBase(workspaceId, formId, draftId)}/resolve`;
    return this.http.post<unknown>(url, { conflictId, definition }, { withCredentials: true, headers: new HttpHeaders({ 'If-Match': this.formRevisionEtag(revision), 'Idempotency-Key': idempotencyKey }) }).pipe(map(authoringDocument));
  }

  validateAuthoringImport(workspaceId: string, formId: string, draftId: string, candidate: unknown): Observable<AuthoringImportCandidate> {
    return this.http.post<AuthoringImportCandidate>(`${this.authoringBase(workspaceId, formId, draftId)}/imports/validate`, { candidate }, this.staff());
  }

  commitAuthoringImport(workspaceId: string, formId: string, draftId: string, revision: number, candidate: Pick<AuthoringImportCandidate, 'candidateId' | 'digest'>, mode: 'UPDATE' | 'COPY' = 'UPDATE', idempotencyKey = this.createMutationAction()): Observable<AuthoringDocument> {
    return this.http.post<unknown>(`${this.authoringBase(workspaceId, formId, draftId)}/imports/commit`, { candidateId: candidate.candidateId, digest: candidate.digest, mode }, { withCredentials: true, headers: new HttpHeaders({ 'If-Match': this.formRevisionEtag(revision), 'Idempotency-Key': idempotencyKey }) }).pipe(map(authoringDocument));
  }

  reusableComponents(workspaceId: string): Observable<ReusableComponent[]> {
    return this.http.get<BackendComponent[]>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/reusable-components`, this.staff()).pipe(map((components) => components.map((component) => ({ id: component.id, key: component.key, version: String(component.version), name: component.name, description: `${component.key} · ${component.status}` }))));
  }

  insertAuthoringComponent(workspaceId: string, formId: string, draftId: string, revision: number, component: ReusableComponent, path: string, idempotencyKey = this.createMutationAction()): Observable<AuthoringDocument> {
    const url = `${this.authoringBase(workspaceId, formId, draftId)}/components/${encodeURIComponent(component.key)}/insert`;
    const body = { path, operation: 'add' as const, version: Number(component.version) };
    return this.http.post<unknown>(url, body, { withCredentials: true, headers: new HttpHeaders({ 'If-Match': this.formRevisionEtag(revision), 'Idempotency-Key': idempotencyKey }) }).pipe(map(authoringDocument));
  }

  authoringTheme(workspaceId: string, formId: string, draftId: string): Observable<ThemeSettings> { return this.http.get<BackendTheme>(`${this.authoringBase(workspaceId, formId, draftId)}/theme`, this.staff()).pipe(map(authoringTheme)); }
  updateAuthoringTheme(workspaceId: string, formId: string, draftId: string, revision: number, theme: ThemeSettings, idempotencyKey = this.createMutationAction()): Observable<ThemeSettings> {
    const wireTheme = { themeKey: theme.themeKey ?? theme.preset, version: theme.version ?? '1', tokens: theme.tokens };
    return this.http.put<unknown>(`${this.authoringBase(workspaceId, formId, draftId)}/theme`, { theme: wireTheme }, { withCredentials: true, headers: new HttpHeaders({ 'If-Match': this.formRevisionEtag(revision), 'Idempotency-Key': idempotencyKey }) }).pipe(
      map(authoringDocument),
      switchMap((document) => this.authoringTheme(workspaceId, formId, draftId).pipe(map((returned) => ({ ...returned, document })))),
    );
  }
  authoringContent(workspaceId: string, formId: string, draftId: string): Observable<ContentSettings> { return this.http.get<BackendContent>(`${this.authoringBase(workspaceId, formId, draftId)}/content`, this.staff()).pipe(map(authoringContent)); }
  updateAuthoringContent(workspaceId: string, formId: string, draftId: string, revision: number, content: ContentSettings, scope: Exclude<GovernedContentScope, 'review'>, idempotencyKey = this.createMutationAction()): Observable<ContentSettings> {
    const body = scope === 'guidance' ? { guidance: content.guidance } : { translations: content.translations };
    return this.http.put<unknown>(`${this.authoringBase(workspaceId, formId, draftId)}/content`, body, { withCredentials: true, headers: new HttpHeaders({ 'If-Match': this.formRevisionEtag(revision), 'Idempotency-Key': idempotencyKey }) }).pipe(
      map(authoringDocument),
      switchMap((document) => this.authoringContent(workspaceId, formId, draftId).pipe(map((returned) => ({ ...returned, document })))),
    );
  }
  approveAuthoringLocales(workspaceId: string, formId: string, draftId: string, revision: number, locales: readonly SupportedAuthoringLocale[], idempotencyKey = this.createMutationAction()): Observable<ContentSettings> {
    return this.http.put<unknown>(`${this.authoringBase(workspaceId, formId, draftId)}/content`, { approveLocales: locales }, { withCredentials: true, headers: new HttpHeaders({ 'If-Match': this.formRevisionEtag(revision), 'Idempotency-Key': idempotencyKey }) }).pipe(
      switchMap(() => this.authoringContent(workspaceId, formId, draftId)),
    );
  }
  authoringComments(workspaceId: string, formId: string, draftId: string): Observable<AuthoringComment[]> { return this.http.get<BackendComment[]>(`${this.authoringBase(workspaceId, formId, draftId)}/comments`, this.staff()).pipe(map((comments) => comments.map(authoringComment))); }
  addAuthoringComment(workspaceId: string, formId: string, draftId: string, body: string, targetId: string, idempotencyKey = this.createMutationAction()): Observable<AuthoringComment> {
    return this.http.post<BackendComment>(`${this.authoringBase(workspaceId, formId, draftId)}/comments`, { body, pointer: targetId }, { withCredentials: true, headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }) }).pipe(map(authoringComment));
  }
  authoringPresence(workspaceId: string, formId: string, draftId: string): Observable<PresenceMember[]> { return this.http.get<BackendPresence[]>(`${this.authoringBase(workspaceId, formId, draftId)}/presence`, this.staff()).pipe(map((members) => members.map((member) => ({ accountId: member.accountId, displayName: member.displayName, selectedId: member.cursor, expiresAt: member.expiresAt })))); }
  updateAuthoringPresence(workspaceId: string, formId: string, draftId: string, selectedId: string | null): Observable<void> { return this.http.patch<void>(`${this.authoringBase(workspaceId, formId, draftId)}/presence`, { cursor: selectedId ?? '' }, this.staff()); }

  /** Never call startSession, patchSession, submitSession, publish or providers for ordinary author preview. */
  authoringPreview(workspaceId: string, formId: string, draftId: string, answers: Record<string, unknown>, locale: SupportedAuthoringLocale): Observable<PreviewResult> {
    return this.http.post<PreviewResult>(`${this.authoringBase(workspaceId, formId, draftId)}/preview`, { answers, locale }, this.staff());
  }
  /** The service chooses an approved locale voice; clients supply governed content or a scoped Q&A question. */
  authoringSpeech(workspaceId: string, formId: string, draftId: string, locale: SupportedAuthoringLocale, request: { question?: string; scope?: { pageId?: string; sectionId?: string; fieldId?: string; placementId?: string; placementPath?: string } }): Observable<SpeechResult> {
    return this.http.post<SpeechResult>(`${this.authoringBase(workspaceId, formId, draftId)}/speech`, { locale, ...request }, this.staff());
  }

  listResponses(workspaceId: string): Observable<ResponseSummary[]> {
    return this.http.get<ResponseSummary[]>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/submissions`, this.staff());
  }

  responseDetail(workspaceId: string, id: string): Observable<unknown> {
    return this.http.get<unknown>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/submissions/${id}`, this.staff());
  }

  exportDefinition(workspaceId: string, formId: string): Observable<unknown> {
    return this.http.get<unknown>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/forms/${formId}/definition-export`, this.staff());
  }

  importDefinition(workspaceId: string, formId: string, revision: number, definition: unknown): Observable<{ revision: number }> {
    return this.http.put<{ revision: number }>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/forms/${formId}/definition-import`, definition, {
      headers: new HttpHeaders({ 'If-Match': this.formRevisionEtag(revision) }), withCredentials: true,
    });
  }

  exportResponses(workspaceId: string): Observable<ResponseSummary[]> {
    return this.http.get<ResponseSummary[]>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/exports.json`, this.staff());
  }

  /** M2 publication route; use the generated OpenAPI operation response type. */
  publishedSchema(kind: string, version = '4.0.0'): Observable<PublishedSchema> {
    return this.http.get<PublishedSchema>(`/v1/schemas/${encodeURIComponent(kind)}/${encodeURIComponent(version)}`);
  }

  createForm(workspaceId: string, formKey: string, title: string, profile?: 'canonical-4.0.0'): Observable<CreatedForm> {
    return this.http.post<CreatedForm>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/forms`, { formKey, title, ...(profile ? { profile } : {}) }, this.staff());
  }

  updateDraft(workspaceId: string, formId: string, draftId: string, revision: number, definition: FormDefinition): Observable<SavedDraft> {
    return this.http.put<SavedDraft>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/forms/${formId}/drafts/${draftId}`, { definition }, {
      headers: new HttpHeaders({ 'If-Match': this.formRevisionEtag(revision) }), withCredentials: true,
    });
  }

  publish(workspaceId: string, formId: string): Observable<PublishedForm> {
    return this.http.post<PublishedForm>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/forms/${formId}/releases`, {}, this.staff());
  }

  startSession(shareId: string, locale?: string, timeZone?: string): Observable<StartedRespondentSession> {
    return this.http.post<StartedRespondentSession>(`/v1/public/forms/${encodeURIComponent(shareId)}/sessions`, {
      ...(locale ? { locale } : {}),
      ...(timeZone ? { timeZone } : {}),
    }, {
      withCredentials: false,
    });
  }

  startChannel(channelId: string, locale?: string, timeZone?: string): Observable<StartedRespondentSession> {
    return this.http.post<StartedRespondentSession>(`/v1/public/channels/${encodeURIComponent(channelId)}/sessions`, {
      ...(locale ? { locale } : {}),
      ...(timeZone ? { timeZone } : {}),
    }, { withCredentials: false });
  }

  respondentSession(sessionId: string, respondentToken: string): Observable<RespondentSession> {
    return this.http.get<RespondentSession>(`/v1/sessions/${encodeURIComponent(sessionId)}`, this.respondent(respondentToken));
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

  validateRespondentSession(sessionId: string, respondentToken: string): Observable<RespondentReview> {
    return this.http.post<RespondentReview>(`/v1/sessions/${encodeURIComponent(sessionId)}/validate`, {}, this.respondent(respondentToken));
  }

  submissionOperation(sessionId: string, respondentToken: string, attemptId: string): Observable<SubmissionOperation> {
    return this.http.get<SubmissionOperation>(`/v1/sessions/${encodeURIComponent(sessionId)}/submission-operation`, {
      ...this.respondent(respondentToken), params: new HttpParams().set('attemptId', attemptId),
    });
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

  private authoringBase(workspaceId: string, formId: string, draftId: string): string {
    return `/v1/workspaces/${encodeURIComponent(workspaceId)}/forms/${encodeURIComponent(formId)}/authoring/${encodeURIComponent(draftId)}`;
  }

  private authoringAction(workspaceId: string, formId: string, draftId: string, revision: number, action: 'undo' | 'redo', idempotencyKey: string): Observable<AuthoringDocument> {
    return this.http.post<unknown>(`${this.authoringBase(workspaceId, formId, draftId)}/${action}`, {}, { withCredentials: true, headers: new HttpHeaders({ 'If-Match': this.formRevisionEtag(revision), 'Idempotency-Key': idempotencyKey }) }).pipe(map(authoringDocument));
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

  private etag(revision: number | string) {
    if (typeof revision === 'string') return revision.startsWith('"rev-') ? revision : `"rev-${revision.replace(/^"|"$/g, '')}"`;
    return `"rev-${revision}"`;
  }
  private formRevisionEtag(revision: number): string { return `"${revision}"`; }

  /** Callers retain this opaque token only while retrying one unchanged user action. */
  createMutationAction(): string { return crypto.randomUUID(); }

  etagFor(resource: string): string | null { return this.revisionEtags.get(resource) ?? null; }

  private mutation(method: string, url: string, body: unknown, retryKey?: string, revision?: number | string) {
    const action = retryKey ?? this.createMutationAction();
    let headers = new HttpHeaders({ 'Idempotency-Key': action });
    if (revision !== undefined) headers = headers.set('If-Match', this.etag(revision));
    return { headers, withCredentials: true, observe: 'response' as const };
  }

  private revisioned<T>(source: Observable<HttpResponse<T>>): Observable<T> {
    return source.pipe(tap((response) => this.rememberEtag(response)), map((response) => response.body as T));
  }

  private rememberEtag(response: HttpResponse<unknown>): void {
    const etag = response.headers.get('ETag');
    if (etag) this.revisionEtags.set(response.url ?? '', etag);
  }
}

function wireInputAnswer(answer: unknown): GeneratedInputAnswer {
  return JSON.parse(JSON.stringify(answer)) as GeneratedInputAnswer;
}

function mapSession(source: Observable<unknown>): Observable<StaffSession> {
  return source.pipe(map((body) => {
    const value = body as { authenticatedSession?: { safeIdentity?: StaffIdentity; platformRoles?: ('administrator')[]; organizations?: StaffOrganization[]; currentOrganizationId?: string | null; currentWorkspaceId?: string | null }; safeIdentity?: StaffIdentity };
    const authenticated = value.authenticatedSession;
    const identity = authenticated?.safeIdentity ?? value.safeIdentity;
    if (!identity?.accountId || !identity.username) throw new Error('The server returned an invalid staff session.');
    return { identity, platformRoles: authenticated?.platformRoles ?? [], organizations: authenticated?.organizations ?? [], currentOrganizationId: authenticated?.currentOrganizationId ?? null, currentWorkspaceId: authenticated?.currentWorkspaceId ?? null };
  }));
}

function authorizedDeliveryCopies(response: HttpResponse<unknown>, ...allowed: (keyof AuthorizedDeliveryCopies)[]): AuthorizedDeliveryCopies {
  const headers: Record<keyof AuthorizedDeliveryCopies, string> = {
    activationCopyLink: 'X-Activation-Copy-Link',
    invitationCopyLink: 'X-Invitation-Copy-Link',
    recoveryCopyLink: 'X-Recovery-Copy-Link',
    temporaryPasswordCopy: 'X-Temporary-Password-Copy',
  };
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = response.headers.get(headers[key]);
    return value ? [[key, value]] : [];
  })) as AuthorizedDeliveryCopies;
}
