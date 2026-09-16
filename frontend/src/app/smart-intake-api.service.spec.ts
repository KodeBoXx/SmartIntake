import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { SmartIntakeApiService } from './smart-intake-api.service';

describe('SmartIntakeApiService', () => {
  let api: SmartIntakeApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(SmartIntakeApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http?.verify());

  it('uses the exact bootstrap and staff draft contracts', () => {
    api.bootstrap().subscribe();
    const bootstrap = http.expectOne('/v1/auth/bootstrap');
    expect(bootstrap.request.method).toBe('POST');
    expect(bootstrap.request.body).toEqual({ email: 'owner@local.test', password: 'LocalDevelopmentPassword!' });
    bootstrap.flush({ staffSession: 'staff-token' });

    api.saveDraft('staff-token', 'responsive-intake', 'Responsive intake').subscribe();
    const save = http.expectOne('/v1/workspaces/local/forms');
    expect(save.request.method).toBe('POST');
    expect(save.request.headers.get('X-Staff-Session')).toBe('staff-token');
    expect(save.request.body).toEqual({ formKey: 'responsive-intake', title: 'Responsive intake' });
    save.flush({ id: 'form-1', revision: 1 });
  });

  it('keeps definition transfer paths, headers, and body intact', () => {
    api.exportDefinition('staff-token', 'form-1').subscribe();
    const exported = http.expectOne('/v1/workspaces/local/forms/form-1/definition-export');
    expect(exported.request.method).toBe('GET');
    expect(exported.request.headers.get('X-Staff-Session')).toBe('staff-token');
    exported.flush({ contractVersion: '4.0.0' });

    const definition = { contractVersion: '4.0.0', formKey: 'responsive-intake' };
    api.importDefinition('staff-token', 'form-1', definition).subscribe();
    const imported = http.expectOne('/v1/workspaces/local/forms/form-1/definition-import');
    expect(imported.request.method).toBe('PUT');
    expect(imported.request.headers.get('X-Staff-Session')).toBe('staff-token');
    expect(imported.request.headers.get('If-Match')).toBe('"1"');
    expect(imported.request.body).toEqual(definition);
    imported.flush({ revision: 2 });
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
});
