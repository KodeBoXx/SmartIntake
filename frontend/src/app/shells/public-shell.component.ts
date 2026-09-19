import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { CuiCardComponent } from '@certinal/ui';

@Component({
  standalone: true,
  imports: [RouterOutlet, RouterLink, CuiCardComponent],
  template: `
    <div class="min-h-screen" data-testid="public-shell">
      <header class="mx-auto max-w-2xl p-4"><cui-card padding="sm"><a routerLink="/f/demo" class="type-h4">SmartIntake</a><span class="type-caption"> · Secure form</span></cui-card></header>
      <main class="mx-auto max-w-2xl p-6"><router-outlet /></main>
    </div>
  `,
})
export class PublicShellComponent {}
