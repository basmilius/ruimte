import { readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { FS_SEARCH_MAX_RESULTS, type FsSearchResult } from '@ruimte/contracts';
import { cachedRepos } from '../git/repo-cache.ts';
import { NO_MACHINE_HOME, type MachineHomePolicy } from './machine-home.ts';
import { firstInOrder, inOrder } from './ordered.ts';
import { isUnder } from './path-segment.ts';
import { isOpenName, isOpenPath, searchRoot } from './searchable.ts';
import { classifyEntry } from './visibility.ts';

// A walk outside a git repo cannot read .gitignore cheaply; it stops here and skips the usual weight.
const WALK_MAX_FILES = 20000;
const WALK_MAX_DEPTH = 12;

// Every keystroke searches again; the file list is the expensive part, the ranking is not.
const CACHE_TTL_MS = 10000;
// Folders a machine searches at once: its open projects, their worktrees and the odd folder above one.
const CACHE_MAX_FOLDERS = 32;

type Listing = { files: string[]; truncated: boolean };
type Remembered = { listing: Promise<Listing>; at: number };

// Keyed by the resolved folder, oldest use first, so the first key is the one to drop.
const trackedCache = new Map<string, Remembered>();
const ignoredCache = new Map<string, Remembered>();

function isWordStart(path: string, index: number): boolean {
    if (index === 0) {
        return true;
    }
    const before = path[index - 1]!;
    return before === '/' || before === '.' || before === '-' || before === '_' || before === ' ';
}

function wordsOf(query: string): string[] {
    return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function scorePath(words: readonly string[], path: string): number | null {
    if (words.length === 0) {
        return 0;
    }
    const haystack = path.toLowerCase();
    const nameStart = haystack.lastIndexOf('/') + 1;
    let score = 0;
    for (const word of words) {
        const wordScore = subsequenceScore(word, haystack, nameStart);
        if (wordScore === null) {
            return null;
        }
        score += wordScore;
    }
    return score;
}

function subsequenceScore(needle: string, haystack: string, nameStart: number): number | null {
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
}

interface ScoredFile {
    path: string;
    score: number;
    ignored: boolean;
    index: number;
}

function compareFiles(first: ScoredFile, second: ScoredFile): number {
    return (
        second.score - first.score ||
        Number(first.ignored) - Number(second.ignored) ||
        first.path.length - second.path.length ||
        first.path.localeCompare(second.path) ||
        first.index - second.index
    );
}

function scoreFiles(files: string[], query: string, ignored: string[]): ScoredFile[] {
    const scored: ScoredFile[] = [];
    const words = wordsOf(query);
    const add = (paths: string[], isIgnored: boolean): void => {
        for (const path of paths) {
            const score = scorePath(words, path);
            if (score !== null) {
                scored.push({ path, score, ignored: isIgnored, index: scored.length });
            }
        }
    };
    add(files, false);
    add(ignored, true);
    return scored;
}

/* The best `limit` matches, best first; ties go to a file the repository keeps, then the shorter path, then alphabetical. */
export function rankFiles(files: string[], query: string, limit: number, ignored: string[] = []): string[] {
    const scored = scoreFiles(files, query, ignored);
    const ranked = !Number.isFinite(limit) || limit < 0 ? scored.sort(compareFiles).slice(0, limit) : firstInOrder(scored, compareFiles, Math.trunc(limit));
    return ranked.map((entry) => entry.path);
}

function toPosix(path: string): string {
    return sep === '/' ? path : path.split(sep).join('/');
}

// Null when `cwd` is not in a repo.
async function gitLsFiles(cwd: string, args: string[]): Promise<string[] | null> {
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
}

/* Paths come back relative to `root`; `from` is where the walk starts below it. */
async function walk(root: string, from = root, max = WALK_MAX_FILES): Promise<Listing> {
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
}

/* One listing per folder at a time: the keystrokes that follow share the one already running. */
function remembered(cache: Map<string, Remembered>, cwd: string, load: () => Promise<Listing>): Promise<Listing> {
    const key = resolve(cwd);
    const cached = cache.get(key);
    cache.delete(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        cache.set(key, cached);
        return cached.listing;
    }
    const entry: Remembered = { listing: load(), at: Date.now() };
    cache.set(key, entry);
    entry.listing.catch(() => {
        if (cache.get(key) === entry) {
            cache.delete(key);
        }
    });
    for (const oldest of cache.keys()) {
        if (cache.size <= CACHE_MAX_FOLDERS) {
            break;
        }
        cache.delete(oldest);
    }
    return entry.listing;
}

const TRACKED_ARGS = ['--cached', '--others', '--exclude-standard'];

/*
 * The files of the repositories inside `cwd` (submodules, repositories beside the folder's own), under
 * the folder they sit in. Git lists a submodule as one entry and cannot list `--others` across one, so
 * each repository is asked on its own; the entry that stood for it goes.
 */
async function filesOfInnerRepos(cwd: string, own: string[]): Promise<string[]> {
    const root = resolve(cwd);
    let repos: string[];
    try {
        repos = (await cachedRepos(root)).repos.map((repo) => resolve(repo.path)).filter((path) => path !== root && isUnder(path, root));
    } catch {
        return own;
    }
    if (repos.length === 0) {
        return own;
    }
    const prefixes = repos.map((path) => toPosix(relative(root, path)));
    const files = new Set(own.filter((file) => !prefixes.includes(file.replace(/\/$/, ''))));
    const lists = await Promise.all(repos.map((path) => gitLsFiles(path, TRACKED_ARGS)));
    lists.forEach((list, index) => list?.forEach((file) => files.add(`${prefixes[index]}/${file}`)));
    return [...files];
}

/* The files a search of this folder walks: what git tracks, in its own repository and the ones inside it, or the walk that stands in for it. */
export function listSearchableFiles(cwd: string): Promise<Listing> {
    return remembered(trackedCache, cwd, async () => {
        const fromGit = await gitLsFiles(cwd, TRACKED_ARGS);
        return fromGit ? { files: await filesOfInnerRepos(cwd, fromGit), truncated: false } : await walk(cwd);
    });
}

/*
 * What .gitignore keeps out but a person may still want to mention, a `.env.local` or a generated
 * report. Dot names and build output stay out the way a plain walk leaves them out; git collapses
 * an ignored directory to one entry, so `node_modules` costs nothing to skip.
 */
function listIgnoredFiles(cwd: string): Promise<Listing> {
    return remembered(ignoredCache, cwd, async () => {
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
}

/*
 * `fs.grep` keeps to `listSearchableFiles`: a match inside an ignored file is noise, naming one is not.
 * No name of the machine's own state is handed out: every listed name is judged before the ranking,
 * and the ones that make the list once more on where they lead now.
 */
export async function searchFiles(cwd: string, query: string, limit = 20, policy: MachineHomePolicy = NO_MACHINE_HOME): Promise<FsSearchResult> {
    const root = await searchRoot(cwd, policy);
    const [tracked, ignored] = await Promise.all([listSearchableFiles(root.cwd), listIgnoredFiles(root.cwd)]);
    const open = (paths: string[]): string[] => paths.filter((path) => isOpenName(root, path));
    const files: string[] = [];
    const wanted = Math.min(limit, FS_SEARCH_MAX_RESULTS);
    // A path that no longer passes gives way to the next match, without sorting every match for an eight-row picker.
    for (const { path } of inOrder(scoreFiles(open(tracked.files), query.trim(), open(ignored.files)), compareFiles)) {
        if (files.length >= wanted) {
            break;
        }
        if (await isOpenPath(root, path)) {
            files.push(path);
        }
    }
    return { files, truncated: tracked.truncated || ignored.truncated };
}

/*
 * Drops what the last search saw of the folders a change touched: every folder that holds a changed
 * directory, and every folder inside one, since a move above a folder changes what it lists too.
 * Without `changed`, everything goes.
 */
export function forgetSearchCache(changed?: readonly string[]): void {
    if (changed === undefined) {
        trackedCache.clear();
        ignoredCache.clear();
        return;
    }
    const paths = changed.map((path) => resolve(path));
    for (const cache of [trackedCache, ignoredCache]) {
        for (const key of [...cache.keys()]) {
            if (paths.some((path) => isUnder(path, key) || isUnder(key, path))) {
                cache.delete(key);
            }
        }
    }
}
