import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, ViewChild, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { CuiAlertComponent } from '@certinal/ui';
import type {
  InputAnswerCell,
  ListItem,
  RowPath,
  RuntimeFieldDefinition,
  RuntimeOperation,
  ServerAnswerCell,
} from '../../runtime/runtime-types';

type Cell = InputAnswerCell | ServerAnswerCell | undefined;

/**
 * A recursively rendered respondent control. A row path is extended only when
 * entering a list item, so every nested operation is addressed by stable IDs.
 */
@Component({
  selector: 'si-respondent-control',
  standalone: true,
  imports: [CommonModule, FormsModule, CuiAlertComponent],
  template: `
    @if (!field().hidden && serverCell()?.status !== 'notApplicable' && cell()?.status !== 'notApplicable') {
      <div class="mb-5" [attr.data-field-id]="field().id" [attr.data-row-path]="rowPathKey()">
        @if (!['object', 'list', 'multiChoice', 'attachments', 'drawing'].includes(field().type)) { <label class="type-label mb-1 block" [for]="controlId()">{{ label(field()) }}</label> }
        @else if (field().type !== 'multiChoice') { <div class="type-label mb-1">{{ label(field()) }}</div> }
        @if (field().type === 'object') {
          <div class="ml-3 border-l pl-4" data-testid="object-control">
            @for (child of field().fields || []; track child.id) {
              <si-respondent-control [field]="child" [cell]="objectCell(child.id)" [serverCell]="objectServerCell(child.id)" [invalid]="invalid()" [rowPath]="rowPath()" (operation)="operation.emit($event)" />
            }
          </div>
        } @else if (field().type === 'list') {
          <div [attr.data-testid]="field().fixedRows ? 'fixed-matrix-control' : 'dynamic-matrix-control'">
            @for (item of items(); track item.itemId; let index = $index) {
              <fieldset class="mb-3 border p-3" [attr.data-item-id]="item.itemId">
                <legend class="type-caption">{{ field().fixedRows ? 'Row' : 'Item' }} {{ index + 1 }}</legend>
                @for (child of field().itemFields || []; track child.id) {
                  <si-respondent-control [field]="child" [cell]="item.fields[child.id]" [serverCell]="itemServerCell(item.itemId, child.id)" [invalid]="invalid()" [rowPath]="childPath(item.itemId)" (operation)="operation.emit($event)" />
                }
                @if (!field().fixedRows) {
                  <div class="flex flex-wrap gap-2">
                    <button cui-button size="sm" type="button" [disabled]="index === 0" (click)="move(item.itemId, items()[index - 1]?.itemId)">Move up</button>
                    <button cui-button size="sm" type="button" [disabled]="index === items().length - 1" (click)="move(item.itemId, items()[index + 2]?.itemId)">Move down</button>
                    <button cui-button size="sm" type="button" (click)="remove(item.itemId)">Remove</button>
                  </div>
                }
              </fieldset>
            }
            @if (!field().fixedRows && items().length < 50 && rowPath().length < 3) {
              <button cui-button variant="secondary" type="button" (click)="add()" data-testid="add-list-item">Add item</button>
            }
          </div>
        } @else if (field().type === 'attachments' || field().type === 'drawing') {
          <div #control [id]="controlId()" tabindex="-1"><cui-alert variant="info" title="Secure {{ field().type }}">{{ cell()?.status === 'answered' ? 'Ready' : 'Secure capture is unavailable in this channel.' }}</cui-alert></div>
        } @else if (field().type === 'boolean') {
          <select #control [id]="controlId()" class="w-full" [disabled]="protected()" [attr.aria-invalid]="invalidReason() ? 'true' : null" [attr.aria-describedby]="invalidReason() ? errorId() : null" [ngModel]="booleanValue()" (ngModelChange)="setBoolean($event)">
            <option [ngValue]="null">Select an answer</option><option [ngValue]="true">Yes</option><option [ngValue]="false">No</option>
          </select>
        } @else if (field().type === 'choice') {
          <select #control [id]="controlId()" class="w-full" [disabled]="protected()" [attr.aria-invalid]="invalidReason() ? 'true' : null" [attr.aria-describedby]="invalidReason() ? errorId() : null" [ngModel]="textValue()" (ngModelChange)="set($event)">
            <option value="">Select an answer</option>@for (option of field().options || []; track option) { <option [value]="option">{{ field().optionLabels?.[option] || option }}</option> }
          </select>
        } @else if (field().type === 'multiChoice') {
          <fieldset><legend class="type-label mb-1">{{ label(field()) }}</legend>@for (option of field().options || []; track option) { <label class="mr-4 inline-flex gap-2"><input #control type="checkbox" [checked]="multiValue().includes(option)" [disabled]="protected()" (change)="toggleChoice(option, $any($event.target).checked)" />{{ field().optionLabels?.[option] || option }}</label> }</fieldset>
        } @else if (field().type === 'text' && (field().maxLength || 0) > 120) {
          <textarea #control [id]="controlId()" class="w-full" rows="4" [disabled]="protected()" [attr.aria-invalid]="invalidReason() ? 'true' : null" [attr.aria-describedby]="invalidReason() ? errorId() : null" [ngModel]="textValue()" (ngModelChange)="set($event)"></textarea>
        } @else {
          <input #control [id]="controlId()" class="w-full" [type]="inputType()" [disabled]="protected()" [attr.aria-invalid]="invalidReason() ? 'true' : null" [attr.aria-describedby]="invalidReason() ? errorId() : null" [attr.min]="field().min" [attr.max]="field().max" [attr.step]="field().step" [ngModel]="textValue()" (ngModelChange)="set($event)" />
        }
        @if (invalidReason()) { <p [id]="errorId()" class="type-caption text-error" role="alert">This answer has an invalid value.</p> }
        @if (!protected() && (field().allowUnknown || field().allowDeclined || field().allowNotApplicable)) {
          <div class="mt-2 flex flex-wrap gap-2"><button cui-button size="sm" variant="secondary" type="button" (click)="clear()">Clear</button>@if (field().allowUnknown) { <button cui-button size="sm" variant="secondary" type="button" (click)="status('unknown')">Unknown</button> } @if (field().allowDeclined) { <button cui-button size="sm" variant="secondary" type="button" (click)="status('declined')">Decline</button> } @if (field().allowNotApplicable) { <button cui-button size="sm" variant="secondary" type="button" (click)="status('respondentNotApplicable')">Not applicable</button> }</div>
        }
      </div>
    }
  `,
})
export class RespondentControlComponent implements AfterViewInit {
  private readonly route = inject(ActivatedRoute, { optional: true });
  @ViewChild('control') private readonly control?: ElementRef<HTMLElement>;
  readonly field = input.required<RuntimeFieldDefinition>();
  readonly instanceId = input<string>();
  readonly cell = input<Cell>();
  readonly serverCell = input<ServerAnswerCell>();
  readonly invalid = input<Readonly<Record<string, string>>>({});
  readonly rowPath = input<RowPath>([]);
  readonly operation = output<RuntimeOperation>();

