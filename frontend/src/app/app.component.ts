import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppToolbarComponent } from './app-toolbar.component';
import {
  addOption,
  addRepeaterItem,
  createField,
  createPage,
  moveItem,
  normalizeField,
  removeAt,
  requirednessRule,
  updatePage,
  visibilityRule,
} from './editor-state.helpers';
import { FIELD_TYPES, Field, FormDefinition, RepeaterItem, ResponseSummary, createDefaultDefinition } from './models/form-definition.models';
import { CurrentDraft, FormSummary, GovernanceReview, SmartIntakeApiService } from './smart-intake-api.service';
import { StaffSessionStore } from './core/m5-session.store';
import { hasWorkspaceRole, workspaceRoleContext } from './core/workspace-roles';

type DraftViewState = 'loading' | 'ready' | 'empty-or-no-access' | 'invalid' | 'denied' | 'expired' | 'email-unavailable';
type DraftFailureState = Exclude<DraftViewState, 'loading' | 'ready'>;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AppToolbarComponent, CommonModule, FormsModule],
  template: `
<header class="border-b border-stone-200 bg-white"><div class="mx-auto flex max-w-7xl items-center justify-between px-5 py-4"><div><p class="type-caption-bold text-emerald-700">SMART INTAKE</p><h1 class="type-h3">Form Builder Lite</h1></div><span class="type-caption">Cookie-authenticated staff session</span></div></header>
<main class="mx-auto max-w-7xl px-5 py-6">
<nav appToolbar class="mb-5 flex w-full flex-wrap gap-2" [authorAllowed]="canAuthor()" [publicationAllowed]="false" [responseViewerAllowed]="canViewResponses()" [responseExporterAllowed]="canExportResponses()" [saveDisabled]="editorLocked()" [publishDisabled]="publishLocked()" [publishLabel]="governanceActionLabel()" [importDisabled]="editorLocked()" (author)="openAuthoring()" (preview)="startPreview()" (save)="save()" (publish)="publish()" (definitionExport)="exportDefinition()" (definitionImport)="importDefinition($event)" (responsesExport)="exportResponses()" (responseAdmin)="loadResponses()"></nav>
<p *ngIf="message()" class="notice" role="status">{{message()}}</p>
<section *ngIf="reviewSnapshot()" class="card mb-5" aria-labelledby="review-diff-title"><h2 id="review-diff-title" class="type-h4">Publication review changes</h2><pre class="mt-2 overflow-auto text-xs">{{reviewSnapshot()|json}}</pre></section>
<section *ngIf="formId && canGovernPublication()" class="card mb-5" aria-labelledby="publication-actions-title"><h2 id="publication-actions-title" class="type-h4">Publication actions</h2><p class="type-caption">Each governed step requires a separate explicit action.</p><div class="mt-3 flex flex-wrap gap-2"><button *ngIf="canAuthor() && !reviewMatchesDraft()" class="pill" [disabled]="publishLocked()" (click)="requestReviewAction()">Request review</button><button *ngIf="canReview() && governanceReview()?.state==='OPEN'" class="pill" [disabled]="!reviewSnapshot() || publishLocked()" (click)="approveReviewAction()">Approve inspected review</button><button *ngIf="canPublish() && governanceReview()?.state==='APPROVED'" class="pill primary" [disabled]="publishLocked()" (click)="publishReviewAction()">Publish approved review</button></div></section>
<section *ngIf="releases().length && canPublish()" class="card mb-5" aria-labelledby="release-governance-title"><h2 id="release-governance-title" class="type-h4">Release governance</h2><label class="label">Release<select [(ngModel)]="selectedReleaseId"><option *ngFor="let release of releases()" [value]="release.releaseId">v{{release.version}} · {{release.state}} · {{release.releaseId}}</option></select></label><div class="mt-3 flex flex-wrap gap-2"><button class="pill" (click)="confirmTransition('activate')">Activate</button><button class="pill" (click)="confirmTransition('rollback')">Rollback</button><button class="pill" (click)="confirmTransition('retire')">Retire</button><button class="pill danger" (click)="confirmTransition('emergency-close')">Emergency close</button></div><div class="mt-4 grid gap-2 md:grid-cols-3"><label class="label">Channel type<select [(ngModel)]="shareChannelType"><option value="LINK">Link</option><option value="QR">QR</option><option value="IFRAME">Iframe</option></select></label><label class="label">Opens at<input type="datetime-local" [(ngModel)]="shareOpensAt"></label><label class="label">Closes at<input type="datetime-local" [(ngModel)]="shareClosesAt"></label><label class="label">Response cap<input type="number" min="1" [(ngModel)]="shareResponseCap"></label><label *ngIf="shareChannelType==='IFRAME'" class="label">Allowed HTTPS parent origin<input [(ngModel)]="shareParentOrigin" placeholder="https://forms.example.com"></label></div><button class="pill mt-3" (click)="createShareChannel()">Create channel</button><div *ngIf="channels().length" class="mt-4"><label class="label">Existing channel<select [(ngModel)]="selectedChannelId"><option *ngFor="let channel of channels()" [value]="channel.channelId">{{channel.type}} · {{channel.state}} · {{channel.channelId}}</option></select></label><p class="type-caption break-all">{{selectedChannelOutput()}}</p><button class="pill danger mt-2" (click)="confirmRevokeChannel()">Revoke selected channel</button></div></section>
<section *ngIf="draftState() !== 'ready'" class="card" data-testid="draft-state" [attr.data-state]="draftState()" role="status"><p *ngIf="draftState() === 'loading'">Loading saved draft…</p><ng-container *ngIf="draftState() !== 'loading'"><h2 class="type-h4">{{draftStateTitle()}}</h2><p>{{draftStateMessage()}}</p><button class="pill mt-3" (click)="retryDraftRehydration()">Retry saved draft</button></ng-container></section>
<section *ngIf="draftState() === 'ready' && mode()==='editor'" class="grid gap-5 lg:grid-cols-[15rem_1fr_19rem]"><aside class="card"><p class="type-label">PAGES</p><button *ngFor="let page of definition().pages;let i=index" class="outline" [class.active]="pageIndex()===i" (click)="selectPage(i)">{{i+1}}. {{page.title}}</button><button *ngIf="canAuthor()" class="pill" [disabled]="editorLocked()" (click)="addPage()">+ Page</button><hr><p class="type-label">FIELDS</p><button *ngFor="let f of page().fields;let i=index" class="outline" [class.active]="fieldIndex()===i" (click)="fieldIndex.set(i)">{{f.label}}</button><button *ngIf="canAuthor()" class="pill" [disabled]="editorLocked()" (click)="addField('text')">+ Field</button></aside>
<div class="card"><div class="flex items-center justify-between"><div><p class="type-caption text-emerald-700">MULTI-PAGE DRAFT</p><label *ngIf="isNewForm()" class="label">Form key<input data-testid="form-key" [disabled]="editorLocked()" [(ngModel)]="definition().formKey" (ngModelChange)="touch()" aria-describedby="form-key-help"></label><p *ngIf="isNewForm()" id="form-key-help" class="type-caption">Lowercase letters, numbers, and hyphens; this suggested key is unique.</p><input class="title-input" [disabled]="editorLocked()" [(ngModel)]="definition().title" (ngModelChange)="touch()"></div><button *ngIf="canAuthor()" class="pill" [disabled]="editorLocked()" (click)="addPage()">Add page</button></div><label class="label">Page title<input [disabled]="editorLocked()" [(ngModel)]="page().title" (ngModelChange)="touch()"></label><div class="mt-5 space-y-3"><article *ngFor="let f of page().fields;let i=index" class="field-card" [class.selected]="fieldIndex()===i" (click)="fieldIndex.set(i)"><div><b>{{f.label}}</b><p class="type-caption">{{f.type}} · {{f.id}}</p></div><div *ngIf="canAuthor()" class="flex gap-2"><button class="icon" [disabled]="editorLocked()" (click)="moveField(i,-1);$event.stopPropagation()">↑</button><button class="icon" [disabled]="editorLocked()" (click)="moveField(i,1);$event.stopPropagation()">↓</button></div></article></div></div>
<aside class="card" *ngIf="field() as f"><p class="type-label">FIELD PROPERTIES</p><label class="label">Label<input [disabled]="editorLocked()" [(ngModel)]="f.label" (ngModelChange)="touch()"></label><label class="label">Type<select [disabled]="editorLocked()" [(ngModel)]="f.type" (ngModelChange)="normalize(f)"><option *ngFor="let type of types" [value]="type">{{type}}</option></select></label><label class="check"><input type="checkbox" [disabled]="editorLocked()" [(ngModel)]="f.required" (ngModelChange)="touch()"> Required</label><ng-container *ngIf="f.type==='text'"><label class="label">Minimum length<input type="number" [disabled]="editorLocked()" [(ngModel)]="f.constraints!.minLength" (ngModelChange)="touch()"></label><label class="label">Maximum length<input type="number" [disabled]="editorLocked()" [(ngModel)]="f.constraints!.maxLength" (ngModelChange)="touch()"></label></ng-container><ng-container *ngIf="f.type==='choice'||f.type==='multiChoice'"><p class="type-label">OPTIONS</p><div *ngFor="let option of f.options;let i=index" class="flex gap-1"><input [disabled]="editorLocked()" [(ngModel)]="option.label" (ngModelChange)="touch()"><button class="icon" [disabled]="editorLocked()" (click)="removeOption(f,i)">×</button></div><button class="pill" [disabled]="editorLocked()" (click)="addOption(f)">+ option</button></ng-container><p class="type-label mt-4">VISIBILITY RULE</p><select [disabled]="editorLocked()" [ngModel]="visibilityFieldId(f)" (ngModelChange)="setVisibilityRuleField(f,$any($event))"><option value="">Always visible</option><option *ngFor="let other of allFields()" [value]="other.id">{{other.label}}</option></select><input *ngIf="f.visibleWhen?.fieldId" [disabled]="editorLocked()" placeholder="equals value" [(ngModel)]="f.visibleWhen!.equals" (ngModelChange)="syncRules(f)"><p class="type-label mt-4">REQUIREDNESS RULE</p><select [disabled]="editorLocked()" [(ngModel)]="f.requiredRuleField" (ngModelChange)="syncRequiredRule(f,$any($event))"><option value="">Use checkbox</option><option *ngFor="let other of allFields()" [value]="other.id">Required when {{other.label}} equals…</option></select><input *ngIf="f.requiredRuleField" [disabled]="editorLocked()" placeholder="equals value" [(ngModel)]="f.requiredRuleValue" (ngModelChange)="syncRequiredRule(f,f.requiredRuleField)"><button class="pill danger mt-5" [disabled]="editorLocked()" (click)="removeField()">Remove field</button></aside></section>
<section *ngIf="draftState() === 'ready' && mode()==='preview'" class="mx-auto max-w-2xl card"><p class="type-caption text-emerald-700">PUBLIC RUNTIME · PAGE {{previewPage()+1}}/{{definition().pages.length}}</p><h2 class="type-h3">{{definition().title}}</h2><h3 class="type-h4">{{definition().pages[previewPage()].title}}</h3><div *ngFor="let f of definition().pages[previewPage()].fields" class="mt-5" [hidden]="!visible(f)"><label class="label">{{f.label}} <span *ngIf="isRequired(f)">*</span><input *ngIf="['text','integer','decimal','date'].includes(f.type)" [type]="f.type==='date'?'date':f.type==='text'?'text':'number'" [(ngModel)]="answers[f.id]"><input *ngIf="f.type==='boolean'" type="checkbox" [(ngModel)]="answers[f.id]"><select *ngIf="f.type==='choice'" [(ngModel)]="answers[f.id]"><option value="">Choose one</option><option *ngFor="let o of f.options" [value]="o.id">{{o.label}}</option></select><select *ngIf="f.type==='multiChoice'" multiple [(ngModel)]="answers[f.id]"><option *ngFor="let o of f.options" [value]="o.id">{{o.label}}</option></select><div *ngIf="f.type==='calculated'||f.type==='readOnly'" class="rounded-lg bg-stone-100 p-3">{{displayValue(f)}}</div><div *ngIf="f.type==='repeater'" class="space-y-2"><div *ngFor="let item of repeater(f);let i=index" class="flex gap-2"><input [(ngModel)]="item.value" placeholder="Item value"><button class="icon" (click)="removeItem(f,i)">×</button><button class="icon" (click)="moveItem(f,i,-1)">↑</button><button class="icon" (click)="moveItem(f,i,1)">↓</button></div><button class="pill" (click)="addItem(f)">+ item</button></div></label></div><div class="mt-6 flex justify-between"><button class="pill" [disabled]="previewPage()===0" (click)="previousPage()">Back</button><button class="pill" *ngIf="previewPage()<definition().pages.length-1" (click)="persistPage()">Next page</button><button class="pill primary" *ngIf="previewPage()===definition().pages.length-1" (click)="submit()">Submit</button></div></section>
<section *ngIf="responses().length" class="mt-6 card" data-testid="response-admin">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 class="type-h3 min-w-0 break-words">Response administration</h2>
    <input class="min-w-0 max-w-full flex-1" placeholder="Search receipt or form" [(ngModel)]="responseQuery">
  </div>
  <div class="mt-3 grid gap-2">
    <button class="field-card min-w-0 flex-wrap gap-2 text-left" *ngFor="let response of filteredResponses()" (click)="openResponse(response.id)">
      <span class="min-w-0 break-all">{{response.id}}</span>
      <span class="shrink-0">{{response.submittedAt}}</span>
    </button>
  </div>
</section>
<aside *ngIf="responseDetail()" class="mt-4 rounded-xl bg-stone-50 p-4">
  <div class="flex justify-between">
    <b>Authorized response detail</b>
    <button class="icon" (click)="closeResponseDetail()">×</button>
  </div>
  <pre class="overflow-auto text-xs">{{responseDetail()|json}}</pre>
</aside>
</main>`,
  styles: [`.card{border:1px solid var(--color-stone-200,#e7e5e4);border-radius:1.5rem;background:white;padding:1.25rem;box-shadow:0 1px 3px #0001}.primary{background:#047857;color:white;border-color:#047857}.danger{color:#b91c1c}.outline{display:block;width:100%;text-align:left;border:0;background:transparent;padding:.6rem;border-radius:.7rem}.active,.selected{background:#ecfdf5;outline:1px solid #059669}.label{display:block;margin-top:.8rem;font-size:.85rem;font-weight:600}.label input,.label select,aside input,aside select{display:block;width:100%;margin-top:.25rem;border:1px solid #d6d3d1;border-radius:.6rem;padding:.5rem}.check{display:block;margin-top:.8rem}.title-input{font-size:1.5rem;font-weight:700;border:0;width:100%}.notice{margin-top:1rem;padding:1rem;background:#ecfccb;border-radius:1rem}`],
})
export class AppComponent {
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly session = inject(StaffSessionStore);
  types = FIELD_TYPES;
  mode = signal<'editor' | 'preview'>('editor');
  pageIndex = signal(0);
  fieldIndex = signal(0);
  previewPage = signal(0);
  message = signal('');
  responses = signal<ResponseSummary[]>([]);
  responseDetail = signal<unknown>(null);
  responseQuery = '';
  answers: Record<string, unknown> = {};
  formId = '';
  draftId = '';
  publishedShareId = '';
  respondentId = '';
  respondentToken = '';
  respondentRevision = 0;
  draftRevision = signal(1);
  definition = signal<FormDefinition>(createDefaultDefinition());
  dirty = signal(false);
  saving = signal(false);
  publishing = signal(false);
  reviewSnapshot = signal<unknown>(null);
  governanceReview = signal<GovernanceReview | null>(null);
  releases = signal<Array<{ releaseId: string; version: number; state: string }>>([]);
  channels = signal<Array<{ channelId: string; releaseId: string; type: string; state: string; publicPath: string; opensAt?: string; closesAt?: string; responseCap?: number; acceptedCount: number; allowedOrigins: string[] }>>([]);
  selectedReleaseId = '';
  selectedChannelId = '';
  shareChannelType: 'LINK' | 'QR' | 'IFRAME' = 'LINK';
  shareParentOrigin = '';
  shareOpensAt = '';
  shareClosesAt = '';
  shareResponseCap: number | null = null;
  draftReloadRequired = signal(false);
  rehydrating = signal(true);
  rehydrationFailed = signal(false);
  draftState = signal<DraftViewState>('loading');
  private responseDetailGeneration = 0;

