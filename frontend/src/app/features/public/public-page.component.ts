import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiEmptyStateComponent, CuiInputComponent } from '@certinal/ui';
import { M5StubState } from '../../core/m5-session.store';
import { m5RouteState, titleCase } from '../../shared/m5-route-state';

@Component({
  standalone: true,
  imports: [CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiEmptyStateComponent, CuiInputComponent],
  template: `
    <section data-testid="public-page" [attr.data-state]="state"><cui-card padding="lg"><p class="type-caption">PUBLIC FORM</p><h1 class="type-h3">{{ title }}</h1><p class="type-caption" data-testid="state-evidence">State: {{ state }}</p>
      @if (state === 'closed' || state === 'expired') { <cui-empty-state icon="shield" [title]="state === 'closed' ? 'This form is closed' : 'This link has expired'" [description]="message" /> }
      @else if (state === 'offline' || state === 'stale' || state === 'invalid') { <cui-alert variant="warning" [title]="state">{{ message }}</cui-alert> }
      @else if (state === 'failed') { <cui-alert variant="error" title="Submission failed">{{ message }}</cui-alert> }
      @else if (screen === 'receipt') { <cui-alert [variant]="state === 'succeeded' ? 'success' : 'info'" title="Receipt {{ state }}">{{ message }}</cui-alert> }
      @else { <cui-input label="Example answer" placeholder="M5 route stub" /><cui-button class="mt-5">{{ state === 'start' ? 'Start form' : 'Continue' }}</cui-button> }
    </cui-card></section>
  `,
})
export class PublicPageComponent {
  private readonly route = inject(ActivatedRoute);
  readonly screen = this.route.snapshot.data['screen'] as string;
  readonly title = titleCase(this.screen);
  readonly state: M5StubState = m5RouteState(this.route, this.screen === 'receipt' ? 'pending' : 'ready');
  get message(): string { return `${this.title} is ${this.state}; real respondent session behavior remains M8.`; }
}
