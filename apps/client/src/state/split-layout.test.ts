import { beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectDocument, SplitLayout } from '@ruimte/contracts';
import { focusedCanvas, liveCanvases } from './canvas';
import { activeViewOf, useDocument } from './document';

function view(id: string, nodes: ProjectCanvasView['nodes'] = []): ProjectCanvasView {
    return {
        kind: 'canvas',
        id,
        name: id,
        nodes,
        texts: [],
        edges: [],
        layouts: []
    };
}

function node(id: string, x = 0, y = 0): ProjectCanvasView['nodes'][number] {
    return { id, kind: 'terminal', title: id, x, y, w: 100, h: 80 };
}

function document(views: ProjectCanvasView[]): ProjectDocument {
    return { version: 3, rev: 1, name: 'p', color: '#000', views };
}

function shape(): string[][] {
    return (useDocument.getState().layout?.columns ?? []).map((column) => column.cells.map((cell) => cell.viewId));
}

function tabsOf(): string[][] {
    return (useDocument.getState().layout?.columns ?? []).flatMap((column) => column.cells.map((cell) => cell.tabs ?? [cell.viewId]));
}

function openEditors(): string[] {
    return liveCanvases().map(([viewId]) => viewId);
}

beforeEach(() => {
    focusedCanvas().getState().setViewport({ w: 800, h: 600 });
    useDocument.getState().load(document([view('a', [node('n1')]), view('b', [node('n2')]), view('c'), view('d')]), {
        activeViewId: 'a',
        views: {}
    });
});

describe('a project without a layout on disk', () => {
    test('opens as one cell on the view that was active', () => {
        expect(shape()).toEqual([['a']]);
        expect(useDocument.getState().activeViewId).toBe('a');
        expect(openEditors()).toEqual(['a']);
    });

    test('the layout it writes back is the one on screen', () => {
        useDocument.getState().splitFocused('right', 'b');
        expect(useDocument.getState().exportLocal().layout?.columns).toHaveLength(2);
    });
});

describe('a layout on disk', () => {
    test('comes back with its cells, its focus and an editor per canvas', () => {
        const layout: SplitLayout = {
            columns: [
                { size: 0.5, cells: [{ viewId: 'a', size: 1 }] },
                { size: 0.5, cells: [{ viewId: 'b', size: 1 }] }
            ],
            focus: { column: 1, cell: 0 }
        };
        useDocument.getState().load(document([view('a', [node('n1')]), view('b', [node('n2')])]), { activeViewId: 'a', views: {}, layout });
        expect(shape()).toEqual([['a'], ['b']]);
        expect(useDocument.getState().activeViewId).toBe('b');
        expect(openEditors().sort()).toEqual(['a', 'b']);
    });

    test('a cell pointing at a view that is gone falls away with its column', () => {
        const layout: SplitLayout = {
            columns: [
                { size: 0.5, cells: [{ viewId: 'a', size: 1 }] },
                { size: 0.5, cells: [{ viewId: 'gone', size: 1 }] }
            ],
            focus: { column: 0, cell: 0 }
        };
        useDocument.getState().load(document([view('a')]), { activeViewId: 'a', views: {}, layout });
        expect(shape()).toEqual([['a']]);
    });
});

