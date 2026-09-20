import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiInputComponent } from '@certinal/ui';
import { StaffSessionStore } from '../../core/m5-session.store';
import { AuthorizedDeliveryCopies, SmartIntakeApiService } from '../../smart-intake-api.service';
import { titleCase } from '../../shared/m5-route-state';

type AuthViewState = 'ready' | 'loading' | 'invalid' | 'denied' | 'expired' | 'email-unavailable' | 'throttled' | 'submitted' | 'error';

@Component({
  standalone: true,
  imports: [CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiInputComponent],
  template: `
    <main class="mx-auto max-w-2xl p-6" data-testid="auth-page" [attr.data-state]="state()">
      <cui-card padding="lg">
        <p class="type-caption">SMART INTAKE STAFF</p><h1 class="type-h3">{{ title }}</h1>
        @if (message()) { <cui-alert class="mt-4" [variant]="isError() ? 'error' : 'warning'" [title]="alertTitle()">{{ message() }}</cui-alert> }
        @if (state() === 'loading') { <p class="type-body mt-4">Checking your secure session…</p> }
        @else if (state() === 'submitted') { <p class="type-body mt-4">The request completed. Email delivery may be unavailable in this environment.</p>@if (delivery().activationCopyLink) { <cui-alert class="mt-4" variant="warning" title="Authorized activation link">Deliver this one-time activation link only to the authorized recipient: {{ delivery().activationCopyLink }}</cui-alert> } @if (delivery().recoveryCopyLink) { <cui-alert class="mt-4" variant="warning" title="Authorized recovery link">Deliver this one-time recovery link only to the authorized recipient: {{ delivery().recoveryCopyLink }}</cui-alert> } @if (delivery().temporaryPasswordCopy) { <cui-alert class="mt-4" variant="warning" title="Authorized temporary password">Deliver this temporary password only to the authorized recipient: {{ delivery().temporaryPasswordCopy }}</cui-alert> } }
        @else if (state() !== 'denied' && state() !== 'throttled') {
          @if (screen === 'sign-in') {
            <cui-input class="mt-4" label="Email" type="email" autocomplete="username" [(value)]="email" [error]="fieldError('email')" />
            <cui-input class="mt-4" label="Password" type="password" autocomplete="current-password" [(value)]="password" [error]="fieldError('password')" />
            <cui-button class="mt-5" [disabled]="state() === 'loading'" (buttonClick)="signIn()">Sign in</cui-button>
          } @else if (screen === 'recovery') {
            <cui-input class="mt-4" label="Email" type="email" autocomplete="email" [(value)]="email" [error]="fieldError('email')" />
            <cui-button class="mt-5" [disabled]="state() === 'loading'" (buttonClick)="requestRecovery()">Send recovery instructions</cui-button>
          } @else if (screen === 'setup') {
            <cui-input class="mt-4" label="Owner email" type="email" autocomplete="email" [(value)]="email" [error]="fieldError('email')" />
            <cui-input class="mt-4" label="Password" type="password" autocomplete="new-password" [(value)]="password" [error]="fieldError('password')" />
            <cui-input class="mt-4" label="Organization name" [(value)]="organizationName" />
            <cui-input class="mt-4" label="Workspace name" [(value)]="workspaceName" />
            <cui-input class="mt-4" label="Bootstrap capability" type="password" autocomplete="one-time-code" [(value)]="bootstrapToken" />
            <cui-button class="mt-5" [disabled]="state() === 'loading'" (buttonClick)="bootstrap()">Set up Smart Intake</cui-button>
          } @else {
            <cui-input class="mt-4" label="Activation or reset token" autocomplete="one-time-code" [(value)]="token" [error]="fieldError('token')" />
            <cui-input class="mt-4" label="New password" type="password" autocomplete="new-password" [(value)]="password" [error]="fieldError('password')" />
            @if (screen === 'activation') { <cui-input class="mt-4" label="Display name" autocomplete="name" [(value)]="displayName" /> }
            <cui-button class="mt-5" [disabled]="state() === 'loading'" (buttonClick)="completeCredentialFlow()">{{ screen === 'activation' ? 'Activate account' : 'Set password' }}</cui-button>
          }
        }
        @if (state() === 'expired') { <cui-button class="mt-5" (buttonClick)="retry()">Sign in again</cui-button> }
        @if (state() === 'throttled') { <cui-button class="mt-5" variant="secondary" (buttonClick)="retry()">Try again later</cui-button> }
        <p class="type-caption mt-4">Staff sessions are cookie-based. This browser never stores a staff bearer token.</p>
      </cui-card>
    </main>
  `,
})
export class AuthPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(StaffSessionStore);
  private readonly api = inject(SmartIntakeApiService);
  readonly screen = this.route.snapshot.data['screen'] as 'sign-in' | 'setup' | 'activation' | 'recovery';
  readonly title = titleCase(this.screen);
  readonly state = signal<AuthViewState>(this.route.snapshot.queryParamMap.get('state') as AuthViewState || 'ready');
  readonly message = signal(this.messageFor(this.state()));
  readonly delivery = signal<AuthorizedDeliveryCopies>({});
  email = '';
  password = '';
  token = this.route.snapshot.queryParamMap.get('token') ?? '';
  displayName = '';
  organizationName = '';
  workspaceName = '';
  /** Kept only in this component until the setup request is sent. */
  bootstrapToken = '';

  isError(): boolean { return ['invalid', 'denied', 'throttled', 'error'].includes(this.state()); }
  alertTitle(): string { return this.state() === 'invalid' ? 'Check your details' : this.title; }
  fieldError(field: 'email' | 'password' | 'token'): string | undefined {
    if (this.state() !== 'invalid') return undefined;
    return field === 'email' && !this.email ? 'Enter your email address.' : field === 'password' && !this.password ? 'Enter your password.' : field === 'token' && !this.token ? 'Enter the token from your link.' : undefined;
  }

  signIn(): void {
    if (!this.email || !this.password) { this.show('invalid'); return; }
    this.show('loading');
    this.session.signIn(this.email, this.password).subscribe((state) => {
      if (state === 'authenticated') void this.router.navigateByUrl(this.safeReturnUrl());
      else this.show(state === 'anonymous' || state === 'error' ? 'invalid' : state);
    });
  }

  requestRecovery(): void {
    if (!this.email) { this.show('invalid'); return; }
    this.show('loading');
    this.api.requestRecovery({ email: this.email }).subscribe({ next: (result) => this.showDelivery(result), error: (error) => this.show(this.errorState(error.status)) });
  }

  bootstrap(): void {
    if (!this.email || !this.password) { this.show('invalid'); return; }
    this.show('loading');
    const bootstrapToken = this.bootstrapToken;
    this.bootstrapToken = '';
    this.api.bootstrap({ email: this.email, password: this.password, organizationName: this.organizationName, workspaceName: this.workspaceName, bootstrapToken }).subscribe({
      next: (result) => Object.keys(result).length ? this.showDelivery(result) : this.session.refresh().subscribe((state) => state === 'authenticated'
        ? void this.router.navigateByUrl(this.safeReturnUrl())
        : this.show(state === 'error' || state === 'anonymous' ? 'invalid' : state)),
      error: (error) => this.show(this.errorState(error.status)),
    });
  }

  completeCredentialFlow(): void {
    if (!this.token || !this.password) { this.show('invalid'); return; }
    this.show('loading');
    const request = this.screen === 'activation'
      ? this.api.activate({ activationToken: this.token, password: this.password, displayName: this.displayName })
      : this.api.resetPassword({ resetToken: this.token, newPassword: this.password });
    request.subscribe({ next: (result) => Object.keys(result).length ? this.showDelivery(result) : void this.router.navigate(['/sign-in'], { queryParams: { state: 'ready' } }), error: (error) => this.show(this.errorState(error.status)) });
  }

  retry(): void { this.show('ready'); void this.router.navigate(['/sign-in'], { queryParams: { returnUrl: this.safeReturnUrl() } }); }

  private show(state: AuthViewState): void { this.state.set(state); this.message.set(this.messageFor(state)); }
  private showDelivery(delivery: AuthorizedDeliveryCopies): void { this.delivery.set(delivery); this.show('submitted'); }
  private safeReturnUrl(): string {
    const value = this.route.snapshot.queryParamMap.get('returnUrl') || this.session.returnUrl();
    return value.startsWith('/') && !value.startsWith('//') ? value : '/workspaces/demo/forms';
  }
  private errorState(status: number): AuthViewState { return status === 429 ? 'throttled' : status === 403 ? 'denied' : status === 410 ? 'expired' : status === 503 ? 'email-unavailable' : 'invalid'; }
  private messageFor(state: AuthViewState): string {
    return ({ invalid: 'The supplied details could not be accepted.', denied: 'This account cannot access Smart Intake.', expired: 'Your session or link has expired.', 'email-unavailable': 'Email delivery is unavailable; contact an administrator for the no-email path.', throttled: 'Too many attempts. Wait before trying again.', error: 'The service is unavailable. Try again later.' } as Partial<Record<AuthViewState, string>>)[state] ?? '';
  }
}
