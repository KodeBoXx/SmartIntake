import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, QueryList, ViewChildren, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { CuiAlertComponent, CuiCardComponent, CuiEmptyStateComponent, CuiInputComponent } from '@certinal/ui';
import { type M5StubState } from '../../core/m5-session.store';
import { m5RouteState, titleCase } from '../../shared/m5-route-state';
import type { RuntimeFieldDefinition } from '../../runtime/runtime-types';
import { PublicSessionStore } from './public-session.store';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, CuiAlertComponent, CuiCardComponent, CuiEmptyStateComponent, CuiInputComponent],
  template: `
    <section data-testid="public-page" [attr.data-state]="testState || store.phase()" data-public-runtime>
      @if (testState) {
        <!-- Immutable M5 shell-state coverage remains independent from live APIs. -->
        <cui-card padding="lg"><p class="type-caption">PUBLIC FORM</p><h1 class="type-h3">{{ testTitle }}</h1><p class="type-caption" data-testid="state-evidence">State: {{ testState }}</p>
          @if (testState === 'closed' || testState === 'expired') { <cui-empty-state icon="shield" [title]="testState === 'closed' ? 'This form is closed' : 'This link has expired'" [description]="testMessage" /> }
          @else if (testState === 'loading') { <p class="type-body">Loading the public form…</p> }
          @else if (testState === 'offline' || testState === 'stale' || testState === 'invalid') { <cui-alert variant="warning" [title]="testState">{{ testMessage }}</cui-alert> }
          @else if (testState === 'failed') { <cui-alert variant="error" title="Submission failed">{{ testMessage }}</cui-alert> }
          @else if (testState === 'acknowledgment') { <cui-alert variant="info" title="Acknowledgment required">{{ testMessage }}</cui-alert> }
          @else if (screen === 'receipt') { <cui-alert [variant]="testState === 'succeeded' ? 'success' : 'info'" title="Receipt {{ testState }}">{{ testMessage }}</cui-alert> }
          @else { <cui-input label="Example answer" placeholder="M5 route stub" /><button cui-button class="mt-5">{{ testState === 'start' ? 'Start form' : 'Continue' }}</button> }
        </cui-card>
      } @else {
      @if (store.error(); as error) { <cui-alert variant="error" class="mb-4" data-testid="public-error">{{ error }}</cui-alert> }

      @if (entryShareId) {
        <cui-card padding="lg" data-testid="public-entry">
          <h1 class="type-h2 mb-2">Start your response</h1>
          <p class="type-body mb-6">Your progress is saved securely as you go.</p>
          <button cui-button variant="primary" type="button" (click)="start()" [disabled]="store.phase() === 'loading'">Start form</button>
        </cui-card>
      } @else if (store.phase() === 'loading' || store.phase() === 'idle') {
        <p class="type-body" aria-live="polite">Loading your response…</p>
      } @else if (receiptRoute || store.phase() === 'receipt') {
        <cui-card padding="lg" data-testid="public-receipt">
          <h1 class="type-h2 mb-2">Response received</h1>
          <p class="type-body mb-6">Thank you. Your response has been submitted successfully.</p>
          <button cui-button variant="primary" type="button" (click)="store.startAnother()" data-testid="start-another-response">Start another response</button>
        </cui-card>
      } @else if (reviewRoute || store.phase() === 'review' || store.phase() === 'submitting') {
        <cui-card padding="lg" data-testid="public-review">
          <h1 class="type-h2 mb-2">Review your response</h1>
          <p class="type-body mb-5">Check your answers before submitting.</p>
          @for (item of reviewItems(); track item.fieldId) {
            <div class="border-b py-3" data-testid="review-item">
              <div class="type-label">{{ item.label }}</div>
              <div class="type-body">{{ item.value }}</div>
              <button cui-button variant="secondary" size="sm" type="button" (click)="store.edit(item.fieldId)">Edit</button>
            </div>
          }
          @for (ack of acknowledgments(); track ack.fieldId) {
            <label class="mt-4 flex gap-2 type-body"><input type="checkbox" [(ngModel)]="ack.accepted" /> {{ ack.label }}</label>
          }
          <div class="mt-6 flex gap-3">
            <button cui-button variant="secondary" type="button" (click)="backToForm()" [disabled]="store.phase() === 'submitting'">Back to form</button>
            <button cui-button variant="primary" type="button" (click)="submit()" [disabled]="store.phase() === 'submitting' || !acksAccepted()" data-testid="submit-response">{{ store.phase() === 'submitting' ? 'Submitting…' : 'Submit response' }}</button>
          </div>
        </cui-card>
      } @else if (store.session(); as session) {
        <cui-card padding="lg" data-testid="public-form">
          <div class="mb-5 flex items-baseline justify-between gap-4">
            <div><h1 class="type-h2">{{ currentPage()?.title || 'Your response' }}</h1><p class="type-caption">{{ store.progressLabel() }}</p></div>
            @if (store.phase() === 'saving') { <span class="type-caption" aria-live="polite">Saving…</span> } @else { <span class="type-caption">Saved</span> }
          </div>
          @for (field of currentFields(); track field.id) {
            <div class="mb-5" [attr.data-field-id]="field.id">
              <label class="type-label mb-1 block" [for]="field.id">{{ label(field) }}</label>
              @if (field.type === 'object') {
                <div class="ml-3 border-l pl-4" data-testid="object-control">@for (child of field.fields || []; track child.id) { <label class="type-label block" [for]="field.id + '-' + child.id">{{ label(child) }}<input [id]="field.id + '-' + child.id" class="mt-1 w-full" [type]="inputType(child)" [ngModel]="nestedValue(field, child)" (ngModelChange)="store.setAnswer(child, $event)" /></label> }</div>
              } @else if (field.type === 'list') {
                <div data-testid="list-control">@for (item of listItems(field); track item.itemId; let index = $index) { <div class="mb-3 border p-3" [attr.data-item-id]="item.itemId"><div class="type-caption">Item {{ index + 1 }}</div>@for (child of field.itemFields || []; track child.id) { <label class="type-label block" [for]="field.id + '-' + item.itemId + '-' + child.id">{{ label(child) }}<input [id]="field.id + '-' + item.itemId + '-' + child.id" class="mt-1 w-full" [type]="inputType(child)" [ngModel]="itemValue(item, child)" (ngModelChange)="store.setAnswer(child, $event, [{ listFieldId: field.id, itemId: item.itemId }])" /></label> } @if (!field.fixedRows) { <button cui-button size="sm" type="button" (click)="store.removeItem(field, item.itemId)">Remove</button> }</div> } @if (!field.fixedRows && listItems(field).length < 50) { <button cui-button variant="secondary" type="button" (click)="store.addItem(field)" data-testid="add-list-item">Add item</button> }</div>
              } @else if (field.type === 'attachments' || field.type === 'drawing') {
                <cui-alert variant="info" title="Secure {{ field.type }}">This response type is captured by the secure service.</cui-alert>
              } @else if (field.type === 'boolean') {
                <select #focusTarget [id]="field.id" class="w-full" [disabled]="isProtected(field)" [ngModel]="booleanValue(field)" (ngModelChange)="store.setAnswer(field, $event === 'true')">
                  <option [ngValue]="null">Select an answer</option><option [ngValue]="true">Yes</option><option [ngValue]="false">No</option>
                </select>
              } @else if (field.type === 'choice') {
                <select #focusTarget [id]="field.id" class="w-full" [disabled]="isProtected(field)" [ngModel]="textValue(field)" (ngModelChange)="store.setAnswer(field, $event)">
                  <option value="">Select an answer</option>@for (option of field.options || []; track option) { <option [value]="option">{{ option }}</option> }
                </select>
              } @else if (field.type === 'multiChoice') {
                @for (option of field.options || []; track option) { <label class="mr-4 inline-flex gap-2"><input type="checkbox" [checked]="multiValue(field).includes(option)" [disabled]="isProtected(field)" (change)="toggleChoice(field, option, $any($event.target).checked)" />{{ option }}</label> }
              } @else if (field.type === 'text' && (field.maxLength || 0) > 120) {
                <textarea #focusTarget [id]="field.id" class="w-full" rows="4" [disabled]="isProtected(field)" [ngModel]="textValue(field)" (ngModelChange)="store.setAnswer(field, $event)"></textarea>
              } @else {
                <input #focusTarget [id]="field.id" class="w-full" [type]="inputType(field)" [disabled]="isProtected(field)" [attr.min]="field.min" [attr.max]="field.max" [attr.step]="field.step" [ngModel]="textValue(field)" (ngModelChange)="store.setAnswer(field, $event)" />
              }
              @if (field.allowUnknown || field.allowDeclined || field.allowNotApplicable) {
                <div class="mt-2 flex flex-wrap gap-2"><button cui-button size="sm" variant="secondary" type="button" (click)="store.clear(field)">Clear</button>@if (field.allowUnknown) { <button cui-button size="sm" variant="secondary" type="button" (click)="store.setStatus(field, 'unknown')">Unknown</button> } @if (field.allowDeclined) { <button cui-button size="sm" variant="secondary" type="button" (click)="store.setStatus(field, 'declined')">Decline</button> } @if (field.allowNotApplicable) { <button cui-button size="sm" variant="secondary" type="button" (click)="store.setStatus(field, 'respondentNotApplicable')">Not applicable</button> }</div>
              }
            </div>
          }
          <div class="mt-8 flex justify-between gap-3">
            <button cui-button variant="secondary" type="button" (click)="store.navigate(-1)" [disabled]="!store.canMovePrevious()">Previous</button>
            @if (store.canMoveNext()) { <button cui-button variant="primary" type="button" (click)="store.navigate(1)">Next</button> } @else { <button cui-button variant="primary" type="button" (click)="store.openReview()" data-testid="review-response">Review response</button> }
          </div>
        </cui-card>
      }
      }
    </section>
  `,
})
export class PublicPageComponent implements OnInit {
  entryShareId: string | null = null;
  reviewRoute = false;
  receiptRoute = false;
  acknowledgments = () => this.acknowledgmentFields();
  private readonly acknowledge = new Map<string, boolean>();
  @ViewChildren('focusTarget') private readonly focusTargets!: QueryList<ElementRef<HTMLElement>>;
  readonly screen: string;
  readonly testState: M5StubState | null;
  readonly testTitle: string;