describe('splitting', () => {
    test('a split opens an editor beside the one that was there, and the new cell takes the focus', () => {
        useDocument.getState().splitFocused('right', 'b');
        expect(shape()).toEqual([['a'], ['b']]);
        expect(useDocument.getState().activeViewId).toBe('b');
        expect(openEditors().sort()).toEqual(['a', 'b']);
    });

    test('both canvases keep their own nodes', () => {
        useDocument.getState().splitFocused('right', 'b');
        const editors = new Map(liveCanvases());
        expect(editors.get('a')?.order).toEqual(['n1']);
        expect(editors.get('b')?.order).toEqual(['n2']);
    });

    test('an edit in a cell that is not focused still reaches the save', () => {
        useDocument.getState().splitFocused('right', 'b');
        const [, editor] = liveCanvases().find(([viewId]) => viewId === 'a')!;
        expect(editor.order).toEqual(['n1']);
        useDocument.getState().focusCellAt({ column: 0, cell: 0 });
        focusedCanvas().getState().addText({ x: 0, y: 0 });
        useDocument.getState().focusCellAt({ column: 1, cell: 0 });
        const saved = useDocument
            .getState()
            .exportViews()
            .find((each) => each.id === 'a') as ProjectCanvasView;
        expect(saved.texts).toHaveLength(1);
    });

    test('the grid stops at three columns and at three cells in one column', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().splitFocused('right', 'c');
        useDocument.getState().splitFocused('right', 'd');
        expect(shape()).toEqual([['a'], ['b'], ['c']]);
    });

    test('a view that is already up moves instead of appearing twice', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().dropViewAt('a', { column: 1, cell: 0 }, 'down');
        expect(shape()).toEqual([['b', 'a']]);
        expect(openEditors().sort()).toEqual(['a', 'b']);
    });
});

describe('the focus', () => {
    test('steps between cells by direction', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().focusTowards('left');
        expect(useDocument.getState().activeViewId).toBe('a');
        useDocument.getState().focusTowards('right');
        expect(useDocument.getState().activeViewId).toBe('b');
    });

    test('focusing the cell that already has the focus changes nothing', () => {
        useDocument.getState().splitFocused('right', 'b');
        const before = useDocument.getState().layout;
        useDocument.getState().focusCellAt({ column: 1, cell: 0 });
        expect(useDocument.getState().layout).toBe(before);
    });

    test('stops at the edge of the grid', () => {
        const before = useDocument.getState().layout;
        useDocument.getState().focusTowards('right');
        expect(useDocument.getState().layout).toBe(before);
    });

    test('a view that is already in a cell is focused rather than moved', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().setActiveView('a');
        expect(shape()).toEqual([['a'], ['b']]);
        expect(useDocument.getState().activeViewId).toBe('a');
    });

    test('a view that is nowhere takes the place of the one in the focused cell', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().setActiveView('c');
        expect(shape()).toEqual([['a'], ['c']]);
        expect(openEditors().sort()).toEqual(['a', 'c']);
    });
});

describe('closing a cell', () => {
    test('the neighbor grows and its editor goes', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().closeCellAt({ column: 1, cell: 0 });
        expect(shape()).toEqual([['a']]);
        expect(openEditors()).toEqual(['a']);
        expect(useDocument.getState().activeViewId).toBe('a');
    });

    test('the last cell stays, because a project always has a view open', () => {
        useDocument.getState().closeCellAt({ column: 0, cell: 0 });
        expect(shape()).toEqual([['a']]);
    });

    test('what the closing cell held is written back first', () => {
        useDocument.getState().splitFocused('right', 'b');
        focusedCanvas().getState().addText({ x: 0, y: 0 });
        useDocument.getState().closeCellAt({ column: 1, cell: 0 });
        const saved = useDocument.getState().views.find((each) => each.id === 'b') as ProjectCanvasView;
        expect(saved.texts).toHaveLength(1);
    });
});

