import { describe, expect, test } from 'bun:test';
import { splitPanes, updateSplitLayout, type SplitBranch } from '@adecore/ui';
import type { SplitLayout } from '@ruimte/contracts';
import { cellForPane, columnForSplit, coreLayout } from './core-layout';

const layout: SplitLayout = {
    columns: [
        {
            size: 0.4,
            cells: [
                { size: 0.25, viewId: 'b', tabs: ['a', 'b'] },
                { size: 0.75, viewId: 'c' }
            ]
        },
        { size: 0.6, cells: [{ size: 1, viewId: 'd', tabs: ['d'] }] }
    ],
    focus: { column: 0, cell: 1 }
};

describe('the shared split presentation', () => {
    test('preserves saved column and row shares, tabs, active views, focus and maximization', () => {
        const before = JSON.stringify(layout);
        const result = coreLayout(layout, 'b');
        expect(result.focused).toBe('cell:0:1');
        expect(result.maximized).toBe('cell:0:0');
        const root = result.root as SplitBranch;
        expect(root.axis).toBe('horizontal');
        expect(root.sizes).toEqual([0.4, 0.6]);
        expect(root.children[0]).toMatchObject({ axis: 'vertical', sizes: [0.25, 0.75] });
        expect(splitPanes(root).map((pane) => [pane.views, pane.active])).toEqual([
            [['a', 'b'], 'b'],
            [['c'], 'c'],
            [['d'], 'd']
        ]);
        expect(JSON.stringify(layout)).toBe(before);
    });
    test('maps divider and pane actions back to saved addresses at every grid size', () => {
        for (let columns = 1; columns <= 3; columns++) {
            for (let rows = 1; rows <= 3; rows++) {
                const saved: SplitLayout = {
                    columns: Array.from({ length: columns }, (_, column) => ({
                        size: 1 / columns,
                        cells: Array.from({ length: rows }, (_, cell) => ({ size: 1 / rows, viewId: `${column}:${cell}` }))
                    })),
                    focus: { column: columns - 1, cell: rows - 1 }
                };
                const result = coreLayout(saved, null);
                expect(splitPanes(result.root).map((pane) => cellForPane(pane.id))).toEqual(
                    saved.columns.flatMap((column, columnIndex) => column.cells.map((_, cell) => ({ column: columnIndex, cell })))
                );
                expect(cellForPane(result.focused)).toEqual(saved.focus);
                if (rows > 1) {
                    const branch = columns > 1 ? (result.root as SplitBranch).children[0]! : result.root;
                    expect(columnForSplit(branch.id)).toBe(0);
                }
                expect(coreLayout(saved, 'absent').maximized).toBeNull();
            }
        }
    });
    test('an equalize command affects the selected axis and leaves the saved model untouched', () => {
        const projected = coreLayout(layout, null);
        const next = updateSplitLayout(projected, { type: 'equalize', splitId: 'rows:0' });
        expect(((next.root as SplitBranch).children[0] as SplitBranch).sizes).toEqual([0.5, 0.5]);
        expect((next.root as SplitBranch).sizes).toEqual([0.4, 0.6]);
        expect(layout.columns[0]!.cells.map((cell) => cell.size)).toEqual([0.25, 0.75]);
    });
});
