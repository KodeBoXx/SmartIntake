import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ResponseSummary } from './models/form-definition.models';

@Component({
  selector: 'section[appResponseAdmin]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex justify-between">
      <h2 class="type-h3">Response administration</h2>
      <input placeholder="Search receipt or form" [ngModel]="responseQuery" (ngModelChange)="responseQueryChange.emit($event)">
    </div>
    <div class="mt-3 grid gap-2">
      <button class="field-card text-left" *ngFor="let r of filteredResponses()" (click)="open.emit(r.id)">
        <span>{{r.id}}</span>
        <span>{{r.submittedAt}}</span>
      </button>
    </div>
    <aside *ngIf="responseDetail" class="mt-4 rounded-xl bg-stone-50 p-4">
      <div class="flex justify-between">
        <b>Authorized response detail</b>
        <button class="icon" (click)="close.emit()">×</button>
      </div>
      <pre class="overflow-auto text-xs">{{responseDetail|json}}</pre>
    </aside>
  `,
})
export class ResponseAdminComponent {
  @Input() responses: ResponseSummary[] = [];
  @Input() responseQuery = '';
  @Input() responseDetail: unknown = null;
  @Output() responseQueryChange = new EventEmitter<string>();
  @Output() open = new EventEmitter<string>();
  @Output() close = new EventEmitter<void>();

  filteredResponses(): ResponseSummary[] {
    const query = this.responseQuery.toLowerCase();
    return this.responses.filter((response) => JSON.stringify(response).toLowerCase().includes(query));
  }
}
