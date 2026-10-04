import type { GitFile } from '@ruimte/contracts';
import { treeGitStatus } from '@/shell/panels/files-tree';
import type { FileTab } from '@/state/files';

export interface GitTreeRow {
    path: string;
    kind: 'directory' | 'file';
    isExpanded: boolean;
}

/* The groups of the list, top to bottom: what stops a commit, what git tracks, what it has never seen. */
export type GitGroup = 'conflicts' | 'changes' | 'unversioned';

export const GIT_GROUPS: readonly GitGroup[] = ['conflicts', 'changes', 'unversioned'];

/* Whether a row is in the index: all of it, none of it, or part of it. */
export type CheckState = 'checked' | 'unchecked' | 'mixed';

/* One changed path of one checkout, with the side git reports for the index and the one for the working tree. */
export interface GitEntry {
    path: string;
    group: GitGroup;
    staged: GitFile | null;
    /* Unstaged, untracked or conflicted. */
    worktree: GitFile | null;
}

/*
 * One row per path. The staged and the unstaged side of a file are one file to a person, so ticking
 * its box moves it in and out of the index without moving the row. A file git has never committed
 * stays among the unversioned ones once it is staged, for the same reason.
 */
export const entriesOf = (files: readonly GitFile[]): GitEntry[] => {
    const added = new Set(files.filter((file) => file.state === 'staged' && file.status === 'A').map((file) => file.path));
    const entries = new Map<string, GitEntry>();
    for (const file of files) {
        const group: GitGroup = file.state === 'conflicted' ? 'conflicts' : file.state === 'untracked' || added.has(file.path) ? 'unversioned' : 'changes';
        const key = `${group}\u0000${file.path}`;
        const entry = entries.get(key) ?? { path: file.path, group, staged: null, worktree: null };
        if (file.state === 'staged') {
            entry.staged = file;
        } else {
            entry.worktree = file;
        }
        entries.set(key, entry);
    }
    return [...entries.values()];
};

export const checkOf = (entry: GitEntry): CheckState => (entry.staged === null ? 'unchecked' : entry.worktree === null ? 'checked' : 'mixed');

export const checkOfAll = (entries: readonly GitEntry[]): CheckState => {
    let checked = false;
    let unchecked = false;
    for (const entry of entries) {
        const state = checkOf(entry);
        if (state === 'mixed') {
            return 'mixed';
        }
        checked ||= state === 'checked';
        unchecked ||= state === 'unchecked';
    }
    return checked && unchecked ? 'mixed' : checked ? 'checked' : 'unchecked';
};

/* What ticking a box does: one that is not wholly checked stages all of it, a checked one unstages
   all of it. Only the paths that move are named. */
export const toggleOf = (entries: readonly GitEntry[]): { staged: boolean; paths: string[] } => {
    const staged = checkOfAll(entries) !== 'checked';
    return { staged, paths: movingPaths(entries, staged) };
};

/* The paths staging (or unstaging) moves; the rest already stand where it puts them. */
export const movingPaths = (entries: readonly GitEntry[], staged: boolean): string[] =>
    entries.filter((entry) => (staged ? entry.worktree !== null : entry.staged !== null)).map((entry) => entry.path);

/* The side a row opens and is measured by: the working tree while it has changes the index lacks, else the index. */
export const shownFile = (entry: GitEntry): GitFile => (entry.worktree ?? entry.staged)!;

/* The letter a row carries. The index says what happened to the file since HEAD; a change on top of it does not rename it back. */
export const statusOf = (entry: GitEntry): string => (entry.staged ?? entry.worktree)!.status;

/* The colors the whole app gives the same news, which the rows here carry on the letter alone. */
const STATUS_COLORS: Record<string, string> = {
    added: 'var(--status-idle)',
    untracked: 'var(--status-idle)',
    deleted: 'var(--status-error)',
    renamed: 'var(--status-running)',
    modified: 'var(--status-needs-you)',
    ignored: 'var(--text-faint)'
};

export const statusColor = (status: string): string => STATUS_COLORS[treeGitStatus(status)] ?? 'var(--text-muted)';

/* The tree draws inside a shadow root, which a custom property reaches and a utility class does not. */
const ADDED_COLOR = 'var(--color-term-green)';
const DELETED_COLOR = 'var(--color-term-red)';

/* A run of a row's decoration, which the tree sets in the color it is given. */
export interface DecorationPart {
    text: string;
    color?: string;
}

/* The checkbox a row starts with. Its color is the color of the mark, and the name of the property
   is what the tree's stylesheet draws the box by (`GitFileList`). */
export const checkPart = (state: CheckState): DecorationPart => ({ text: '', color: `var(--git-check-${state})` });

/* A file's row after its name: the lines it adds and removes in the diff it opens, and its letter. */
export const entryParts = (entry: GitEntry): DecorationPart[] => {
    const file = shownFile(entry);
    const parts: DecorationPart[] = [];
    if (file.added > 0) {
        parts.push({ text: `+${file.added}`, color: ADDED_COLOR });
    }
    if (file.deleted > 0) {
        parts.push({ text: `-${file.deleted}`, color: DELETED_COLOR });
    }
    const status = statusOf(entry);
    parts.push({ text: status, color: statusColor(status) });
    return parts;
};

