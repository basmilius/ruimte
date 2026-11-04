import { join, resolve } from 'node:path';
import { isWithin } from '@adecore/utils/path';
import type { GitReposResult } from '@ruimte/contracts';
import { PROJECT_DIR } from '../projects/project-files.ts';
import { listRepos } from './repos.ts';

// Covers the burst of commit links a chat resolves at once; past it a checkout no watcher saw shows up anyway.
export const REPO_CACHE_TTL_MS = 10_000;

interface Remembered {
    at: number;
    result: Promise<GitReposResult>;
    // What the list came to, once it did, so a change can be held against the checkouts in it.
    settled: GitReposResult | null;
}

/* The directories of a checkout where a change can alter the list: its own folder, where `.git` and `.gitmodules` sit, and what names it. */
function namingDirs(path: string): string[] {
    return [path, join(path, PROJECT_DIR), join(path, '.idea')];
}

/*
 * The repositories of a folder, listed once per folder for a while. A listing costs a git run per
 * checkout and a scan of the folder, and the git panel, launches and every commit link in a chat ask.
 */
export class RepoListCache {
    private readonly folders = new Map<string, Remembered>();
    private readonly list: (folder: string) => Promise<GitReposResult>;
    private readonly now: () => number;

    constructor(list: (folder: string) => Promise<GitReposResult> = listRepos, now: () => number = Date.now) {
        this.list = list;
        this.now = now;
    }

    /* With `fresh` the folder is listed again whatever the cache holds, and the new list takes its place. */
    get(folder: string, fresh = false): Promise<GitReposResult> {
        const key = resolve(folder);
        for (const [cachedKey, cached] of this.folders) {
            if (this.now() - cached.at >= REPO_CACHE_TTL_MS) {
                this.folders.delete(cachedKey);
            }
        }
        const cached = this.folders.get(key);
        if (cached && !fresh) {
            return cached.result;
        }
        const entry: Remembered = { at: this.now(), result: this.list(key), settled: null };
        this.folders.set(key, entry);
        entry.result.then(
            (result) => {
                entry.settled = result;
            },
            () => {
                if (this.folders.get(key) === entry) {
                    this.folders.delete(key);
                }
            }
        );
        return entry.result;
    }

    /*
     * Drops the folders a change in these directories may give other repositories: a change in the
     * folder or above it, or in a checkout's own folder. One deeper in a checkout waits out the time
     * limit, or every save would empty the cache. A list still being made goes on any change inside.
     * Without `changed`, everything goes.
     */
    forget(changed?: readonly string[]): void {
        if (changed === undefined) {
            this.folders.clear();
            return;
        }
        const paths = changed.map((path) => resolve(path));
        for (const [key, entry] of this.folders) {
            const settled = entry.settled;
            const touched =
                settled === null
                    ? paths.some((path) => isWithin(path, key) || isWithin(key, path))
                    : paths.some((path) => isWithin(path, key) || settled.repos.some((repo) => namingDirs(repo.path).includes(path)));
            if (touched) {
                this.folders.delete(key);
            }
        }
    }
}

const shared = new RepoListCache();

export function cachedRepos(folder: string, fresh = false): Promise<GitReposResult> {
    return shared.get(folder, fresh);
}

/* What the shared watch (`fs/shared-watch.ts`) calls with the directories a burst touched, whoever watched them. */
export function forgetRepos(changed?: readonly string[]): void {
    shared.forget(changed);
}
