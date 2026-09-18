import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { createDefaultDefinition } from './models/form-definition.models';
import { SmartIntakeApiService } from './smart-intake-api.service';

describe('AppComponent journeys', () => {
  function createApi() {
    const definition = createDefaultDefinition();
    return {
      bootstrap: vi.fn(() => of({ staffSession: 'bootstrapped' })),
      signIn: vi.fn(() => of({ staffSession: 'signed-in' })),
      listForms: vi.fn(() => of([] as Array<{ id: string; formKey: string; title: string; status: string; revision: number; updatedAt: string }>)),
      currentDraft: vi.fn(() => of({ id: 'form-1', revision: 2, definition, diagnostics: [] })),
      createForm: vi.fn(() => of({ id: 'form-1', draftId: 'draft-1', revision: 1, definition })),
      updateDraft: vi.fn(() => of({ revision: 2, definition, diagnostics: [] })),
      publish: vi.fn(() => of({ releaseId: 'release-1', version: 1, shareId: 'form-1', status: 'PUBLISHED' })),
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

  it('uses bootstrap then sign-in fallback and persists the recovered staff token', () => {
    localStorage.removeItem('smartintake.staffSession');
    const api = createApi();
    api.bootstrap.mockReturnValue(throwError(() => new Error('already bootstrapped')));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    expect(api.bootstrap).toHaveBeenCalledOnce();
    expect(api.signIn).toHaveBeenCalledOnce();
    expect(component.staffToken).toBe('signed-in');
    expect(localStorage.getItem('smartintake.staffSession')).toBe('signed-in');
  });

  it('shows a session failure only when bootstrap and sign-in both fail', () => {
    localStorage.removeItem('smartintake.staffSession');
    const api = createApi();
    api.bootstrap.mockReturnValue(throwError(() => new Error('bootstrap failed')));
    api.signIn.mockReturnValue(throwError(() => new Error('sign-in failed')));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    expect(component.message()).toBe('Unable to start a staff session.');
  });

  it('clears a stale stored staff token and recovers through bootstrap then sign-in', () => {
    localStorage.setItem('smartintake.staffSession', 'stale-token');
    const api = createApi();
    api.listForms.mockReturnValueOnce(throwError(() => ({ status: 401 }))).mockReturnValue(of([]));
    api.bootstrap.mockReturnValue(throwError(() => new Error('already bootstrapped')));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    expect(api.listForms).toHaveBeenNthCalledWith(1, 'stale-token');
    expect(api.bootstrap).toHaveBeenCalledOnce();
    expect(api.signIn).toHaveBeenCalledOnce();
    expect(component.staffToken).toBe('signed-in');
    expect(localStorage.getItem('smartintake.staffSession')).toBe('signed-in');
  });

  it('rehydrates the authoritative default draft after validating a stored session', () => {
    localStorage.setItem('smartintake.staffSession', 'existing-token');
    const api = createApi();
    const restored = { ...createDefaultDefinition(), title: 'Restored intake' };
    api.listForms.mockReturnValue(of([{ id: 'form-1', formKey: 'responsive-intake', title: 'Responsive intake', status: 'DRAFT', revision: 4, updatedAt: '2026-09-18' }]));
    api.currentDraft.mockReturnValue(of({ id: 'draft-1', revision: 4, definition: restored, diagnostics: [] }));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    expect(api.currentDraft).toHaveBeenCalledWith('existing-token', 'form-1', 'form-1');
    expect(component.formId).toBe('form-1');
    expect(component.draftId).toBe('draft-1');
    expect(component.draftRevision()).toBe(4);
    expect(component.definition().title).toBe('Restored intake');
    expect(component.dirty()).toBe(false);
  });

  it('creates then persists a draft, repeats with its current revision, publishes from the toolbar, and submits a session', () => {
    localStorage.removeItem('smartintake.staffSession');
    const api = createApi();
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    const toolbar = fixture.nativeElement.querySelector('nav[appToolbar]') as HTMLElement;
    expect(toolbar.classList.contains('flex')).toBe(true);
    expect(toolbar.classList.contains('flex-wrap')).toBe(true);
    expect(toolbar.classList.contains('w-full')).toBe(true);

    toolbarButton(fixture, 'Save draft').click();
    expect(api.createForm).toHaveBeenCalledWith('bootstrapped', 'responsive-intake', 'Responsive intake');
    expect(api.updateDraft).toHaveBeenCalledWith('bootstrapped', 'form-1', 'draft-1', 1, component.definition());
    expect(component.draftRevision()).toBe(2);
    toolbarButton(fixture, 'Save draft').click();
    expect(api.createForm).toHaveBeenCalledOnce();
    expect(api.updateDraft).toHaveBeenLastCalledWith('bootstrapped', 'form-1', 'draft-1', 2, component.definition());

    toolbarButton(fixture, 'Publish').click();
    expect(api.publish).toHaveBeenCalledWith('bootstrapped', 'form-1');
    expect(component.message()).toBe('Form published. Release release-1');

    component.startPreview();
    expect(component.mode()).toBe('preview');
    expect(api.startSession).toHaveBeenCalledWith('form-1');
    component.answers = { name: 'Ada' };
    component.submit();
    expect(api.patchSession).toHaveBeenCalledWith('session-1', 'respondent-token', expect.objectContaining({ baseRevision: 3, answers: { name: 'Ada' } }));
    expect(api.submitSession).toHaveBeenCalledWith('session-1', 'respondent-token', 4);
    expect(component.message()).toBe('Response received. Receipt receipt-1');
  });

  it('serializes a dirty draft save before publishing and guards an in-flight publish', () => {
    localStorage.setItem('smartintake.staffSession', 'existing-token');
    const api = createApi();
    const saved = new Subject<{ revision: number; definition: ReturnType<typeof createDefaultDefinition>; diagnostics: never[] }>();
    const published = new Subject<{ releaseId: string; version: number; shareId: string; status: string }>();
    api.updateDraft.mockReturnValue(saved.asObservable());
    api.publish.mockReturnValue(published.asObservable());
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.formId = 'form-1';
    component.draftId = 'draft-1';
    component.touch();

    component.publish();
    expect(api.updateDraft).toHaveBeenCalledOnce();
    expect(api.publish).not.toHaveBeenCalled();
    expect(component.saving()).toBe(true);
    fixture.detectChanges();
    expect(toolbarButton(fixture, 'Publish').disabled).toBe(true);

    component.publish();
    expect(api.updateDraft).toHaveBeenCalledOnce();
    saved.next({ revision: 2, definition: component.definition(), diagnostics: [] });
    expect(api.publish).toHaveBeenCalledWith('existing-token', 'form-1');
    expect(component.publishing()).toBe(true);

    component.publish();
    expect(api.publish).toHaveBeenCalledOnce();
    published.next({ releaseId: 'release-1', version: 1, shareId: 'form-1', status: 'PUBLISHED' });
    expect(component.publishing()).toBe(false);
  });

  it('uses its current revision then replaces the editor with the canonical imported draft', async () => {
    localStorage.setItem('smartintake.staffSession', 'existing-token');
    const api = createApi();
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
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
    expect(api.importDefinition).toHaveBeenCalledWith('existing-token', 'form-1', 7, { contractVersion: '4.0.0' });
    expect(api.currentDraft).toHaveBeenCalledWith('existing-token', 'form-1', 'draft-1');
    expect(component.draftRevision()).toBe(8);
    expect(component.definition().title).toBe('Canonical imported draft');
    expect(component.saving()).toBe(false);
  });

  it('recovers the saving state when an imported definition cannot be parsed', async () => {
    localStorage.setItem('smartintake.staffSession', 'existing-token');
    const api = createApi();
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
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
    localStorage.setItem('smartintake.staffSession', 'existing-token');
    const api = createApi();
    api.listResponses.mockReturnValue(of([
      { id: 'receipt-1', submittedAt: '2026-09-16' },
      { id: 'receipt-2', formKey: 'other' },
    ]));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
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
    localStorage.setItem('smartintake.staffSession', 'existing-token');
    const api = createApi();
    api.listResponses.mockReturnValue(of([{ id: 'receipt-1', submittedAt: '2026-09-16' }]));
    api.responseDetail.mockReturnValue(of({ id: 'receipt-1', answers: { name: 'Ada' } }));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    toolbarButton(fixture, 'Response admin').click();
    fixture.detectChanges();
    const responseRow = fixture.nativeElement.querySelector('[data-testid="response-admin"] .field-card') as HTMLButtonElement;
    responseRow.click();
    fixture.detectChanges();

    expect(api.responseDetail).toHaveBeenCalledWith('existing-token', 'receipt-1');
    expect(fixture.nativeElement.textContent).toContain('Authorized response detail');
    expect(fixture.nativeElement.textContent).toContain('Ada');

    const closeButton = fixture.nativeElement.querySelector('aside .icon') as HTMLButtonElement;
    expect(closeButton.classList.contains('icon')).toBe(true);
    closeButton.click();
    fixture.detectChanges();
    expect(component.responseDetail()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Authorized response detail');
  });

  it('renders response failures globally and clears stale response detail', () => {
    localStorage.setItem('smartintake.staffSession', 'existing-token');
    const api = createApi();
    api.listResponses.mockReturnValue(throwError(() => new Error('list failed')));
    api.responseDetail.mockReturnValue(throwError(() => new Error('detail failed')));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
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
    localStorage.setItem('smartintake.staffSession', 'existing-token');
    const api = createApi();
    api.createForm.mockReturnValue(throwError(() => new Error('conflict')));
    api.publish.mockReturnValue(throwError(() => new Error('publish failure')));
    api.startSession.mockReturnValue(throwError(() => new Error('unpublished')));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    component.save();
    expect(component.message()).toBe('Save failed: form key may already exist.');
    component.publish();
    expect(component.message()).toBe('Save a form before publishing.');
    component.formId = 'form-1';
    component.publish();
    expect(component.message()).toBe('Publish failed.');
    component.startPreview();
    expect(component.message()).toBe('Publish the saved form before starting a public session.');
  });
});
