import { describe, expect, test } from 'bun:test';
import type { ProjectView, SplitCell, SplitLayout } from '@ruimte/contracts';
import { draggedSizes, EVEN_SNAP_PX, evenCells, evenColumns, maximizedCell, snapToEven } from './split';
import {
    activateTab,
    canDropAsTab,
    canMoveCell,
    canSplit,
    cellAt,
    cellCount,
    cellsRightOf,
    cellViewIds,
    cleanLayout,
    closeCell,
    closeCellsRightOf,
    closeOtherCells,
    closeTab,
    dropAsTab,
    dropView,
    focusCell,
    focusDirection,
    focusedViewId,
    freeViewFor,
    isSameCell,
    isTabHost,
    layoutOf,
    locateView,
    moveCell,
    moveTabBy,
    openableViewIds,
    replaceViewId,
    showViewIn,
    shownViewIdsIn,
    singleLayout,
    ungroup,
    undoShowView,
    viewIdsIn,
    type CellAt,
    type SplitDirection
} from './split';

/* A cell the way a test writes it: `a` is a plain cell, `[a *b c]` a host with three tabs and `b` active (the first when none is starred). */
function cellOf(spec: string, size: number): SplitCell {
    if (!spec.startsWith('[')) {
        return { viewId: spec, size };
    }
    const entries = spec.slice(1, -1).split(' ');
    const tabs = entries.map((entry) => entry.replace('*', ''));
    const active = entries.find((entry) => entry.startsWith('*'));
    return { viewId: active === undefined ? tabs[0] : active.slice(1), tabs, size };
}

function textOf(cell: SplitCell): string {
    return cell.tabs === undefined ? cell.viewId : `[${cell.tabs.map((id) => (id === cell.viewId ? `*${id}` : id)).join(' ')}]`;
}

/* A layout the way a test reads it: columns of cell specs, every share even. */
function gridOf(columns: string[][], focus: CellAt = { column: 0, cell: 0 }): SplitLayout {
    return {
        columns: columns.map((cells) => ({
            size: 1 / columns.length,
            cells: cells.map((spec) => cellOf(spec, 1 / cells.length))
        })),
        focus
    };
}

/* The same notation back, tabs and active tab included. */
function tabShapeOf(layout: SplitLayout): string[][] {
    return layout.columns.map((column) => column.cells.map(textOf));
}

function shapeOf(layout: SplitLayout): string[][] {
    return layout.columns.map((column) => column.cells.map((cell) => cell.viewId));
}

/* Shares are only meaningful if they add up, so every operation is checked on both axes. */
function sums(layout: SplitLayout): void {
    expect(layout.columns.reduce((total, column) => total + column.size, 0)).toBeCloseTo(1, 10);
    for (const column of layout.columns) {
        expect(column.cells.reduce((total, cell) => total + cell.size, 0)).toBeCloseTo(1, 10);
    }
}

function viewOf(id: string, kind: ProjectView['kind'] = 'canvas'): ProjectView {
    return (kind === 'separator' ? { kind, id } : { kind: 'canvas', id, name: id, nodes: [], texts: [], edges: [], layouts: [] }) as ProjectView;
}

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

const first: CellAt = { column: 0, cell: 0 };
const second: CellAt = { column: 1, cell: 0 };

