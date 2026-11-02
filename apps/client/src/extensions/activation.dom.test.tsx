import { afterEach, describe, expect, jest, test } from 'bun:test';
import { wantsLoading, watchActivation } from '@/extensions/activation';
import { defaultCanvases, focusedCanvas } from '@/state/canvas';
import type { CanvasNode } from '@/state/canvas-model';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';

const CARD = { kind: 'extension', id: 'card-1', extension: 'acme.board', type: 'card' };

let stop: (() => void) | null = null;

function note(id: string): CanvasNode {
    return { id, kind: 'note', title: id, x: 0, y: 0, w: 100, h: 100 } as CanvasNode;
}

function canvasView(id: string): never {
    return { kind: 'canvas', id, name: id, nodes: [], texts: [], edges: [], layouts: [] } as never;
}

function twoCells(left: string, right: string) {
    return {
        columns: [
            { size: 0.5, cells: [{ viewId: left, size: 1 }] },
            { size: 0.5, cells: [{ viewId: right, size: 1 }] }
        ],
        focus: { column: 0, cell: 0 }
    };
}

afterEach(() => {
    stop?.();
    stop = null;
    jest.useRealTimers();
    defaultCanvases.keep([]);
    focusedCanvas().setState({ nodes: {} });
    useFiles.setState({ tabs: [] });
    useDocument.setState({ views: [], activeViewId: null, layout: null });
});

describe('what loads an extension', () => {
    test("loads for a view of the extension's type, read from the view as the project file keeps it", () => {
        const raw = { kind: 'extension', id: 'view-1', name: 'Board', extension: 'acme.board', type: 'board' };

        useDocument.setState({ views: [{ kind: 'unknown', id: 'view-1', name: 'Board', raw }], activeViewId: 'view-1' });

        expect(wantsLoading('acme.board', ['view:board'])).toBe(true);
        expect(wantsLoading('acme.board', ['view:list'])).toBe(false);
        expect(wantsLoading('other.board', ['view:board'])).toBe(false);
    });

    test("loads for a node of the extension's type, and not for another extension's node of the same type", () => {
        const raw = { kind: 'extension', id: 'card-1', extension: 'acme.board', type: 'card' };

        focusedCanvas().setState({ nodes: { 'card-1': { ...note('card-1'), kind: 'unknown', raw } as CanvasNode } });

        expect(wantsLoading('acme.board', ['node:card'])).toBe(true);
        expect(wantsLoading('other.board', ['node:card'])).toBe(false);
    });
});

describe('what is on screen', () => {
    test('loads for a file view of its type that the project keeps, as for a tab', () => {
        useDocument.setState({ views: [{ kind: 'file', id: 'file-1', name: 'table.csv', path: 'data/Table.CSV' } as never], activeViewId: 'file-1' });

        expect(wantsLoading('acme.csv', ['file:csv'])).toBe(true);
        expect(wantsLoading('acme.csv', ['file:tsv'])).toBe(false);
    });

    test('loads for a view in another cell of the grid than the one with the focus', () => {
        const raw = { kind: 'extension', id: 'view-2', name: 'Board', extension: 'acme.board', type: 'board' };

        useDocument.setState({
            views: [
                { kind: 'canvas', id: 'view-1', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] } as never,
                { kind: 'unknown', id: 'view-2', name: 'Board', raw }
            ],
            activeViewId: 'view-1',
            layout: {
                columns: [
                    { size: 0.5, cells: [{ viewId: 'view-1', size: 1 }] },
                    { size: 0.5, cells: [{ viewId: 'view-2', size: 1 }] }
                ],
                focus: { column: 0, cell: 0 }
            }
        });

        expect(wantsLoading('acme.board', ['view:board'])).toBe(true);
    });
});

describe('watching what loads an extension', () => {
    test('asks once for a burst, and not for a change inside a tab', () => {
        jest.useFakeTimers();

        let checks = 0;

        stop = watchActivation(() => {
            checks += 1;
        });
        focusedCanvas().setState({ nodes: { one: note('one') } });
        focusedCanvas().setState({ nodes: { one: note('one'), two: note('two') } });
        useFiles.setState({ tabs: [{ key: '/work/a.csv', path: '/work/a.csv', pinned: false } as never] });
        jest.advanceTimersByTime(100);

        expect(checks).toBe(1);

        useFiles.setState({ tabs: [{ key: '/work/a.csv', path: '/work/a.csv', pinned: true } as never] });
        jest.advanceTimersByTime(100);

        expect(checks).toBe(1);
    });

    test('asks when a node of the extension comes in a cell without the focus, and then wants it loaded', () => {
        jest.useFakeTimers();
        useDocument.setState({ views: [canvasView('view-1'), canvasView('view-2')], activeViewId: 'view-1', layout: twoCells('view-1', 'view-2') });

        let checks = 0;

        stop = watchActivation(() => {
            checks += 1;
        });

        const other = defaultCanvases.of('view-2');

        jest.advanceTimersByTime(100);
        checks = 0;
        other.setState({ nodes: { 'card-1': { ...note('card-1'), kind: 'unknown', raw: CARD } as CanvasNode } });
        jest.advanceTimersByTime(100);

        expect(checks).toBe(1);
        expect(wantsLoading('acme.board', ['node:card'])).toBe(true);

        other.setState({ nodes: { 'card-1': { ...note('card-1'), kind: 'unknown', raw: CARD, x: 40 } as CanvasNode } });
        jest.advanceTimersByTime(100);

        expect(checks).toBe(1);
    });

    test('asks when a view of the extension comes into a cell while the focus stays where it was', () => {
        jest.useFakeTimers();

        const board = {
            kind: 'unknown' as const,
            id: 'view-2',
            name: 'Board',
            raw: { kind: 'extension', id: 'view-2', name: 'Board', extension: 'acme.board', type: 'board' }
        };

        useDocument.setState({ views: [canvasView('view-1'), board], activeViewId: 'view-1', layout: twoCells('view-1', 'view-1b') });

        let checks = 0;

        stop = watchActivation(() => {
            checks += 1;
        });
        useDocument.setState({ layout: twoCells('view-1', 'view-2') });
        jest.advanceTimersByTime(100);

        expect(checks).toBe(1);
        expect(wantsLoading('acme.board', ['view:board'])).toBe(true);
    });
});
