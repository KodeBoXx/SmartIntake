import { Injectable, computed, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { SmartIntakeApiService, StaffIdentity, StaffSession, StaffOrganization } from '../smart-intake-api.service';
import { StaffCsrfContext } from './staff-csrf.interceptor';

export type StaffSessionState = 'loading' | 'authenticated' | 'anonymous' | 'expired' | 'denied' | 'error';
export type M5StubState = 'ready' | 'sign-in' | 'loading' | 'empty' | 'empty-or-no-access' | 'invalid' | 'denied' | 'no-access' | 'expired' | 'email-unavailable' | 'throttled' | 'offline' | 'stale' | 'closed' | 'start' | 'pending' | 'succeeded' | 'failed' | 'tombstone' | 'conflict' | 'error' | 'no-side-effects' | 'acknowledgment' | 'not-found';

@Injectable({ providedIn: 'root' })
export class StaffSessionStore {
  /** Staff cookies are HttpOnly. This store intentionally retains no bearer secret. */
  readonly state = signal<StaffSessionState>('loading');
  readonly identity = signal<StaffIdentity | null>(null);
  readonly organizations = signal<StaffOrganization[]>([]);
  readonly currentOrganizationId = signal<string | null>(null);
  readonly currentWorkspaceId = signal<string | null>(null);
  readonly csrfToken = signal<string | null>(null);
  readonly returnUrl = signal('/workspaces/demo/forms');
  readonly isAuthenticated = computed(() => this.state() === 'authenticated');
  readonly currentOrganization = computed(() => this.organizations().find((organization) => organization.organizationId === this.currentOrganizationId()) ?? null);
  readonly currentWorkspace = computed(() => this.currentOrganization()?.workspaces.find((workspace) => workspace.workspaceId === this.currentWorkspaceId()) ?? null);
  readonly currentRoles = computed(() => this.currentWorkspace()?.roles ?? []);
  private bootstrapRequest: Observable<StaffSessionState> | null = null;

  constructor(private readonly api: SmartIntakeApiService, private readonly csrf: StaffCsrfContext) {}

  ensureLoaded(): Observable<StaffSessionState> {
    return this.state() === 'loading' ? this.bootstrap() : of(this.state());
  }

  refresh(): Observable<StaffSessionState> {
    this.state.set('loading');
    this.bootstrapRequest = null;
    return this.bootstrap();
  }

  signIn(email: string, password: string): Observable<StaffSessionState> {
    return this.refresh().pipe(
      switchMap((state) => state === 'anonymous'
        ? this.api.signIn({ email, password }, this.csrfToken() ?? '').pipe(switchMap(() => this.refresh()))
        : of(state)),
      catchError((error: unknown) => of(this.applyFailure(error))),
    );
  }

  signOut(): Observable<void> {
    return this.api.signOut().pipe(
      tap(() => this.clear('anonymous')),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401) this.clear('anonymous');
        return of(void 0);
      }),
    );
  }

  rememberReturnUrl(url: string): void {
    this.returnUrl.set(url.startsWith('/') && !url.startsWith('//') ? url : '/workspaces/demo/forms');
  }

  selectOrganization(organizationId: string): void {
    const organization = this.organizations().find((item) => item.organizationId === organizationId);
    if (!organization) return;
    this.currentOrganizationId.set(organizationId);
    this.currentWorkspaceId.set(organization.workspaces[0]?.workspaceId ?? null);
  }

  selectWorkspace(workspaceId: string): void {
    if (this.currentOrganization()?.workspaces.some((workspace) => workspace.workspaceId === workspaceId)) this.currentWorkspaceId.set(workspaceId);
  }

  private bootstrap(): Observable<StaffSessionState> {
    if (!this.bootstrapRequest) {
      this.bootstrapRequest = this.api.session().pipe(
        map((session) => this.applySession(session)),
        catchError((error: unknown) => of(this.applyFailure(error))),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.bootstrapRequest;
  }

  private applySession(session: StaffSession): StaffSessionState {
    this.identity.set(session.identity);
    this.organizations.set(session.organizations);
    this.currentOrganizationId.set(session.currentOrganizationId ?? session.organizations[0]?.organizationId ?? null);
    const organization = session.organizations.find((item) => item.organizationId === this.currentOrganizationId()) ?? session.organizations[0];
    const serverWorkspace = session.currentWorkspaceId;
    this.currentWorkspaceId.set(
      serverWorkspace && organization?.workspaces.some((workspace) => workspace.workspaceId === serverWorkspace)
        ? serverWorkspace
        : organization?.workspaces[0]?.workspaceId ?? null,
    );
    this.csrfToken.set(session.csrfToken ?? null);
    this.csrf.set(session.csrfToken ?? null);
    this.state.set('authenticated');
    return this.state();
  }

  private applyFailure(error: unknown): StaffSessionState {
    if (!(error instanceof HttpErrorResponse)) {
      this.clear('error');
    } else if (error.status === 401) {
      this.csrfToken.set(error.headers.get('X-Login-CSRF-Token'));
      this.clear('anonymous', false);
    } else if (error.status === 403) {
      this.clear('denied');
    } else if (error.status === 419 || error.status === 440) {
      this.clear('expired');
    } else {
      this.clear('error');
    }
    return this.state();
  }

  private clear(state: Exclude<StaffSessionState, 'loading' | 'authenticated'>, clearCsrf = true): void {
    this.identity.set(null);
    this.organizations.set([]);
    this.currentOrganizationId.set(null);
    this.currentWorkspaceId.set(null);
    if (clearCsrf) {
      this.csrfToken.set(null);
      this.csrf.set(null);
    }
    this.state.set(state);
  }
}

@Injectable({ providedIn: 'root' })
export class M5PublicSessionStore {
  readonly state = signal<M5StubState>('ready');
  setState(state: M5StubState): void { this.state.set(state); }
}
