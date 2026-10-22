import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, posix, resolve, sep } from 'node:path';
import { FS_LOCATE_MAX_MATCHES, type FsLocatePayload, type FsLocateResult, type GitReposResult } from '@ruimte/contracts';
import { cachedRepos } from '../git/repo-cache.ts';
import { isMachineStatePath, NO_MACHINE_HOME, type MachineHomePolicy } from './machine-home.ts';

export interface LocateDeps {
    repos: (folder: string) => Promise<GitReposResult>;
    policy: MachineHomePolicy;
    /* The files of a folder relative to it, with `/` between segments; without it no link is looked for by the end of its path. */
    list?: (folder: string) => Promise<readonly string[]>;
}

const REAL_DEPS: LocateDeps = { repos: (folder) => cachedRepos(folder), policy: NO_MACHINE_HOME };

async function reposOf(deps: LocateDeps, folder: string): Promise<string[]> {
    try {
        return (await deps.repos(folder)).repos.map((repo) => repo.path);
    } catch {
        return [];
    }
}

/* Judged on the path and on where it really leads, so a link to the machine's own state does not even say that state is there. */
async function isOpenKind(policy: MachineHomePolicy, path: string, directory: boolean): Promise<boolean> {
    if (isMachineStatePath(policy, path)) {
        return false;
    }
    try {
        const real = await realpath(path);
        if (isMachineStatePath(policy, real)) {
            return false;
        }
        const found = await stat(real);
        return directory ? found.isDirectory() : found.isFile();
    } catch {
        return false;
    }
}

/*
 * An agent writes a path from wherever it stands: its own folder, the root of a submodule it went into,
 * or the checkout a worktree was cut from. The agent's own folder wins outright; only when the path is
 * not there are the other folders tried, and every one that holds it is an answer. When none does, a
 * path that names only the file's last segments is looked for in the listing.
 */
export async function locateFile(payload: FsLocatePayload, deps: LocateDeps = REAL_DEPS): Promise<FsLocateResult> {
    const directory = payload.directory === true;
    const open = (path: string): Promise<boolean> => isOpenKind(deps.policy, path, directory);
    if (isAbsolute(payload.path)) {
        const path = resolve(payload.path);
        return { matches: (await open(path)) ? [path] : [] };
    }
    const own = resolve(payload.cwd, payload.path);
    if (await open(own)) {
        return { matches: [own] };
    }
    const bases = [...(await reposOf(deps, payload.cwd))];
    if (payload.folder !== undefined && resolve(payload.folder) !== resolve(payload.cwd)) {
        bases.push(resolve(payload.folder), ...(await reposOf(deps, payload.folder)));
    }
    const matches: string[] = [];
    for (const path of new Set(bases.map((base) => resolve(base, payload.path)))) {
        if (path !== own && (await open(path))) {
            matches.push(path);
            if (matches.length >= FS_LOCATE_MAX_MATCHES) {
                break;
            }
        }
    }
    if (matches.length > 0 || directory || deps.list === undefined) {
        return { matches };
    }
    return { matches: await filesEndingIn(payload, deps.list, open) };
}

/* The path as the end of a listed one, or null for a path that climbs out of wherever it would end. */
function trailingPath(path: string): string | null {
    const normalized = posix.normalize(path.replaceAll(sep, '/'));
    return normalized === '..' || normalized.startsWith('../') || normalized === '.' ? null : normalized;
}

/*
 * A bare name, or a path from a folder below the root, is looked for at the end of every listed file.
 * The shortest comes first, so of `index.ts` the one nearest the root heads the choice.
 */
async function filesEndingIn(payload: FsLocatePayload, list: NonNullable<LocateDeps['list']>, open: (path: string) => Promise<boolean>): Promise<string[]> {
    const wanted = trailingPath(payload.path);
    if (wanted === null) {
        return [];
    }
    const folders = new Set([payload.cwd, ...(payload.folder === undefined ? [] : [payload.folder])].map((folder) => resolve(folder)));
    const found = new Set<string>();
    for (const folder of folders) {
        for (const listed of await list(folder).catch(() => [])) {
            if (listed === wanted || listed.endsWith(`/${wanted}`)) {
                found.add(join(folder, listed));
            }
        }
    }
    const matches: string[] = [];
    for (const path of [...found].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
        if (await open(path)) {
            matches.push(path);
            if (matches.length >= FS_LOCATE_MAX_MATCHES) {
                break;
            }
        }
    }
    return matches;
}
