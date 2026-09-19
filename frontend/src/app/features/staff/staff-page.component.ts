import { DOCUMENT } from '@angular/common';
import { Component, HostListener, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiDataTableComponent, CuiDrawerComponent, CuiEmptyStateComponent, CuiPopoverComponent, CuiStatsStripComponent, CuiDropdownComponent, CuiConfirmDialogComponent, CuiIconComponent, CuiToastService } from '@certinal/ui';
import { M5StubState } from '../../core/m5-session.store';
import { m5RouteState, titleCase } from '../../shared/m5-route-state';

interface StubRow { id: string; name: string; status: string; }
const rows: StubRow[] = [{ id: 'demo-form', name: 'Clinical history intake', status: 'Draft' }];

@Component({
  selector: 'app-staff-page',
  standalone: true,
  imports: [CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiDataTableComponent, CuiDrawerComponent, CuiEmptyStateComponent, CuiStatsStripComponent, CuiPopoverComponent, CuiDropdownComponent, CuiConfirmDialogComponent, CuiIconComponent],
  template: `
    <section class="mx-auto max-w-6xl space-y-5" data-testid="staff-page" [attr.data-state]="state">
      <div class="flex flex-wrap items-center justify-between gap-3"><div><p class="type-caption">STAFF WORKSPACE</p><h1 class="type-h3">{{ title }}</h1><p class="type-caption" data-testid="state-evidence">State: {{ state }}</p></div>@if (primaryAction && actionsAllowed) { <cui-button (buttonClick)="edit()"><span class="flex items-center gap-1.5"><cui-icon name="pencil" size="sm" />{{ primaryAction }}</span></cui-button> }</div>
      @if (isAlertState()) { <cui-alert class="mt-4" [variant]="state === 'denied' || state === 'invalid' || state === 'no-access' ? 'error' : 'warning'" [title]="state">{{ stateMessage }}</cui-alert> }
      @if (state === 'loading') { <cui-card class="mt-5"><p class="type-body">Loading {{ title.toLowerCase() }}…</p></cui-card> }
      @else if (isEmptyState()) { <cui-empty-state class="mt-5" icon="inbox" [title]="state === 'empty' ? 'Nothing here yet' : 'No access'" [description]="stateMessage" /> }
      @else {
        <cui-stats-strip class="mt-5" [items]="stats" />
        <cui-card class="mt-5"><cui-data-table [columns]="columns" [rows]="rows" rowKey="id" /></cui-card>
        @if (actionsAllowed && recordActionsAllowed) { <div class="mt-4 flex flex-wrap items-center justify-between gap-3"><p class="type-caption">Actions</p><div class="flex flex-wrap gap-2"><cui-button size="sm" variant="secondary" (buttonClick)="openDetails(rows[0].id)"><span class="flex items-center gap-1.5"><cui-icon name="eye" size="sm" />View</span></cui-button><cui-button size="sm" variant="danger" (buttonClick)="confirmOpen = true"><span class="flex items-center gap-1.5"><cui-icon name="trash-2" size="sm" />Archive</span></cui-button></div></div> }
      }
      @if (actionsAllowed) {
        <cui-popover class="mt-4"><cui-button cuiPopoverTrigger variant="secondary">Quick status</cui-button><p cuiPopoverContent class="type-body">Quick mutations use this anchored popover.</p></cui-popover>
        <cui-dropdown class="mt-4" [items]="quickActions" (itemClick)="notify()"><cui-button cuiDropdownTrigger variant="tertiary">More actions</cui-button></cui-dropdown>
      }
      <cui-confirm-dialog [(open)]="confirmOpen" title="Archive draft?" message="This M5-only confirmation stub has no server side effect." tone="danger" icon="trash-2" confirmText="Archive" (confirmed)="archive()" />
      <cui-drawer tabindex="-1" [(open)]="detailsOpen" (closed)="onDrawerClosed()" position="right" size="lg" [title]="title + ' details'" [showClose]="false">
        <p class="type-body">Deep-linked detail for {{ detailId() }}.</p><p class="type-caption">M5 route stub; data authority remains M6+.</p>
        <div cuiDrawerFooter class="flex justify-end gap-3 flex-wrap"><cui-button variant="tertiary" (buttonClick)="closeDetails()"><span class="flex items-center gap-1.5"><cui-icon name="close" size="sm" />Close detail</span></cui-button></div>
      </cui-drawer>
    </section>
  `,
})
export class StaffPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(CuiToastService);
  private readonly document = inject(DOCUMENT);
  private returnFocus: HTMLElement | null = null;
  private drawerHasOpened = false;
  readonly screen = this.route.snapshot.data['screen'] as string;
  readonly title = titleCase(this.screen);
  readonly state: M5StubState = m5RouteState(this.route);
  readonly rows = rows;
  readonly columns = [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }];
  readonly stats = [{ icon: 'file-text', value: 1, label: 'Visible', accent: 'emerald' as const }, { icon: 'clock', value: 0, label: 'Pending', accent: 'cyan' as const }, { icon: 'database', value: 0, label: 'Archived', accent: 'lime' as const }];
  readonly quickActions = [{ label: 'Mark reviewed' }];
  readonly detailId = signal(this.route.snapshot.queryParamMap.get('details'));
  readonly detailsOpen = signal(false);
  confirmOpen = false;

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      this.detailId.set(params.get('details'));
      if (params.get('details')) queueMicrotask(() => this.openDrawerAndFocus());
    });
  }

  get primaryAction(): string { return this.screen === 'catalog' ? 'Create form' : this.screen === 'builder' ? 'Save draft' : ''; }
  get actionsAllowed(): boolean { return !['loading', 'empty-or-no-access', 'invalid', 'denied', 'no-access', 'expired', 'email-unavailable', 'no-side-effects', 'error', 'stale', 'tombstone', 'pending'].includes(this.state); }
  get recordActionsAllowed(): boolean { return ['catalog', 'responses', 'response-detail', 'user-list', 'user-detail'].includes(this.screen); }
  get stateMessage(): string { return `The ${this.title.toLowerCase()} M5 stub is ${this.state}. Real authority is deferred to M6.`; }
  isAlertState(): boolean { return ['invalid', 'denied', 'no-access', 'expired', 'email-unavailable', 'conflict', 'throttled', 'error', 'stale', 'tombstone', 'pending'].includes(this.state); }
  isEmptyState(): boolean { return ['empty', 'empty-or-no-access', 'denied', 'no-access', 'email-unavailable'].includes(this.state); }

  edit(): void {
    if (!this.actionsAllowed) return;
    if (this.screen === 'builder') { this.notify(); return; }
    void this.router.navigateByUrl('/workspaces/demo/forms/new');
  }

  navigate(url: string): void { void this.router.navigateByUrl(url); }

  openDetails(id: string): void {
    this.returnFocus = this.document.activeElement instanceof HTMLElement ? this.document.activeElement : null;
    this.detailId.set(id);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { details: id }, queryParamsHandling: 'merge' });
  }

  closeDetails(): void {
    this.detailsOpen.set(false);
    this.syncDrawerUrl();
  }

  onDrawerClosed(): void {
    if (!this.drawerHasOpened) return;
    this.detailsOpen.set(false);
    this.syncDrawerUrl();
    const returnFocus = this.returnFocus;
    this.returnFocus = null;
    if (returnFocus) queueMicrotask(() => returnFocus.focus());
    this.drawerHasOpened = false;
  }

  archive(): void { this.toast.success(`${this.title} archive was confirmed in the M5 shell.`); }
  notify(): void { this.toast.success(`${this.title} action recorded in the M5 shell.`); }

  @HostListener('document:keydown', ['$event'])
  trapDrawerFocus(event: KeyboardEvent): void {
    if (!this.detailsOpen() || event.key !== 'Tab') return;
    const dialog = this.document.querySelector('cui-drawer [role="dialog"]') as HTMLElement | null;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (this.document.activeElement === first || this.document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && this.document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  private openDrawerAndFocus(): void {
    this.drawerHasOpened = true;
    this.detailsOpen.set(true);
    setTimeout(() => (this.document.querySelector('cui-drawer [role="dialog"]') as HTMLElement | null)?.focus());
  }

  private syncDrawerUrl(): void {
    if (!this.detailId()) return;
    this.detailId.set(null);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { details: null }, queryParamsHandling: 'merge' });
  }
}
