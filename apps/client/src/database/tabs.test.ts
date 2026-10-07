import { describe, expect, test } from 'bun:test';
import { closeTab, pinTab, type DatabaseTab, type Tab, type TabState } from '@/state/files';
import { applyDatabaseAction, databaseTabId, databaseTabKey, reopenAction, type DatabaseTabAction } from './tabs.ts';

const ORDERS = { connectionId: 'shop', schema: 'shop', table: 'orders' };
const EMPTY: TabState = { tabs: [], active: null };

/* Ids in the order they are asked for, so a test reads which tab is which. */
function ids(): () => string {
    let next = 0;
    return () => `t${++next}`;
}

function keys(state: TabState): string[] {
    return state.tabs.map((tab) => tab.key);
}

function apply(state: TabState, action: DatabaseTabAction, createId: () => string, source: string | null = null): TabState {
    return applyDatabaseAction(state, action, createId, source);
}

describe('opening a table', () => {
    test('opens its data once and brings that tab up when it is opened again', () => {
        const createId = ids();
        const first = apply(EMPTY, { kind: 'open-table', ref: ORDERS, view: 'data' }, createId);
        const file: Tab = { key: '/repo/a.ts', path: '/repo/a.ts', pinned: false };
        const beside: TabState = { tabs: [...first.tabs, file], active: file.key };
        const again = apply(beside, { kind: 'open-table', ref: ORDERS, view: 'data' }, createId);
        expect(keys(again)).toEqual(['database:t1', '/repo/a.ts']);
        expect(again.active).toBe('database:t1');
        expect(again.tabs[0]).toEqual({ key: 'database:t1', kind: 'table', pinned: false, ...ORDERS });
    });

    test('the structure is a tab of its own beside the data', () => {
        const createId = ids();
        const data = apply(EMPTY, { kind: 'open-table', ref: ORDERS, view: 'data' }, createId);
        const structure = apply(data, { kind: 'open-table', ref: ORDERS, view: 'structure' }, createId);
        expect(structure.tabs.map((tab) => (tab as DatabaseTab).kind)).toEqual(['table', 'structure']);
        expect(apply(structure, { kind: 'open-table', ref: ORDERS, view: 'structure' }, createId).active).toBe('database:t2');
    });

    test('a filtered table always gets a tab of its own, and the plain one is not mistaken for it', () => {
        const createId = ids();
        const data = apply(EMPTY, { kind: 'open-table', ref: ORDERS, view: 'data' }, createId);
        const filtered = apply(data, { kind: 'open-table', ref: ORDERS, view: 'data', where: '`id` = 7' }, createId);
        const twice = apply(filtered, { kind: 'open-table', ref: ORDERS, view: 'data', where: '`id` = 7' }, createId);
        expect(keys(twice)).toEqual(['database:t1', 'database:t2', 'database:t3']);
        expect(twice.tabs[1]).toMatchObject({ kind: 'table', where: '`id` = 7' });
        const plain = apply(EMPTY, { kind: 'open-table', ref: ORDERS, view: 'data', where: '`id` = 7' }, ids());
        expect(keys(apply(plain, { kind: 'open-table', ref: ORDERS, view: 'data' }, () => 'plain'))).toEqual(['database:t1', 'database:plain']);
    });

    test('an empty condition is no filter', () => {
        const opened = apply(EMPTY, { kind: 'open-table', ref: ORDERS, view: 'data', where: '  ' }, ids());
        expect(opened.tabs[0]).not.toHaveProperty('where');
    });

    test('keeps whether the table is a view, as the explorer said', () => {
        const opened = apply(EMPTY, { kind: 'open-table', ref: ORDERS, view: 'structure', tableKind: 'view' }, ids());
        expect(opened.tabs[0]).toMatchObject({ kind: 'structure', tableKind: 'view' });
    });
});

