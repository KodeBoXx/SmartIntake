import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiEmptyStateComponent } from '@certinal/ui';
import { StaffSessionStore } from '../../../core/m5-session.store';
import { hasWorkspaceRole, workspaceRoleContext } from '../../../core/workspace-roles';
import { SmartIntakeApiService } from '../../../smart-intake-api.service';
import { M5_STAFF_DOMAIN } from '../staff-page.component';

type State = 'loading' | 'ready' | 'empty' | 'invalid' | 'denied' | 'expired' | 'no-email' | 'error';
@Component({ selector: 'app-response-staff-page', standalone: true, imports: [CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiEmptyStateComponent], providers: [{ provide: M5_STAFF_DOMAIN, useValue: 'responses' }], template: `
<section class="mx-auto max-w-6xl space-y-5" data-testid="responses-page" [attr.data-state]="state()"><div><p class="type-caption">WORKSPACE RESPONSES</p><h1 class="type-h3">{{ title }}</h1></div>
@if (message()) { <cui-alert [variant]="state() === 'denied' ? 'error' : 'warning'" [title]="state()">{{ message() }}</cui-alert> }
@if (state() === 'loading') { <cui-card><p class="type-body">Loading responses…</p></cui-card> } @else if (state() === 'empty') { <cui-empty-state icon="inbox" title="No responses" description="Responses submitted in this selected workspace appear here." /> } @else if (state() === 'ready') { <cui-card>@for (response of responses(); track response.id) { <div class="border-b border-border-default py-3 last:border-0"><p class="type-body">{{ response.id }}</p><p class="type-caption">{{ response.submittedAt || 'Available' }}</p></div> } @if (screen === 'export-history' && canExport()) { <cui-button class="mt-3" (buttonClick)="loadExports()">Refresh export history</cui-button> }</cui-card> }</section>` })
export class ResponseStaffPageComponent {
  readonly api = inject(SmartIntakeApiService); readonly session = inject(StaffSessionStore); readonly route = inject(ActivatedRoute); readonly screen = this.route.snapshot.data['screen'] as string;
  readonly state = signal<State>('loading'); readonly message = signal(''); readonly responses = signal<{ id: string; submittedAt?: string }[]>([]);
  get title(): string { return this.screen === 'response-detail' ? 'Response detail' : this.screen === 'export-history' ? 'Export history' : 'Responses'; }
  constructor() { this.load(this.screen === 'export-history'); }
  private workspaceContext() {
    const requestedWorkspaceId = this.route.snapshot.paramMap?.get('workspaceId') ?? null;
    if (typeof (this.session as any).organizations !== 'function') {
      const workspace = this.session.currentWorkspace();
      return workspace && (!requestedWorkspaceId || workspace.workspaceId === requestedWorkspaceId)
        ? { workspaceId: workspace.workspaceId, name: workspace.name, roles: this.session.currentRoles() }
        : null;
    }
    return workspaceRoleContext(this.session.organizations(), requestedWorkspaceId, this.session.currentWorkspaceId());
  }
  canView(): boolean { return hasWorkspaceRole(this.workspaceContext()?.roles ?? [], 'response-viewer', 'response-exporter'); }
  canExport(): boolean { return hasWorkspaceRole(this.workspaceContext()?.roles ?? [], 'response-exporter'); }
  loadExports(): void { this.load(true); }
  private load(exports = false): void {
    const workspace = this.workspace();
    if (!workspace) return;
    if (exports ? !this.canExport() : !this.canView()) { this.state.set('denied'); return; }
    if (this.screen === 'response-detail') {
      const submissionId = this.route.snapshot.paramMap.get('submissionId');
      if (!submissionId) { this.state.set('invalid'); return; }
      this.api.responseDetail(workspace, submissionId).subscribe({
        next: (response) => { this.responses.set([{ id: submissionId, submittedAt: (response as { submittedAt?: string }).submittedAt }]); this.state.set('ready'); },
        error: (error) => this.fail(error.status),
      });
      return;
    }
    const request = exports ? this.api.exportResponses(workspace) : this.api.listResponses(workspace);
    request.subscribe({ next: (items) => { this.responses.set(items); this.state.set(items.length ? 'ready' : 'empty'); }, error: (error) => this.fail(error.status) });
  }
  private workspace(): string | null {
    const requested = this.route.snapshot.paramMap.get('workspaceId');
    const context = this.workspaceContext();
    if (requested && !context) {
      this.state.set('denied'); this.message.set('This workspace is not available in your server session.'); return null;
    }
    const workspace = context?.workspaceId ?? null;
    if (!workspace) this.state.set('empty');
    return workspace;
  }
  private fail(status: number): void { this.state.set(status === 403 ? 'denied' : status === 401 || status === 419 || status === 440 ? 'expired' : status === 400 ? 'invalid' : status === 503 ? 'no-email' : 'error'); this.message.set('Responses could not be loaded from this workspace.'); }
}
