import { describe, expect, test } from 'bun:test';
import type { ProjectView, SplitLayout } from '@ruimte/contracts';
import { draggedSizes, EVEN_SNAP_PX, evenCells, evenColumns, maximizedCell, snapToEven } from './split';
import {
    canSplit,
    cellAt,
    cellCount,
    cellsRightOf,
    cleanLayout,
    closeCell,
    closeCellsRightOf,
    closeOtherCells,
    dropView,
    focusCell,
    focusDirection,
    focusedViewId,
    isSameCell,
    layoutOf,
    locateView,
    openableViewIds,
    showViewIn,
    singleLayout,
    undoShowView,
    viewIdsIn,
    type CellAt,
    type SplitDirection
} from './split';

/* A layout the way a test reads it: columns of view ids, every share even. */
const gridOf = (columns: string[][], focus: CellAt = { column: 0, cell: 0 }): SplitLayout => ({
    columns: columns.map((cells) => ({
        size: 1 / columns.length,
        cells: cells.map((viewId) => ({ viewId, size: 1 / cells.length }))
    })),
    focus
});

const shapeOf = (layout: SplitLayout): string[][] => layout.columns.map((column) => column.cells.map((cell) => cell.viewId));

/* Shares are only meaningful if they add up, so every operation is checked on both axes. */
const sums = (layout: SplitLayout): void => {
    expect(layout.columns.reduce((total, column) => total + column.size, 0)).toBeCloseTo(1, 10);
    for (const column of layout.columns) {
        expect(column.cells.reduce((total, cell) => total + cell.size, 0)).toBeCloseTo(1, 10);
    }
};

const viewOf = (id: string, kind: ProjectView['kind'] = 'canvas'): ProjectView =>
    (kind === 'separator' ? { kind, id } : { kind: 'canvas', id, name: id, nodes: [], texts: [], edges: [], layouts: [] }) as ProjectView;

describe('singleLayout', () => {
    test('one column with one cell is where every project stands until it is split', () => {
        const layout = singleLayout('main');
        expect(shapeOf(layout)).toEqual([['main']]);
        expect(focusedViewId(layout)).toBe('main');
        sums(layout);
    });
});

describe('canSplit', () => {
    test('a third column is the last one', () => {
        expect(canSplit(gridOf([['a'], ['b']]), { column: 0, cell: 0 }, 'right')).toBe(true);
        expect(canSplit(gridOf([['a'], ['b'], ['c']]), { column: 0, cell: 0 }, 'right')).toBe(false);
        expect(canSplit(gridOf([['a'], ['b'], ['c']]), { column: 0, cell: 0 }, 'left')).toBe(false);
    });

    test('a third cell is the last one of its own column and says nothing about the others', () => {
        const layout = gridOf([['a', 'b', 'c'], ['d']]);
        expect(canSplit(layout, { column: 0, cell: 0 }, 'down')).toBe(false);
        expect(canSplit(layout, { column: 1, cell: 0 }, 'down')).toBe(true);
    });

    test('a cell that is not there is no target', () => {
        expect(canSplit(gridOf([['a']]), { column: 4, cell: 0 }, 'right')).toBe(false);
    });

    test('a view leaving its own column frees that column, so a full grid is not full for it', () => {
        const layout = gridOf([['a'], ['b'], ['c']]);
        expect(canSplit(layout, { column: 0, cell: 0 }, 'right')).toBe(false);
        expect(canSplit(layout, { column: 0, cell: 0 }, 'right', 'c')).toBe(true);
    });

    test('a view dropped on the cell it already stands in is nothing', () => {
        const layout = gridOf([['a'], ['b']]);
        expect(canSplit(layout, { column: 0, cell: 0 }, 'right', 'a')).toBe(false);
        expect(canSplit(layout, { column: 0, cell: 0 }, 'center', 'a')).toBe(false);
    });
});

