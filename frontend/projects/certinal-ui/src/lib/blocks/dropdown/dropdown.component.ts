import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  afterNextRender,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CuiIconComponent, CuiIconName } from '../../primitives/icon/icon.component';

export type CuiDropdownPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'top-start'
  | 'top-end';

export type CuiDropdownItemType = 'item' | 'divider' | 'header';

export interface CuiDropdownItem {
  type?: CuiDropdownItemType;
  label?: string;
  icon?: CuiIconName;
  disabled?: boolean;
  destructive?: boolean;
  data?: unknown;
}

@Component({
  selector: 'cui-dropdown',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './dropdown.component.html',
  host: {
    class: 'inline-block relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
})
export class CuiDropdownComponent implements OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);

  /** Tracks the teleported menu node so we can remove it on destroy. */
  private teleportedMenu: HTMLElement | null = null;

  readonly items = input.required<CuiDropdownItem[]>();
  readonly placement = input<CuiDropdownPlacement>('bottom-end');
  readonly disabled = input(false, { transform: booleanAttribute });

  readonly itemClick = output<CuiDropdownItem>();

  protected readonly isOpen = signal(false);

  /** Template ref to the menu <ul> so we can teleport it to document.body
   *  on open — escaping any ancestor that creates a containing block for
   *  fixed-positioned descendants (transform, filter, will-change, etc.). */
  protected readonly menuRef = viewChild<ElementRef<HTMLElement>>('menuRef');

  /** Computed position for the menu — set on open so the fixed-positioned menu
   *  escapes any parent stacking context (e.g., a sticky table cell). */
  protected readonly menuStyle = signal<Record<string, string>>({});

  readonly menuClasses = computed(() =>
    [
      'min-w-[180px]',
      'bg-bg-surface border border-border-default rounded-lg shadow-lg',
      'py-1 px-1',
      'list-none m-0',
    ].join(' '),
  );

  protected toggle(): void {
    if (this.disabled()) return;
    const opening = !this.isOpen();
    if (opening) {
      this.updateMenuPosition();
    }
    this.isOpen.update((v) => !v);
    if (opening) {
      // After Angular renders the @if block, teleport the menu to document.body
      // so its `position: fixed` truly escapes the table's stacking context.
      afterNextRender(
        () => {
          const menu = this.menuRef()?.nativeElement;
          if (menu && menu.parentElement !== document.body) {
            document.body.appendChild(menu);
            this.teleportedMenu = menu;
          }
        },
        { injector: this.injector },
      );
    }
  }

  private updateMenuPosition(): void {
    const triggerEl = this.elementRef.nativeElement.querySelector(
      '.cui-dropdown-trigger',
    ) as HTMLElement | null;
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const gap = 4;
    // Set positioning via inline style so it cannot be missed by Tailwind's
    // class-scanning. `position: fixed` escapes any parent stacking context.
    const style: Record<string, string> = {
      position: 'fixed',
      'z-index': '1000',
    };
    switch (this.placement()) {
      case 'bottom-start':
        style['top'] = `${rect.bottom + gap}px`;
        style['left'] = `${rect.left}px`;
        break;
      case 'bottom-end':
        style['top'] = `${rect.bottom + gap}px`;
        style['right'] = `${window.innerWidth - rect.right}px`;
        break;
      case 'top-start':
        style['bottom'] = `${window.innerHeight - rect.top + gap}px`;
        style['left'] = `${rect.left}px`;
        break;
      case 'top-end':
        style['bottom'] = `${window.innerHeight - rect.top + gap}px`;
        style['right'] = `${window.innerWidth - rect.right}px`;
        break;
    }
    this.menuStyle.set(style);
  }

  close(): void {
    if (this.isOpen()) this.isOpen.set(false);
  }

  protected onItemClick(item: CuiDropdownItem): void {
    if (item.disabled || item.type === 'divider' || item.type === 'header') return;
    this.itemClick.emit(item);
    this.close();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node;
    const inHost = this.elementRef.nativeElement.contains(target);
    const inMenu = this.menuRef()?.nativeElement?.contains(target) ?? false;
    if (!inHost && !inMenu) {
      this.close();
    }
  }

  ngOnDestroy(): void {
    // When Angular destroys this component (e.g. on navigation), the menu <ul>
    // was teleported to document.body and is no longer in Angular's view tree.
    // The @if(isOpen()) in the template can't reach it, so we must remove it here.
    if (this.teleportedMenu && this.teleportedMenu.parentElement === document.body) {
      document.body.removeChild(this.teleportedMenu);
      this.teleportedMenu = null;
    }
  }

  protected itemButtonClasses(item: CuiDropdownItem): string {
    const base = [
      'flex items-center gap-2',
      'w-full',
      'px-3 py-2 rounded-md',
      'type-body-sm text-left',
      'border-0 bg-transparent',
      'transition-colors duration-150 ease-out',
      'outline-none focus-visible:bg-bg-subtle',
    ];

    if (item.disabled) {
      base.push('text-text-faint cursor-not-allowed opacity-50');
    } else if (item.destructive) {
      base.push('text-error cursor-pointer hover:bg-error-light');
    } else {
      base.push('text-text-primary cursor-pointer hover:bg-bg-subtle');
    }
    return base.join(' ');
  }
}