describe('tab hosts as a model', () => {
    test('a cell is a host when it has tabs, and lists its tabs or only its view', () => {
        const layout = gridOf([['a'], ['[b *c]']]);
        expect(isTabHost(cellAt(layout, first)!)).toBe(false);
        expect(isTabHost(cellAt(layout, second)!)).toBe(true);
        expect(cellViewIds(cellAt(layout, first)!)).toEqual(['a']);
        expect(cellViewIds(cellAt(layout, second)!)).toEqual(['b', 'c']);
    });

    test('a view is placed in a background tab, but only the active views are shown', () => {
        const layout = gridOf([['a'], ['[b *c]']]);
        expect(viewIdsIn(layout)).toEqual(['a', 'b', 'c']);
        expect(shownViewIdsIn(layout)).toEqual(['a', 'c']);
        expect(locateView(layout, 'b')).toEqual(second);
        expect(focusedViewId(gridOf([['[a *b]']]))).toBe('b');
    });

    test('a view in a background tab is taken for a split and for a maximized view', () => {
        const layout = gridOf([['[*a b]'], ['c']]);
        const views = [viewOf('a'), viewOf('b'), viewOf('c'), viewOf('d')];
        expect(freeViewFor({ views, layout, activeViewId: 'a' })).toBe('d');
        expect(maximizedCell(layout, 'b')).toEqual(first);
    });

    test('closing the others keeps the host with its tabs', () => {
        const layout = closeOtherCells(gridOf([['a'], ['[b *c]']]), second);
        expect(tabShapeOf(layout)).toEqual([['[b *c]']]);
        sums(layout);
    });
});

describe('activateTab', () => {
    test('the cell takes the focus and the view becomes its active tab', () => {
        const layout = activateTab(gridOf([['a'], ['[b *c]']]), 'b');
        expect(tabShapeOf(layout)).toEqual([['a'], ['[*b c]']]);
        expect(layout.focus).toEqual(second);
    });

    test('a view that is not there changes nothing', () => {
        const layout = gridOf([['a']]);
        expect(activateTab(layout, 'x')).toBe(layout);
    });
});

