import type { Connection } from '@adecore/database';
import i18next from 'i18next';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
    isAbsolutePath,
    storedPathOf,
    type DatabaseAgentAccess,
    type DatabaseAgentAccessChangedEvent,
    type DatabaseConnection,
    type DatabaseConnectionsChangedEvent
} from '@ruimte/contracts';
import { messageOf } from '@adecore/ui';
import { databaseSecretStore, secretKeyOf, secretWrites, splitPasswords, withPasswords, type DatabaseSecretStore } from '@/database/secrets';
import { endpointKey } from '@/state/keys';
import { defaultProjectStore } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { useWindow, windowWorkspace } from '@/state/window';
import { isConnectionError, TransportError, type Transport } from '@/transport/transport';

export type ConnectionsStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface DatabaseConnectionsState {
    /* The machine and the project these are of (`endpointKey`); null while nothing asked for any. */
    key: string | null;
    status: ConnectionsStatus;
    /* Why the list could not be read. */
    error: string | null;
    rev: number;
    /* As the machine last answered. */
    saved: DatabaseConnection[];
    /* What a person made of them that the machine has not confirmed yet; null once it has. */
    local: DatabaseConnection[] | null;
    /* Why the machine refused the last save, for the dialog to say. */
    saveError: string | null;
    /* The password of each connection by id, as this window knows them. Never in `saved` or `local`. */
    passwords: Record<string, string>;
    /* What agents may do with each connection, by id, where a person set it; one that is not in it is `read`. */
    agentAccess: Record<string, DatabaseAgentAccess>;
}

/* The project the connections are of, on the machine that keeps them. */
export interface ConnectionsTarget {
    endpointId: string;
    projectId: string;
    transport: Pick<Transport, 'request' | 'on' | 'subscribeStatus'>;
}

export interface ConnectionsDeps {
    secrets: DatabaseSecretStore;
    /* Says what happened to an edit nobody saved: the list moved on elsewhere. */
    notify(title: string, description: string): void;
}

const INITIAL: DatabaseConnectionsState = {
    key: null,
    status: 'idle',
    error: null,
    rev: 0,
    saved: [],
    local: null,
    saveError: null,
    passwords: {},
    agentAccess: {}
};

/* Whether a connection cannot go into the shared file: a SQLite file outside the project folder, which the machine refuses to share. */
export function isOutsideProject(folder: string | null, connection: DatabaseConnection): boolean {
    if (connection.config.engine !== 'sqlite' || !isAbsolutePath(connection.config.path)) {
        return false;
    }
    return folder === null || isAbsolutePath(storedPathOf(folder, connection.config.path));
}

export interface DatabaseConnectionsModel {
    store: UseBoundStore<StoreApi<DatabaseConnectionsState>>;
    /* Follows this project from now on, or nothing at all with null. */
    attach(target: ConnectionsTarget | null): void;
    /* The whole list as a person left it, passwords in it, which is what the connection manager hands over. Resolves once it is saved. */
    edit(next: readonly DatabaseConnection[]): Promise<void>;
    reload(): Promise<void>;
    /* Resolves once the list was read, with what it holds; null when it could not be. */
    ready(): Promise<DatabaseConnection[] | null>;
    /* What the views open, as a selector: the same array for the same state, and the same object for a connection that did not change. */
    list(state: DatabaseConnectionsState): DatabaseConnection[];
    /* What agents may do with one connection. Resolves once the machine took it; a refusal is said through `notify`. */
    setAgentAccess(connectionId: string, access: DatabaseAgentAccess): Promise<void>;
}

/*
 * The connections of the open project and their passwords. A person's edits are shown at once and
 * saved one at a time against the rev the last answer gave, so a burst of keystrokes is a handful of
 * writes and never a conflict with itself. A change from elsewhere is never written over: a save that
 * finds the list moved on reads it again and says the edit was dropped.
 */