describe('a click and a double click in the explorer', () => {
    test("a click opens an unpinned tab beside the others, and the limit is the host's to apply", () => {
        const createId = ids();
        const file: Tab = { key: '/repo/a.ts', path: '/repo/a.ts', pinned: false };
        const start: TabState = { tabs: [file], active: file.key };
        const looked = apply(start, { kind: 'open-table', ref: ORDERS, view: 'data', preview: true }, createId);
        const next = apply(looked, { kind: 'open-table', ref: { ...ORDERS, table: 'items' }, view: 'data', preview: true }, createId);
        expect(keys(next)).toEqual(['/repo/a.ts', 'database:t1', 'database:t2']);
        expect(next.active).toBe('database:t2');
        expect(next.tabs.every((tab) => !tab.pinned)).toBe(true);
    });

    test('a double click keeps the tab the click opened', () => {
        const createId = ids();
        const looked = apply(EMPTY, { kind: 'open-table', ref: ORDERS, view: 'data', preview: true }, createId);
        const kept = apply(looked, { kind: 'open-table', ref: ORDERS, view: 'data', preview: false }, createId);
        expect(kept.tabs).toEqual([{ key: 'database:t1', kind: 'table', pinned: true, ...ORDERS }]);
        const more = apply(kept, { kind: 'open-table', ref: { ...ORDERS, table: 'items' }, view: 'data' }, createId);
        expect(keys(more)).toEqual(['database:t1', 'database:t2']);
        // Another look at a kept tab leaves it kept.
        expect(apply(kept, { kind: 'open-table', ref: ORDERS, view: 'data', preview: true }, createId).tabs[0]!.pinned).toBe(true);
    });
});

describe('designers', () => {
    test('a new table gets a designer each time', () => {
        const createId = ids();
        const once = apply(EMPTY, { kind: 'new-table', connectionId: 'shop', schema: 'shop' }, createId);
        expect(apply(once, { kind: 'new-table', connectionId: 'shop', schema: 'shop' }, createId).tabs).toHaveLength(2);
    });

    test('the designer that created or renamed a table becomes that table’s designer, under the key it had', () => {
        const created = apply(EMPTY, { kind: 'new-table', connectionId: 'shop', schema: 'shop' }, ids());
        const saved = apply(created, { kind: 'edit-table', ref: { ...ORDERS, table: 'invoices' } }, () => 'other', 'database:t1');
        expect(saved).toEqual({
            tabs: [{ key: 'database:t1', kind: 'designer', pinned: false, connectionId: 'shop', schema: 'shop', table: 'invoices' }],
            active: 'database:t1'
        });
    });

    test('editing a table from elsewhere brings up its designer, or opens one', () => {
        const createId = ids();
        const opened = apply(EMPTY, { kind: 'edit-table', ref: ORDERS }, createId);
        const data = apply(opened, { kind: 'open-table', ref: ORDERS, view: 'data' }, createId);
        expect(apply(data, { kind: 'edit-table', ref: ORDERS }, createId)).toMatchObject({ active: 'database:t1' });
        // A table view asking is no designer to turn into one.
        expect(apply(data, { kind: 'edit-table', ref: { ...ORDERS, table: 'items' } }, createId, 'database:t2').tabs).toHaveLength(3);
    });
});

describe('closing and pinning a database tab', () => {
    test('closes and pins the way a file tab does', () => {
        const createId = ids();
        let state = apply(EMPTY, { kind: 'open-table', ref: ORDERS, view: 'data' }, createId);
        state = apply(state, { kind: 'open-table', ref: ORDERS, view: 'structure' }, createId);
        expect(pinTab(state, 'database:t1', true).tabs[0]!.pinned).toBe(true);
        expect(closeTab(state, 'database:t2')).toEqual({ tabs: [state.tabs[0]!] });
    });
});

describe('a closed tab opened again', () => {
    test('opens the view it showed, filtered as it was', () => {
        const table: DatabaseTab = { key: 'database:a', kind: 'table', pinned: false, ...ORDERS, where: 'id = 1', tableKind: 'view' };
        const structure: DatabaseTab = { key: 'database:b', kind: 'structure', pinned: false, ...ORDERS };
        const designer: DatabaseTab = { key: 'database:c', kind: 'designer', pinned: false, ...ORDERS };
        expect(reopenAction(table)).toEqual({ kind: 'open-table', ref: ORDERS, view: 'data', where: 'id = 1', tableKind: 'view' });
        expect(reopenAction(structure)).toEqual({ kind: 'open-table', ref: ORDERS, view: 'structure' });
        expect(reopenAction(designer)).toEqual({ kind: 'edit-table', ref: ORDERS });
        expect(reopenAction({ key: 'database:d', kind: 'designer', pinned: false, connectionId: 'shop', schema: 'shop' })).toBeNull();
    });

    test('a key carries its id', () => {
        expect(databaseTabId(databaseTabKey('abc'))).toBe('abc');
    });
});
