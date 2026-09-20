import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'nav[appToolbar]',
  standalone: true,
  template: `
    <button class="pill" (click)="author.emit()">Author</button>
    <button class="pill" (click)="preview.emit()">Public preview</button>
    <button class="pill" [disabled]="saveDisabled" (click)="save.emit()">Save draft</button>
    <button class="pill" [disabled]="publishDisabled" (click)="publish.emit()">Publish</button>
    <button class="pill" (click)="definitionExport.emit()">Export definition</button>
    <label class="pill">Import definition<input type="file" accept="application/json" hidden [disabled]="importDisabled" (change)="definitionImport.emit($event)"></label>
    <button class="pill" (click)="responsesExport.emit()">Export responses</button>
    <button class="pill" (click)="responseAdmin.emit()">Response admin</button>
  `,
})
export class AppToolbarComponent {
  @Input() saveDisabled = false;
  @Input() publishDisabled = false;
  @Input() importDisabled = false;
  @Output() author = new EventEmitter<void>();
  @Output() preview = new EventEmitter<void>();
  @Output() save = new EventEmitter<void>();
  @Output() publish = new EventEmitter<void>();
  @Output() definitionExport = new EventEmitter<void>();
  @Output() definitionImport = new EventEmitter<Event>();
  @Output() responsesExport = new EventEmitter<void>();
  @Output() responseAdmin = new EventEmitter<void>();
}
