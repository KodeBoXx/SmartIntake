import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { staffCsrfInterceptor, StaffCsrfContext } from './staff-csrf.interceptor';

describe('staffCsrfInterceptor', () => {
  let http: HttpClient;
  let requests: HttpTestingController;
  let csrf: StaffCsrfContext;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([staffCsrfInterceptor])),
      provideHttpClientTesting(),
    ] });
    http = TestBed.inject(HttpClient);
    requests = TestBed.inject(HttpTestingController);
    csrf = TestBed.inject(StaffCsrfContext);
  });
  afterEach(() => requests.verify());

  it('adds the server-issued CSRF token to a cookie-authenticated staff mutation', () => {
    csrf.set('csrf-from-session');
    http.put('/v1/workspaces/local/forms/form-1/drafts/draft-1', {}).subscribe();
    const request = requests.expectOne('/v1/workspaces/local/forms/form-1/drafts/draft-1');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('csrf-from-session');
    request.flush({});
  });

  it('does not cross staff cookies or CSRF into respondent-secret mutations', () => {
    csrf.set('staff-csrf');
    http.patch('/v1/sessions/session-1', {}, { headers: { 'X-Respondent-Session': 'respondent-secret' } }).subscribe();
    const request = requests.expectOne('/v1/sessions/session-1');
    expect(request.request.withCredentials).toBe(false);
    expect(request.request.headers.get('X-Respondent-Session')).toBe('respondent-secret');
    expect(request.request.headers.has('X-CSRF-Token')).toBe(false);
    request.flush({});
  });

  it('marks public session start credential-independent and omits staff CSRF', () => {
    csrf.set('staff-csrf');
    http.post('/v1/public/forms/share-1/sessions', {}).subscribe();
    const request = requests.expectOne('/v1/public/forms/share-1/sessions');
    expect(request.request.withCredentials).toBe(false);
    expect(request.request.headers.has('X-CSRF-Token')).toBe(false);
    request.flush({});
  });

  it('does not require an existing staff CSRF token for the login challenge request', () => {
    http.post('/v1/auth/sign-in', { email: 'owner@example.test', password: 'user-supplied' }).subscribe();
    const request = requests.expectOne('/v1/auth/sign-in');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.has('X-CSRF-Token')).toBe(false);
    request.flush({});
  });
});