describe('showViewIn rules', () => {
    test('1: a placed view takes its cell into focus and becomes the active tab', () => {
        const layout = gridOf([['a'], ['[b *c]']]);
        const shown = showViewIn(layout, 'b', { newTab: true, loose: true })!;
        expect(tabShapeOf(shown.layout)).toEqual([['a'], ['[*b c]']]);
        expect(shown.at).toEqual(second);
        expect(shown.from).toEqual(first);
        expect(shown.replaced).toBeNull();
        expect(shown.tab).toBeUndefined();
        expect(tabShapeOf(undoShowView(shown.layout, shown))).toEqual([['a'], ['[*b c]']]);
        expect(undoShowView(shown.layout, shown).focus).toEqual(first);
    });

    test('1: the active view of the focused cell is nothing to show, a background tab of it is not', () => {
        const layout = gridOf([['a'], ['[b *c]']], second);
        expect(showViewIn(layout, 'c')).toBeNull();
        expect(tabShapeOf(showViewIn(layout, 'b')!.layout)).toEqual([['a'], ['[*b c]']]);
    });

    test('2: a focused host takes the view as a new tab right of the active one', () => {
        const layout = gridOf([['a'], ['[b *c d]']], second);
        const shown = showViewIn(layout, 'x')!;
        expect(tabShapeOf(shown.layout)).toEqual([['a'], ['[b c *x d]']]);
        expect(shown.layout.focus).toEqual(second);
        expect(shown.replaced).toBeNull();
        const back = undoShowView(shown.layout, shown);
        expect(tabShapeOf(back)).toEqual([['a'], ['[b *c d]']]);
        expect(back.focus).toEqual(second);
    });

    test('2: it comes before every other rule', () => {
        const layout = gridOf([['[a *b]'], ['[c *d]']], first);
        const shown = showViewIn(layout, 'x', { loose: true, newTab: true, host: 'c' })!;
        expect(tabShapeOf(shown.layout)).toEqual([['[a b *x]'], ['[c *d]']]);
    });

    test('3: a new tab turns the focused plain cell into a host and undo makes it plain again', () => {
        const layout = gridOf([['a'], ['b']], second);
        const shown = showViewIn(layout, 'x', { newTab: true })!;
        expect(tabShapeOf(shown.layout)).toEqual([['a'], ['[b *x]']]);
        expect(shown.at).toEqual(second);
        const back = undoShowView(shown.layout, shown);
        expect(tabShapeOf(back)).toEqual([['a'], ['b']]);
        expect(cellAt(back, second)!.tabs).toBeUndefined();
    });

    test('4: a loose view goes to the first host in reading order and that host takes the focus', () => {
        const layout = gridOf([['a', '[b *c]'], ['[d *e]']], first);
        const shown = showViewIn(layout, 'x', { loose: true })!;
        expect(tabShapeOf(shown.layout)).toEqual([['a', '[b c *x]'], ['[d *e]']]);
        expect(shown.at).toEqual({ column: 0, cell: 1 });
        expect(shown.layout.focus).toEqual({ column: 0, cell: 1 });
        expect(shown.from).toEqual(first);
        const back = undoShowView(shown.layout, shown);
        expect(tabShapeOf(back)).toEqual([['a', '[b *c]'], ['[d *e]']]);
        expect(back.focus).toEqual(first);
    });

    test('4: the host of the named view wins, but only when that view stands in a host', () => {
        const layout = gridOf([['a'], ['[b *c]'], ['[d *e]']], first);
        expect(tabShapeOf(showViewIn(layout, 'x', { loose: true, host: 'd' })!.layout)).toEqual([['a'], ['[b *c]'], ['[d e *x]']]);
        expect(tabShapeOf(showViewIn(layout, 'x', { loose: true, host: 'a' })!.layout)).toEqual([['a'], ['[b c *x]'], ['[d *e]']]);
    });

    test('5: a loose view without a host replaces the focused cell by a host of its own', () => {
        const layout = gridOf([['a'], ['b']], second);
        const shown = showViewIn(layout, 'x', { loose: true })!;
        expect(tabShapeOf(shown.layout)).toEqual([['a'], ['[*x]']]);
        expect(shown.replaced).toBe('b');
        expect(shown.at).toEqual(second);
        const back = undoShowView(shown.layout, shown);
        expect(tabShapeOf(back)).toEqual([['a'], ['b']]);
        expect(cellAt(back, second)!.tabs).toBeUndefined();
        sums(shown.layout);
    });

    test('6: otherwise it replaces the view in the focused cell, even with a host elsewhere', () => {
        const layout = gridOf([['a'], ['[b *c]']], first);
        const shown = showViewIn(layout, 'x')!;
        expect(tabShapeOf(shown.layout)).toEqual([['x'], ['[b *c]']]);
        expect(shown.replaced).toBe('a');
        expect(tabShapeOf(undoShowView(shown.layout, shown))).toEqual([['a'], ['[b *c]']]);
    });

    test('undo of a tab takes the person back to the tab that was active, and leaves a gone cell alone', () => {
        const layout = gridOf([['a'], ['[b *c d]']], second);
        const shown = showViewIn(layout, 'x')!;
        const closed = closeCell(shown.layout, second)!;
        expect(tabShapeOf(undoShowView(closed, shown))).toEqual([['a']]);
        // The person moved to another tab meanwhile, so that choice stays.
        const moved = activateTab(shown.layout, 'd');
        expect(tabShapeOf(undoShowView(moved, shown))).toEqual([['a'], ['[b c *d]']]);
    });

    test('undo of a replaced host cell leaves a cell that grew more tabs alone', () => {
        const shown = showViewIn(gridOf([['a']]), 'x', { loose: true })!;
        const grown = showViewIn(shown.layout, 'y')!.layout;
        expect(tabShapeOf(undoShowView(grown, shown))).toEqual([['[x *y]']]);
    });
});

