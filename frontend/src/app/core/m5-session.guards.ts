import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { StaffSessionStore } from './m5-session.store';

export const staffSessionGuard: CanActivateFn = (_route, state) => {
  const store = inject(StaffSessionStore);
  const router = inject(Router);
  return store.ensureLoaded().pipe(map((authority) => {
    if (authority === 'authenticated') return true;
    const returnUrl = state.url.startsWith('/') && !state.url.startsWith('//') ? state.url : '/workspaces/demo/forms';
    store.rememberReturnUrl(returnUrl);
    return router.createUrlTree(['/sign-in'], { queryParams: { returnUrl, state: authority } });
  }));
};

export const anonymousOnlyGuard: CanActivateFn = () => {
  const store = inject(StaffSessionStore);
  const router = inject(Router);
  return store.ensureLoaded().pipe(map((authority) => authority === 'authenticated'
    ? router.createUrlTree([store.returnUrl()])
    : true));
};
