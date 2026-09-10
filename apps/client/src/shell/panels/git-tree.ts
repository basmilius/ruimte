import type { GitFile } from '@ruimte/contracts';
import type { TabState } from '@/state/files';

export type GitTreeRow =
    | {
          kind: 'directory';
          /* The whole path from the repository root, which is what a collapse is remembered by. */
          path: string;
          /* What the row reads, which is more than one segment for a directory chain nothing branches in. */
          label: string;
          depth: number;
          /* How many files sit under it, however deep. */
          count: number;
      }
    | { kind: 'file'; file: GitFile; depth: number };

interface Node {
    dirs: Map<string, Node>;
    files: GitFile[];
}

const node = (): Node => ({ dirs: new Map(), files: [] });

const byName = (left: string, right: string): number => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });

const countOf = (current: Node): number => current.files.length + [...current.dirs.values()].reduce((total, child) => total + countOf(child), 0);

const walk = (current: Node, prefix: string, depth: number, collapsed: ReadonlySet<string>, rows: GitTreeRow[]): void => {
    for (const name of [...current.dirs.keys()].sort(byName)) {
        let child = current.dirs.get(name)!;
        let label = name;
        let path = prefix === '' ? name : `${prefix}/${name}`;
        // A directory that holds nothing but one directory is a step nobody needs a row for.
        while (child.files.length === 0 && child.dirs.size === 1) {
            const [only] = [...child.dirs.keys()];
            label = `${label}/${only!}`;
            path = `${path}/${only!}`;
            child = child.dirs.get(only!)!;
        }
        rows.push({ kind: 'directory', path, label, depth, count: countOf(child) });
        if (!collapsed.has(path)) {
            walk(child, path, depth + 1, collapsed, rows);
        }
    }
    for (const file of [...current.files].sort((left, right) => byName(left.path, right.path))) {
        rows.push({ kind: 'file', file, depth });
    }
};

/*
 * The changed files of one group as a tree of the folders they sit in: directories first, then the
 * files beside them, and a collapsed directory takes its whole subtree with it. It is a list of rows
 * and not a nested structure, because every row draws the same way and the panel only has to know
 * how deep it is.
 */
export const buildGitRows = (files: readonly GitFile[], collapsed: ReadonlySet<string> = new Set()): GitTreeRow[] => {
    const root = node();
    for (const file of files) {
        const parts = file.path.split('/');
        parts.pop();
        let current = root;
        for (const part of parts) {
            const child = current.dirs.get(part) ?? node();
            current.dirs.set(part, child);
            current = child;
        }
        current.files.push(file);
    }
    const rows: GitTreeRow[] = [];
    walk(root, '', 0, collapsed, rows);
    return rows;
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
