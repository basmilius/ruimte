import type { GitFile } from '@ruimte/contracts';
import { treeGitStatus } from '@/shell/panels/files-tree';
import type { TabState } from '@/state/files';

export interface GitTreeRow {
    path: string;
    kind: 'directory' | 'file';
    isExpanded: boolean;
}

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

/* Every file under a folder of a group, however deep, which is what staging a whole folder takes. */
export const pathsUnder = (files: readonly GitFile[], dir: string): string[] =>
    files.filter((file) => file.path.startsWith(`${dir}/`)).map((file) => file.path);

/*
 * Every folder the groups hold, however deep, as the collapse set names them. It is what "collapse
 * all" writes and what "expand all" clears, over every group at once: the folders of the list are
 * one set, so folding it up is one act and not one per group.
 */
export const allDirs = (files: readonly GitFile[]): string[] => {
    const dirs = new Set<string>();
    for (const file of files) {
        const parts = file.path.split('/');
        parts.pop();
        let prefix = '';
        for (const part of parts) {
            prefix = prefix === '' ? part : `${prefix}/${part}`;
            dirs.add(prefix);
        }
    }
    return [...dirs];
};

/* The tree names a directory with a trailing slash and the collapse set does not. */
export const dirPathOf = (rowPath: string): string => (rowPath.endsWith('/') ? rowPath.slice(0, -1) : rowPath);

/* The folders of a tree that stand folded up, which is what the panel remembers between visits. */
export const collapsedPathsOf = (rows: readonly GitTreeRow[]): string[] =>
    rows.filter((row) => row.kind === 'directory' && !row.isExpanded).map((row) => dirPathOf(row.path));

/* Which rows have to move for a tree to stand the way the collapse set says. The set is shared by
   every group, so it holds folders this tree never heard of. */
export const expansionChanges = (rows: readonly GitTreeRow[], collapsed: ReadonlySet<string>): { collapse: string[]; expand: string[] } => {
    const changes: { collapse: string[]; expand: string[] } = { collapse: [], expand: [] };
    for (const row of rows) {
        if (row.kind !== 'directory') {
            continue;
        }
        const folded = collapsed.has(dirPathOf(row.path));
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
 * Which changed file the preview is showing, as the repository names it, so the list can mark the
 * row a person is reading. A tab that is not a diff, or one of another checkout, marks nothing.
 */
export const activeDiffPath = (state: TabState, root: string | null): string | null => {
    const tab = state.tabs.find((entry) => entry.key === state.active);
    if (root === null || tab?.view === undefined || tab.view.cwd !== root) {
        return null;
    }
    return tab.path.startsWith(`${root}/`) ? tab.path.slice(root.length + 1) : null;
};
