import type { GitStatus, GitStatusEntry } from '@pierre/trees';
import type { FsEntry, GitFile } from '@ruimte/contracts';

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

/* A path that names its own root, on either kind of machine: a leading separator, or a drive letter. */
export const isAbsolutePath = (path: string): boolean => /^[\\/]/.test(path) || /^[a-zA-Z]:[\\/]/.test(path);

/*
 * A path the way a file node or a file view stores it, so the project file says the same thing in
 * every checkout: relative to the project folder, POSIX. A file outside that folder keeps the
 * absolute path it has, which is what `relativeTo` hands back for a path it cannot shorten.
 */
export const storedPathOf = (folder: string | null, path: string): string => (folder === null ? path : relativeTo(folder, path));

/* The way back, to the path the daemon takes. Null for a stored path with no folder to resolve it
   against, which is a project without one. */
export const resolveStoredPath = (folder: string | null, path: string): string | null => {
    if (isAbsolutePath(path)) {
        return path;
    }
    return folder === null ? null : absoluteOf(folder, path);
};

/* A path the files panel can bring into view is one inside the folder that panel lists; a worktree
   or another checkout on the same machine is not. */
export const revealableInFiles = (folder: string | null, path: string): boolean =>
    folder !== null && (path === folder || path.startsWith(`${folder}/`) || path.startsWith(`${folder}\\`));

/* The tree marks a directory with a trailing slash, on a row and in a git status entry alike. */
export const isDirectoryPath = (treePath: string): boolean => treePath.endsWith('/');

/* The last segment of a path, whichever separator the daemon's machine uses. */
export const basenameOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/* The folder a path sits in, which is what `fs.changed` names when something in it moves. */
export const dirnameOf = (path: string): string => {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return cut > 0 ? path.slice(0, cut) : path.slice(0, cut + 1);
};

/* Every directory on the way to a row, outermost first, the way the tree names one. */
export const ancestorDirsOf = (treePath: string): string[] => {
    const segments = treePath.split('/').filter((segment) => segment !== '');
    segments.pop();
    const dirs: string[] = [];
    let prefix = '';
    for (const segment of segments) {
        prefix = `${prefix}${segment}/`;
        dirs.push(prefix);
    }
    return dirs;
};

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

/*
 * What is open after the tree reported itself: the directories it says are open, plus the ones it
 * has not heard of yet. A directory remembered from the last visit is not in the tree until its
 * parent has been listed, and dropping it there would collapse it the moment the listing arrives.
 */
export const mergeExpanded = (remembered: ReadonlySet<string>, reported: ReadonlySet<string>, known: ReadonlySet<string>): Set<string> => {
    const merged = new Set(reported);
    for (const path of remembered) {
        if (!known.has(path)) {
            merged.add(path);
        }
    }
    return merged;
};

export interface SortRow {
    isDirectory: boolean;
    /* The path split on separators; `src/index.ts` is two segments, the directory `src/` is one. */
    segments: readonly string[];
}

/*
 * Directories first, then names the way a person reads numbers, which is the daemon's own order.
 *
 * The tree sorts one flat list of whole paths, and a directory only appears in it when it is empty
 * or unloaded: `src/index.ts` is the only row that says `src` exists. So the two rows are compared
 * segment by segment, and the first segment they differ on is the one that decides, a directory
 * before a file. Comparing the last segment alone would put `src/index.ts` wherever `index.ts`
 * happens to fall, which is how directories ended up mixed in among the files.
 */
export const compareRows = (left: SortRow, right: SortRow): number => {
    const shared = Math.min(left.segments.length, right.segments.length);
    for (let i = 0; i < shared; i++) {
        const leftSegment = left.segments[i]!;
        const rightSegment = right.segments[i]!;
        if (leftSegment === rightSegment) {
            continue;
        }
        const leftIsDirectory = left.isDirectory || i < left.segments.length - 1;
        const rightIsDirectory = right.isDirectory || i < right.segments.length - 1;
        if (leftIsDirectory !== rightIsDirectory) {
            return leftIsDirectory ? -1 : 1;
        }
        // Case is not a reason to split two names apart; the raw compare only breaks a tie.
        return leftSegment.localeCompare(rightSegment, undefined, { numeric: true, sensitivity: 'base' }) || leftSegment.localeCompare(rightSegment);
    }
    // One path is the head of the other, so the shorter one is the directory the longer one sits in.
    return left.segments.length - right.segments.length;
};

/*
 * A porcelain letter as the tree names the same thing. The tree knows five states and git writes
 * more than five letters, so a type change, a copy and a conflict all read as a modification: the
 * dot says the file differs from HEAD, and the git panel next to it says how.
 */
export const treeGitStatus = (status: string): GitStatus => {
    if (status.startsWith('?')) {
        return 'untracked';
    }
    if (status.startsWith('A')) {
        return 'added';
    }
    if (status.startsWith('D')) {
        return 'deleted';
    }
    if (status.startsWith('R')) {
        return 'renamed';
    }
    return 'modified';
};

/*
 * What git says about the checkout, in the rows the tree marks. Paths come from the repository
 * root and the tree counts from the open folder, so a change above the folder (a repository the
 * project is a subdirectory of) has no row here and is left out. The tree marks the directories
 * on the way itself, from these entries.
 */
export const gitStatusEntries = (folder: string, root: string | null, files: readonly GitFile[]): GitStatusEntry[] => {
    if (root === null) {
        return [];
    }
    const entries: GitStatusEntry[] = [];
    for (const file of files) {
        const absolute = absoluteOf(root, file.path);
        const treePath = relativeTo(folder, absolute);
        // What `relativeTo` cannot make relative it hands back whole, and that is a path above the folder.
        if (treePath === absolute) {
            continue;
        }
        entries.push({ path: treePath, status: treeGitStatus(file.status) });
    }
    return entries;
};
