import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { SmartIntakeApiService } from './smart-intake-api.service';

describe('AppComponent journeys', () => {
  function createApi() {
    return {
      bootstrap: vi.fn(() => of({ staffSession: 'bootstrapped' })),
      saveDraft: vi.fn(() => of({ id: 'form-1', revision: 2 })),
      startSession: vi.fn(() => of({ sessionId: 'session-1', respondentSession: 'respondent-token', revision: 3 })),
      patchSession: vi.fn(() => of({ acceptedRevision: 4 })),
      submitSession: vi.fn(() => of({ receiptId: 'receipt-1' })),
      listResponses: vi.fn(() => of([])),
      responseDetail: vi.fn(() => of({})),
      exportDefinition: vi.fn(() => of({})),
      importDefinition: vi.fn(() => of({ revision: 3 })),
      exportResponses: vi.fn(() => of([])),
    };
  }

  it('bootstraps, saves, starts a session, patches, and submits through the facade', () => {
    localStorage.removeItem('smartintake.staffSession');
    const api = createApi();
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(api.bootstrap).toHaveBeenCalledOnce();
    expect(localStorage.getItem('smartintake.staffSession')).toBe('bootstrapped');
    component.save();
    expect(api.saveDraft).toHaveBeenCalledWith('bootstrapped', 'responsive-intake', 'Responsive intake');
    expect(component.formId).toBe('form-1');

    component.startPreview();
    expect(component.mode()).toBe('preview');
    expect(api.startSession).toHaveBeenCalledWith('form-1');
    component.answers = { name: 'Ada' };
    component.submit();
    expect(api.patchSession).toHaveBeenCalledWith('session-1', 'respondent-token', expect.objectContaining({ baseRevision: 3, answers: { name: 'Ada' } }));
    expect(api.submitSession).toHaveBeenCalledWith('session-1', 'respondent-token', 4);
    expect(component.message()).toBe('Response received. Receipt receipt-1');
  });

  it('preserves session and save failure messages', () => {
    localStorage.setItem('smartintake.staffSession', 'existing-token');
    const api = createApi();
    api.saveDraft.mockReturnValue(throwError(() => new Error('conflict')));
    api.startSession.mockReturnValue(throwError(() => new Error('unpublished')));
    TestBed.configureTestingModule({ imports: [AppComponent], providers: [{ provide: SmartIntakeApiService, useValue: api }] });
    const component = TestBed.createComponent(AppComponent).componentInstance;

    component.save();
    expect(component.message()).toBe('Save failed: form key may already exist.');
    component.formId = 'form-1';
    component.startPreview();
    expect(component.message()).toBe('Publish the saved form before starting a public session.');
  });
});
