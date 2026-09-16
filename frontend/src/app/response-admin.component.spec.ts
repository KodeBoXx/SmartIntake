import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ResponseAdminComponent } from './response-admin.component';

describe('ResponseAdminComponent', () => {
  it('filters from its rendered search control and emits selected receipts', () => {
    const fixture: ComponentFixture<ResponseAdminComponent> = TestBed.createComponent(ResponseAdminComponent);
    fixture.componentRef.setInput('responses', [{ id: 'receipt-1', submittedAt: '2026-09-16' }, { id: 'receipt-2', formKey: 'other' }]);
    const queryChange = vi.fn();
    const opened = vi.fn();
    fixture.componentInstance.responseQueryChange.subscribe(queryChange);
    fixture.componentInstance.open.subscribe(opened);
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector('input[placeholder="Search receipt or form"]') as HTMLInputElement;
    search.value = 'receipt-1';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.field-card') as HTMLButtonElement;

    expect(queryChange).toHaveBeenCalledWith('receipt-1');
    expect(card.textContent).toContain('receipt-1');
    expect(card.classList.contains('field-card')).toBe(true);
    card.click();
    expect(opened).toHaveBeenCalledWith('receipt-1');
  });

  it('renders the styled close control and emits close', () => {
    const fixture: ComponentFixture<ResponseAdminComponent> = TestBed.createComponent(ResponseAdminComponent);
    fixture.componentRef.setInput('responseDetail', { id: 'receipt-1' });
    const close = vi.fn();
    fixture.componentInstance.close.subscribe(close);
    fixture.detectChanges();

    const closeButton = fixture.nativeElement.querySelector('aside .icon') as HTMLButtonElement;
    expect(closeButton.classList.contains('icon')).toBe(true);
    closeButton.click();
    expect(close).toHaveBeenCalledOnce();
  });
});