  constructor(readonly store: PublicSessionStore, private readonly route: ActivatedRoute) {
    this.screen = route.snapshot.data['screen'] as string;
    this.testState = route.snapshot.queryParamMap.has('state')
      ? m5RouteState(route, this.screen === 'receipt' ? 'pending' : 'ready') : null;
    this.testTitle = titleCase(this.screen);
    effect(() => {
      const target = this.route.snapshot.queryParamMap.get('focus');
      if (!target || !this.store.session()) return;
      queueMicrotask(() => this.focusTargets.find((node) => node.nativeElement.id === target)?.nativeElement.focus());
    });
  }

  ngOnInit(): void {
    this.entryShareId = this.route.snapshot.paramMap.get('shareId');
    const sessionId = this.route.snapshot.paramMap.get('sessionId');
    this.reviewRoute = this.route.snapshot.url.some((segment) => segment.path === 'review');
    this.receiptRoute = this.route.snapshot.url.some((segment) => segment.path === 'receipt');
    if (this.receiptRoute && sessionId) this.store.restoreReceipt(sessionId);
    if (sessionId && !this.store.session() && !this.testState && !this.receiptRoute) this.store.hydrate(sessionId);
    if (!this.testState && this.entryShareId && window.parent !== window) {
      const origin = this.route.snapshot.queryParamMap.get('origin') ?? '*';
      window.parent.postMessage({ protocol: 'smart-intake.v1', type: 'ready', shareId: this.entryShareId }, origin);
    }
  }