describe('dropView', () => {
    test('a side edge makes a column beside the one it was dropped on', () => {
        const layout = dropView(gridOf([['a']]), 'b', { column: 0, cell: 0 }, 'right');
        expect(shapeOf(layout)).toEqual([['a'], ['b']]);
        expect(focusedViewId(layout)).toBe('b');
        sums(layout);
    });

    test('a left drop puts the column in front of it', () => {
        expect(shapeOf(dropView(gridOf([['a']]), 'b', { column: 0, cell: 0 }, 'left'))).toEqual([['b'], ['a']]);
    });

    test('up and down make a cell inside the column, never a column', () => {
        const down = dropView(gridOf([['a']]), 'b', { column: 0, cell: 0 }, 'down');
        expect(shapeOf(down)).toEqual([['a', 'b']]);
        expect(shapeOf(dropView(down, 'c', { column: 0, cell: 0 }, 'up'))).toEqual([['c', 'a', 'b']]);
        sums(down);
    });

    test('the newcomer takes half of what it was dropped on and the rest keeps its share', () => {
        const layout = dropView(gridOf([['a'], ['b']]), 'c', { column: 0, cell: 0 }, 'right');
        expect(layout.columns.map((column) => column.size)).toEqual([0.25, 0.25, 0.5]);
        sums(layout);
    });

    test('the middle takes the place of the view standing there', () => {
        const layout = dropView(gridOf([['a'], ['b']]), 'c', { column: 1, cell: 0 }, 'center');
        expect(shapeOf(layout)).toEqual([['a'], ['c']]);
        expect(focusedViewId(layout)).toBe('c');
    });

    test('the middle swaps when the view was already on screen, so nothing falls off the grid', () => {
        const layout = dropView(gridOf([['a'], ['b']]), 'a', { column: 1, cell: 0 }, 'center');
        expect(shapeOf(layout)).toEqual([['b'], ['a']]);
        expect(focusedViewId(layout)).toBe('a');
    });

    test('a view that is already on screen moves instead of appearing twice', () => {
        const layout = dropView(gridOf([['a', 'b'], ['c']]), 'b', { column: 1, cell: 0 }, 'down');
        expect(shapeOf(layout)).toEqual([['a'], ['c', 'b']]);
        expect(viewIdsIn(layout)).toEqual(['a', 'c', 'b']);
        expect(focusedViewId(layout)).toBe('b');
        sums(layout);
    });

    test('a move that empties its column frees that column for the drop', () => {
        const layout = dropView(gridOf([['a'], ['b'], ['c']]), 'c', { column: 0, cell: 0 }, 'right');
        expect(shapeOf(layout)).toEqual([['a'], ['c'], ['b']]);
        sums(layout);
    });

    test('a drop that would break a limit leaves the layout untouched', () => {
        const wide = gridOf([['a'], ['b'], ['c']]);
        expect(dropView(wide, 'd', { column: 1, cell: 0 }, 'left')).toBe(wide);
        const tall = gridOf([['a', 'b', 'c']]);
        expect(dropView(tall, 'd', { column: 0, cell: 1 }, 'down')).toBe(tall);
    });

    test('nine cells is the ceiling, and there only the middle is left', () => {
        const full = gridOf([
            ['a', 'b', 'c'],
            ['d', 'e', 'f'],
            ['g', 'h', 'i']
        ]);
        expect(cellCount(full)).toBe(9);
        for (const direction of ['left', 'right', 'up', 'down'] as SplitDirection[]) {
            expect(canSplit(full, { column: 1, cell: 1 }, direction, 'j')).toBe(false);
        }
        expect(canSplit(full, { column: 1, cell: 1 }, 'center', 'j')).toBe(true);
    });
});

describe('closeCell', () => {
    test('the neighbors grow into the space', () => {
        const layout = closeCell(gridOf([['a'], ['b'], ['c']]), { column: 1, cell: 0 });
        expect(shapeOf(layout!)).toEqual([['a'], ['c']]);
        sums(layout!);
    });

    test('a column that loses its last cell goes with it', () => {
        expect(shapeOf(closeCell(gridOf([['a'], ['b', 'c']]), { column: 1, cell: 0 })!)).toEqual([['a'], ['c']]);
    });

    test('the focus keeps its own view when another cell closes in front of it', () => {
        const layout = closeCell(gridOf([['a'], ['b'], ['c']], { column: 2, cell: 0 }), { column: 0, cell: 0 });
        expect(focusedViewId(layout!)).toBe('c');
    });

    test('closing the focused cell lands on the nearest one left', () => {
        const layout = closeCell(gridOf([['a'], ['b']], { column: 1, cell: 0 }), { column: 1, cell: 0 });
        expect(focusedViewId(layout!)).toBe('a');
    });

    test('the last cell answers null, which is the caller question, not the model one', () => {
        expect(closeCell(gridOf([['a']]), { column: 0, cell: 0 })).toBeNull();
    });

    test('a cell that is not there closes nothing', () => {
        const layout = gridOf([['a'], ['b']]);
        expect(closeCell(layout, { column: 7, cell: 0 })).toBe(layout);
    });
});

