import { beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectDocument, SplitLayout } from '@ruimte/contracts';
import { focusedCanvas, liveCanvases } from './canvas';
import { useDocument } from './document';

const view = (id: string, nodes: ProjectCanvasView['nodes'] = []): ProjectCanvasView => ({
    kind: 'canvas',
    id,
    name: id,
    nodes,
    texts: [],
    edges: [],
    layouts: []
});

const node = (id: string, x = 0, y = 0): ProjectCanvasView['nodes'][number] => ({ id, kind: 'terminal', title: id, x, y, w: 100, h: 80 });

const document = (views: ProjectCanvasView[]): ProjectDocument => ({ version: 3, rev: 1, name: 'p', color: '#000', views });

const shape = (): string[][] => (useDocument.getState().layout?.columns ?? []).map((column) => column.cells.map((cell) => cell.viewId));

const openEditors = (): string[] => liveCanvases().map(([viewId]) => viewId);

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
        useDocument.getState().resizeColumns(1, 0.7, 0.3);
        expect(useDocument.getState().layout?.columns.map((column) => column.size)).toEqual([0.7, 0.3]);
        expect(shape()).toEqual([['a'], ['b']]);
    });

    test('a drag between two cells of one column moves those two', () => {
        useDocument.getState().splitFocused('down', 'b');
        useDocument.getState().resizeCells(0, 1, 0.25, 0.75);
        expect(useDocument.getState().layout?.columns[0]?.cells.map((cell) => cell.size)).toEqual([0.25, 0.75]);
    });
});
