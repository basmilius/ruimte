import type { SplitBranch, SplitLayout as CoreSplitLayout, SplitNode, SplitPane } from '@adecore/ui';
import type { SplitLayout } from '@ruimte/contracts';
import { cellViewIds, maximizedCell, type CellAt } from '@/shell/split';

function paneId(at: CellAt): string {
    return `cell:${at.column}:${at.cell}`;
}

export function cellForPane(id: string): CellAt | null {
    const match = /^cell:(\d+):(\d+)$/.exec(id);
    return match ? { column: Number(match[1]), cell: Number(match[2]) } : null;
}

export function columnForSplit(id: string): number | null {
    const match = /^rows:(\d+)$/.exec(id);
    return match ? Number(match[1]) : null;
}

/* The saved column/row format remains the contract with older clients. Only its presentation uses a tree. */
export function coreLayout(layout: SplitLayout, maximized: string | null): CoreSplitLayout {
    const columns = layout.columns.map((column, columnIndex): SplitNode => {
        const children = column.cells.map((cell, cellIndex): SplitPane => ({
            type: 'pane',
            id: paneId({ column: columnIndex, cell: cellIndex }),
            views: cellViewIds(cell),
            active: cell.viewId
        }));
        return children.length === 1
            ? children[0]!
            : {
                  type: 'split',
                  id: `rows:${columnIndex}`,
                  axis: 'vertical',
                  children,
                  sizes: column.cells.map((cell) => cell.size)
              };
    });
    const root: SplitNode =
        columns.length === 1
            ? columns[0]!
            : ({
                  type: 'split',
                  id: 'columns',
                  axis: 'horizontal',
                  children: columns,
                  sizes: layout.columns.map((column) => column.size)
              } satisfies SplitBranch);
    const filling = maximizedCell(layout, maximized);
    return { root, focused: paneId(layout.focus), maximized: filling === null ? null : paneId(filling) };
}