describe('dropAsTab', () => {
    test('reorders inside the host, counting among the resulting tabs', () => {
        const layout = gridOf([['[a *b c]']]);
        expect(tabShapeOf(dropAsTab(layout, 'b', first, 2))).toEqual([['[a c *b]']]);
        expect(tabShapeOf(dropAsTab(layout, 'b', first, 0))).toEqual([['[*b a c]']]);
        expect(tabShapeOf(dropAsTab(layout, 'a', first, 1))).toEqual([['[b *a c]']]);
        expect(tabShapeOf(dropAsTab(layout, 'c', first, null))).toEqual([['[a b *c]']]);
    });

    test('from a plain cell the cell goes and its column collapses', () => {
        const layout = dropAsTab(gridOf([['a'], ['b'], ['c']]), 'c', first, null);
        expect(tabShapeOf(layout)).toEqual([['[a *c]'], ['b']]);
        expect(layout.focus).toEqual(first);
        sums(layout);
    });

    test('a target behind the emptied column moves up with it', () => {
        const layout = dropAsTab(gridOf([['a'], ['b'], ['c']]), 'a', { column: 2, cell: 0 }, null);
        expect(tabShapeOf(layout)).toEqual([['b'], ['[c *a]']]);
        expect(layout.focus).toEqual(second);
        sums(layout);
    });

    test('a target below the emptied cell of its own column moves up with it', () => {
        const layout = dropAsTab(gridOf([['a', 'b', 'c']]), 'a', { column: 0, cell: 2 }, null);
        expect(tabShapeOf(layout)).toEqual([['b', '[c *a]']]);
        expect(layout.focus).toEqual({ column: 0, cell: 1 });
    });

    test('onto a plain cell it becomes a host, the index counting in the resulting tabs', () => {
        expect(tabShapeOf(dropAsTab(gridOf([['a'], ['b']]), 'b', first, 0))).toEqual([['[*b a]']]);
        expect(tabShapeOf(dropAsTab(gridOf([['a'], ['b']]), 'b', first, 1))).toEqual([['[a *b]']]);
        expect(tabShapeOf(dropAsTab(gridOf([['a'], ['b']]), 'b', first, null))).toEqual([['[a *b]']]);
    });

    test('index null puts the view right of the active tab', () => {
        expect(tabShapeOf(dropAsTab(gridOf([['[*a b]'], ['c']]), 'c', first, null))).toEqual([['[a *c b]']]);
    });

    test('from a host with several tabs only the tab leaves, and the right neighbor takes over', () => {
        const layout = dropAsTab(gridOf([['[a *b c]'], ['[d *e]']]), 'b', second, 1);
        expect(tabShapeOf(layout)).toEqual([['[a *c]'], ['[d *b e]']]);
        expect(layout.focus).toEqual(second);
        expect(tabShapeOf(dropAsTab(gridOf([['[a b *c]'], ['d']]), 'c', second, null))).toEqual([['[a *b]'], ['[d *c]']]);
    });

    test('a background tab leaving keeps the active tab of its host', () => {
        expect(tabShapeOf(dropAsTab(gridOf([['[*a b c]'], ['d']]), 'c', second, null))).toEqual([['[*a b]'], ['[d *c]']]);
    });

    test('from a one-tab host the cell goes', () => {
        expect(tabShapeOf(dropAsTab(gridOf([['[*a]'], ['b']]), 'a', second, null))).toEqual([['[b *a]']]);
    });

    test('a view that is not in the layout is just added', () => {
        const layout = dropAsTab(gridOf([['a']]), 'x', first, null);
        expect(tabShapeOf(layout)).toEqual([['[a *x]']]);
        sums(layout);
    });

    test('canDropAsTab refuses a missing cell and the cell the view fills alone', () => {
        const layout = gridOf([['a'], ['[*b]'], ['[c d]']]);
        expect(canDropAsTab(layout, { column: 9, cell: 0 }, 'a')).toBe(false);
        expect(canDropAsTab(layout, first, 'a')).toBe(false);
        expect(canDropAsTab(layout, second, 'b')).toBe(false);
        expect(canDropAsTab(layout, { column: 2, cell: 0 }, 'c')).toBe(true);
        expect(canDropAsTab(layout, first, 'x')).toBe(true);
        expect(dropAsTab(layout, 'a', first, 0)).toBe(layout);
    });
});

