import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitIgnoredFilesResult } from '@ruimte/contracts';
import { nativePath } from './native-path.ts';
import { GitError, runGit } from './run.ts';

// More than a checkout keeps beside its code; a list past it is cut and says so.
const MAX_IGNORED_FILES = 2_000;

// The project's own state, which the daemon keeps out of git and never hands to another machine.
const RUIMTE_STATE = /(^|\/)\.ruimte\//;

const LIST = ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'];

/* The folders a rule of the checkout ignores themselves (`node_modules/`), of these; git answers 1 when it matched none. */
async function ignoredWhole(root: string, folders: readonly string[]): Promise<Set<string>> {
    if (folders.length === 0) {
        return new Set();
    }
    const checked = await runGit(['check-ignore', '-z', '--stdin'], root, { stdin: `${folders.join('\0')}\0` });
    if (checked.code !== 0 && checked.code !== 1) {
        throw new GitError('git-failed', checked.stderr.trim() || 'git check-ignore failed');
    }
    return new Set(checked.stdout.split('\0').filter((path) => path !== ''));
}

/*
 * The files in a folder git listed as ignored but that no rule ignores itself (a `config/` holding only
 * `dev.local.json`), one level at a time, leaving out a folder below it that a rule ignores whole.
 */
async function filesUnder(root: string, folder: string, room: number): Promise<string[]> {
    const found: string[] = [];
    let level = [folder];
    while (level.length > 0 && found.length < room) {
        const next: string[] = [];
        for (const current of level) {
            for (const entry of await readdir(join(root, current), { withFileTypes: true }).catch(() => [])) {
                const path = `${current}${entry.name}`;
                if (entry.isDirectory()) {
                    next.push(`${path}/`);
                } else {
                    found.push(path);
                }
            }
        }
        const whole = await ignoredWhole(root, next);
        level = next.filter((path) => !whole.has(path));
    }
    return found;
}

/*
 * The files git ignores in a checkout, the ones a clone elsewhere does not bring: `.env` files, local
 * settings, keys. A folder a rule ignores whole (`node_modules/`, `dist/`) is left out, since it is
 * built or installed rather than written. The paths are relative to the checkout's top level, so they
 * land in the same place in a clone of it.
 */
export async function listIgnoredFiles(cwd: string): Promise<GitIgnoredFilesResult> {
    const top = await runGit(['rev-parse', '--show-toplevel', '--show-prefix'], cwd);
    if (top.code !== 0) {
        throw new GitError('not-a-repo', `${cwd} is not in a git repository`);
    }
    const [printed = cwd, prefix = ''] = top.stdout.split('\n');
    const root = nativePath(printed);
    const listed = await runGit(LIST, root);
    if (listed.code !== 0) {
        throw new GitError('git-failed', listed.stderr.trim() || 'git ls-files failed');
    }
    const entries = listed.stdout.split('\0').filter((path) => path !== '');
    const folders = entries.filter((path) => path.endsWith('/'));
    const whole = await ignoredWhole(root, folders);
    const wholeFolders = [...whole];
    const inWhole = (path: string): boolean => wholeFolders.some((folder) => path.startsWith(folder));
    const paths = new Set(entries.filter((path) => !path.endsWith('/') && !inWhole(path) && !RUIMTE_STATE.test(path)));
    // Git lists a folder whose every file is ignored as the folder alone, whether or not a rule names it.
    for (const folder of folders.filter((path) => !inWhole(path) && !RUIMTE_STATE.test(path))) {
        if (paths.size > MAX_IGNORED_FILES) {
            break;
        }
        for (const path of await filesUnder(root, folder, MAX_IGNORED_FILES + 1 - paths.size)) {
            paths.add(path);
        }
    }
    const kept = [...paths].sort().slice(0, MAX_IGNORED_FILES);
    const files = await Promise.all(
        kept.map(async (path) => {
            const found = await lstat(join(root, path)).catch(() => null);
            if (found === null) {
                return null;
            }
            return found.isSymbolicLink() ? { path, size: found.size, link: true } : { path, size: found.size, link: false, mode: found.mode & 0o777 };
        })
    );
    return {
        root,
        prefix: prefix.replace(/\/$/, ''),
        files: files.filter((file) => file !== null),
        truncated: paths.size > kept.length
    };
}
