import type { Connection } from '@adecore/database';
import i18next from 'i18next';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { isAbsolutePath, storedPathOf, type DatabaseConnection, type DatabaseConnectionsChangedEvent } from '@ruimte/contracts';
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

const INITIAL: DatabaseConnectionsState = { key: null, status: 'idle', error: null, rev: 0, saved: [], local: null, saveError: null, passwords: {} };

/* What the machine takes: a SQLite connection needs a whole path first, which a new one does not have yet. */
export function isSavable(connection: DatabaseConnection): boolean {
    return connection.id !== '' && (connection.config.engine !== 'sqlite' || (connection.config.path !== '' && isAbsolutePath(connection.config.path)));
}

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
    let loads = 0;
    /* What the secret store holds for this project, as far as this window wrote or read it. */
    let stored: Record<string, string> = {};
    const waiting: (() => void)[] = [];

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

    const readSecrets = async (of: ConnectionsTarget, connections: readonly DatabaseConnection[]): Promise<void> => {
        const unknown = connections.filter((connection) => store.getState().passwords[connection.id] === undefined && stored[connection.id] === undefined);
        const read = await Promise.all(
            unknown.map(
                async (connection) =>
                    [connection.id, await deps.secrets.read(secretKeyOf(of.endpointId, of.projectId, connection.id)).catch(() => null)] as const
            )
        );
        if (target !== of) {
            return;
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

    const load = async (): Promise<void> => {
        const of = target;
        if (of === null) {
            return;
        }
        const ticket = ++loads;
        if (store.getState().status !== 'ready') {
            store.setState({ status: 'loading' });
        }
        try {
            const answer = await of.transport.request('database.connections', { projectId: of.projectId });
            if (target !== of || ticket !== loads) {
                return;
            }
            store.setState({ status: 'ready', error: null, rev: answer.rev, saved: answer.connections });
            await readSecrets(of, answer.connections);
            settle();
        } catch (error: unknown) {
            if (target !== of || ticket !== loads) {
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
        const sending = local.filter(isSavable);
        try {
            await writeSecrets(
                of,
                local.map((connection) => connection.id)
            );
            const answer = await of.transport.request('database.connections.save', { projectId: of.projectId, baseRev: state.rev, connections: sending });
            if (target !== of) {
                return;
            }
            const settled = version === sent && sending.length === local.length;
            store.setState({ rev: answer.rev, saved: answer.connections, saveError: null, ...(settled ? { local: null } : {}) });
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
        if (store.getState().local !== null) {
            deps.notify(i18next.t('databases:connections.conflict.title'), i18next.t('databases:connections.conflict.description'));
        }
        store.setState({ status: 'ready', error: null, rev: event.rev, saved: event.connections, local: null, saveError: null });
        void readSecrets(of, event.connections);
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
            version += 1;
            settle();
            if (next === null) {
                store.setState(INITIAL);
                return;
            }
            store.setState({ ...INITIAL, key: keyOf(next), status: 'loading' });
            unsubscribe = [
                next.transport.on('database.connections.changed', onChanged),
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
        list
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