describe('closeTab', () => {
    test('the right neighbor becomes active, else the left one', () => {
        expect(tabShapeOf(closeTab(gridOf([['[a *b c]']]), 'b')!)).toEqual([['[a *c]']]);
        expect(tabShapeOf(closeTab(gridOf([['[a b *c]']]), 'c')!)).toEqual([['[a *b]']]);
    });

    test('a background tab leaves the active one where it is', () => {
        expect(tabShapeOf(closeTab(gridOf([['[*a b c]']]), 'c')!)).toEqual([['[*a b]']]);
    });

    test('a host stays a host while one tab is left', () => {
        const layout = closeTab(gridOf([['[a *b]']]), 'a')!;
        expect(tabShapeOf(layout)).toEqual([['[*b]']]);
        expect(isTabHost(cellAt(layout, first)!)).toBe(true);
    });

    test('the last view of a cell closes the cell', () => {
        const layout = closeTab(gridOf([['a'], ['[*b]']], second), 'b')!;
        expect(tabShapeOf(layout)).toEqual([['a']]);
        expect(tabShapeOf(closeTab(gridOf([['a'], ['b']]), 'a')!)).toEqual([['b']]);
        sums(layout);
    });

    test('the last cell answers null and a view that is not there changes nothing', () => {
        expect(closeTab(gridOf([['[*a]']]), 'a')).toBeNull();
        const layout = gridOf([['a']]);
        expect(closeTab(layout, 'x')).toBe(layout);
    });
});

describe('moveTabBy', () => {
    test('moves a tab along the strip and stops at the ends', () => {
        const layout = gridOf([['[a *b c]']]);
        expect(tabShapeOf(moveTabBy(layout, 'b', -1))).toEqual([['[*b a c]']]);
        expect(tabShapeOf(moveTabBy(layout, 'b', 1))).toEqual([['[a c *b]']]);
        expect(tabShapeOf(moveTabBy(layout, 'a', 5))).toEqual([['[*b c a]']]);
        expect(tabShapeOf(moveTabBy(layout, 'c', -9))).toEqual([['[c a *b]']]);
    });

    test('a tab at the end and a plain cell stay as they are', () => {
        const layout = gridOf([['[a *b c]'], ['d']]);
        expect(moveTabBy(layout, 'c', 1)).toBe(layout);
        expect(moveTabBy(layout, 'd', 1)).toBe(layout);
        expect(moveTabBy(layout, 'x', 1)).toBe(layout);
    });
});

describe('ungroup', () => {
    test('a host of one tab becomes a plain cell', () => {
        const layout = ungroup(gridOf([['[*a]'], ['b']]), first);
        expect(tabShapeOf(layout)).toEqual([['a'], ['b']]);
        expect(cellAt(layout, first)!.tabs).toBeUndefined();
        sums(layout);
    });

    test('anything else is unchanged', () => {
        const layout = gridOf([['[a *b]'], ['c']]);
        expect(ungroup(layout, first)).toBe(layout);
        expect(ungroup(layout, second)).toBe(layout);
        expect(ungroup(layout, { column: 5, cell: 0 })).toBe(layout);
    });
});

describe('replaceViewId', () => {
    test('renames a view wherever it stands', () => {
        expect(tabShapeOf(replaceViewId(gridOf([['a'], ['[b *c]']]), 'c', 'z'))).toEqual([['a'], ['[b *z]']]);
        expect(tabShapeOf(replaceViewId(gridOf([['a'], ['[b *c]']]), 'b', 'z'))).toEqual([['a'], ['[z *c]']]);
        expect(tabShapeOf(replaceViewId(gridOf([['a'], ['b']]), 'a', 'z'))).toEqual([['z'], ['b']]);
    });

    test('a view that is not there changes nothing', () => {
        const layout = gridOf([['a']]);
        expect(replaceViewId(layout, 'x', 'z')).toBe(layout);
    });
});