  constructor(private readonly api: SmartIntakeApiService) {
    // This route is protected by staffSessionGuard. Rehydrate only after the
    // server-authoritative guard has accepted the HttpOnly cookie.
    if (this.screen() === 'preview') this.mode.set('preview');
    if (this.isNewForm()) this.definition.update((definition) => ({ ...definition, formKey: this.suggestedFormKey() }));
    this.rehydrateRouteForm();
  }

  page() { return this.definition().pages[this.pageIndex()]; }
  field() { return this.page().fields[this.fieldIndex()]; }
  allFields() { return this.definition().pages.flatMap((page) => page.fields); }
  editorLocked() { return !this.canAuthor() || this.rehydrating() || this.rehydrationFailed() || this.saving() || this.publishing() || this.draftReloadRequired(); }
  publishLocked() { return !this.canGovernPublication() || this.rehydrating() || this.rehydrationFailed() || this.saving() || this.publishing() || this.draftReloadRequired(); }
  isNewForm() { return this.screen() === 'builder' && !this.routeParam('formId'); }
  draftStateTitle() {
    return ({ 'empty-or-no-access': 'Draft unavailable', invalid: 'Invalid draft request', denied: 'Draft access denied', expired: 'Session expired', 'email-unavailable': 'Email unavailable' } as const)[this.draftState() as DraftFailureState];
  }
  draftStateMessage() {
    return ({ 'empty-or-no-access': 'This draft does not exist in the current workspace or you no longer have access.', invalid: 'The draft request is invalid. Correct the route and try again.', denied: 'Your current workspace role cannot read this draft.', expired: 'Your staff session has expired. Sign in again to continue.', 'email-unavailable': 'Email delivery is unavailable; use the authorized copy-link path.' } as const)[this.draftState() as DraftFailureState];
  }
  touch() {
    if (this.editorLocked()) return;
    this.definition.update((definition) => ({ ...definition, pages: [...definition.pages] }));
    this.dirty.set(true);
  }
  selectPage(index: number) { this.pageIndex.set(index); this.fieldIndex.set(0); }

