import { chipText } from '@adecore/agents-react/chat';
import { FileTree } from '@adecore/ui';
import type { GitStatus, GitStatusEntry } from '@pierre/trees';
import { absoluteOf, isPathBelow, relativeTo, type FsEntry, type GitFile } from '@ruimte/contracts';

/* A directory whose children have not arrived yet gets one child nobody sees, so the row keeps its
   chevron. The rule that hides it is in `FilesPanel`. */
export const LOADING_NAME = '.ruimte-loading';

/* What the daemon answered per directory, keyed by the directory's absolute path. */
export type EntryCache = ReadonlyMap<string, readonly FsEntry[]>;

interface TreeInput {
    /* Every row the tree shows, POSIX and relative to the folder. */
    paths: string[];
    /* The paths of the entries git ignores, in the shape the tree's git lane matches on. */
    ignored: string[];
}

/* Whether a folder listed again says what it said before, so the tree is not built again for nothing. */
export function sameEntries(before: readonly FsEntry[], after: readonly FsEntry[]): boolean {
    return (
        before.length === after.length &&
        before.every((entry, i) => {
            const other = after[i]!;
            return (
                entry.path === other.path &&
                entry.kind === other.kind &&
                entry.size === other.size &&
                entry.mtime === other.mtime &&
                entry.hidden === other.hidden &&
                entry.ignored === other.ignored
            );
        })
    );
}

/* A path the files panel can bring into view is one inside the folder that panel lists; a worktree
   or another checkout on the same machine is not. */
export function revealableInFiles(folder: string | null, path: string): boolean {
    return folder !== null && (path === folder || isPathBelow(folder, path));
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

export function treePathOf(root: string, entry: FsEntry): string {
    const relative = relativeTo(root, entry.path);
    return entry.kind === 'directory' ? `${relative}/` : relative;
}

/*
 * The whole model in one pass over the cache. An empty directory contributes itself with a trailing
 * slash, and one not listed yet the placeholder that keeps its chevron. Hidden entries are filtered
 * here, so the eye button rebuilds from the cache instead of asking the daemon again.
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

const TREE_STATUSES: Readonly<Record<string, GitStatus>> = { '?': 'untracked', A: 'added', D: 'deleted', R: 'renamed' };

/*
 * A porcelain letter as the tree names the same thing. The tree knows five states and git writes
 * more than five letters, so a type change, a copy and a conflict all read as a modification: the
 * dot says the file differs from HEAD, and the git panel next to it says how.
 */
export function treeGitStatus(status: string): GitStatus {
    return TREE_STATUSES[status.charAt(0)] ?? 'modified';
}

/*
 * What git says about the checkout, in the rows the tree marks. Paths come from the repository root and
 * the tree counts from the open folder, so a change above the folder has no row and is left out.
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

interface TreeCheckout {
    path: string;
    status: { root: string | null; files: readonly GitFile[] } | null;
}

/*
 * Where a checkout's paths count from: the root git named, or the checkout's own path when git named it through a
 * symlink the path does not take (under macOS's `/tmp`), since a listed checkout is its repository's root. A checkout
 * that stands in for the folder before the repositories are listed may lie below its root, which git names then.
 */
function rootOf(checkout: TreeCheckout): string {
    const named = checkout.status?.root ?? null;

    return named !== null && (named === checkout.path || isPathBelow(named, checkout.path)) ? named : checkout.path;
}

/* What every checkout says, in the rows of a tree that lists `root`; a file of a nested repository is that repository's. */
export function checkoutStatusEntries(root: string, checkouts: readonly TreeCheckout[]): GitStatusEntry[] {
    return checkouts.flatMap((checkout) => gitStatusEntries(root, rootOf(checkout), checkout.status?.files ?? []));
}

/* The innermost checkout a path is in, which is the one git answers for it. */
export function checkoutOfPath<Checkout extends TreeCheckout>(checkouts: readonly Checkout[], path: string): Checkout | null {
    let found: Checkout | null = null;
    for (const checkout of checkouts) {
        const root = rootOf(checkout);
        if ((path === root || isPathBelow(root, path)) && (found === null || isPathBelow(rootOf(found), root))) {
            found = checkout;
        }
    }
    return found;
}

/* The checkouts that are a row of the tree that lists `root`, by that row's path; the root itself has none. */
export function repoRowsOf<Checkout extends { path: string }>(root: string, checkouts: readonly Checkout[]): Map<string, Checkout> {
    const rows = new Map<string, Checkout>();
    for (const checkout of checkouts) {
        if (isPathBelow(root, checkout.path)) {
            rows.set(`${relativeTo(root, checkout.path)}/`, checkout);
        }
    }
    return rows;
}
