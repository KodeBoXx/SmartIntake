import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RespondentControlComponent } from './respondent-control.component';
import type { RuntimeFieldDefinition, RuntimeOperation } from '../../runtime/runtime-types';

describe('RespondentControlComponent', () => {
  let fixture: ComponentFixture<RespondentControlComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RespondentControlComponent] }).compileComponents();
    fixture = TestBed.createComponent(RespondentControlComponent);
  });

  it('emits an exact stable three-level row path for a nested scalar', () => {
    const field: RuntimeFieldDefinition = { id: 'outer', type: 'list', itemFields: [{ id: 'middle', type: 'list', itemFields: [{ id: 'inner', type: 'list', itemFields: [{ id: 'note', type: 'text' }] }] }] };
    fixture.componentRef.setInput('field', field);
    const note = { status: 'answered' as const, value: 'old' };
    const inner = { status: 'answered' as const, value: { items: [{ itemId: 'inner-1', fields: { note } }] } };
    const middle = { status: 'answered' as const, value: { items: [{ itemId: 'middle-1', fields: { inner } }] } };
    fixture.componentRef.setInput('cell', { status: 'answered', value: { items: [{ itemId: 'outer-1', fields: { middle } }] } });
    fixture.detectChanges();
    const nested = fixture.debugElement.queryAll(By.directive(RespondentControlComponent))
      .map((node) => node.componentInstance as RespondentControlComponent).find((control) => control.field().id === 'note')!;
    const operations: RuntimeOperation[] = [];
    nested.operation.subscribe((operation) => operations.push(operation));
    nested.set('updated');
    expect(operations).toEqual([{ kind: 'set', target: { fieldId: 'note', rowPath: [
      { listFieldId: 'outer', itemId: 'outer-1' }, { listFieldId: 'middle', itemId: 'middle-1' }, { listFieldId: 'inner', itemId: 'inner-1' },
    ] }, answer: { status: 'answered', value: 'updated' } }]);
  });

  it('uses stable IDs when reordering and deleting a 50-item dynamic matrix', () => {
    const field: RuntimeFieldDefinition = { id: 'matrix', type: 'list', itemFields: [{ id: 'score', type: 'integer' }] };
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('cell', { status: 'answered', value: { items: Array.from({ length: 50 }, (_, index) => ({ itemId: `row-${index + 1}`, fields: {} })) } });
    const operations: RuntimeOperation[] = [];
    fixture.componentInstance.operation.subscribe((operation) => operations.push(operation));
    fixture.detectChanges();
    fixture.componentInstance.move('row-50', 'row-1');
    fixture.componentInstance.remove('row-17');
    expect(operations).toEqual([
      { kind: 'moveItem', target: { fieldId: 'matrix', rowPath: undefined }, itemId: 'row-50', beforeItemId: 'row-1' },
      { kind: 'removeItem', target: { fieldId: 'matrix', rowPath: undefined }, itemId: 'row-17' },
    ]);
    expect(fixture.nativeElement.querySelector('[data-testid="add-list-item"]')).toBeNull();
  });
});
