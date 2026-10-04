import type { FileTreeRowDecoration } from '@pierre/trees';
import type { GitFile } from '@ruimte/contracts';
import { compareRows, treeGitStatus, type SortRow } from '@/shell/panels/files-tree';
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

/* A changed file's row after its name: the lines it adds and removes, and its letter when it has one. */
export const changeParts = (added: number, deleted: number, status: string | null): DecorationPart[] => {
    const parts: DecorationPart[] = [];
    if (added > 0) {
        parts.push({ text: `+${added}`, color: ADDED_COLOR });
    }
    if (deleted > 0) {
        parts.push({ text: `-${deleted}`, color: DELETED_COLOR });
    }
    if (status !== null) {
        parts.push({ text: status, color: statusColor(status) });
    }
    return parts;
};

/* The counts are the ones of the diff the row opens. */
export const entryParts = (entry: GitEntry): DecorationPart[] => {
    const file = shownFile(entry);
    return changeParts(file.added, file.deleted, statusOf(entry));
};

export const decorationOfParts = (parts: DecorationPart[]): FileTreeRowDecoration => ({ text: parts.map((part) => part.text).join(' '), parts });

/* Every entry under a folder of a tree, however deep, which is what a folder's box and menu act on. */
export const entriesUnder = <T extends { path: string }>(entries: readonly T[], dir: string): T[] =>
    entries.filter((entry) => entry.path.startsWith(`${dir}/`));

// JSON keeps checkout paths out of the directory prefix used to fold descendants.
export const gitTreeScope = (checkout: string, group: GitGroup): string => JSON.stringify([checkout, group]);

/* A group and a repository fold too, under keys no folder key starts with: a folder key opens with
   the scope, whose first element is an absolute path. */
export const groupKey = (group: GitGroup): string => JSON.stringify(['group', group]);

export const repoKey = (checkout: string, group: GitGroup): string => JSON.stringify(['repo', checkout, group]);

export const collapseKey = (scope: string, dir: string): string => (scope === '' ? dir : `${scope}/${dir}`);

/*
 * What joins a chain of folders into the name of one row. It reads as the slash the tree puts
 * between them elsewhere, but a path segment cannot hold a real one, and a tree path is never
 * handed to anything outside the list.
 */
export const FOLDER_JOIN = ' ∕ ';

/* What a group and a repository segment start with. It draws nothing, and the tree never holds them
   where a real path segment stands: groups are the top level, repositories the one under it. */
export const SYNTHETIC_PREFIX = '⁠';

/* One folder or file of a checkout's changes, with a chain of folders nothing branches in folded into one. */
export interface FlatNode {
    kind: 'folder' | 'file';
    /* The path in the checkout: for a folder the deepest of its chain, for a file the entry's own. */
    path: string;
    /* The path in the tree, relative to the row it stands under. */
    tree: string;
    /* `tree` of the folder it stands in, null at the top. */
    parent: string | null;
}

interface Trie {
    dirs: Map<string, Trie>;
    files: string[];
}

/*
 * The tree's own flattening is one switch for the whole tree, and would fold a group or a
 * repository together with a lone folder under it; this folds the folders of one checkout only.
 * An untracked folder git names whole (`inner/`) is a file of the list.
 */