/* Every entry under a folder of a tree, however deep, which is what a folder's box and menu act on. */
export const entriesUnder = (entries: readonly GitEntry[], dir: string): GitEntry[] => entries.filter((entry) => entry.path.startsWith(`${dir}/`));

// JSON keeps checkout paths out of the directory prefix used to fold descendants.
export const gitTreeScope = (checkout: string, group: GitGroup): string => JSON.stringify([checkout, group]);

/* A group and a repository fold too, under keys no folder key starts with: a folder key opens with
   the scope, whose first element is an absolute path. */
export const groupKey = (group: GitGroup): string => JSON.stringify(['group', group]);

export const repoKey = (checkout: string, group: GitGroup): string => JSON.stringify(['repo', checkout, group]);

export const collapseKey = (scope: string, dir: string): string => (scope === '' ? dir : `${scope}/${dir}`);

/*
 * Every folder the paths hold, however deep, as the collapse set names them. It is what "collapse
 * all" writes and what "expand all" clears, over every group at once: the folders of the list are
 * one set, so folding it up is one act and not one per group.
 */
export const allDirs = (paths: readonly string[], scope = ''): string[] => {
    const dirs = new Set<string>();
    for (const path of paths) {
        const parts = path.split('/');
        parts.pop();
        let prefix = '';
        for (const part of parts) {
            prefix = prefix === '' ? part : `${prefix}/${part}`;
            dirs.add(collapseKey(scope, prefix));
        }
    }
    return [...dirs];
};

export const allCollapseKeys = (files: readonly GitFile[], checkout: string): string[] => [
    ...new Set(entriesOf(files).flatMap((entry) => allDirs([entry.path], gitTreeScope(checkout, entry.group))))
];

/* The tree names a directory with a trailing slash and the collapse set does not. */
export const dirPathOf = (rowPath: string): string => (rowPath.endsWith('/') ? rowPath.slice(0, -1) : rowPath);

/* The folders of a tree that stand folded up, which is what the panel remembers between visits. */
export const collapsedPathsOf = (rows: readonly GitTreeRow[], scope = ''): string[] =>
    rows.filter((row) => row.kind === 'directory' && !row.isExpanded).map((row) => collapseKey(scope, dirPathOf(row.path)));

export const mergeCollapsedPaths = (current: string[], rows: readonly GitTreeRow[], scope = ''): string[] => {
    const known = new Set(rows.filter((row) => row.kind === 'directory').map((row) => collapseKey(scope, dirPathOf(row.path))));
    const folded = new Set(collapsedPathsOf(rows, scope));
    const next = current.filter((dir) => !known.has(dir) || folded.has(dir));
    const existing = new Set(current);
    for (const dir of folded) {
        if (!existing.has(dir)) {
            next.push(dir);
        }
    }
    // Selection also notifies subscribers; unchanged folds must not restart the shared-state cycle.
    return next.length === current.length && next.every((dir, index) => dir === current[index]) ? current : next;
};

/*
 * The folders under the ones that just folded, however deep, that do not stand folded yet. The tree
 * keeps a folder under a closed one open, so it would open again together with its parent.
 */
export const branchesUnder = (before: readonly string[], after: readonly string[], dirs: readonly string[], scope = ''): string[] => {
    const had = new Set(before);
    const folded = new Set(after);
    const fresh = after.filter((key) => !had.has(key));
    return dirs.filter((dir) => {
        const key = collapseKey(scope, dir);
        return !folded.has(key) && fresh.some((parent) => key.startsWith(`${parent}/`));
    });
};

/* Which rows have to move for a tree to stand the way the collapse set says. The set is shared by
   every group and every repository, so it holds folders this tree never heard of. */
export const expansionChanges = (rows: readonly GitTreeRow[], collapsed: ReadonlySet<string>, scope = ''): { collapse: string[]; expand: string[] } => {
    const changes: { collapse: string[]; expand: string[] } = { collapse: [], expand: [] };
    for (const row of rows) {
        if (row.kind !== 'directory') {
            continue;
        }
        const folded = collapsed.has(collapseKey(scope, dirPathOf(row.path)));
        if (folded && row.isExpanded) {
            changes.collapse.push(row.path);
        }
        if (!folded && !row.isExpanded) {
            changes.expand.push(row.path);
        }
    }
    return changes;
};

/*
 * Where the keyboard goes from one stop of the list to the next: the rows of a group and of a
 * repository, and the trees under them. A stop that is not on screen (a folded group's trees) is
 * passed over.
 */
export const stopBeside = (order: readonly string[], present: (id: string) => boolean, from: string, step: 1 | -1): string | null => {
    for (let index = order.indexOf(from) + step; index >= 0 && index < order.length; index += step) {
        if (present(order[index]!)) {
            return order[index]!;
        }
    }
    return null;
};

/*
 * Which changed file the preview is showing and which checkout it belongs to, so the list of that
 * repository can mark the row a person is reading. A tab that is not a diff marks nothing.
 */
export const activeDiff = (tab: FileTab | undefined): { cwd: string; path: string } | null => {
    const root = tab?.view?.cwd;
    if (tab === undefined || root === undefined) {
        return null;
    }
    return tab.path.startsWith(`${root}/`) ? { cwd: root, path: tab.path.slice(root.length + 1) } : null;
};
