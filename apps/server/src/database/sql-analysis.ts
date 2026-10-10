import { resolve } from 'node:path';
import {
    resolveStoredPath,
    storedPathOf,
    type DatabaseAgentAccess,
    type DatabaseConnection,
    type LanguageSqlState,
    type ProjectContent,
    type ProjectSql,
    type SqlBinding,
    type SqlSnapshotInfo
} from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import type { FileChange } from '../language/file-watch.ts';
import type { ProjectSqlSettings } from '../language/profiles.ts';
import type { ProjectMutation } from '../projects/project-store.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { CONSOLES_DIR, PRIVATE_DIR, PROJECT_DIR } from '../projects/project-files.ts';
import { startDatabaseOf } from './agent-databases.ts';
import type { SchemaSnapshots, SnapshotFacts, SnapshotTarget } from './schema-snapshots.ts';

export type SqlAnalysisErrorCode = 'project-not-found' | 'unknown-connection' | 'bad-path' | 'snapshot-failed';

export class SqlAnalysisError extends CodedError<SqlAnalysisErrorCode> {}

/* Where a project keeps a person's consoles, the folder of each connection under it; the same as the client's `consoleFolderOf`. */
export function consoleFolderOf(folder: string, connectionId: string): string {
    return resolve(folder, PROJECT_DIR, PRIVATE_DIR, CONSOLES_DIR, encodeURIComponent(connectionId));
}

/* The connection a console file belongs to by the folder it is in, or null for any other file. */
export function consoleConnectionOf(folder: string, path: string): string | null {
    const root = `${resolve(folder, PROJECT_DIR, PRIVATE_DIR, CONSOLES_DIR)}/`;
    if (!path.startsWith(root) || !path.toLowerCase().endsWith('.sql')) {
        return null;
    }
    const [segment, name, ...deeper] = path.slice(root.length).split('/');
    if (segment === undefined || segment === '' || name === undefined || name === '' || deeper.length > 0) {
        return null;
    }
    try {
        return decodeURIComponent(segment);
    } catch {
        return null;
    }
}

/* What the SQL of one file is read against, and why: its own choice, the folder of a console, or the project's default. */
export type SqlChoice =
    | { source: 'file' | 'console' | 'default'; connection: DatabaseConnection; database: string | null }
    | { source: 'none' }
    // A file a person set to no connection.
    | { source: 'unbound' };

/* The database a choice reads: the one it names, else the one its connection starts in. */
function databaseOf(binding: SqlBinding, connection: DatabaseConnection): string | null {
    return binding.database ?? startDatabaseOf(connection);
}

/* What a file's SQL is read against. `path` is absolute. */
export function choiceFor(folder: string, sql: ProjectSql | undefined, connections: readonly DatabaseConnection[], path: string): SqlChoice {
    const byId = (id: string): DatabaseConnection | undefined => connections.find((connection) => connection.id === id);
    const console = consoleConnectionOf(folder, path);
    if (console !== null) {
        const connection = byId(console);
        return connection === undefined ? { source: 'none' } : { source: 'console', connection, database: startDatabaseOf(connection) };
    }
    const own = sql?.files?.[storedPathOf(folder, path)];
    if (own !== undefined) {
        if (own.connectionId === null) {
            return { source: 'unbound' };
        }
        const connection = byId(own.connectionId);
        if (connection !== undefined) {
            return { source: 'file', connection, database: databaseOf(own, connection) };
        }
    }
    const fallback = sql?.default;
    const connection = fallback?.connectionId == null ? undefined : byId(fallback.connectionId);
    return fallback === undefined || connection === undefined
        ? { source: 'none' }
        : { source: 'default', connection, database: databaseOf(fallback, connection) };
}

/* The targets the person's choices read, each once: the default and every file that names a connection. */
export function boundTargets(sql: ProjectSql | undefined, connections: readonly DatabaseConnection[]): SnapshotTarget[] {
    const targets = new Map<string, SnapshotTarget>();
    for (const binding of [...(sql?.default ? [sql.default] : []), ...Object.values(sql?.files ?? {})]) {
        const connection = connections.find((candidate) => candidate.id === binding.connectionId);
        if (connection !== undefined) {
            const target = { connectionId: connection.id, database: databaseOf(binding, connection) };
            targets.set(JSON.stringify(target), target);
        }
    }
    return [...targets.values()];
}

/* The dialect a connection is read in before a snapshot said which product answered. */
function engineDialect(connection: DatabaseConnection): string {
    return connection.config.engine === 'sqlite' ? 'sqlite' : 'mysql';
}

