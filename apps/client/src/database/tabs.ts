import type { DatabaseAction } from '@adecore/database';
import { isDatabaseView, type ProjectDatabaseView, type ProjectView } from '@ruimte/contracts';
import { isDatabaseTab, placeTab, type DatabaseTab, type TabPool, type TabState } from '@/state/files';

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

const focus = (state: TabPool, key: string): TabState => ({ tabs: state.tabs, active: key });

/*
 * What a database view asked for, as loose tabs, with the one to bring to the front. How many a host holds
 * is the limit's to say once they are placed (`tabsOverLimit`).
 * A table opens once per table and view, and opening it again brings that tab up, except a filtered one:
 * the filter is what the person asked to see, so it gets a tab of its own. A table is designed in one tab,
 * and the designer that just created or renamed a table (`source`) becomes the designer of that table
 * rather than leaving it to a second one. `preview: false` is a double click in the explorer, which pins
 * the tab the way a double click on the tab does.
 */
export function applyDatabaseAction(state: TabPool, action: DatabaseTabAction, createId: () => string, source: string | null = null): TabState {
    const place = (tab: DatabaseTab): TabState => placeTab(state, tab);
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

/*
 * The database view of the project that already shows what an open-table action asks for, so a table is
 * never in the grid twice. The filter is part of what the person asked to see, and an empty one is none.
 */
export function databaseViewFor(views: readonly ProjectView[], action: DatabaseTabAction): ProjectDatabaseView | undefined {
    if (action.kind !== 'open-table') {
        return undefined;
    }
    const { connectionId, schema, table } = action.ref;
    const mode = action.view === 'data' ? 'data' : 'structure';
    const where = mode === 'data' ? (action.where?.trim() ?? '') : '';
    return views.find(
        (view): view is ProjectDatabaseView =>
            isDatabaseView(view) &&
            view.connectionId === connectionId &&
            view.schema === schema &&
            view.table === table &&
            view.mode === mode &&
            (view.where ?? '') === where
    );
}