describe('focusDirection', () => {
    test('a step stops at the edge of the grid', () => {
        const layout = gridOf([['a'], ['b']]);
        expect(focusDirection(layout, 'left')).toBe(layout);
        expect(focusedViewId(focusDirection(layout, 'right'))).toBe('b');
        expect(focusDirection(layout, 'up')).toBe(layout);
    });

    test('up and down walk the cells of the column', () => {
        const layout = gridOf([['a', 'b', 'c']], { column: 0, cell: 1 });
        expect(focusedViewId(focusDirection(layout, 'up'))).toBe('a');
        expect(focusedViewId(focusDirection(layout, 'down'))).toBe('c');
    });

    test('sideways meets the neighboring column at the height it left, not at the same index', () => {
        const wide = gridOf([['a', 'b', 'c'], ['d']], { column: 0, cell: 2 });
        expect(focusedViewId(focusDirection(wide, 'right'))).toBe('d');
        const tall = gridOf(
            [
                ['a', 'b', 'c'],
                ['d', 'e']
            ],
            { column: 1, cell: 1 }
        );
        expect(focusedViewId(focusDirection(tall, 'left'))).toBe('c');
    });
});

describe('focusCell', () => {
    test('a cell that is not there is no focus', () => {
        const layout = gridOf([['a']]);
        expect(focusCell(layout, { column: 2, cell: 0 })).toBe(layout);
        expect(focusCell(layout, { column: 0, cell: 0 }).focus).toEqual({ column: 0, cell: 0 });
    });
});

describe('showViewIn', () => {
    test('a view nobody has on screen takes the place of the one in the focused cell', () => {
        const layout = gridOf([['a'], ['b', 'c']], { column: 1, cell: 1 });
        const shown = showViewIn(layout, 'd')!;
        expect(shapeOf(shown.layout)).toEqual([['a'], ['b', 'd']]);
        expect(shown.at).toEqual({ column: 1, cell: 1 });
        expect(shown.replaced).toBe('c');
        expect(shown.from).toEqual({ column: 1, cell: 1 });
        expect(shown.layout.focus).toEqual({ column: 1, cell: 1 });
        sums(shown.layout);
    });

    test('a view already in another cell moves the focus instead of appearing twice', () => {
        const layout = gridOf([['a'], ['b', 'c']], { column: 0, cell: 0 });
        const shown = showViewIn(layout, 'c')!;
        expect(shapeOf(shown.layout)).toEqual([['a'], ['b', 'c']]);
        expect(shown.at).toEqual({ column: 1, cell: 1 });
        expect(shown.replaced).toBeNull();
        expect(shown.from).toEqual({ column: 0, cell: 0 });
        expect(shown.layout.focus).toEqual({ column: 1, cell: 1 });
    });

    test('the view the person is already looking at is nothing to show and nothing to undo', () => {
        expect(showViewIn(gridOf([['a'], ['b']], { column: 1, cell: 0 }), 'b')).toBeNull();
    });
});

describe('undoShowView', () => {
    test('puts the view that made room back in its cell', () => {
        const layout = gridOf([['a'], ['b', 'c']], { column: 1, cell: 1 });
        const shown = showViewIn(layout, 'd')!;
        const back = undoShowView(shown.layout, shown);
        expect(shapeOf(back)).toEqual([['a'], ['b', 'c']]);
        expect(back.focus).toEqual({ column: 1, cell: 1 });
        sums(back);
    });

    test('hands the focus back when nothing was replaced', () => {
        const layout = gridOf([['a'], ['b', 'c']], { column: 0, cell: 0 });
        const shown = showViewIn(layout, 'c')!;
        expect(undoShowView(shown.layout, shown).focus).toEqual({ column: 0, cell: 0 });
        expect(shapeOf(undoShowView(shown.layout, shown))).toEqual([['a'], ['b', 'c']]);
    });

    test('runs against the grid as it stands, so a split made in between survives', () => {
        const shown = showViewIn(gridOf([['a']]), 'd')!;
        // The person split the cell after the toast went up; going back may only touch the cell it named.
        const moved = dropView(shown.layout, 'e', { column: 0, cell: 0 }, 'right');
        expect(shapeOf(undoShowView(moved, shown))).toEqual([['a'], ['e']]);
    });

    test('a cell that is gone leaves everything where it is', () => {
        const shown = showViewIn(gridOf([['a'], ['b']], { column: 1, cell: 0 }), 'd')!;
        const closed = closeCell(shown.layout, { column: 1, cell: 0 })!;
        expect(shapeOf(undoShowView(closed, shown))).toEqual([['a']]);
    });
});

