import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import type { DatabaseAgentAccess, DatabaseConnection } from '@ruimte/contracts';
import type { DatabaseError, DatabaseResponse, RowsResult, SchemaInfo, StatementResult, TableInfo, TableStructure } from '@adecore/database/protocol';
import { CodedError } from '@adecore/agents/coded-error';
import { field } from '@adecore/agents/context/refusal';
import { climbsOut } from '../projects/project-files.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { ClientSinks } from '../client-sinks.ts';
import type { DatabaseAccessStore } from './agent-access.ts';
import type { DatabasePasswords } from './agent-passwords.ts';

/* How long one verb may keep its session; past it the call is cancelled and its session closed. */
export const AGENT_DATABASE_LIMIT_MS = 120_000;

/* The longest text or binary value a row prints whole; a longer one prints its start and its length. */
export const AGENT_CELL_LIMIT = 256;

/* How many rows `execute` prints of a statement that reads. */
export const EXECUTE_ROW_LIMIT = 100;

export class DatabaseAgentError extends CodedError {}

export interface DatabasePlace {
    projectId: string;
    folder: string;
}

/* What the agent that wrote a reply could read of one connection; `target` is a fingerprint, since UI access is kept with the chat. */
export interface UiDatabaseGrant {
    id: string;
    target: string;
    access: DatabaseAgentAccess;
}

/* A connection as an agent sees it: never with a password. */
export interface AgentConnection {
    id: string;
    name: string;
    engine: string;
    /* Where it points and as whom, such as `root@127.0.0.1:3306/shop` or the path of a SQLite file. */
    target: string;
    access: DatabaseAgentAccess;
    /* A SQLite file outside the project folder, which only a person opens. */
    outsideProject: boolean;
}

export interface AgentTables {
    connection: string;
    schemas: string[];
    tables: { schema: string; name: string; kind: TableInfo['kind']; rowEstimate: number | null }[];
}

export interface AgentQuery {
    connection: string;
    schema: string | null;
    result: RowsResult;
}

export interface AgentExecution {
    connection: string;
    results: StatementResult[];
    inTransaction: boolean;
}

/* What the agents reach a project's databases through, the verbs' side of `AgentDatabases`. */
export type DatabaseAgentHost = Pick<AgentDatabases, 'list' | 'tables' | 'describe' | 'query' | 'execute' | 'tableOf'>;

export interface AgentDatabasesOptions {
    service: { handle(request: unknown, owner: string): Promise<DatabaseResponse>; release(owner: string): Promise<void> };
    connections: { connectionsOf(projectId: string): Promise<DatabaseConnection[]> };
    projects: { holdersOf(projectId: string): string[] };
    access: DatabaseAccessStore;
    passwords: DatabasePasswords;
    /* The folder of the machine's Chats project, which has no databases of its own. */
    scratchFolder: string;
    limitMs?: number;
}

type MysqlConfig = Record<string, unknown> & { engine: 'mysql' };

function refuse(code: string, message: string, lines: string[] = []): never {
    throw new DatabaseAgentError(code, message, lines);
}

/* What leads a connection somewhere and logs it in, so a password handed over for one never goes to another. */
export function connectionTarget(config: DatabaseConnection['config']): string {
    const { password: _password, readOnly: _readOnly, database: _database, create: _create, ...rest } = config as Record<string, unknown>;
    return JSON.stringify(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)));
}

/* The database a connection starts in: `main` for a SQLite file, the configured one of a server, or null for a server that starts in none. */
export function startDatabaseOf(connection: DatabaseConnection): string | null {
    if (connection.config.engine === 'sqlite') {
        return 'main';
    }
    const database = (connection.config as MysqlConfig).database;
    return typeof database === 'string' && database !== '' ? database : null;
}

