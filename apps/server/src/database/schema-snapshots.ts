import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseConnection, SqlSnapshotInfo } from '@ruimte/contracts';
import type {
    CheckInfo,
    ColumnInfo,
    DatabaseResponse,
    SchemaInfo,
    ServerInfo,
    StatementResult,
    TableInfo,
    TableStructure,
    TriggerInfo
} from '@adecore/database/protocol';
import { errorText } from '../error-text.ts';
import { connectionTarget } from './agent-databases.ts';

/* The snapshot format of the SQL language server this daemon writes (`docs/snapshot-format.md` there). */
export const SNAPSHOT_FORMAT_VERSION = 1;

/* The file of a snapshot of every database a connection that starts in none can see, which no database name can take. */
const ALL_DATABASES = '@all';

/* How long one snapshot may keep its session; past it the snapshot is given up and its session closed. */
export const SNAPSHOT_LIMIT_MS = 120_000;

/* What a connection is read for: a database by name, or null for every database a connection that starts in none can see. */
export interface SnapshotTarget {
    connectionId: string;
    database: string | null;
}

/* What the settings of the servers need of a snapshot that is there. */
export interface SnapshotFacts extends SqlSnapshotInfo {
    path: string;
}

export interface SchemaSnapshotsOptions {
    /* `$RUIMTE_HOME/database-snapshots`. */
    root: string;
    service: { handle(request: unknown, owner: string): Promise<DatabaseResponse>; release(owner: string): Promise<void> };
    /* The password a client handed over for a connection as it points now; null without one. */
    passwordOf(projectId: string, connectionId: string, target: string): string | null;
    now?: () => Date;
    limitMs?: number;
}

/* Why a snapshot could not be taken, in words a person or an agent reads. */
export class SnapshotError extends Error {}

type Call = <R>(method: string, params: Record<string, unknown>) => Promise<R>;

