import type { FsEntry } from '@ruimte/contracts';

/* A directory whose children have not arrived yet gets one child nobody sees, so the row keeps the
   chevron that lets a person expand it. The rule that hides the row lives in `TREE_CSS`. */
export const LOADING_NAME = '.ruimte-loading';

/* What the daemon answered per directory, keyed by the directory's absolute path. */
export type EntryCache = ReadonlyMap<string, readonly FsEntry[]>;

export interface TreeInput {
    /* Every row the tree shows, POSIX and relative to the folder. */
    paths: string[];
    /* The paths of the entries git ignores, in the shape the tree's git lane matches on. */
    ignored: string[];
}

// The daemon may speak Windows paths; the tree speaks POSIX. A path that starts with a drive letter
// or a backslash is the only case where the separator is not a slash.
const separatorOf = (root: string): string => (/^[a-zA-Z]:\\|^\\\\/.test(root) ? '\\' : '/');

const withoutTrailingSeparator = (path: string): string => (path.endsWith('/') || path.endsWith('\\') ? path.slice(0, -1) : path);

/* An absolute path from the daemon as the tree knows it: POSIX and relative to the folder. */
export const relativeTo = (root: string, path: string): string => {
    const base = withoutTrailingSeparator(root);
    const relative = path.startsWith(base) ? path.slice(base.length + 1) : path;
    return relative.split('\\').join('/');
};

/* The way back, so a row can be revealed, copied or opened on the daemon's machine. */
export const absoluteOf = (root: string, treePath: string): string => {
    const separator = separatorOf(root);
    const relative = withoutTrailingSeparator(treePath).split('/').join(separator);
    return relative === '' ? withoutTrailingSeparator(root) : `${withoutTrailingSeparator(root)}${separator}${relative}`;
};

/* The tree marks a directory with a trailing slash, on a row and in a git status entry alike. */
export const isDirectoryPath = (treePath: string): boolean => treePath.endsWith('/');

/* The last segment of a path, whichever separator the daemon's machine uses. */
export const basenameOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

export const treePathOf = (root: string, entry: FsEntry): string => {
    const relative = relativeTo(root, entry.path);
    return entry.kind === 'directory' ? `${relative}/` : relative;
};

/*
 * The whole model in one pass over the cache. A directory that has been listed contributes its
 * children, an empty one contributes itself with a trailing slash (which is how the tree hears
 * about a directory with nothing in it), and one that has not been listed contributes the
 * placeholder that keeps its chevron. Hidden entries are filtered here, so the eye button rebuilds
 * from what is already loaded instead of asking the daemon again.
 */
export const buildTreeInput = (root: string, cache: EntryCache, showHidden: boolean): TreeInput => {
    const paths: string[] = [];
    const ignored: string[] = [];
    const visible = (entries: readonly FsEntry[]): readonly FsEntry[] => (showHidden ? entries : entries.filter((entry) => !entry.hidden));
    const walk = (dir: string): void => {
        for (const entry of visible(cache.get(dir) ?? [])) {
            const path = treePathOf(root, entry);
            if (entry.ignored) {
                ignored.push(path);
            }
            if (entry.kind !== 'directory') {
                paths.push(path);
                continue;
            }
            const children = cache.get(entry.path);
            if (children === undefined) {
                paths.push(`${path}${LOADING_NAME}`);
            } else if (visible(children).length === 0) {
                paths.push(path);
            } else {
                walk(entry.path);
            }
        }
    };
    walk(root);
    return { paths, ignored };
};

/* The directories that opened since the last snapshot. The tree has no expand event, so the panel
   diffs what it knows against what the model says and loads the difference. */
export const newlyExpanded = (before: ReadonlySet<string>, after: ReadonlySet<string>): string[] => [...after].filter((path) => !before.has(path));

/* Directories first, then names the way a person reads numbers, which is the daemon's own order. */
export const compareRows = (left: { basename: string; isDirectory: boolean }, right: { basename: string; isDirectory: boolean }): number => {
    const rank = (row: { isDirectory: boolean }): number => (row.isDirectory ? 0 : 1);
    return rank(left) - rank(right) || left.basename.localeCompare(right.basename, undefined, { numeric: true });
};
