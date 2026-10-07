import type { DatabaseAction } from '@adecore/database';
import { isDatabaseTab, placeTab, type DatabaseTab, type Tab, type TabState } from '@/state/files';

/* What opens a tab. A console is a file (`database/console-file.ts`), and managing a connection opens a dialog. */
export type DatabaseTabAction = Exclude<DatabaseAction, { kind: 'manage-connection' } | { kind: 'open-console' }>;

const KEY_PREFIX = 'database:';

/* A database tab is named by an id of its own, so a filtered table and a new table's designer can each have one. */
export function databaseTabKey(id: string): string {
    return `${KEY_PREFIX}${id}`;
}

export function databaseTabId(key: string): string {
    return key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key;
}

const focus = (state: TabState, key: string): TabState => (state.active === key ? state : { tabs: state.tabs, active: key });

/*
 * What a database view asked for, as tabs of the files cell, under the limit and the pins the files keep.
 * A table opens once per table and view, and opening it again brings that tab up, except a filtered one:
 * the filter is what the person asked to see, so it gets a tab of its own. A table is designed in one tab,
 * and the designer that just created or renamed a table (`source`) becomes the designer of that table
 * rather than leaving it to a second one. `preview: false` is a double click in the explorer, which pins
 * the tab the way a double click on the tab does.
 */
export function applyDatabaseAction(
    state: TabState,
    action: DatabaseTabAction,
    limit: number,
    createId: () => string,
    keeps: (tab: Tab) => boolean = () => false,
    source: string | null = null
): TabState {
    const place = (tab: DatabaseTab): TabState => placeTab(state, tab, limit, keeps);
    switch (action.kind) {
        case 'open-table': {
            const { connectionId, schema, table } = action.ref;
            const pinned = action.preview === false;
            const tableKind = action.tableKind === undefined ? {} : { tableKind: action.tableKind };
            const where = action.view === 'data' ? action.where?.trim() : undefined;
            if (where !== undefined && where !== '') {
                return place({ key: databaseTabKey(createId()), kind: 'table', pinned, connectionId, schema, table, where, ...tableKind });
            }
            const kind = action.view === 'data' ? 'table' : 'structure';
            const open = state.tabs.find(
                (tab): tab is DatabaseTab & { kind: 'table' | 'structure' } =>
                    isDatabaseTab(tab) &&
                    tab.kind === kind &&
                    tab.connectionId === connectionId &&
                    tab.schema === schema &&
                    tab.table === table &&
                    (tab.kind !== 'table' || tab.where === undefined)
            );
            if (open === undefined) {
                return place({ key: databaseTabKey(createId()), kind, pinned, connectionId, schema, table, ...tableKind });
            }
            if (open.pinned || !pinned) {
                return focus(state, open.key);
            }
            return { tabs: state.tabs.map((tab) => (tab === open ? { ...open, pinned: true } : tab)), active: open.key };
        }
        case 'new-table':
            return place({ key: databaseTabKey(createId()), kind: 'designer', pinned: false, connectionId: action.connectionId, schema: action.schema });
        case 'edit-table': {
            const { connectionId, schema, table } = action.ref;
            const designer = state.tabs.find((tab) => tab.key === source);
            if (
                designer !== undefined &&
                isDatabaseTab(designer) &&
                designer.kind === 'designer' &&
                designer.connectionId === connectionId &&
                designer.schema === schema
            ) {
                return { tabs: state.tabs.map((tab) => (tab === designer ? { ...designer, table } : tab)), active: designer.key };
            }
            const open = state.tabs.find(
                (tab) => isDatabaseTab(tab) && tab.kind === 'designer' && tab.connectionId === connectionId && tab.schema === schema && tab.table === table
            );
            return open === undefined
                ? place({ key: databaseTabKey(createId()), kind: 'designer', pinned: false, connectionId, schema, table })
                : focus(state, open.key);
        }
    }
}

/* The action that opens a closed tab again as it stood. */
export function reopenAction(tab: DatabaseTab): DatabaseTabAction | null {
    if (tab.table === undefined) {
        return null;
    }
    const ref = { connectionId: tab.connectionId, schema: tab.schema, table: tab.table };
    switch (tab.kind) {
        case 'table':
            return {
                kind: 'open-table',
                ref,
                view: 'data',
                ...(tab.where === undefined ? {} : { where: tab.where }),
                ...(tab.tableKind === undefined ? {} : { tableKind: tab.tableKind })
            };
        case 'structure':
            return { kind: 'open-table', ref, view: 'structure', ...(tab.tableKind === undefined ? {} : { tableKind: tab.tableKind }) };
        case 'designer':
            return { kind: 'edit-table', ref };
    }
}
