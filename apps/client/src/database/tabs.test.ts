import { describe, expect, test } from 'bun:test';
import {
    activateDatabaseTab,
    applyTabAction,
    closeDatabaseTab,
    EMPTY_DATABASE_TABS,
    nextConsoleNumber,
    parseDatabaseTabs,
    serializeDatabaseTabs,
    setConsoleSql,
    type DatabaseTabs
} from './tabs.ts';

const ORDERS = { connectionId: 'shop', schema: 'shop', table: 'orders' };

/* Ids in the order they are asked for, so a test reads which tab is which. */
function ids(): () => string {
    let next = 0;
    return () => `t${++next}`;
}

describe('opening a table', () => {
    test('opens its data once and brings that tab up when it is opened again', () => {
        const createId = ids();
        const first = applyTabAction(EMPTY_DATABASE_TABS, { kind: 'open-table', ref: ORDERS, view: 'data' }, createId);
        const console = applyTabAction(first, { kind: 'open-console', connectionId: 'shop' }, createId);
        const again = applyTabAction(console, { kind: 'open-table', ref: ORDERS, view: 'data' }, createId);
        expect(again.tabs.map((tab) => tab.id)).toEqual(['t1', 't2']);
        expect(again.active).toBe('t1');
    });

    test('the structure is a tab of its own beside the data', () => {
        const createId = ids();
        const data = applyTabAction(EMPTY_DATABASE_TABS, { kind: 'open-table', ref: ORDERS, view: 'data' }, createId);
        const structure = applyTabAction(data, { kind: 'open-table', ref: ORDERS, view: 'structure' }, createId);
        expect(structure.tabs.map((tab) => tab.kind)).toEqual(['table', 'structure']);
        expect(applyTabAction(structure, { kind: 'open-table', ref: ORDERS, view: 'structure' }, createId).active).toBe('t2');
    });

    test('a filtered table always gets a tab of its own, and the plain one is not mistaken for it', () => {
        const createId = ids();
        const data = applyTabAction(EMPTY_DATABASE_TABS, { kind: 'open-table', ref: ORDERS, view: 'data' }, createId);
        const filtered = applyTabAction(data, { kind: 'open-table', ref: ORDERS, view: 'data', where: '`id` = 7' }, createId);
        const twice = applyTabAction(filtered, { kind: 'open-table', ref: ORDERS, view: 'data', where: '`id` = 7' }, createId);
        expect(twice.tabs.map((tab) => tab.id)).toEqual(['t1', 't2', 't3']);
        expect(twice.tabs[1]).toMatchObject({ kind: 'table', where: '`id` = 7' });
        const plain = applyTabAction(EMPTY_DATABASE_TABS, { kind: 'open-table', ref: ORDERS, view: 'data', where: '`id` = 7' }, ids());
        expect(applyTabAction(plain, { kind: 'open-table', ref: ORDERS, view: 'data' }, () => 'plain').tabs.map((tab) => tab.id)).toEqual(['t1', 'plain']);
    });

    test('an empty condition is no filter', () => {
        const opened = applyTabAction(EMPTY_DATABASE_TABS, { kind: 'open-table', ref: ORDERS, view: 'data', where: '  ' }, ids());
        expect(opened.tabs[0]).not.toHaveProperty('where');
    });
});