describe('locateView', () => {
    test('a view stands in one cell or in none', () => {
        expect(locateView(gridOf([['a'], ['b', 'c']]), 'c')).toEqual({ column: 1, cell: 1 });
        expect(locateView(gridOf([['a']]), 'b')).toBeNull();
    });
});

describe('isSameCell', () => {
    test('two indices, not an id', () => {
        expect(isSameCell({ column: 1, cell: 2 }, { column: 1, cell: 2 })).toBe(true);
        expect(isSameCell({ column: 1, cell: 2 }, { column: 2, cell: 1 })).toBe(false);
    });
});

describe('cellAt', () => {
    test('nothing outside the grid', () => {
        expect(cellAt(gridOf([['a']]), { column: 0, cell: 0 })?.viewId).toBe('a');
        expect(cellAt(gridOf([['a']]), { column: 0, cell: 3 })).toBeNull();
    });
});

describe('cleanLayout', () => {
    test('a cell whose view another client deleted falls away, and the column with it', () => {
        const layout = cleanLayout(gridOf([['a'], ['b']]), ['a']);
        expect(shapeOf(layout!)).toEqual([['a']]);
        sums(layout!);
    });

    test('a layout with nothing left starts over on the first view there is', () => {
        expect(shapeOf(cleanLayout(gridOf([['a']]), ['b', 'c'])!)).toEqual([['b']]);
    });

    test('no views at all is no layout', () => {
        expect(cleanLayout(gridOf([['a']]), [])).toBeNull();
    });

    test('a file edited past the limits is trimmed rather than refused', () => {
        const wide = gridOf([['a'], ['b'], ['c'], ['d']]);
        expect(shapeOf(cleanLayout(wide, ['a', 'b', 'c', 'd'])!)).toEqual([['a'], ['b'], ['c']]);
        const tall = gridOf([['a', 'b', 'c', 'd']]);
        expect(shapeOf(cleanLayout(tall, ['a', 'b', 'c', 'd'])!)).toEqual([['a', 'b', 'c']]);
    });

    test('the same view twice keeps the first cell', () => {
        expect(shapeOf(cleanLayout(gridOf([['a'], ['a', 'b']]), ['a', 'b'])!)).toEqual([['a'], ['b']]);
    });

    test('a focus pointing outside is pulled back onto a cell', () => {
        expect(cleanLayout(gridOf([['a'], ['b']], { column: 1, cell: 0 }), ['a'])!.focus).toEqual({ column: 0, cell: 0 });
    });

    test('shares are rebuilt after the cutting', () => {
        sums(cleanLayout(gridOf([['a', 'b'], ['c']]), ['a', 'c'])!);
    });
});

describe('openableViewIds', () => {
    test('a separator is a line in the list, not a place a cell can go', () => {
        expect(openableViewIds([viewOf('a'), viewOf('line', 'separator'), viewOf('b')])).toEqual(['a', 'b']);
    });
});

describe('layoutOf', () => {
    test('a file without a layout is one cell on the view that was active', () => {
        const layout = layoutOf({ activeViewId: 'b', layout: undefined }, [viewOf('a'), viewOf('b')]);
        expect(shapeOf(layout!)).toEqual([['b']]);
    });

    test('an active view that is gone falls back to the first view there is', () => {
        expect(shapeOf(layoutOf({ activeViewId: 'gone', layout: undefined }, [viewOf('a')])!)).toEqual([['a']]);
    });

    test('a project without openable views has no layout at all', () => {
        expect(layoutOf({ activeViewId: null, layout: undefined }, [viewOf('line', 'separator')])).toBeNull();
    });

    test('a layout on disk is read through the cleaning', () => {
        const layout = layoutOf({ activeViewId: 'a', layout: gridOf([['a'], ['gone']]) }, [viewOf('a')]);
        expect(shapeOf(layout!)).toEqual([['a']]);
    });
});

