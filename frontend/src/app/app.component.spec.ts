import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { createDefaultDefinition } from './models/form-definition.models';
import { SmartIntakeApiService } from './smart-intake-api.service';
import { StaffSessionStore } from './core/m5-session.store';

describe('AppComponent journeys', () => {
  const staffSessionProvider = { provide: StaffSessionStore, useValue: {
    currentWorkspaceId: signal('local'), currentRoles: signal(['author', 'reviewer', 'publisher', 'response-viewer', 'response-exporter']),
    organizations: signal([{ workspaces: [{ workspaceId: 'local', roles: ['author', 'reviewer', 'publisher', 'response-viewer', 'response-exporter'] }] }]),
  } };
  function createApi() {
    const definition = createDefaultDefinition();
    return {
      listForms: vi.fn(() => of([] as Array<{ id: string; formKey: string; title: string; status: string; revision: number; updatedAt: string }>)),
      currentDraft: vi.fn(() => of({ id: 'form-1', revision: 2, definition, diagnostics: [] })),
      createForm: vi.fn(() => of({ id: 'form-1', draftId: 'draft-1', revision: 1, definition })),
      updateDraft: vi.fn(() => of({ revision: 2, definition, diagnostics: [] })),
      publicationGovernance: vi.fn(() => of({ review: {}, releases: [], channels: [] })),
      requestPublicationReview: vi.fn(() => of({ reviewRequestId: 'review-1', revision: 2, packageHash: 'package', manifestHash: 'manifest', state: 'OPEN' })),
      approvePublicationReview: vi.fn(() => of({ reviewRequestId: 'review-1', state: 'APPROVED', packageHash: 'package' })),
      publish: vi.fn(() => of({ releaseId: 'release-1', version: 1, shareId: 'form-1', status: 'PUBLISHED' })),
      transitionRelease: vi.fn(() => of({})),
      createShareChannel: vi.fn(() => of({ channelId: 'channel-1', type: 'LINK' })),
      revokeShareChannel: vi.fn(() => of({})),
      startSession: vi.fn(() => of({ sessionId: 'session-1', respondentSession: 'respondent-token', revision: 3 })),
      patchSession: vi.fn(() => of({ acceptedRevision: 4 })),
      submitSession: vi.fn(() => of({ receiptId: 'receipt-1' })),
      listResponses: vi.fn(() => of([] as Array<{ id: string; submittedAt?: string }>)),
      responseDetail: vi.fn(() => of({})),
      exportDefinition: vi.fn(() => of({})),
      importDefinition: vi.fn(() => of({ revision: 3 })),
      exportResponses: vi.fn(() => of([])),
    };
  }

  function toolbarButton(fixture: ComponentFixture<AppComponent>, text: string) {
    return [...fixture.nativeElement.querySelectorAll('nav button')]
      .find((button) => button.textContent?.trim() === text) as HTMLButtonElement;
  }

  it('rehydrates the authoritative default draft after validating a stored session', () => {
    const api = createApi();
    const restored = { ...createDefaultDefinition(), title: 'Restored intake' };
    api.listForms.mockReturnValue(of([{ id: 'form-1', formKey: 'responsive-intake', title: 'Responsive intake', status: 'DRAFT', revision: 4, updatedAt: '2026-09-18' }]));
    api.currentDraft.mockReturnValue(of({ id: 'draft-1', revision: 4, definition: restored, diagnostics: [] }));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    expect(api.currentDraft).toHaveBeenCalledWith('local', 'form-1', 'form-1');
    expect(component.formId).toBe('form-1');
    expect(component.draftId).toBe('draft-1');
    expect(component.draftRevision()).toBe(4);
    expect(component.definition().title).toBe('Restored intake');
    expect(component.dirty()).toBe(false);
  });

  it('resolves the canonical preview route to its authoritative draft', () => {
    const api = createApi();
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [
      { provide: SmartIntakeApiService, useValue: api }, staffSessionProvider,
      { provide: ActivatedRoute, useValue: { snapshot: { data: { screen: 'preview' }, paramMap: { get: (name: string) => name === 'draftId' ? 'draft-1' : null } } } },
    ] });
    const component = TestBed.createComponent(AppComponent).componentInstance;
    expect(api.currentDraft).toHaveBeenCalledWith('local', 'draft-1', 'draft-1');
    expect(component.formId).toBe('draft-1');
    expect(component.mode()).toBe('preview');
  });

  it('locks authoring until form lookup and authoritative draft rehydration complete', () => {
    const api = createApi();
    const forms = new Subject<Array<{ id: string; formKey: string; title: string; status: string; revision: number; updatedAt: string }>>();
    const draft = new Subject<{ id: string; revision: number; definition: ReturnType<typeof createDefaultDefinition>; diagnostics: never[] }>();
    api.listForms.mockReturnValue(forms.asObservable());
    api.currentDraft.mockReturnValue(draft.asObservable());
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.rehydrating()).toBe(true);
    expect(toolbarButton(fixture, 'Save draft').disabled).toBe(true);
    expect(toolbarButton(fixture, 'Publish')).toBeUndefined();
    expect(fixture.nativeElement.querySelector('input[type="file"]').disabled).toBe(true);
    const fieldsBefore = component.page().fields.length;
    component.addField('text');
    component.save();
    expect(component.page().fields).toHaveLength(fieldsBefore);
    expect(api.createForm).not.toHaveBeenCalled();

    forms.next([{ id: 'form-1', formKey: 'responsive-intake', title: 'Responsive intake', status: 'DRAFT', revision: 4, updatedAt: '2026-09-18' }]);
    expect(api.currentDraft).toHaveBeenCalledWith('local', 'form-1', 'form-1');
    expect(component.rehydrating()).toBe(true);

    draft.next({ id: 'draft-1', revision: 4, definition: createDefaultDefinition(), diagnostics: [] });
    fixture.detectChanges();
    expect(component.rehydrating()).toBe(false);
    expect(toolbarButton(fixture, 'Save draft').disabled).toBe(false);
  });

  it('fails closed when an existing form draft cannot be loaded', () => {
    const api = createApi();
    api.listForms.mockReturnValue(of([{ id: 'form-1', formKey: 'responsive-intake', title: 'Responsive intake', status: 'DRAFT', revision: 4, updatedAt: '2026-09-18' }]));
    api.currentDraft.mockReturnValue(throwError(() => new Error('draft unavailable')));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.rehydrationFailed()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Saved draft unavailable. Retry before editing.');
    expect(fixture.nativeElement.textContent).toContain('Retry saved draft');
    component.save();
    expect(api.createForm).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'invalid', 'Invalid draft request'],
    [403, 'denied', 'Draft access denied'],
    [404, 'empty-or-no-access', 'Draft unavailable'],
    [410, 'expired', 'Session expired'],
    [503, 'email-unavailable', 'Email unavailable'],
  ])('renders the %s draft state from its HTTP status', (status, state, title) => {
    const api = createApi();
    api.currentDraft.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: SmartIntakeApiService, useValue: api }, staffSessionProvider,
        { provide: ActivatedRoute, useValue: { snapshot: { data: { screen: 'review-publish' }, paramMap: { get: (name: string) => ({ workspaceId: 'local', formId: 'form-1', draftId: 'form-1' })[name] ?? null } } } },
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="draft-state"]')?.getAttribute('data-state')).toBe(state);
    expect(fixture.nativeElement.textContent).toContain(title);
  });

  it('does not expose author or review actions to a publisher', () => {
    const api = createApi();
    const publisherSession = { provide: StaffSessionStore, useValue: {
      currentWorkspaceId: signal('local'), currentRoles: signal(['publisher']),
      organizations: signal([{ workspaces: [{ workspaceId: 'local', roles: ['publisher'] }] }]),
    } };
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: SmartIntakeApiService, useValue: api }, publisherSession,
        { provide: ActivatedRoute, useValue: { snapshot: { data: { screen: 'review-publish' }, paramMap: { get: (name: string) => ({ workspaceId: 'local', formId: 'form-1', draftId: 'form-1' })[name] ?? null } } } },
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(toolbarButton(fixture, 'Author')).toBeUndefined();
    expect(toolbarButton(fixture, 'Save draft')).toBeUndefined();
    expect(toolbarButton(fixture, 'Publish')).toBeUndefined();
    const fieldsBefore = component.page().fields.length;
    component.addField('text');
    expect(component.page().fields).toHaveLength(fieldsBefore);
    expect(api.updateDraft).not.toHaveBeenCalled();
    expect(api.requestPublicationReview).not.toHaveBeenCalled();
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('uses the server-selected workspace for the legacy builder route', () => {
    const api = createApi();
    const selectedWorkspaceSession = { provide: StaffSessionStore, useValue: {
      currentWorkspaceId: signal('workspace-server-selected'), currentRoles: signal(['author']),
      organizations: signal([{ workspaces: [{ workspaceId: 'workspace-server-selected', roles: ['author'] }] }]),
    } };
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, selectedWorkspaceSession] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    expect(api.listForms).toHaveBeenCalledWith('workspace-server-selected');
    component.save();
    expect(api.createForm).toHaveBeenCalledWith('workspace-server-selected', expect.any(String), 'Responsive intake');
  });

  it('creates a canonical draft and opens M7 authoring from the Author action', () => {
    const api = createApi();
    const router = { navigate: vi.fn(() => Promise.resolve(true)) };
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [
      { provide: SmartIntakeApiService, useValue: api }, staffSessionProvider,
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { snapshot: { data: { screen: 'builder' }, paramMap: { get: (name: string) => name === 'workspaceId' ? 'local' : null } } } },
    ] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    component.openAuthoring();

    expect(api.createForm).toHaveBeenCalledWith('local', expect.any(String), 'Responsive intake', 'canonical-4.0.0');
    expect(api.updateDraft).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/workspaces', 'local', 'forms', 'form-1', 'drafts', 'draft-1', 'author']);
  });

  it('reports migration required instead of routing a saved legacy draft into canonical authoring', () => {
    const api = createApi();
    const router = { navigate: vi.fn(() => Promise.resolve(true)) };
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [
      { provide: SmartIntakeApiService, useValue: api }, staffSessionProvider,
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { snapshot: { data: { screen: 'builder' }, paramMap: { get: (name: string) => name === 'workspaceId' ? 'local' : null } } } },
    ] });
    const component = TestBed.createComponent(AppComponent).componentInstance;
    component.formId = 'legacy-form';
    component.draftId = 'legacy-draft';

    component.openAuthoring();

    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.message()).toContain('legacy package format');
  });

  it('denies a workspace new-form route without author access before creating a draft', () => {
    const api = createApi();
    const reviewerSession = { provide: StaffSessionStore, useValue: {
      currentWorkspaceId: signal('workspace-1'), currentRoles: signal(['reviewer']),
      organizations: signal([{ workspaces: [{ workspaceId: 'workspace-1', roles: ['reviewer'] }] }]),
    } };
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: SmartIntakeApiService, useValue: api }, reviewerSession,
        { provide: ActivatedRoute, useValue: { snapshot: { data: { screen: 'builder' }, paramMap: { get: (name: string) => ({ workspaceId: 'workspace-1' })[name] ?? null } } } },
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.draftState()).toBe('denied');
    expect(fixture.nativeElement.textContent).toContain('Draft access denied');
    expect(api.listForms).not.toHaveBeenCalled();
    fixture.componentInstance.save();
    expect(api.createForm).not.toHaveBeenCalled();
  });

  it('creates then persists a draft, repeats with its current revision, publishes from the toolbar, and submits a session', () => {
    const api = createApi();
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    const toolbar = fixture.nativeElement.querySelector('nav[appToolbar]') as HTMLElement;
    expect(toolbar.classList.contains('flex')).toBe(true);
    expect(toolbar.classList.contains('flex-wrap')).toBe(true);
    expect(toolbar.classList.contains('w-full')).toBe(true);

    toolbarButton(fixture, 'Save draft').click();
    expect(api.createForm).toHaveBeenCalledWith('local', 'responsive-intake', 'Responsive intake');
    expect(api.updateDraft).toHaveBeenCalledWith('local', 'form-1', 'draft-1', 1, component.definition());
    expect(component.draftRevision()).toBe(2);
    toolbarButton(fixture, 'Save draft').click();
    expect(api.createForm).toHaveBeenCalledOnce();
    expect(api.updateDraft).toHaveBeenLastCalledWith('local', 'form-1', 'draft-1', 2, component.definition());

    component.requestReviewAction();
    component.approveReviewAction();
    component.publishReviewAction();
    expect(api.publish).toHaveBeenCalledWith('local', 'form-1', 'review-1');
    expect(component.message()).toBe('Form published. Release release-1');
    expect(component.publishedShareId).toBe('form-1');

    component.startPreview();
    expect(component.mode()).toBe('preview');
    expect(api.startSession).toHaveBeenCalledWith('form-1');
    component.answers = { name: 'Ada' };
    component.submit();
    expect(api.patchSession).toHaveBeenCalledWith('session-1', 'respondent-token', expect.objectContaining({ baseRevision: 3, answers: { name: 'Ada' } }));
    expect(api.submitSession).toHaveBeenCalledWith('session-1', 'respondent-token', 4);
    expect(component.message()).toBe('Response received. Receipt receipt-1');
  });

  it.each([
    [404, 'Publish the saved form before starting a public session.'],
    [403, 'Public session start was denied.'],
    [410, 'This public form is no longer accepting new responses.'],
    [500, 'Could not start the public session. Try again.'],
  ])('reports public session start HTTP %s truthfully', (status, message) => {
    const api = createApi();
    api.startSession.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const component = TestBed.createComponent(AppComponent).componentInstance;
    component.formId = 'form-1';

    component.startPreview();

    expect(component.message()).toBe(message);
  });

  it('starts the public session with the share identifier returned by publication', () => {
    const api = createApi();
    api.publish.mockReturnValue(of({ releaseId: 'release-1', version: 1, shareId: 'public-share-1', status: 'PUBLISHED' }));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const component = TestBed.createComponent(AppComponent).componentInstance;
    component.formId = 'form-1';

    component.requestReviewAction();
    component.approveReviewAction();
    component.publishReviewAction();
    component.startPreview();

    expect(api.startSession).toHaveBeenCalledWith('public-share-1');
  });

  it('serializes a dirty draft save before publishing and blocks edits while persistence is in flight', () => {
    const api = createApi();
    const saved = new Subject<{ revision: number; definition: ReturnType<typeof createDefaultDefinition>; diagnostics: never[] }>();
    const published = new Subject<{ releaseId: string; version: number; shareId: string; status: string }>();
    api.updateDraft.mockReturnValue(saved.asObservable());
    api.publish.mockReturnValue(published.asObservable());
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.formId = 'form-1';
    component.draftId = 'draft-1';
    component.touch();

    component.requestReviewAction();
    expect(api.updateDraft).toHaveBeenCalledOnce();
    expect(api.publish).not.toHaveBeenCalled();
    expect(component.saving()).toBe(true);
    const savedDefinition = component.definition();
    const fieldsBefore = component.page().fields.length;
    component.addField('text');
    component.touch();
    expect(component.page().fields).toHaveLength(fieldsBefore);
    expect(component.definition()).toBe(savedDefinition);
    component.importDefinition({ target: { files: [{ text: () => Promise.resolve('{}') }] } } as unknown as Event);
    expect(api.importDefinition).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type="file"]').disabled).toBe(true);
    expect(toolbarButton(fixture, 'Save draft').disabled).toBe(true);
    expect(toolbarButton(fixture, 'Publish')).toBeUndefined();

    component.requestReviewAction();
    expect(api.updateDraft).toHaveBeenCalledOnce();
    saved.next({ revision: 2, definition: savedDefinition, diagnostics: [] });
    component.approveReviewAction();
    component.publishReviewAction();
    expect(api.publish).toHaveBeenCalledWith('local', 'form-1', 'review-1');
    component.publishReviewAction();
    expect(api.publish).toHaveBeenCalledOnce();
    published.next({ releaseId: 'release-1', version: 1, shareId: 'form-1', status: 'PUBLISHED' });
    expect(component.publishing()).toBe(false);
  });

  it('uses its current revision then replaces the editor with the canonical imported draft', async () => {
    const api = createApi();
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.formId = 'form-1';
    component.draftId = 'draft-1';
    component.draftRevision.set(7);
    const canonical = { ...createDefaultDefinition(), title: 'Canonical imported draft' };
    api.currentDraft.mockReturnValue(of({ id: 'draft-1', revision: 8, definition: canonical, diagnostics: [] }));
    const importInput = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(importInput, 'files', { value: [{ text: () => Promise.resolve('{"contractVersion":"4.0.0"}') }] });

    importInput.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(api.importDefinition).toHaveBeenCalledWith('local', 'form-1', 7, { contractVersion: '4.0.0' });
    expect(api.currentDraft).toHaveBeenCalledWith('local', 'form-1', 'draft-1');
    expect(component.draftRevision()).toBe(8);
    expect(component.definition().title).toBe('Canonical imported draft');
    expect(component.saving()).toBe(false);
  });

  it('recovers the saving state when an imported definition cannot be parsed', async () => {
    const api = createApi();
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.formId = 'form-1';
    const importInput = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(importInput, 'files', { value: [{ text: () => Promise.resolve('{') }] });

    importInput.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.importDefinition).not.toHaveBeenCalled();
    expect(component.saving()).toBe(false);
    expect(component.message()).toBe('Import rejected.');
  });

  it('filters the inlined response list from its rendered search control', () => {
    const api = createApi();
    api.listResponses.mockReturnValue(of([
      { id: 'receipt-1', submittedAt: '2026-09-16' },
      { id: 'receipt-2', formKey: 'other' },
    ]));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    toolbarButton(fixture, 'Response admin').click();
    fixture.detectChanges();
    const responseAdmin = fixture.nativeElement.querySelector('[data-testid="response-admin"]') as HTMLElement;
    const search = responseAdmin.querySelector('input[placeholder="Search receipt or form"]') as HTMLInputElement;
    const heading = responseAdmin.querySelector('h2') as HTMLElement;
    expect(responseAdmin.firstElementChild?.classList.contains('flex-wrap')).toBe(true);
    expect(heading.classList.contains('break-words')).toBe(true);
    expect(search.classList.contains('min-w-0')).toBe(true);
    search.value = 'receipt-1';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const rows = responseAdmin.querySelectorAll('.field-card');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('receipt-1');
    expect(rows[0].classList.contains('flex-wrap')).toBe(true);
    expect(rows[0].querySelector('span')?.classList.contains('break-all')).toBe(true);
  });

  it('opens an authorized response detail after an inlined response row click', () => {
    const api = createApi();
    api.listResponses.mockReturnValue(of([{ id: 'receipt-1', submittedAt: '2026-09-16' }]));
    api.responseDetail.mockReturnValue(of({ id: 'receipt-1', answers: { name: 'Ada' } }));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    toolbarButton(fixture, 'Response admin').click();
    fixture.detectChanges();
    const responseRow = fixture.nativeElement.querySelector('[data-testid="response-admin"] .field-card') as HTMLButtonElement;
    responseRow.click();
    fixture.detectChanges();

    expect(api.responseDetail).toHaveBeenCalledWith('local', 'receipt-1');
    expect(fixture.nativeElement.textContent).toContain('Authorized response detail');
    expect(fixture.nativeElement.textContent).toContain('Ada');

    const closeButton = fixture.nativeElement.querySelector('aside .icon') as HTMLButtonElement;
    expect(closeButton.classList.contains('icon')).toBe(true);
    closeButton.click();
    fixture.detectChanges();
    expect(component.responseDetail()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Authorized response detail');
  });

  it('keeps the newest response detail when an older request completes later', () => {
    const api = createApi();
    const first = new Subject<{ id: string; answers: { name: string } }>();
    const second = new Subject<{ id: string; answers: { name: string } }>();
    api.responseDetail.mockReturnValueOnce(first.asObservable()).mockReturnValueOnce(second.asObservable());
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    component.openResponse('receipt-a');
    component.openResponse('receipt-b');
    second.next({ id: 'receipt-b', answers: { name: 'Bree' } });
    first.next({ id: 'receipt-a', answers: { name: 'Ada' } });

    expect(component.responseDetail()).toEqual({ id: 'receipt-b', answers: { name: 'Bree' } });
  });

  it('ignores an older response detail failure after the newest request succeeds', () => {
    const api = createApi();
    const first = new Subject<{ id: string; answers: { name: string } }>();
    const second = new Subject<{ id: string; answers: { name: string } }>();
    api.responseDetail.mockReturnValueOnce(first.asObservable()).mockReturnValueOnce(second.asObservable());
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    component.openResponse('receipt-a');
    component.openResponse('receipt-b');
    second.next({ id: 'receipt-b', answers: { name: 'Bree' } });
    first.error(new Error('late failure'));

    expect(component.responseDetail()).toEqual({ id: 'receipt-b', answers: { name: 'Bree' } });
    expect(component.message()).not.toBe('Response detail unavailable.');
  });

  it('does not reopen a response detail after it is closed during a pending request', () => {
    const api = createApi();
    const pending = new Subject<{ id: string }>();
    api.responseDetail.mockReturnValue(pending.asObservable());
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    component.openResponse('receipt-a');
    component.closeResponseDetail();
    pending.next({ id: 'receipt-a' });

    expect(component.responseDetail()).toBeNull();
  });

  it('renders response failures globally and clears stale response detail', () => {
    const api = createApi();
    api.listResponses.mockReturnValue(throwError(() => new Error('list failed')));
    api.responseDetail.mockReturnValue(throwError(() => new Error('detail failed')));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    component.responseDetail.set({ id: 'stale' });
    fixture.detectChanges();

    component.loadResponses();
    fixture.detectChanges();
    expect(component.responseDetail()).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Response list unavailable.');

    component.responseDetail.set({ id: 'stale' });
    component.openResponse('receipt-1');
    fixture.detectChanges();
    expect(component.responseDetail()).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Response detail unavailable.');
  });

  it('preserves draft, publish, and session failure messages', () => {
    const api = createApi();
    api.createForm.mockReturnValue(throwError(() => new Error('conflict')));
    api.publish.mockReturnValue(throwError(() => new Error('publish failure')));
    api.startSession.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }, staffSessionProvider] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    component.save();
    expect(component.message()).toBe('Save failed: form key may already exist.');
    component.requestReviewAction();
    expect(component.message()).toBe('Save a form before publishing.');
    component.formId = 'form-1';
    component.requestReviewAction();
    component.approveReviewAction();
    component.publishReviewAction();
    expect(component.message()).toBe('Governed publish failed. Refresh the review state and try again.');
    component.startPreview();
    expect(component.message()).toBe('Publish the saved form before starting a public session.');
  });
});
