import { beforeEach, describe, expect, test } from 'bun:test';
import { viewIdsIn } from '@/shell/split';
import { useDocument } from '@/state/document';
import { useFiles, type DatabaseTab } from '@/state/files';
import { actOnDatabase } from './open.ts';
import { useDatabasePanel } from './state.ts';

const ORDERS = { connectionId: 'shop', schema: 'shop', table: 'orders' };

describe('a database view as a loose view', () => {
    beforeEach(() => {
        useFiles.getState().load(null, { tabs: [], expandedDirs: [] });
        useFiles.setState({ focusRequest: null, recent: [], unsubmitted: {}, discarding: null });
        useDatabasePanel.getState().reset();
        useDocument.getState().load(
            {
                version: 3,
                rev: 1,
                name: 'p',
                color: '#000',
                views: [
                    { kind: 'canvas', id: 'a', name: 'a', nodes: [], texts: [], edges: [], layouts: [] },
                    { kind: 'canvas', id: 'b', name: 'b', nodes: [], texts: [], edges: [], layouts: [] }
                ]
            },
            { activeViewId: 'a', views: {} }
        );
    });

    test('opening a table puts a host on the grid in place of the focused cell, and the keyboard in it', () => {
        useDocument.getState().splitFocused('right', 'b');
        actOnDatabase({ kind: 'open-table', ref: ORDERS, view: 'data' });
        const [tab] = useFiles.getState().tabs;
        expect(viewIdsIn(useDocument.getState().layout!)).toEqual(['a', tab!.key]);
        expect(useDocument.getState().activeViewId).toBe(tab!.key);
        expect(useDocument.getState().bodyFocused).toBe(true);
        expect(useFiles.getState().focusRequest).toEqual({ key: tab!.key, nonce: 1 });
    });

    test('a second table is a tab of the host the first one stands in', () => {
        actOnDatabase({ kind: 'open-table', ref: ORDERS, view: 'data' });
        actOnDatabase({ kind: 'open-table', ref: { ...ORDERS, table: 'items' }, view: 'data' });
        const keys = useFiles.getState().tabs.map((tab) => tab.key);
        expect(keys).toHaveLength(2);
        expect(useDocument.getState().layout!.columns[0]!.cells[0]).toMatchObject({ viewId: keys[1], tabs: keys });
    });

    test('a row the explorer opens shows the tab and leaves the keyboard in the tree', () => {
        actOnDatabase({ kind: 'open-table', ref: ORDERS, view: 'data', preview: true }, { focus: false });
        expect(useFiles.getState().tabs).toHaveLength(1);
        expect(useFiles.getState().focusRequest).toBeNull();
    });

    test('the last tab that closes takes the cell with it', () => {
        useDocument.getState().splitFocused('right', 'b');
        actOnDatabase({ kind: 'new-table', connectionId: 'shop', schema: 'shop' });
        const [tab] = useFiles.getState().tabs;
        useFiles.getState().close(tab!.key);
        expect(useFiles.getState().tabs).toEqual([]);
        expect(viewIdsIn(useDocument.getState().layout!)).toEqual(['a']);
    });

    test('a table with edits nobody submitted asks before it closes', () => {
        actOnDatabase({ kind: 'open-table', ref: ORDERS, view: 'data' });
        const [tab] = useFiles.getState().tabs as DatabaseTab[];
        useFiles.getState().setUnsubmitted(tab!.key, true);
        expect(useFiles.getState().keepsOpen(tab!)).toBe(true);
        useFiles.getState().close(tab!.key);
        expect(useFiles.getState()).toMatchObject({ discarding: tab!.key, tabs: [tab] });
        useFiles.getState().cancelDiscard();
        expect(useFiles.getState().discarding).toBeNull();
        useFiles.getState().close(tab!.key);
        useFiles.getState().confirmDiscard();
        expect(useFiles.getState()).toMatchObject({ discarding: null, tabs: [], unsubmitted: {} });
        expect(useFiles.getState().recent).toEqual([{ ...tab!, pinned: false }]);
    });

    test('managing a connection opens the dialog on it instead of a tab', () => {
        actOnDatabase({ kind: 'manage-connection', connectionId: 'shop' });
        expect(useDatabasePanel.getState().dialog).toEqual({ open: true, selected: 'shop' });
        expect(useFiles.getState().tabs).toEqual([]);
    });

    test('a table the project keeps as a view is shown instead of opened a second time', () => {
        const id = useDocument.getState().addDatabaseView('orders', { ...ORDERS, mode: 'data' }, false);
        actOnDatabase({ kind: 'open-table', ref: ORDERS, view: 'data' });
        expect(useFiles.getState().tabs).toEqual([]);
        expect(useDocument.getState().activeViewId).toBe(id);
        actOnDatabase({ kind: 'open-table', ref: ORDERS, view: 'structure' });
        expect(useFiles.getState().tabs).toHaveLength(1);
    });
});