describe('canSplit with tabs', () => {
    const full = gridOf([
        ['[a *b]', 'c', 'd'],
        ['e', 'f', 'g'],
        ['h', 'i', 'j']
    ]);

    test('a tab leaving a full grid frees no cell and no column', () => {
        for (const direction of ['left', 'right', 'up', 'down'] as SplitDirection[]) {
            expect(canSplit(full, { column: 1, cell: 1 }, direction, 'b')).toBe(false);
        }
        expect(canSplit(full, { column: 1, cell: 1 }, 'center', 'b')).toBe(true);
        expect(canSplit(gridOf([['[*a]'], ['b'], ['c']]), second, 'right', 'a')).toBe(true);
    });

    test('a tab may split off next to its own host, but not swap with itself', () => {
        const layout = gridOf([['[a *b]']]);
        expect(canSplit(layout, first, 'right', 'b')).toBe(true);
        expect(canSplit(layout, first, 'down', 'b')).toBe(true);
        expect(canSplit(layout, first, 'center', 'b')).toBe(false);
    });
});

describe('dropView with tabs', () => {
    test('an edge puts a tab in a new plain cell and leaves the host with the neighbor active', () => {
        const layout = dropView(gridOf([['[a *b]'], ['c']]), 'b', second, 'down');
        expect(tabShapeOf(layout)).toEqual([['[*a]'], ['c', 'b']]);
        expect(layout.focus).toEqual({ column: 1, cell: 1 });
        sums(layout);
    });

    test('an edge of its own host splits the tab off beside it', () => {
        expect(tabShapeOf(dropView(gridOf([['[a *b]']]), 'b', first, 'right'))).toEqual([['[*a]'], ['b']]);
    });

    test('the middle trades a tab with the active view of a plain target', () => {
        const layout = dropView(gridOf([['[a *b]'], ['c']]), 'b', second, 'center');
        expect(tabShapeOf(layout)).toEqual([['[a *c]'], ['b']]);
        expect(layout.focus).toEqual(second);
    });

    test('the middle trades a tab with the active view of a host', () => {
        expect(tabShapeOf(dropView(gridOf([['[a *b]'], ['[c *d]']]), 'b', second, 'center'))).toEqual([['[a *d]'], ['[c *b]']]);
    });

    test('the middle with a view nobody shows replaces the active tab of a host in place', () => {
        expect(tabShapeOf(dropView(gridOf([['[a *b c]']]), 'x', first, 'center'))).toEqual([['[a *x c]']]);
    });

    test('a view that fills its cell alone swaps the whole cells, tabs included', () => {
        const layout = dropView(gridOf([['[*a]'], ['[c *d]']]), 'a', second, 'center');
        expect(tabShapeOf(layout)).toEqual([['[c *d]'], ['[*a]']]);
        expect(layout.focus).toEqual(second);
        sums(layout);
    });

    test('a one-tab host that is split off keeps being a host', () => {
        expect(tabShapeOf(dropView(gridOf([['[*a]'], ['b']]), 'a', second, 'down'))).toEqual([['b', '[*a]']]);
    });
});

describe('moveCell', () => {
    test('the middle swaps the whole cells and keeps the shares where they stand', () => {
        const layout = moveCell(gridOf([['[a *b]', 'c']]), first, { column: 0, cell: 1 }, 'center');
        expect(tabShapeOf(layout)).toEqual([['c', '[a *b]']]);
        expect(layout.focus).toEqual({ column: 0, cell: 1 });
        sums(layout);
    });

    test('an edge splits and the tabs travel along', () => {
        const layout = moveCell(gridOf([['[a *b]'], ['c']]), first, second, 'down');
        expect(tabShapeOf(layout)).toEqual([['c', '[a *b]']]);
        expect(layout.focus).toEqual({ column: 0, cell: 1 });
        sums(layout);
    });

    test('a column the move empties is free for the drop, and the limits still hold', () => {
        expect(tabShapeOf(moveCell(gridOf([['a'], ['b'], ['[c *d]']]), { column: 2, cell: 0 }, first, 'right'))).toEqual([['a'], ['[c *d]'], ['b']]);
        const tall = gridOf([['a', 'b', 'c'], ['d']]);
        expect(moveCell(tall, second, { column: 0, cell: 1 }, 'down')).toBe(tall);
    });

    test('a cell dropped on itself or from nowhere changes nothing', () => {
        const layout = gridOf([['a'], ['b']]);
        expect(moveCell(layout, first, first, 'center')).toBe(layout);
        expect(moveCell(layout, first, first, 'right')).toBe(layout);
        expect(moveCell(layout, { column: 5, cell: 0 }, first, 'center')).toBe(layout);
    });
});

