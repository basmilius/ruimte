import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { FS_SEARCH_MAX_RESULTS, type FsSearchResult } from '@ruimte/contracts';
import { classifyEntry } from './visibility.ts';

// A walk outside a git repo cannot read .gitignore cheaply; it stops here and skips the usual weight.
const WALK_MAX_FILES = 20000;
const WALK_MAX_DEPTH = 12;

// Every keystroke searches again; the file list is the expensive part, the ranking is not.
const CACHE_TTL_MS = 10000;

type Listing = { files: string[]; truncated: boolean };

const trackedCache = new Map<string, Listing & { at: number }>();
const ignoredCache = new Map<string, Listing & { at: number }>();

const isWordStart = (path: string, index: number): boolean => {
    if (index === 0) {
        return true;
    }
    const before = path[index - 1]!;
    return before === '/' || before === '.' || before === '-' || before === '_' || before === ' ';
};

/*
 * Subsequence match of `query` in `path`, case-insensitive. Null when a query character is
 * missing. Higher is better: a hit at a word start or right after the previous hit counts
 * more, a hit in the file name more than one in a directory, and a shorter path wins ties.
 */
export const fuzzyScore = (query: string, path: string): number | null => {
    const needle = query.toLowerCase();
    const haystack = path.toLowerCase();
    if (needle === '') {
        return 0;
    }
    const nameStart = haystack.lastIndexOf('/') + 1;
    let score = 0;
    let previous = -1;
    let cursor = 0;
    for (const char of needle) {
        const index = haystack.indexOf(char, cursor);
        if (index < 0) {
            return null;
        }
        score += 1;
        if (isWordStart(haystack, index)) {
            score += 4;
        }
        if (previous >= 0 && index === previous + 1) {
            score += 3;
        }
        if (index >= nameStart) {
            score += 2;
        }
        previous = index;
        cursor = index + 1;
    }
    // A name that starts with the query is what most people mean by typing it.
    if (haystack.startsWith(needle, nameStart)) {
        score += 10;
    }
    return score;
};

/* The best `limit` matches, best first; ties go to a file the repository keeps, then the shorter path, then alphabetical. */
export const rankFiles = (files: string[], query: string, limit: number, ignored: string[] = []): string[] => {
    const scored: Array<{ path: string; score: number; ignored: boolean }> = [];
    const add = (paths: string[], isIgnored: boolean): void => {
        for (const path of paths) {
            const score = fuzzyScore(query, path);
            if (score !== null) {
                scored.push({ path, score, ignored: isIgnored });
            }
        }
    };
    add(files, false);
    add(ignored, true);
    scored.sort((a, b) => b.score - a.score || Number(a.ignored) - Number(b.ignored) || a.path.length - b.path.length || a.path.localeCompare(b.path));
    return scored.slice(0, limit).map((entry) => entry.path);
};

const toPosix = (path: string): string => (sep === '/' ? path : path.split(sep).join('/'));

// Null when `cwd` is not in a repo.
const gitLsFiles = async (cwd: string, args: string[]): Promise<string[] | null> => {
    try {
        const proc = Bun.spawn(['git', 'ls-files', ...args, '-z'], { cwd, stdout: 'pipe', stderr: 'ignore' });
        const output = await new Response(proc.stdout).text();
        if ((await proc.exited) !== 0) {
            return null;
        }
        return output.split('\0').filter((entry) => entry !== '');
    } catch {
        return null;
    }
};

/* Paths come back relative to `root`; `from` is where the walk starts below it. */
const walk = async (root: string, from = root, max = WALK_MAX_FILES): Promise<Listing> => {
    const files: string[] = [];
    if (max <= 0) {
        return { files, truncated: true };
    }
    const queue: Array<{ dir: string; depth: number }> = [{ dir: from, depth: 0 }];
    while (queue.length > 0) {
        const { dir, depth } = queue.shift()!;
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (classifyEntry(entry.name) !== 'always') {
                continue;
            }
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (depth < WALK_MAX_DEPTH) {
                    queue.push({ dir: full, depth: depth + 1 });
                }
            } else if (entry.isFile()) {
                files.push(toPosix(relative(root, full)));
                if (files.length >= max) {
                    return { files, truncated: true };
                }
            }
        }
    }
    return { files, truncated: false };
};

const remembered = async (cache: Map<string, Listing & { at: number }>, cwd: string, load: () => Promise<Listing>): Promise<Listing> => {
    const cached = cache.get(cwd);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached;
    }
    const listed = await load();
    cache.set(cwd, { ...listed, at: Date.now() });
    return listed;
};

/* The files a search of this folder walks: what git tracks, or the walk that stands in for it. */
export const listSearchableFiles = (cwd: string): Promise<Listing> =>
    remembered(trackedCache, cwd, async () => {
        const fromGit = await gitLsFiles(cwd, ['--cached', '--others', '--exclude-standard']);
        return fromGit ? { files: fromGit, truncated: false } : await walk(cwd);
    });

/*
 * What .gitignore keeps out but a person may still want to mention, a `.env.local` or a generated
 * report. Dot names and build output stay out the way a plain walk leaves them out; git collapses
 * an ignored directory to one entry, so `node_modules` costs nothing to skip.
 */
const listIgnoredFiles = (cwd: string): Promise<Listing> =>
    remembered(ignoredCache, cwd, async () => {
        const entries = await gitLsFiles(cwd, ['--others', '--ignored', '--exclude-standard', '--directory']);
        const files = new Set<string>();
        let truncated = false;
        for (const entry of entries ?? []) {
            const isDirectory = entry.endsWith('/');
            const path = isDirectory ? entry.slice(0, -1) : entry;
            if (path.split('/').some((segment) => classifyEntry(segment) !== 'always')) {
                continue;
            }
            if (!isDirectory) {
                files.add(path);
                continue;
            }
            const walked = await walk(cwd, join(cwd, path), WALK_MAX_FILES - files.size);
            walked.files.forEach((file) => files.add(file));
            if (walked.truncated) {
                truncated = true;
                break;
            }
        }
        return { files: [...files], truncated };
    });

/* `fs.grep` keeps to `listSearchableFiles`: a match inside an ignored file is noise, naming one is not. */
export const searchFiles = async (cwd: string, query: string, limit = 20): Promise<FsSearchResult> => {
    const [tracked, ignored] = await Promise.all([listSearchableFiles(cwd), listIgnoredFiles(cwd)]);
    return {
        files: rankFiles(tracked.files, query.trim(), Math.min(limit, FS_SEARCH_MAX_RESULTS), ignored.files),
        truncated: tracked.truncated || ignored.truncated
    };
};

/* Tests and a daemon that watches a folder change can drop what the last search saw. */
export const forgetSearchCache = (): void => {
    trackedCache.clear();
    ignoredCache.clear();
};
