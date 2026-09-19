import {
  Directive,
  ElementRef,
  HostListener,
  Renderer2,
  inject,
  input,
  OnDestroy,
} from '@angular/core';

export type CuiTooltipPosition = 'top' | 'bottom' | 'left' | 'right';

@Directive({
  selector: '[cuiTooltip]',
})
export class CuiTooltipDirective implements OnDestroy {
  readonly cuiTooltip = input<string>('');
  readonly tooltipPosition = input<CuiTooltipPosition>('top');

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly renderer = inject(Renderer2);
  private el: HTMLElement | null = null;

  @HostListener('mouseenter')
  @HostListener('focus')
  protected show(): void {
    const text = this.cuiTooltip();
    if (!text || this.el) return;

    const tip = this.renderer.createElement('div') as HTMLElement;
    tip.textContent = text;
    Object.assign(tip.style, {
      position: 'fixed',
      zIndex: '9999',
      padding: '6px 10px',
      fontFamily: 'var(--font-body, "DM Sans", system-ui, sans-serif)',
      fontSize: 'var(--t-100, 12px)',
      fontWeight: '500',
      color: '#FFFFFF',
      background: 'var(--color-slate-900, #0F172A)',
      borderRadius: 'var(--r-md, 6px)',
      boxShadow: 'var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.1))',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      opacity: '0',
      transition: 'opacity 150ms ease-out',
    });
    this.renderer.appendChild(document.body, tip);

    const rect = this.host.nativeElement.getBoundingClientRect();
    const pos = this.position(rect);
    tip.style.left = `${pos.left}px`;
    tip.style.top = `${pos.top}px`;
    tip.style.transform = pos.transform;

    requestAnimationFrame(() => (tip.style.opacity = '1'));
    this.el = tip;
  }

  @HostListener('mouseleave')
  @HostListener('blur')
  protected hide(): void {
    this.removeTip();
  }

  ngOnDestroy(): void {
    this.removeTip();
  }

  private removeTip(): void {
    if (this.el) {
      this.renderer.removeChild(document.body, this.el);
      this.el = null;
    }
  }

  private position(rect: DOMRect): { left: number; top: number; transform: string } {
    switch (this.tooltipPosition()) {
      case 'bottom':
        return {
          left: rect.left + rect.width / 2,
          top: rect.bottom + 8,
          transform: 'translateX(-50%)',
        };
      case 'left':
        return {
          left: rect.left - 8,
          top: rect.top + rect.height / 2,
          transform: 'translate(-100%, -50%)',
        };
      case 'right':
        return {
          left: rect.right + 8,
          top: rect.top + rect.height / 2,
          transform: 'translateY(-50%)',
        };
      default:
        return {
          left: rect.left + rect.width / 2,
          top: rect.top - 8,
          transform: 'translate(-50%, -100%)',
        };
    }
  }
}
