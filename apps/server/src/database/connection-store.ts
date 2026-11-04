import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { CodedError, Serializer, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from '@adecore/agents';
import { isWithin } from '@adecore/utils/path';
import {
    DATABASES_VERSION,
    DatabasesPrivateFileSchema,
    DatabasesSharedFileSchema,
    isAbsolutePath,
    readDatabaseEntries,
    resolveStoredPath,
    storedPathOf,
    type DatabaseConnection,
    type DatabaseConnectionEntry,
    type DatabaseConnections,
    type DatabaseFileEntry,
    type DatabasesPrivateFile,
    type DatabasesSharedFile
} from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { PairedWriteRaced, PairedWriteStuck, recoverPaired, writePaired, type PairedFile } from '../projects/paired-write.ts';
import {
    PRIVATE_DIR,
    PROJECT_DIR,
    PROJECT_FILE,
    parseVersioned,
    readJsonDocument,
    restOf,
    tooNewMessage,
    watchOutsideEdits,
    writeGitignoreIfMissing,
    type JsonDocumentParse,
    closeLoaded,
    type JsonDocumentRead
} from '../projects/project-files.ts';
import type { ProjectWriteIO } from '../projects/project-write.ts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';

const DATABASES_FILE = 'databases.json';

const PENDING_FILE = 'pending-databases.json';

type DatabaseConnectionErrorCode = 'project-not-found' | 'connections-invalid' | 'rev-conflict' | 'path-outside-project';

class DatabaseConnectionError extends CodedError<DatabaseConnectionErrorCode> {}

interface DatabaseProjects {
    folderOf(projectId: string): string | null;
    /* The clients that have the project open, which is who may read its connections and who hears a change. */
    holdersOf(projectId: string): string[];
}

interface LoadedConnections {
    folder: string;
    rev: number;
    // The exact text last read or written, so the watcher tells our own write from someone else's.
    sharedText: string;
    privateText: string;
    shared: DatabaseFileEntry[];
    // The top level of each file past what this release reads, written back as it was.
    sharedRest: Record<string, unknown>;
    own: DatabaseFileEntry[];
    privateRest: Record<string, unknown>;
    order: string[];
    watchers: DirectoryWatcher[];
    settle: Settled | null;
}

const SHARED_KEYS = ['version', 'connections'];

const PRIVATE_KEYS = ['version', 'rev', 'connections', 'order'];

function sharedPathIn(folder: string): string {
    return join(folder, PROJECT_DIR, DATABASES_FILE);
}

function privatePathIn(folder: string): string {
    return join(folder, PROJECT_DIR, PRIVATE_DIR, DATABASES_FILE);
}

function pendingPathIn(folder: string): string {
    return join(folder, PROJECT_DIR, PRIVATE_DIR, PENDING_FILE);
}

function parseWith<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }) {
    return (text: string): JsonDocumentParse<T> => {
        const versioned = parseVersioned(text, DATABASES_VERSION);
        if (versioned.kind !== 'value') {
            return versioned;
        }
        const parsed = schema.safeParse(versioned.value);
        return parsed.success ? { kind: 'ok', document: parsed.data } : { kind: 'unreadable' };
    };
}

const parseShared = parseWith<DatabasesSharedFile>(DatabasesSharedFileSchema);

const parsePrivate = parseWith<DatabasesPrivateFile>(DatabasesPrivateFileSchema);

/* The top level indented and every connection on a line of its own, so adding one is one line in a diff. */
function serialize(file: Record<string, unknown>): string {
    const fields = Object.entries(file)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => {
            const text = Array.isArray(value)
                ? value.length === 0
                    ? '[]'
                    : `[\n${value.map((item) => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]`
                : JSON.stringify(value);
            return `  ${JSON.stringify(key)}: ${text}`;
        });
    return `{\n${fields.join(',\n')}\n}\n`;
}

function connectionsOf(entries: readonly DatabaseFileEntry[]): DatabaseConnectionEntry[] {
    return entries.flatMap((entry) => ('connection' in entry ? [entry.connection] : []));
}

function rawOf(entries: readonly DatabaseFileEntry[]): unknown[] {
    return entries.flatMap((entry) => ('raw' in entry ? [entry.raw] : []));
}

/*
 * The entries of a file with every SQLite path made absolute. A relative path that climbs out of the
 * folder is one this daemon never writes, so that entry is somebody else's and stays as it stands.
 */
