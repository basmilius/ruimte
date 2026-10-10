import i18next from 'i18next';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { DatabaseConnection, LanguageSqlChangedEvent, LanguageSqlState, ProjectSql, SqlBinding, SqlSnapshotInfo } from '@ruimte/contracts';
import { messageOf } from '@adecore/ui';
import { consoleConnectionOf } from '@/database/console-file';
import { windowProjectFollower } from '@/database/window-project';
import { endpointKey } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import type { Transport } from '@/transport/transport';

export interface SqlBindingsState {
    /* The machine and the project these are of (`endpointKey`); null while nothing asked for any. */
    key: string | null;
    sql: ProjectSql;
    snapshots: SqlSnapshotInfo[];
}

export interface SqlBindingsTarget {
    endpointId: string;
    projectId: string;
    folder: string | null;
    transport: Pick<Transport, 'request' | 'on' | 'subscribeStatus'>;
}

export interface SqlBindingsDeps {
    notify(title: string, description: string): void;
}

/* What a `.sql` file reads its SQL against, and why: a console's folder, its own choice, the project's default, or nothing. */
export type SqlFileChoice =
    | { source: 'console' | 'file' | 'default'; connectionId: string; database: string | null }
    | { source: 'unbound' }
    | { source: 'none' };

/* The database a connection starts in: `main` for a SQLite file, the configured one of a server, else none. */
export function startDatabaseOf(connection: DatabaseConnection): string | null {
    if (connection.config.engine === 'sqlite') {
        return 'main';
    }
    const database = (connection.config as Record<string, unknown>).database;
    return typeof database === 'string' && database !== '' ? database : null;
}

/* What a file reads, by the same rules the machine applies (`sql-analysis.ts`). `storedPath` is the one the private file keys it by. */
export function choiceOf(sql: ProjectSql, connections: readonly DatabaseConnection[], folder: string | null, path: string, storedPath: string): SqlFileChoice {
    const byId = (id: string | null): DatabaseConnection | undefined => connections.find((connection) => connection.id === id);
    const console = folder === null ? null : consoleConnectionOf(folder, path);
    if (console !== null) {
        const connection = byId(console);
        return connection === undefined ? { source: 'none' } : { source: 'console', connectionId: connection.id, database: startDatabaseOf(connection) };
    }
    const own = sql.files?.[storedPath];
    if (own !== undefined) {
        if (own.connectionId === null) {
            return { source: 'unbound' };
        }
        const connection = byId(own.connectionId);
        if (connection !== undefined) {
            return { source: 'file', connectionId: connection.id, database: own.database ?? startDatabaseOf(connection) };
        }
    }
    const fallback = sql.default === undefined ? undefined : byId(sql.default.connectionId);
    return fallback === undefined || sql.default === undefined
        ? { source: 'none' }
        : { source: 'default', connectionId: fallback.id, database: sql.default.database ?? startDatabaseOf(fallback) };
}

/* The snapshot a choice reads, when the machine took one. */
export function snapshotOf(snapshots: readonly SqlSnapshotInfo[], connectionId: string, database: string | null): SqlSnapshotInfo | null {
    return snapshots.find((snapshot) => snapshot.connectionId === connectionId && snapshot.database === database) ?? null;
}

const INITIAL: SqlBindingsState = { key: null, sql: {}, snapshots: [] };

export interface SqlBindingsModel {
    store: UseBoundStore<StoreApi<SqlBindingsState>>;
    attach(target: SqlBindingsTarget | null): void;
    /* A person's choice for one file by its stored path, or for the project without one; null takes it away. */
    bind(path: string | undefined, binding: SqlBinding | null): Promise<void>;
    /* Takes the snapshots of one connection again, or of every one; `schema` narrows it to the snapshots that hold it. */
    refresh(connectionId?: string, schema?: string): Promise<void>;
}

/*
 * The person's choices for the SQL of the open project and the schema snapshots the machine holds, as
 * the machine last said. A choice is the machine's to keep: this window asks and takes what it answers.
 */
export function createSqlBindings(deps: SqlBindingsDeps): SqlBindingsModel {
    const store = create<SqlBindingsState>(() => INITIAL);
    let target: SqlBindingsTarget | null = null;
    let unsubscribe: (() => void)[] = [];

    const take = (of: SqlBindingsTarget, state: LanguageSqlState): void => {
        if (target === of) {
            store.setState({ sql: state.sql, snapshots: state.snapshots });
        }
    };

    const load = async (): Promise<void> => {
        const of = target;
        if (of === null) {
            return;
        }
        // A machine from before SQL choices has no such request, and its files read against nothing.
        const state = await of.transport.request('language.sql', { projectId: of.projectId }).catch(() => null);
        if (state !== null) {
            take(of, state);
        }
    };

    const onChanged = (event: LanguageSqlChangedEvent): void => {
        if (target !== null && event.projectId === target.projectId) {
            take(target, event);
        }
    };

    return {
        store,
        attach(next) {
            if (
                next !== null &&
                target !== null &&
                endpointKey(next.endpointId, next.projectId) === store.getState().key &&
                next.transport === target.transport
            ) {
                target = next;
                return;
            }
            for (const off of unsubscribe) {
                off();
            }
            unsubscribe = [];
            target = next;
            if (next === null) {
                store.setState(INITIAL);
                return;
            }
            store.setState({ ...INITIAL, key: endpointKey(next.endpointId, next.projectId) });
            unsubscribe = [
                next.transport.on('language.sql.changed', onChanged),
                next.transport.subscribeStatus((status) => {
                    if (status === 'open') {
                        void load();
                    }
                })
            ];
            void load();
        },
        async bind(path, binding) {
            const of = target;
            if (of === null) {
                return;
            }
            try {
                take(of, await of.transport.request('language.sql.bind', { projectId: of.projectId, ...(path === undefined ? {} : { path }), binding }));
            } catch (error: unknown) {
                deps.notify(i18next.t('databases:sql.bindFailed'), messageOf(error));
            }
        },
        async refresh(connectionId, schema) {
            const of = target;
            if (of === null) {
                return;
            }
            await of.transport.request('database.snapshot.refresh', {
                projectId: of.projectId,
                ...(connectionId === undefined ? {} : { connectionId }),
                ...(schema === undefined ? {} : { schema })
            });
        }
    };
}

export const sqlBindings = createSqlBindings({
    notify: (title, description) => useToasts.getState().show({ kind: 'error', title, description })
});

export const useSqlBindings = sqlBindings.store;

/* Reads the choices of the project on screen, and from then on follows the window to the next project. */
export const ensureSqlBindings = windowProjectFollower((target) => sqlBindings.attach(target));

/* Takes the snapshots again, and says why when none could be taken. */
export async function refreshSqlSchemas(connectionId?: string): Promise<void> {
    ensureSqlBindings();
    try {
        await sqlBindings.refresh(connectionId);
    } catch (error: unknown) {
        useToasts.getState().show({ kind: 'error', title: i18next.t('databases:sql.refreshFailed'), description: messageOf(error) });
    }
}
