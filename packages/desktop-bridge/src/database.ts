/*
 * The passwords of the database connections, one secret per key the page names. The page writes and
 * reads them; they never reach a file a project keeps or the daemon's own state.
 */
export interface DatabaseSecretsBridge {
    /* Rejects for a secret that is kept but cannot be decrypted. */
    read(key: string): Promise<string | null>;
    /* Null deletes the secret. */
    write(key: string, secret: string | null): Promise<void>;
    /* False while the system offers no encryption: the shell then keeps them in memory until it quits.
       Optional, since a shell that is already running carries the preload it started with. */
    persistent?(): Promise<boolean>;
}

/* What a file is picked for: a file to import rows from, a SQLite database, or an SSH key, which starts in `~/.ssh`. */
export type OpenPathPurpose = 'import' | 'database' | 'identity';

export interface OpenPathRequest {
    purpose: OpenPathPurpose;
    /* Without a dot. Only `import` filters on them; the other purposes have their own. */
    extensions?: string[];
}

export interface SavePathRequest {
    /* A file name, not a path. */
    suggestedName: string;
    /* Without a dot, such as `csv`. */
    extension: string;
}