export const flattenPaths = (paths: readonly string[]): FlatNode[] => {
    const root: Trie = { dirs: new Map(), files: [] };
    for (const path of paths) {
        const whole = path.endsWith('/');
        const parts = (whole ? path.slice(0, -1) : path).split('/');
        const name = `${parts.pop()!}${whole ? '/' : ''}`;
        let trie = root;
        for (const part of parts) {
            let next = trie.dirs.get(part);
            if (next === undefined) {
                next = { dirs: new Map(), files: [] };
                trie.dirs.set(part, next);
            }
            trie = next;
        }
        trie.files.push(name);
    }
    const nodes: FlatNode[] = [];
    const walk = (trie: Trie, real: string, tree: string | null): void => {
        for (const [name, child] of trie.dirs) {
            let path = real === '' ? name : `${real}/${name}`;
            let label = name;
            let inner = child;
            while (inner.files.length === 0 && inner.dirs.size === 1) {
                const [next, deeper] = [...inner.dirs][0]!;
                path = `${path}/${next}`;
                label = `${label}${FOLDER_JOIN}${next}`;
                inner = deeper;
            }
            const at = tree === null ? label : `${tree}/${label}`;
            nodes.push({ kind: 'folder', path, tree: at, parent: tree });
            walk(inner, path, at);
        }
        for (const name of trie.files) {
            nodes.push({ kind: 'file', path: real === '' ? name : `${real}/${name}`, tree: tree === null ? name : `${tree}/${name}`, parent: tree });
        }
    };
    walk(root, '', null);
    return nodes;
};

/* A changed file of one checkout. */
export interface GitItem {
    cwd: string;
    entry: GitEntry;
}

interface NodeBase {
    group: GitGroup;
    /* The tree path of the row it stands under, null for a group. */
    parent: string | null;
}

/* What a row of the list stands for. Every row but a file folds, under the key the collapse set names it by. */
export type GitTreeNode =
    | (NodeBase & { kind: 'group'; key: string; items: GitItem[] })
    | (NodeBase & { kind: 'repo'; cwd: string; label: string; key: string; items: GitItem[] })
    | (NodeBase & { kind: 'folder'; cwd: string; path: string; key: string; items: GitItem[] })
    | (NodeBase & { kind: 'file'; cwd: string; path: string; item: GitItem });

export interface GitTreeLayout {
    /* What the tree is built from: the path of every file row. */
    paths: string[];
    /* Every row by its path, without the slash the tree puts after a directory. */
    nodes: ReadonlyMap<string, GitTreeNode>;
    /* The tree path of a changed file, by `fileId`. */
    files: ReadonlyMap<string, string>;
    /* Where a group or a repository stands among its siblings. */
    ranks: ReadonlyMap<string, number>;
    /* How many levels from the top are groups and repositories. */
    synthetic: number;
}

/* The changes of one checkout. */
export interface GitTreeSource {
    path: string;
    label: string;
    entries: readonly GitEntry[];
}

export const fileId = (cwd: string, path: string): string => `${cwd}\u0000${path}`;

/* A segment can hold no slash, and two repositories that read the same still need a row each. */
const syntheticSegments = (labels: readonly string[]): string[] => {
    const taken = new Set<string>();
    return labels.map((label) => {
        let segment = `${SYNTHETIC_PREFIX}${label.replaceAll('/', FOLDER_JOIN)}`;
        while (taken.has(segment)) {
            segment += SYNTHETIC_PREFIX;
        }
        taken.add(segment);
        return segment;
    });
};

/*
 * The whole list as one tree: a row per group, under it a row per repository while the folder holds
 * more than one, and under that the folders and files of that repository's changes. A group and a
 * repository are rows of the tree like a folder, so one selection and one keyboard run through all
 * of it. A row's name is its path segment, which is why a group's segment is its label.
 */
