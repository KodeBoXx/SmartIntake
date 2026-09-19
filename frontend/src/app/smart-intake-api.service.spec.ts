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

  it('uses exact bootstrap and sign-in contracts with local development credentials', () => {
    api.bootstrap().subscribe();
    const bootstrap = http.expectOne('/v1/auth/bootstrap');
    expect(bootstrap.request.method).toBe('POST');
    expect(bootstrap.request.body).toEqual({ email: 'owner@local.test', password: 'LocalDevelopmentPassword!' });
    bootstrap.flush({ staffSession: 'staff-token' });

    api.signIn().subscribe();
    const signIn = http.expectOne('/v1/auth/sign-in');
    expect(signIn.request.method).toBe('POST');
    expect(signIn.request.body).toEqual({ email: 'owner@local.test', password: 'LocalDevelopmentPassword!' });
    signIn.flush({ staffSession: 'staff-token' });
  });

  it('creates, persists, and publishes drafts with current revisions', () => {
    const definition = createDefaultDefinition();
    api.createForm('staff-token', 'responsive-intake', 'Responsive intake').subscribe();
    const create = http.expectOne('/v1/workspaces/local/forms');
    expect(create.request.method).toBe('POST');
    expect(create.request.headers.get('X-Staff-Session')).toBe('staff-token');
    expect(create.request.body).toEqual({ formKey: 'responsive-intake', title: 'Responsive intake' });
    create.flush({ id: 'form-1', draftId: 'draft-1', revision: 1, definition });

    api.updateDraft('staff-token', 'form-1', 'draft-1', 3, definition).subscribe();
    const save = http.expectOne('/v1/workspaces/local/forms/form-1/drafts/draft-1');
    expect(save.request.method).toBe('PUT');
    expect(save.request.headers.get('X-Staff-Session')).toBe('staff-token');
    expect(save.request.headers.get('If-Match')).toBe('"3"');
    expect(save.request.body).toEqual({ definition });
    save.flush({ revision: 4, definition, diagnostics: [] });

    api.publish('staff-token', 'form-1').subscribe();
    const publish = http.expectOne('/v1/workspaces/local/forms/form-1/releases');
    expect(publish.request.method).toBe('POST');
    expect(publish.request.headers.get('X-Staff-Session')).toBe('staff-token');
    expect(publish.request.body).toEqual({});
    publish.flush({ releaseId: 'release-1', version: 1, shareId: 'form-1', status: 'PUBLISHED' });
  });

  it('validates staff sessions and reads the current draft through existing form routes', () => {
    api.listForms('staff-token').subscribe();
    const forms = http.expectOne('/v1/workspaces/local/forms');
    expect(forms.request.method).toBe('GET');
    expect(forms.request.headers.get('X-Staff-Session')).toBe('staff-token');
    forms.flush([{ id: 'form-1', formKey: 'responsive-intake', title: 'Responsive intake', status: 'DRAFT', revision: 3, updatedAt: '2026-09-18' }]);

    api.currentDraft('staff-token', 'form-1', 'draft-1').subscribe();
    const draft = http.expectOne('/v1/workspaces/local/forms/form-1/drafts/draft-1');
    expect(draft.request.method).toBe('GET');
    expect(draft.request.headers.get('X-Staff-Session')).toBe('staff-token');
    draft.flush({ id: 'draft-1', revision: 3, definition: createDefaultDefinition(), diagnostics: [] });
  });

  it('keeps definition transfer paths, bodies, and current If-Match headers intact', () => {
    api.exportDefinition('staff-token', 'form-1').subscribe();
    const exported = http.expectOne('/v1/workspaces/local/forms/form-1/definition-export');
    expect(exported.request.method).toBe('GET');
    expect(exported.request.headers.get('X-Staff-Session')).toBe('staff-token');
    exported.flush({ contractVersion: '4.0.0' });

    const definition = { contractVersion: '4.0.0', formKey: 'responsive-intake' };
    api.importDefinition('staff-token', 'form-1', 7, definition).subscribe();
    const imported = http.expectOne('/v1/workspaces/local/forms/form-1/definition-import');
    expect(imported.request.method).toBe('PUT');
    expect(imported.request.headers.get('X-Staff-Session')).toBe('staff-token');
    expect(imported.request.headers.get('If-Match')).toBe('"7"');
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

  it('keeps response administration paths and staff headers intact', () => {
    api.listResponses('staff-token').subscribe();
    const list = http.expectOne('/v1/workspaces/local/submissions');
    expect(list.request.method).toBe('GET');
    expect(list.request.headers.get('X-Staff-Session')).toBe('staff-token');
    list.flush([]);

    api.responseDetail('staff-token', 'receipt-1').subscribe();
    const detail = http.expectOne('/v1/workspaces/local/submissions/receipt-1');
    expect(detail.request.method).toBe('GET');
    expect(detail.request.headers.get('X-Staff-Session')).toBe('staff-token');
    detail.flush({ id: 'receipt-1' });

    api.exportResponses('staff-token').subscribe();
    const responses = http.expectOne('/v1/workspaces/local/exports.json');
    expect(responses.request.method).toBe('GET');
    expect(responses.request.headers.get('X-Staff-Session')).toBe('staff-token');
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
});
