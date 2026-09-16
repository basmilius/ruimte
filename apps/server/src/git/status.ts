import type { GitFile, GitStatus } from '@ruimte/contracts';
import { parseNumstat, type Numstat } from './diff.ts';
import { git, runGit } from './run.ts';

// A list past this is one nobody reads, and a status that carries it is one nobody wants on the wire.
const MAX_FILES = 1000;
// Every untracked file costs a `--no-index` diff of its own, so only the first ones get real counts.
const MAX_UNTRACKED_COUNTS = 100;
// How many of those run at once: enough to hide the process start, few enough to leave the machine alone.
const COUNT_CONCURRENCY = 8;
// The base branch of a repository moves about as often as its remote does.
const BASE_TTL_MS = 5 * 60 * 1000;

const EMPTY: GitStatus = {
    repo: false,
    root: null,
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    base: null,
    mergeBase: null,
    files: [],
    truncated: false,
    live: true
};

export interface PorcelainEntry {
    path: string;
    oldPath?: string;
    /* The porcelain letter for the index side, `.` when the index holds what HEAD holds. */
    index: string;
    /* The same for the working tree side. */
    worktree: string;
    unmerged: boolean;
    untracked: boolean;
}

export interface PorcelainStatus {
    branch: string | null;
    detached: boolean;
    upstream: string | null;
    ahead: number;
    behind: number;
    entries: PorcelainEntry[];
}

const count = (field: string | undefined): number => {
    const parsed = Number.parseInt(field ?? '', 10);
    return Number.isNaN(parsed) ? 0 : Math.abs(parsed);
};

/*
 * `status --porcelain=v2 --branch -z`: header lines start with `#`, an ordinary change with `1`, a
 * rename with `2`, an unmerged file with `u` and an untracked one with `?`. Every record is NUL
 * terminated, and a rename writes the path it came from as the record right after its own, which is
 * why this walks the records with an index instead of a for-of.
 */
export const parsePorcelain = (output: string): PorcelainStatus => {
    const records = output.split('\0');
    const status: PorcelainStatus = { branch: null, detached: false, upstream: null, ahead: 0, behind: 0, entries: [] };
    for (let i = 0; i < records.length; i += 1) {
        const record = records[i];
        if (record === undefined || record === '') {
            continue;
        }
        if (record.startsWith('# branch.head ')) {
            const head = record.slice('# branch.head '.length);
            status.detached = head === '(detached)';
            status.branch = status.detached ? null : head;
        } else if (record.startsWith('# branch.upstream ')) {
            status.upstream = record.slice('# branch.upstream '.length);
        } else if (record.startsWith('# branch.ab ')) {
            const [ahead, behind] = record.slice('# branch.ab '.length).split(' ');
            status.ahead = count(ahead);
            status.behind = count(behind);
        } else if (record.startsWith('1 ')) {
            const fields = record.split(' ');
            const xy = fields[1] ?? '..';
            status.entries.push({ path: fields.slice(8).join(' '), index: xy[0] ?? '.', worktree: xy[1] ?? '.', unmerged: false, untracked: false });
        } else if (record.startsWith('2 ')) {
            const fields = record.split(' ');
            const xy = fields[1] ?? '..';
            const entry: PorcelainEntry = {
                path: fields.slice(9).join(' '),
                index: xy[0] ?? '.',
                worktree: xy[1] ?? '.',
                unmerged: false,
                untracked: false
            };
            i += 1;
            entry.oldPath = records[i] ?? '';
            status.entries.push(entry);
        } else if (record.startsWith('u ')) {
            const fields = record.split(' ');
            const xy = fields[1] ?? '??';
            status.entries.push({ path: fields.slice(10).join(' '), index: xy[0] ?? 'U', worktree: xy[1] ?? 'U', unmerged: true, untracked: false });
        } else if (record.startsWith('? ')) {
            status.entries.push({ path: record.slice(2), index: '?', worktree: '?', unmerged: false, untracked: true });
        }
    }
    return status;
};

const byPath = (output: string | null): Map<string, Numstat> => {
    const counts = new Map<string, Numstat>();
    for (const entry of parseNumstat(output ?? '')) {
        counts.set(entry.path, entry);
    }
    return counts;
};

/* What an untracked file would add: it has no history, so it is the whole file against `/dev/null`. */
const untrackedCounts = async (root: string, paths: string[]): Promise<Map<string, Numstat>> => {
    const counts = new Map<string, Numstat>();
    for (let i = 0; i < paths.length; i += COUNT_CONCURRENCY) {
        const batch = paths.slice(i, i + COUNT_CONCURRENCY);
        const results = await Promise.all(
            batch.map(async (path) => {
                // `--no-index` answers 1 when the two sides differ, which is what every file here does.
                const { code, stdout } = await runGit(['diff', '--numstat', '-z', '--no-index', '/dev/null', path], root);
                return code > 1 ? null : (parseNumstat(stdout)[0] ?? null);
            })
        );
        for (let index = 0; index < batch.length; index += 1) {
            const stat = results[index];
            if (stat) {
                counts.set(batch[index]!, stat);
            }
        }
    }
    return counts;
};

