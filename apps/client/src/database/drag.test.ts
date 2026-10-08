import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { cellViewIds } from '@/shell/split';
import { dragging, setDragging } from '@/shell/view-drag';
import { useDocument } from '@/state/document';
import { isDatabaseTab, useFiles } from '@/state/files';
import { DATABASE_DRAG_TYPE, droppedDatabase, startDatabaseDrag } from './drag';
import { dropDatabaseTab } from './open';

const ref = { connectionId: 'shop', schema: 'main', table: 'orders' };
const action = { kind: 'open-table', ref, view: 'data', tableKind: 'table' } as const;
const at = { column: 0, cell: 0 };

function canvas(id: string): ProjectView {
    return { kind: 'canvas', id, name: id, nodes: [], texts: [], edges: [], layouts: [] };
}

function transfer(): Pick<DataTransfer, 'types' | 'getData' | 'setData' | 'effectAllowed'> {
    const data = new Map<string, string>();
    return {
        get types() {
            return [...data.keys()];
        },
        getData: (type: string) => data.get(type) ?? '',
        setData: (type: string, value: string) => {
            data.set(type, value);
        },
        effectAllowed: 'all'
    };
}

function cells(): string[][] {
    return useDocument.getState().layout!.columns.flatMap((column) => column.cells.map(cellViewIds));
}

beforeEach(() => {
    useDocument.getState().load({ version: 3, rev: 1, name: 'p', color: '#000', views: [canvas('a'), canvas('b'), canvas('c')] }, null);
    useFiles.setState({ tabs: [], unsubmitted: {}, discarding: null, recent: [] });
});

afterEach(() => setDragging(null));

describe('dragging database tables from the explorer', () => {
    test('starting and canceling a drag neither opens a table nor changes the layout', () => {
        const before = useDocument.getState().layout;
        const data = transfer();
        startDatabaseDrag(data, ref, 'table');
        expect(droppedDatabase(data)).toEqual(action);
        expect(data.effectAllowed).toBe('move');
        expect(dragging()).not.toBeNull();
        setDragging(null);
        expect(useDocument.getState().layout).toBe(before);
        expect(useFiles.getState().tabs).toEqual([]);
    });

    test('a drop joins a plain view directly, without replacing it or creating a sidebar view', () => {
        expect(dropDatabaseTab(action, at, 'center')).toBe(true);
        const tab = useFiles.getState().tabs[0]!;
        expect(tab).toMatchObject({ kind: 'table', ...ref });
        expect(cells()).toEqual([['a', tab.key]]);
        expect(useDocument.getState().views.map((view) => view.id)).toEqual(['a', 'b', 'c']);
    });

    test('a drop at an edge splits the cell', () => {
        expect(dropDatabaseTab(action, at, 'right')).toBe(true);
        expect(cells()).toEqual([['a'], [useFiles.getState().tabs[0]!.key]]);
    });

    test('an already open table moves to the requested host with its unsubmitted edits', () => {
        dropDatabaseTab(action, at, 'right');
        const tab = useFiles.getState().tabs[0]!;
        useFiles.getState().setUnsubmitted(tab.key, true);
        const data = transfer();
        startDatabaseDrag(data, ref, 'table');
        expect(dragging()).toBe(tab.key);
        expect(dropDatabaseTab(droppedDatabase(data)!, at, 'center', 0)).toBe(true);
        expect(cells()).toEqual([[tab.key, 'a']]);
        expect(useFiles.getState().tabs).toEqual([tab]);
        expect(useFiles.getState().unsubmitted[tab.key]).toBe(true);
    });

    test('a table kept as a project view moves without creating a loose copy', () => {
        const id = useDocument.getState().addDatabaseView('orders', { ...ref, mode: 'data' }, false);
        const data = transfer();
        startDatabaseDrag(data, ref, 'table');
        expect(dragging()).toBe(id);
        expect(dropDatabaseTab(action, at, 'center')).toBe(true);
        expect(cells()).toEqual([['a', id]]);
        expect(useFiles.getState().tabs).toEqual([]);
    });

    test('a refused split does not leave a table in the pool', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDocument.getState().splitFocused('right', 'c');
        expect(dropDatabaseTab(action, at, 'right')).toBe(false);
        expect(useFiles.getState().tabs).toEqual([]);
        expect(cells()).toEqual([['a'], ['b'], ['c']]);
        expect(dropDatabaseTab(action, at, 'center')).toBe(true);
        expect(useFiles.getState().tabs.filter(isDatabaseTab)).toHaveLength(1);
    });

    test('database views keep their kind, and malformed drag payloads are ignored', () => {
        const data = transfer();
        startDatabaseDrag(data, ref, 'view');
        expect(droppedDatabase(data)).toMatchObject({ tableKind: 'view' });
        data.setData(DATABASE_DRAG_TYPE, 'not json');
        expect(droppedDatabase(data)).toBeNull();
        data.setData(DATABASE_DRAG_TYPE, JSON.stringify({ connectionId: 'shop', table: 3 }));
        expect(droppedDatabase(data)).toBeNull();
    });
});
