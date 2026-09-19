import { Route, Routes } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from './app.routes';

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
});
