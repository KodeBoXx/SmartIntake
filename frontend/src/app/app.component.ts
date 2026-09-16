import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
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
import { ResponseAdminComponent } from './response-admin.component';
import { SmartIntakeApiService } from './smart-intake-api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AppToolbarComponent, CommonModule, FormsModule, ResponseAdminComponent],
  template: `
<header class="border-b border-stone-200 bg-white"><div class="mx-auto flex max-w-7xl items-center justify-between px-5 py-4"><div><p class="type-caption-bold text-emerald-700">SMART INTAKE</p><h1 class="type-h3">Form Builder Lite</h1></div><span class="type-caption">{{staffToken?'Staff session active':'Local bootstrap/sign-in required'}}</span></div></header>
<main class="mx-auto max-w-7xl px-5 py-6">
<nav appToolbar class="mb-5 flex gap-2" [staffToken]="staffToken" (author)="mode.set('editor')" (preview)="startPreview()" (save)="save()" (definitionExport)="exportDefinition()" (definitionImport)="importDefinition($event)" (responsesExport)="exportResponses()" (responseAdmin)="loadResponses()"></nav>
<section *ngIf="mode()==='editor'" class="grid gap-5 lg:grid-cols-[15rem_1fr_19rem]"><aside class="card"><p class="type-label">PAGES</p><button *ngFor="let page of definition().pages;let i=index" class="outline" [class.active]="pageIndex()===i" (click)="selectPage(i)">{{i+1}}. {{page.title}}</button><button class="pill" (click)="addPage()">+ Page</button><hr><p class="type-label">FIELDS</p><button *ngFor="let f of page().fields;let i=index" class="outline" [class.active]="fieldIndex()===i" (click)="fieldIndex.set(i)">{{f.label}}</button><button class="pill" (click)="addField('text')">+ Field</button></aside>
<div class="card"><div class="flex items-center justify-between"><div><p class="type-caption text-emerald-700">MULTI-PAGE DRAFT</p><input class="title-input" [(ngModel)]="definition().title" (ngModelChange)="touch()"></div><button class="pill" (click)="addPage()">Add page</button></div><label class="label">Page title<input [(ngModel)]="page().title" (ngModelChange)="touch()"></label><div class="mt-5 space-y-3"><article *ngFor="let f of page().fields;let i=index" class="field-card" [class.selected]="fieldIndex()===i" (click)="fieldIndex.set(i)"><div><b>{{f.label}}</b><p class="type-caption">{{f.type}} · {{f.id}}</p></div><div class="flex gap-2"><button class="icon" (click)="moveField(i,-1);$event.stopPropagation()">↑</button><button class="icon" (click)="moveField(i,1);$event.stopPropagation()">↓</button></div></article></div></div>
<aside class="card" *ngIf="field() as f"><p class="type-label">FIELD PROPERTIES</p><label class="label">Label<input [(ngModel)]="f.label" (ngModelChange)="touch()"></label><label class="label">Type<select [(ngModel)]="f.type" (ngModelChange)="normalize(f)"><option *ngFor="let type of types" [value]="type">{{type}}</option></select></label><label class="check"><input type="checkbox" [(ngModel)]="f.required" (ngModelChange)="touch()"> Required</label><ng-container *ngIf="f.type==='text'"><label class="label">Minimum length<input type="number" [(ngModel)]="f.constraints!.minLength"></label><label class="label">Maximum length<input type="number" [(ngModel)]="f.constraints!.maxLength"></label></ng-container><ng-container *ngIf="f.type==='choice'||f.type==='multiChoice'"><p class="type-label">OPTIONS</p><div *ngFor="let option of f.options;let i=index" class="flex gap-1"><input [(ngModel)]="option.label"><button class="icon" (click)="removeOption(f,i)">×</button></div><button class="pill" (click)="addOption(f)">+ option</button></ng-container><p class="type-label mt-4">VISIBILITY RULE</p><select [ngModel]="visibilityFieldId(f)" (ngModelChange)="setVisibilityRuleField(f,$any($event))"><option value="">Always visible</option><option *ngFor="let other of allFields()" [value]="other.id">{{other.label}}</option></select><input *ngIf="f.visibleWhen?.fieldId" placeholder="equals value" [(ngModel)]="f.visibleWhen!.equals" (ngModelChange)="syncRules(f)"><p class="type-label mt-4">REQUIREDNESS RULE</p><select [(ngModel)]="f.requiredRuleField" (ngModelChange)="syncRequiredRule(f,$any($event))"><option value="">Use checkbox</option><option *ngFor="let other of allFields()" [value]="other.id">Required when {{other.label}} equals…</option></select><input *ngIf="f.requiredRuleField" placeholder="equals value" [(ngModel)]="f.requiredRuleValue" (ngModelChange)="syncRequiredRule(f,f.requiredRuleField)"><button class="pill danger mt-5" (click)="removeField()">Remove field</button></aside></section>
<section *ngIf="mode()==='preview'" class="mx-auto max-w-2xl card"><p class="type-caption text-emerald-700">PUBLIC RUNTIME · PAGE {{previewPage()+1}}/{{definition().pages.length}}</p><h2 class="type-h3">{{definition().title}}</h2><h3 class="type-h4">{{definition().pages[previewPage()].title}}</h3><div *ngFor="let f of definition().pages[previewPage()].fields" class="mt-5" [hidden]="!visible(f)"><label class="label">{{f.label}} <span *ngIf="isRequired(f)">*</span><input *ngIf="['text','integer','decimal','date'].includes(f.type)" [type]="f.type==='date'?'date':f.type==='text'?'text':'number'" [(ngModel)]="answers[f.id]"><input *ngIf="f.type==='boolean'" type="checkbox" [(ngModel)]="answers[f.id]"><select *ngIf="f.type==='choice'" [(ngModel)]="answers[f.id]"><option value="">Choose one</option><option *ngFor="let o of f.options" [value]="o.id">{{o.label}}</option></select><select *ngIf="f.type==='multiChoice'" multiple [(ngModel)]="answers[f.id]"><option *ngFor="let o of f.options" [value]="o.id">{{o.label}}</option></select><div *ngIf="f.type==='calculated'||f.type==='readOnly'" class="rounded-lg bg-stone-100 p-3">{{displayValue(f)}}</div><div *ngIf="f.type==='repeater'" class="space-y-2"><div *ngFor="let item of repeater(f);let i=index" class="flex gap-2"><input [(ngModel)]="item.value" placeholder="Item value"><button class="icon" (click)="removeItem(f,i)">×</button><button class="icon" (click)="moveItem(f,i,-1)">↑</button><button class="icon" (click)="moveItem(f,i,1)">↓</button></div><button class="pill" (click)="addItem(f)">+ item</button></div></label></div><div class="mt-6 flex justify-between"><button class="pill" [disabled]="previewPage()===0" (click)="previousPage()">Back</button><button class="pill" *ngIf="previewPage()<definition().pages.length-1" (click)="persistPage()">Next page</button><button class="pill primary" *ngIf="previewPage()===definition().pages.length-1" (click)="submit()">Submit</button></div><p *ngIf="message()" class="notice">{{message()}}</p></section>
<section appResponseAdmin *ngIf="responses().length" class="mt-6 card" [responses]="responses()" [(responseQuery)]="responseQuery" [responseDetail]="responseDetail()" (open)="openResponse($event)" (close)="responseDetail.set(null)"></section>
</main>`,
  styles: [`.card{border:1px solid var(--color-stone-200,#e7e5e4);border-radius:1.5rem;background:white;padding:1.25rem;box-shadow:0 1px 3px #0001}.primary{background:#047857;color:white;border-color:#047857}.danger{color:#b91c1c}.outline{display:block;width:100%;text-align:left;border:0;background:transparent;padding:.6rem;border-radius:.7rem}.active,.selected{background:#ecfdf5;outline:1px solid #059669}.label{display:block;margin-top:.8rem;font-size:.85rem;font-weight:600}.label input,.label select,aside input,aside select{display:block;width:100%;margin-top:.25rem;border:1px solid #d6d3d1;border-radius:.6rem;padding:.5rem}.check{display:block;margin-top:.8rem}.title-input{font-size:1.5rem;font-weight:700;border:0;width:100%}.notice{margin-top:1rem;padding:1rem;background:#ecfccb;border-radius:1rem}`],
})
export class AppComponent {
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
  staffToken = localStorage.getItem('smartintake.staffSession') || '';
  formId = '';
  respondentId = '';
  respondentToken = '';
  respondentRevision = 0;
  draftRevision = signal(1);
  definition = signal<FormDefinition>(createDefaultDefinition());

