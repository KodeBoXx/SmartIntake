import { Component, computed, input, model, output } from '@angular/core';
import { CuiModalComponent } from '../../blocks/modal/modal.component';
import { CuiModalHeaderComponent } from '../../primitives/modal-header/modal-header.component';
import { CuiModalBodyComponent } from '../../primitives/modal-body/modal-body.component';
import { CuiModalFooterComponent } from '../../primitives/modal-footer/modal-footer.component';
import { CuiButtonComponent } from '../../primitives/button/button.component';
import { CuiIconComponent, CuiIconName } from '../../primitives/icon/icon.component';

export type CuiConfirmTone = 'default' | 'danger';

@Component({
  selector: 'cui-confirm-dialog',
  standalone: true,
  imports: [
    CuiModalComponent,
    CuiModalHeaderComponent,
    CuiModalBodyComponent,
    CuiModalFooterComponent,
    CuiButtonComponent,
    CuiIconComponent,
  ],
  templateUrl: './confirm-dialog.component.html',
})
export class CuiConfirmDialogComponent {
  // Two-way open state
  readonly open = model(false);

  // Content
  readonly title = input.required<string>();
  readonly message = input<string | undefined>(undefined);
  readonly confirmText = input<string>('Confirm');
  readonly cancelText = input<string>('Cancel');
  readonly tone = input<CuiConfirmTone>('default');
  readonly icon = input<CuiIconName | undefined>(undefined);

  // Events
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected readonly confirmVariant = computed<'primary' | 'danger'>(() =>
    this.tone() === 'danger' ? 'danger' : 'primary',
  );

  protected readonly iconClasses = computed(() => {
    const base = 'flex items-center justify-center w-14 h-14 rounded-full mb-1';
    return this.tone() === 'danger'
      ? `${base} bg-error-light text-error`
      : `${base} bg-emerald-500/10 text-emerald-500`;
  });

  protected onConfirm(): void {
    this.confirmed.emit();
    this.open.set(false);
  }

  protected onCancel(): void {
    this.cancelled.emit();
    this.open.set(false);
  }
}
