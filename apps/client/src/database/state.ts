import type { DatabaseAction, ExplorerSelection } from '@adecore/database';
import { create } from 'zustand';
import { databaseConnections, ensureDatabaseConnections } from '@/database/connections';
import {
    activateDatabaseTab,
    applyTabAction,
    closeDatabaseTab,
    EMPTY_DATABASE_TABS,
    setConsoleSql,
    type DatabaseTab,
    type DatabaseTabs
} from '@/database/tabs';
import { DATABASES_VIEW_ID } from '@/shell/client-cells';
import { useDocument } from '@/state/document';

export interface ActOptions {
    /* The tab whose view asked, so a designer that saved a table can become the designer of that table. */
    source?: string | null;
    /* False leaves the keyboard where it is, such as in the explorer a row was opened from. */
    focus?: boolean;
}

export interface ConnectionsDialog {
    open: boolean;
    /* The connection the manager shows, or null for its first. */
    selected: string | null;
}

interface DatabaseTabsStore extends DatabaseTabs {
    /* Whose tabs these are; a project that is not open has none. */
    projectId: string | null;
    /* The tabs whose table view holds edits nobody submitted. Not saved: the edits are not either. */
    dirty: Record<string, true>;
    /* A tab a person asked to close while it holds such edits, which waits for their answer. */
    closing: string | null;
    /* Counts the tabs opened by hand. The cell watches it to take the keyboard. */
    focusRequest: number;
    /* The tab opened by hand last, which a console takes the caret in when it mounts. */
    opened: string | null;
    /* What the explorer has selected, which is where a new console runs when no tab says. */
    selection: ExplorerSelection | null;
    dialog: ConnectionsDialog;
    load(projectId: string | null, state: DatabaseTabs): void;
    act(action: DatabaseAction, options?: ActOptions): void;
    activate(id: string): void;
    /* Asks first when the tab holds edits that were not submitted. */
    requestClose(id: string): void;
    confirmClose(): void;
    cancelClose(): void;
    setDirty(id: string, dirty: boolean): void;
    setConsoleSql(id: string, sql: string): void;
    setSelection(selection: ExplorerSelection | null): void;
    openConnections(selected?: string | null): void;
    setConnectionsOpen(open: boolean): void;
    selectConnection(id: string | null): void;
}

function tabsOf(state: DatabaseTabs): DatabaseTabs {
    return { tabs: state.tabs, active: state.active };
}

/*
 * The tabs of the databases cell, the explorer's selection and the connections dialog. Which tabs are
 * open travels with the project's local file on this machine (`project/panels-port.ts`), like the file
 * tabs, never in `project.json`.
 */
export const useDatabaseTabs = create<DatabaseTabsStore>((set, get) => {
    /* A tab and the cell that draws it are one thing to a person: opening one brings the cell, the last close takes it away. */
    const open = (next: DatabaseTabs, focus: boolean): void => {
        set({ ...next, ...(focus ? { focusRequest: get().focusRequest + 1, opened: next.active } : {}) });
        useDocument.getState().showClientCell(DATABASES_VIEW_ID);
    };
    const closeNow = (id: string): void => {
        const { [id]: _dropped, ...dirty } = get().dirty;
        const next = closeDatabaseTab(tabsOf(get()), id);
        set({ ...next, dirty, closing: get().closing === id ? null : get().closing });
        if (next.tabs.length === 0) {
            useDocument.getState().hideClientCell(DATABASES_VIEW_ID);
        }
    };
    return {
        ...EMPTY_DATABASE_TABS,
        projectId: null,
        dirty: {},
        closing: null,
        focusRequest: 0,
        opened: null,
        selection: null,
        dialog: { open: false, selected: null },
        load(projectId, state) {
            set({
                projectId,
                tabs: state.tabs,
                active: state.active,
                dirty: {},
                closing: null,
                opened: null,
                selection: null,
                dialog: { open: false, selected: null }
            });
        },
        act(action, options) {
            if (action.kind === 'manage-connection') {
                get().openConnections(action.connectionId);
                return;
            }
            open(
                applyTabAction(tabsOf(get()), action, () => crypto.randomUUID(), options?.source ?? null),
                options?.focus !== false
            );
        },
        activate(id) {
            set(activateDatabaseTab(tabsOf(get()), id));
        },
        requestClose(id) {
            if (get().dirty[id] === true) {
                set({ closing: id });
            } else {
                closeNow(id);
            }
        },
        confirmClose() {
            const id = get().closing;
            if (id !== null) {
                closeNow(id);
            }
        },
        cancelClose() {
            set({ closing: null });
        },
        setDirty(id, dirty) {
            if ((get().dirty[id] === true) === dirty) {
                return;
            }
            const { [id]: _was, ...rest } = get().dirty;
            set({ dirty: dirty ? { ...rest, [id]: true } : rest });
        },
        setConsoleSql(id, sql) {
            const next = setConsoleSql(tabsOf(get()), id, sql);
            if (next.tabs !== get().tabs) {
                set({ tabs: next.tabs });
            }
        },
        setSelection(selection) {
            set({ selection });
        },
        openConnections(selected = null) {
            ensureDatabaseConnections();
            set({ dialog: { open: true, selected } });
        },
        setConnectionsOpen(open) {
            set({ dialog: { ...get().dialog, open } });
        },
        selectConnection(id) {
            set({ dialog: { ...get().dialog, selected: id } });
        }
    };
});

/* Where a new console runs: the connection of the tab in front, else of the explorer's selection, else the first there is. */
export function consoleContext(
    tabs: readonly DatabaseTab[],
    active: string | null,
    selection: ExplorerSelection | null,
    connectionIds: readonly string[]
): { connectionId: string; schema?: string } | null {
    const known = new Set(connectionIds);
    const tab = tabs.find((candidate) => candidate.id === active);
    if (tab !== undefined && known.has(tab.connectionId)) {
        return { connectionId: tab.connectionId, ...(tab.schema === undefined ? {} : { schema: tab.schema }) };
    }
    if (selection !== null && known.has(selection.connectionId)) {
        return { connectionId: selection.connectionId, ...(selection.schema === undefined ? {} : { schema: selection.schema }) };
    }
    const first = connectionIds[0];
    return first === undefined ? null : { connectionId: first };
}

/* A console on the connection a person is looking at; a project without connections gets the dialog to add one. */
export async function openNewConsole(): Promise<void> {
    ensureDatabaseConnections();
    const connections = await databaseConnections.ready();
    if (connections === null) {
        return;
    }
    const { tabs, active, selection } = useDatabaseTabs.getState();
    const context = consoleContext(
        tabs,
        active,
        selection,
        connections.map((connection) => connection.id)
    );
    if (context === null) {
        useDatabaseTabs.getState().openConnections(null);
        return;
    }
    useDatabaseTabs.getState().act({ kind: 'open-console', ...context });
}
