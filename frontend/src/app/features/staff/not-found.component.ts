import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CuiButtonComponent, CuiEmptyStateComponent } from '@certinal/ui';
@Component({ standalone: true, imports: [CuiButtonComponent, CuiEmptyStateComponent], template: '<main class="mx-auto max-w-2xl p-6" data-testid="not-found" [attr.data-state]="state"><p class="type-caption" data-testid="state-evidence">State: {{ state }}</p><cui-empty-state icon="search" [title]="state === \'no-access\' ? \'No access\' : \'Page not found\'" description="This M5 route is unavailable or you do not have access." /><cui-button class="mt-5" (buttonClick)="go()">Return to forms</cui-button></main>' })
export class NotFoundComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly state = this.route.snapshot.queryParamMap.get('state') === 'no-access' ? 'no-access' : 'not-found';
  go(): void { void this.router.navigateByUrl('/workspaces/demo/forms'); }
}
