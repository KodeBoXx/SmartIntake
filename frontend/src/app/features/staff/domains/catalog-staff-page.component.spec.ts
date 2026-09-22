import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StaffSessionStore } from '../../../core/m5-session.store';
import { SmartIntakeApiService } from '../../../smart-intake-api.service';
import { CatalogStaffPageComponent } from './catalog-staff-page.component';

const form = { id: 'form-1', formKey: 'clinical', title: 'Clinical intake', status: 'draft', revision: 3, updatedAt: '2026-09-20T00:00:00Z', folderId: null, owner: { id: 'account-1', email: 'owner@example.test' }, tags: [] };

describe('CatalogStaffPageComponent', () => {
  const query = new BehaviorSubject(new Map<string, string | null>());
  const api = {
    catalogForms: vi.fn(() => of({ items: [form], nextCursor: 'cursor-2' })), catalogFolders: vi.fn(() => of([])), catalogTags: vi.fn(() => of([])), effectiveCatalogSettings: vi.fn(() => of({ workspaceId: 'workspace-1', effective: { retention: '30d' }, overrides: { retention: '7d' } })),
    createCatalogFolder: vi.fn(() => of({})), createCatalogTag: vi.fn(() => of({})), duplicateCatalogForm: vi.fn(() => of(form)), archiveCatalogForm: vi.fn(() => of(form)), restoreCatalogForm: vi.fn(() => of(form)), classifyCatalogForm: vi.fn(() => of(void 0)), transferCatalogFormOwnership: vi.fn(() => of(form)), updateCatalogSettings: vi.fn(() => of({ workspaceId: 'workspace-1', effective: {}, overrides: {} })), workspaceMembers: vi.fn(() => of([])),
  };
  const session = { currentOrganizationId: () => null, currentWorkspaceId: () => 'workspace-1', currentWorkspace: () => ({ workspaceId: 'workspace-1', name: 'Clinical', roles: ['workspace-administrator'] }), currentRoles: () => ['workspace-administrator'] };
  const router = { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)) };

  function setup(sessionValue: typeof session = session): ComponentFixture<CatalogStaffPageComponent> {
    api.catalogForms.mockClear();
    router.navigate.mockClear(); router.navigateByUrl.mockClear();
    TestBed.configureTestingModule({ imports: [CatalogStaffPageComponent], providers: [
      { provide: SmartIntakeApiService, useValue: api }, { provide: StaffSessionStore, useValue: sessionValue },
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { snapshot: { data: { screen: 'catalog' } }, queryParamMap: query.asObservable() } },
    ] });
    const fixture = TestBed.createComponent(CatalogStaffPageComponent); fixture.detectChanges(); return fixture;
  }

  it('loads catalog data from the server-selected workspace and preserves the next cursor', () => {
    const fixture = setup();
    expect(api.catalogForms).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ limit: 25 }));
    expect(fixture.componentInstance.forms()).toEqual([form]);
    expect(fixture.componentInstance.nextCursor()).toBe('cursor-2');
    expect(fixture.componentInstance.state()).toBe('ready');
  });

  it('does not treat workspace-administrator as an author', () => {
    const fixture = setup();

    expect(fixture.componentInstance.canEdit()).toBe(false);
    expect(fixture.componentInstance.canManage()).toBe(true);
  });

  it('lets an author create the first form from an empty catalog', () => {
    api.catalogForms.mockReturnValueOnce(of({ items: [], nextCursor: '' }));
    const author = { ...session, currentWorkspace: () => ({ workspaceId: 'workspace-1', name: 'Clinical', roles: ['author'] }), currentRoles: () => ['author'] };
    const fixture = setup(author);

    expect(fixture.componentInstance.state()).toBe('empty');
    expect(fixture.componentInstance.canEdit()).toBe(true);
    const button = [...fixture.nativeElement.querySelectorAll('button')].find((candidate: HTMLButtonElement) => candidate.textContent?.includes('Create form')) as HTMLButtonElement;
    expect(button).toBeTruthy();
    fixture.componentInstance.createForm();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/workspaces/workspace-1/forms/new');
  });

  it('opens a deep-linked detail drawer and maps forbidden catalog access to denied', () => {
    const fixture = setup(); const component = fixture.componentInstance;
    component.openDetails('form-1');
    expect(component.detailId()).toBe('form-1');
    expect(component.detailOpen()).toBe(true);
    api.catalogForms.mockReturnValueOnce(throwError(() => ({ status: 403 })));
    component.load();
    expect(component.state()).toBe('denied');
  });

  it('loads after the server-authoritative session finishes hydrating', () => {
    const hydrated = {
      state: signal('loading'), organizations: signal<any[]>([]), currentWorkspaceId: signal<string | null>(null),
      currentOrganizationId: signal<string | null>(null), currentWorkspace: () => null, currentRoles: () => [],
    };
    api.catalogForms.mockClear();
    TestBed.configureTestingModule({ imports: [CatalogStaffPageComponent], providers: [
      { provide: SmartIntakeApiService, useValue: api }, { provide: StaffSessionStore, useValue: hydrated },
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { snapshot: { data: { screen: 'catalog' }, queryParamMap: new Map(), paramMap: new Map([['workspaceId', 'workspace-1']]) }, queryParamMap: query.asObservable() } },
    ] });
    const fixture = TestBed.createComponent(CatalogStaffPageComponent); fixture.detectChanges();
    expect(api.catalogForms).not.toHaveBeenCalled();
    hydrated.organizations.set([{ organizationId: 'organization-1', name: 'One', organizationRoles: [], workspaces: [{ workspaceId: 'workspace-1', name: 'Clinical', roles: ['workspace-administrator'] }] }]);
    hydrated.currentWorkspaceId.set('workspace-1'); hydrated.state.set('authenticated'); fixture.detectChanges();
    expect(api.catalogForms).toHaveBeenCalledWith('workspace-1', expect.objectContaining({ limit: 25 }));
    expect(fixture.componentInstance.state()).toBe('ready');
  });
});
