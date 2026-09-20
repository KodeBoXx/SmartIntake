import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultDefinition } from './models/form-definition.models';
import { SmartIntakeApiService } from './smart-intake-api.service';
import type { PublishedSchema } from './smart-intake-api.service';

describe('SmartIntakeApiService', () => {
  let api: SmartIntakeApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(SmartIntakeApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http?.verify());

  it('bootstraps only a cookie-backed safe server session', () => {
    api.session().subscribe(session => expect(session.identity.username).toBe('owner'));
    const session = http.expectOne('/v1/auth/session');
    expect(session.request.method).toBe('GET');
    expect(session.request.withCredentials).toBe(true);
    expect(session.request.headers.has('X-Staff-Session')).toBe(false);
    session.flush({ authenticatedSession: { safeIdentity: { accountId: 'account-1', username: 'owner', displayName: 'Owner' }, activationState: 'active', accountStatus: 'active', organizations: [], currentOrganizationId: null } });
  });

  it('sends supplied credentials with the bound login-CSRF challenge', () => {
    api.signIn({ email: 'owner@example.test', password: 'user-supplied' }, 'login-csrf').subscribe();
    const signIn = http.expectOne('/v1/auth/sign-in');
    expect(signIn.request.method).toBe('POST');
    expect(signIn.request.withCredentials).toBe(true);
    expect(signIn.request.headers.get('X-Login-CSRF-Token')).toBe('login-csrf');
    expect(signIn.request.body).toEqual({ email: 'owner@example.test', password: 'user-supplied' });
    signIn.flush({ staffSession: { id: 'session-1' } });
  });

  it('reads bootstrap delivery material only from its named authorized headers', () => {
    api.bootstrap({ email: 'owner@example.test', password: 'user-supplied', organizationName: 'Org', workspaceName: 'Workspace', bootstrapToken: 'proof' }).subscribe((delivery) => {
      expect(delivery).toEqual({ activationCopyLink: '/activate/raw-proof', temporaryPasswordCopy: 'once-only' });
    });
    const bootstrap = http.expectOne('/v1/auth/bootstrap');
    expect(bootstrap.request.headers.get('X-Bootstrap-Token')).toBe('proof');
    bootstrap.flush({}, { headers: { 'X-Activation-Copy-Link': '/activate/raw-proof', 'X-Temporary-Password-Copy': 'once-only' } });
  });

  it('reads recovery and activation links only from their exact response headers', () => {
    api.requestRecovery({ email: 'owner@example.test' }).subscribe((delivery) => expect(delivery.recoveryCopyLink).toBe('/reset/raw-proof'));
    const recovery = http.expectOne('/v1/auth/recovery');
    recovery.flush({}, { headers: { 'X-Recovery-Copy-Link': '/reset/raw-proof', 'X-Invitation-Copy-Link': '/wrong-flow' } });

    api.activate({ activationToken: 'token', password: 'user-supplied', displayName: 'Owner' }).subscribe((delivery) => expect(delivery.activationCopyLink).toBe('/activate/raw-proof'));
    const activation = http.expectOne('/v1/auth/activate');
    activation.flush({}, { headers: { 'X-Activation-Copy-Link': '/activate/raw-proof' } });
  });

  it('creates, persists, and publishes drafts with current revisions', () => {
    const definition = createDefaultDefinition();
    api.createForm('local', 'responsive-intake', 'Responsive intake').subscribe();
    const create = http.expectOne('/v1/workspaces/local/forms');
    expect(create.request.method).toBe('POST');
    expect(create.request.withCredentials).toBe(true);
    expect(create.request.headers.has('X-Staff-Session')).toBe(false);
    expect(create.request.body).toEqual({ formKey: 'responsive-intake', title: 'Responsive intake' });
    create.flush({ id: 'form-1', draftId: 'draft-1', revision: 1, definition });

    api.updateDraft('local', 'form-1', 'draft-1', 3, definition).subscribe();
    const save = http.expectOne('/v1/workspaces/local/forms/form-1/drafts/draft-1');
    expect(save.request.method).toBe('PUT');
    expect(save.request.withCredentials).toBe(true);
    expect(save.request.headers.has('X-Staff-Session')).toBe(false);
    expect(save.request.headers.get('If-Match')).toBe('"rev-3"');
    expect(save.request.body).toEqual({ definition });
    save.flush({ revision: 4, definition, diagnostics: [] });

    api.publish('local', 'form-1').subscribe();
    const publish = http.expectOne('/v1/workspaces/local/forms/form-1/releases');
    expect(publish.request.method).toBe('POST');
    expect(publish.request.withCredentials).toBe(true);
    expect(publish.request.headers.has('X-Staff-Session')).toBe(false);
    expect(publish.request.body).toEqual({});
    publish.flush({ releaseId: 'release-1', version: 1, shareId: 'form-1', status: 'PUBLISHED' });
  });

  it('validates staff sessions and reads the current draft through existing form routes', () => {
    api.listForms('local').subscribe();
    const forms = http.expectOne('/v1/workspaces/local/forms');
    expect(forms.request.method).toBe('GET');
    expect(forms.request.withCredentials).toBe(true);
    expect(forms.request.headers.has('X-Staff-Session')).toBe(false);
    forms.flush([{ id: 'form-1', formKey: 'responsive-intake', title: 'Responsive intake', status: 'DRAFT', revision: 3, updatedAt: '2026-09-18' }]);

    api.currentDraft('local', 'form-1', 'draft-1').subscribe();
    const draft = http.expectOne('/v1/workspaces/local/forms/form-1/drafts/draft-1');
    expect(draft.request.method).toBe('GET');
    expect(draft.request.withCredentials).toBe(true);
    expect(draft.request.headers.has('X-Staff-Session')).toBe(false);
    draft.flush({ id: 'draft-1', revision: 3, definition: createDefaultDefinition(), diagnostics: [] });
  });

  it('keeps definition transfer paths, bodies, and current If-Match headers intact', () => {
    api.exportDefinition('local', 'form-1').subscribe();
    const exported = http.expectOne('/v1/workspaces/local/forms/form-1/definition-export');
    expect(exported.request.method).toBe('GET');
    expect(exported.request.withCredentials).toBe(true);
    expect(exported.request.headers.has('X-Staff-Session')).toBe(false);
    exported.flush({ contractVersion: '4.0.0' });

    const definition = { contractVersion: '4.0.0', formKey: 'responsive-intake' };
    api.importDefinition('local', 'form-1', 7, definition).subscribe();
    const imported = http.expectOne('/v1/workspaces/local/forms/form-1/definition-import');
    expect(imported.request.method).toBe('PUT');
    expect(imported.request.withCredentials).toBe(true);
    expect(imported.request.headers.has('X-Staff-Session')).toBe(false);
    expect(imported.request.headers.get('If-Match')).toBe('"rev-7"');
    expect(imported.request.body).toEqual(definition);
    imported.flush({ revision: 8 });
  });

  it('keeps public session patch and submission contracts intact', () => {
    api.startSession('form-1').subscribe();
    const started = http.expectOne('/v1/public/forms/form-1/sessions');
    expect(started.request.method).toBe('POST');
    expect(started.request.body).toEqual({});
    started.flush({ sessionId: 'session-1', respondentSession: 'respondent-token', revision: 3 });

    const patch = { baseRevision: 3, clientMutationId: 'mutation-1', answers: { name: 'Ada' } };
    api.patchSession('session-1', 'respondent-token', patch).subscribe();
    const saved = http.expectOne('/v1/sessions/session-1');
    expect(saved.request.method).toBe('PATCH');
    expect(saved.request.headers.get('X-Respondent-Session')).toBe('respondent-token');
    expect(saved.request.body).toEqual(patch);
    saved.flush({ acceptedRevision: 4 });

    api.submitSession('session-1', 'respondent-token', 4).subscribe();
    const submitted = http.expectOne('/v1/sessions/session-1/submissions');
    expect(submitted.request.method).toBe('POST');
    expect(submitted.request.headers.get('X-Respondent-Session')).toBe('respondent-token');
    expect(submitted.request.body).toEqual({ sessionRevision: 4 });
    submitted.flush({ receiptId: 'receipt-1' });
  });

  it('serializes typed mutations with stable row paths and identity-based moves', () => {
    api.patchTypedSession('session-1', 'respondent-token', 4, 'mutation-typed', [
      { kind: 'set', target: { fieldId: 'amount' }, value: '9223372036854775807' },
      {
        kind: 'set',
        target: { fieldId: 'reason', rowPath: [{ listFieldId: 'rows', itemId: 'row-a' }] },
        answer: { status: 'declined' },
      },
      { kind: 'addItem', target: { fieldId: 'rows' }, itemId: 'row-c', fields: {} },
      { kind: 'moveItem', target: { fieldId: 'rows' }, itemId: 'row-b', beforeItemId: 'row-a' },
    ], 'page-review').subscribe();
    const request = http.expectOne('/v1/sessions/session-1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.headers.get('X-Respondent-Session')).toBe('respondent-token');
    expect(request.request.body).toEqual({
      baseRevision: 4,
      clientMutationId: 'mutation-typed',
      currentPageId: 'page-review',
      operations: [
        { op: 'set', fieldId: 'amount', value: { status: 'answered', value: '9223372036854775807' } },
        {
          op: 'set', fieldId: 'reason',
          rowPath: [{ listFieldId: 'rows', itemId: 'row-a' }],
          value: { status: 'declined' },
        },
        { op: 'addItem', fieldId: 'rows', itemId: 'row-c', initialFields: {} },
        { op: 'moveItem', fieldId: 'rows', itemId: 'row-b', beforeItemId: 'row-a' },
      ],
    });
    request.flush({
      acceptedRevision: 5, answers: {}, validation: [], reachablePageIds: ['page-review'],
      requiredCount: 0, completedRequiredCount: 0,
    });
  });

  it('keeps response administration paths and staff headers intact', () => {
    api.listResponses('local').subscribe();
    const list = http.expectOne('/v1/workspaces/local/submissions');
    expect(list.request.method).toBe('GET');
    expect(list.request.withCredentials).toBe(true);
    expect(list.request.headers.has('X-Staff-Session')).toBe(false);
    list.flush([]);

    api.responseDetail('local', 'receipt-1').subscribe();
    const detail = http.expectOne('/v1/workspaces/local/submissions/receipt-1');
    expect(detail.request.method).toBe('GET');
    expect(detail.request.withCredentials).toBe(true);
    expect(detail.request.headers.has('X-Staff-Session')).toBe(false);
    detail.flush({ id: 'receipt-1' });

    api.exportResponses('local').subscribe();
    const responses = http.expectOne('/v1/workspaces/local/exports.json');
    expect(responses.request.method).toBe('GET');
    expect(responses.request.withCredentials).toBe(true);
    expect(responses.request.headers.has('X-Staff-Session')).toBe(false);
    responses.flush([]);
  });

  it('exposes arbitrary Draft 2020-12 keywords from the published schema response type', () => {
    api.publishedSchema('package').subscribe(document => {
      const properties: unknown = document.properties;
      const definitions: unknown = document.$defs;
      expect(properties).toEqual({ formKey: { type: 'string' } });
      expect(definitions).toEqual({ field: { type: 'object' } });
    });
    const request = http.expectOne('/v1/schemas/package/4.0.0');
    expect(request.request.method).toBe('GET');
    const published: PublishedSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://contracts.smartintake.invalid/schemas/package/4.0.0',
      properties: { formKey: { type: 'string' } },
      $defs: { field: { type: 'object' } },
    };
    request.flush(published);
  });

  it('uses cookie-authenticated organization administration endpoints without staff bearer headers', () => {
    api.organizationUsers('org-1').subscribe();
    const users = http.expectOne('/v1/organizations/org-1/users');
    expect(users.request.withCredentials).toBe(true);
    expect(users.request.headers.has('X-Staff-Session')).toBe(false);
    users.flush({ items: [] });

    api.addOrganizationUser('org-1', { email: 'new@example.test', roles: ['administrator'] }).subscribe((user) => {
      expect(user.activationCopyLink).toBe('/activate/new-user');
      expect(user.temporaryPasswordCopy).toBe('temporary-only');
    });
    const add = http.expectOne('/v1/organizations/org-1/users');
    expect(add.request.method).toBe('POST');
    expect(add.request.body).toEqual({ email: 'new@example.test', roles: ['administrator'] });
    add.flush({ organizationUser: { id: 'user-1', kind: 'OrganizationUser', revision: 1, status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', email: 'new@example.test', roles: ['administrator'] } }, { headers: { 'X-Activation-Copy-Link': '/activate/new-user', 'X-Temporary-Password-Copy': 'temporary-only' } });
  });

  it('serializes catalog filters and catalog mutations with the selected workspace in the path', () => {
    api.catalogForms('workspace-1', { q: 'clinical', status: 'draft', folder: 'folder-1', tag: ['tag-a', 'tag-b'], archived: false, limit: 25, cursor: 'cursor-1' }).subscribe();
    const search = http.expectOne((request) => request.url === '/v1/workspaces/workspace-1/catalog/forms');
    expect(search.request.withCredentials).toBe(true);
    expect(search.request.headers.has('X-Staff-Session')).toBe(false);
    expect(search.request.params.get('q')).toBe('clinical');
    expect(search.request.params.getAll('tag')).toEqual(['tag-a', 'tag-b']);
    expect(search.request.params.get('cursor')).toBe('cursor-1');
    search.flush({ items: [], nextCursor: '' });

    api.classifyCatalogForm('workspace-1', 'form-1', { folderId: 'folder-1', tagIds: ['tag-a'] }).subscribe();
    const classify = http.expectOne('/v1/workspaces/workspace-1/catalog/forms/form-1/classification');
    expect(classify.request.method).toBe('PUT');
    expect(classify.request.withCredentials).toBe(true);
    expect(classify.request.body).toEqual({ folderId: 'folder-1', tagIds: ['tag-a'] });
    classify.flush(null);

    api.updateCatalogSettings('workspace-1', { policyOverrides: { retention: '30d' }, providerOverrides: { email: false } }).subscribe();
    const settings = http.expectOne('/v1/workspaces/workspace-1/catalog/settings');
    expect(settings.request.method).toBe('PUT');
    expect(settings.request.body).toEqual({ policyOverrides: { retention: '30d' }, providerOverrides: { email: false } });
    settings.flush({ workspaceId: 'workspace-1', effective: {}, overrides: {} });
  });

  it('retains supplied retry keys and exposes only named issuer copy-link headers', () => {
    api.assignWorkspaceRoles('workspace-1', 'user-1', 9, { roles: ['author'] }, 'same-action-key').subscribe();
    const roles = http.expectOne('/v1/workspaces/workspace-1/users/user-1/roles');
    expect(roles.request.headers.get('If-Match')).toBe('"rev-9"');
    expect(roles.request.headers.get('Idempotency-Key')).toBe('same-action-key');
    roles.flush({ workspaceRole: { id: 'role-1', kind: 'WorkspaceRole', revision: 10, status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', roles: ['author'] } });

    api.inviteOrganizationUser('org-1', 'user-1', 'Invitation', 'invite-key').subscribe((invitation) => expect(invitation.invitationCopyLink).toBe('https://example.test/invite/raw-link'));
    const invitation = http.expectOne('/v1/organizations/org-1/users/user-1/invitations');
    expect(invitation.request.headers.get('Idempotency-Key')).toBe('invite-key');
    invitation.flush({ invitation: { id: 'invite-1', kind: 'Invitation', revision: 1, status: 'pending', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } }, { headers: { 'X-Invitation-Copy-Link': 'https://example.test/invite/raw-link' } });
  });
});
