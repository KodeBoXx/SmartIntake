import { Component, computed, input, model, output } from '@angular/core';
import { CuiIconComponent, CuiIconName } from '../../primitives/icon/icon.component';

export interface CuiTreeNode<T = unknown> {
  id: string;
  label: string;
  icon?: CuiIconName;
  disabled?: boolean;
  children?: CuiTreeNode<T>[];
  data?: T;
}

interface CuiTreeFlatNode<T = unknown> {
  node: CuiTreeNode<T>;
  depth: number;
  hasChildren: boolean;
}

@Component({
  selector: 'cui-tree',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './tree.component.html',
  host: { class: 'block' },
})
export class CuiTreeComponent<T = unknown> {
  readonly nodes = input.required<CuiTreeNode<T>[]>();
  readonly expanded = model<string[]>([]);
  readonly selectedId = model<string | null>(null);

  readonly nodeClick = output<CuiTreeNode<T>>();
  readonly toggleChange = output<{ node: CuiTreeNode<T>; expanded: boolean }>();

  protected readonly visibleNodes = computed<CuiTreeFlatNode<T>[]>(() => {
    const expandedSet = new Set(this.expanded());
    const result: CuiTreeFlatNode<T>[] = [];

    const walk = (nodes: CuiTreeNode<T>[], depth: number) => {
      for (const node of nodes) {
        const hasChildren = !!(node.children && node.children.length > 0);
        result.push({ node, depth, hasChildren });
        if (hasChildren && expandedSet.has(node.id)) {
          walk(node.children!, depth + 1);
        }
      }
    };

    walk(this.nodes(), 0);
    return result;
  });

  protected isExpanded(id: string): boolean {
    return this.expanded().includes(id);
  }

  protected toggleNode(node: CuiTreeNode<T>, event: Event): void {
    event.stopPropagation();
    if (node.disabled) return;
    const cur = this.expanded();
    const willExpand = !cur.includes(node.id);
    this.expanded.set(willExpand ? [...cur, node.id] : cur.filter((x) => x !== node.id));
    this.toggleChange.emit({ node, expanded: willExpand });
  }

  protected onNodeClick(node: CuiTreeNode<T>): void {
    if (node.disabled) return;
    this.selectedId.set(node.id);
    this.nodeClick.emit(node);
  }

  protected rowClasses(item: CuiTreeFlatNode<T>): string {
    const base = [
      'flex items-center gap-2 py-1.5 pr-3',
      'type-body-sm cursor-pointer',
      'transition-colors duration-150 ease-out',
      'rounded-md mx-1',
      'outline-none focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:outline-offset-[-3px]',
    ];

    if (item.node.disabled) {
      base.push('text-text-faint cursor-not-allowed opacity-50');
    } else if (this.selectedId() === item.node.id) {
      base.push('bg-emerald-50 text-emerald-700 font-medium');
    } else {
      base.push('text-text-primary hover:bg-bg-subtle');
    }

    return base.join(' ');
  }

  protected chevronClasses(id: string): string {
    const base = ['transition-transform duration-150 ease-out shrink-0 text-text-muted'];
    if (this.isExpanded(id)) base.push('rotate-90');
    return base.join(' ');
  }
}
