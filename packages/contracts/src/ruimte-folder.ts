import type { DatabaseConnection } from './database.ts';
import type { ProjectSql, SqlBinding } from './project.ts';
import { absoluteOf, isPathBelow, relativeTo, storedPathOf } from './stored-path.ts';

/* The folder a project keeps its state in, beside the work. */
export const PROJECT_DIR = '.ruimte';

/* The mirror of `.ruimte` that holds what belongs to one person. The `.gitignore` beside it names this one line. */
export const PRIVATE_DIR = 'private';

/* One file per drawing view, in a folder of their own: `.ruimte` is read by people and by git, and its top level stays the two files the daemon documents. */
export const DRAWINGS_DIR = 'drawings';

/* The same rule for diagrams, in a folder beside it, so a file name never says which kind it is. */
export const DIAGRAMS_DIR = 'diagrams';

/* A person's database consoles, plain `.sql` files under `private`, so git never sees them. */
export const CONSOLES_DIR = 'consoles';

/* A folder per design, under `private` until its view is shared. */
export const DESIGNS_DIR = 'designs';

/* The two places design folders live, relative to the project folder: one person's, and the team's. */
export const DESIGN_FOLDERS = [`${PROJECT_DIR}/${PRIVATE_DIR}/${DESIGNS_DIR}`, `${PROJECT_DIR}/${DESIGNS_DIR}`] as const;

/*
 * The folder of a design, relative to the project folder: its name under `.ruimte/private/designs/`
 * while the design is one person's, and under `.ruimte/designs/` once it is shared, so it goes into git
 * with its view. A path with a slash is a folder of the project a design named itself and stays put.
 */
export function designFolderOf(view: { path: string }, shared: boolean): string {
    return view.path.includes('/') ? view.path : `${DESIGN_FOLDERS[shared ? 1 : 0]}/${view.path}`;
}

/*
 * Whether a path inside a project folder, as the names below that folder, is Ruimte's own state, which a
 * file request never writes, creates, moves or deletes: the files there change only through their own
 * requests and revs. A person's consoles and the folders of designs are the exception, since they are
 * files like any other: a design's chat and the person's edits write its pages.
 */
export function isRuimteState(segments: readonly string[]): boolean {
    if (segments[0] !== PROJECT_DIR) {
        return false;
    }
    if (segments[1] === DESIGNS_DIR && segments.length > 2) {
        return false;
    }
    return !(segments[1] === PRIVATE_DIR && (segments[2] === CONSOLES_DIR || segments[2] === DESIGNS_DIR) && segments.length > 3);
}

/* Where a project keeps a person's consoles: beside its private file, which the `.gitignore` of `.ruimte` keeps out of git. */
export function consolesFolderOf(folder: string): string {
    return absoluteOf(folder, `${PROJECT_DIR}/${PRIVATE_DIR}/${CONSOLES_DIR}`);
}

/*
 * A console lives in a folder of its connection, so which connection a closed console runs on is where it is:
 * no second record to keep in step, and a rename or a delete of the file takes its binding along.
 */
export function consoleFolderOf(folder: string, connectionId: string): string {
    return absoluteOf(consolesFolderOf(folder), encodeURIComponent(connectionId));
}

/* The connection a console file belongs to by the folder it is in, or null for any other file. */
export function consoleConnectionOf(folder: string, path: string): string | null {
    const root = consolesFolderOf(folder);
    if (!isPathBelow(root, path) || !path.toLowerCase().endsWith('.sql')) {
        return null;
    }
    const [segment, name, ...deeper] = relativeTo(root, path).split('/');
    if (segment === undefined || segment === '' || name === undefined || name === '' || deeper.length > 0) {
        return null;
    }
    try {
        return decodeURIComponent(segment);
    } catch {
        return null;
    }
}

/* The database a connection starts in: `main` for a SQLite file, the configured one of a server, or null for a server that starts in none. */
export function startDatabaseOf(connection: DatabaseConnection): string | null {
    if (connection.config.engine === 'sqlite') {
        return 'main';
    }
    const database = (connection.config as Record<string, unknown>).database;
    return typeof database === 'string' && database !== '' ? database : null;
}

/* What the SQL of one file is read against, and why: its own choice, the folder of a console, or the project's default. */
export type SqlChoice =
    | { source: 'file' | 'console' | 'default'; connection: DatabaseConnection; database: string | null }
    | { source: 'none' }
    // A file a person set to no connection.
    | { source: 'unbound' };

/* The database a choice reads: the one it names, else the one its connection starts in. */
export function bindingDatabaseOf(binding: SqlBinding, connection: DatabaseConnection): string | null {
    return binding.database ?? startDatabaseOf(connection);
}

/*
 * What a file's SQL is read against: a console reads the connection of its folder, else the file's own
 * choice, else the project's default. `path` is absolute, `folder` the project's (null while it has none).
 */
export function choiceFor(folder: string | null, sql: ProjectSql | undefined, connections: readonly DatabaseConnection[], path: string): SqlChoice {
    const byId = (id: string): DatabaseConnection | undefined => connections.find((connection) => connection.id === id);
    const own = sql?.files?.[storedPathOf(folder, path)];
    const console = folder === null ? null : consoleConnectionOf(folder, path);
    if (console !== null) {
        const connection = byId(console);
        return connection === undefined
            ? { source: 'none' }
            : { source: 'console', connection, database: own?.connectionId === console ? bindingDatabaseOf(own, connection) : startDatabaseOf(connection) };
    }
    if (own !== undefined) {
        if (own.connectionId === null) {
            return { source: 'unbound' };
        }
        const connection = byId(own.connectionId);
        if (connection !== undefined) {
            return { source: 'file', connection, database: bindingDatabaseOf(own, connection) };
        }
    }
    const fallback = sql?.default;
    const connection = fallback?.connectionId == null ? undefined : byId(fallback.connectionId);
    return fallback === undefined || connection === undefined
        ? { source: 'none' }
        : { source: 'default', connection, database: bindingDatabaseOf(fallback, connection) };
}
