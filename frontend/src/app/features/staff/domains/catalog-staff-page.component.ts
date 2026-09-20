import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiConfirmDialogComponent, CuiDrawerComponent, CuiEmptyStateComponent, CuiInputComponent, CuiSelectComponent, CuiTagComponent } from '@certinal/ui';
import { StaffSessionStore } from '../../../core/m5-session.store';
import { hasWorkspaceRole, workspaceRoleContext } from '../../../core/workspace-roles';
import { CatalogForm, CatalogSettings, SmartIntakeApiService } from '../../../smart-intake-api.service';
import { Observable } from 'rxjs';
import { M5_STAFF_DOMAIN } from '../staff-page.component';

type CatalogState = 'loading' | 'ready' | 'empty' | 'invalid' | 'denied' | 'expired' | 'no-email' | 'error';

@Component({
  selector: 'app-catalog-staff-page', standalone: true,
  imports: [CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiConfirmDialogComponent, CuiDrawerComponent, CuiEmptyStateComponent, CuiInputComponent, CuiSelectComponent, CuiTagComponent],
  providers: [{ provide: M5_STAFF_DOMAIN, useValue: 'catalog' }],
  template: `
<section class="mx-auto max-w-6xl space-y-5" data-testid="catalog-page" [attr.data-state]="state()">
  <div class="flex flex-wrap items-end justify-between gap-3"><div><p class="type-caption">WORKSPACE {{ screen().toUpperCase() }}</p><h1 class="type-h3">{{ screenTitle() }}</h1><p class="type-caption">{{ workspaceContext()?.name || 'No selected workspace' }}</p></div>@if (screen() === 'catalog') { <cui-button [disabled]="!canEdit()" (buttonClick)="createForm()">Create form</cui-button> }</div>
  @if (message()) { <cui-alert [variant]="state() === 'invalid' || state() === 'denied' ? 'error' : 'warning'" [title]="state()">{{ message() }}</cui-alert> }
  @if (state() === 'loading') { <cui-card><p class="type-body">Loading the server-authorized catalog…</p></cui-card> }
  @else if (state() === 'empty') { <cui-empty-state icon="inbox" title="No forms found" description="Try changing the filters or create the first form in this workspace." /> }
  @else if (state() === 'ready') {
    @if (screen() !== 'catalog') { <cui-card><p class="type-body">{{ workflowDescription() }}</p>@if (screen() === 'builder') { <cui-button class="mt-3" [disabled]="!canEdit()" (buttonClick)="openLegacyBuilder()">Open authoring builder</cui-button> } @else if (screen() === 'review-publish') { <cui-button class="mt-3" [disabled]="!canPublish()" (buttonClick)="publishFromReview()">Publish reviewed form</cui-button> } @else { <cui-button class="mt-3" variant="secondary" (buttonClick)="openLegacyBuilder()">Open draft</cui-button> }</cui-card> }
    @else {
    <cui-card><div class="grid gap-3 md:grid-cols-4"><cui-input label="Search" type="search" [(value)]="query" /><cui-select label="Status" [options]="statusOptions" [(value)]="status" /><cui-select label="Folder" [options]="folderOptions()" [(value)]="folder" /><cui-select label="Tag" [options]="tagOptions()" [(value)]="tag" /></div><div class="mt-3 flex flex-wrap gap-2"><cui-button size="sm" variant="secondary" (buttonClick)="applyFilters()">Apply filters</cui-button><cui-button size="sm" variant="tertiary" (buttonClick)="resetFilters()">Clear filters</cui-button><cui-button size="sm" variant="tertiary" (buttonClick)="loadMetadata()">Manage folders and tags</cui-button></div></cui-card>
    <cui-card><div class="space-y-3">@for (form of forms(); track form.id) { <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border-default pb-3 last:border-0 last:pb-0"><button class="text-left" (click)="openDetails(form.id)"><p class="type-body">{{ form.title }}</p><p class="type-caption">{{ form.formKey }} · {{ form.owner?.email || 'No owner' }} · {{ form.updatedAt }}</p></button><div class="flex flex-wrap items-center gap-2"><cui-tag tone="emerald">{{ form.status }}</cui-tag>@for (itemTag of form.tags; track itemTag.id) { <cui-tag tone="cyan">{{ itemTag.name }}</cui-tag> }<cui-button size="sm" variant="secondary" (buttonClick)="openDetails(form.id)">View</cui-button></div></div> }</div>@if (nextCursor()) { <cui-button class="mt-4" variant="secondary" (buttonClick)="nextPage()">Next page</cui-button> }</cui-card>
    <cui-card><p class="type-body">Catalog organization</p><div class="mt-3 grid gap-3 md:grid-cols-2"><cui-input label="New folder" [(value)]="folderName" /><cui-input label="New tag" [(value)]="tagName" /></div><div class="mt-3 flex gap-2"><cui-button size="sm" variant="secondary" [disabled]="!canEdit()" (buttonClick)="createFolder()">Add folder</cui-button><cui-button size="sm" variant="secondary" [disabled]="!canEdit()" (buttonClick)="createTag()">Add tag</cui-button></div></cui-card>
    <cui-card><p class="type-body">Effective policy and provider settings</p><p class="type-caption">Effective values are read-only. Saving below changes only this workspace override.</p><cui-input class="mt-3" label="Effective policy" type="textarea" [(value)]="policyJson" [disabled]="true" /><cui-input class="mt-3" label="Effective providers" type="textarea" [(value)]="providerJson" [disabled]="true" /><cui-input class="mt-3" label="Workspace policy override" type="textarea" [(value)]="overridePolicyJson" /><cui-input class="mt-3" label="Workspace provider override" type="textarea" [(value)]="overrideProviderJson" /><cui-button class="mt-3" [disabled]="!canManage()" (buttonClick)="saveSettings()">Save workspace overrides</cui-button></cui-card>
    }
  }
</section>
<cui-confirm-dialog [(open)]="archiveOpen" title="Archive form?" message="Archived forms are retained and can be restored." tone="danger" icon="trash-2" confirmText="Archive" (confirmed)="archiveSelected()" />
<cui-drawer [(open)]="detailOpen" (closed)="closeDetails()" position="right" size="lg" [title]="selected()?.title || 'Form details'">
  @if (selected(); as form) { <div class="space-y-4"><div><p class="type-body">{{ form.title }}</p><p class="type-caption">Owner: {{ form.owner?.email || 'Unassigned' }}</p></div>@if (canEdit()) { <cui-select label="Folder" [options]="folderOptions()" [(value)]="detailFolder" /><cui-select label="Tag" [options]="tagOptions()" [(value)]="detailTag" /><div class="flex flex-wrap gap-2"><cui-button size="sm" variant="secondary" (buttonClick)="classifySelected()">Save classification</cui-button><cui-button size="sm" variant="secondary" (buttonClick)="duplicateSelected()">Duplicate</cui-button>@if (form.status.toLowerCase() === 'archived') { <cui-button size="sm" (buttonClick)="restoreSelected()">Restore</cui-button> } @else { <cui-button size="sm" variant="danger" (buttonClick)="archiveOpen = true">Archive</cui-button> }</div> } @if (canManage()) { <cui-select label="Transfer ownership to workspace member" [options]="memberOptions()" [(value)]="ownerAccountId" /><cui-button size="sm" variant="tertiary" (buttonClick)="transferSelected()">Transfer ownership</cui-button> }</div> }
  <div cuiDrawerFooter class="flex justify-end"><cui-button variant="tertiary" (buttonClick)="closeDetails()">Close</cui-button></div>
</cui-drawer>`
})
export class CatalogStaffPageComponent {
  readonly api = inject(SmartIntakeApiService); readonly session = inject(StaffSessionStore); readonly route = inject(ActivatedRoute); readonly router = inject(Router);
  readonly state = signal<CatalogState>('loading'); readonly message = signal(''); readonly forms = signal<CatalogForm[]>([]); readonly folders = signal<{ id: string; name: string }[]>([]); readonly tags = signal<{ id: string; name: string }[]>([]); readonly nextCursor = signal('');
  readonly detailId = signal<string | null>(null); readonly detailOpen = signal(false); readonly selected = computed(() => this.forms().find((form) => form.id === this.detailId()) ?? null); readonly screen = signal(this.route.snapshot.data['screen'] as string);
  readonly folderOptions = computed(() => [{ label: 'All folders', value: '' }, ...this.folders().map((folder) => ({ label: folder.name, value: folder.id }))]); readonly tagOptions = computed(() => [{ label: 'All tags', value: '' }, ...this.tags().map((tag) => ({ label: tag.name, value: tag.id }))]);
  readonly statusOptions = [{ label: 'All statuses', value: '' }, ...['draft', 'published', 'archived'].map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value }))]; readonly memberOptions = signal<{ label: string; value: string }[]>([]);
  query = ''; status: string | null = ''; folder: string | null = ''; tag: string | null = ''; folderName = ''; tagName = ''; detailFolder: string | null = ''; detailTag: string | null = ''; ownerAccountId = ''; policyJson = '{}'; providerJson = '{}'; overridePolicyJson = '{}'; overrideProviderJson = '{}'; archiveOpen = false;

  constructor() { this.route.queryParamMap.subscribe((params) => { const details = params.get('details'); this.detailId.set(details); this.detailOpen.set(!!details); }); this.loadMetadata(); this.load(); }
  workspaceContext() {
    const requestedWorkspaceId = this.route.snapshot.paramMap?.get('workspaceId') ?? null;
    if (typeof (this.session as any).organizations !== 'function') {
      const workspace = this.session.currentWorkspace();
      return workspace && (!requestedWorkspaceId || workspace.workspaceId === requestedWorkspaceId)
        ? { workspaceId: workspace.workspaceId, name: workspace.name, roles: this.session.currentRoles() }
        : null;
    }
    return workspaceRoleContext(this.session.organizations(), requestedWorkspaceId, this.session.currentWorkspaceId());
  }
  canEdit(): boolean { return hasWorkspaceRole(this.workspaceContext()?.roles ?? [], 'author', 'workspace-administrator'); }
  canPublish(): boolean { return hasWorkspaceRole(this.workspaceContext()?.roles ?? [], 'publisher'); }
  canManage(): boolean { return hasWorkspaceRole(this.workspaceContext()?.roles ?? [], 'workspace-administrator'); }
  screenTitle(): string { return ({ catalog: 'Forms', builder: 'Form builder', preview: 'Form preview', 'review-publish': 'Review and publish' } as Record<string, string>)[this.screen()] ?? 'Forms'; }
  workflowDescription(): string { return ({ builder: 'Author, import, and save the selected draft.', preview: 'Preview the selected draft without changing its publication state.', 'review-publish': 'Review the selected draft before publication.' } as Record<string, string>)[this.screen()] ?? 'This workflow is not available.'; }
  applyFilters(): void { this.load(); }
  resetFilters(): void { this.query = ''; this.status = ''; this.folder = ''; this.tag = ''; this.load(); }
  nextPage(): void { this.load(this.nextCursor(), true); }
  load(cursor = '', append = false): void { const workspace = this.workspace(); if (!workspace) return; this.state.set('loading'); this.api.catalogForms(workspace, { q: this.query, status: this.status || undefined, folder: this.folder || undefined, tag: this.tag ? [this.tag] : undefined, cursor: cursor || undefined, limit: 25 }).subscribe({ next: (page) => { this.forms.set(append ? [...this.forms(), ...page.items] : page.items); this.nextCursor.set(page.nextCursor || ''); this.state.set(this.forms().length ? 'ready' : 'empty'); }, error: (error) => this.fail(error.status) }); }
  loadMetadata(): void { const workspace = this.workspace(); if (!workspace) return; this.api.catalogFolders(workspace).subscribe({ next: (folders) => this.folders.set(folders), error: (error) => this.fail(error.status) }); this.api.catalogTags(workspace).subscribe({ next: (tags) => this.tags.set(tags), error: (error) => this.fail(error.status) }); if (!this.canManage()) return; this.api.effectiveCatalogSettings(workspace).subscribe({ next: (settings) => this.applySettings(settings), error: (error) => this.fail(error.status) }); this.api.workspaceMembers(workspace).subscribe({ next: (members) => this.memberOptions.set(members.map((member) => ({ label: member.displayName || member.email || member.accountId, value: member.accountId }))), error: (error) => this.fail(error.status) }); }
  openDetails(id: string): void { this.detailId.set(id); this.detailOpen.set(true); const form = this.selected(); this.detailFolder = form?.folderId ?? ''; this.detailTag = form?.tags[0]?.id ?? ''; void this.router.navigate([], { relativeTo: this.route, queryParams: { details: id }, queryParamsHandling: 'merge' }); }
  closeDetails(): void { this.detailOpen.set(false); this.detailId.set(null); void this.router.navigate([], { relativeTo: this.route, queryParams: { details: null }, queryParamsHandling: 'merge' }); }
  createFolder(): void { const workspace = this.workspace(); if (!workspace || !this.folderName.trim()) return this.invalid('Enter a folder name.'); this.api.createCatalogFolder(workspace, this.folderName.trim()).subscribe({ next: () => { this.folderName = ''; this.loadMetadata(); }, error: (error) => this.fail(error.status) }); }
  createTag(): void { const workspace = this.workspace(); if (!workspace || !this.tagName.trim()) return this.invalid('Enter a tag name.'); this.api.createCatalogTag(workspace, this.tagName.trim()).subscribe({ next: () => { this.tagName = ''; this.loadMetadata(); }, error: (error) => this.fail(error.status) }); }
  duplicateSelected(): void { this.mutate((workspace, form) => this.api.duplicateCatalogForm(workspace, form.id), 'Form duplicated.'); }
  archiveSelected(): void { this.archiveOpen = false; this.mutate((workspace, form) => this.api.archiveCatalogForm(workspace, form.id), 'Form archived.'); }
  restoreSelected(): void { this.mutate((workspace, form) => this.api.restoreCatalogForm(workspace, form.id), 'Form restored.'); }
  classifySelected(): void { this.mutate((workspace, form) => this.api.classifyCatalogForm(workspace, form.id, { folderId: this.detailFolder || null, tagIds: this.detailTag ? [this.detailTag] : [] }), 'Classification saved.'); }
  transferSelected(): void { if (!this.canManage()) return; if (!this.ownerAccountId.trim()) return this.invalid('Choose a workspace member.'); const workspace = this.workspace(); const form = this.selected(); if (!workspace || !form) return; this.api.transferCatalogFormOwnership(workspace, form.id, this.ownerAccountId.trim()).subscribe({ next: () => { this.message.set('Ownership transferred.'); this.load(); }, error: (error) => this.fail(error.status) }); }
  createForm(): void { const workspace = this.workspace(); if (workspace) void this.router.navigateByUrl(`/workspaces/${workspace}/forms/new`); }
  openLegacyBuilder(): void { this.createForm(); }
  publishFromReview(): void { this.message.set('Publish this form from its workspace-scoped review route.'); }
  saveSettings(): void { const workspace = this.workspace(); if (!workspace) return; try { const policyOverrides = JSON.parse(this.overridePolicyJson); const providerOverrides = JSON.parse(this.overrideProviderJson); this.api.updateCatalogSettings(workspace, { policyOverrides, providerOverrides }).subscribe({ next: (settings) => { this.applySettings(settings); this.message.set('Workspace overrides saved.'); }, error: (error) => this.fail(error.status) }); } catch { this.invalid('Workspace overrides must be valid JSON objects.'); } }
  private mutate(request: (workspace: string, form: CatalogForm) => Observable<unknown>, success: string): void { const workspace = this.workspace(); const form = this.selected(); if (!workspace || !form || !this.canEdit()) return; request(workspace, form).subscribe({ next: () => { this.message.set(success); this.load(); }, error: (error) => this.fail(error.status) }); }
  private applySettings(settings: CatalogSettings): void { this.policyJson = JSON.stringify(settings.effective.policy, null, 2); this.providerJson = JSON.stringify(settings.effective.providers, null, 2); this.overridePolicyJson = JSON.stringify(settings.overrides.policy, null, 2); this.overrideProviderJson = JSON.stringify(settings.overrides.providers, null, 2); }
  private workspace(): string | null { const context = this.workspaceContext(); if (!context) { this.state.set(this.route.snapshot.paramMap.get('workspaceId') ? 'denied' : 'empty'); this.message.set(this.route.snapshot.paramMap.get('workspaceId') ? 'This workspace is not available in your server session.' : 'Select a server-authorized workspace first.'); return null; } return context.workspaceId; }
  private invalid(message: string): void { this.state.set('invalid'); this.message.set(message); }
  private fail(status: number): void { const state: CatalogState = status === 400 || status === 422 ? 'invalid' : status === 403 ? 'denied' : status === 401 || status === 419 || status === 440 ? 'expired' : status === 503 ? 'no-email' : 'error'; this.state.set(state); this.message.set(state === 'no-email' ? 'Email delivery is unavailable; use the copy-link path.' : 'The server could not complete this catalog request.'); }
}
