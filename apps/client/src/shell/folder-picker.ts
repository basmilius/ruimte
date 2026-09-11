import type { ProjectRow } from '@/state/project';

/* Enough recent folders to reach for one, few enough to leave the rail a list and not a screen. */
const RECENT_LIMIT = 8;

/* The daemon's separator, not this browser's: a Windows daemon answers in backslashes. */
export const separatorFor = (platform: string | null): string => (platform === 'win32' ? '\\' : '/');

/* Both separators, because a path is typed by hand and the daemon accepts either. */
export const endsWithSeparator = (path: string): boolean => path.endsWith('/') || path.endsWith('\\');

const withoutTrailing = (path: string, sep: string): string => {
    let end = path.length;
    while (end > 0 && path.slice(end - 1, end) === sep) {
        end -= 1;
    }
    return path.slice(0, end);
};

export interface Crumb {
    label: string;
    /* Where a click leads, with a separator on the end so the daemon lists it whole. */
    path: string;
}

/*
 * The segments of a path, root first, each carrying the path that leads to it. The first segment is
 * whatever the path starts from: the root separator, a drive letter, or the home tilde.
 */
export const breadcrumbOf = (path: string, sep: string): Crumb[] => {
    if (path.trim() === '') {
        return [];
    }
    const crumbs: Crumb[] = [];
    let walked = '';
    withoutTrailing(path, sep)
        .split(sep)
        .forEach((part, index) => {
            if (index === 0) {
                walked = part === '' ? sep : `${part}${sep}`;
                crumbs.push({ label: part === '' ? sep : part, path: walked });
                return;
            }
            if (part === '') {
                return;
            }
            walked = `${walked}${part}${sep}`;
            crumbs.push({ label: part, path: walked });
        });
    return crumbs;
};

/* One level up, ready to browse; null at a root, which is where going up stops. */
export const parentOf = (path: string, sep: string): string | null => {
    const crumbs = breadcrumbOf(path, sep);
    return crumbs.length > 1 ? crumbs[crumbs.length - 2]!.path : null;
};

/* A folder inside a directory, whatever the directory ends in. */
export const joinPath = (parent: string, name: string, sep: string): string => `${withoutTrailing(parent, sep)}${sep}${name}`;

export const lastSegment = (path: string, sep: string): string => {
    const trimmed = withoutTrailing(path, sep);
    const cut = trimmed.lastIndexOf(sep);
    return cut === -1 ? trimmed : trimmed.slice(cut + 1);
};

/* What `fs.browse` answered, down to the two fields the presence rule reads. */
export interface BrowseAnswer {
    entries: readonly { name: string }[];
    exists?: boolean;
}

/* `unknown` is what a daemon older than the `exists` field leaves behind, not a third state on disk. */
export type FolderPresence = 'there' | 'missing' | 'unknown';

/*
 * Whether the folder the field names is on that machine. A path ending in a separator was listed
 * itself, so the answer's own `exists` decides; a path without one had its parent listed, so the
 * last segment has to be among the names. That compare is case-sensitive even on a file system
 * that is not, because the folder that gets created should be the one that was typed.
 */
export const folderPresence = (path: string, result: BrowseAnswer | null, sep: string): FolderPresence => {
    if (result === null || result.exists === undefined) {
        return 'unknown';
    }
    if (!result.exists) {
        return 'missing';
    }
    if (endsWithSeparator(path)) {
        return 'there';
    }
    const last = lastSegment(path, sep);
    return result.entries.some((entry) => entry.name === last) ? 'there' : 'missing';
};

/* Where the picker opens when nothing was typed: the folder in hand, else that machine's home. */
export const startFolder = (folder: string | null, home: string | null, sep: string): string => `${folder ?? home ?? '~'}${sep}`;

export type ShortcutGroup = 'project' | 'home' | 'recent';

export interface Shortcut {
    id: string;
    group: ShortcutGroup;
    label: string;
    /* Where a click points the field, with a separator so the folder is listed and not filtered. */
    path: string;
    /* The folder under the name; a row that is already named after a path has nothing to add. */
    hint: string | null;
}

export interface ShortcutInput {
    /* The machine being browsed; a project of another machine is another file system. */
    endpointId: string;
    home: string | null;
    /* The open project, when it is on this machine. */
    current: { name: string; folder: string | null; endpointId: string | null } | null;
    projects: readonly ProjectRow[];
    sep: string;
}

/* The rail: where the open project lives, home, and the folders this machine has projects in. */
export const shortcutsFor = ({ endpointId, home, current, projects, sep }: ShortcutInput): Shortcut[] => {
    const rows: Shortcut[] = [];
    const seen = new Set<string>();
    const add = (shortcut: Shortcut): void => {
        if (seen.has(shortcut.path)) {
            return;
        }
        seen.add(shortcut.path);
        rows.push(shortcut);
    };
    if (current?.folder && current.endpointId === endpointId) {
        add({ id: 'current', group: 'project', label: current.name, path: `${current.folder}${sep}`, hint: current.folder });
    }
    if (home) {
        add({ id: 'home', group: 'home', label: 'Home', path: `${home}${sep}`, hint: null });
    }
    projects
        .filter((row) => row.endpointId === endpointId && row.summary.folder !== null)
        .sort((a, b) => b.summary.lastOpenedAt - a.summary.lastOpenedAt)
        .slice(0, RECENT_LIMIT)
        .forEach((row) => {
            const folder = row.summary.folder!;
            add({ id: `project-${row.summary.projectId}`, group: 'recent', label: row.summary.name, path: `${folder}${sep}`, hint: folder });
        });
    return rows;
};
