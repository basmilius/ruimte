import { globMatch } from './glob.ts';
import type { FileSystemWatcher } from './protocol.ts';
import { fileUriToPath } from './uris.ts';

/* A change of a file as the protocol numbers it: created, changed, deleted. */
export type FileChangeType = 1 | 2 | 3;

/* Folders whose files a server hears about only when a pattern of its own names the folder. */
const SPARING_FOLDERS = ['node_modules', 'vendor', '.git'];

function relativeTo(root: string, path: string): string | null {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/* A pattern with the folder it is relative to, or null for a relative pattern whose base is no folder of this machine. `base` is undefined for a string pattern. */
function patternOf(watcher: FileSystemWatcher): { base: string | undefined; pattern: string } | null {
    const { globPattern } = watcher;
    if (typeof globPattern === 'string') {
        return { base: undefined, pattern: globPattern };
    }
    const base = fileUriToPath(typeof globPattern.baseUri === 'string' ? globPattern.baseUri : globPattern.baseUri.uri);
    return base === null ? null : { base, pattern: globPattern.pattern };
}

/*
 * Whether a server asked to hear about this change. A string pattern is relative to the project folder
 * (or absolute), a relative pattern to its own base. A path inside `node_modules`, `vendor` or `.git` only
 * matches a pattern that names that folder, since `**` over a dependency tree is what a server never means.
 */
export function watchesFile(watchers: readonly FileSystemWatcher[], root: string, path: string, type: FileChangeType): boolean {
    const inProject = relativeTo(root, path);
    const segments = (inProject ?? path).split('/');
    return watchers.some((watcher) => {
        if (((watcher.kind ?? 7) & (1 << (type - 1))) === 0) {
            return false;
        }
        const parts = patternOf(watcher);
        if (parts === null) {
            return false;
        }
        const { base, pattern } = parts;
        const subject = pattern.startsWith('/') ? path : base === undefined ? inProject : relativeTo(base, path);
        if (subject === null || !globMatch(subject, pattern)) {
            return false;
        }
        return SPARING_FOLDERS.every((folder) => !segments.includes(folder) || pattern.includes(folder));
    });
}