  addPage() {
    if (this.editorLocked()) return;
    const pages = [...this.definition().pages, createPage(`page-${Date.now()}`)];
    this.definition.update((definition) => ({ ...definition, pages }));
    this.dirty.set(true);
    this.selectPage(pages.length - 1);
  }

  addField(type: string) {
    if (this.editorLocked()) return;
    const page = this.page();
    const fields = [...page.fields, createField(`field-${Date.now()}`, type)];
    this.definition.update((definition) => updatePage(definition, this.pageIndex(), { ...page, fields }));
    this.dirty.set(true);
    this.fieldIndex.set(fields.length - 1);
  }

  removeField() {
    if (this.editorLocked()) return;
    const page = this.page();
    this.definition.update((definition) => updatePage(definition, this.pageIndex(), { ...page, fields: removeAt(page.fields, this.fieldIndex()) }));
    this.dirty.set(true);
    this.fieldIndex.set(0);
  }

  moveField(index: number, delta: number) {
    if (this.editorLocked()) return;
    const page = this.page();
    const fields = moveItem(page.fields, index, delta);
    if (fields === page.fields) return;
    this.definition.update((definition) => updatePage(definition, this.pageIndex(), { ...page, fields }));
    this.dirty.set(true);
    if (index + delta >= 0 && index + delta < fields.length) this.fieldIndex.set(index + delta);
  }

