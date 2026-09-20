import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AppToolbarComponent } from './app-toolbar.component';

describe('AppToolbarComponent', () => {
  it('renders styled controls and emits each action output', () => {
    const fixture: ComponentFixture<AppToolbarComponent> = TestBed.createComponent(AppToolbarComponent);
    const component = fixture.componentInstance;
    const author = vi.fn();
    const preview = vi.fn();
    const save = vi.fn();
    const publish = vi.fn();
    const definitionExport = vi.fn();
    const definitionImport = vi.fn();
    const responsesExport = vi.fn();
    const responseAdmin = vi.fn();
    component.author.subscribe(author);
    component.preview.subscribe(preview);
    component.save.subscribe(save);
    component.publish.subscribe(publish);
    component.definitionExport.subscribe(definitionExport);
    component.definitionImport.subscribe(definitionImport);
    component.responsesExport.subscribe(responsesExport);
    component.responseAdmin.subscribe(responseAdmin);
    fixture.componentRef.setInput('responseViewerAllowed', true);
    fixture.componentRef.setInput('responseExporterAllowed', true);
    fixture.detectChanges();

    const control = (text: string) => [...fixture.nativeElement.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === text) as HTMLButtonElement;
    const authorButton = control('Author');
    const previewButton = control('Public preview');
    const saveButton = control('Save draft');
    const publishButton = control('Publish');
    const definitionExportButton = control('Export definition');
    const responsesExportButton = control('Export responses');
    const responseAdminButton = control('Response admin');
    const importInput = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;

    [authorButton, previewButton, saveButton, publishButton, definitionExportButton, responsesExportButton, responseAdminButton]
      .forEach((button) => expect(button.classList.contains('pill')).toBe(true));
    expect(importInput.closest('label')?.classList.contains('pill')).toBe(true);

    authorButton.click();
    previewButton.click();
    saveButton.click();
    publishButton.click();
    definitionExportButton.click();
    responsesExportButton.click();
    responseAdminButton.click();
    importInput.dispatchEvent(new Event('change'));

    expect(author).toHaveBeenCalledOnce();
    expect(preview).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(definitionExport).toHaveBeenCalledOnce();
    expect(definitionImport).toHaveBeenCalledWith(expect.any(Event));
    expect(responsesExport).toHaveBeenCalledOnce();
    expect(responseAdmin).toHaveBeenCalledOnce();
  });

  it('disables save, publish, and definition import while the parent reports an unsafe draft operation', () => {
    const fixture: ComponentFixture<AppToolbarComponent> = TestBed.createComponent(AppToolbarComponent);
    fixture.componentRef.setInput('saveDisabled', true);
    fixture.componentRef.setInput('publishDisabled', true);
    fixture.componentRef.setInput('importDisabled', true);
    fixture.detectChanges();

    const save = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Save draft') as HTMLButtonElement;
    const publish = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Publish') as HTMLButtonElement;
    const importInput = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    expect(save.disabled).toBe(true);
    expect(publish.disabled).toBe(true);
    expect(importInput.disabled).toBe(true);
  });

  it('hides response controls unless each exact response role is allowed', () => {
    const fixture: ComponentFixture<AppToolbarComponent> = TestBed.createComponent(AppToolbarComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Response admin');
    expect(fixture.nativeElement.textContent).not.toContain('Export responses');

    fixture.componentRef.setInput('responseViewerAllowed', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Response admin');
    expect(fixture.nativeElement.textContent).not.toContain('Export responses');
  });
});