describe('loose views in cells', () => {
    const NOTES = '/p/notes.md';

    test('stand in the layout as the focused view but are no view of the project', () => {
        expect(useDocument.getState().dropLooseAt(NOTES, { column: 0, cell: 0 }, 'right')).toBe(true);
        const state = useDocument.getState();
        expect(shape()).toEqual([['a'], [NOTES]]);
        expect(state.activeViewId).toBe(NOTES);
        expect(activeViewOf(state)).toBeNull();
        expect(state.bodyFocused).toBe(true);
        expect(state.exportViews().map((view) => view.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(state.exportLocal()).toMatchObject({ activeViewId: NOTES, layout: { columns: [{ cells: [{ viewId: 'a' }] }, { cells: [{ viewId: NOTES }] }] } });
        expect(state.edits).toBe(0);
    });

    test('leave the layout when their cell closes or is replaced', () => {
        useDocument.getState().dropLooseAt(NOTES, { column: 0, cell: 0 }, 'right');
        useDocument.getState().setActiveView('b');
        expect(shape()).toEqual([['a'], ['b']]);
        useDocument.getState().dropLooseAt('/p/other.md', { column: 1, cell: 0 }, 'down');
        useDocument.getState().closeCellAt({ column: 1, cell: 1 });
        expect(shape()).toEqual([['a'], ['b']]);
    });

    test('survive a reload of the same project and leave when another project loads', () => {
        useDocument.getState().dropLooseAt(NOTES, { column: 0, cell: 0 }, 'right');
        const changed = document([view('a'), view('b')]);
        useDocument.getState().reload(changed, useDocument.getState().exportLocal());
        expect(shape()).toEqual([['a'], [NOTES]]);
        expect(useDocument.getState().activeViewId).toBe(NOTES);
        useDocument.getState().load(changed, useDocument.getState().exportLocal());
        expect(shape()).toEqual([['a']]);
    });

    test('a full grid takes none and makes no edit', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().splitFocused('right', 'c');
        expect(useDocument.getState().dropLooseAt(NOTES, { column: 0, cell: 0 }, 'right')).toBe(false);
        expect(shape()).toEqual([['a'], ['b'], ['c']]);
        expect(useDocument.getState().edits).toBe(0);
    });

    test('shown with no host take the focused cell as a host, and the way back puts the view back', () => {
        const shown = useDocument.getState().showLoose(NOTES)!;
        expect(shown.replaced).toBe('a');
        expect(useDocument.getState().layout!.columns[0]!.cells[0]).toMatchObject({ viewId: NOTES, tabs: [NOTES] });
        useDocument.getState().undoShowView(shown);
        expect(shape()).toEqual([['a']]);
        expect(useDocument.getState().layout!.columns[0]!.cells[0]!.tabs).toBeUndefined();
    });

    test('shown in a cell of their own that holds one grow tabs there instead of replacing it', () => {
        useDocument.getState().dropLooseAt(NOTES, { column: 0, cell: 0 }, 'right');
        useDocument.getState().showLoose('/p/other.md');
        expect(useDocument.getState().layout!.columns[1]!.cells[0]).toMatchObject({ viewId: '/p/other.md', tabs: [NOTES, '/p/other.md'] });
    });

    test('shown over a loose view that is gone take the way back without it', () => {
        useDocument.getState().dropLooseAt(NOTES, { column: 0, cell: 0 }, 'right');
        const shown = useDocument.getState().showView('b')!;
        expect(shown.replaced).toBe(NOTES);
        useDocument.getState().undoShowView(shown);
        expect(shape()).toEqual([['a'], ['b']]);
    });

    test('a view deleted from a host takes its tab and leaves the other tabs standing', () => {
        useDocument.getState().dropLooseAt(NOTES, { column: 0, cell: 0 }, 'right');
        useDocument.getState().dropLooseAsTab('b', { column: 1, cell: 0 });
        expect(tabsOf()).toEqual([['a'], [NOTES, 'b']]);
        expect(useDocument.getState().trashView('b')).toBe(true);
        expect(tabsOf()).toEqual([['a'], [NOTES]]);
        expect(useDocument.getState().restoreView('b')).toBe(true);
        expect(tabsOf()).toEqual([['a'], [NOTES, 'b']]);
    });
});

describe('tab hosts in the document', () => {
    function hostOf(...keys: string[]): void {
        for (const key of keys) {
            useDocument.getState().showLoose(key);
        }
    }

    test('a view of the project shown in a focused host is a tab of it, and the way back takes it out', () => {
        hostOf('/p/a.md');
        const shown = useDocument.getState().showView('b')!;
        expect(tabsOf()).toEqual([['/p/a.md', 'b']]);
        expect(useDocument.getState().activeViewId).toBe('b');
        useDocument.getState().undoShowView(shown);
        expect(tabsOf()).toEqual([['/p/a.md']]);
    });

    test('remembers the host that last had the focus', () => {
        hostOf('/p/a.md');
        useDocument.getState().splitFocused('right', 'b');
        expect(useDocument.getState().lastHostViewId).toBe('/p/a.md');
        useDocument.getState().focusCellAt({ column: 0, cell: 0 });
        useDocument.getState().activateTab('/p/a.md');
        expect(useDocument.getState().lastHostViewId).toBe('/p/a.md');
    });

    test('steps along the tabs of the focused host, round the ends, and leaves a plain cell alone', () => {
        hostOf('/p/a.md', '/p/b.md', '/p/c.md');
        expect(useDocument.getState().activeViewId).toBe('/p/c.md');
        useDocument.getState().stepTab(1);
        expect(useDocument.getState().activeViewId).toBe('/p/a.md');
        useDocument.getState().stepTab(-1);
        expect(useDocument.getState().activeViewId).toBe('/p/c.md');
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().stepTab(1);
        expect(useDocument.getState().activeViewId).toBe('b');
    });

    test('a host moves whole, tabs and all', () => {
        hostOf('/p/a.md', '/p/b.md');
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().moveCellTo({ column: 0, cell: 0 }, { column: 1, cell: 0 }, 'center');
        expect(tabsOf()).toEqual([['b'], ['/p/a.md', '/p/b.md']]);
    });

    test('a view of the project closes as a tab without leaving the project, and the last cell stays', () => {
        hostOf('/p/a.md');
        useDocument.getState().showView('b');
        useDocument.getState().closeViewTab('b');
        expect(tabsOf()).toEqual([['/p/a.md']]);
        expect(useDocument.getState().views.map((each) => each.id)).toContain('b');
        useDocument.getState().closeViewTab('/p/a.md');
        expect(tabsOf()).toEqual([['/p/a.md']]);
    });

    test('the last tab of the last cell leaves the first view of the project', () => {
        hostOf('/p/a.md');
        useDocument.getState().closeLoose('/p/a.md');
        expect(shape()).toEqual([['a']]);
    });
});

describe('a local file with the files cell of an older release', () => {
    const FILES = {
        columns: [
            { size: 0.5, cells: [{ viewId: 'a', size: 1 }] },
            { size: 0.5, cells: [{ viewId: 'files', size: 1 }] }
        ],
        focus: { column: 1, cell: 0 }
    };

    function load(layout: SplitLayout | undefined, activeViewId: string, strip: { keys: string[]; active: string | null }): void {
        useDocument.getState().load(document([view('a'), view('b')]), { activeViewId, views: {}, ...(layout ? { layout } : {}) }, strip);
    }

    test('becomes a host whose tabs are the strip, in its order, with the tab that was up in front', () => {
        load(FILES, 'files', { keys: ['/p/a.ts', '/p/b.ts', 'database:x'], active: '/p/b.ts' });
        expect(useDocument.getState().layout!.columns[1]!.cells[0]).toEqual({ viewId: '/p/b.ts', tabs: ['/p/a.ts', '/p/b.ts', 'database:x'], size: 1 });
        expect(useDocument.getState().layout!.focus).toEqual({ column: 1, cell: 0 });
        expect(useDocument.getState().activeViewId).toBe('/p/b.ts');
    });

    test('with an empty strip leaves nothing of the cell', () => {
        load(FILES, 'files', { keys: [], active: null });
        expect(shape()).toEqual([['a']]);
    });

    test('with only an active view named reads as a grid of that one host', () => {
        load(undefined, 'files', { keys: ['/p/a.ts'], active: '/p/a.ts' });
        expect(shape()).toEqual([['/p/a.ts']]);
        expect(useDocument.getState().layout!.columns[0]!.cells[0]!.tabs).toEqual(['/p/a.ts']);
    });

    test('without the cell leaves the strip unplaced, which the pool drops', () => {
        load({ columns: [{ size: 1, cells: [{ viewId: 'a', size: 1 }] }], focus: { column: 0, cell: 0 } }, 'a', { keys: ['/p/a.ts'], active: '/p/a.ts' });
        expect(shape()).toEqual([['a']]);
    });

    test('is migrated once: what it writes back names the tabs and no files cell', () => {
        load(FILES, 'files', { keys: ['/p/a.ts'], active: '/p/a.ts' });
        const written = useDocument.getState().exportLocal();
        expect(JSON.stringify(written)).not.toContain('"files"');
        useDocument.getState().load(document([view('a'), view('b')]), written, { keys: ['/p/a.ts'], active: '/p/a.ts' });
        expect(useDocument.getState().layout!.columns[1]!.cells[0]).toMatchObject({ viewId: '/p/a.ts', tabs: ['/p/a.ts'] });
    });

    test('a cell that names a loose key the pool does not hold is dropped', () => {
        const layout: SplitLayout = {
            columns: [
                {
                    size: 1,
                    cells: [
                        { viewId: 'a', size: 1 },
                        { viewId: '/p/gone.ts', tabs: ['/p/gone.ts', '/p/here.ts'], size: 1 }
                    ]
                }
            ],
            focus: { column: 0, cell: 1 }
        };
        load(layout, 'a', { keys: ['/p/here.ts'], active: null });
        expect(tabsOf()).toEqual([['a'], ['/p/here.ts']]);
    });
});

describe('deleting a view that is in a cell', () => {
    test('takes its cell with it and leaves the rest of the grid standing', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().splitFocused('right', 'c');
        useDocument.getState().deleteView('b');
        expect(shape()).toEqual([['a'], ['c']]);
        expect(openEditors().sort()).toEqual(['a', 'c']);
    });
});