  normalize(field: Field) { if (this.editorLocked()) return; Object.assign(field, normalizeField(field)); this.touch(); }
  addOption(field: Field) { if (this.editorLocked()) return; field.options = addOption(field.options, `option-${Date.now()}`); this.touch(); }
  removeOption(field: Field, index: number) { if (this.editorLocked()) return; field.options = removeAt(field.options ?? [], index); this.touch(); }
  visibilityFieldId(field: Field) { return field.visibleWhen?.fieldId ?? ''; }
  setVisibilityRuleField(field: Field, fieldId: string) {
    if (this.editorLocked()) return;
    field.visibleWhen = { fieldId, equals: field.visibleWhen?.equals ?? '' };
    this.syncRules(field);
  }
  syncRules(field: Field) { if (this.editorLocked()) return; field.visibilityRule = visibilityRule(field.visibleWhen); this.touch(); }
  syncRequiredRule(field: Field, id: string) { if (this.editorLocked()) return; field.requiredRule = requirednessRule(id, field.requiredRuleValue); this.touch(); }

  repeater(field: Field): RepeaterItem[] { return (this.answers[field.id] as RepeaterItem[] | undefined) ?? (this.answers[field.id] = [] as RepeaterItem[]); }
  addItem(field: Field) { this.answers[field.id] = addRepeaterItem(this.repeater(field), crypto.randomUUID()); }
  removeItem(field: Field, index: number) { this.answers[field.id] = removeAt(this.repeater(field), index); }
  moveItem(field: Field, index: number, delta: number) { this.answers[field.id] = moveItem(this.repeater(field), index, delta); }
  displayValue(field: Field) { return field.type === 'readOnly' ? 'Read-only information' : 'Calculated when submitted'; }
  visible(field: Field) { return !field.visibleWhen?.fieldId || this.answers[field.visibleWhen.fieldId] === field.visibleWhen.equals; }
  isRequired(field: Field) { return !!field.required || !!(field.requiredRule && this.answers[field.requiredRuleField ?? ''] === field.requiredRuleValue); }