describe('snapToEven', () => {
    test('a splitter close to the middle of its two neighbors lands on it', () => {
        // Two columns of 0.5 in a box of 1000 pixels: 0.505 is 5 pixels off the middle.
        expect(snapToEven(0.505, 1, 1000)).toBe(0.5);
        expect(snapToEven(0.495, 1, 1000)).toBe(0.5);
    });

    test('further away it stays where the pointer put it', () => {
        expect(snapToEven(0.52, 1, 1000)).toBe(0.52);
    });

    test('the pull is in pixels, so it is as wide in a small box as in a large one', () => {
        const off = (EVEN_SNAP_PX + 1) / 400;
        expect(snapToEven(0.5 + off, 1, 400)).toBe(0.5 + off);
        expect(snapToEven(0.5 + (EVEN_SNAP_PX - 1) / 400, 1, 400)).toBe(0.5);
    });

    test('the middle is that of the two neighbors, not of the whole box', () => {
        // Two cells of a column of three that together take two thirds of it.
        expect(snapToEven(0.335, 2 / 3, 900)).toBeCloseTo(1 / 3, 10);
    });
});

describe('evenColumns', () => {
    const sized = (sizes: number[]): SplitLayout => ({
        columns: sizes.map((size, index) => ({ size, cells: [{ viewId: `v${index}`, size: 1 }] })),
        focus: { column: 0, cell: 0 }
    });
    const sizes = (layout: SplitLayout): number[] => layout.columns.map((column) => column.size);

    test('the two neighbors of the splitter share what they held, and the third keeps its size', () => {
        const next = evenColumns(sized([0.2, 0.5, 0.3]), 1, false);
        expect(sizes(next)[0]).toBeCloseTo(0.35, 10);
        expect(sizes(next)[1]).toBeCloseTo(0.35, 10);
        expect(sizes(next)[2]).toBe(0.3);
        sums(next);
    });

    test('with every column asked for, three become thirds', () => {
        const next = evenColumns(sized([0.2, 0.5, 0.3]), 2, true);
        for (const size of sizes(next)) {
            expect(size).toBeCloseTo(1 / 3, 10);
        }
        sums(next);
    });

    test('two columns become halves either way', () => {
        expect(sizes(evenColumns(sized([0.7, 0.3]), 1, false))).toEqual([0.5, 0.5]);
        expect(sizes(evenColumns(sized([0.7, 0.3]), 1, true))).toEqual([0.5, 0.5]);
    });

    test('a splitter that is not there changes nothing', () => {
        expect(sizes(evenColumns(sized([0.7, 0.3]), 0, true))).toEqual([0.7, 0.3]);
        expect(sizes(evenColumns(sized([0.7, 0.3]), 2, false))).toEqual([0.7, 0.3]);
    });
});

describe('evenCells', () => {
    const layout: SplitLayout = {
        columns: [
            {
                size: 0.5,
                cells: [
                    { viewId: 'a', size: 0.6 },
                    { viewId: 'b', size: 0.3 },
                    { viewId: 'c', size: 0.1 }
                ]
            },
            {
                size: 0.5,
                cells: [
                    { viewId: 'd', size: 0.8 },
                    { viewId: 'e', size: 0.2 }
                ]
            }
        ],
        focus: { column: 0, cell: 0 }
    };
    const sizesIn = (next: SplitLayout, column: number): number[] => next.columns[column]!.cells.map((cell) => cell.size);

    test('the two cells around the splitter share what they held', () => {
        const next = evenCells(layout, 0, 2, false);
        expect(sizesIn(next, 0)[0]).toBe(0.6);
        expect(sizesIn(next, 0)[1]).toBeCloseTo(0.2, 10);
        expect(sizesIn(next, 0)[2]).toBeCloseTo(0.2, 10);
        sums(next);
    });

    test('every cell of the column, and only of that column', () => {
        const next = evenCells(layout, 0, 1, true);
        for (const size of sizesIn(next, 0)) {
            expect(size).toBeCloseTo(1 / 3, 10);
        }
        expect(sizesIn(next, 1)).toEqual([0.8, 0.2]);
        expect(next.columns.map((column) => column.size)).toEqual([0.5, 0.5]);
    });

    test('a column that is not there changes nothing', () => {
        expect(evenCells(layout, 4, 1, true)).toBe(layout);
    });
});

