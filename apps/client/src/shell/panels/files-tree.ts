import type { GitStatus, GitStatusEntry } from '@pierre/trees';
import { FileTree } from '@adecore/ui';
import { absoluteOf, isAbsolutePath, relativeTo, resolveStoredPath, storedPathOf, type FsEntry, type GitFile } from '@ruimte/contracts';
import { chipText } from '@adecore/agents-react/chat/mentions';

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

export { absoluteOf, isAbsolutePath, relativeTo, resolveStoredPath, storedPathOf };

/* A path the files panel can bring into view is one inside the folder that panel lists; a worktree
   or another checkout on the same machine is not. */
export function revealableInFiles(folder: string | null, path: string): boolean {
    return folder !== null && (path === folder || path.startsWith(`${folder}/`) || path.startsWith(`${folder}\\`));
}

/*
 * A path as the chat mention the composer writes for a row dragged out of the files panel: relative
 * to the project folder, unquoted. Null outside the folder, where a mention would name nothing.
 */
export function mentionOf(folder: string | null, path: string): string | null {
    if (folder === null) {
        return null;
    }
    const relative = relativeTo(folder, path);
    return relative === path || relative === '' ? null : chipText({ kind: 'mention', path: relative.replace(/\/$/, '') });
}

/* The tree marks a directory with a trailing slash, on a row and in a git status entry alike. */
export function isDirectoryPath(treePath: string): boolean {
    return treePath.endsWith('/');
}

/* The last segment of a path, whichever separator the daemon's machine uses. */
export function basenameOf(path: string): string {
    return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/* The folder a path sits in, which is what `fs.changed` names when something in it moves. */
export function dirnameOf(path: string): string {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return cut > 0 ? path.slice(0, cut) : path.slice(0, cut + 1);
}

export function treePathOf(root: string, entry: FsEntry): string {
    const relative = relativeTo(root, entry.path);
    return entry.kind === 'directory' ? `${relative}/` : relative;
}

/*
 * The whole model in one pass over the cache. A directory that has been listed contributes its
 * children, an empty one contributes itself with a trailing slash (which is how the tree hears
 * about a directory with nothing in it), and one that has not been listed contributes the
 * placeholder that keeps its chevron. Hidden entries are filtered here, so the eye button rebuilds
 * from what is already loaded instead of asking the daemon again.
 */
export function buildTreeInput(root: string, cache: EntryCache, showHidden: boolean): TreeInput {
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
}

export const { ancestorDirsOf, withoutClosedBranches, newlyExpanded, mergeExpanded, compareRows } = FileTree;
export type SortRow = Parameters<typeof FileTree.compareRows>[0];

/*
 * A porcelain letter as the tree names the same thing. The tree knows five states and git writes
 * more than five letters, so a type change, a copy and a conflict all read as a modification: the
 * dot says the file differs from HEAD, and the git panel next to it says how.
 */
export function treeGitStatus(status: string): GitStatus {
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
}

/*
 * What git says about the checkout, in the rows the tree marks. Paths come from the repository
 * root and the tree counts from the open folder, so a change above the folder (a repository the
 * project is a subdirectory of) has no row here and is left out. The tree marks the directories
 * on the way itself, from these entries.
 */
export function gitStatusEntries(folder: string, root: string | null, files: readonly GitFile[]): GitStatusEntry[] {
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
}
