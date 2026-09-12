import { Component, booleanAttribute, computed, input, model } from '@angular/core';
import { CuiIconButtonComponent } from '../../primitives/icon-button/icon-button.component';
import { CuiIconComponent } from '../../primitives/icon/icon.component';
import { CuiPageButtonComponent } from '../../primitives/page-button/page-button.component';
import { CuiSelectComponent, CuiSelectOption } from '../../primitives/select/select.component';

type PageItem = number | 'ellipsis-left' | 'ellipsis-right';

function getPageItems(current: number, total: number, sibling: number): PageItem[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const items: PageItem[] = [];
  const left = Math.max(2, current - sibling);
  const right = Math.min(total - 1, current + sibling);

  items.push(1);
  if (left > 2) items.push('ellipsis-left');
  for (let i = left; i <= right; i++) items.push(i);
  if (right < total - 1) items.push('ellipsis-right');
  items.push(total);

  return items;
}

@Component({
  selector: 'cui-paginator',
  standalone: true,
  imports: [
    CuiIconButtonComponent,
    CuiIconComponent,
    CuiPageButtonComponent,
    CuiSelectComponent,
  ],
  templateUrl: './paginator.component.html',
  host: { class: 'block' },
})
export class CuiPaginatorComponent {
  readonly currentPage = model<number>(1);
  readonly pageSize = model<number>(10);

  readonly totalItems = input.required<number>();

  readonly pageSizeOptions = input<number[]>([10, 25, 50, 100]);
  readonly siblingCount = input<number>(1);
  readonly showPageSize = input(true, { transform: booleanAttribute });
  readonly showTotal = input(true, { transform: booleanAttribute });

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.pageSize())),
  );

  readonly pageItems = computed<PageItem[]>(() =>
    getPageItems(this.currentPage(), this.totalPages(), this.siblingCount()),
  );

  readonly canPrev = computed(() => this.currentPage() > 1);
  readonly canNext = computed(() => this.currentPage() < this.totalPages());

  readonly rangeStart = computed(() =>
    this.totalItems() === 0 ? 0 : (this.currentPage() - 1) * this.pageSize() + 1,
  );
  readonly rangeEnd = computed(() =>
    Math.min(this.currentPage() * this.pageSize(), this.totalItems()),
  );

  readonly pageSizeSelectOptions = computed<CuiSelectOption[]>(() =>
    this.pageSizeOptions().map((n) => ({
      value: String(n),
      label: `${n} / page`,
    })),
  );

  readonly pageSizeValue = computed(() => String(this.pageSize()));

  protected isNumber(item: PageItem): item is number {
    return typeof item === 'number';
  }

  protected goPrev(): void {
    if (this.canPrev()) this.currentPage.update((p) => p - 1);
  }

  protected goNext(): void {
    if (this.canNext()) this.currentPage.update((p) => p + 1);
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    this.currentPage.set(page);
  }

  protected onPageSizeChange(value: string | null): void {
    if (value === null) return;
    const n = Number(value);
    if (Number.isFinite(n)) {
      this.pageSize.set(n);
      this.currentPage.set(1);
    }
  }
}
