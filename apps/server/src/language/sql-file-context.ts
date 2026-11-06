import type { DatabaseAgentAccess, SqlChoice, SqlSnapshotInfo } from '@ruimte/contracts';

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
