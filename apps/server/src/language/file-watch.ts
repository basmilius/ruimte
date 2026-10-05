import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { settled, supportsRecursive, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from '@ruimte/agents/watch-seam';

// A save, a checkout and an install all touch many files at once; one batch per burst is enough.
const SETTLE_MS = 200;

/* A file that appeared, changed or went, with the protocol's numbers: created 1, changed 2, deleted 3. */
export interface FileChange {
    path: string;
    type: 1 | 2 | 3;
}

/* What is at a path: a file, a directory, or nothing. */
export type StatPath = (path: string) => Promise<'file' | 'directory' | null>;

async function statPath(path: string): Promise<'file' | 'directory' | null> {
    try {
        return (await lstat(path)).isDirectory() ? 'directory' : 'file';
    } catch {
        return null;
    }
}

export interface ProjectFileWatcherOptions {
    folder: string;
    /* Whether a path is worth reporting; a build writing into a folder no server asked about never reaches the batch. */
    wants(path: string): boolean;
    onChanges(changes: FileChange[]): void;
    platform?: NodeJS.Platform;
    seams?: WatchSeams;
    stat?: StatPath;
}

/*
 * Watches the files of a project for the language servers that asked to hear about them. A platform that
 * watches a tree in one call gets one watch on the folder; elsewhere a watch costs a descriptor per
 * directory, so the folder and the directories of the open documents are watched. Events collect for a
 * short burst (`settled`, driven by the events themselves) and leave as one batch.
 */
export class ProjectFileWatcher {
    private readonly options: ProjectFileWatcherOptions;
    private readonly seams: WatchSeams;
    private readonly recursive: boolean;
    private readonly stat: StatPath;
    private readonly watchers = new Map<string, DirectoryWatcher>();
    /* The paths that moved in the burst, and whether the platform called one of its events a rename. */
    private readonly touched = new Map<string, boolean>();
    private readonly settle: Settled;
    private closed = false;

    constructor(options: ProjectFileWatcherOptions) {
        this.options = options;
        this.seams = options.seams ?? SYSTEM_WATCH;
        this.recursive = supportsRecursive(options.platform ?? process.platform);
        this.stat = options.stat ?? statPath;
        this.settle = settled(this.seams, SETTLE_MS, () => this.flush());
        this.watchDirectory(options.folder);
    }

    /* On a platform that does not watch a tree, a directory whose files may change. */
    addDirectory(directory: string): void {
        if (!this.recursive) {
            this.watchDirectory(directory);
        }
    }

    close(): void {
        this.closed = true;
        this.settle.stop();
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
        this.touched.clear();
    }

    private watchDirectory(directory: string): void {
        if (this.closed || this.watchers.has(directory)) {
            return;
        }
        try {
            const watcher = this.seams.watch(directory, { recursive: this.recursive }, (event, filename) => this.heard(directory, event, filename));
            watcher.on('error', () => undefined);
            this.watchers.set(directory, watcher);
        } catch {
            // A folder that cannot be watched leaves its servers on what they read themselves.
        }
    }

    private heard(directory: string, event: string, filename: string | null): void {
        if (filename === null) {
            return;
        }
        const path = join(directory, filename);
        if (!this.options.wants(path)) {
            return;
        }
        this.touched.set(path, (this.touched.get(path) ?? false) || event === 'rename');
        this.settle.nudge();
    }

    private async flush(): Promise<void> {
        const touched = [...this.touched];
        this.touched.clear();
        const changes: FileChange[] = [];
        await Promise.all(
            touched.map(async ([path, renamed]) => {
                const found = await this.stat(path);
                if (found === 'directory') {
                    return;
                }
                changes.push({ path, type: found === null ? 3 : renamed ? 1 : 2 });
            })
        );
        if (!this.closed && changes.length > 0) {
            this.options.onChanges(changes.sort((a, b) => a.path.localeCompare(b.path)));
        }
    }
}
