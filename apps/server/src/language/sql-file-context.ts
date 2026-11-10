import type { DatabaseAgentAccess, SqlChoice, SqlSnapshotInfo } from '@ruimte/contracts';

/* What the settings of the servers need of a snapshot that is there. */
export interface SnapshotFacts extends SqlSnapshotInfo {
    path: string;
}

export interface SqlFileContext {
    choice: SqlChoice;
    snapshot: SnapshotFacts | null;
    /* What agents may do with the connection; `read` for a file read against none. */
    access: DatabaseAgentAccess;
}