  private routeParam(name: string): string | null { return this.route?.snapshot.paramMap?.get(name) ?? null; }
  private screen(): string | undefined { return this.route?.snapshot.data?.['screen']; }
  /** The legacy route inherits the workspace selected by the server session. */
  private workspaceId(): string { return this.routeParam('workspaceId') ?? this.session.currentWorkspaceId() ?? ''; }
  private routeWorkspaceRoles(): readonly string[] {
    return workspaceRoleContext(this.session.organizations(), this.workspaceId(), this.session.currentWorkspaceId())?.roles ?? [];
  }
  canAuthor(): boolean { return hasWorkspaceRole(this.routeWorkspaceRoles(), 'author'); }
  canReview(): boolean { return hasWorkspaceRole(this.routeWorkspaceRoles(), 'reviewer'); }
  canPublish(): boolean { return hasWorkspaceRole(this.routeWorkspaceRoles(), 'publisher'); }
  canGovernPublication(): boolean { return this.canAuthor() || this.canReview() || this.canPublish(); }
  governanceActionLabel(): string { return this.canPublish() ? 'Publish' : this.canReview() ? 'Approve review' : 'Request review'; }
  reviewMatchesDraft(): boolean { const review=this.governanceReview(); return !!review && review.state!=='INVALIDATED' && review.matchesCurrentSnapshot !== false && review.revision===this.draftRevision(); }
  canViewResponses(): boolean { return hasWorkspaceRole(this.routeWorkspaceRoles(), 'response-viewer') || this.canExportResponses(); }
  canExportResponses(): boolean { return hasWorkspaceRole(this.routeWorkspaceRoles(), 'response-exporter'); }

  private rehydrateRouteForm(): void {
    const formId = this.routeParam('formId');
    const draftId = this.routeParam('draftId');
    const screen = this.screen();
    // Draft IDs currently equal their owning form IDs. The canonical /preview/{d}
    // route therefore resolves the same authoritative workspace-scoped draft.
    const resolvedFormId = formId ?? (screen === 'preview' ? draftId : null);
    if (resolvedFormId && (draftId || screen === 'review-publish' || screen === 'preview')) {
      this.api.currentDraft(this.workspaceId(), resolvedFormId, draftId ?? resolvedFormId).subscribe({
        next: (draft) => this.applyDraft(resolvedFormId, draft),
        error: (error) => this.failRehydration('The requested draft is unavailable in this workspace.', error),
      });
      return;
    }
    if (this.isNewForm() && !this.canAuthor()) {
      this.rehydrating.set(false);
      this.rehydrationFailed.set(true);
      this.draftState.set('denied');
      this.message.set('Author access is required to create a form in this workspace.');
      return;
    }
    // A workspace-scoped new route deliberately starts blank: it must not
    // silently open a draft from another form or workspace.
    if (screen === 'builder') { this.completeRehydration(); return; }
    this.rehydrateDefaultForm();
  }

  private rehydrateDefaultForm(knownForms?: FormSummary[]) {
    if (!this.canAuthor()) {
      this.completeRehydration();
      return;
    }
    const load = (forms: FormSummary[]) => {
      const form = forms.find((candidate) => candidate.formKey === this.definition().formKey);
      if (!form) {
        this.completeRehydration();
        return;
      }
      this.api.currentDraft(this.workspaceId(), form.id, form.id).subscribe({
        next: (draft) => this.applyDraft(form.id, draft),
        error: (error) => this.failRehydration('Saved draft unavailable. Retry before editing.', error),
      });
    };
    if (knownForms) load(knownForms);
    else this.api.listForms(this.workspaceId()).subscribe({ next: load, error: (error) => this.failRehydration('Unable to load saved drafts. Retry before editing.', error) });
  }