export function createDatabaseConnections(deps: ConnectionsDeps): DatabaseConnectionsModel {
    const store = create<DatabaseConnectionsState>(() => INITIAL);
    let target: ConnectionsTarget | null = null;
    let unsubscribe: (() => void)[] = [];
    let saving = false;
    /* Goes up with every edit, so a save knows whether what it sent is still the latest. */
    let version = 0;
    /* Goes up with every load and every change from elsewhere, so one that waited on its secrets never lands over a later one. */
    let reads = 0;
    /* What the secret store holds for this project, as far as this window wrote or read it. */
    let stored: Record<string, string> = {};
    /* The connections whose secret this window read or wrote, found or not. */
    const checked = new Set<string>();
    const waiting: (() => void)[] = [];
    /* The passwords as the machine last got them from this window; null makes the next hand-over go whatever it holds. */
    let handed: string | null = null;

    const settle = (): void => {
        for (const resolve of waiting.splice(0)) {
            resolve();
        }
    };

    const keyOf = (of: ConnectionsTarget): string => endpointKey(of.endpointId, of.projectId);

    let listed: { from: readonly unknown[]; list: DatabaseConnection[] } = { from: [], list: [] };
    const list = (state: DatabaseConnectionsState): DatabaseConnection[] => {
        const from = [state.saved, state.local, state.passwords];
        if (!from.every((part, index) => part === listed.from[index])) {
            listed = { from, list: keepUnchanged(listed.list, withPasswords(state.local ?? state.saved, state.passwords)) };
        }
        return listed.list;
    };

    const unread = (connections: readonly DatabaseConnection[]): DatabaseConnection[] => {
        const { passwords } = store.getState();
        return connections.filter((connection) => passwords[connection.id] === undefined && !checked.has(connection.id));
    };

    const readSecrets = async (of: ConnectionsTarget, connections: readonly DatabaseConnection[]): Promise<void> => {
        const read = await Promise.all(
            unread(connections).map(
                async (connection) =>
                    [connection.id, await deps.secrets.read(secretKeyOf(of.endpointId, of.projectId, connection.id)).catch(() => null)] as const
            )
        );
        if (target !== of) {
            return;
        }
        for (const [id] of read) {
            checked.add(id);
        }
        const found = read.filter((entry): entry is readonly [string, string] => entry[1] !== null);
        if (found.length === 0) {
            return;
        }
        for (const [id, secret] of found) {
            stored[id] = secret;
        }
        store.setState({ passwords: { ...Object.fromEntries(found), ...store.getState().passwords } });
    };

    /*
     * The machine keeps them in memory for the project's agents, each bound to where its connection
     * points now. Only a load and a person's own edit hand them over: a change made outside this
     * window, such as an agent pointing a connection elsewhere, must not take a password along.
     */
    const handPasswords = async (of: ConnectionsTarget): Promise<void> => {
        const { saved, passwords } = store.getState();
        const listed = Object.fromEntries(
            saved.flatMap((connection) => (passwords[connection.id] === undefined ? [] : [[connection.id, passwords[connection.id]!]]))
        );
        const text = JSON.stringify(listed);
        if (text === handed) {
            return;
        }
        handed = text;
        // A machine from before agents read databases has no such request, and an agent there never asks.
        await of.transport.request('database.passwords', { projectId: of.projectId, passwords: listed }).catch(() => undefined);
    };

    const readAgentAccess = async (of: ConnectionsTarget): Promise<void> => {
        try {
            const answer = await of.transport.request('database.agentAccess', { projectId: of.projectId });
            if (target === of) {
                store.setState({ agentAccess: answer.access });
            }
        } catch {
            // The same older machine: agents there reach no database, which the dialog leaves unsaid.
        }
    };

    const load = async (): Promise<void> => {
        const of = target;
        if (of === null) {
            return;
        }
        const ticket = ++reads;
        if (store.getState().status !== 'ready') {
            store.setState({ status: 'loading' });
        }
        try {
            const answer = await of.transport.request('database.connections', { projectId: of.projectId });
            if (target !== of || ticket !== reads) {
                return;
            }
            // A view or a test opened before its password is read would go without it.
            await readSecrets(of, answer.connections);
            if (target !== of || ticket !== reads) {
                return;
            }
            store.setState({ status: 'ready', error: null, rev: answer.rev, saved: answer.connections });
            settle();
            handed = null;
            await Promise.all([handPasswords(of), readAgentAccess(of)]);
        } catch (error: unknown) {
            if (target !== of || ticket !== reads) {
                return;
            }
            // A socket that comes back reads the list again (`subscribeStatus`), so a lost link is no failure.
            if (!isConnectionError(error)) {
                store.setState({ status: 'failed', error: messageOf(error) });
                settle();
            }
        }
    };

    const writeSecrets = async (of: ConnectionsTarget, ids: readonly string[]): Promise<void> => {
        const { passwords } = store.getState();
        for (const { id, secret } of secretWrites(stored, passwords, ids)) {
            await deps.secrets.write(secretKeyOf(of.endpointId, of.projectId, id), secret).catch(() => undefined);
            checked.add(id);
            if (secret === null) {
                delete stored[id];
            } else {
                stored[id] = secret;
            }
        }
    };

    const flush = async (): Promise<void> => {
        const of = target;
        const state = store.getState();
        if (of === null || saving || state.local === null) {
            return;
        }
        saving = true;
        const sent = version;
        const local = state.local;
        try {
            // The check comes with the database package, which a workspace loads only once a database surface asks for it.
            const { isSavable } = await import('@/database/savable');
            // A draft goes as it was last saved, so a field cleared to type another keeps the connection on the machine meanwhile.
            const sending = local.flatMap((connection) => (isSavable(connection) ? [connection] : state.saved.filter((saved) => saved.id === connection.id)));
            await writeSecrets(
                of,
                local.map((connection) => connection.id)
            );
            const answer = await of.transport.request('database.connections.save', { projectId: of.projectId, baseRev: state.rev, connections: sending });
            if (target !== of) {
                return;
            }
            const settled = version === sent && local.every(isSavable);
            store.setState({ rev: answer.rev, saved: answer.connections, saveError: null, ...(settled ? { local: null } : {}) });
            await handPasswords(of);
        } catch (error: unknown) {
            if (target !== of) {
                return;
            }
            if (error instanceof TransportError && error.code === 'rev-conflict') {
                store.setState({ local: null, saveError: null });
                deps.notify(i18next.t('databases:connections.conflict.title'), i18next.t('databases:connections.conflict.description'));
                await load();
                return;
            }
            store.setState({ saveError: messageOf(error) });
            return;
        } finally {
            if (target === of) {
                saving = false;
            }
        }
        // What was edited while this save was on its way goes next, against the rev it answered.
        if (target === of && version !== sent && store.getState().local !== null) {
            await flush();
        }
    };

    const onChanged = (event: DatabaseConnectionsChangedEvent): void => {
        const of = target;
        // A save on its way finds the list moved on and reads it again itself.
        if (of === null || event.projectId !== of.projectId || saving) {
            return;
        }
        const ticket = ++reads;
        const apply = (): void => {
            if (target !== of || ticket !== reads || saving) {
                return;
            }
            if (store.getState().local !== null) {
                deps.notify(i18next.t('databases:connections.conflict.title'), i18next.t('databases:connections.conflict.description'));
            }
            store.setState({ status: 'ready', error: null, rev: event.rev, saved: event.connections, local: null, saveError: null });
            settle();
        };
        // A connection new to this window waits for its secret, as on a load; the rest is taken as it comes.
        if (unread(event.connections).length === 0) {
            apply();
            return;
        }
        void readSecrets(of, event.connections).then(apply);
    };

    const onAgentAccess = (event: DatabaseAgentAccessChangedEvent): void => {
        if (target !== null && event.projectId === target.projectId) {
            store.setState({ agentAccess: event.access });
        }
    };

    return {
        store,
        attach(next) {
            if (next !== null && target !== null && keyOf(next) === keyOf(target) && next.transport === target.transport) {
                return;
            }
            for (const off of unsubscribe) {
                off();
            }
            unsubscribe = [];
            target = next;
            saving = false;
            stored = {};
            checked.clear();
            handed = null;
            version += 1;
            settle();
            if (next === null) {
                store.setState(INITIAL);
                return;
            }
            store.setState({ ...INITIAL, key: keyOf(next), status: 'loading' });
            unsubscribe = [
                next.transport.on('database.connections.changed', onChanged),
                next.transport.on('database.agentAccess.changed', onAgentAccess),
                // What changed while the socket was gone was told to nobody. An edit still waiting is saved
                // against the rev it was made on, which finds out on its own whether the list moved on.
                next.transport.subscribeStatus((status) => {
                    if (status === 'open') {
                        void (store.getState().local === null ? load() : flush());
                    }
                })
            ];
            void load();
        },
        // The list a person edits is the one `useDatabaseConnectionList` handed out, passwords in it, so what it holds is the whole truth.
        edit(next) {
            version += 1;
            const { connections, passwords } = splitPasswords(next);
            store.setState({ local: connections, passwords, saveError: null });
            return flush();
        },
        reload: load,
        ready() {
            const state = store.getState();
            if (state.status === 'ready') {
                return Promise.resolve(list(state));
            }
            if (state.status === 'failed' || target === null) {
                return Promise.resolve(null);
            }
            return new Promise<void>((resolve) => waiting.push(resolve)).then(() => {
                const settled = store.getState();
                return settled.status === 'ready' ? list(settled) : null;
            });
        },
        list,
        async setAgentAccess(connectionId, access) {
            const of = target;
            if (of === null) {
                return;
            }
            try {
                const answer = await of.transport.request('database.agentAccess.set', { projectId: of.projectId, connectionId, access });
                if (target === of) {
                    store.setState({ agentAccess: answer.access });
                }
            } catch (error: unknown) {
                deps.notify(i18next.t('databases:dialog.agents.failed'), messageOf(error));
            }
        }
    };
}