function entriesIn(folder: string, entries: readonly unknown[]): DatabaseFileEntry[] {
    return readDatabaseEntries(entries).map((entry, index) => {
        if (!('connection' in entry) || entry.connection.config.engine !== 'sqlite') {
            return entry;
        }
        const stored = entry.connection.config.path;
        const path = resolve(resolveStoredPath(folder, stored) ?? stored);
        if (!isAbsolutePath(stored) && !isWithin(folder, path)) {
            return { raw: entries[index] };
        }
        return { connection: { ...entry.connection, config: { ...entry.connection.config, path } } };
    });
}

/* A connection as a file holds it: no password, no side, and a SQLite file inside the folder relative to it. */
function storedOf(folder: string, connection: DatabaseConnection): DatabaseConnectionEntry {
    const { shared: _shared, ...entry } = connection;
    const { password: _password, ...config } = connection.config;
    if (config.engine !== 'sqlite') {
        return { ...entry, config };
    }
    return { ...entry, config: { ...config, path: storedPathOf(folder, resolve(config.path)) } };
}

/*
 * The connections of every open project: `.ruimte/databases.json`, which a team commits, and
 * `.ruimte/private/databases.json`, which holds the rev, this person's own connections and the order
 * of the panel over both files. Every write goes against the rev it read. A password never lands in
 * either file: the desktop app keeps it in its secret store.
 */
export class DatabaseConnectionStore {
    private readonly projects: DatabaseProjects;
    private readonly seams: WatchSeams;
    private readonly sinks = new ClientSinks();
    private readonly loaded = new Map<string, LoadedConnections>();
    private readonly writes = new Serializer();
    private readonly onChanged: ((projectId: string, connections: DatabaseConnection[]) => void) | undefined;
    private readonly io: ProjectWriteIO | undefined;