  get testMessage(): string { return `${this.testTitle} is ${this.testState}; real respondent session behavior is active without a test state.`; }

  start(): void { if (this.entryShareId) { const channel = this.route.snapshot.queryParamMap.get('channel'); channel ? this.store.startFromChannel(this.entryShareId, channel) : this.store.start(this.entryShareId); } }
  currentPage() { return this.store.pages().find((page) => page.id === this.store.currentPageId()); }
  currentFields(): readonly RuntimeFieldDefinition[] { const ids = this.currentPage()?.fieldIds ?? []; return this.store.definition().fields.filter((field) => ids.includes(field.id)); }
  label(field: RuntimeFieldDefinition): string { return field.id.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()); }
  isProtected(field: RuntimeFieldDefinition): boolean { return Boolean(field.readOnly || field.calculated); }
  inputType(field: RuntimeFieldDefinition): string { return field.type === 'integer' || field.type === 'decimal' ? 'number' : field.type === 'date' || field.type === 'time' || field.type === 'dateTime' ? field.type === 'dateTime' ? 'datetime-local' : field.type : 'text'; }
  textValue(field: RuntimeFieldDefinition): string { const value = this.answer(field)?.value; return typeof value === 'string' ? value : ''; }
  booleanValue(field: RuntimeFieldDefinition): boolean | null { const value = this.answer(field)?.value; return typeof value === 'boolean' ? value : null; }
  multiValue(field: RuntimeFieldDefinition): readonly string[] { const value = this.answer(field)?.value; return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
  nestedValue(parent: RuntimeFieldDefinition, child: RuntimeFieldDefinition): string { const value = this.answer(parent)?.value; return value && typeof value === 'object' && 'fields' in value ? String(((value as { fields: Record<string, { value?: unknown }> }).fields[child.id]?.value ?? '')) : ''; }
  listItems(field: RuntimeFieldDefinition): readonly { itemId: string; fields: Record<string, { value?: unknown }> }[] { const value = this.answer(field)?.value; return value && typeof value === 'object' && 'items' in value ? (value as { items: { itemId: string; fields: Record<string, { value?: unknown }> }[] }).items : []; }
  itemValue(item: { fields: Record<string, { value?: unknown }> }, child: RuntimeFieldDefinition): string { return String(item.fields[child.id]?.value ?? ''); }
  toggleChoice(field: RuntimeFieldDefinition, option: string, checked: boolean): void { const selected = new Set(this.multiValue(field)); checked ? selected.add(option) : selected.delete(option); this.store.setAnswer(field, [...selected]); }
  reviewItems(): { fieldId: string; label: string; value: string }[] { return this.store.definition().fields.filter((field) => !['object', 'list', 'attachments', 'drawing'].includes(field.type)).map((field) => ({ fieldId: field.id, label: this.label(field), value: display(this.answer(field)) })); }
  backToForm(): void { const sessionId = this.store.session()?.sessionId; if (sessionId) void this.store.edit(this.currentFields()[0]?.id ?? ''); }
  submit(): void { this.store.submit(this.acknowledgmentFields().filter((ack) => ack.accepted).map(({ fieldId, rowPath, contentHash }) => ({ fieldId, rowPath, expectedContentHash: contentHash, accepted: true }))); }
  acksAccepted(): boolean { return this.acknowledgmentFields().every((ack) => ack.accepted); }

  private answer(field: RuntimeFieldDefinition): { status: string; value?: unknown } | undefined { return this.store.state().answers[field.id] ?? this.store.state().server?.answers[field.id]; }
  private acknowledgmentFields(): { fieldId: string; label: string; rowPath: { listFieldId: string; itemId: string }[]; contentHash: string; accepted: boolean }[] {
    const state = this.acknowledge;
    const gates = this.store.review()?.review?.['reviewGates'];
    if (!Array.isArray(gates)) return [];
    return gates.flatMap((gate) => {
      if (!gate || typeof gate !== 'object') return [];
      const value = gate as Record<string, unknown>;
      const fieldId = typeof value['fieldId'] === 'string' ? value['fieldId'] : '';
      const contentHash = typeof value['contentHash'] === 'string' ? value['contentHash'] : '';
      const rowPath = Array.isArray(value['rowPath']) ? value['rowPath'].filter(isRowPath) : [];
      if (!fieldId || !contentHash) return [];
      const key = `${fieldId}:${JSON.stringify(rowPath)}`;
      return [{
        fieldId, rowPath, contentHash,
        label: typeof value['content'] === 'string' ? value['content'] : this.label(this.store.definition().fields.find((field) => field.id === fieldId) ?? { id: fieldId, type: 'text' }),
        get accepted() { return state.get(key) ?? false; },
        set accepted(accepted: boolean) { state.set(key, accepted); },
      }];
    });
  }
}

function isRowPath(value: unknown): value is { listFieldId: string; itemId: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>)['listFieldId'] === 'string' && typeof (value as Record<string, unknown>)['itemId'] === 'string');
}
function display(answer: { status: string; value?: unknown } | undefined): string { if (!answer || answer.status === 'unanswered') return 'Not answered'; if (answer.status !== 'answered') return answer.status; if (Array.isArray(answer.value)) return answer.value.join(', '); if (typeof answer.value === 'boolean') return answer.value ? 'Yes' : 'No'; return String(answer.value ?? 'Not answered'); }
