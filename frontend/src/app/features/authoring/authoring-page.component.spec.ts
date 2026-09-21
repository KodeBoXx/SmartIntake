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
});