/* What a connection and database come down to for a server: the dialect, the version and the snapshot, as far as one was taken. */
function choiceSettings(connection: DatabaseConnection, snapshot: SnapshotFacts | undefined): Record<string, unknown> {
    return {
        dialect: snapshot?.dialect ?? engineDialect(connection),
        ...(snapshot?.version === undefined ? {} : { version: snapshot.version }),
        ...(snapshot === undefined ? {} : { schema: snapshot.path })
    };
}

export interface SqlSettingsInput {
    folder: string;
    sql: ProjectSql | undefined;
    connections: readonly DatabaseConnection[];
    snapshots: readonly SnapshotFacts[];
}

/*
 * The settings of the SQL and PHP servers: the project's default at the top level, an override for the
 * consoles folder of every connection and for every file with a choice of its own, all by absolute path.
 * A file set to no connection is listed apart, since an override cannot take away the default's schema.
 */
export function sqlSettingsOf(input: SqlSettingsInput): ProjectSqlSettings {
    const { folder, sql, connections, snapshots } = input;
    const snapshotOf = (connectionId: string, database: string | null): SnapshotFacts | undefined =>
        snapshots.find((snapshot) => snapshot.connectionId === connectionId && snapshot.database === database);
    const byId = (id: string | null): DatabaseConnection | undefined => connections.find((connection) => connection.id === id);
    const settingsFor = (binding: SqlBinding): Record<string, unknown> | null => {
        const connection = byId(binding.connectionId);
        return connection === undefined ? null : choiceSettings(connection, snapshotOf(connection.id, databaseOf(binding, connection)));
    };
    const top = sql?.default === undefined ? null : settingsFor(sql.default);
    const overrides: Record<string, unknown>[] = connections.map((connection) => ({
        path: consoleFolderOf(folder, connection.id),
        ...choiceSettings(connection, snapshotOf(connection.id, startDatabaseOf(connection)))
    }));
    const unbound: string[] = [];
    for (const [stored, binding] of Object.entries(sql?.files ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
        const path = resolveStoredPath(folder, stored);
        if (path === null) {
            continue;
        }
        if (binding.connectionId === null) {
            unbound.push(resolve(path));
            continue;
        }
        const own = settingsFor(binding);
        if (own !== null) {
            overrides.push({ path: resolve(path), ...own });
        }
    }
    const settings = { ...(top ?? {}), ...(overrides.length === 0 ? {} : { overrides }) };
    return { sql: settings, php: settings, unbound };
}

/* What the verbs tell an agent about the SQL of a file. */
export interface SqlFileContext {
    choice: SqlChoice;
    /* The snapshot the file is read against, when one was taken. */
    snapshot: SnapshotFacts | null;
    /* What agents may do with the connection; `read` for a file read against none. */
    access: DatabaseAgentAccess;
}

export interface SqlAnalysisOptions {
    projects: {
        folderOf(projectId: string): string | null;
        holdersOf(projectId: string): string[];
        read(projectId: string): Promise<ProjectContent>;
        mutate<T>(projectId: string, apply: (content: ProjectContent) => ProjectMutation<T> | Promise<ProjectMutation<T>>): Promise<T>;
    };
    connections: { connectionsOf(projectId: string): Promise<DatabaseConnection[]> };
    snapshots: SchemaSnapshots;
    access: { levelOf(projectId: string, connectionId: string): DatabaseAgentAccess };
    /* Where a snapshot taken in the background that failed is told; the console by default. */
    warn?: (line: string) => void;
}

/* What the language servers have to hear of the project's SQL. */
export interface SqlListeners {
    /* The settings of the project changed. */
    sqlChanged(projectId: string): Promise<void>;
    /* A snapshot file was written; a server that watches it reads it again. */
    outsideFilesChanged(changes: readonly FileChange[]): Promise<void>;
}

function withBinding(sql: ProjectSql | undefined, path: string | undefined, binding: SqlBinding | null): ProjectSql {
    const files = { ...sql?.files };
    let fallback = sql?.default;
    if (path === undefined) {
        fallback = binding === null || binding.connectionId === null ? undefined : binding;
    } else if (binding === null) {
        delete files[path];
    } else {
        files[path] = binding;
    }
    return { ...(fallback === undefined ? {} : { default: fallback }), ...(Object.keys(files).length === 0 ? {} : { files }) };
}

/*
 * The SQL of the projects as their language servers read it: which connection and database each file and
 * the project as a whole read against (one person's choice, in the private project file), the schema
 * snapshots of those connections, and the settings both come down to. A snapshot is taken when a client
 * opens or refreshes a connection's tree, after a statement changed a schema, when a person asks, and for a
 * choice that has none yet once a client handed over its passwords; and it goes with its connection.
 */
export class SqlAnalysis {
    private readonly options: SqlAnalysisOptions;
    private readonly sinks = new ClientSinks();
    private listeners: SqlListeners | null = null;

    constructor(options: SqlAnalysisOptions) {
        this.options = options;
    }

    attach(listeners: SqlListeners): void {
        this.listeners = listeners;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    async state(projectId: string, clientId: string): Promise<LanguageSqlState> {
        this.requireHolder(projectId, clientId);
        return this.stateOf(projectId);
    }

    /* A person's choice for one file by its stored path, or for the project without one. */
    async bind(projectId: string, path: string | undefined, binding: SqlBinding | null, clientId: string): Promise<LanguageSqlState> {
        const folder = this.requireHolder(projectId, clientId);
        const connections = await this.options.connections.connectionsOf(projectId);
        if (binding?.connectionId != null && !connections.some((connection) => connection.id === binding.connectionId)) {
            throw new SqlAnalysisError('unknown-connection', `This project has no database connection ${binding.connectionId}`);
        }
        const stored = path === undefined ? undefined : this.storedPath(folder, path);
        await this.options.projects.mutate(projectId, (content) => {
            const sql = withBinding(content.sql, stored, binding);
            const { sql: _before, ...rest } = content;
            return { content: Object.keys(sql).length === 0 ? rest : { ...rest, sql }, result: undefined };
        });
        await this.changed(projectId);
        // A choice that reads a database nobody took a snapshot of yet gets one, with the passwords the clients handed over.
        void this.takeMissing(projectId);
        return this.stateOf(projectId);
    }

    /*
     * Takes the snapshots of one connection again, or of all of the project's: the ones there are, the
     * database each connection starts in and every database a choice reads. `schema` narrows it to the
     * snapshots that hold that schema. Fails only when no snapshot could be taken.
     */
    async refresh(projectId: string, clientId: string | null, connectionId?: string, schema?: string): Promise<void> {
        if (clientId !== null) {
            this.requireHolder(projectId, clientId);
        }
        const [connections, content, existing] = await Promise.all([
            this.options.connections.connectionsOf(projectId),
            this.options.projects.read(projectId),
            this.options.snapshots.list(projectId)
        ]);
        const chosen = connectionId === undefined ? connections : connections.filter((connection) => connection.id === connectionId);
        if (connectionId !== undefined && chosen.length === 0) {
            throw new SqlAnalysisError('unknown-connection', `This project has no database connection ${connectionId}`);
        }
        const bound = boundTargets(content.sql, connections);
        const targets = new Map<string, SnapshotTarget>();
        for (const connection of chosen) {
            for (const target of [
                { connectionId: connection.id, database: startDatabaseOf(connection) },
                ...bound.filter((candidate) => candidate.connectionId === connection.id),
                ...existing.filter((snapshot) => snapshot.connectionId === connection.id)
            ]) {
                if (schema === undefined || target.database === null || target.database === schema) {
                    targets.set(JSON.stringify([target.connectionId, target.database]), { connectionId: target.connectionId, database: target.database });
                }
            }
        }
        const failures = await this.takeAll(projectId, connections, [...targets.values()], existing);
        if (failures.length > 0 && failures.length === targets.size) {
            throw new SqlAnalysisError('snapshot-failed', failures[0]!);
        }
    }

    /* A client handed over its passwords: a choice whose snapshot is missing can be taken now. */
    passwordsHanded(projectId: string): void {
        void this.takeMissing(projectId);
    }

    /* The connections of a project changed: the snapshots of one that left go, and the settings follow what is left. */
    async connectionsChanged(projectId: string, connections: readonly DatabaseConnection[]): Promise<void> {
        const ids = new Set(connections.map((connection) => connection.id));
        const gone = new Set((await this.options.snapshots.list(projectId)).map((snapshot) => snapshot.connectionId).filter((id) => !ids.has(id)));
        for (const connectionId of gone) {
            await this.options.snapshots.forget(projectId, connectionId);
        }
        await this.changed(projectId);
    }

    /* The settings of the project's servers as the choices, the connections and the snapshots stand. */
    async settingsOf(projectId: string): Promise<ProjectSqlSettings | null> {
        const folder = this.options.projects.folderOf(projectId);
        if (folder === null) {
            return null;
        }
        const [content, connections, snapshots] = await Promise.all([
            this.options.projects.read(projectId),
            this.options.connections.connectionsOf(projectId).catch(() => [] as DatabaseConnection[]),
            this.options.snapshots.list(projectId)
        ]);
        return sqlSettingsOf({ folder, sql: content.sql, connections, snapshots });
    }

    /* What one file's SQL is read against, for an agent. `path` is absolute. */
    async fileContext(projectId: string, path: string): Promise<SqlFileContext> {
        const folder = this.options.projects.folderOf(projectId);
        if (folder === null) {
            throw new SqlAnalysisError('project-not-found', `No project ${projectId} on this machine`);
        }
        const [content, connections, snapshots] = await Promise.all([
            this.options.projects.read(projectId),
            this.options.connections.connectionsOf(projectId).catch(() => [] as DatabaseConnection[]),
            this.options.snapshots.list(projectId)
        ]);
        const choice = choiceFor(folder, content.sql, connections, resolve(path));
        if (choice.source === 'none' || choice.source === 'unbound') {
            return { choice, snapshot: null, access: 'read' };
        }
        const snapshot = snapshots.find((candidate) => candidate.connectionId === choice.connection.id && candidate.database === choice.database) ?? null;
        return { choice, snapshot, access: this.options.access.levelOf(projectId, choice.connection.id) };
    }

    private requireHolder(projectId: string, clientId: string): string {
        const folder = this.options.projects.folderOf(projectId);
        if (folder === null || !this.options.projects.holdersOf(projectId).includes(clientId)) {
            throw new SqlAnalysisError('project-not-found', `Project ${projectId} is not open on this client`);
        }
        return folder;
    }

    /* A path as the private file keeps it: relative inside the project folder, as `storedPathOf` writes it. */
    private storedPath(folder: string, path: string): string {
        const absolute = resolveStoredPath(folder, path);
        if (absolute === null || !absolute.toLowerCase().endsWith('.sql')) {
            throw new SqlAnalysisError('bad-path', `${path} is no .sql file of this project`);
        }
        return storedPathOf(folder, resolve(absolute));
    }

    private async stateOf(projectId: string): Promise<LanguageSqlState> {
        const [content, snapshots] = await Promise.all([this.options.projects.read(projectId), this.options.snapshots.list(projectId)]);
        return { sql: content.sql ?? {}, snapshots: snapshots.map(infoOf) };
    }

    /* The clients and the servers of the project hear of a change of the choices or the snapshots. */
    private async changed(projectId: string): Promise<void> {
        const state = await this.stateOf(projectId);
        for (const clientId of this.options.projects.holdersOf(projectId)) {
            this.sinks.to(clientId, { event: 'language.sql.changed', payload: { projectId, ...state } });
        }
        await this.listeners
            ?.sqlChanged(projectId)
            .catch((error: unknown) => this.warn(`Telling the language servers of ${projectId} its SQL failed: ${errorText(error)}`));
    }

    private async takeMissing(projectId: string): Promise<void> {
        try {
            const [connections, content, existing] = await Promise.all([
                this.options.connections.connectionsOf(projectId),
                this.options.projects.read(projectId),
                this.options.snapshots.list(projectId)
            ]);
            const missing = boundTargets(content.sql, connections).filter(
                (target) => !existing.some((snapshot) => snapshot.connectionId === target.connectionId && snapshot.database === target.database)
            );
            if (missing.length > 0) {
                await this.takeAll(projectId, connections, missing, existing);
            }
        } catch (error) {
            this.warn(`Taking the missing schema snapshots of ${projectId} failed: ${errorText(error)}`);
        }
    }

    /* Takes every target and tells whoever has to hear of what changed; answers why each that failed did. */
    private async takeAll(
        projectId: string,
        connections: readonly DatabaseConnection[],
        targets: readonly SnapshotTarget[],
        before: readonly SnapshotFacts[]
    ): Promise<string[]> {
        const failures: string[] = [];
        const taken: SnapshotFacts[] = [];
        await Promise.all(
            targets.map(async (target) => {
                const connection = connections.find((candidate) => candidate.id === target.connectionId);
                if (connection === undefined) {
                    return;
                }
                try {
                    taken.push(await this.options.snapshots.take(projectId, connection, target.database));
                } catch (error) {
                    const message = errorText(error);
                    failures.push(message);
                    this.warn(`A schema snapshot was not taken: ${message}`);
                }
            })
        );
        const moved = taken.filter((facts) => {
            const earlier = before.find((snapshot) => snapshot.path === facts.path);
            return earlier === undefined || earlier.takenAt !== facts.takenAt;
        });
        if (moved.length > 0) {
            const created = moved.filter((facts) => !before.some((snapshot) => snapshot.path === facts.path));
            await this.listeners?.outsideFilesChanged(moved.map((facts) => ({ path: facts.path, type: created.includes(facts) ? 1 : 2 })));
            await this.changed(projectId);
        }
        return failures;
    }

    private warn(line: string): void {
        (this.options.warn ?? ((text: string) => console.warn(text)))(line);
    }
}

function infoOf(facts: SnapshotFacts): SqlSnapshotInfo {
    const { path: _path, ...info } = facts;
    return info;
}
