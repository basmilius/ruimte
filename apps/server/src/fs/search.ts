import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { FS_SEARCH_MAX_RESULTS, type FsSearchResult } from '@ruimte/contracts';

// A walk outside a git repo cannot read .gitignore cheaply; it stops here and skips the usual weight.
const WALK_MAX_FILES = 20000;
const WALK_MAX_DEPTH = 12;
const WALK_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'vendor', '.cache', '__pycache__', '.venv', 'venv']);

// Every keystroke searches again; the file list is the expensive part, the ranking is not.
const CACHE_TTL_MS = 10000;
const cache = new Map<string, { at: number; files: string[]; truncated: boolean }>();

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

/* The best `limit` matches, best first; ties go to the shorter path, then alphabetical. */
export const rankFiles = (files: string[], query: string, limit: number): string[] => {
    const scored: Array<{ path: string; score: number }> = [];
    for (const path of files) {
        const score = fuzzyScore(query, path);
        if (score !== null) {
            scored.push({ path, score });
        }
    }
    scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
    return scored.slice(0, limit).map((entry) => entry.path);
};

const toPosix = (path: string): string => (sep === '/' ? path : path.split(sep).join('/'));

// Tracked and untracked files minus what .gitignore excludes; null when `cwd` is not in a repo.
const listWithGit = async (cwd: string): Promise<string[] | null> => {
    try {
        const proc = Bun.spawn(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd, stdout: 'pipe', stderr: 'ignore' });
        const output = await new Response(proc.stdout).text();
        if ((await proc.exited) !== 0) {
            return null;
        }
        return output.split('\0').filter((entry) => entry !== '');
    } catch {
        return null;
    }
};

const walk = async (root: string): Promise<{ files: string[]; truncated: boolean }> => {
    const files: string[] = [];
    const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (queue.length > 0) {
        const { dir, depth } = queue.shift()!;
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.') || WALK_SKIP.has(entry.name)) {
                continue;
            }
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (depth < WALK_MAX_DEPTH) {
                    queue.push({ dir: full, depth: depth + 1 });
                }
            } else if (entry.isFile()) {
                files.push(toPosix(relative(root, full)));
                if (files.length >= WALK_MAX_FILES) {
                    return { files, truncated: true };
                }
            }
        }
    }
    return { files, truncated: false };
};

/* The files a search of this folder walks: what git tracks, or the walk that stands in for it,
   cached because every keystroke asks again and the listing is the expensive half. */
export const listSearchableFiles = async (cwd: string): Promise<{ files: string[]; truncated: boolean }> => {
    const cached = cache.get(cwd);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached;
    }
    const fromGit = await listWithGit(cwd);
    const listed = fromGit ? { files: fromGit, truncated: false } : await walk(cwd);
    cache.set(cwd, { ...listed, at: Date.now() });
    return listed;
};

export const searchFiles = async (cwd: string, query: string, limit = 20): Promise<FsSearchResult> => {
    const { files, truncated } = await listSearchableFiles(cwd);
    return { files: rankFiles(files, query.trim(), Math.min(limit, FS_SEARCH_MAX_RESULTS)), truncated };
};

/* Tests and a daemon that watches a folder change can drop what the last search saw. */
export const forgetSearchCache = (): void => {
    cache.clear();
};