  ngAfterViewInit(): void {
    if (this.route?.snapshot.queryParamMap.get('focus') === this.controlId()) queueMicrotask(() => this.control?.nativeElement.focus());
  }

  label(field: RuntimeFieldDefinition): string { return field.label ?? field.id.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()); }
  protected(): boolean { return Boolean(this.field().readOnly || this.field().calculated); }
  inputType(): string { const type = this.field().type; return type === 'integer' || type === 'decimal' ? 'number' : type === 'dateTime' ? 'datetime-local' : ['date', 'time'].includes(type) ? type : 'text'; }
  textValue(): string {
    const value = cellValue(this.cell());
    if (typeof value === 'string') return value;
    if (this.field().type === 'dateTime' && value && typeof value === 'object' && 'instant' in value) {
      const date = new Date(String(value.instant));
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
      return Number.isNaN(local.getTime()) ? '' : local.toISOString().slice(0, 16);
    }
    return '';
  }
  booleanValue(): boolean | null { const value = cellValue(this.cell()); return typeof value === 'boolean' ? value : null; }
  multiValue(): readonly string[] { const value = cellValue(this.cell()); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
  items(): readonly ListItem<InputAnswerCell | ServerAnswerCell>[] { const value = cellValue(this.cell()); return value && typeof value === 'object' && 'items' in value ? (value as { items: readonly ListItem<InputAnswerCell | ServerAnswerCell>[] }).items : []; }
  objectCell(id: string): Cell { const value = cellValue(this.cell()); return value && typeof value === 'object' && 'fields' in value ? (value as { fields: Record<string, Cell> }).fields[id] : undefined; }
  objectServerCell(id: string): ServerAnswerCell | undefined { const value = cellValue(this.serverCell()); return value && typeof value === 'object' && 'fields' in value ? (value as { fields: Record<string, ServerAnswerCell> }).fields[id] : undefined; }
  itemServerCell(itemId: string, id: string): ServerAnswerCell | undefined { const value = cellValue(this.serverCell()); return value && typeof value === 'object' && 'items' in value ? (value as { items: readonly ListItem<ServerAnswerCell>[] }).items.find((item) => item.itemId === itemId)?.fields[id] : undefined; }
  rowPathKey(): string { return this.rowPath().map((segment) => `${segment.listFieldId}:${segment.itemId}`).join('/'); }
  controlId(): string { const base = `${this.instanceId() ? `${this.instanceId()}-` : ''}${this.field().id}`; return this.rowPathKey() ? `${base}-${this.rowPathKey().replaceAll(/[^A-Za-z0-9_-]/g, '-')}` : base; }
  errorId(): string { return `${this.controlId()}-error`; }
  invalidReason(): string | undefined { const path = this.rowPathKey(); return this.invalid()[`${path ? `${path}/` : '/'}${this.field().id}`]; }
  childPath(itemId: string): RowPath { return [...this.rowPath(), { listFieldId: this.field().id, itemId }]; }
  set(raw: string): void {
    const type = this.field().type;
    if (!raw) { this.clear(); return; }
    const parsed = type === 'dateTime' ? new Date(raw) : null;
    if (parsed && Number.isNaN(parsed.getTime())) return;
    const value = parsed ? { instant: parsed.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
      : type === 'time' ? normalizeTime(raw) : raw;
    this.operation.emit({ kind: 'set', target: this.target(), answer: { status: 'answered', value } });
  }
  setBoolean(raw: boolean | null): void { if (raw !== null) this.operation.emit({ kind: 'set', target: this.target(), answer: { status: 'answered', value: raw } }); }
  clear(): void { this.operation.emit({ kind: 'clear', target: this.target() }); }
  status(status: 'unknown' | 'declined' | 'respondentNotApplicable'): void { this.operation.emit({ kind: 'set', target: this.target(), answer: { status } }); }
  add(): void { this.operation.emit({ kind: 'addItem', target: this.target(), itemId: `item_${crypto.randomUUID().replaceAll('-', '')}` }); }
  remove(itemId: string): void { this.operation.emit({ kind: 'removeItem', target: this.target(), itemId }); }
  move(itemId: string, beforeItemId?: string): void { this.operation.emit({ kind: 'moveItem', target: this.target(), itemId, beforeItemId }); }
  toggleChoice(option: string, checked: boolean): void { const values = new Set(this.multiValue()); checked ? values.add(option) : values.delete(option); this.operation.emit({ kind: 'set', target: this.target(), answer: { status: 'answered', value: [...values] } }); }
  private target() { return { fieldId: this.field().id, rowPath: this.rowPath().length ? this.rowPath() : undefined }; }
}

function cellValue(cell: Cell): unknown { return cell?.status === 'answered' ? cell.value : undefined; }
function normalizeTime(value: string): string { return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value; }