export const buildGitTree = (sources: readonly GitTreeSource[], labelOf: (group: GitGroup) => string): GitTreeLayout => {
    const named = sources.length > 1;
    const paths: string[] = [];
    const nodes = new Map<string, GitTreeNode>();
    const files = new Map<string, string>();
    const ranks = new Map<string, number>();
    const repoSegments = syntheticSegments(sources.map((source) => source.label));
    repoSegments.forEach((segment, index) => ranks.set(segment, index));
    const groupSegments = syntheticSegments(GIT_GROUPS.map(labelOf));
    GIT_GROUPS.forEach((group, rank) => {
        const sections = sources
            .map((source, index) => ({ source, segment: repoSegments[index]!, entries: source.entries.filter((entry) => entry.group === group) }))
            .filter((section) => section.entries.length > 0);
        if (sections.length === 0) {
            return;
        }
        const groupPath = groupSegments[rank]!;
        ranks.set(groupPath, rank);
        const groupItems: GitItem[] = [];
        nodes.set(groupPath, { kind: 'group', group, parent: null, key: groupKey(group), items: groupItems });
        for (const { source, segment, entries } of sections) {
            const cwd = source.path;
            const items = entries.map((entry) => ({ cwd, entry }));
            const byPath = new Map(items.map((item) => [item.entry.path, item]));
            groupItems.push(...items);
            let base = groupPath;
            if (named) {
                base = `${groupPath}/${segment}`;
                nodes.set(base, { kind: 'repo', group, parent: groupPath, cwd, label: source.label, key: repoKey(cwd, group), items });
            }
            const scope = gitTreeScope(cwd, group);
            for (const flat of flattenPaths(entries.map((entry) => entry.path))) {
                const treePath = `${base}/${flat.tree}`;
                const parent = flat.parent === null ? base : `${base}/${flat.parent}`;
                if (flat.kind === 'folder') {
                    const under = items.filter((item) => item.entry.path.startsWith(`${flat.path}/`));
                    nodes.set(treePath, { kind: 'folder', group, parent, cwd, path: flat.path, key: collapseKey(scope, flat.path), items: under });
                    continue;
                }
                paths.push(treePath);
                nodes.set(dirPathOf(treePath), { kind: 'file', group, parent, cwd, path: flat.path, item: byPath.get(flat.path)! });
                if (!files.has(fileId(cwd, flat.path))) {
                    files.set(fileId(cwd, flat.path), treePath);
                }
            }
        }
    });
    return { paths, nodes, files, ranks, synthetic: named ? 2 : 1 };
};

/* The row a tree path stands for; the tree names a directory with a trailing slash. */
export const nodeOf = (layout: GitTreeLayout, rowPath: string): GitTreeNode | undefined => layout.nodes.get(dirPathOf(rowPath));

/* Groups and repositories in the order they are listed in, and below them the order of the Files panel. */
export const compareGitRows = (layout: GitTreeLayout, left: SortRow, right: SortRow): number => {
    const depth = Math.min(layout.synthetic, left.segments.length, right.segments.length);
    for (let i = 0; i < depth; i++) {
        const leftSegment = left.segments[i]!;
        const rightSegment = right.segments[i]!;
        if (leftSegment !== rightSegment) {
            return (layout.ranks.get(leftSegment) ?? 0) - (layout.ranks.get(rightSegment) ?? 0);
        }
    }
    return compareRows(left, right);
};

/* The changed files a set of rows stands for, each once: a row that folds is every file under it. */
export const itemsOfNodes = (nodes: readonly GitTreeNode[]): GitItem[] => {
    const found = new Map<string, GitItem>();
    for (const node of nodes) {
        for (const item of node.kind === 'file' ? [node.item] : node.items) {
            found.set(`${item.entry.group}\u0000${fileId(item.cwd, item.entry.path)}`, item);
        }
    }
    return [...found.values()];
};

/* The items split by checkout, in the order they first show up, since staging is one request per checkout. */
export const byCheckout = (items: readonly GitItem[]): [cwd: string, entries: GitEntry[]][] => {
    const split = new Map<string, GitEntry[]>();
    for (const item of items) {
        const entries = split.get(item.cwd) ?? [];
        entries.push(item.entry);
        split.set(item.cwd, entries);
    }
    return [...split];
};

/* A box over rows of the list. A conflict has none, so it takes no part in what a box says or does. */
export const checkOfItems = (items: readonly GitItem[]): CheckState =>
    checkOfAll(items.filter((item) => item.entry.group !== 'conflicts').map((item) => item.entry));

