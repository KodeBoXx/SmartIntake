import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CuiButtonComponent, CuiEmptyStateComponent } from '@certinal/ui';
@Component({ standalone: true, imports: [CuiButtonComponent, CuiEmptyStateComponent], template: '<main class="mx-auto max-w-2xl p-6" data-testid="not-found"><cui-empty-state icon="search" title="Page not found" description="This M5 route is unavailable or you do not have access." /><cui-button class="mt-5" (buttonClick)="go()">Return to forms</cui-button></main>' })
export class NotFoundComponent { constructor(private readonly router: Router) {} go(): void { void this.router.navigateByUrl('/workspaces/demo/forms'); } }