describe('canMoveCell', () => {
    test('asks whether the whole cell fits, as the cell leaves where it stood', () => {
        const full = gridOf([['[a *b]'], ['c'], ['d']]);
        expect(canMoveCell(full, { column: 0, cell: 0 }, { column: 1, cell: 0 }, 'right')).toBe(true);
        expect(canMoveCell(gridOf([['[a *b]', 'c']]), first, first, 'right')).toBe(false);
        expect(canMoveCell(gridOf([['a', 'b', 'c'], ['[d *e]']]), { column: 1, cell: 0 }, first, 'down')).toBe(false);
        expect(canMoveCell(full, { column: 5, cell: 0 }, first, 'center')).toBe(false);
    });
});

describe('cleanLayout with tabs', () => {
    test('drops unknown tabs per tab and repairs the active one', () => {
        const layout = cleanLayout(gridOf([['[a *b c]']]), ['a', 'c'])!;
        expect(tabShapeOf(layout)).toEqual([['[*a c]']]);
    });

    test('drops a view that stands twice and a host left with nothing', () => {
        expect(tabShapeOf(cleanLayout(gridOf([['[a b]'], ['[b *c]']]), ['a', 'b', 'c'])!)).toEqual([['[*a b]'], ['[*c]']]);
        expect(tabShapeOf(cleanLayout(gridOf([['a'], ['[x y]']]), ['a'])!)).toEqual([['a']]);
        expect(tabShapeOf(cleanLayout(gridOf([['[a a]']]), ['a'])!)).toEqual([['[*a]']]);
    });

    test('a viewId outside the tabs goes to the first tab', () => {
        const layout: SplitLayout = { columns: [{ size: 1, cells: [{ viewId: 'z', tabs: ['a', 'b'], size: 1 }] }], focus: first };
        expect(tabShapeOf(cleanLayout(layout, ['a', 'b', 'z'])!)).toEqual([['[*a b]']]);
    });

    test('an empty tabs array is no host', () => {
        const layout: SplitLayout = { columns: [{ size: 1, cells: [{ viewId: 'a', tabs: [], size: 1 }] }], focus: first };
        const clean = cleanLayout(layout, ['a'])!;
        expect(cellAt(clean, first)!.tabs).toBeUndefined();
        expect(tabShapeOf(clean)).toEqual([['a']]);
    });

    test('extra ids pass for views that are not in the project', () => {
        const layout = gridOf([['a'], ['[b *l]']]);
        expect(tabShapeOf(cleanLayout(layout, ['a', 'b'], ['l'])!)).toEqual([['a'], ['[b *l]']]);
        expect(tabShapeOf(cleanLayout(layout, ['a', 'b'])!)).toEqual([['a'], ['[*b]']]);
    });

    test('a cell past the limit takes its tabs with it and the shares add up', () => {
        const tall = gridOf([['a', 'b', 'c', '[d e]']]);
        const clean = cleanLayout(tall, ['a', 'b', 'c', 'd', 'e'])!;
        expect(tabShapeOf(clean)).toEqual([['a', 'b', 'c']]);
        sums(cleanLayout(gridOf([['[a *b]', 'c']]), ['a', 'c'])!);
    });
});