    /* `onChanged` hears every change of a project's connections, a save here or an edit on disk. */
    constructor(options: {
        projects: DatabaseProjects;
        seams?: WatchSeams;
        io?: ProjectWriteIO;
        onChanged?: (projectId: string, connections: DatabaseConnection[]) => void;
    }) {
        this.projects = options.projects;
        this.seams = options.seams ?? SYSTEM_WATCH;
        this.io = options.io;
        this.onChanged = options.onChanged;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    read(projectId: string, clientId: string): Promise<DatabaseConnections> {
        return this.writes.run(async () => documentOf(await this.load(projectId, clientId)));
    }

    /*
     * The connections of a project for the daemon's own use, such as an agent of it, whoever holds
     * it. A project nobody holds is read from its files as they are and is not watched.
     */
    connectionsOf(projectId: string): Promise<DatabaseConnection[]> {
        return this.writes.run(async () => {
            const known = this.loaded.get(projectId);
            if (known) {
                return documentOf(known).connections;
            }
            const folder = this.projects.folderOf(projectId);
            if (folder === null) {
                throw new DatabaseConnectionError('project-not-found', `No project ${projectId} on this machine`);
            }
            await this.recover(folder);
            return documentOf(await readState(folder, false)).connections;
        });
    }

    /* A person's save of the whole list; which connections are shared is theirs to say. */
    save(projectId: string, baseRev: number, connections: readonly DatabaseConnection[], clientId: string): Promise<DatabaseConnections> {
        return this.writes.run(async () => {
            const state = await this.load(projectId, clientId);
            if (baseRev !== state.rev) {
                throw new DatabaseConnectionError('rev-conflict', `The connections are at rev ${state.rev}, the save was based on ${baseRev}`);
            }
            // A save cut off halfway finishes first; takeOutsideEdits then sees it as the outside edit it is.
            await this.recover(state.folder);
            const outside = await this.takeOutsideEdits(projectId, state);
            // Caught halfway or broken by a merge, a file is refused rather than written over with what is in it lost.
            if (outside === 'unreadable') {
                throw new DatabaseConnectionError('rev-conflict', 'The connections changed on disk and could not be read');
            }
            if (outside === 'taken') {
                throw new DatabaseConnectionError('rev-conflict', `The connections changed on disk; they are now at rev ${state.rev}`);
            }
            const problem = problemIn(state.folder, connections);
            if (problem) {
                throw problem;
            }
            const sharedFile = {
                version: DATABASES_VERSION,
                connections: [...connections.filter((entry) => entry.shared).map((entry) => storedOf(state.folder, entry)), ...rawOf(state.shared)],
                ...state.sharedRest
            };
            const privateFile = {
                version: DATABASES_VERSION,
                rev: state.rev + 1,
                connections: [...connections.filter((entry) => !entry.shared).map((entry) => storedOf(state.folder, entry)), ...rawOf(state.own)],
                order: connections.map((entry) => entry.id),
                ...state.privateRest
            };
            const sharedText = serialize(sharedFile);
            const privateText = serialize(privateFile);
            const files: PairedFile[] = [];
            // A project that never shared a connection gets no file for git to see.
            const writesShared = sharedText !== state.sharedText && (state.sharedText !== '' || sharedFile.connections.length > 0);
            if (writesShared) {
                files.push({ path: sharedPathIn(state.folder), before: state.sharedText || null, after: sharedText });
            }
            // Last, since it carries the rev: a recovery that finds it written knows the whole save landed.
            files.push({ path: privatePathIn(state.folder), before: state.privateText || null, after: privateText });
            await writeGitignoreIfMissing(join(state.folder, PROJECT_DIR, PROJECT_FILE));
            try {
                await writePaired(pendingPathIn(state.folder), files, this.io);
            } catch (e) {
                if (e instanceof PairedWriteRaced) {
                    throw new DatabaseConnectionError('rev-conflict', 'The connections changed on disk while they were saved; nothing was written');
                }
                throw e;
            }
            if (writesShared) {
                state.sharedText = sharedText;
            }
            state.privateText = privateText;
            state.rev = privateFile.rev;
            state.shared = entriesIn(state.folder, sharedFile.connections);
            state.own = entriesIn(state.folder, privateFile.connections);
            state.order = privateFile.order;
            const document = documentOf(state);
            this.emitChanged(projectId, document, clientId);
            return document;
        });
    }

    /* Stops watching a project nobody holds any more; the next read loads it again. */
    closeProject(projectId: string): void {
        closeLoaded(this.loaded, projectId);
    }

    closeAll(): void {
        for (const projectId of [...this.loaded.keys()]) {
            this.closeProject(projectId);
        }
    }

    /* Finishes a save that was cut off between its two files. */
    private async recover(folder: string): Promise<void> {
        try {
            await recoverPaired(pendingPathIn(folder), { root: folder, paths: [sharedPathIn(folder), privatePathIn(folder)] }, this.io);
        } catch (e) {
            if (e instanceof PairedWriteStuck) {
                throw new DatabaseConnectionError('connections-invalid', e.message);
            }
            throw e;
        }
    }

    private emitChanged(projectId: string, document: DatabaseConnections, except: string | null = null): void {
        this.onChanged?.(projectId, document.connections);
        const event: SessionEvent = { event: 'database.connections.changed', payload: { projectId, ...document } };
        for (const clientId of this.projects.holdersOf(projectId)) {
            if (clientId !== except) {
                this.sinks.to(clientId, event);
            }
        }
    }

    private async load(projectId: string, clientId: string): Promise<LoadedConnections> {
        const folder = this.projects.folderOf(projectId);
        if (folder === null || !this.projects.holdersOf(projectId).includes(clientId)) {
            throw new DatabaseConnectionError('project-not-found', `Project ${projectId} is not open on this client`);
        }
        const known = this.loaded.get(projectId);
        if (known) {
            return known;
        }
        await this.recover(folder);
        const state = await readState(folder, true);
        this.loaded.set(projectId, state);
        this.watch(projectId, state);
        return state;
    }

    /* Takes in a write the watcher has not reported yet. A file that does not parse is left for its next event. */
    private async takeOutsideEdits(projectId: string, state: LoadedConnections): Promise<'none' | 'taken' | 'unreadable'> {
        const [shared, own] = await readBothFiles(state.folder, false);
        if (shared.kind === 'unreadable' || own.kind === 'unreadable') {
            return 'unreadable';
        }
        const sharedMoved = textOf(shared) !== state.sharedText;
        const privateMoved = textOf(own) !== state.privateText;
        if (!sharedMoved && !privateMoved) {
            return 'none';
        }
        const rev = state.rev;
        if (sharedMoved) {
            takeShared(state, shared);
        }
        if (privateMoved) {
            takePrivate(state, own);
        }
        // A pull changes only the shared file, and a save against the rev from before it would write over it.
        state.rev = Math.max(state.rev, rev + 1);
        this.emitChanged(projectId, documentOf(state));
        return 'taken';
    }

    private watch(projectId: string, state: LoadedConnections): void {
        const { settle, watchers } = watchOutsideEdits({
            seams: this.seams,
            writes: this.writes,
            folder: state.folder,
            file: DATABASES_FILE,
            what: 'database connections',
            current: () => this.loaded.get(projectId) === state,
            take: () => this.takeOutsideEdits(projectId, state)
        });
        state.settle = settle;
        state.watchers = watchers;
    }
}

function emptyState(folder: string): LoadedConnections {
    return {
        folder,
        rev: 0,
        sharedText: '',
        privateText: '',
        shared: [],
        sharedRest: {},
        own: [],
        privateRest: {},
        order: [],
        watchers: [],
        settle: null
    };
}

/* Whether a project folder has a connections file at all, which is when its agents hear about `database`. */
export function hasDatabaseConnections(folder: string): boolean {
    return existsSync(sharedPathIn(folder)) || existsSync(privatePathIn(folder));
}

/* A file from a newer Ruimte is refused and left as it is, never set aside: a later release reads it. */
async function readConnectionsFile<T>(path: string, parse: (text: string) => JsonDocumentParse<T>, setAside: boolean): Promise<JsonDocumentRead<T>> {
    const read = await readJsonDocument(path, parse, { setAside });
    if (read.kind === 'too-new') {
        throw new DatabaseConnectionError('connections-invalid', tooNewMessage('connections file', read.version, DATABASES_VERSION));
    }
    if (read.kind === 'corrupt') {
        console.warn(`Set aside a database connections file that would not parse: ${read.setAside}`);
    }
    return read;
}

function readBothFiles(folder: string, setAside: boolean): Promise<[JsonDocumentRead<DatabasesSharedFile>, JsonDocumentRead<DatabasesPrivateFile>]> {
    return Promise.all([readConnectionsFile(sharedPathIn(folder), parseShared, setAside), readConnectionsFile(privatePathIn(folder), parsePrivate, setAside)]);
}

async function readState(folder: string, setAside: boolean): Promise<LoadedConnections> {
    const state = emptyState(folder);
    const [shared, own] = await readBothFiles(folder, setAside);
    takeShared(state, shared);
    takePrivate(state, own);
    return state;
}

function textOf<T>(read: JsonDocumentRead<T>): string {
    return read.kind === 'ok' ? read.text : '';
}

function takeShared(state: LoadedConnections, read: JsonDocumentRead<DatabasesSharedFile>): void {
    if (read.kind !== 'ok') {
        state.sharedText = '';
        state.shared = [];
        state.sharedRest = {};
        return;
    }
    state.sharedText = read.text;
    state.shared = entriesIn(state.folder, read.document.connections);
    state.sharedRest = restOf(read.document, SHARED_KEYS);
}

function takePrivate(state: LoadedConnections, read: JsonDocumentRead<DatabasesPrivateFile>): void {
    if (read.kind !== 'ok') {
        state.privateText = '';
        state.own = [];
        state.order = [];
        state.privateRest = {};
        return;
    }
    state.privateText = read.text;
    state.rev = read.document.rev;
    state.own = entriesIn(state.folder, read.document.connections ?? []);
    state.order = read.document.order ?? [];
    state.privateRest = restOf(read.document, PRIVATE_KEYS);
}

/* The connections of both files in the order of the panel; one the order does not name goes after, shared first. */
function documentOf(state: LoadedConnections): DatabaseConnections {
    const seen = new Set<string>();
    const all = [
        ...connectionsOf(state.shared).map((connection) => ({ ...connection, shared: true })),
        ...connectionsOf(state.own).map((connection) => ({ ...connection, shared: false }))
    ].filter((connection) => {
        if (seen.has(connection.id)) {
            return false;
        }
        seen.add(connection.id);
        return true;
    });
    const rank = new Map(state.order.map((id, index) => [id, index]));
    const rankOf = (id: string): number => rank.get(id) ?? state.order.length;
    // A stable sort, so the connections the order does not name keep their place among themselves.
    return { rev: state.rev, connections: all.sort((a, b) => rankOf(a.id) - rankOf(b.id)) };
}

/* The first rule a list of connections breaks, or null. */
export function problemIn(folder: string, connections: readonly DatabaseConnection[]): DatabaseConnectionError | null {
    const ids = new Set<string>();
    for (const connection of connections) {
        if (ids.has(connection.id)) {
            return new DatabaseConnectionError('connections-invalid', `Two connections share the id "${connection.id}"`);
        }
        ids.add(connection.id);
        if (connection.config.engine !== 'sqlite') {
            continue;
        }
        if (!isAbsolute(connection.config.path)) {
            return new DatabaseConnectionError('connections-invalid', `The file of "${connection.name}" is not an absolute path: ${connection.config.path}`);
        }
        if (connection.shared && isAbsolutePath(storedPathOf(folder, resolve(connection.config.path)))) {
            return new DatabaseConnectionError(
                'path-outside-project',
                `The file of "${connection.name}" is outside the project folder, so the connection cannot be shared; keep it on this machine`
            );
        }
    }
    return null;
}
