import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class StaffCsrfContext {
  readonly token = signal<string | null>(null);
  set(token: string | null): void { this.token.set(token); }
}

/** Applies only to same-origin staff mutations; respondent-secret transport is untouched. */
export const staffCsrfInterceptor: HttpInterceptorFn = (request, next) => {
  const context = inject(StaffCsrfContext);
  const isStaffMutation = request.url.startsWith('/v1/')
    && !request.url.startsWith('/v1/public/')
    && !request.url.startsWith('/v1/sessions/')
    && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    && request.url !== '/v1/auth/sign-in'
    && request.url !== '/v1/auth/recovery'
    && request.url !== '/v1/auth/activate'
    && request.url !== '/v1/auth/reset';
  const token = context.token() ?? document.cookie.split('; ').find((entry) => entry.startsWith('SI_CSRF='))?.split('=')[1] ?? null;
  return next(isStaffMutation && token
    ? request.clone({ withCredentials: true, setHeaders: { 'X-CSRF-Token': token } })
    : request.clone({ withCredentials: request.url.startsWith('/v1/') && !request.url.startsWith('/v1/sessions/') }));
};