export const databaseConnections = createDatabaseConnections({
    secrets: databaseSecretStore(),
    notify: (title, description) => useToasts.getState().show({ kind: 'error', title, description })
});

export const useDatabaseConnections = databaseConnections.store;

/* The project the window has open, as the connections are kept for it; null on the start screen and in the Chats project. */
function windowTarget(): ConnectionsTarget | null {
    const workspace = windowWorkspace();
    const project = defaultProjectStore.getState().current;
    if (workspace === null || project === null || project.scratch === true) {
        return null;
    }
    return { endpointId: workspace.connection.endpointId, projectId: project.projectId, transport: workspace.connection.transport };
}

let following = false;

/*
 * Reads the connections of the project on screen, and from then on follows the window to the next
 * project, so a surface that asks for them once never shows those of the project before.
 */
export function ensureDatabaseConnections(): void {
    databaseConnections.attach(windowTarget());
    if (following) {
        return;
    }
    following = true;
    const follow = (): void => databaseConnections.attach(windowTarget());
    useWindow.subscribe(follow);
    defaultProjectStore.subscribe(follow);
}

/*
 * The next list with the objects of the previous one wherever a connection did not change, so an edit
 * to one connection leaves the views of every other one as they are: a view reloads on a new object.
 */
export function keepUnchanged(previous: readonly DatabaseConnection[], next: readonly DatabaseConnection[]): DatabaseConnection[] {
    const before = new Map(previous.map((connection) => [connection.id, connection]));
    return next.map((connection) => {
        const old = before.get(connection.id);
        return old !== undefined && JSON.stringify(old) === JSON.stringify(connection) ? old : connection;
    });
}

/* The connections as the views take them: a person's latest edit, each with its password. */
export function useDatabaseConnectionList(): DatabaseConnection[] {
    return useDatabaseConnections(databaseConnections.list);
}

/* The connections as the views type them. The machine checks every config whole before it opens one, so the views get them as the files hold them. */
export function asViewConnections(connections: readonly DatabaseConnection[]): readonly Connection[] {
    return connections as unknown as readonly Connection[];
}

/* What a view handed back, as connections again: one it made itself is private until a person shares it. */
export function fromViewConnections(connections: readonly Connection[]): DatabaseConnection[] {
    return connections.map((connection) => {
        const shared = (connection as Partial<DatabaseConnection>).shared;
        return { ...(connection as unknown as DatabaseConnection), shared: shared === true };
    });
}
