import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StaffSessionStore } from '../../core/m5-session.store';
import { SmartIntakeApiService } from '../../smart-intake-api.service';
import { AuthPageComponent, authViewState } from './auth-page.component';

describe('AuthPageComponent', () => {
  it('maps guard and unknown query states to the interactive sign-in state', () => {
    expect(authViewState('anonymous')).toBe('ready');
    expect(authViewState('unknown')).toBe('ready');
    expect(authViewState(null)).toBe('ready');
    expect(authViewState('expired')).toBe('expired');
  });

  it('redirects a fresh sign-in to the server-selected workspace', () => {
    const router = { navigateByUrl: vi.fn(() => Promise.resolve(true)) };
    const session = {
      signIn: vi.fn(() => of('authenticated')),
      currentWorkspaceId: vi.fn(() => 'workspace-live'),
    };
    TestBed.configureTestingModule({ imports: [AuthPageComponent], providers: [
      { provide: Router, useValue: router },
      { provide: StaffSessionStore, useValue: session },
      { provide: SmartIntakeApiService, useValue: {} },
      { provide: ActivatedRoute, useValue: { snapshot: {
        data: { screen: 'sign-in' },
        paramMap: { get: () => null },
        queryParamMap: { get: () => null },
      } } },
    ] });
    const component = TestBed.createComponent(AuthPageComponent).componentInstance;
    component.email = 'owner@example.test'; component.password = 'pässword-漢字-12345';
    component.signIn();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/workspaces/workspace-live/forms');
  });

  it('preserves an explicit safe protected return URL', () => {
    const router = { navigateByUrl: vi.fn(() => Promise.resolve(true)) };
    const session = { signIn: vi.fn(() => of('authenticated')), currentWorkspaceId: vi.fn(() => 'workspace-live') };
    TestBed.configureTestingModule({ imports: [AuthPageComponent], providers: [
      { provide: Router, useValue: router }, { provide: StaffSessionStore, useValue: session },
      { provide: SmartIntakeApiService, useValue: {} },
      { provide: ActivatedRoute, useValue: { snapshot: {
        data: { screen: 'sign-in' }, paramMap: { get: () => null },
        queryParamMap: { get: (name: string) => name === 'returnUrl' ? '/users' : null },
      } } },
    ] });
    const component = TestBed.createComponent(AuthPageComponent).componentInstance;
    component.email = 'owner@example.test'; component.password = 'pässword-漢字-12345'; component.signIn();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/users');
  });
});