describe('maximizedCell', () => {
    test('the cell the maximized view stands in', () => {
        expect(maximizedCell(gridOf([['a'], ['b', 'c']]), 'c')).toEqual({ column: 1, cell: 1 });
    });

    test('nothing without a view, for a view off the grid, or with one cell on it', () => {
        expect(maximizedCell(gridOf([['a'], ['b']]), null)).toBeNull();
        expect(maximizedCell(gridOf([['a'], ['b']]), 'gone')).toBeNull();
        expect(maximizedCell(gridOf([['a']]), 'a')).toBeNull();
        expect(maximizedCell(null, 'a')).toBeNull();
    });
});

describe('closeOtherCells', () => {
    test('leaves the one cell, filling the grid and holding the focus', () => {
        const next = closeOtherCells(gridOf([['a', 'b'], ['c']], { column: 1, cell: 0 }), { column: 0, cell: 1 });
        expect(shapeOf(next)).toEqual([['b']]);
        expect(focusedViewId(next)).toBe('b');
        sums(next);
    });

    test('a cell alone, or one that is not there, changes nothing', () => {
        const alone = gridOf([['a']]);
        expect(closeOtherCells(alone, { column: 0, cell: 0 })).toBe(alone);
        const two = gridOf([['a'], ['b']]);
        expect(closeOtherCells(two, { column: 3, cell: 0 })).toBe(two);
    });
});

describe('closeCellsRightOf', () => {
    test('counts the cells in the columns to the right, never the ones under it', () => {
        const layout = gridOf([['a', 'b'], ['c', 'd'], ['e']]);
        expect(cellsRightOf(layout, { column: 0, cell: 1 })).toBe(3);
        expect(cellsRightOf(layout, { column: 1, cell: 0 })).toBe(1);
        expect(cellsRightOf(layout, { column: 2, cell: 0 })).toBe(0);
    });

    test('closes every column to the right, and the columns left keep their proportions', () => {
        const layout: SplitLayout = {
            columns: [
                { size: 0.2, cells: [{ viewId: 'a', size: 1 }] },
                { size: 0.3, cells: [{ viewId: 'b', size: 1 }] },
                {
                    size: 0.5,
                    cells: [
                        { viewId: 'c', size: 0.5 },
                        { viewId: 'd', size: 0.5 }
                    ]
                }
            ],
            focus: { column: 0, cell: 0 }
        };
        const next = closeCellsRightOf(layout, { column: 1, cell: 0 });
        expect(shapeOf(next)).toEqual([['a'], ['b']]);
        expect(next.columns.map((column) => column.size)[0]).toBeCloseTo(0.4, 10);
        expect(focusedViewId(next)).toBe('a');
        sums(next);
    });

    test('a focus in a closed column comes to the cell the menu was on', () => {
        const next = closeCellsRightOf(gridOf([['a', 'b'], ['c']], { column: 1, cell: 0 }), { column: 0, cell: 1 });
        expect(shapeOf(next)).toEqual([['a', 'b']]);
        expect(focusedViewId(next)).toBe('b');
    });

    test('the last column has nothing to its right', () => {
        const layout = gridOf([['a'], ['b']]);
        expect(closeCellsRightOf(layout, { column: 1, cell: 0 })).toBe(layout);
    });
});

describe('draggedSizes', () => {
    const rounded = (sizes: number[]): number[] => sizes.map((size) => Math.round(size * 1000) / 1000);

    test('moves only the two neighbors of the splitter', () => {
        expect(rounded(draggedSizes([0.3, 0.4, 0.3], 1, 0.1, 1000, false))).toEqual([0.4, 0.3, 0.3]);
    });

    test('with Option the mirroring splitter moves the other way, around the middle item', () => {
        expect(rounded(draggedSizes([0.3, 0.4, 0.3], 1, 0.05, 1000, true))).toEqual([0.35, 0.3, 0.35]);
        expect(rounded(draggedSizes([0.3, 0.4, 0.3], 2, 0.05, 1000, true))).toEqual([0.25, 0.5, 0.25]);
    });

    test('two items have no mirror, so Option drags as usual', () => {
        expect(rounded(draggedSizes([0.5, 0.5], 1, 0.1, 1000, true))).toEqual([0.6, 0.4]);
    });

    test('a mirrored drag stops where an item would get too small', () => {
        expect(rounded(draggedSizes([0.3, 0.4, 0.3], 1, 0.5, 1000, true))).toEqual([0.425, 0.15, 0.425]);
        expect(rounded(draggedSizes([0.3, 0.4, 0.3], 1, -0.5, 1000, true))).toEqual([0.15, 0.7, 0.15]);
    });
});