  constructor(private readonly api: SmartIntakeApiService) {
    this.bootstrap();
  }

  page() { return this.definition().pages[this.pageIndex()]; }
  field() { return this.page().fields[this.fieldIndex()]; }
  allFields() { return this.definition().pages.flatMap((page) => page.fields); }
  touch() { this.definition.update((definition) => ({ ...definition, pages: [...definition.pages] })); }
  selectPage(index: number) { this.pageIndex.set(index); this.fieldIndex.set(0); }

  addPage() {
    const pages = [...this.definition().pages, createPage(`page-${Date.now()}`)];
    this.definition.update((definition) => ({ ...definition, pages }));
    this.selectPage(pages.length - 1);
  }

  addField(type: string) {
    const page = this.page();
    const fields = [...page.fields, createField(`field-${Date.now()}`, type)];
    this.definition.update((definition) => updatePage(definition, this.pageIndex(), { ...page, fields }));
    this.fieldIndex.set(fields.length - 1);
  }

  removeField() {
    const page = this.page();
    this.definition.update((definition) => updatePage(definition, this.pageIndex(), { ...page, fields: removeAt(page.fields, this.fieldIndex()) }));
    this.fieldIndex.set(0);
  }

  moveField(index: number, delta: number) {
    const page = this.page();
    const fields = moveItem(page.fields, index, delta);
    if (fields === page.fields) return;
    this.definition.update((definition) => updatePage(definition, this.pageIndex(), { ...page, fields }));
    if (index + delta >= 0 && index + delta < fields.length) this.fieldIndex.set(index + delta);
  }