  retryDraftRehydration() {
    this.rehydrating.set(true);
    this.rehydrationFailed.set(false);
    this.draftState.set('loading');
    this.rehydrateRouteForm();
  }

  private suggestedFormKey(): string {
    const suffix = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID().replaceAll('-', '').slice(0, 10)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return `intake-${suffix}`;
  }

  private completeRehydration() {
    this.rehydrationFailed.set(false);
    this.rehydrating.set(false);
    this.draftState.set('ready');
  }

  private failRehydration(message: string, error?: unknown) {
    this.rehydrating.set(false);
    this.rehydrationFailed.set(true);
    this.message.set(message);
    const status = error instanceof HttpErrorResponse ? error.status : 400;
    this.draftState.set(status === 404 ? 'empty-or-no-access' : status === 403 ? 'denied' : status === 401 || status === 419 || status === 440 || status === 410 ? 'expired' : status === 503 ? 'email-unavailable' : 'invalid');
  }

  private applyDraft(formId: string, draft: CurrentDraft) {
    this.formId = formId;
    this.draftId = draft.id || formId;
    this.draftRevision.set(draft.revision);
    this.definition.set(draft.definition);
    this.pageIndex.set(0);
    this.fieldIndex.set(0);
    this.dirty.set(false);
    this.draftReloadRequired.set(false);
    this.completeRehydration();
    this.loadGovernance();
  }

  private loadGovernance() {
    if (!this.formId || !this.canGovernPublication()) return;
    this.api.publicationGovernance(this.workspaceId(), this.formId).subscribe({
      next: (state) => {
        const review = state.review?.reviewRequestId ? state.review : null;
        this.governanceReview.set(review);
        if (review) this.applyGovernanceReview(review); else this.reviewSnapshot.set(null);
        this.releases.set(state.releases); this.channels.set(state.channels);
        if (!state.releases.some((release) => release.releaseId === this.selectedReleaseId)) this.selectedReleaseId = state.releases.find((release) => release.state === 'ACTIVE')?.releaseId ?? state.releases[0]?.releaseId ?? '';
        if (!state.channels.some((channel) => channel.channelId === this.selectedChannelId)) this.selectedChannelId = state.channels[0]?.channelId ?? '';
      },
      error: () => this.message.set('Publication governance state is unavailable.'),
    });
  }
  private applyGovernanceReview(review: GovernanceReview) {
    this.governanceReview.set(review);
    this.reviewSnapshot.set({ reviewRequestId: review.reviewRequestId, revision: review.revision, state: review.state, semantic: review.semanticDiff, dependencies: review.dependencyDiff });
  }

  loadResponses() {
    this.responseDetailGeneration++;
    this.responseDetail.set(null);
    this.responses.set([]);
    this.api.listResponses(this.workspaceId()).subscribe({
      next: (response) => this.responses.set(response),
      error: () => { this.responseDetail.set(null); this.message.set('Response list unavailable.'); },
    });
  }
  filteredResponses() {
    const query = this.responseQuery.toLowerCase();
    return this.responses().filter((response) => JSON.stringify(response).toLowerCase().includes(query));
  }
  openResponse = (id: string) => {
    const generation = ++this.responseDetailGeneration;
    this.responseDetail.set(null);
    this.api.responseDetail(this.workspaceId(), id).subscribe({
      next: (response) => { if (generation === this.responseDetailGeneration) this.responseDetail.set(response); },
      error: () => {
        if (generation !== this.responseDetailGeneration) return;
        this.responseDetail.set(null);
        this.message.set('Response detail unavailable.');
      },
    });
  };
  closeResponseDetail() { this.responseDetailGeneration++; this.responseDetail.set(null); }

  exportDefinition() {
    if (!this.formId) { this.message.set('Save a form before export.'); return; }
    this.api.exportDefinition(this.workspaceId(), this.formId).subscribe({ next: (response) => this.download(response, 'smart-intake-definition.json'), error: () => this.message.set('Definition export failed.') });
  }