describe('consoles and designers', () => {
    test('a console starts with what it was given and counts on from the consoles that are open', () => {
        const createId = ids();
        const one = applyTabAction(EMPTY_DATABASE_TABS, { kind: 'open-console', connectionId: 'shop', schema: 'shop', sql: 'SELECT 1' }, createId);
        const two = applyTabAction(one, { kind: 'open-console', connectionId: 'shop' }, createId);
        expect(two.tabs).toEqual([
            { id: 't1', kind: 'console', connectionId: 'shop', schema: 'shop', sql: 'SELECT 1', number: 1 },
            { id: 't2', kind: 'console', connectionId: 'shop', sql: '', number: 2 }
        ]);
        expect(nextConsoleNumber(closeDatabaseTab(two, 't2').tabs)).toBe(2);
    });

    test('a new table gets a designer each time', () => {
        const createId = ids();
        const once = applyTabAction(EMPTY_DATABASE_TABS, { kind: 'new-table', connectionId: 'shop', schema: 'shop' }, createId);
        expect(applyTabAction(once, { kind: 'new-table', connectionId: 'shop', schema: 'shop' }, createId).tabs).toHaveLength(2);
    });

    test('the designer that created or renamed a table becomes that table’s designer', () => {
        const created = applyTabAction(EMPTY_DATABASE_TABS, { kind: 'new-table', connectionId: 'shop', schema: 'shop' }, ids());
        const saved = applyTabAction(created, { kind: 'edit-table', ref: { ...ORDERS, table: 'invoices' } }, () => 'other', 't1');
        expect(saved).toEqual({ tabs: [{ id: 't1', kind: 'designer', connectionId: 'shop', schema: 'shop', table: 'invoices' }], active: 't1' });
    });

    test('editing a table from elsewhere brings up its designer, or opens one', () => {
        const createId = ids();
        const opened = applyTabAction(EMPTY_DATABASE_TABS, { kind: 'edit-table', ref: ORDERS }, createId);
        const console = applyTabAction(opened, { kind: 'open-console', connectionId: 'shop' }, createId);
        expect(applyTabAction(console, { kind: 'edit-table', ref: ORDERS }, createId)).toMatchObject({ active: 't1' });
        // A console asking is no designer to turn into one.
        expect(applyTabAction(console, { kind: 'edit-table', ref: { ...ORDERS, table: 'items' } }, createId, 't2').tabs).toHaveLength(3);
    });
});

describe('the tab strip', () => {
    const three: DatabaseTabs = {
        tabs: [
            { id: 'a', kind: 'console', connectionId: 'shop', sql: '', number: 1 },
            { id: 'b', kind: 'console', connectionId: 'shop', sql: '', number: 2 },
            { id: 'c', kind: 'console', connectionId: 'shop', sql: '', number: 3 }
        ],
        active: 'b'
    };

    test('the neighbor on the right takes over from the active tab, or the one before it at the end', () => {
        expect(closeDatabaseTab(three, 'b').active).toBe('c');
        expect(closeDatabaseTab({ ...three, active: 'c' }, 'c').active).toBe('b');
        expect(closeDatabaseTab(three, 'a')).toMatchObject({ active: 'b' });
        expect(closeDatabaseTab({ tabs: [three.tabs[0]!], active: 'a' }, 'a')).toEqual(EMPTY_DATABASE_TABS);
        expect(closeDatabaseTab(three, 'x')).toBe(three);
    });

    test('a tab that is not open cannot be brought up, and a console keeps its text', () => {
        expect(activateDatabaseTab(three, 'x')).toBe(three);
        expect(activateDatabaseTab(three, 'c').active).toBe('c');
        expect(setConsoleSql(three, 'a', 'SELECT 2').tabs[0]).toMatchObject({ sql: 'SELECT 2' });
        expect(setConsoleSql(three, 'a', '')).toBe(three);
    });
});

describe('the tabs in the local file', () => {
    test('survive the round trip', () => {
        const createId = ids();
        let state = applyTabAction(EMPTY_DATABASE_TABS, { kind: 'open-table', ref: ORDERS, view: 'data', where: 'a = 1' }, createId);
        state = applyTabAction(state, { kind: 'open-table', ref: ORDERS, view: 'structure' }, createId);
        state = applyTabAction(state, { kind: 'open-console', connectionId: 'shop', sql: 'SELECT 1' }, createId);
        state = applyTabAction(state, { kind: 'edit-table', ref: ORDERS }, createId);
        expect(parseDatabaseTabs(JSON.parse(JSON.stringify(serializeDatabaseTabs(state))))).toEqual(state);
    });

    test('a tab this release cannot read is dropped alone, and the active one has to be open', () => {
        const parsed = parseDatabaseTabs({
            tabs: [
                { id: 'a', kind: 'table', connectionId: 'shop', schema: 'shop' },
                { id: 'b', kind: 'console', connectionId: 'shop', sql: 'SELECT 1', number: 1 },
                { id: 'b', kind: 'console', connectionId: 'shop', sql: 'SELECT 2', number: 2 },
                null
            ],
            activeTab: 'a'
        });
        expect(parsed).toEqual({ tabs: [{ id: 'b', kind: 'console', connectionId: 'shop', sql: 'SELECT 1', number: 1 }], active: 'b' });
        expect(parseDatabaseTabs(undefined)).toEqual(EMPTY_DATABASE_TABS);
    });
});
