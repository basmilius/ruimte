import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import type { GitRepo, GitReposResult } from '@ruimte/contracts';
import { ignoredPaths } from './ignore.ts';
import { git } from './run.ts';

/*
 * How deep the scan looks for a repository beside the project's own. One level covers a folder full of
 * checkouts, which is what this is for; a second costs a readdir per folder on this one and only pays
 * off for a `packages/*` layout. Submodules never go through the scan, so their depth is git's.
 */
export const REPO_SCAN_DEPTH = 1;

// Past this the panel draws more sections than anybody reads, and every one of them costs a status run.
export const MAX_REPOS = 24;

// Folders the scan never enters: they hold dependencies or build output, never a checkout a person works in.
const SKIPPED = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'coverage', 'Pods']);

/* What the panel calls a repository: its path under the project folder, or its own name when the
   folder sits inside it instead of the other way round. */
export const repoLabel = (folder: string, path: string): string => {
    const within = relative(folder, path);
    return within === '' || within.startsWith('..') ? basename(path) : within;
};

/*
 * `submodule status --recursive` writes a line per submodule: a state character, the commit, the path
 * relative to the repository it ran in, and what that commit describes as. A `-` in front means the
 * submodule was never initialized, so there is no checkout to read.
 */
export const parseSubmodulePaths = (output: string): string[] => {
    const paths: string[] = [];
    for (const line of output.split('\n')) {
        if (line === '' || line.startsWith('-')) {
            continue;
        }
        const match = /^.[0-9a-f]+ (.+?)(?: \([^)]*\))?$/.exec(line);
        if (match?.[1]) {
            paths.push(match[1]);
        }
    }
    return paths;
};

/* The folder's own repository first, then the rest by the name a person reads. */
const inOrder = (repos: readonly GitRepo[]): GitRepo[] =>
    [...repos].sort((left, right) => {
        if ((left.kind === 'root') !== (right.kind === 'root')) {
            return left.kind === 'root' ? -1 : 1;
        }
        return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
    });

/* Whether a folder is a checkout. A submodule and a linked worktree carry `.git` as a file rather
   than a directory, and both are one. */
const isCheckout = async (dir: string): Promise<boolean> => {
    try {
        await stat(join(dir, '.git'));
        return true;
    } catch {
        return false;
    }
};

/*
 * The repositories sitting in a folder, however the folder itself is arranged. A folder that is a
 * checkout is not walked into: what lies inside it is that repository's own business, and its
 * submodules come from git rather than from a scan.
 */
const scan = async (folder: string, dir: string, depth: number, found: Set<string>): Promise<void> => {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    const candidates = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED.has(entry.name))
        .map((entry) => join(dir, entry.name));
    // Outside a repository nothing is ignored, which is the answer `check-ignore` gives there anyway.
    const ignored = await ignoredPaths(candidates, folder);
    for (const path of candidates) {
        if (ignored.has(path)) {
            continue;
        }
        if (await isCheckout(path)) {
            found.add(path);
        } else if (depth > 1) {
            await scan(folder, path, depth - 1, found);
        }
    }
};

/* Whether a path sits inside the project folder, which every repository but the root has to. */
const isInside = (folder: string, path: string): boolean => {
    const within = relative(folder, path);
    return within !== '' && !within.startsWith('..');
};

/*
 * The initialized submodules of these checkouts, however deep they nest. Git is asked before the scan
 * runs, because a submodule is a checkout the scan would find too and only git can say it is one.
 */
const addSubmodules = async (folder: string, checkouts: readonly string[], add: (path: string, kind: GitRepo['kind']) => void): Promise<void> => {
    const lists = await Promise.all(
        checkouts.map(async (checkout) => {
            const output = await git(['submodule', 'status', '--recursive'], checkout);
            return parseSubmodulePaths(output ?? '').map((path) => join(checkout, path));
        })
    );
    for (const path of lists.flat()) {
        if (isInside(folder, path) && (await isCheckout(path))) {
            add(path, 'submodule');
        }
    }
};

/*
 * Every checkout the git panel can draw for a project folder: the repository the folder itself is in,
 * every initialized submodule under it, and every repository sitting beside it in the folder. A
 * folder that is no repository at all still has the ones below it, which is what a folder full of
 * apps is. Only the root may lie above the project folder; everything else has to sit inside it, so
 * a project that is one corner of a large repository does not inherit that repository's submodules.
 */
export const listRepos = async (folder: string): Promise<GitReposResult> => {
    const root = (await git(['rev-parse', '--show-toplevel'], folder))?.trim() || null;
    const repos: GitRepo[] = [];
    const known = new Set<string>();

    const add = (path: string, kind: GitRepo['kind']): void => {
        if (!known.has(path)) {
            known.add(path);
            repos.push({ path, label: repoLabel(folder, path), kind });
        }
    };

    if (root !== null) {
        add(root, 'root');
        await addSubmodules(folder, [root], add);
    }

    const scanned = new Set<string>();
    await scan(folder, folder, REPO_SCAN_DEPTH, scanned);
    const nested = [...scanned].filter((path) => !known.has(path));
    for (const path of nested) {
        add(path, 'nested');
    }
    await addSubmodules(folder, nested, add);

    const ordered = inOrder(repos);
    return { repos: ordered.slice(0, MAX_REPOS), truncated: ordered.length > MAX_REPOS };
};
