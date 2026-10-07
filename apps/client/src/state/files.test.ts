import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { ProjectCanvasView } from '@ruimte/contracts';
import {
    bindConsole,
    closeTab,
    correctTableKind,
    fileTabOf,
    isDatabaseTab,
    moveTabs,
    openTab,
    pinTab,
    placeTab,
    RECENT_FILES_LIMIT,
    rememberClosed,
    tabKey,
    tabsOverLimit,
    useFiles,
    type ClosedTab,
    type DatabaseTab,
    type FileTab,
    type Tab,
    type TabPool
} from './files.ts';
import { cellAt, cellViewIds, viewIdsIn } from '@/shell/split';
import { currentEndpointId, endpointKey } from './keys.ts';
import { textDrafts, useTextDrafts } from './text-drafts.ts';
import { useDocument } from './document.ts';

function tab(path: string, pinned = false): FileTab {
    return { key: path, path, pinned };
}

function pool(paths: string[]): TabPool {
    return { tabs: paths.map((path) => tab(path)) };
}

/* What names a tab: a file by its path, a database view by its key. */
function nameOf(entry: Tab): string {
    return isDatabaseTab(entry) ? entry.key : entry.path;
}

function paths(next: TabPool): string[] {
    return next.tabs.map(nameOf);
}

const ORDERS: DatabaseTab = { key: 'database:orders', kind: 'table', pinned: false, connectionId: 'shop', schema: 'shop', table: 'orders' };

describe('openTab', () => {
    test('brings a file that is already open to the front instead of opening it twice', () => {
        const next = openTab(pool(['a', 'b']), 'b');
        expect(next.tabs).toHaveLength(2);
        expect(next.active).toBe('b');
    });

    test("a new file is a tab at the end, and the limit is the host's to apply", () => {
        const next = openTab(pool(['a', 'b', 'c']), 'd');
        expect(paths(next)).toEqual(['a', 'b', 'c', 'd']);
        expect(next.active).toBe('d');
    });
});

describe('tabsOverLimit', () => {
    test('past the limit the leftmost unpinned tab makes room', () => {
        expect(tabsOverLimit(pool(['a', 'b', 'c', 'd']).tabs, 3, 'd')).toEqual(['a']);
        expect(tabsOverLimit(pool(['a', 'b', 'c', 'd', 'e']).tabs, 3, 'e')).toEqual(['a', 'b']);
    });

    test('a pinned tab stays and the next unpinned one goes', () => {
        expect(tabsOverLimit([tab('a', true), tab('b'), tab('c'), tab('d')], 3, 'd')).toEqual(['b']);
    });

    test('a tab that is kept stays the way a pinned one does', () => {
        expect(tabsOverLimit(pool(['a', 'b', 'c', 'd']).tabs, 3, 'd', (entry) => entry.key === 'a')).toEqual(['b']);
    });

    test('the tab that opened is never the one that goes', () => {
        expect(tabsOverLimit(pool(['a', 'b']).tabs, 1, 'a')).toEqual(['b']);
    });

    test('nothing but pinned tabs means the limit gives way, never a pin', () => {
        expect(tabsOverLimit([tab('a', true), tab('b', true), tab('c', true)], 2, 'c')).toEqual([]);
    });

    test('a table with edits nobody submitted stays the way a file with unsaved changes does', () => {
        expect(tabsOverLimit([ORDERS, tab('a'), tab('b')], 2, 'b', (entry) => entry.key === ORDERS.key)).toEqual(['a']);
    });
});

