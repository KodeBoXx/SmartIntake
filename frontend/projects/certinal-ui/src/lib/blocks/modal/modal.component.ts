
import {
  Component,
  ElementRef,
  OnDestroy,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  DOCUMENT
} from '@angular/core';
import { CuiIconComponent } from '../../primitives/icon/icon.component';
import { CuiIconButtonComponent } from '../../primitives/icon-button/icon-button.component';

export type CuiModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

@Component({
  selector: 'cui-modal',
  standalone: true,
  imports: [CuiIconComponent, CuiIconButtonComponent],
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.css',
})
export class CuiModalComponent implements OnDestroy {
  private readonly elementRef: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly document = inject(DOCUMENT);

  // Two-way open state
  readonly open = model(false);

  // Configuration
  readonly size = input<CuiModalSize>('md');
  readonly closeOnOverlay = input(true, { transform: booleanAttribute });
  readonly closeOnEsc = input(true, { transform: booleanAttribute });
  readonly showClose = input(true, { transform: booleanAttribute });
  readonly ariaLabel = input<string | undefined>(undefined);

  // Events
  readonly opened = output<void>();
  readonly closed = output<void>();

  // Shared counter to coordinate body-scroll-lock across stacked modals
  private static scrollLockCount = 0;
  private scrollLockActive = false;
  private previouslyFocused: HTMLElement | null = null;

  protected readonly containerClasses = computed(
    () => `cui-modal-container cui-modal-container--${this.size()}`,
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        this.handleOpen();
      } else {
        this.handleClose();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.scrollLockActive) {
      this.releaseScrollLock();
    }
  }

  protected close(): void {
    if (this.open()) this.open.set(false);
  }

  protected onOverlayClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    if (!this.closeOnOverlay()) return;
    this.close();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.closeOnEsc()) {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'Tab') {
      this.handleTabKey(event);
    }
  }

  // ---------------- side effects on open/close ----------------
  private handleOpen(): void {
    this.acquireScrollLock();
    this.previouslyFocused = this.document.activeElement as HTMLElement | null;
    // Next microtask so the overlay is in the DOM before focusing
    queueMicrotask(() => this.focusFirst());
    this.opened.emit();
  }

  private handleClose(): void {
    if (this.scrollLockActive) this.releaseScrollLock();
    if (
      this.previouslyFocused &&
      typeof this.previouslyFocused.focus === 'function'
    ) {
      this.previouslyFocused.focus();
    }
    this.previouslyFocused = null;
    this.closed.emit();
  }

  // ---------------- focus management ----------------
  private getFocusables(): HTMLElement[] {
    const container = this.elementRef.nativeElement.querySelector(
      '.cui-modal-container',
    );
    if (!container) return [];
    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => el.offsetParent !== null || el.getClientRects().length > 0,
    );
  }

  private focusFirst(): void {
    const focusables = this.getFocusables();
    if (focusables.length > 0) {
      focusables[0].focus();
      return;
    }
    const container =
      this.elementRef.nativeElement.querySelector<HTMLElement>(
        '.cui-modal-container',
      );
    container?.focus();
  }

  private handleTabKey(event: KeyboardEvent): void {
    const focusables = this.getFocusables();
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.document.activeElement as HTMLElement | null;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ---------------- body scroll lock ----------------
  private acquireScrollLock(): void {
    if (this.scrollLockActive) return;
    if (CuiModalComponent.scrollLockCount === 0) {
      this.document.body.style.overflow = 'hidden';
    }
    CuiModalComponent.scrollLockCount++;
    this.scrollLockActive = true;
  }

  private releaseScrollLock(): void {
    if (!this.scrollLockActive) return;
    CuiModalComponent.scrollLockCount = Math.max(
      CuiModalComponent.scrollLockCount - 1,
      0,
    );
    if (CuiModalComponent.scrollLockCount === 0) {
      this.document.body.style.overflow = '';
    }
    this.scrollLockActive = false;
  }
}