/* A name as one segment of a path that a glob reads as itself: what `encodeURIComponent` leaves of a glob's own characters is encoded as well. */
function segmentOf(name: string): string {
    return encodeURIComponent(name).replace(/[!'()*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

const PRODUCTS: Record<ServerInfo['flavor'], string> = { sqlite: 'SQLite', mysql: 'MySQL', mariadb: 'MariaDB' };

/* An action as the snapshot writes it: `CASCADE` as `cascade`, nothing for the engine's default. */
function action(text: string | null): string | undefined {
    return text === null ? undefined : text.toLowerCase();
}

/*
 * How a generated column is generated and from what, read off its line of the `CREATE TABLE` the server
 * writes, since the helper only says that it is. A column the text says nothing clear of reads as stored,
 * which keeps it out of an insert as either kind would.
 */
export function generationOf(ddl: string | null, name: string): { generated: 'stored' | 'virtual'; generationExpression?: string } {
    const quoted = new RegExp(`^\\s*(?:\`${escapeRegExp(name)}\`|"${escapeRegExp(name)}"|${escapeRegExp(name)})\\s`, 'i');
    const line = (ddl ?? '').split('\n').find((candidate) => quoted.test(candidate));
    if (line === undefined) {
        return { generated: 'stored' };
    }
    const kind = /\bVIRTUAL\b/i.test(line) ? 'virtual' : 'stored';
    const expression = /\bAS\s*\((.*)\)\s*(?:VIRTUAL|STORED|PERSISTENT)\b/i.exec(line)?.[1]?.trim();
    return { generated: kind, ...(expression === undefined || expression === '' ? {} : { generationExpression: expression }) };
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function column(info: ColumnInfo, ordinal: number, ddl: string | null): Record<string, unknown> {
    return {
        name: info.name,
        ...(info.type === '' ? {} : { type: info.type }),
        nullable: info.nullable,
        ...(info.defaultValue === null ? {} : { default: info.defaultValue }),
        ...(info.generated ? generationOf(ddl, info.name) : {}),
        ...(info.autoIncrement ? { autoIncrement: true } : {}),
        ...(info.comment === null || info.comment === '' ? {} : { comment: info.comment }),
        ordinal
    };
}

/* The query of a view out of the `CREATE VIEW` the server writes, which also names its definer; only what follows `AS` is the query. */
export function viewQueryOf(ddl: string | null): string | undefined {
    if (ddl === null) {
        return undefined;
    }
    const match =
        /\bVIEW\s+(?:`(?:[^`]|``)+`|"(?:[^"]|"")+"|\[[^\]]+\]|[^\s(]+)(?:\s*\.\s*(?:`(?:[^`]|``)+`|"(?:[^"]|"")+"|[^\s(]+))?\s*(?:\([^)]*\)\s*)?AS\s+([\s\S]+)$/i.exec(
            ddl.trim()
        );
    return match?.[1]?.trim().replace(/;$/, '');
}

function check(info: CheckInfo): Record<string, unknown> {
    return { ...(info.name === null ? {} : { name: info.name }), expression: info.expression };
}

function trigger(info: TriggerInfo, table: string): Record<string, unknown> {
    return { name: info.name, table, timing: info.timing.toLowerCase(), events: [info.event.toLowerCase()] };
}

/* A table as the snapshot holds it, from what the helper says of it. */
export function tableOf(info: TableInfo, structure: TableStructure): Record<string, unknown> {
    const primary = structure.indexes.find((index) => index.primary);
    const unique = structure.indexes.filter((index) => index.unique && !index.primary);
    const definition = info.kind === 'view' ? viewQueryOf(structure.ddl) : undefined;
    return {
        name: info.name,
        kind: info.kind,
        ...(info.comment === null || info.comment === '' ? {} : { comment: info.comment }),
        columns: structure.columns.map((entry, index) => column(entry, index + 1, structure.ddl)),
        ...(structure.primaryKey.length === 0 ? {} : { primaryKey: { ...(primary ? { name: primary.name } : {}), columns: [...structure.primaryKey] } }),
        ...(unique.length === 0 ? {} : { uniqueKeys: unique.map((index) => ({ name: index.name, columns: [...index.columns] })) }),
        ...(structure.indexes.some((index) => !index.primary)
            ? {
                  indexes: structure.indexes
                      .filter((index) => !index.primary)
                      .map((index) => ({ name: index.name, columns: [...index.columns], unique: index.unique }))
              }
            : {}),
        ...(structure.foreignKeys.length === 0
            ? {}
            : {
                  foreignKeys: structure.foreignKeys.map((key) => ({
                      ...(key.name === null ? {} : { name: key.name }),
                      columns: [...key.columns],
                      referencedSchema: key.referencedSchema,
                      referencedTable: key.referencedTable,
                      ...(key.referencedColumns.length === 0 ? {} : { referencedColumns: [...key.referencedColumns] }),
                      ...(action(key.onDelete) === undefined ? {} : { onDelete: action(key.onDelete) }),
                      ...(action(key.onUpdate) === undefined ? {} : { onUpdate: action(key.onUpdate) })
                  }))
              }),
        ...(structure.checks === undefined || structure.checks.length === 0 ? {} : { checks: structure.checks.map(check) }),
        ...(definition === undefined ? {} : { definition })
    };
}

/* What the text of a snapshot is compared by: everything but the moment it was taken, which would make every refresh a change. */
function comparable(text: string): string | null {
    try {
        const parsed = JSON.parse(text) as { source?: Record<string, unknown> };
        const { takenAt: _takenAt, ...source } = parsed.source ?? {};
        return JSON.stringify({ ...parsed, source });
    } catch {
        return null;
    }
}

function factsOf(path: string, connectionId: string, database: string | null, text: string): SnapshotFacts | null {
    try {
        const parsed = JSON.parse(text) as {
            source?: { dialect?: unknown; version?: unknown; takenAt?: unknown };
            schemas?: { tables?: unknown[] }[];
        };
        const { source } = parsed;
        if (typeof source?.dialect !== 'string' || typeof source.takenAt !== 'string') {
            return null;
        }
        return {
            path,
            connectionId,
            database,
            dialect: source.dialect,
            ...(typeof source.version === 'string' ? { version: source.version } : {}),
            takenAt: source.takenAt,
            tables: (parsed.schemas ?? []).reduce((count, schema) => count + (schema.tables?.length ?? 0), 0)
        };
    } catch {
        return null;
    }
}

/*
 * The schema snapshots of the connections of every project, in the format the SQL language server reads,
 * under `<root>/<project>/<connection>/<database>.json`. A snapshot is taken on a session of its own, opened
 * read only with the password a client handed over, and holds names, types, keys and comments, never a
 * credential and never a row. A file is written whole through a rename and only when what it says changed,
 * so a server that watches it reads it again only then. Takes of one target never run side by side: one
 * asked for while another runs follows it once.
 */
export class SchemaSnapshots {
    private readonly options: SchemaSnapshotsOptions;
    private readonly running = new Map<string, Promise<SnapshotFacts>>();
    private readonly queued = new Map<string, Promise<SnapshotFacts>>();

    constructor(options: SchemaSnapshotsOptions) {
        this.options = options;
    }

    /* The file a target's snapshot is in, whether or not it is there yet. */
    pathOf(projectId: string, target: SnapshotTarget): string {
        return join(this.connectionFolder(projectId, target.connectionId), `${segmentOf(target.database ?? ALL_DATABASES)}.json`);
    }

    /* The snapshots of a project that are there, read from their files. */
    async list(projectId: string): Promise<SnapshotFacts[]> {
        const folder = join(this.options.root, segmentOf(projectId));
        const connections = await readdir(folder).catch(() => [] as string[]);
        const found: SnapshotFacts[] = [];
        for (const segment of connections) {
            const connectionId = decodeURIComponent(segment);
            for (const file of await readdir(join(folder, segment)).catch(() => [] as string[])) {
                if (!file.endsWith('.json')) {
                    continue;
                }
                const name = decodeURIComponent(file.slice(0, -'.json'.length));
                const path = join(folder, segment, file);
                const facts = factsOf(path, connectionId, name === ALL_DATABASES ? null : name, await readFile(path, 'utf8').catch(() => ''));
                if (facts !== null) {
                    found.push(facts);
                }
            }
        }
        return found.sort((a, b) => a.path.localeCompare(b.path));
    }

    /* A connection that left the project takes its snapshots along. */
    async forget(projectId: string, connectionId: string): Promise<void> {
        await rm(this.connectionFolder(projectId, connectionId), { recursive: true, force: true });
    }

    /*
     * Takes the snapshot of one target. While one runs for it, a call waits for it and takes it once more
     * after, since the one that runs may have read the schema before what asked for this changed it; calls
     * that come in the meantime share that one. Answers what the file holds now, or a sentence that says why not.
     */
    take(projectId: string, connection: DatabaseConnection, database: string | null): Promise<SnapshotFacts> {
        const key = this.pathOf(projectId, { connectionId: connection.id, database });
        const running = this.running.get(key);
        if (running !== undefined) {
            let queued = this.queued.get(key);
            if (queued === undefined) {
                queued = running
                    .catch(() => undefined)
                    .then(() => {
                        this.queued.delete(key);
                        return this.take(projectId, connection, database);
                    });
                this.queued.set(key, queued);
            }
            return queued;
        }
        const work = this.write(projectId, connection, database).finally(() => {
            this.running.delete(key);
        });
        this.running.set(key, work);
        return work;
    }

    private connectionFolder(projectId: string, connectionId: string): string {
        return join(this.options.root, segmentOf(projectId), segmentOf(connectionId));
    }

    private async write(projectId: string, connection: DatabaseConnection, database: string | null): Promise<SnapshotFacts> {
        const snapshot = await this.read(projectId, connection, database);
        const path = this.pathOf(projectId, { connectionId: connection.id, database });
        const text = `${JSON.stringify(snapshot, null, 2)}\n`;
        const before = await readFile(path, 'utf8').catch(() => null);
        const unchanged = before !== null && comparable(before) === comparable(text);
        if (!unchanged) {
            await mkdir(join(path, '..'), { recursive: true });
            const partial = `${path}.${randomUUID()}.partial`;
            await writeFile(partial, text);
            await rename(partial, path);
        }
        const facts = factsOf(path, connection.id, database, unchanged ? before : text);
        if (facts === null) {
            throw new SnapshotError(`The snapshot of ${connection.name} could not be read back`);
        }
        return facts;
    }

    /* What a connection holds, read on a read-only session that is closed before this answers. */
    private async read(projectId: string, connection: DatabaseConnection, database: string | null): Promise<Record<string, unknown>> {
        const owner = `snapshot:${projectId}:${randomUUID()}`;
        let requests = 0;
        let timedOut = false;
        const limit = this.options.limitMs ?? SNAPSHOT_LIMIT_MS;
        const timer = setTimeout(() => {
            timedOut = true;
            void this.options.service.release(owner);
        }, limit);
        const call: Call = async <R>(method: string, params: Record<string, unknown>): Promise<R> => {
            const answer = await this.options.service.handle({ id: `s${++requests}`, method, params }, owner);
            if (answer.ok) {
                return answer.result as R;
            }
            if (timedOut) {
                throw new SnapshotError(`Reading the schema of ${connection.name} took longer than ${limit / 1000} s and was stopped`);
            }
            if (method === 'open' && answer.error.code === 'auth-failed') {
                throw new SnapshotError(`${connection.name} needs a password this machine does not have; open the connection in the app, which hands it over`);
            }
            throw new SnapshotError(`${connection.name}: ${answer.error.message}`);
        };
        try {
            const opened = await call<{ session: string; server: ServerInfo }>('open', { connection: this.configFor(projectId, connection) });
            const session = (method: string, params: Record<string, unknown>) => call(method, { session: opened.session, ...params });
            return await this.snapshotOf(connection, database, opened.server, session as Call);
        } catch (error) {
            throw error instanceof SnapshotError ? error : new SnapshotError(errorText(error));
        } finally {
            clearTimeout(timer);
            await this.options.service.release(owner);
        }
    }

    /* The stored config, with the password handed over for exactly where it points now, opened read only. */
    private configFor(projectId: string, connection: DatabaseConnection): Record<string, unknown> {
        const { password: _password, readOnly: _readOnly, create: _create, ...stored } = connection.config as Record<string, unknown>;
        if (connection.config.engine === 'sqlite') {
            return { ...stored, readOnly: true };
        }
        const password = this.options.passwordOf(projectId, connection.id, connectionTarget(connection.config));
        return { ...stored, ...(password === null ? {} : { password }), readOnly: true };
    }

    private async snapshotOf(connection: DatabaseConnection, database: string | null, server: ServerInfo, call: Call): Promise<Record<string, unknown>> {
        const { schemas } = await call<{ schemas: SchemaInfo[] }>('schemas', {});
        const names = database === null ? schemas.filter((schema) => !schema.system).map((schema) => schema.name) : [database];
        if (database !== null && !schemas.some((schema) => schema.name === database)) {
            throw new SnapshotError(`${connection.name} has no database ${database}`);
        }
        const mysql = server.flavor !== 'sqlite' ? await this.serverSettings(call) : {};
        const read: Record<string, unknown>[] = [];
        for (const name of names) {
            const { tables } = await call<{ tables: TableInfo[] }>('tables', { schema: name });
            const entries: Record<string, unknown>[] = [];
            const triggers: Record<string, unknown>[] = [];
            for (const table of tables) {
                const structure = await call<TableStructure>('structure', { schema: name, table: table.name });
                entries.push(tableOf(table, structure));
                triggers.push(...(structure.triggers ?? []).map((entry) => trigger(entry, table.name)));
            }
            read.push({ name, tables: entries, ...(triggers.length === 0 ? {} : { triggers }) });
        }
        return {
            formatVersion: SNAPSHOT_FORMAT_VERSION,
            source: {
                dialect: server.flavor,
                product: PRODUCTS[server.flavor],
                version: server.version,
                ...(connection.config.engine === 'sqlite' ? { database: connection.config.path } : {}),
                ...mysql,
                takenAt: (this.options.now ?? (() => new Date()))().toISOString()
            },
            ...(database === null ? {} : { defaultSchema: database }),
            schemas: read
        };
    }

    /* `@@sql_mode` and `@@lower_case_table_names` of MySQL and MariaDB, which some inspections follow; nothing when the server does not say. */
    private async serverSettings(call: Call): Promise<Record<string, unknown>> {
        try {
            const { results } = await call<{ results: StatementResult[] }>('execute', {
                sql: 'SELECT @@sql_mode AS sql_mode, @@lower_case_table_names AS lower_case_table_names',
                limit: 1
            });
            const first = results[0];
            if (first?.kind !== 'rows' || first.rows.length === 0) {
                return {};
            }
            const [mode, lower] = first.rows[0]!;
            const lowerCase = typeof lower === 'number' ? lower : typeof lower === 'string' ? Number.parseInt(lower, 10) : Number.NaN;
            return {
                ...(typeof mode === 'string' ? { sqlMode: mode } : {}),
                ...(lowerCase === 0 || lowerCase === 1 || lowerCase === 2 ? { lowerCaseTableNames: lowerCase } : {})
            };
        } catch {
            return {};
        }
    }
}
