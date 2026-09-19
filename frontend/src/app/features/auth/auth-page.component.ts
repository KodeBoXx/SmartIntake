import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiInputComponent } from '@certinal/ui';
import { M5StaffSessionStore } from '../../core/m5-session.store';
import { m5RouteState, titleCase } from '../../shared/m5-route-state';

@Component({
  standalone: true,
  imports: [CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiInputComponent],
  template: `
    <main class="mx-auto max-w-2xl p-6" data-testid="auth-page" [attr.data-state]="state">
      <cui-card padding="lg">
        <p class="type-caption">SMART INTAKE STAFF</p><h1 class="type-h3">{{ title }}</h1>
        <p class="type-caption mt-4" data-testid="state-evidence">State: {{ state }}</p>
        @if (isRestricted) {
          <cui-alert [variant]="state === 'invalid' ? 'error' : 'warning'" [title]="state === 'invalid' ? 'Check your details' : title">{{ message }}</cui-alert>
        }
        @if (state === 'loading') { <p class="type-body">Loading secure sign-in…</p> }
        @else if (state === 'expired') { <cui-button (buttonClick)="continue()">Sign in again</cui-button> }
        @else if (!isRestricted) {
          <cui-input label="Email" type="email" placeholder="you@example.test" />
          <cui-input class="mt-4" label="Password or temporary password" type="password" />
          <cui-button class="mt-5" (buttonClick)="continue()">Continue</cui-button>
        }
        <p class="type-caption mt-4">This M5 screen demonstrates routing only. Real identity, expiry, delivery and role authority arrive in M6.</p>
      </cui-card>
    </main>
  `,
})
export class AuthPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(M5StaffSessionStore);
  readonly screen = this.route.snapshot.data['screen'] as string;
  readonly title = titleCase(this.screen);
  readonly state = m5RouteState(this.route, this.screen === 'setup' ? 'pending' : 'ready');
  get isRestricted(): boolean { return ['invalid', 'expired', 'denied', 'no-access', 'empty-or-no-access', 'email-unavailable', 'throttled'].includes(this.state); }
  get message(): string { return this.state === 'email-unavailable' ? 'Email delivery is unavailable; use the M6 no-email path.' : `${this.title} is ${this.state}.`; }
  continue(): void {
    this.session.setAuthority('authenticated');
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || this.session.returnUrl();
    void this.router.navigateByUrl(returnUrl);
  }
}
