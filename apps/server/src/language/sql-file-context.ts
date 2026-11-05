import type { DatabaseAgentAccess, DatabaseConnection, SqlSnapshotInfo } from '@ruimte/contracts';

/* What the SQL of one file is read against, and why: its own choice, the folder of a console, or the project's default. */
export type SqlChoice =
    | { source: 'file' | 'console' | 'default'; connection: DatabaseConnection; database: string | null }
    | { source: 'none' }
    // A file a person set to no connection.
    | { source: 'unbound' };

/* What the settings of the servers need of a snapshot that is there. */
export interface SnapshotFacts extends SqlSnapshotInfo {
    path: string;
}

/* What the tools tell an agent about the SQL of a file. */
export interface SqlFileContext {
    choice: SqlChoice;
    /* The snapshot the file is read against, when one was taken. */
    snapshot: SnapshotFacts | null;
    /* What agents may do with the connection; `read` for a file read against none. */
    access: DatabaseAgentAccess;
}
