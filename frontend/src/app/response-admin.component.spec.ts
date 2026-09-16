import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ResponseAdminComponent } from './response-admin.component';

describe('ResponseAdminComponent', () => {
  it('filters by the current query and emits the selected receipt', () => {
    const fixture: ComponentFixture<ResponseAdminComponent> = TestBed.createComponent(ResponseAdminComponent);
    fixture.componentRef.setInput('responses', [{ id: 'receipt-1', submittedAt: '2026-09-16' }, { id: 'receipt-2', formKey: 'other' }]);
    fixture.componentRef.setInput('responseQuery', 'receipt-1');
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredResponses()).toEqual([{ id: 'receipt-1', submittedAt: '2026-09-16' }]);
    let opened = '';
    fixture.componentInstance.open.subscribe((id) => opened = id);
    (fixture.nativeElement.querySelector('.field-card') as HTMLButtonElement).click();
    expect(opened).toBe('receipt-1');
  });
});
