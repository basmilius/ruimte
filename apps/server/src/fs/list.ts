import { lstat, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FS_LIST_MAX_ENTRIES, type FsEntry, type FsEntryKind, type FsListResult } from '@ruimte/contracts';
import { ignoredPaths } from '../git/ignore.ts';
import { CodedError } from '../coded-error.ts';

type ListErrorCode = 'not-found' | 'not-a-directory';

export class ListError extends CodedError<ListErrorCode> {}

export interface ListOptions {
    depth?: number;
    hidden?: boolean;
}

const kindOf = (dirent: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): FsEntryKind => {
    if (dirent.isSymbolicLink()) {
        return 'symlink';
    }
    if (dirent.isDirectory()) {
        return 'directory';
    }
    return dirent.isFile() ? 'file' : 'other';
};

// Directories first, then by name the way a person reads them: `item2` before `item10`.
const compare = (left: FsEntry, right: FsEntry): number => {
    const rank = (entry: FsEntry): number => (entry.kind === 'directory' ? 0 : 1);
    return rank(left) - rank(right) || left.name.localeCompare(right.name, undefined, { numeric: true });
};

const readEntries = async (dir: string, includeHidden: boolean): Promise<FsEntry[]> => {
    const dirents = (await readdir(dir, { withFileTypes: true })).filter((dirent) => includeHidden || !dirent.name.startsWith('.'));
    const entries = await Promise.all(
        dirents.map(async (dirent): Promise<FsEntry> => {
            const path = join(dir, dirent.name);
            const kind = kindOf(dirent);
            // lstat, not stat: a symlink reports itself, so a loop or a dead link cannot stall a listing.
            const stats = await lstat(path).catch(() => null);
            return {
                name: dirent.name,
                path,
                kind,
                size: kind === 'file' ? (stats?.size ?? 0) : null,
                mtime: Math.round(stats?.mtimeMs ?? 0),
                hidden: dirent.name.startsWith('.'),
                // Git never reports its own directory as ignored, and a tree that shows it undimmed reads wrong.
                ignored: dirent.name === '.git'
            };
        })
    );
    return entries.sort(compare);
};

/*
 * Never follow symlinks or ignored directories while expanding levels, keeping the listing inside
 * its root and out of trees such as `node_modules`. Git ignore status is checked once per level.
 */
export const listDirectory = async (path: string, options: ListOptions = {}): Promise<FsListResult> => {
    const root = resolve(path);
    const depth = options.depth ?? 1;
    const includeHidden = options.hidden ?? false;
    const stats = await stat(root).catch(() => null);
    if (!stats) {
        throw new ListError('not-found', 'That folder is not there');
    }
    if (!stats.isDirectory()) {
        throw new ListError('not-a-directory', 'That path is a file, not a folder');
    }

    const byDirectory = new Map<string, FsEntry[]>();
    let queue = [root];
    let total = 0;
    let truncated = false;
    for (let level = 0; level < depth && queue.length > 0 && !truncated; level++) {
        const levelEntries: FsEntry[] = [];
        for (const dir of queue) {
            let read: FsEntry[];
            try {
                read = await readEntries(dir, includeHidden);
            } catch {
                // A directory nobody may read lists as empty; the root is the one place that is an error.
                if (dir === root) {
                    throw new ListError('not-found', 'That folder cannot be read');
                }
                continue;
            }
            if (total + read.length > FS_LIST_MAX_ENTRIES) {
                read = read.slice(0, FS_LIST_MAX_ENTRIES - total);
                truncated = true;
            }
            total += read.length;
            byDirectory.set(dir, read);
            levelEntries.push(...read);
            if (truncated) {
                break;
            }
        }
        const ignored = await ignoredPaths(
            levelEntries.map((entry) => entry.path),
            root
        );
        for (const entry of levelEntries) {
            entry.ignored ||= ignored.has(entry.path);
        }
        queue = levelEntries.filter((entry) => entry.kind === 'directory' && !entry.ignored).map((entry) => entry.path);
    }

    const entries: FsEntry[] = [];
    const emit = (dir: string): void => {
        for (const entry of byDirectory.get(dir) ?? []) {
            entries.push(entry);
            if (entry.kind === 'directory') {
                emit(entry.path);
            }
        }
    };
    emit(root);
    return { path: root, entries, truncated };
};
