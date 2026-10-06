import type { DatabaseAction } from '@adecore/database';

/*
 * One tab of the databases cell. A table opens as its data or its structure, each a tab of its own;
 * a designer without `table` makes a new table.
 */
export type DatabaseTab =
    /* `where` opens the data filtered, as a jump along a foreign key does. */
    | { id: string; kind: 'table'; connectionId: string; schema: string; table: string; where?: string }
    | { id: string; kind: 'structure'; connectionId: string; schema: string; table: string }
    | { id: string; kind: 'console'; connectionId: string; schema?: string; sql: string; number: number }
    | { id: string; kind: 'designer'; connectionId: string; schema: string; table?: string };

export interface DatabaseTabs {
    tabs: DatabaseTab[];
    active: string | null;
}

/* What the tabs answer. Managing a connection opens a dialog, not a tab. */
export type DatabaseTabAction = Exclude<DatabaseAction, { kind: 'manage-connection' }>;

export const EMPTY_DATABASE_TABS: DatabaseTabs = { tabs: [], active: null };

const add = (state: DatabaseTabs, tab: DatabaseTab): DatabaseTabs => ({ tabs: [...state.tabs, tab], active: tab.id });

const focus = (state: DatabaseTabs, id: string): DatabaseTabs => (state.active === id ? state : { tabs: state.tabs, active: id });

/* The number a new console is called by: one past the highest of the consoles that are open. */
export function nextConsoleNumber(tabs: readonly DatabaseTab[]): number {
    return tabs.reduce((highest, tab) => (tab.kind === 'console' ? Math.max(highest, tab.number) : highest), 0) + 1;
}

/*
 * A view asked for a tab. A table opens once per table and view, and opening it again brings that tab
 * up, except a filtered one: the filter is what the person asked to see, so it gets a tab of its own.
 * A table is designed in one tab, and the designer that just created or renamed a table (`source`)
 * becomes the designer of that table rather than leaving it to a second one.
 */
export function applyTabAction(state: DatabaseTabs, action: DatabaseTabAction, createId: () => string, source: string | null = null): DatabaseTabs {
    switch (action.kind) {
        case 'open-table': {
            const { connectionId, schema, table } = action.ref;
            const kind = action.view === 'data' ? 'table' : 'structure';
            const where = action.view === 'data' ? action.where?.trim() : undefined;
            if (where !== undefined && where !== '') {
                return add(state, { id: createId(), kind: 'table', connectionId, schema, table, where });
            }
            const open = state.tabs.find(
                (tab) =>
                    tab.kind === kind &&
                    tab.connectionId === connectionId &&
                    tab.schema === schema &&
                    tab.table === table &&
                    (tab.kind !== 'table' || tab.where === undefined)
            );
            return open === undefined ? add(state, { id: createId(), kind, connectionId, schema, table }) : focus(state, open.id);
        }
        case 'open-console':
            return add(state, {
                id: createId(),
                kind: 'console',
                connectionId: action.connectionId,
                ...(action.schema === undefined ? {} : { schema: action.schema }),
                sql: action.sql ?? '',
                number: nextConsoleNumber(state.tabs)
            });
        case 'new-table':
            return add(state, { id: createId(), kind: 'designer', connectionId: action.connectionId, schema: action.schema });
        case 'edit-table': {
            const { connectionId, schema, table } = action.ref;
            const designer = state.tabs.find((tab) => tab.id === source);
            if (designer?.kind === 'designer' && designer.connectionId === connectionId && designer.schema === schema) {
                return {
                    tabs: state.tabs.map((tab) => (tab.id === designer.id ? { ...designer, table } : tab)),
                    active: designer.id
                };
            }
            const open = state.tabs.find((tab) => tab.kind === 'designer' && tab.connectionId === connectionId && tab.schema === schema && tab.table === table);
            return open === undefined ? add(state, { id: createId(), kind: 'designer', connectionId, schema, table }) : focus(state, open.id);
        }
    }
}

export function activateDatabaseTab(state: DatabaseTabs, id: string): DatabaseTabs {
    return state.tabs.some((tab) => tab.id === id) ? focus(state, id) : state;
}

/* The neighbor takes over when the active tab closes: the one to its right, or the one before it. */
export function closeDatabaseTab(state: DatabaseTabs, id: string): DatabaseTabs {
    const index = state.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) {
        return state;
    }
    const tabs = state.tabs.filter((tab) => tab.id !== id);
    if (state.active !== id) {
        return { tabs, active: state.active };
    }
    return { tabs, active: tabs[Math.min(index, tabs.length - 1)]?.id ?? null };
}

export function setConsoleSql(state: DatabaseTabs, id: string, sql: string): DatabaseTabs {
    const tab = state.tabs.find((candidate) => candidate.id === id);
    if (tab?.kind !== 'console' || tab.sql === sql) {
        return state;
    }
    return { tabs: state.tabs.map((candidate) => (candidate.id === id ? { ...tab, sql } : candidate)), active: state.active };
}

function text(value: unknown): value is string {
    return typeof value === 'string' && value !== '';
}

function optionalText(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

/* One stored tab as the cell can draw it, or null for one this release cannot read. */
function tabOf(stored: unknown): DatabaseTab | null {
    if (typeof stored !== 'object' || stored === null) {
        return null;
    }
    const tab = stored as Record<string, unknown>;
    if (!text(tab.id) || !text(tab.connectionId)) {
        return null;
    }
    const { id, connectionId } = tab;
    switch (tab.kind) {
        case 'table':
            return text(tab.schema) && text(tab.table) && optionalText(tab.where)
                ? { id, kind: 'table', connectionId, schema: tab.schema, table: tab.table, ...(text(tab.where) ? { where: tab.where } : {}) }
                : null;
        case 'structure':
            return text(tab.schema) && text(tab.table) ? { id, kind: 'structure', connectionId, schema: tab.schema, table: tab.table } : null;
        case 'console':
            return optionalText(tab.schema) && typeof tab.sql === 'string' && Number.isInteger(tab.number) && (tab.number as number) > 0
                ? { id, kind: 'console', connectionId, ...(text(tab.schema) ? { schema: tab.schema } : {}), sql: tab.sql, number: tab.number as number }
                : null;
        case 'designer':
            return text(tab.schema) && optionalText(tab.table)
                ? { id, kind: 'designer', connectionId, schema: tab.schema, ...(text(tab.table) ? { table: tab.table } : {}) }
                : null;
        default:
            return null;
    }
}

/* What the project's local file holds, tab by tab: one this release cannot read is left out, and so is a second tab under one id. */
export function parseDatabaseTabs(stored: { tabs: unknown[]; activeTab?: string | null } | undefined): DatabaseTabs {
    const tabs: DatabaseTab[] = [];
    for (const entry of stored?.tabs ?? []) {
        const tab = tabOf(entry);
        if (tab !== null && !tabs.some((other) => other.id === tab.id)) {
            tabs.push(tab);
        }
    }
    const active = tabs.some((tab) => tab.id === stored?.activeTab) ? (stored?.activeTab ?? null) : (tabs[0]?.id ?? null);
    return { tabs, active };
}

export function serializeDatabaseTabs(state: DatabaseTabs): { tabs: unknown[]; activeTab: string | null } {
    return { tabs: state.tabs.map((tab) => ({ ...tab })), activeTab: state.active };
}