  normalize(field: Field) { Object.assign(field, normalizeField(field)); this.touch(); }
  addOption(field: Field) { field.options = addOption(field.options, `option-${Date.now()}`); this.touch(); }
  removeOption(field: Field, index: number) { field.options = removeAt(field.options ?? [], index); this.touch(); }
  visibilityFieldId(field: Field) { return field.visibleWhen?.fieldId ?? ''; }
  setVisibilityRuleField(field: Field, fieldId: string) {
    field.visibleWhen = { fieldId, equals: field.visibleWhen?.equals ?? '' };
    this.syncRules(field);
  }
  syncRules(field: Field) { field.visibilityRule = visibilityRule(field.visibleWhen); this.touch(); }
  syncRequiredRule(field: Field, id: string) { field.requiredRule = requirednessRule(id, field.requiredRuleValue); this.touch(); }

  repeater(field: Field): RepeaterItem[] { return (this.answers[field.id] as RepeaterItem[] | undefined) ?? (this.answers[field.id] = [] as RepeaterItem[]); }
  addItem(field: Field) { this.answers[field.id] = addRepeaterItem(this.repeater(field), crypto.randomUUID()); }
  removeItem(field: Field, index: number) { this.answers[field.id] = removeAt(this.repeater(field), index); }
  moveItem(field: Field, index: number, delta: number) { this.answers[field.id] = moveItem(this.repeater(field), index, delta); }
  displayValue(field: Field) { return field.type === 'readOnly' ? 'Read-only information' : 'Calculated when submitted'; }
  visible(field: Field) { return !field.visibleWhen?.fieldId || this.answers[field.visibleWhen.fieldId] === field.visibleWhen.equals; }
  isRequired(field: Field) { return !!field.required || !!(field.requiredRule && this.answers[field.requiredRuleField ?? ''] === field.requiredRuleValue); }

  bootstrap() {
    if (this.staffToken) return;
    this.api.bootstrap().subscribe({ next: (response) => { this.staffToken = response.staffSession; localStorage.setItem('smartintake.staffSession', response.staffSession); } });
  }

  loadResponses() { this.api.listResponses(this.staffToken).subscribe({ next: (response) => this.responses.set(response), error: () => this.message.set('Response list unavailable.') }); }
  openResponse(id: string) { this.api.responseDetail(this.staffToken, id).subscribe({ next: (response) => this.responseDetail.set(response), error: () => this.message.set('Response detail unavailable.') }); }

  exportDefinition() {
    if (!this.formId) { this.message.set('Save a form before export.'); return; }
    this.api.exportDefinition(this.staffToken, this.formId).subscribe({ next: (response) => this.download(response, 'smart-intake-definition.json'), error: () => this.message.set('Definition export failed.') });
  }

  importDefinition(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !this.formId) { this.message.set('Save a form before import.'); return; }
    file.text().then((text) => this.api.importDefinition(this.staffToken, this.formId, JSON.parse(text)).subscribe({ next: (response) => { this.draftRevision.set(response.revision); this.message.set(`Import committed at revision ${response.revision}`); }, error: (error) => this.message.set(error.error?.diagnostics?.[0]?.message || 'Import rejected.') }));
  }

  exportResponses() { this.api.exportResponses(this.staffToken).subscribe({ next: (response) => this.download(response, 'smart-intake-responses.json'), error: () => this.message.set('Response export failed.') }); }
  download(value: unknown, name: string) { const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); anchor.download = name; anchor.click(); URL.revokeObjectURL(anchor.href); }

  save() {
    if (!this.staffToken) { this.message.set('Waiting for a staff session.'); return; }
    this.api.saveDraft(this.staffToken, this.definition().formKey, this.definition().title).subscribe({ next: (response) => { this.formId = response.id; this.draftRevision.set(response.revision || 1); this.message.set('Draft saved. Publish this form through the release API before public sharing.'); }, error: () => this.message.set('Save failed: form key may already exist.') });
  }

  startPreview() {
    this.mode.set('preview');
    this.previewPage.set(0);
    if (this.formId) this.api.startSession(this.formId).subscribe({ next: (response) => { this.respondentId = response.sessionId; this.respondentToken = response.respondentSession; this.respondentRevision = response.revision; }, error: () => this.message.set('Publish the saved form before starting a public session.') });
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