const baseCache = new Map<string, { base: string | null; at: number }>();

// The remote's own default branch first, then the names a repository without a remote uses.
const BASE_CANDIDATES: ReadonlyArray<{ ref: string; name: string }> = [
    { ref: 'refs/remotes/origin/main', name: 'origin/main' },
    { ref: 'refs/remotes/origin/master', name: 'origin/master' },
    { ref: 'refs/heads/main', name: 'main' },
    { ref: 'refs/heads/master', name: 'master' }
];

/* The branch this repository's work is measured against, remembered per repository for a while. */
export const resolveBase = async (root: string, now: number = Date.now()): Promise<string | null> => {
    const cached = baseCache.get(root);
    if (cached && now - cached.at < BASE_TTL_MS) {
        return cached.base;
    }
    let base: string | null = (await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root))?.trim() || null;
    if (base === null) {
        for (const candidate of BASE_CANDIDATES) {
            if ((await git(['rev-parse', '--verify', '--quiet', candidate.ref], root))?.trim()) {
                base = candidate.name;
                break;
            }
        }
    }
    baseCache.set(root, { base, at: now });
    return base;
};

/* Where this branch left the base branch, which is what the base scope of a diff starts from. */
export const mergeBaseOf = async (cwd: string): Promise<string | null> => {
    const base = await resolveBase(cwd);
    return base === null ? null : (await git(['merge-base', base, 'HEAD'], cwd))?.trim() || null;
};

/*
 * The merge base the base scope starts from when a ref is named, such as the branch a worktree was
 * made from; a ref that no longer resolves falls back to the repository's base branch.
 */
export const mergeBaseWith = async (cwd: string, ref: string | undefined): Promise<string | null> => {
    if (ref !== undefined) {
        const named = (await git(['merge-base', ref, 'HEAD'], cwd))?.trim();
        if (named) {
            return named;
        }
    }
    return await mergeBaseOf(cwd);
};

/* Only for the tests, which make a repository per case and would otherwise read the one before it. */
export const forgetBase = (): void => {
    baseCache.clear();
};

const fileOf = (entry: PorcelainEntry, state: GitFile['state'], status: string, stat: Numstat | undefined): GitFile => ({
    path: entry.path,
    ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
    state,
    status,
    added: stat?.added ?? 0,
    deleted: stat?.deleted ?? 0,
    binary: stat?.binary ?? false
});

/*
 * What the git panel draws: the branch and how far it is from its upstream and from the base
 * branch, and every changed file in the group it belongs to. A file that is staged and changed
 * again since is in two groups, with the counts of that side in each, which is what makes staging
 * one half of a file's changes readable. Renames keep the path they came from.
 */
export const readStatus = async (cwd: string): Promise<GitStatus> => {
    const root = (await git(['rev-parse', '--show-toplevel'], cwd))?.trim() || null;
    if (root === null) {
        return EMPTY;
    }
    const porcelain = await git(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], root);
    if (porcelain === null) {
        return EMPTY;
    }
    const parsed = parsePorcelain(porcelain);
    const entries = parsed.entries.slice(0, MAX_FILES);
    const [staged, unstaged, base] = await Promise.all([
        git(['diff', '--cached', '--numstat', '-z'], root).then(byPath),
        git(['diff', '--numstat', '-z'], root).then(byPath),
        resolveBase(root)
    ]);
    const untracked = await untrackedCounts(
        root,
        entries
            .filter((entry) => entry.untracked)
            .slice(0, MAX_UNTRACKED_COUNTS)
            .map((entry) => entry.path)
    );
    const files: GitFile[] = [];
    for (const entry of entries) {
        if (entry.untracked) {
            files.push(fileOf(entry, 'untracked', '?', untracked.get(entry.path)));
        } else if (entry.unmerged) {
            files.push(fileOf(entry, 'conflicted', `${entry.index}${entry.worktree}`, unstaged.get(entry.path)));
        } else {
            if (entry.index !== '.') {
                files.push(fileOf(entry, 'staged', entry.index, staged.get(entry.path)));
            }
            if (entry.worktree !== '.') {
                files.push(fileOf(entry, 'unstaged', entry.worktree, unstaged.get(entry.path)));
            }
        }
    }
    const mergeBase = base === null ? null : (await git(['merge-base', base, 'HEAD'], root))?.trim() || null;

    return {
        repo: true,
        root,
        branch: parsed.branch,
        detached: parsed.detached,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        base,
        mergeBase,
        files,
        truncated: parsed.entries.length > entries.length,
        // The watcher is what knows whether this repository still gets its updates by itself; it
        // overwrites the flag on its way out, and a status asked for by hand is live by definition.
        live: true
    };
};

const trackedCache = new Map<string, number>();

/* How many files the index holds, which is the size a status run has to walk every time. */
export const trackedFiles = async (root: string): Promise<number> => {
    const cached = trackedCache.get(root);
    if (cached !== undefined) {
        return cached;
    }
    const listed = await git(['ls-files', '-z'], root);
    const tracked = listed === null ? 0 : listed.split('\0').filter((path) => path !== '').length;
    trackedCache.set(root, tracked);
    return tracked;
};
