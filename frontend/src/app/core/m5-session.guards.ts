import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { M5StaffSessionStore } from './m5-session.store';

/** M5 routing guard only; M6 replaces this stub with server-authoritative checks. */
export const m5StaffGuard: CanActivateFn = (route, state) => {
  const store = inject(M5StaffSessionStore);
  const router = inject(Router);
  const requested = route.queryParamMap.get('m5Auth');
  if (requested === 'anonymous' || requested === 'expired' || requested === 'denied') store.setAuthority(requested);
  if (store.isAuthenticated()) return true;
  const returnTree = router.parseUrl(state.url);
  delete returnTree.queryParams['m5Auth'];
  const returnUrl = router.serializeUrl(returnTree);
  store.rememberReturnUrl(returnUrl);
  return router.createUrlTree(['/sign-in'], { queryParams: { returnUrl, state: store.authority() } });
};

export const m5AnonymousOnlyGuard: CanActivateFn = () => {
  const store = inject(M5StaffSessionStore);
  const router = inject(Router);
  return store.isAuthenticated() ? router.createUrlTree(['/workspaces/demo/forms']) : true;
};
