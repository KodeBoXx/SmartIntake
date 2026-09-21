import { Route, Routes } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from './app.routes';
import { FROZEN_STAFF_SCREENS, REQUIRED_STAFF_STATES } from './features/staff/staff-screen-contract';

function flatten(routes: Routes): Route[] {
  return routes.flatMap((route) => [route, ...flatten(route.children ?? [])]);
}

describe('M5 route architecture', () => {
  it('keeps all M5 feature and shell boundaries lazy', () => {
    const routes = flatten(appRoutes);
    for (const route of routes) {
      if (route.data?.['screen'] || ['catalog/builder', 'not-found'].includes(route.path ?? '') || route.path === '') {
        expect(route.component, `route ${route.path ?? '<root>'} must not eagerly import a component`).toBeUndefined();
        if (!route.redirectTo) expect(route.loadComponent, `route ${route.path ?? '<root>'} must have a lazy boundary`).toBeTypeOf('function');
      }
    }
  });

  it('keeps the guarded M1 compatibility route shell-less', () => {
    const compatibility = appRoutes.find((route) => route.path === 'catalog/builder');
    expect(compatibility?.canActivate).toHaveLength(1);
    expect(compatibility?.loadComponent).toBeTypeOf('function');
    expect(compatibility?.children).toBeUndefined();
  });

  it('keeps staff domains in distinct lazy component boundaries', async () => {
    const staffShell = appRoutes.find((route) => route.path === '' && route.canActivate);
    const staffRoutes = (staffShell?.children ?? []).filter((route) => route.data?.['screen']);
    const componentNames = new Set<string>();
    const expectedComponent = (screen: string, route: Route): string => {
      if (['platform-organizations', 'user-list', 'add-user', 'user-detail', 'role-assignment', 'invitation-delivery'].includes(screen)) return 'AdminStaffPageComponent';
      if (screen === 'catalog') return 'CatalogStaffPageComponent';
      if (['builder', 'preview', 'review-publish'].includes(screen)) return 'AppComponent';
      if (['responses', 'response-detail', 'export-history'].includes(screen)) return 'ResponseStaffPageComponent';
      return 'SettingsStaffPageComponent';
    };
    for (const route of staffRoutes) {
      const component = await route.loadComponent?.();
      if (typeof component === 'function') {
        const name = component.name.replace(/^_/, '');
        componentNames.add(name);
        expect(name, `screen ${route.data?.['screen']} must use its owned domain boundary`).toBe(expectedComponent(route.data?.['screen'], route));
      }
    }
    expect(componentNames).toEqual(new Set(['AdminStaffPageComponent', 'CatalogStaffPageComponent', 'ResponseStaffPageComponent', 'SettingsStaffPageComponent', 'AppComponent']));
  });

  it('maps every frozen staff denominator screen to one explicit lazy route and state contract', () => {
    const screens = flatten(appRoutes).map((route) => route.data?.['screen']).filter((screen): screen is string => FROZEN_STAFF_SCREENS.includes(screen as typeof FROZEN_STAFF_SCREENS[number]));
    expect(new Set(screens)).toEqual(new Set(FROZEN_STAFF_SCREENS));
    expect(REQUIRED_STAFF_STATES).toEqual(['loading', 'empty-or-no-access', 'invalid', 'denied', 'expired', 'email-unavailable']);
    for (const screen of FROZEN_STAFF_SCREENS) {
      const route = flatten(appRoutes).find((candidate) => candidate.data?.['screen'] === screen);
      expect(route?.loadComponent, `${screen} requires its own lazy route behavior`).toBeTypeOf('function');
    }
  });
});