  importDefinition(event: Event) {
    if (this.editorLocked()) { this.message.set('Wait for saved draft initialization to finish.'); return; }
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !this.formId) { this.message.set('Save a form before import.'); return; }
    this.saving.set(true);
    file.text().then((text) => this.api.importDefinition(this.workspaceId(), this.formId, this.draftRevision(), JSON.parse(text)).subscribe({
      next: () => this.refetchImportedDraft(),
      error: (error) => { this.saving.set(false); this.message.set(error.error?.diagnostics?.[0]?.message || 'Import rejected.'); },
    })).catch(() => {
      this.saving.set(false);
      this.message.set('Import rejected.');
    });
  }

  private refetchImportedDraft() {
    this.draftReloadRequired.set(true);
    this.api.currentDraft(this.workspaceId(), this.formId, this.draftId || this.formId).subscribe({
      next: (draft) => {
        this.applyDraft(this.formId, draft);
        this.saving.set(false);
        this.message.set(`Import committed at revision ${draft.revision}`);
      },
      error: () => {
        this.saving.set(false);
        this.message.set('Import committed, but the canonical draft could not be reloaded.');
      },
    });
  }

  exportResponses() { this.api.exportResponses(this.workspaceId()).subscribe({ next: (response) => this.download(response, 'smart-intake-responses.json'), error: () => this.message.set('Response export failed.') }); }
  download(value: unknown, name: string) { const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); anchor.download = name; anchor.click(); URL.revokeObjectURL(anchor.href); }

  openAuthoring() {
    if (!this.canAuthor()) { this.message.set('Author access is required in this workspace.'); return; }
    if (this.formId) {
      if (Array.isArray((this.definition() as FormDefinition & { pages?: unknown[] }).pages)) {
        this.message.set('This draft uses the legacy package format and cannot be edited in canonical authoring. Create a canonical form or migrate this draft before continuing.');
        return;
      }
      this.navigateToAuthoring();
      return;
    }
    if (!/^[a-z][a-z0-9-]{2,99}$/.test(this.definition().formKey)) {
      this.message.set('Enter a lowercase form key using letters, numbers, and hyphens.');
      return;
    }
    this.saving.set(true);
    this.api.createForm(this.workspaceId(), this.definition().formKey, this.definition().title, 'canonical-4.0.0').subscribe({
      next: (created) => {
        this.formId = created.id;
        this.draftId = created.draftId || created.id;
        this.draftRevision.set(created.revision);
        this.saving.set(false);
        this.navigateToAuthoring();
      },
      error: () => { this.saving.set(false); this.message.set('Authoring could not create this form. The form key may already exist.'); },
    });
  }

  private navigateToAuthoring() {
    if (!this.formId) return;
    void this.router?.navigate(['/workspaces', this.workspaceId(), 'forms', this.formId, 'drafts', this.draftId || this.formId, 'author']);
  }

  save(afterSave?: () => void) {
    if (!this.canAuthor()) { this.message.set('Author access is required in this workspace.'); return; }
    if (this.rehydrating()) { this.message.set('Loading saved draft. Please wait.'); return; }
    if (this.rehydrationFailed()) { this.message.set('Saved draft must be reloaded before editing.'); return; }
    if (this.saving() || this.publishing() || this.draftReloadRequired()) {
      this.message.set('Wait for the current draft operation to finish.');
      return;
    }
    if (!this.formId && !/^[a-z][a-z0-9-]{2,99}$/.test(this.definition().formKey)) {
      this.message.set('Enter a lowercase form key using letters, numbers, and hyphens.');
      return;
    }
    this.saving.set(true);
    if (this.formId) {
      this.updateDraft(afterSave);
      return;
    }
    this.api.createForm(this.workspaceId(), this.definition().formKey, this.definition().title).subscribe({
      next: (created) => {
        this.formId = created.id;
        this.draftId = created.draftId || created.id;
        this.draftRevision.set(created.revision);
        this.updateDraft(afterSave);
      },
      error: () => { this.saving.set(false); this.message.set('Save failed: form key may already exist.'); },
    });
  }

  private updateDraft(afterSave?: () => void) {
    this.api.updateDraft(this.workspaceId(), this.formId, this.draftId || this.formId, this.draftRevision(), this.definition()).subscribe({
      next: (saved) => {
        this.draftRevision.set(saved.revision);
        this.definition.set(saved.definition);
        this.dirty.set(false);
        this.saving.set(false);
        this.message.set('Draft saved. Request a new governed review before public sharing.');
        this.loadGovernance();
        afterSave?.();
      },
      error: () => { this.saving.set(false); this.message.set('Save failed: draft changed or is unavailable.'); },
    });
  }

  publish() { this.requestReviewAction(); }
  requestReviewAction() {
    if (!this.canGovernPublication()) { this.message.set('Author, reviewer, or publisher access is required in this workspace.'); return; }
    if (this.rehydrating()) { this.message.set('Loading saved draft. Please wait.'); return; }
    if (this.rehydrationFailed()) { this.message.set('Saved draft must be reloaded before publishing.'); return; }
    if (!this.formId) { this.message.set('Save a form before publishing.'); return; }
    if (this.saving() || this.publishing() || this.draftReloadRequired()) {
      this.message.set('Wait for the current draft operation to finish before publishing.');
      return;
    }
    if (this.dirty()) {
      if (!this.canAuthor()) {
        this.message.set('This draft has unsaved changes and requires an author before publishing.');
        return;
      }
      this.save(() => this.requestReviewAction());
      return;
    }
    this.requestReview();
  }

  approveReviewAction() {
    const review=this.governanceReview(); if (!review || review.state!=='OPEN' || !this.reviewSnapshot() || !this.canReview()) return;
    this.publishing.set(true);
    this.api.approvePublicationReview(this.workspaceId(),this.formId,review.reviewRequestId).subscribe({
      next:(approved)=>{this.publishing.set(false);this.governanceReview.set({...review,...approved,state:'APPROVED'});this.message.set(`Review ${review.reviewRequestId} approved. A publisher can now publish it.`);},
      error:()=>{this.publishing.set(false);this.message.set('Review approval failed.');},
    });
  }

  publishReviewAction() { const review=this.governanceReview(); if (!this.publishing() && review?.state==='APPROVED') this.publishApprovedReview(review.reviewRequestId); }

  private requestReview() {
    this.publishing.set(true);
    this.api.requestPublicationReview(this.workspaceId(), this.formId).subscribe({
      next: (review) => {
        this.publishing.set(false); this.applyGovernanceReview(review);
        this.message.set(`Review ${review.reviewRequestId} is ready for inspection. Approval requires a separate action.`);
      },
      error: () => { this.publishing.set(false); this.message.set('Review request failed.'); },
    });
  }

  private publishApprovedReview(reviewRequestId: string) {
    if (!this.canPublish()) {
      this.publishing.set(false);
      this.message.set(`Review ${reviewRequestId} approved. An authorized publisher can now publish it.`);
      return;
    }
    this.publishing.set(true);
    this.api.publish(this.workspaceId(), this.formId, reviewRequestId).subscribe({
      next: (release) => {
        this.publishing.set(false);
        this.publishedShareId = release.shareId;
        this.selectedReleaseId = release.releaseId;
        this.message.set(`Form published. Release ${release.releaseId}`);
        this.loadGovernance();
      },
      error: () => { this.publishing.set(false); this.message.set('Governed publish failed. Refresh the review state and try again.'); },
    });
  }

  transitionRelease(action: 'activate' | 'rollback' | 'retire' | 'emergency-close') {
    const release = this.selectedReleaseId; if (!release) return;
    this.api.transitionRelease(this.workspaceId(), this.formId, release, action).subscribe({
      next: () => { this.message.set(`Release ${action} completed.`); this.loadGovernance(); },
      error: () => this.message.set(`Release ${action} failed.`),
    });
  }
  confirmTransition(action: 'activate' | 'rollback' | 'retire' | 'emergency-close') { if (window.confirm(`Confirm ${action} for release ${this.selectedReleaseId}? Active channels will follow the selected active release.`)) this.transitionRelease(action); }

  createShareChannel() {
    const release = this.selectedReleaseId; if (!release) return;
    const origins = this.shareChannelType === 'IFRAME' && this.shareParentOrigin ? [this.shareParentOrigin] : [];
    const request = { type: this.shareChannelType, allowedOrigins: origins,
      ...(this.shareOpensAt ? { opensAt: new Date(this.shareOpensAt).toISOString() } : {}),
      ...(this.shareClosesAt ? { closesAt: new Date(this.shareClosesAt).toISOString() } : {}),
      ...(this.shareResponseCap ? { responseCap: this.shareResponseCap } : {}) };
    this.api.createShareChannel(this.workspaceId(), this.formId, release, request).subscribe({
      next: (channel) => { this.selectedChannelId = channel.channelId; this.message.set(`${channel.type} channel created: ${channel.publicPath}`); this.loadGovernance(); },
      error: () => this.message.set('Share channel creation failed. Check dates, limits, and allowed origins.'),
    });
  }

  revokeShareChannel() {
    const channel = this.selectedChannelId; if (!channel) return;
    this.api.revokeShareChannel(this.workspaceId(), this.formId, channel).subscribe({
      next: () => { this.message.set('Share channel revoked.'); this.loadGovernance(); },
      error: () => this.message.set('Share channel revocation failed.'),
    });
  }
  confirmRevokeChannel() { if (window.confirm('Revoke the selected share channel?')) this.revokeShareChannel(); }
  selectedChannelOutput() { const channel=this.channels().find(value=>value.channelId===this.selectedChannelId); return channel ? `${channel.type}: ${channel.publicPath} · window ${channel.opensAt ?? 'now'} to ${channel.closesAt ?? 'open'} · ${channel.acceptedCount}/${channel.responseCap ?? 'unlimited'} accepted · origins ${(channel.allowedOrigins ?? []).join(', ') || 'not applicable'}` : ''; }

  startPreview() {
    this.mode.set('preview');
    this.previewPage.set(0);
    const shareId = this.publishedShareId || this.formId;
    if (shareId) this.api.startSession(shareId).subscribe({
      next: (response) => {
        this.respondentId = response.sessionId;
        this.respondentToken = response.respondentSession;
        this.respondentRevision = response.revision;
      },
      error: (failure: HttpErrorResponse) => this.message.set(this.publicSessionFailure(failure)),
    });
  }

  private publicSessionFailure(failure: HttpErrorResponse): string {
    if (failure.status === 404) return 'Publish the saved form before starting a public session.';
    if (failure.status === 403) return 'Public session start was denied.';
    if (failure.status === 410) return 'This public form is no longer accepting new responses.';
    return 'Could not start the public session. Try again.';
  }

  previousPage() { this.previewPage.update((page) => page - 1); }
  persistPage() { this.previewPage.update((page) => page + 1); }

  submit() {
    if (!this.respondentId) { this.message.set('Public session unavailable until the form is published.'); return; }
    const body = { baseRevision: this.respondentRevision, clientMutationId: crypto.randomUUID(), answers: this.answers };
    this.api.patchSession(this.respondentId, this.respondentToken, body).subscribe({
      next: (response) => {
        this.respondentRevision = response.acceptedRevision;
        this.api.submitSession(this.respondentId, this.respondentToken, response.acceptedRevision).subscribe({ next: (submission) => this.message.set(`Response received. Receipt ${submission.receiptId}`), error: () => this.message.set('Server validation blocked submission.') });
      },
      error: () => this.message.set('Could not save this page.'),
    });
  }
}
