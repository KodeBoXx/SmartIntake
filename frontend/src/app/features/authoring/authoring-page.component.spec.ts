import { provideHttpClient } from '@angular/common/http';
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
});