describe('a diff tab', () => {
    test('sits next to the file it belongs to instead of replacing it', () => {
        const view = { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false } as const;
        const next = openTab(pool(['a']), 'a', view);
        expect(next.tabs.map((entry) => entry.key)).toEqual(['a', 'diff:a']);
        expect(next.active).toBe('diff:a');
        expect(next.replaced).toBeUndefined();
    });

    test('another change opens in the diff tab nobody pinned and says which key it took over', () => {
        const first = openTab(pool(['a']), 'a', { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false });
        const second = openTab(first, 'b', { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: true });
        expect(second.tabs.map((entry) => entry.key)).toEqual(['a', 'diff:b']);
        expect(second.active).toBe('diff:b');
        expect(second.replaced).toBe('diff:a');
    });

    test('a pinned diff stays where it is and the next change opens beside it', () => {
        const first = openTab(pool([]), 'a', { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false });
        const pinned = pinTab(first, 'diff:a', true);
        const second = openTab(pinned, 'b', { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false });
        expect(second.tabs.map((entry) => entry.key)).toEqual(['diff:a', 'diff:b']);
        // And the one that is not pinned is the one the change after that takes over again.
        expect(openTab(second, 'c', { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false }).tabs.map((entry) => entry.key)).toEqual([
            'diff:a',
            'diff:c'
        ]);
    });

    test('opening it again in another scope moves the tab it already has', () => {
        const first = openTab(pool([]), 'a', { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false });
        const second = openTab(first, 'a', { kind: 'diff', cwd: '/repo', scope: 'base', staged: false });
        expect(second.tabs).toHaveLength(1);
        expect(fileTabOf(second, 'diff:a')?.view?.scope).toBe('base');
    });
});

describe('closeTab', () => {
    test('takes the one tab it names out of the pool', () => {
        expect(paths(closeTab(pool(['a', 'b', 'c']), 'b'))).toEqual(['a', 'c']);
    });
});

function canvas(id: string): ProjectCanvasView {
    return { kind: 'canvas', id, name: id, nodes: [], texts: [], edges: [], layouts: [] };
}

function shape(): string[][] {
    return (useDocument.getState().layout?.columns ?? []).map((column) => column.cells.map((cell) => cell.viewId));
}

/* The tabs of every cell, column by column; a plain cell is one view. */
function tabsOfCells(): string[][] {
    return (useDocument.getState().layout?.columns ?? []).flatMap((column) => column.cells.map(cellViewIds));
}

const saves = spyOn(textDrafts, 'save');

afterAll(() => {
    saves.mockRestore();
});

