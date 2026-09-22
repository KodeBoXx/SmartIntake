import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, QueryList, ViewChildren, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { CuiAlertComponent, CuiCardComponent, CuiEmptyStateComponent, CuiInputComponent } from '@certinal/ui';
import { type M5StubState } from '../../core/m5-session.store';
import { m5RouteState, titleCase } from '../../shared/m5-route-state';
import type { InputAnswerCell, RuntimeFieldDefinition, ServerAnswerCell } from '../../runtime/runtime-types';
import { PublicSessionStore } from './public-session.store';
import { RespondentControlComponent } from './respondent-control.component';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, CuiAlertComponent, CuiCardComponent, CuiEmptyStateComponent, CuiInputComponent, RespondentControlComponent],
  template: `
    <section data-testid="public-page" [attr.data-state]="testState || store.phase()" [attr.dir]="direction()" [attr.lang]="language()" data-public-runtime>
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
      @if (invalidItems().length) { <nav [attr.aria-label]="t('answerErrors')" class="mb-4" aria-live="assertive"><p class="type-label">{{ t('reviewErrors') }} {{ invalidItems().length }}</p><ul>@for (item of invalidItems(); track item.key) { <li><button type="button" (click)="store.edit(item.fieldId, item.rowPath, item.instanceId)">{{ t('goTo') }} {{ item.fieldId }}</button></li> }</ul></nav> }

      @if (entryShareId) {
        <cui-card padding="lg" data-testid="public-entry">
          <h1 class="type-h2 mb-2">{{ t('startTitle') }}</h1>
          <p class="type-body mb-6">{{ t('savedSecurely') }}</p>
          <label class="mb-4 flex gap-2 type-body"><input type="checkbox" [ngModel]="store.sharedDevice()" (ngModelChange)="store.setSharedDevice($event)" /> {{ t('sharedDevice') }}</label>
          <button cui-button variant="primary" type="button" (click)="start()" [disabled]="store.phase() === 'loading'">{{ t('start') }}</button>
        </cui-card>
      } @else if (store.phase() === 'loading' || store.phase() === 'idle') {
        <p class="type-body" aria-live="polite">{{ t('loading') }}</p>
      } @else if (store.phase() === 'receipt' && store.receipt()) {
        <cui-card padding="lg" data-testid="public-receipt">
          <h1 class="type-h2 mb-2">{{ t('received') }}</h1>
          <p class="type-body mb-6">{{ t('thankYou') }}</p>
          <button cui-button variant="primary" type="button" (click)="store.startAnother()" data-testid="start-another-response">{{ t('startAnother') }}</button>
        </cui-card>
      } @else if (reviewRoute || store.phase() === 'review' || store.phase() === 'submitting') {
        <cui-card padding="lg" data-testid="public-review">
          <h1 id="review-heading" tabindex="-1" class="type-h2 mb-2">{{ t('reviewTitle') }}</h1><p class="sr-only" aria-live="assertive">{{ store.reviewAnnouncement() }}</p>
          <p class="type-body mb-5">{{ t('checkAnswers') }}</p>
          @for (item of reviewItems(); track item.key) {
            <div class="border-b py-3" tabindex="-1" data-testid="review-item" [id]="'review-'+safeId(item.key)" [attr.data-row-path]="item.rowPath">
              <div class="type-label">{{ item.label }}</div>
              <div class="type-body">{{ item.value }}</div>
              <button cui-button variant="secondary" size="sm" type="button" [disabled]="store.isBusy()" (click)="store.edit(item.fieldId, item.path, item.instanceId, item.key)">{{ t('edit') }}</button>
            </div>
          }
          @for (ack of acknowledgments(); track ack.key) {
            <label class="mt-4 flex gap-2 type-body"><input type="checkbox" [(ngModel)]="ack.accepted" /> {{ ack.label }}</label>
          }
          <div class="mt-6 flex gap-3">
            <button cui-button variant="secondary" type="button" (click)="backToForm()" [disabled]="store.phase() === 'submitting'">{{ t('back') }}</button>
            <button cui-button variant="primary" type="button" (click)="submit()" [disabled]="store.isBusy() || !acksAccepted()" data-testid="submit-response">{{ t(store.phase() === 'submitting' ? 'submitting' : 'submit') }}</button>
          </div>
        </cui-card>
      } @else if (store.session(); as session) {
        <cui-card padding="lg" data-testid="public-form">
          <div class="mb-5 flex items-baseline justify-between gap-4">
            <div><h1 id="respondent-page-heading" tabindex="-1" class="type-h2">{{ currentPage()?.title || 'Your response' }}</h1><p class="type-caption">{{ store.progressLabel() }}</p><p class="type-caption" aria-live="polite">{{ store.progressAnnouncement() }}</p></div>
            @if (supportedLocales().length > 1) { <label class="type-caption">{{ t('language') }} <select [ngModel]="language()" (ngModelChange)="store.changeLocale($event)">@for (locale of supportedLocales(); track locale) { <option [value]="locale">{{ locale }}</option> }</select></label> }
            @if (store.phase() === 'saving') { <span class="type-caption" aria-live="polite">{{ t('saving') }}</span> }
            @else if (store.queueSize()) { <span class="type-caption" aria-live="assertive">{{ t('notSaved') }} <button type="button" (click)="store.retrySave()">{{ t('retry') }}</button></span> }
            @else { <span class="type-caption">{{ t('saved') }}</span> }
          </div>
          @for (placement of currentPlacements(); track placement.key) {
            <si-respondent-control [field]="placement.field" [locale]="language()" [instanceId]="placement.instanceId" [cell]="answerForControl(placement.field)" [serverCell]="store.state().server?.answers?.[placement.field.id]" [invalid]="store.state().invalid" (operation)="store.apply($event)" (announcement)="store.announceStructure($event)" />
          }
          <p class="sr-only" aria-live="polite">{{ store.structureAnnouncement() }}</p>
          <div class="mt-8 flex justify-between gap-3">
            <button cui-button variant="secondary" type="button" (click)="store.navigate(-1)" [disabled]="!store.canMovePrevious()">{{ t('previous') }}</button>
            @if (store.canMoveNext()) { <button cui-button variant="primary" type="button" (click)="store.navigate(1)">{{ t('next') }}</button> } @else { <button cui-button variant="primary" type="button" (click)="store.openReview()" data-testid="review-response">{{ t('review') }}</button> }
          </div>
          @if (store.reviewReturnKey()) { <button class="mt-4" cui-button variant="secondary" type="button" (click)="store.returnToReview()">{{ t('returnReview') }}</button> }
          <button class="mt-5 type-caption" type="button" (click)="store.clearAndExit()">{{ t('clearExit') }}</button>
        </cui-card>
      }
      }
    </section>
  `,
})
export class PublicPageComponent implements OnInit {
  entryShareId: string | null = null;
  private readonly iframeOrigin = signal<string | null>(null);
  private readonly iframeBootstrap = signal<string | null>(null);
  private readonly iframeApprovedOrigin = signal<string | null>(null);
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
    effect(() => {
      const origin = this.iframeOrigin(); if (!origin) return;
      const phase = this.store.phase(); const error = this.store.error();
      const type = error ? 'error' : phase === 'receipt' ? 'completed' : 'progress';
      window.parent.postMessage({ protocol: 'smart-intake.v1', type, currentPageId: this.store.currentPageId(), requiredCount: this.store.requiredCount(), completedRequiredCount: this.store.completedRequiredCount(), ...(type === 'completed' && this.store.receiptId() ? { receiptId: this.store.receiptId() } : {}), ...(error ? { code: 'RESPONDENT_ERROR' } : {}) }, origin);
      queueMicrotask(() => window.parent.postMessage({ protocol: 'smart-intake.v1', type: 'resize', height: document.documentElement.scrollHeight }, origin));
    });
    effect(() => {
      const key = this.store.reviewReturnKey();
      if (this.store.phase() !== 'review' || !key) return;
      queueMicrotask(() => { const row=document.getElementById(`review-${this.safeId(key)}`); if(row)row.focus(); else document.getElementById('review-heading')?.focus(); this.store.completeReviewReturn(Boolean(row)); });
    });
    effect(() => {
      this.store.activePlacementKeys(); const active=document.activeElement as HTMLElement | null; const fieldRoot=active?.closest('[data-field-id]');
      queueMicrotask(() => { if (fieldRoot && !fieldRoot.isConnected) document.getElementById('respondent-page-heading')?.focus(); });
    });
  }

  ngOnInit(): void {
    this.entryShareId = this.route.snapshot.paramMap.get('shareId');
    const sessionId = this.route.snapshot.paramMap.get('sessionId');
    this.reviewRoute = this.route.snapshot.url.some((segment) => segment.path === 'review');
    this.receiptRoute = this.route.snapshot.url.some((segment) => segment.path === 'receipt');
    if (this.receiptRoute && sessionId) this.store.restoreReceipt(sessionId);
    if (sessionId && !this.store.session() && !this.testState && !this.receiptRoute) this.store.hydrate(sessionId, this.reviewRoute);
    else if (sessionId && this.reviewRoute && !this.store.review()?.reviewDigest) this.store.ensureReview();
    if (!this.testState && this.entryShareId && window.parent !== window) {
      addEventListener('message', (event) => {
        const message = event.data as { protocol?: string; type?: string; bootstrap?: string; parentOrigin?: string };
        if (event.source !== window.parent || message?.protocol !== 'smart-intake.v1' || message.type !== 'bootstrap' || typeof message.bootstrap !== 'string' || !message.bootstrap) return;
        this.iframeOrigin.set(event.origin);
        this.iframeBootstrap.set(message.bootstrap);
        this.iframeApprovedOrigin.set(typeof message.parentOrigin === 'string' ? message.parentOrigin : event.origin);
        window.parent.postMessage({ protocol: 'smart-intake.v1', type: 'ready', shareId: this.entryShareId }, event.origin);
      });
    }
  }

  get testMessage(): string { return `${this.testTitle} is ${this.testState}; real respondent session behavior is active without a test state.`; }

  start(): void { if (this.entryShareId) { const channel = this.route.snapshot.queryParamMap.get('channel'); if (channel) { if (window.parent === window) this.store.startFromTopLevelChannel(this.entryShareId, channel); else if (!this.iframeOrigin() || !this.iframeBootstrap() || !this.iframeApprovedOrigin()) this.store.error.set('Waiting for the approved embedding site to connect.'); else this.store.startFromChannel(this.entryShareId, channel, this.iframeBootstrap()!, this.iframeApprovedOrigin()!); } else this.store.start(this.entryShareId); } }
  currentPage() { return this.store.pages().find((page) => page.id === this.store.currentPageId()); }
  currentFields(): readonly RuntimeFieldDefinition[] { const ids = this.currentPage()?.fieldIds ?? []; return this.store.definition().fields.filter((field) => ids.includes(field.id) && !field.hidden); }
  currentPlacements(): readonly { key: string; instanceId?: string; field: RuntimeFieldDefinition }[] { const fields = new Map(this.store.definition().fields.map((field) => [field.id, field])); const placements = this.currentPage()?.placements ?? []; const active = new Set(this.store.activePlacementKeys()); return placements.flatMap((placement) => { const field = fields.get(placement.fieldId); const repeated = placements.filter((candidate) => candidate.fieldId === placement.fieldId).length > 1; const visible = !this.store.placementProjectionKnown() || [...active].some((key) => key.startsWith(`${placement.instanceId}|`)); return field && !field.hidden && visible ? [{ key: placement.instanceId, instanceId: repeated ? placement.instanceId : undefined, field }] : []; }); }
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
  reviewItems(): ReviewItem[] {
    const rows = this.store.review()?.review?.['answers'];
    return Array.isArray(rows) ? flattenAuthoritativeReview(rows, this.language()) : [];
  }
  backToForm(): void { const sessionId = this.store.session()?.sessionId; if (sessionId) void this.store.edit(this.currentFields()[0]?.id ?? ''); }
  submit(): void { this.store.submit(this.acknowledgmentFields().filter((ack) => ack.accepted).map(({ fieldId, rowPath, contentHash }) => ({ fieldId, rowPath, expectedContentHash: contentHash, accepted: true }))); }
  acksAccepted(): boolean { return this.acknowledgmentFields().every((ack) => ack.accepted); }
  direction(): 'ltr' | 'rtl' { const session = this.store.session(); const locale = session?.locale ?? String(session?.definition?.['defaultLocale'] ?? 'en'); return locale === 'ar' ? 'rtl' : 'ltr'; }
  language(): string { return this.store.session()?.locale ?? String(this.store.session()?.definition?.['defaultLocale'] ?? 'en'); }
  t(key: string): string { return PAGE_MESSAGES[this.language()]?.[key] ?? PAGE_MESSAGES['en'][key] ?? key; }
  supportedLocales(): string[] { const value=this.store.session()?.definition?.['supportedLocales']; return Array.isArray(value) ? value.filter((locale): locale is string => typeof locale === 'string') : [this.language()]; }
  invalidItems(): { key: string; fieldId: string; instanceId?: string; rowPath: { listFieldId: string; itemId: string }[] }[] { return Object.keys(this.store.state().invalid).map((key) => { const parts=key.replace(/^\//,'').split('/'); const fieldId=parts.pop() ?? ''; const rowPath=parts.flatMap((part) => { const split=part.indexOf(':'); return split > 0 ? [{listFieldId:part.slice(0,split),itemId:part.slice(split+1)}] : []; }); const instanceId=this.currentPlacements().find((placement)=>placement.field.id===fieldId)?.instanceId; return {key,fieldId,instanceId,rowPath}; }).filter((item)=>item.fieldId); }
  safeId(value: string): string { return value.replaceAll(/[^A-Za-z0-9_-]/g, '-'); }

  answer(field: RuntimeFieldDefinition): { status: string; value?: unknown } | undefined { return this.store.state().answers[field.id] ?? this.store.state().server?.answers[field.id]; }
  answerForControl(field: RuntimeFieldDefinition): InputAnswerCell | ServerAnswerCell | undefined {
    const server = this.store.state().server?.answers[field.id];
    return server?.status === 'notApplicable' ? server : this.store.state().answers[field.id] ?? server;
  }
  private acknowledgmentFields(): { key: string; fieldId: string; label: string; rowPath: { listFieldId: string; itemId: string }[]; contentHash: string; accepted: boolean }[] {
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
      const key = `${this.store.review()?.reviewDigest ?? ''}:${contentHash}:${fieldId}:${JSON.stringify(rowPath)}`;
      return [{
        key, fieldId, rowPath, contentHash,
        label: typeof value['content'] === 'string' ? value['content'] : this.label(this.store.definition().fields.find((field) => field.id === fieldId) ?? { id: fieldId, type: 'text' }),
        get accepted() { return state.get(key) ?? false; },
        set accepted(accepted: boolean) { state.set(key, accepted); },
      }];
    });
  }
}
const PAGE_MESSAGES: Record<string,Record<string,string>>={en:{answerErrors:'Answer errors',reviewErrors:'Answer errors:',goTo:'Go to',loading:'Loading your response…',returnReview:'Return to review',clearExit:'Clear this device and exit',startTitle:'Start your response',savedSecurely:'Your progress is saved securely as you go.',sharedDevice:'Shared device',start:'Start form',received:'Response received',thankYou:'Thank you. Your response has been submitted successfully.',startAnother:'Start another response',reviewTitle:'Review your response',checkAnswers:'Check your answers before submitting.',edit:'Edit',back:'Back to form',submitting:'Submitting…',submit:'Submit response',language:'Language',saving:'Saving…',notSaved:'Not saved',retry:'Retry',saved:'Saved',previous:'Previous',next:'Next',review:'Review response'},hi:{answerErrors:'उत्तर त्रुटियाँ',reviewErrors:'उत्तर त्रुटियाँ:',goTo:'यहाँ जाएँ',loading:'आपका उत्तर लोड हो रहा है…',returnReview:'समीक्षा पर लौटें',clearExit:'यह डिवाइस साफ़ करें और बाहर निकलें',startTitle:'अपना उत्तर शुरू करें',savedSecurely:'आपकी प्रगति सुरक्षित रूप से सहेजी जाती है।',sharedDevice:'साझा डिवाइस',start:'फ़ॉर्म शुरू करें',received:'उत्तर प्राप्त हुआ',thankYou:'धन्यवाद। आपका उत्तर सफलतापूर्वक जमा हो गया है।',startAnother:'एक और उत्तर शुरू करें',reviewTitle:'अपने उत्तर की समीक्षा करें',checkAnswers:'जमा करने से पहले अपने उत्तर जाँचें।',edit:'संपादित करें',back:'फ़ॉर्म पर वापस जाएँ',submitting:'जमा हो रहा है…',submit:'उत्तर जमा करें',language:'भाषा',saving:'सहेजा जा रहा है…',notSaved:'सहेजा नहीं गया',retry:'फिर प्रयास करें',saved:'सहेजा गया',previous:'पिछला',next:'अगला',review:'उत्तर की समीक्षा करें'},ar:{answerErrors:'أخطاء الإجابة',reviewErrors:'أخطاء الإجابة:',goTo:'انتقل إلى',loading:'جارٍ تحميل ردك…',returnReview:'العودة إلى المراجعة',clearExit:'مسح هذا الجهاز والخروج',startTitle:'ابدأ إجابتك',savedSecurely:'يتم حفظ تقدمك بأمان.',sharedDevice:'جهاز مشترك',start:'ابدأ النموذج',received:'تم استلام الرد',thankYou:'شكرًا لك. تم إرسال ردك بنجاح.',startAnother:'ابدأ ردًا آخر',reviewTitle:'راجع ردك',checkAnswers:'تحقق من إجاباتك قبل الإرسال.',edit:'تعديل',back:'العودة إلى النموذج',submitting:'جارٍ الإرسال…',submit:'إرسال الرد',language:'اللغة',saving:'جارٍ الحفظ…',notSaved:'غير محفوظ',retry:'إعادة المحاولة',saved:'تم الحفظ',previous:'السابق',next:'التالي',review:'مراجعة الرد'}};

function isRowPath(value: unknown): value is { listFieldId: string; itemId: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>)['listFieldId'] === 'string' && typeof (value as Record<string, unknown>)['itemId'] === 'string');
}
function display(answer: { status: string; value?: unknown } | undefined, locale: string): string { const labels=VALUE_MESSAGES[locale] ?? VALUE_MESSAGES['en']; if (!answer || answer.status === 'unanswered') return labels['unanswered']; if (answer.status !== 'answered') return labels[answer.status] ?? answer.status; if (Array.isArray(answer.value)) return answer.value.join(', '); if (typeof answer.value === 'boolean') return answer.value ? labels['yes'] : labels['no']; return String(answer.value ?? labels['unanswered']); }
type ReviewItem = { key: string; instanceId: string; fieldId: string; path: readonly { listFieldId: string; itemId: string }[]; rowPath: string; label: string; value: string };
function flattenAuthoritativeReview(rows: readonly unknown[], locale: string): ReviewItem[] {
  return rows.flatMap((candidate): ReviewItem[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const row = candidate as Record<string, unknown>;
    const fieldId = typeof row['fieldId'] === 'string' ? row['fieldId'] : '';
    const instanceId = typeof row['instanceId'] === 'string' ? row['instanceId'] : fieldId;
    const path = Array.isArray(row['rowPath']) ? row['rowPath'].filter(isRowPath) : [];
    const itemPath = typeof row['itemId'] === 'string' ? [...path, { listFieldId: fieldId, itemId: row['itemId'] }] : path;
    const children = Array.isArray(row['children']) ? flattenAuthoritativeReview(row['children'], locale) : [];
    if (children.length) return children;
    if (!fieldId) return [];
    const serialized = JSON.stringify(path);
    return [{ key: `${instanceId}:${serialized}:${String(row['itemId'] ?? '')}`, instanceId, fieldId, path, rowPath: serialized,
      label: typeof row['label'] === 'string' ? row['label'] : fieldId,
      value: row['status'] === 'answered' ? display({ status: 'answered', value: row['value'] }, locale) : typeof row['statusLabel'] === 'string' ? row['statusLabel'] : display({status:String(row['status'] ?? 'unanswered')},locale) }];
  });
}
const VALUE_MESSAGES: Record<string,Record<string,string>>={en:{unanswered:'Not answered',yes:'Yes',no:'No',unknown:'Unknown',declined:'Declined',respondentNotApplicable:'Not applicable'},hi:{unanswered:'उत्तर नहीं दिया',yes:'हाँ',no:'नहीं',unknown:'अज्ञात',declined:'उत्तर देने से मना किया',respondentNotApplicable:'लागू नहीं'},ar:{unanswered:'لم تتم الإجابة',yes:'نعم',no:'لا',unknown:'غير معروف',declined:'تم الرفض',respondentNotApplicable:'غير منطبق'}};
