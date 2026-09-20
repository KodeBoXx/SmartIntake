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

  it('rehydrates the authoritative default draft after validating a stored session', () => {
    const api = createApi();
    const restored = { ...createDefaultDefinition(), title: 'Restored intake' };
    api.listForms.mockReturnValue(of([{ id: 'form-1', formKey: 'responsive-intake', title: 'Responsive intake', status: 'DRAFT', revision: 4, updatedAt: '2026-09-18' }]));
    api.currentDraft.mockReturnValue(of({ id: 'draft-1', revision: 4, definition: restored, diagnostics: [] }));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    expect(api.currentDraft).toHaveBeenCalledWith('local', 'form-1', 'form-1');
    expect(component.formId).toBe('form-1');
    expect(component.draftId).toBe('draft-1');
    expect(component.draftRevision()).toBe(4);
    expect(component.definition().title).toBe('Restored intake');
    expect(component.dirty()).toBe(false);
  });

  it('locks authoring until form lookup and authoritative draft rehydration complete', () => {
    const api = createApi();
    const forms = new Subject<Array<{ id: string; formKey: string; title: string; status: string; revision: number; updatedAt: string }>>();
    const draft = new Subject<{ id: string; revision: number; definition: ReturnType<typeof createDefaultDefinition>; diagnostics: never[] }>();
    api.listForms.mockReturnValue(forms.asObservable());
    api.currentDraft.mockReturnValue(draft.asObservable());
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.rehydrating()).toBe(true);
    expect(toolbarButton(fixture, 'Save draft').disabled).toBe(true);
    expect(toolbarButton(fixture, 'Publish').disabled).toBe(true);
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
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.rehydrationFailed()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Saved draft unavailable. Retry before editing.');
    expect(fixture.nativeElement.textContent).toContain('Retry saved draft');
    component.save();
    expect(api.createForm).not.toHaveBeenCalled();
  });

  it('creates then persists a draft, repeats with its current revision, publishes from the toolbar, and submits a session', () => {
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
    expect(api.createForm).toHaveBeenCalledWith('local', 'responsive-intake', 'Responsive intake');
    expect(api.updateDraft).toHaveBeenCalledWith('local', 'form-1', 'draft-1', 1, component.definition());
    expect(component.draftRevision()).toBe(2);
    toolbarButton(fixture, 'Save draft').click();
    expect(api.createForm).toHaveBeenCalledOnce();
    expect(api.updateDraft).toHaveBeenLastCalledWith('local', 'form-1', 'draft-1', 2, component.definition());

    toolbarButton(fixture, 'Publish').click();
    expect(api.publish).toHaveBeenCalledWith('local', 'form-1');
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

  it('serializes a dirty draft save before publishing and blocks edits while persistence is in flight', () => {
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
    expect(toolbarButton(fixture, 'Publish').disabled).toBe(true);

    component.publish();
    expect(api.updateDraft).toHaveBeenCalledOnce();
    saved.next({ revision: 2, definition: savedDefinition, diagnostics: [] });
    expect(api.publish).toHaveBeenCalledWith('local', 'form-1');
    expect(component.publishing()).toBe(true);

    component.publish();
    expect(api.publish).toHaveBeenCalledOnce();
    published.next({ releaseId: 'release-1', version: 1, shareId: 'form-1', status: 'PUBLISHED' });
    expect(component.publishing()).toBe(false);
  });

  it('uses its current revision then replaces the editor with the canonical imported draft', async () => {
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
    expect(api.importDefinition).toHaveBeenCalledWith('local', 'form-1', 7, { contractVersion: '4.0.0' });
    expect(api.currentDraft).toHaveBeenCalledWith('local', 'form-1', 'draft-1');
    expect(component.draftRevision()).toBe(8);
    expect(component.definition().title).toBe('Canonical imported draft');
    expect(component.saving()).toBe(false);
  });

  it('recovers the saving state when an imported definition cannot be parsed', async () => {
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
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
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
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
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
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
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
