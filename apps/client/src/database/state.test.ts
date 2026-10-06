import { beforeEach, describe, expect, test } from 'bun:test';
import { DATABASES_VIEW_ID } from '@/shell/client-cells';
import { viewIdsIn } from '@/shell/split';
import { useDocument } from '@/state/document';
import { consoleContext, useDatabaseTabs } from './state.ts';
import type { DatabaseTab } from './tabs.ts';

const ORDERS = { connectionId: 'shop', schema: 'shop', table: 'orders' };

describe('the databases cell', () => {
    beforeEach(() => {
        useDatabaseTabs.getState().load(null, { tabs: [], active: null });
        useDatabaseTabs.setState({ focusRequest: 0 });
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

    test('opening a table puts the cell on the grid in place of the focused cell, and the keyboard in it', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDatabaseTabs.getState().act({ kind: 'open-table', ref: ORDERS, view: 'data' });
        expect(viewIdsIn(useDocument.getState().layout!)).toEqual(['a', DATABASES_VIEW_ID]);
        expect(useDocument.getState().activeViewId).toBe(DATABASES_VIEW_ID);
        expect(useDocument.getState().bodyFocused).toBe(true);
        expect(useDatabaseTabs.getState().focusRequest).toBe(1);
    });

    test('a row the explorer opens shows the tab and leaves the keyboard in the tree', () => {
        useDatabaseTabs.getState().act({ kind: 'open-table', ref: ORDERS, view: 'data' }, { focus: false });
        expect(useDatabaseTabs.getState().tabs).toHaveLength(1);
        expect(useDatabaseTabs.getState().focusRequest).toBe(0);
    });

    test('the last tab that closes takes the cell with it', () => {
        useDocument.getState().splitFocused('right', 'b');
        useDatabaseTabs.getState().act({ kind: 'open-console', connectionId: 'shop' });
        const [tab] = useDatabaseTabs.getState().tabs;
        useDatabaseTabs.getState().requestClose(tab!.id);
        expect(useDatabaseTabs.getState().tabs).toEqual([]);
        expect(viewIdsIn(useDocument.getState().layout!)).not.toContain(DATABASES_VIEW_ID);
    });

    test('a table with edits nobody submitted asks before it closes', () => {
        useDatabaseTabs.getState().act({ kind: 'open-table', ref: ORDERS, view: 'data' });
        const [tab] = useDatabaseTabs.getState().tabs;
        useDatabaseTabs.getState().setDirty(tab!.id, true);
        useDatabaseTabs.getState().requestClose(tab!.id);
        expect(useDatabaseTabs.getState()).toMatchObject({ closing: tab!.id, tabs: [tab] });
        useDatabaseTabs.getState().cancelClose();
        expect(useDatabaseTabs.getState().closing).toBeNull();
        useDatabaseTabs.getState().requestClose(tab!.id);
        useDatabaseTabs.getState().confirmClose();
        expect(useDatabaseTabs.getState()).toMatchObject({ closing: null, tabs: [], dirty: {} });
    });

    test('managing a connection opens the dialog on it instead of a tab', () => {
        useDatabaseTabs.getState().act({ kind: 'manage-connection', connectionId: 'shop' });
        expect(useDatabaseTabs.getState().dialog).toEqual({ open: true, selected: 'shop' });
        expect(useDatabaseTabs.getState().tabs).toEqual([]);
    });
});

describe('where a new console runs', () => {
    const tab: DatabaseTab = { id: 't', kind: 'structure', connectionId: 'shop', schema: 'shop', table: 'orders' };

    test('on the tab in front, else the explorer’s selection, else the first connection', () => {
        expect(consoleContext([tab], 't', { connectionId: 'logs' }, ['logs', 'shop'])).toEqual({ connectionId: 'shop', schema: 'shop' });
        expect(consoleContext([tab], null, { connectionId: 'logs', schema: 'app' }, ['logs', 'shop'])).toEqual({ connectionId: 'logs', schema: 'app' });
        expect(consoleContext([], null, null, ['logs', 'shop'])).toEqual({ connectionId: 'logs' });
        expect(consoleContext([tab], 't', null, [])).toBeNull();
    });
});