function describeTarget(config: DatabaseConnection['config']): string {
    if (config.engine === 'sqlite') {
        return config.path;
    }
    const mysql = config as MysqlConfig;
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');
    const tunnel = mysql.tunnel as { kind?: string; host?: string; user?: string; container?: string; port?: number } | undefined;
    const database = text(mysql.database) === '' ? '' : `/${text(mysql.database)}`;
    const user = text(mysql.user);
    if (tunnel?.kind === 'docker') {
        return `${user}@docker:${text(tunnel.container)}:${tunnel.port ?? 3306}${database}`;
    }
    const server = text(mysql.socket) !== '' ? text(mysql.socket) : `${text(mysql.host)}:${typeof mysql.port === 'number' ? mysql.port : 3306}`;
    const through = tunnel?.kind === 'ssh' ? ` through ssh ${tunnel.user ? `${tunnel.user}@` : ''}${text(tunnel.host)}` : '';
    return `${user}@${server}${database}${through}`;
}

function connectionLines(connections: readonly AgentConnection[]): string[] {
    return connections.map((connection) => `connection\t${field(connection.id)}\t${field(connection.name)}`);
}

/* A failure of the package, under its own code and the server's words, so an agent can fix its SQL. */
function failure(error: DatabaseError): never {
    const state = error.sqlState === undefined ? '' : ` (SQLSTATE ${error.sqlState})`;
    if (error.code === 'unsupported') {
        refuse('unsupported', `${error.message}${state}`, [
            'detail\tdatabase query reads one statement that starts with SELECT or WITH; ruimte-context help database query'
        ]);
    }
    if (error.code === 'read-only') {
        refuse('read-only', `${error.message}${state}`, [
            'detail\tA query runs on a read-only session; database execute writes, on a connection a person allowed to write'
        ]);
    }
    refuse(error.code, `${error.message}${state}`);
}

/*
 * The databases of a project as its agents reach them, and what a person sets for that. Every call
 * opens a session of its own under an owner of its own and releases it before it answers, so no
 * session, transaction or temporary table outlives the call. A read runs on a session opened read
 * only; a write needs the connection set to `write` by a person, which no verb can do.
 */
export class AgentDatabases {
    private readonly options: AgentDatabasesOptions;
    private readonly sinks = new ClientSinks();
    private readonly limitMs: number;

