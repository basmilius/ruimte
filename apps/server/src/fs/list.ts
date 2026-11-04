import { lstat, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CodedError } from '@adecore/agents';
import { FS_LIST_MAX_ENTRIES, type FsEntry, type FsEntryKind, type FsListResult } from '@ruimte/contracts';
import { ignoredPaths } from '../git/ignore.ts';
import { firstInOrder } from './ordered.ts';
import { classifyEntry, isBuildOutput } from './visibility.ts';

type ListErrorCode = 'not-found' | 'not-a-directory';

export class ListError extends CodedError<ListErrorCode> {}

interface ListOptions {
    depth?: number;
    hidden?: boolean;
}

function kindOf(dirent: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): FsEntryKind {
    if (dirent.isSymbolicLink()) {
        return 'symlink';
    }
    if (dirent.isDirectory()) {
        return 'directory';
    }
    return dirent.isFile() ? 'file' : 'other';
}

type ListCandidate = Pick<FsEntry, 'name' | 'kind' | 'hidden'> & { index: number };

let nameCollator: Intl.Collator | undefined;

// Directories first, then by name the way a person reads them: `item2` before `item10`.
function compare(left: ListCandidate, right: ListCandidate): number {
    const rank = (entry: Pick<FsEntry, 'kind'>): number => (entry.kind === 'directory' ? 0 : 1);
    nameCollator ??= new Intl.Collator(undefined, { numeric: true });
    return rank(left) - rank(right) || nameCollator.compare(left.name, right.name) || left.index - right.index;
}

/*
 * The checkout a directory sits in, or null outside one. A submodule and a repository sitting
 * beside the project have their own, and git must be asked there: the folder above answers about
 * terrain that is not its own.
 */
async function repositoryRootOf(dir: string, cache: Map<string, string | null>): Promise<string | null> {
    const known = cache.get(dir);
    if (known !== undefined) {
        return known;
    }
    const parent = dirname(dir);
    const here = await stat(join(dir, '.git')).catch(() => null);
    const found = here !== null ? dir : parent === dir ? null : await repositoryRootOf(parent, cache);
    cache.set(dir, found);
    return found;
}

async function readEntries(dir: string, includeHidden: boolean, inRepository: boolean, limit: number): Promise<{ entries: FsEntry[]; truncated: boolean }> {
    const dirents = await readdir(dir, { withFileTypes: true });
    const candidates: ListCandidate[] = [];
    for (const dirent of dirents) {
        const visibility = classifyEntry(dirent.name, { inRepository });
        if (visibility === 'never' || (visibility === 'shy' && !includeHidden)) {
            continue;
        }
        candidates.push({ name: dirent.name, kind: kindOf(dirent), hidden: visibility === 'shy', index: candidates.length });
    }
    const truncated = candidates.length > limit;
    // Only the rows within the cap are sorted and looked up; the rest are known by name alone.
    const retained = truncated ? firstInOrder(candidates, compare, limit) : candidates.sort(compare);
    const entries = await Promise.all(
        retained.map(async (entry): Promise<FsEntry> => {
            const path = join(dir, entry.name);
            // lstat, not stat: a symlink reports itself, so a loop or a dead link cannot stall a listing.
            const stats = await lstat(path).catch(() => null);
            return {
                name: entry.name,
                path,
                kind: entry.kind,
                size: entry.kind === 'file' ? (stats?.size ?? 0) : null,
                mtime: Math.round(stats?.mtimeMs ?? 0),
                hidden: entry.hidden,
                ignored: false
            };
        })
    );
    return { entries, truncated };
}

/*
 * Never follows a symlink or anything git ignores while expanding levels, so the listing stays inside
 * its root and out of trees such as `node_modules`. Git is asked once per level per checkout, and what
 * it ignores is hidden: the project says itself what is generated.
 */
export async function listDirectory(path: string, options: ListOptions = {}): Promise<FsListResult> {
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
    const repositories = new Map<string, string | null>();
    let queue = [root];
    let total = 0;
    let truncated = false;
    for (let level = 0; level < depth && queue.length > 0 && !truncated; level++) {
        const levelEntries: FsEntry[] = [];
        const byRepository = new Map<string, FsEntry[]>();
        for (const dir of queue) {
            const repository = await repositoryRootOf(dir, repositories);
            let read: FsEntry[];
            try {
                const listed = await readEntries(dir, includeHidden, repository !== null, FS_LIST_MAX_ENTRIES - total);
                read = listed.entries;
                truncated = listed.truncated;
            } catch {
                // A directory nobody may read lists as empty; the root is the one place that is an error.
                if (dir === root) {
                    throw new ListError('not-found', 'That folder cannot be read');
                }
                continue;
            }
            total += read.length;
            byDirectory.set(dir, read);
            levelEntries.push(...read);
            if (repository !== null) {
                const listed = byRepository.get(repository);
                if (listed === undefined) {
                    byRepository.set(repository, [...read]);
                } else {
                    listed.push(...read);
                }
            }
            if (truncated) {
                break;
            }
        }
        for (const [repository, entries] of byRepository) {
            const ignored = await ignoredPaths(
                entries.map((entry) => entry.path),
                repository
            );
            for (const entry of entries) {
                if (ignored.has(entry.path)) {
                    entry.ignored = true;
                    entry.hidden = true;
                }
            }
        }
        queue = levelEntries.filter((entry) => entry.kind === 'directory' && !entry.ignored && !isBuildOutput(entry.name)).map((entry) => entry.path);
    }

    const entries: FsEntry[] = [];
    const emit = (dir: string): void => {
        for (const entry of byDirectory.get(dir) ?? []) {
            // What git turned out to ignore is dropped here; its name alone could not say so earlier.
            if (entry.hidden && !includeHidden) {
                continue;
            }
            entries.push(entry);
            if (entry.kind === 'directory') {
                emit(entry.path);
            }
        }
    };
    emit(root);
    return { path: root, entries, truncated };
}
