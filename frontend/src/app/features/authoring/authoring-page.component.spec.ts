import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthoringPageComponent } from './authoring-page.component';

describe('AuthoringPageComponent backend contract integration', () => {
  let fixture: ComponentFixture<AuthoringPageComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ workspaceId: 'workspace-1', formId: 'form-1', draftId: 'draft-1' }) }, firstChild: null } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AuthoringPageComponent);
  });

  afterEach(() => http.verify());

  function flushInitial(definition: unknown): void {
    fixture.detectChanges();
    const base = '/v1/workspaces/workspace-1/forms/form-1/authoring/draft-1';
    http.expectOne(base).flush({ formId: 'form-1', draftId: 'draft-1', revision: 3, definition });
    http.expectOne(`${base}/history`).flush([]);
    http.expectOne('/v1/workspaces/workspace-1/reusable-components').flush([]);
    http.expectOne(`${base}/theme`).flush({ revision: 3, theme: { preset: 'Certinal', tokens: {} } });
    http.expectOne(`${base}/content`).flush({ revision: 3, guidance: {}, translations: { en: { direction: 'ltr', messages: {} } } });
    http.expectOne(`${base}/comments`).flush([]);
    http.expectOne(`${base}/presence`).flush([]);
  }

  it('hydrates the three-pane store from actual document, theme, content, comment, and presence envelopes', () => {
    fixture.detectChanges();
    const base = '/v1/workspaces/workspace-1/forms/form-1/authoring/draft-1';
    http.expectOne(base).flush({ formId: 'form-1', draftId: 'draft-1', revision: 7, definition: { title: 'Backend intake', pages: [{ id: 'page-1', title: 'Details', fields: [{ id: 'name', label: 'Legal name', type: 'text' }] }] }, packageHash: 'hash', diagnostics: [], history: [] });
    http.expectOne(`${base}/history`).flush([{ id: 'history-1', revision: 7, operation: 'COMMAND_BATCH', createdAt: '2026-09-21T00:00:00Z' }]);
    http.expectOne('/v1/workspaces/workspace-1/reusable-components').flush([]);
    http.expectOne(`${base}/theme`).flush({ revision: 7, theme: { preset: 'Certinal', tokens: {}, locks: ['color.primary'], preflight: [] } });
    http.expectOne(`${base}/content`).flush({ revision: 7, guidance: { narration: 'Read aloud' }, translations: { en: { guidance: 'Complete this.' }, hi: {}, ar: {} } });
    http.expectOne(`${base}/comments`).flush([{ id: 'comment-1', pointer: 'name', body: 'Required for review', authorId: 'author-1', createdAt: '2026-09-21T00:00:00Z' }]);
    http.expectOne(`${base}/presence`).flush([{ accountId: 'author-1', cursor: 'name', displayName: 'Author', expiresAt: '2026-09-21T00:01:30Z' }]);
    fixture.detectChanges();

    expect(fixture.componentInstance.store.document().revision).toBe(7);
    expect(fixture.componentInstance.store.document().phases[0].pages[0].sections[0].nodes[0]).toMatchObject({ id: 'name', label: 'Legal name' });
    expect(fixture.nativeElement.textContent).toContain('Backend intake');
    expect(fixture.componentInstance.commentsForSelection()).toHaveLength(1);
    expect(fixture.componentInstance.presence()[0].selectedId).toBe('name');
  });

  it('reuses its persisted logical comment key on a manual retry', () => {
    fixture.detectChanges();
    const base = '/v1/workspaces/workspace-1/forms/form-1/authoring/draft-1';
    http.expectOne(base).flush({ formId: 'form-1', draftId: 'draft-1', revision: 7, definition: { title: 'Backend intake', pages: [{ id: 'page-1', title: 'Details', fields: [{ id: 'name', label: 'Legal name', type: 'text' }] }] }, packageHash: 'hash', diagnostics: [], history: [] });
    http.expectOne(`${base}/history`).flush([]);
    http.expectOne('/v1/workspaces/workspace-1/reusable-components').flush([]);
    http.expectOne(`${base}/theme`).flush({ revision: 7, theme: { preset: 'Certinal', tokens: {}, locks: [], preflight: [] } });
    http.expectOne(`${base}/content`).flush({ revision: 7, guidance: {}, translations: { en: {}, hi: {}, ar: {} } });
    http.expectOne(`${base}/comments`).flush([]);
    http.expectOne(`${base}/presence`).flush([]);

    fixture.componentInstance.commentText = 'Review the legal name question';
    fixture.componentInstance.sendComment();
    const first = http.expectOne(`${base}/comments`);
    const key = first.request.headers.get('Idempotency-Key');
    expect(key).toMatch(/.+/);
    first.flush({}, { status: 503, statusText: 'Unavailable' });

    fixture.componentInstance.sendComment();
    const retry = http.expectOne(`${base}/comments`);
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    retry.flush({ id: 'comment-1', pointer: 'name', body: 'Review the legal name question', authorId: 'author-1', createdAt: '2026-09-21T00:00:00Z' });

    fixture.componentInstance.commentText = 'Review the legal name question';
    fixture.componentInstance.sendComment();
    const laterComment = http.expectOne(`${base}/comments`);
    expect(laterComment.request.headers.get('Idempotency-Key')).not.toBe(key);
    laterComment.flush({ id: 'comment-2', pointer: 'name', body: 'Review the legal name question', authorId: 'author-1', createdAt: '2026-09-21T00:01:00Z' });
  });

  it('clears cached authoring resources and renders denied instead of a stale draft', () => {
    const key = 'smart-intake.authoring.unidentified.workspace-1.form-1.draft-1';
    localStorage.setItem(key, JSON.stringify({ document: { id: 'draft-1', revision: 99, title: 'Cached secret', phases: [] }, undo: [], redo: [], history: [], selectedId: null, pending: [], redoPending: [], pendingMutationKey: null, componentInsertionKeys: {}, operationKeys: {}, conflict: null }));

    fixture.detectChanges();
    http.expectOne('/v1/workspaces/workspace-1/forms/form-1/authoring/draft-1').flush({}, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    expect(localStorage.getItem(key)).toBeNull();
    expect(fixture.componentInstance.resourceState()).toBe('denied');
    expect(fixture.nativeElement.textContent).toContain('Authoring access denied');
    expect(fixture.nativeElement.textContent).not.toContain('Cached secret');
  });

  it('keeps imported reference IDs and message keys while staging selected-locale text', () => {
    fixture.detectChanges();
    const base = '/v1/workspaces/workspace-1/forms/form-1/authoring/draft-1';
    http.expectOne(base).flush({ formId: 'form-1', draftId: 'draft-1', revision: 7, definition: { title: 'Governed draft', pages: [] } });
    http.expectOne(`${base}/history`).flush([]);
    http.expectOne('/v1/workspaces/workspace-1/reusable-components').flush([]);
    http.expectOne(`${base}/theme`).flush({ revision: 7, theme: { preset: 'Certinal', tokens: {} } });
    http.expectOne(`${base}/content`).flush({ revision: 7, guidance: { brief: { id: 'Imported-Brief_7', messageKey: 'imported.brief.v7' }, narration: { id: 'Imported-Narration_9', messageKey: 'imported.narration.v9' } }, translations: { hi: { direction: 'ltr', messages: { 'imported.brief.v7': 'हिन्दी निर्देश', 'imported.narration.v9': 'हिन्दी वर्णन' } } } });
    http.expectOne(`${base}/comments`).flush([]);
    http.expectOne(`${base}/presence`).flush([]);
    fixture.componentInstance.setLocale('hi');
    fixture.componentInstance['populateContentEditors'](fixture.componentInstance.content());

    expect(fixture.componentInstance.referencesText).toContain('Imported-Brief_7');
    expect(fixture.componentInstance.referencesText).toContain('imported.brief.v7');
    expect(fixture.componentInstance.briefGuidanceText).toBe('हिन्दी निर्देश');
    expect(fixture.nativeElement.querySelector('input[aria-label="Question for Click to Ask"]')).toBeNull();
    fixture.componentInstance.briefGuidanceText = 'बदला हुआ निर्देश';
    fixture.componentInstance.saveGuidance();
    const save = http.expectOne(`${base}/content`);
    expect(save.request.body).toEqual({ guidance: { brief: { id: 'Imported-Brief_7', messageKey: 'imported.brief.v7' }, narration: { id: 'Imported-Narration_9', messageKey: 'imported.narration.v9' } } });
    save.flush({ revision: 8, definition: { title: 'Governed draft', pages: [] } });
    http.expectOne(`${base}/content`).flush({ revision: 8, guidance: { brief: { id: 'Imported-Brief_7', messageKey: 'imported.brief.v7' }, narration: { id: 'Imported-Narration_9', messageKey: 'imported.narration.v9' } }, translations: { hi: { direction: 'ltr', messages: { 'imported.brief.v7': 'हिन्दी निर्देश', 'imported.narration.v9': 'हिन्दी वर्णन' } } } });
    expect(fixture.componentInstance.briefGuidanceText).toBe('बदला हुआ निर्देश');
    expect(fixture.componentInstance.content().locale).toBe('hi');
  });

  it('keeps a reviewer-readable draft and locale review content when an author-only optional resource is forbidden', () => {
    fixture.detectChanges();
    const base = '/v1/workspaces/workspace-1/forms/form-1/authoring/draft-1';
    http.expectOne(base).flush({ formId: 'form-1', draftId: 'draft-1', revision: 7, definition: { title: 'Reviewer draft', pages: [] } });
    http.expectOne(`${base}/history`).flush([]);
    http.expectOne('/v1/workspaces/workspace-1/reusable-components').flush({}, { status: 403, statusText: 'Forbidden' });
    http.expectOne(`${base}/theme`).flush({ revision: 7, theme: { preset: 'Certinal', tokens: {} } });
    http.expectOne(`${base}/content`).flush({ revision: 7, guidance: {}, translations: { en: { direction: 'ltr', messages: {} } }, localeReviews: [{ locale: 'en', sourceRevision: 7, status: 'DRAFT', reviewedAt: null }] });
    http.expectOne(`${base}/comments`).flush([]);
    http.expectOne(`${base}/presence`).flush([]);
    fixture.detectChanges();

    expect(fixture.componentInstance.resourceState()).toBe('ready');
    expect(fixture.componentInstance.store.document().title).toBe('Reviewer draft');
    expect(fixture.componentInstance.content().localeReviews).toEqual([{ locale: 'en', sourceRevision: 7, status: 'DRAFT', reviewedAt: null }]);
    expect(fixture.nativeElement.textContent).toContain('Reviewer draft');
  });

  it('clears draft cache and renders expiry when an optional resource reports an expired session', () => {
    const key = 'smart-intake.authoring.unidentified.workspace-1.form-1.draft-1';
    localStorage.setItem(key, JSON.stringify({ document: { id: 'draft-1', revision: 7, title: 'Sensitive draft', phases: [] }, undo: [], redo: [], history: [], selectedId: null, pending: [], redoPending: [], pendingMutationKey: null, componentInsertionKeys: {}, operationKeys: {}, conflict: null }));
    fixture.detectChanges();
    const base = '/v1/workspaces/workspace-1/forms/form-1/authoring/draft-1';
    http.expectOne(base).flush({ formId: 'form-1', draftId: 'draft-1', revision: 7, definition: { title: 'Sensitive draft', pages: [] } });
    http.expectOne(`${base}/history`).flush([]);
    http.expectOne('/v1/workspaces/workspace-1/reusable-components').flush({}, { status: 419, statusText: 'Session expired' });
    http.expectOne(`${base}/theme`).flush({ revision: 7, theme: { preset: 'Certinal', tokens: {} } });
    http.expectOne(`${base}/content`).flush({ revision: 7, guidance: {}, translations: {} });
    http.expectOne(`${base}/comments`).flush([]);
    http.expectOne(`${base}/presence`).flush([]);
    fixture.detectChanges();

    expect(localStorage.getItem(key)).toBeNull();
    expect(fixture.componentInstance.resourceState()).toBe('expired');
    expect(fixture.componentInstance.content()).toEqual({ locale: 'en', translations: {}, guidance: {}, localeReviews: [] });
    expect(fixture.nativeElement.textContent).toContain('Session expired');
  });

  it('refreshes current locale review rows as soon as a revision mutation is accepted', () => {
    fixture.detectChanges();
    const base = '/v1/workspaces/workspace-1/forms/form-1/authoring/draft-1';
    http.expectOne(base).flush({ formId: 'form-1', draftId: 'draft-1', revision: 7, definition: { title: 'Revision refresh', pages: [] } });
    http.expectOne(`${base}/history`).flush([]);
    http.expectOne('/v1/workspaces/workspace-1/reusable-components').flush([]);
    http.expectOne(`${base}/theme`).flush({ revision: 7, theme: { preset: 'Certinal', tokens: {} } });
    http.expectOne(`${base}/content`).flush({ revision: 7, guidance: {}, translations: { hi: { direction: 'ltr', messages: {} } } });
    http.expectOne(`${base}/comments`).flush([]);
    http.expectOne(`${base}/presence`).flush([]);

    fixture.componentInstance.setLocale('hi');
    fixture.componentInstance['acceptRevision']({ id: 'draft-1', revision: 8, title: 'Revision refresh', phases: [], definition: { title: 'Revision refresh', pages: [] } });
    http.expectOne(`${base}/content`).flush({ revision: 8, guidance: {}, translations: { en: { direction: 'ltr', messages: {} }, hi: { direction: 'ltr', messages: {} } }, localeReviews: [{ locale: 'hi', sourceRevision: 8, status: 'DRAFT', reviewedAt: null }] });

    expect(fixture.componentInstance.content().localeReviews?.[0]).toMatchObject({ locale: 'hi', sourceRevision: 8, status: 'DRAFT' });
    expect(fixture.componentInstance.content().locale).toBe('hi');
  });

  it('does not post an empty canonical command batch for a legacy projected draft', () => {
    flushInitial({
      formId: 'form-1',
      title: 'Legacy draft',
      pages: [{ id: 'legacy-page', title: 'Page', fields: [{ id: 'legacy-field', label: 'Legacy field', type: 'text' }] }],
    });

    fixture.componentInstance.addPhase();
    expect(fixture.componentInstance.store.pendingCommands()).toEqual([]);

    // Defense in depth: even a restored/pre-existing empty legacy command must
    // never cross the API boundary as an invalid zero-command batch.
    fixture.componentInstance.store.apply({ type: 'rename', targetId: 'legacy-field', label: 'Renamed legacy field' }, 'legacy-empty-batch-test');
    expect(fixture.componentInstance.store.pendingCommands()[0]?.patches).toEqual([]);
    fixture.componentInstance.save();

    http.expectNone('/v1/workspaces/workspace-1/forms/form-1/authoring/draft-1/commands');
    expect(fixture.componentInstance.store.conflict()).toBeNull();
    expect(fixture.componentInstance.notice()).toContain('legacy package format');
  });

  it('does not misrepresent migration-required rejections as revision conflicts', () => {
    flushInitial({ formId: 'form-1', title: 'Legacy draft', pages: [{ id: 'legacy-page', title: 'Page', fields: [] }] });

    (fixture.componentInstance as unknown as { handleError(error: unknown): void }).handleError(new HttpErrorResponse({
      status: 409,
      error: { code: 'CANONICAL_MIGRATION_REQUIRED' },
    }));

    expect(fixture.componentInstance.store.conflict()).toBeNull();
    expect(fixture.componentInstance.notice()).toContain('legacy package format');
  });

  it('retains both versions only for a real authoring conflict response', () => {
    flushInitial({
      contractVersion: '4.0.0',
      formId: 'form-1',
      title: 'Canonical draft',
      locales: ['en'],
      data: { fields: [] },
      flow: { phases: [] },
      expressions: [],
      translations: { en: { title: 'Canonical draft', messages: {} } },
    });

    (fixture.componentInstance as unknown as { handleError(error: unknown): void }).handleError(new HttpErrorResponse({
      status: 412,
      error: { code: 'AUTHORING_CONFLICT', conflictId: 'conflict-1', revision: 4 },
    }));

    expect(fixture.componentInstance.store.conflict()?.id).toBe('conflict-1');
    expect(fixture.componentInstance.notice()).not.toContain('legacy package format');
  });
});