    constructor(options: AgentDatabasesOptions) {
        this.options = options;
        this.limitMs = options.limitMs ?? AGENT_DATABASE_LIMIT_MS;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* What a client of the project reads in its connections dialog. */
    accessFor(projectId: string, clientId: string): { access: Record<string, DatabaseAgentAccess> } {
        this.requireHolder(projectId, clientId);
        return { access: this.options.access.levels(projectId) };
    }

    /* `local` is true only for a client that presented the local secret, the one that may let agents write. */
    async setAccess(
        projectId: string,
        connectionId: string,
        access: DatabaseAgentAccess,
        clientId: string,
        local: boolean
    ): Promise<{ access: Record<string, DatabaseAgentAccess> }> {
        this.requireHolder(projectId, clientId);
        if (access === 'write' && !local) {
            refuse('forbidden', 'Only a person on this machine can let agents write to a database');
        }
        const levels = await this.options.access.set(projectId, connectionId, access);
        const event: SessionEvent = { event: 'database.agentAccess.changed', payload: { projectId, access: levels } };
        for (const holder of this.options.projects.holdersOf(projectId)) {
            if (holder !== clientId) {
                this.sinks.to(holder, event);
            }
        }
        return { access: levels };
    }

    /* Each password is bound to where its connection points as it stands now; one that points elsewhere later gets none. */
    async handPasswords(projectId: string, clientId: string, passwords: Readonly<Record<string, string>>): Promise<void> {
        this.requireHolder(projectId, clientId);
        const connections = await this.options.connections.connectionsOf(projectId);
        const handed = connections.flatMap((connection) => {
            const password = passwords[connection.id];
            return password === undefined ? [] : [{ connectionId: connection.id, target: connectionTarget(connection.config), password }];
        });
        this.options.passwords.hand(projectId, clientId, handed);
    }

    /* The last client let the project go: its passwords go with it. A reload of a project still held keeps them. */
    letGo(projectId: string): void {
        if (this.options.projects.holdersOf(projectId).length === 0) {
            this.options.passwords.forget(projectId);
        }
    }

    close(): void {
        this.options.passwords.clear();
    }

    async list(place: DatabasePlace): Promise<AgentConnection[]> {
        return Promise.all((await this.connectionsOf(place)).map((connection) => this.agentConnection(place, connection)));
    }

    /*
     * The connection and schema a database view names, by the id the project file keeps. The table itself is not
     * looked up: that would open a session, and a view of a table that is gone says so when a person opens it.
     */
    async tableOf(place: DatabasePlace, wanted: string, schema: string | null): Promise<{ connectionId: string; schema: string }> {
        const connection = await this.named(place, wanted);
        const resolved = schema ?? startDatabaseOf(connection);
        if (resolved === null) {
            refuse('schema-required', `${connection.name} starts in no database; name one with --schema`);
        }
        return { connectionId: connection.id, schema: resolved };
    }

    async captureUiAccess(place: DatabasePlace): Promise<UiDatabaseGrant[]> {
        if (place.folder === this.options.scratchFolder) {
            return [];
        }
        const levels = this.options.access.levels(place.projectId);
        return (await this.connectionsOf(place)).map((connection) => ({
            id: connection.id,
            target: this.uiTarget(connection),
            access: levels[connection.id] ?? 'read'
        }));
    }

    async authorizeUiRead(place: DatabasePlace, wanted: string, grants: readonly UiDatabaseGrant[]): Promise<void> {
        await this.checkUiGrant(place, await this.named(place, wanted), grants);
    }

    async tables(place: DatabasePlace, caller: string, wanted: string, schema: string | null): Promise<AgentTables> {
        return this.withSession(place, caller, wanted, 'read', async ({ connection, call }) => {
            const { schemas } = await call<{ schemas: SchemaInfo[] }>('schemas', {});
            const own = schemas.filter((candidate) => !candidate.system).map((candidate) => candidate.name);
            const database = connection.config.engine === 'mysql' ? (connection.config as MysqlConfig).database : undefined;
            const listed = schema !== null ? [schema] : typeof database === 'string' && database !== '' ? [database] : own;
            const tables: AgentTables['tables'] = [];
            for (const name of listed) {
                const found = await call<{ tables: TableInfo[] }>('tables', { schema: name });
                tables.push(...found.tables.map((table) => ({ schema: name, name: table.name, kind: table.kind, rowEstimate: table.rowEstimate })));
            }
            return { connection: connection.name, schemas: own, tables };
        });
    }

    async describe(place: DatabasePlace, caller: string, wanted: string, table: string, schema: string | null): Promise<TableStructure> {
        return this.withSession(place, caller, wanted, 'read', async ({ connection, call }) => {
            const named = schema ?? (await this.schemaOf(connection, call));
            return call<TableStructure>('structure', { schema: named, table });
        });
    }

    async query(
        place: DatabasePlace,
        caller: string,
        wanted: string,
        sql: string,
        options: {
            schema: string | null;
            limit: number;
            signal?: AbortSignal;
            uiAccess?: readonly UiDatabaseGrant[];
        }
    ): Promise<AgentQuery> {
        return this.withSession(
            place,
            caller,
            wanted,
            'read',
            async ({ connection, call }) => {
                const result = await call<RowsResult>('page', {
                    sql,
                    offset: 0,
                    limit: options.limit,
                    cellLimit: AGENT_CELL_LIMIT,
                    ...(options.schema === null ? {} : { schema: options.schema })
                });
                return { connection: connection.name, schema: options.schema ?? startDatabaseOf(connection), result };
            },
            options.signal,
            options.uiAccess
        );
    }

    async execute(place: DatabasePlace, caller: string, wanted: string, sql: string, schema: string | null): Promise<AgentExecution> {
        return this.withSession(place, caller, wanted, 'write', async ({ connection, call }) => {
            const answer = await call<{ results: StatementResult[]; inTransaction: boolean }>('execute', {
                sql,
                limit: EXECUTE_ROW_LIMIT,
                cellLimit: AGENT_CELL_LIMIT,
                ...(schema === null ? {} : { schema })
            });
            return { connection: connection.name, ...answer };
        });
    }

    private requireHolder(projectId: string, clientId: string): void {
        if (!this.options.projects.holdersOf(projectId).includes(clientId)) {
            refuse('project-not-found', `Project ${projectId} is not open on this client`);
        }
    }

    private async connectionsOf(place: DatabasePlace): Promise<DatabaseConnection[]> {
        if (place.folder === this.options.scratchFolder) {
            refuse(
                'database-no-project',
                'You are a chat in the Chats project, which has no databases; a person asks in a chat of the project whose databases they mean'
            );
        }
        return this.options.connections.connectionsOf(place.projectId);
    }

    private async agentConnection(place: DatabasePlace, connection: DatabaseConnection): Promise<AgentConnection> {
        return {
            id: connection.id,
            name: connection.name,
            engine: connection.config.engine,
            target: describeTarget(connection.config),
            access: this.options.access.levelOf(place.projectId, connection.id),
            outsideProject: connection.config.engine === 'sqlite' && (await this.insideFile(place, connection.config.path)) === null
        };
    }

    /* The real path of a SQLite file inside the project folder, so a link in the project cannot lead out of it; null for any other. */
    private async insideFile(place: DatabasePlace, path: string): Promise<string | null> {
        try {
            const [file, folder] = await Promise.all([realpath(path), realpath(place.folder)]);
            return climbsOut(relative(folder, file)) ? null : file;
        } catch {
            return null;
        }
    }

    /* A connection by its id, or by a name no other connection of the project carries. */
    private async named(place: DatabasePlace, wanted: string): Promise<DatabaseConnection> {
        const connections = await this.connectionsOf(place);
        const byId = connections.find((connection) => connection.id === wanted);
        if (byId) {
            return byId;
        }
        const byName = connections.filter((connection) => connection.name.toLowerCase() === wanted.toLowerCase());
        if (byName.length === 1) {
            return byName[0]!;
        }
        const listed = await this.list(place);
        if (byName.length > 1) {
            refuse(
                'ambiguous-connection',
                `${byName.length} connections are called ${wanted}; name one by its id`,
                connectionLines(listed.filter((connection) => byName.some((candidate) => candidate.id === connection.id)))
            );
        }
        if (connections.length === 0) {
            refuse('unknown-connection', 'This project has no database connections; a person adds them in the Databases panel of the app');
        }
        refuse('unknown-connection', `This project has no database connection ${wanted}`, connectionLines(listed));
    }

    private uiTarget(connection: DatabaseConnection): string {
        // UI access travels to clients; keep a fingerprint instead of connection secrets.
        return createHash('sha256')
            .update(JSON.stringify([connectionTarget(connection.config), startDatabaseOf(connection)]))
            .digest('hex');
    }

    /* A UI read holds only while the connection is still the one captured and still readable, with its password in memory. */
    private async checkUiGrant(place: DatabasePlace, connection: DatabaseConnection, grants: readonly UiDatabaseGrant[]): Promise<void> {
        const original = grants.find((grant) => grant.id === connection.id);
        if (
            !original ||
            original.access === 'off' ||
            original.target !== this.uiTarget(connection) ||
            this.options.access.levelOf(place.projectId, connection.id) === 'off'
        ) {
            refuse('database-access-off', 'This database was not readable for the agent that wrote this, or is no longer readable.');
        }
        const { password } = await this.configFor(place, connection, 'read');
        if (connection.config.engine === 'mysql' && !password) {
            refuse('database-locked', 'This machine no longer holds the password for this database.');
        }
    }

    private async schemaOf(connection: DatabaseConnection, call: <T>(method: string, params: Record<string, unknown>) => Promise<T>): Promise<string> {
        const fallback = startDatabaseOf(connection);
        if (fallback !== null) {
            return fallback;
        }
        const { schemas } = await call<{ schemas: SchemaInfo[] }>('schemas', {});
        refuse(
            'schema-required',
            `${connection.name} starts in no database; name one with --schema`,
            schemas.filter((schema) => !schema.system).map((schema) => `schema\t${schema.name}`)
        );
    }

    /* The config a session opens: the stored one, the password a client handed over for exactly that target, and read only for a read. */
    private async configFor(
        place: DatabasePlace,
        connection: DatabaseConnection,
        mode: 'read' | 'write'
    ): Promise<{ config: Record<string, unknown>; password: boolean }> {
        const { password: _password, readOnly: _readOnly, create: _create, ...stored } = connection.config as Record<string, unknown>;
        const readOnly = mode === 'read' ? { readOnly: true } : {};
        if (connection.config.engine === 'sqlite') {
            const file = await this.insideFile(place, connection.config.path);
            if (file === null) {
                refuse(
                    'database-outside-project',
                    `The file of ${connection.name} is not inside the project folder, or does not exist; only a person opens a SQLite file elsewhere, in the Databases panel of the app`
                );
            }
            return { config: { ...stored, path: file, ...readOnly }, password: false };
        }
        const password = this.options.passwords.passwordOf(place.projectId, connection.id, connectionTarget(connection.config));
        return { config: { ...stored, ...(password === null ? {} : { password }), ...readOnly }, password: password !== null };
    }

    private async withSession<T>(
        place: DatabasePlace,
        caller: string,
        wanted: string,
        mode: 'read' | 'write',
        work: (session: { connection: DatabaseConnection; call: <R>(method: string, params: Record<string, unknown>) => Promise<R> }) => Promise<T>,
        signal?: AbortSignal,
        uiAccess?: readonly UiDatabaseGrant[]
    ): Promise<T> {
        const connection = await this.named(place, wanted);
        const access = this.options.access.levelOf(place.projectId, connection.id);
        if (access === 'off') {
            refuse(
                'database-access-off',
                `A person turned ${connection.name} off for agents; ask them, who can turn it on in the connections dialog of the app`
            );
        }
        if (mode === 'write' && access !== 'write') {
            refuse(
                'database-write-off',
                `Agents may only read ${connection.name}; a person on this machine can allow writing in the connections dialog of the app, or run the statements themselves`
            );
        }
        if (uiAccess) {
            await this.checkUiGrant(place, connection, uiAccess);
        }
        const { config, password } = await this.configFor(place, connection, mode);
        const owner = `agent:${caller}:${randomUUID()}`;
        const abort = () => {
            void this.options.service.release(owner);
        };
        signal?.addEventListener('abort', abort, { once: true });
        let requests = 0;
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            void this.options.service.release(owner);
        }, this.limitMs);
        const send = async <R>(method: string, params: Record<string, unknown>): Promise<R> => {
            if (signal?.aborted) {
                refuse('database-timeout', 'This UI query was stopped.');
            }
            const answer = await this.options.service.handle({ id: `a${++requests}`, method, params }, owner);
            if (answer.ok) {
                return answer.result as R;
            }
            if (timedOut) {
                refuse('database-timeout', `The call took longer than ${this.limitMs / 1000} s and was stopped; narrow the query or add a LIMIT`);
            }
            if (method === 'open' && answer.error.code === 'auth-failed' && connection.config.engine === 'mysql' && !password) {
                refuse(
                    'database-locked',
                    `${connection.name} needs a password this machine does not have; the person opens this project in the Ruimte app on a desktop that has it saved, which hands it to the machine`
                );
            }
            return failure(answer.error);
        };
        try {
            const { session } = await send<{ session: string }>('open', { connection: config });
            return await work({ connection, call: (method, params) => send(method, { session, ...params }) });
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            await this.options.service.release(owner);
        }
    }
}