/* What ticking the boxes of a set of rows does, split per checkout: the same as one box over all of them. */
export const toggleItems = (items: readonly GitItem[]): { staged: boolean; work: { cwd: string; paths: string[] }[] } => {
    const boxed = items.filter((item) => item.entry.group !== 'conflicts');
    const staged = checkOfItems(boxed) !== 'checked';
    const work = byCheckout(boxed)
        .map(([cwd, entries]) => ({ cwd, paths: movingPaths(entries, staged) }))
        .filter((step) => step.paths.length > 0);
    return { staged, work };
};

/*
 * Every folder the paths hold as the list draws them, by the key the collapse set names it with. It
 * is what "collapse all" writes and what "expand all" clears, over every group at once: the folders
 * of the list are one set, so folding it up is one act and not one per group.
 */
export const allCollapseKeys = (files: readonly GitFile[], checkout: string): string[] => {
    const keys: string[] = [];
    for (const group of GIT_GROUPS) {
        const paths = entriesOf(files)
            .filter((entry) => entry.group === group)
            .map((entry) => entry.path);
        const scope = gitTreeScope(checkout, group);
        keys.push(...flattenPaths(paths).flatMap((node) => (node.kind === 'folder' ? [collapseKey(scope, node.path)] : [])));
    }
    return keys;
};

/* The tree names a directory with a trailing slash and the collapse set does not. */
export const dirPathOf = (rowPath: string): string => (rowPath.endsWith('/') ? rowPath.slice(0, -1) : rowPath);

/* The key the collapse set names a row by, or null for a row that does not fold there. */
export type FoldKeyOf = (rowPath: string) => string | null;

const plainKey: FoldKeyOf = (rowPath) => dirPathOf(rowPath);

/* The rows that stand folded up, which is what a panel remembers between visits. */
export const collapsedPathsOf = (rows: readonly GitTreeRow[], keyOf: FoldKeyOf = plainKey): string[] =>
    rows.flatMap((row) => {
        const key = row.kind === 'directory' && !row.isExpanded ? keyOf(row.path) : null;
        return key === null ? [] : [key];
    });

export const mergeCollapsedPaths = (current: string[], rows: readonly GitTreeRow[], keyOf: FoldKeyOf = plainKey): string[] => {
    const known = new Set(rows.flatMap((row) => (row.kind === 'directory' ? [keyOf(row.path)] : [])));
    const folded = new Set(collapsedPathsOf(rows, keyOf));
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
 * The folders under the ones that just folded, however deep, that do not stand folded yet, as tree
 * paths. The tree keeps a folder under a closed one open, so it would open again together with its
 * parent. A group or a repository that folds keeps the folders under it as they were.
 */
export const foldedBranches = (layout: GitTreeLayout, before: readonly string[], after: readonly string[]): string[] => {
    const had = new Set(before);
    const folded = new Set(after);
    const fresh = new Set(after.filter((key) => !had.has(key)));
    const branches: string[] = [];
    for (const [path, node] of layout.nodes) {
        if (node.kind !== 'folder' || folded.has(node.key)) {
            continue;
        }
        for (
            let parent = node.parent === null ? undefined : layout.nodes.get(node.parent);
            parent?.kind === 'folder';
            parent = parent.parent === null ? undefined : layout.nodes.get(parent.parent)
        ) {
            if (fresh.has(parent.key)) {
                branches.push(path);
                break;
            }
        }
    }
    return branches;
};

/* Which rows have to move for a tree to stand the way the collapse set says. */
export const expansionChanges = (
    rows: readonly GitTreeRow[],
    collapsed: ReadonlySet<string>,
    keyOf: FoldKeyOf = plainKey
): { collapse: string[]; expand: string[] } => {
    const changes: { collapse: string[]; expand: string[] } = { collapse: [], expand: [] };
    for (const row of rows) {
        const key = row.kind === 'directory' ? keyOf(row.path) : null;
        if (key === null) {
            continue;
        }
        const folded = collapsed.has(key);
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