describe('resizing', () => {
    test('a drag between two columns moves the share and nothing else', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().resizeColumns([0.7, 0.3]);
        expect(useDocument.getState().layout?.columns.map((column) => column.size)).toEqual([0.7, 0.3]);
        expect(shape()).toEqual([['a'], ['b']]);
    });

    test('a drag between two cells of one column moves those two', () => {
        useDocument.getState().splitFocused('down', 'b');
        useDocument.getState().resizeCells(0, [0.25, 0.75]);
        expect(useDocument.getState().layout?.columns[0]?.cells.map((cell) => cell.size)).toEqual([0.25, 0.75]);
    });
});

describe('maximizing a cell', () => {
    const maximized = (): string | null => useDocument.getState().maximized;

    test('fills the grid with the focused cell and gives the very same grid back', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().resizeColumns([0.7, 0.3]);
        const before = useDocument.getState().layout;
        useDocument.getState().toggleMaximized();
        expect(maximized()).toBe('b');
        expect(useDocument.getState().layout).toBe(before);
        useDocument.getState().toggleMaximized();
        expect(maximized()).toBeNull();
        expect(useDocument.getState().layout).toBe(before);
    });

    test('one cell has nothing to fill', () => {
        useDocument.getState().toggleMaximized();
        expect(maximized()).toBeNull();
    });

    test('any move of the grid ends it, and a splitter drag does not', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().toggleMaximized();
        useDocument.getState().resizeColumns([0.6, 0.4]);
        expect(maximized()).toBe('b');
        useDocument.getState().splitFocused('down', 'c');
        expect(maximized()).toBeNull();
        useDocument.getState().toggleMaximized();
        useDocument.getState().focusCellAt({ column: 0, cell: 0 });
        expect(maximized()).toBeNull();
        useDocument.getState().toggleMaximized();
        useDocument.getState().closeCellAt({ column: 1, cell: 1 });
        expect(maximized()).toBeNull();
    });

    test('is never written down', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().toggleMaximized();
        expect(JSON.stringify(useDocument.getState().exportLocal())).not.toContain('maximized');
    });
});

describe('closing more than one cell', () => {
    test('the others go with their editors, and the one kept fills the grid', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().splitFocused('down', 'c');
        useDocument.getState().closeOtherCells({ column: 1, cell: 0 });
        expect(shape()).toEqual([['b']]);
        expect(openEditors()).toEqual(['b']);
        expect(useDocument.getState().activeViewId).toBe('b');
        expect(useDocument.getState().views.map((each) => each.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('the columns to the right go and the focus comes along when it was there', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().splitFocused('right', 'c');
        useDocument.getState().closeCellsRightOf({ column: 0, cell: 0 });
        expect(shape()).toEqual([['a']]);
        expect(useDocument.getState().activeViewId).toBe('a');
    });
});
