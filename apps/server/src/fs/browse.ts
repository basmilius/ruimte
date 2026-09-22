import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { FsBrowseResult } from '@ruimte/contracts';
import { PROJECT_DIR, PROJECT_FILE } from '../projects/project-files.ts';
import { classifyEntry } from './visibility.ts';
import { CodedError } from '../coded-error.ts';

type BrowseErrorCode = 'cwd-required' | 'windows-path';

export class BrowseError extends CodedError<BrowseErrorCode> {}

interface BrowseOptions {
    home?: string;
    platform?: NodeJS.Platform;
    /* Whether dot-folders come along even when the typed prefix does not start with a dot. */
    hidden?: boolean;
}

/* Without a repository to ask, a name is all there is to go on, which is what `browse` has. */
const visible = (name: string, showHidden: boolean): boolean => {
    const visibility = classifyEntry(name);
    return visibility !== 'never' && (showHidden || visibility === 'always');
};

const endsWithSeparator = (path: string): boolean => path.endsWith('/') || path.endsWith('\\');

const looksWindows = (path: string): boolean => /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\');

/* `~` becomes the home directory; a relative path counts from `cwd`; anything else is taken as is. */
export const resolveBrowsePath = (partialPath: string, cwd: string | undefined, options: BrowseOptions = {}): string => {
    const home = options.home ?? homedir();
    const platform = options.platform ?? process.platform;
    const trimmed = partialPath.trim();
    if (platform !== 'win32' && looksWindows(trimmed)) {
        throw new BrowseError('windows-path', 'That is a Windows path. This machine does not run Windows.');
    }
    if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
        return join(home, trimmed.slice(1));
    }
    if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed === '.' || trimmed === '..') {
        if (!cwd) {
            throw new BrowseError('cwd-required', 'A relative path needs an open project to count from');
        }
        return resolve(cwd, trimmed);
    }
    return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd ?? home, trimmed);
};

/*
 * Directories that complete what was typed. A path ending in a separator lists that directory;
 * otherwise the last segment filters its parent by prefix. Dot-folders and build output stay
 * hidden unless the prefix itself starts with a dot or the caller asks for them, and OS rubbish
 * stays out either way; git is never asked here, since this answers a keystroke. A directory that
 * cannot be read lists as empty, not as an error, and `exists` is what tells that apart from one
 * that is not there.
 */
export const browseDirectories = async (partialPath: string, cwd: string | undefined, options: BrowseOptions = {}): Promise<FsBrowseResult> => {
    const trimmed = partialPath.trim();
    const target = resolveBrowsePath(trimmed, cwd, options);
    const wholeDirectory = endsWithSeparator(trimmed) || trimmed === '~' || trimmed === '.' || trimmed === '..';
    const parentPath = wholeDirectory ? target : dirname(target);
    const prefix = wholeDirectory ? '' : basename(target).toLowerCase();
    let names: Array<{ name: string; isDirectory: boolean }>;
    try {
        names = (await readdir(parentPath, { withFileTypes: true })).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
    } catch {
        return { parentPath: trimTrailing(parentPath), entries: [], exists: await isDirectory(parentPath) };
    }
    const showHidden = options.hidden === true || prefix.startsWith('.');
    const matches = names
        .filter((entry) => entry.isDirectory && entry.name.toLowerCase().startsWith(prefix) && visible(entry.name, showHidden))
        .sort((a, b) => a.name.localeCompare(b.name));
    const entries = await Promise.all(
        matches.map(async (entry) => {
            const fullPath = join(parentPath, entry.name);
            return { name: entry.name, fullPath, hasCanvas: await exists(join(fullPath, PROJECT_DIR, PROJECT_FILE)) };
        })
    );
    return { parentPath: trimTrailing(parentPath), entries, exists: true };
};

/* A separator on the end says "list this", which the answer no longer means; the root keeps its. */
const trimTrailing = (path: string): string => (path.endsWith(sep) && path.length > 1 ? path.slice(0, -1) : path);

const exists = async (path: string): Promise<boolean> => {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
};

const isDirectory = async (path: string): Promise<boolean> => {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        return false;
    }
};