/* Lets the promise a save returned and the close waiting on it run. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) {
        await Promise.resolve();
    }
}

function leaveUnsaved(path: string): void {
    useTextDrafts.setState({ rows: { [endpointKey(currentEndpointId(), path)]: { disk: 'on disk', mtime: 1, text: 'edited', saving: false, problem: null } } });
}

describe('the store and the tab hosts', () => {
    beforeEach(() => {
        // Without a project id, the tabs stay out of storage the test environment does not have.
        useFiles.setState({ projectId: null, tabs: [], focusRequest: null, recent: [], unsubmitted: {}, discarding: null });
        useTextDrafts.setState({ rows: {} });
        saves.mockReset();
        saves.mockResolvedValue(true);
        useDocument
            .getState()
            .load({ version: 3, rev: 1, name: 'p', color: '#000', views: [canvas('a'), canvas('b'), canvas('c')] }, { activeViewId: 'a', views: {} });
    });

    test('opening a file makes a host of its own in the focused cell, which it replaces', () => {
        useFiles.getState().open('/p/a.ts', 5);
        expect(useDocument.getState().activeViewId).toBe('/p/a.ts');
        expect(useDocument.getState().layout!.columns[0]!.cells[0]).toMatchObject({ viewId: '/p/a.ts', tabs: ['/p/a.ts'] });
        expect(viewIdsIn(useDocument.getState().layout!)).toEqual(['/p/a.ts']);
    });

    test('with other cells around it takes the place of the focused one only', () => {
        useDocument.getState().splitFocused('right', 'b');
        useFiles.getState().open('/p/a.ts', 5);
        expect(viewIdsIn(useDocument.getState().layout!)).toEqual(['a', '/p/a.ts']);
    });

    test('a second file is a tab of the host, right of the one in front', () => {
        useFiles.getState().open('/p/a.ts', 5);
        useFiles.getState().open('/p/b.ts', 5);
        useFiles.getState().open('/p/c.ts', 5);
        expect(tabsOfCells()).toEqual([['/p/a.ts', '/p/b.ts', '/p/c.ts']]);
        useDocument.getState().activateTab('/p/a.ts');
        useFiles.getState().open('/p/d.ts', 5);
        expect(tabsOfCells()).toEqual([['/p/a.ts', '/p/d.ts', '/p/b.ts', '/p/c.ts']]);
        expect(useDocument.getState().activeViewId).toBe('/p/d.ts');
    });

    test('a file already open comes to the front instead of opening twice', () => {
        useFiles.getState().open('/p/a.ts', 5);
        useFiles.getState().open('/p/b.ts', 5);
        useFiles.getState().open('/p/a.ts', 5);
        expect(useFiles.getState().tabs.map(nameOf)).toEqual(['/p/a.ts', '/p/b.ts']);
        expect(useDocument.getState().activeViewId).toBe('/p/a.ts');
    });

    describe('with a host on screen and the focus in a plain cell', () => {
        beforeEach(() => {
            useDocument.getState().splitFocused('right', 'b');
            useFiles.getState().open('/p/a.ts', 5);
            useDocument.getState().focusCellAt({ column: 0, cell: 0 });
        });

        test('a file goes to the host that last had the focus', () => {
            expect(useDocument.getState().activeViewId).toBe('a');
            useFiles.getState().open('/p/b.ts', 5);
            expect(tabsOfCells()).toEqual([['a'], ['/p/a.ts', '/p/b.ts']]);
            expect(useDocument.getState().activeViewId).toBe('/p/b.ts');
        });

        test('opened hidden it lands there as well and the focus stays', () => {
            useFiles.getState().openHidden('/p/b.ts', 5);
            expect(tabsOfCells()).toEqual([['a'], ['/p/a.ts', '/p/b.ts']]);
            expect(shape()).toEqual([['a'], ['/p/b.ts']]);
            expect(useDocument.getState().activeViewId).toBe('a');
        });
    });

    test('of two hosts, the one that last had the focus takes the file', () => {
        useDocument.getState().splitFocused('right', 'b');
        useFiles.getState().open('/p/a.ts', 5);
        // The middle of the plain cell joins a change to it, which makes it the second host.
        useFiles.getState().dropDiff('/p/x.ts', { kind: 'diff', cwd: '/p', scope: 'worktree', staged: false }, 5, { column: 0, cell: 0 }, 'center');
        useDocument.getState().splitFocused('right', 'c');
        expect(tabsOfCells()).toEqual([['a', 'diff:/p/x.ts'], ['c'], ['/p/a.ts']]);
        useDocument.getState().focusCellAt({ column: 2, cell: 0 });
        useDocument.getState().focusCellAt({ column: 1, cell: 0 });
        useFiles.getState().open('/p/b.ts', 5);
        expect(tabsOfCells()).toEqual([['a', 'diff:/p/x.ts'], ['c'], ['/p/a.ts', '/p/b.ts']]);
    });

    test('opened hidden with no host it behaves like an open', () => {
        useFiles.getState().openHidden('/p/a.ts', 5);
        expect(viewIdsIn(useDocument.getState().layout!)).toEqual(['/p/a.ts']);
        expect(useDocument.getState().activeViewId).toBe('/p/a.ts');
    });

    test('a file opened by hand asks the cell for the keyboard, a restored project does not', () => {
        useFiles.getState().open('/p/a.ts', 5);
        useFiles.getState().open('/p/b.ts', 5);
        expect(useFiles.getState().focusRequest).toEqual({ key: '/p/b.ts', nonce: 2 });
        useFiles.getState().load(null, { tabs: [], expandedDirs: [] });
        expect(useFiles.getState().focusRequest).toEqual({ key: '/p/b.ts', nonce: 2 });
    });

    test('a row a tree opens shows the file and leaves the keyboard in the tree', () => {
        useFiles.getState().open('/p/a.ts', 5, undefined, undefined, { focus: false });
        expect(useDocument.getState().activeViewId).toBe('/p/a.ts');
        expect(useFiles.getState().focusRequest).toBeNull();
    });

    test('a diff that takes over the diff tab keeps the place of the one it replaced', () => {
        const view = { kind: 'diff', cwd: '/p', scope: 'worktree', staged: false } as const;
        useFiles.getState().open('/p/a.ts', 5);
        useFiles.getState().open('/p/a.ts', 5, view);
        useFiles.getState().open('/p/b.ts', 5);
        useFiles.getState().open('/p/c.ts', 5, view);
        expect(tabsOfCells()).toEqual([['/p/a.ts', 'diff:/p/c.ts', '/p/b.ts']]);
        expect(
            useFiles
                .getState()
                .tabs.map((entry) => entry.key)
                .sort()
        ).toEqual(['/p/a.ts', '/p/b.ts', 'diff:/p/c.ts']);
    });

    describe('the limit', () => {
        test('past it the leftmost tab of the host that is not the new one closes and is remembered', () => {
            for (const path of ['/p/a.ts', '/p/b.ts', '/p/c.ts']) {
                useFiles.getState().open(path, 2);
            }
            expect(tabsOfCells()).toEqual([['/p/b.ts', '/p/c.ts']]);
            expect(useFiles.getState().tabs.map(nameOf)).toEqual(['/p/b.ts', '/p/c.ts']);
            expect(useFiles.getState().recent).toEqual([{ kind: 'file', path: '/p/a.ts' }]);
        });

        test('a pin and unsaved changes hold a tab', () => {
            useFiles.getState().open('/p/a.ts', 2);
            useFiles.getState().open('/p/b.ts', 2);
            leaveUnsaved('/p/a.ts');
            useFiles.getState().open('/p/c.ts', 2);
            expect(tabsOfCells()).toEqual([['/p/a.ts', '/p/c.ts']]);
            useFiles.getState().setPinned('/p/c.ts', true);
            useFiles.getState().open('/p/d.ts', 2);
            expect(tabsOfCells()).toEqual([['/p/a.ts', '/p/c.ts', '/p/d.ts']]);
        });

        test('only the loose tabs count, and a view of the project is never the one that goes', () => {
            useFiles.getState().open('/p/a.ts', 2);
            useDocument.getState().setActiveView('b');
            useFiles.getState().open('/p/b.ts', 2);
            useFiles.getState().open('/p/c.ts', 2);
            expect(tabsOfCells()).toEqual([['b', '/p/b.ts', '/p/c.ts']]);
        });

        test('belongs to a host, so the tabs of another one stay', () => {
            useDocument.getState().splitFocused('right', 'b');
            useFiles.getState().open('/p/a.ts', 2);
            useFiles.getState().dropDiff('/p/x.ts', { kind: 'diff', cwd: '/p', scope: 'worktree', staged: false }, 2, { column: 0, cell: 0 }, 'center');
            useDocument.getState().focusCellAt({ column: 1, cell: 0 });
            useFiles.getState().open('/p/b.ts', 2);
            useFiles.getState().open('/p/c.ts', 2);
            expect(tabsOfCells()).toEqual([
                ['a', 'diff:/p/x.ts'],
                ['/p/b.ts', '/p/c.ts']
            ]);
        });
    });

    describe('closing a tab', () => {
        test('saves a file with unsaved changes first, and closes it once that worked', async () => {
            useFiles.getState().open('/p/a.ts', 5);
            useFiles.getState().open('/p/b.ts', 5);
            leaveUnsaved('/p/a.ts');
            useFiles.getState().close('/p/a.ts');
            expect(saves).toHaveBeenCalledTimes(1);
            expect(useFiles.getState().tabs.map(nameOf)).toEqual(['/p/a.ts', '/p/b.ts']);
            await settle();
            expect(useFiles.getState().tabs.map(nameOf)).toEqual(['/p/b.ts']);
            expect(tabsOfCells()).toEqual([['/p/b.ts']]);
        });

        test('keeps a file that would not save, which a dialog asks about', async () => {
            saves.mockResolvedValue(false);
            useFiles.getState().open('/p/a.ts', 5);
            leaveUnsaved('/p/a.ts');
            useFiles.getState().close('/p/a.ts');
            await settle();
            expect(useFiles.getState().tabs.map(nameOf)).toEqual(['/p/a.ts']);
        });

        test('a table with edits nobody submitted asks before it closes', () => {
            useFiles.getState().show({ tabs: [ORDERS], active: ORDERS.key }, 5);
            useFiles.getState().setUnsubmitted(ORDERS.key, true);
            useFiles.getState().close(ORDERS.key);
            expect(useFiles.getState().discarding).toBe(ORDERS.key);
            expect(tabsOfCells()).toEqual([[ORDERS.key]]);
            useFiles.getState().confirmDiscard();
            expect(useFiles.getState().tabs).toEqual([]);
        });

        test('the neighbor to the right takes over, then the one before it', () => {
            for (const path of ['/p/a.ts', '/p/b.ts', '/p/c.ts']) {
                useFiles.getState().open(path, 5);
            }
            useDocument.getState().activateTab('/p/b.ts');
            useFiles.getState().close('/p/b.ts');
            expect(useDocument.getState().activeViewId).toBe('/p/c.ts');
            useFiles.getState().close('/p/c.ts');
            expect(useDocument.getState().activeViewId).toBe('/p/a.ts');
        });

        test('the host goes with its last tab and the cells beside it grow', () => {
            useDocument.getState().splitFocused('right', 'b');
            useFiles.getState().open('/p/a.ts', 5);
            useFiles.getState().close('/p/a.ts');
            expect(shape()).toEqual([['a']]);
            expect(useFiles.getState().tabs).toEqual([]);
        });

        test('the last tab of the last cell leaves the first view of the project', () => {
            useFiles.getState().open('/p/a.ts', 5);
            useFiles.getState().close('/p/a.ts');
            expect(shape()).toEqual([['a']]);
        });

        test('with no view in the project it leaves an empty grid', () => {
            useDocument.getState().load({ version: 3, rev: 1, name: 'p', color: '#000', views: [] }, null);
            useFiles.getState().open('/p/a.ts', 5);
            expect(shape()).toEqual([['/p/a.ts']]);
            useFiles.getState().close('/p/a.ts');
            expect(useDocument.getState().layout).toBeNull();
        });

        test('the other tabs of a host close with it, and a view of the project stays', () => {
            useFiles.getState().open('/p/a.ts', 5);
            useDocument.getState().setActiveView('b');
            useFiles.getState().open('/p/b.ts', 5);
            useFiles.getState().closeOthers('/p/b.ts');
            expect(tabsOfCells()).toEqual([['b', '/p/b.ts']]);
            useFiles.getState().closeAll('/p/b.ts');
            expect(tabsOfCells()).toEqual([['b']]);
        });
    });

    test('a loose view that leaves the grid leaves the pool, as a closed tab does', () => {
        useDocument.getState().splitFocused('right', 'b');
        useFiles.getState().open('/p/a.ts', 5);
        useDocument.getState().closeCellAt({ column: 1, cell: 0 });
        expect(useFiles.getState().tabs).toEqual([]);
        expect(useFiles.getState().recent).toEqual([{ kind: 'file', path: '/p/a.ts' }]);
    });

    test('a file that moved keeps its tab, in the pool and in the cell that holds it', () => {
        useFiles.getState().open('/p/a.ts', 5);
        useFiles.getState().open('/p/b.ts', 5);
        const renamed = useFiles.getState().moved('/p/a.ts', '/p/c.ts');
        expect([...renamed]).toEqual([['/p/a.ts', '/p/c.ts']]);
        expect(useFiles.getState().tabs.map(nameOf)).toEqual(['/p/c.ts', '/p/b.ts']);
        expect(tabsOfCells()).toEqual([['/p/c.ts', '/p/b.ts']]);
        useFiles.getState().moved('/p/b.ts', '/p/d.ts');
        expect(useDocument.getState().activeViewId).toBe('/p/d.ts');
    });

    describe('a file dropped on the edge of a cell', () => {
        test('stands in a cell of its own, alone, with its tab in the pool', () => {
            const key = useFiles.getState().dropFile('/p/a.ts', 5, { column: 0, cell: 0 }, 'right');
            expect(key).toBe('/p/a.ts');
            expect(shape()).toEqual([['a'], ['/p/a.ts']]);
            expect(cellAt(useDocument.getState().layout!, { column: 1, cell: 0 })!.tabs).toBeUndefined();
            expect(useFiles.getState().tabs.map(nameOf)).toEqual(['/p/a.ts']);
        });

        test('answers null on a full grid, and leaves no tab behind', () => {
            useDocument.getState().splitFocused('right', 'b');
            useDocument.getState().splitFocused('right', 'c');
            expect(useFiles.getState().dropFile('/p/a.ts', 5, { column: 0, cell: 0 }, 'right')).toBeNull();
            expect(useFiles.getState().tabs).toEqual([]);
        });

        test('a file open already moves instead of appearing twice', () => {
            useFiles.getState().open('/p/a.ts', 5);
            useFiles.getState().dropFile('/p/a.ts', 5, { column: 0, cell: 0 }, 'right');
            expect(viewIdsIn(useDocument.getState().layout!).filter((id) => id === '/p/a.ts')).toHaveLength(1);
            expect(useFiles.getState().tabs).toHaveLength(1);
        });
    });

    describe('a change dropped on a cell', () => {
        const view = { kind: 'diff', cwd: '/p', scope: 'worktree', staged: false } as const;

        test('in the middle opens as a tab of that cell, which becomes a host', () => {
            expect(useFiles.getState().dropDiff('/p/a.ts', view, 5, { column: 0, cell: 0 }, 'center')).toBe(true);
            expect(tabsOfCells()).toEqual([['a', 'diff:/p/a.ts']]);
            expect(useDocument.getState().activeViewId).toBe('diff:/p/a.ts');
        });

        test('on an edge makes a plain cell beside it', () => {
            expect(useFiles.getState().dropDiff('/p/a.ts', view, 5, { column: 0, cell: 0 }, 'down')).toBe(true);
            expect(shape()).toEqual([['a', 'diff:/p/a.ts']]);
            expect(cellAt(useDocument.getState().layout!, { column: 0, cell: 1 })!.tabs).toBeUndefined();
        });

        test('on an edge of a full grid lands nowhere and leaves no tab', () => {
            useDocument.getState().splitFocused('right', 'b');
            useDocument.getState().splitFocused('right', 'c');
            expect(useFiles.getState().dropDiff('/p/a.ts', view, 5, { column: 0, cell: 0 }, 'left')).toBe(false);
            expect(useFiles.getState().tabs).toEqual([]);
        });
    });

    describe('a project that opens', () => {
        test('brings the tabs the layout stands in cells, and drops the rest', () => {
            const a = tab('/p/a.ts');
            const b = tab('/p/b.ts');
            useDocument.getState().load(
                { version: 3, rev: 1, name: 'p', color: '#000', views: [canvas('a')] },
                {
                    activeViewId: 'a',
                    views: {},
                    layout: { columns: [{ size: 1, cells: [{ viewId: a.key, tabs: [a.key], size: 1 }] }], focus: { column: 0, cell: 0 } }
                },
                { keys: [a.key, b.key], active: a.key }
            );
            useFiles.getState().load('p', { tabs: [a, b], expandedDirs: ['src/'] });
            expect(useFiles.getState().tabs).toEqual([a]);
            expect(useFiles.getState().expandedDirs).toEqual(['src/']);
        });
    });
});

describe('pinTab', () => {
    test('pins and unpins the one tab it names', () => {
        const next = pinTab(pool(['a', 'b']), 'a', true);
        expect(next.tabs.map((entry) => entry.pinned)).toEqual([true, false]);
        expect(pinTab(next, 'a', false).tabs[0]!.pinned).toBe(false);
    });
});

describe('one strip for files and database views', () => {
    test('a database view is a tab like any other and the leftmost unpinned one of any kind makes room', () => {
        const next = placeTab(pool(['a', 'b']), ORDERS);
        expect(paths(next)).toEqual(['a', 'b', ORDERS.key]);
        expect(next.active).toBe(ORDERS.key);
        expect(tabsOverLimit(next.tabs, 2, ORDERS.key)).toEqual(['a']);
    });

    test('a change never opens in the tab of a database view', () => {
        const next = openTab({ tabs: [ORDERS] }, 'a', { kind: 'diff', cwd: '/repo', scope: 'worktree', staged: false });
        expect(next.tabs.map((entry) => entry.key)).toEqual([ORDERS.key, 'diff:a']);
    });

    test('a tab of a `.sql` file runs on a connection, and goes back to the file alone', () => {
        const bound = bindConsole(pool(['/p/q.sql']), '/p/q.sql', { connectionId: 'shop', schema: 'shop' });
        expect(fileTabOf(bound, '/p/q.sql')?.console).toEqual({ connectionId: 'shop', schema: 'shop' });
        expect(fileTabOf(bindConsole(bound, '/p/q.sql', null), '/p/q.sql')).toEqual(tab('/p/q.sql'));
        expect(bindConsole(bound, ORDERS.key, null)).toBe(bound);
    });

    test('what the database says a table is corrects the tab, and a tab that already says so stays as it was', () => {
        const before: TabPool = { tabs: [ORDERS] };
        const view = correctTableKind(before, ORDERS.key, 'view');
        expect(view.tabs[0]).toEqual({ ...ORDERS, tableKind: 'view' });
        expect(correctTableKind(view, ORDERS.key, 'view')).toBe(view);
        expect(correctTableKind(before, 'nothing', 'view')).toBe(before);
    });
});

describe('the tabs closed a moment ago', () => {
    const closed = (path: string, view?: FileTab['view']): FileTab => ({ key: path, path, ...(view ? { view } : {}), pinned: false });
    const file = (path: string): ClosedTab => ({ kind: 'file', path });

    test('newest first, each file once, and only as many as the empty preview offers', () => {
        let recent: ClosedTab[] = [];
        for (const path of ['/a', '/b', '/c', '/a', '/d', '/e', '/f']) {
            recent = rememberClosed(recent, closed(path));
        }
        expect(recent).toEqual(['/f', '/e', '/d', '/a', '/c'].map(file));
        expect(recent).toHaveLength(RECENT_FILES_LIMIT);
    });

    test('a diff is not a file to go back to', () => {
        expect(rememberClosed([file('/a')], closed('/b', { kind: 'diff', cwd: '/', scope: 'worktree', staged: false }))).toEqual([file('/a')]);
        expect(rememberClosed([file('/a')], undefined)).toEqual([file('/a')]);
    });

    test('a database view comes back as it stood, once per table and filter, and unpinned', () => {
        const filtered: DatabaseTab = { ...ORDERS, key: 'database:filtered', where: '`id` = 1' };
        let recent = rememberClosed([], { ...ORDERS, pinned: true });
        recent = rememberClosed(recent, filtered);
        recent = rememberClosed(recent, { ...ORDERS, key: 'database:again' });
        expect(recent).toEqual([{ ...ORDERS, key: 'database:again' }, filtered]);
    });

    test('the designer of a table nobody made yet has nothing to go back to', () => {
        const designer: DatabaseTab = { key: 'database:new', kind: 'designer', pinned: false, connectionId: 'shop', schema: 'shop' };
        expect(rememberClosed([file('/a')], designer)).toEqual([file('/a')]);
    });
});

describe('moveTabs', () => {
    test('a tab follows its file, and says which key it had', () => {
        const next = moveTabs(pool(['/p/a.ts', '/p/b.ts']), '/p/a.ts', '/p/c.ts');
        expect(next.tabs.map((entry) => [entry.key, nameOf(entry)])).toEqual([
            ['/p/c.ts', '/p/c.ts'],
            ['/p/b.ts', '/p/b.ts']
        ]);
        expect([...next.renamed]).toEqual([['/p/a.ts', '/p/c.ts']]);
    });

    test('the files of a folder that moved follow it, and a name that only starts alike stays', () => {
        const next = moveTabs(pool(['/p/src/a.ts', '/p/src2/b.ts', '/p/src']), '/p/src', '/p/lib');
        expect(paths(next)).toEqual(['/p/lib/a.ts', '/p/src2/b.ts', '/p/lib']);
    });

    test('a diff of the file follows by the path in its key, and a commit stays', () => {
        const view = { kind: 'diff', scope: 'worktree', cwd: '/p', staged: false } as const;
        const diff: FileTab = { key: tabKey('/p/a.ts', view), path: '/p/a.ts', view, pinned: false };
        const commit: FileTab = { key: 'commit:abc', path: '/p/a.ts', view: { ...view, commit: 'abc' }, pinned: false };
        const next = moveTabs({ tabs: [diff, commit] }, '/p/a.ts', '/p/b.ts');
        expect(next.tabs.map((entry) => [entry.key, nameOf(entry)])).toEqual([
            ['diff:/p/b.ts', '/p/b.ts'],
            ['commit:abc', '/p/a.ts']
        ]);
        expect([...next.renamed]).toEqual([['diff:/p/a.ts', 'diff:/p/b.ts']]);
    });

    test('a database view is about no file, so it stays where it is', () => {
        const before: TabPool = { tabs: [ORDERS, tab('/p/a.ts')] };
        const next = moveTabs(before, '/p', '/q');
        expect(next.tabs[0]).toBe(ORDERS);
        expect(paths(next)).toEqual([ORDERS.key, '/q/a.ts']);
    });
});
