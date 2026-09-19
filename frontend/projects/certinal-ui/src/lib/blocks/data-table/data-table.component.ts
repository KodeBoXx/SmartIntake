import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  TemplateRef,
  booleanAttribute,
  computed,
  input,
  model,
  output,
} from '@angular/core';
import {
  CuiTableHeaderCellComponent,
  CuiTableSort,
} from '../../primitives/table-header-cell/table-header-cell.component';
import {
  CuiTableCellComponent,
  CuiTableAlign,
} from '../../primitives/table-cell/table-cell.component';
import { CuiTableRowComponent } from '../../primitives/table-row/table-row.component';
import { CuiSkeletonComponent } from '../../primitives/skeleton/skeleton.component';
import { CuiIconComponent } from '../../primitives/icon/icon.component';

export type CuiDataTableSort = 'asc' | 'desc';

export interface CuiDataTableColumn<T = unknown> {
  key: string;
  label: string;
  align?: CuiTableAlign;
  width?: string;
  sortable?: boolean;
  truncate?: boolean;
  nowrap?: boolean;
  cellTemplate?: TemplateRef<{ $implicit: T; row: T }>;
}

@Component({
  selector: 'cui-data-table',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    CuiTableHeaderCellComponent,
    CuiTableCellComponent,
    CuiTableRowComponent,
    CuiSkeletonComponent,
    CuiIconComponent,
  ],
  templateUrl: './data-table.component.html',
  host: { class: 'block' },
})
export class CuiDataTableComponent<T = unknown> {
  readonly columns = input.required<CuiDataTableColumn<T>[]>();
  readonly rows = input<T[]>([]);
  readonly rowKey = input<string | undefined>(undefined);

  readonly sortKey = model<string | null>(null);
  readonly sortDir = model<CuiDataTableSort>('asc');

  readonly clickable = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly skeletonRows = input<number>(5);
  readonly emptyMessage = input<string>('No data found');
  readonly emptyHint = input<string | undefined>(undefined);

  readonly rowClick = output<T>();

  protected readonly skeletonRowIndexes = computed(() =>
    Array.from({ length: this.skeletonRows() }, (_, i) => i),
  );

  protected getSort(colKey: string): CuiTableSort {
    if (this.sortKey() !== colKey) return 'none';
    return this.sortDir();
  }

  protected onSortChange(colKey: string, next: CuiTableSort): void {
    if (next === 'none') {
      this.sortKey.set(null);
      this.sortDir.set('asc');
    } else {
      this.sortKey.set(colKey);
      this.sortDir.set(next);
    }
  }

  protected getCellValue(row: T, col: CuiDataTableColumn<T>): unknown {
    return (row as Record<string, unknown>)[col.key];
  }

  protected trackRow = (index: number, row: T): unknown => {
    const rk = this.rowKey();
    if (rk) {
      const v = (row as Record<string, unknown>)[rk];
      if (v !== undefined && v !== null) return v;
    }
    return index;
  };
}
