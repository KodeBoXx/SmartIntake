import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiDataTableComponent, CuiDrawerComponent, CuiEmptyStateComponent, CuiPopoverComponent, CuiStatsStripComponent, CuiDropdownComponent, CuiConfirmDialogComponent, CuiIconComponent, CuiToastService } from '@certinal/ui';
import { M5StubState } from '../../core/m5-session.store';
import { m5RouteState, titleCase } from '../../shared/m5-route-state';

interface StubRow { id: string; name: string; status: string; }
const rows: StubRow[] = [{ id: 'demo-form', name: 'Clinical history intake', status: 'Draft' }];

@Component({
  standalone: true,
  imports: [CuiAlertComponent, CuiButtonComponent, CuiCardComponent, CuiDataTableComponent, CuiDrawerComponent, CuiEmptyStateComponent, CuiStatsStripComponent, CuiPopoverComponent, CuiDropdownComponent, CuiConfirmDialogComponent, CuiIconComponent],
  template: `
    <section data-testid="staff-page">
      <div class="flex flex-wrap items-center justify-between gap-3"><div><p class="type-caption">STAFF WORKSPACE</p><h1 class="type-h3">{{ title }}</h1></div><cui-button (buttonClick)="notify()">Create or edit</cui-button></div>
      @if (isAlertState()) { <cui-alert class="mt-4" [variant]="state === 'denied' || state === 'invalid' ? 'error' : 'warning'" [title]="state">{{ stateMessage }}</cui-alert> }
      @if (state === 'loading') { <cui-card class="mt-5"><p class="type-body">Loading {{ title.toLowerCase() }}…</p></cui-card> }
      @else if (state === 'empty' || state === 'denied' || state === 'email-unavailable') { <cui-empty-state class="mt-5" icon="inbox" [title]="state === 'empty' ? 'Nothing here yet' : 'No access'" [description]="stateMessage" /> }
      @else {
        <cui-stats-strip class="mt-5" [items]="stats" />
        <cui-card class="mt-5"><cui-data-table [columns]="columns" [rows]="rows" rowKey="id" [clickable]="true" (rowClick)="openDetails($event.id)" /></cui-card>
      }
      <cui-popover class="mt-4"><cui-button cuiPopoverTrigger variant="secondary">Quick status</cui-button><p cuiPopoverContent class="type-body">Quick mutations use this anchored popover.</p></cui-popover>
      <cui-dropdown class="mt-4" [items]="quickActions" (itemClick)="notify()"><cui-button cuiDropdownTrigger variant="tertiary">More actions</cui-button></cui-dropdown>
      <cui-confirm-dialog [(open)]="confirmOpen" title="Archive draft?" message="This is a M5-only confirmation stub." tone="danger" confirmText="Archive" (confirmed)="notify()" />
      <cui-drawer [(open)]="detailsOpen" position="right" size="lg" [title]="title + ' details'" [showClose]="false"><p class="type-body">Deep-linked detail for {{ detailId() }}.</p><p class="type-caption">M5 route stub; data authority remains M6+.</p><div cuiDrawerFooter class="flex justify-end gap-3 flex-wrap"><cui-button variant="tertiary" (buttonClick)="closeDetails()"><span class="flex items-center gap-1.5"><cui-icon name="close" size="sm" />Close detail</span></cui-button></div></cui-drawer>
    </section>
  `,
})
export class StaffPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(CuiToastService);
  readonly screen = this.route.snapshot.data['screen'] as string;
  readonly title = titleCase(this.screen);
  readonly state: M5StubState = m5RouteState(this.route);
  readonly rows = rows;
  readonly columns = [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }];
  readonly stats = [{ icon: 'file-text', value: 1, label: 'Visible', accent: 'emerald' as const }, { icon: 'clock', value: 0, label: 'Pending', accent: 'cyan' as const }, { icon: 'database', value: 0, label: 'Archived', accent: 'lime' as const }];
  readonly quickActions = [{ label: 'Mark reviewed' }, { label: 'Archive', destructive: true }];
  readonly detailId = signal(this.route.snapshot.queryParamMap.get('details'));
  confirmOpen = false;
  readonly detailsOpen = signal(false);
  constructor() { this.route.queryParamMap.subscribe((params) => { this.detailId.set(params.get('details')); if (params.get('details')) queueMicrotask(() => this.detailsOpen.set(true)); }); }
  get stateMessage(): string { return `The ${this.title.toLowerCase()} M5 stub is ${this.state}. Real authority is deferred to M6.`; }
  isAlertState(): boolean { return ['invalid', 'denied', 'expired', 'email-unavailable', 'conflict'].includes(this.state); }
  openDetails(id: string): void { this.detailId.set(id); this.detailsOpen.set(true); void this.router.navigate([], { relativeTo: this.route, queryParams: { details: id }, queryParamsHandling: 'merge' }); }
  closeDetails(): void { if (!this.detailId()) return; this.detailsOpen.set(false); this.detailId.set(null); void this.router.navigate([], { relativeTo: this.route, queryParams: { details: null }, queryParamsHandling: 'merge' }); }
  notify(): void { this.toast.success(`${this.title} action recorded in the M5 shell.`); }
}
