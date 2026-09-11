import type { Endpoint } from '@/state/endpoints';

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

/*
 * One level up, ready to browse; null at a root, which is where going up stops. A root is whatever
 * the path starts from: the leading separator, a drive letter or the home tilde, which is why a cut
 * at the very front answers the separator itself rather than an empty string.
 */
export const parentOf = (path: string, sep: string): string | null => {
    const trimmed = withoutTrailing(path, sep);
    const cut = trimmed.lastIndexOf(sep);
    if (cut < 0) {
        return null;
    }
    return cut === 0 ? sep : trimmed.slice(0, cut + 1);
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

/* Where browsing opens when nothing was typed: the folder in hand, else that machine's home. */
export const startFolder = (folder: string | null, home: string | null, sep: string): string => `${folder ?? home ?? '~'}${sep}`;

export interface MachineRow {
    endpointId: string;
    label: string;
    /* False when this client has no open socket to that machine; it is still a machine to browse. */
    connected: boolean;
    active: boolean;
}

/*
 * The machines the browser can be pointed at: the one being worked on first, the rest in the order
 * the endpoint list has them. The same fold `groupProjects` does, minus the projects, so the two
 * lists sort and dim a machine the same way.
 */
export const browseMachines = (endpoints: readonly Endpoint[], activeId: string, connected: readonly string[]): MachineRow[] =>
    [...endpoints]
        .sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId))
        .map((endpoint) => ({
            endpointId: endpoint.id,
            label: endpoint.label,
            connected: connected.includes(endpoint.id),
            active: endpoint.id === activeId
        }));

/*
 * Where browsing is: which machine, whether the machines themselves are up instead of folders, and
 * the path the folders step was on. The machines step holds that path so stepping back returns to
 * it, and holds an empty one when browsing began on the machines and has no folders behind it.
 */
export interface BrowseStep {
    endpointId: string;
    machines: boolean;
    path: string;
}

/*
 * The step browsing opens on, and the text the field opens with. One machine is nothing to choose
 * between, so it goes straight to that machine's folders; more than one asks first, with an empty
 * field that narrows the list rather than a path nobody has typed yet.
 */
export const openBrowse = (endpointId: string, machineCount: number, start: string): { step: BrowseStep; query: string } => {
    if (machineCount > 1) {
        return { step: { endpointId, machines: true, path: '' }, query: '' };
    }
    return { step: { endpointId, machines: false, path: start }, query: start };
};

/* `folders` carries the path to go back to, which has to be listed before it is shown. */
export type BrowseBack = { to: 'palette' } | { to: 'machines' } | { to: 'folders'; path: string };

/*
 * One step back. The machines step returns to the folders it was opened from, and leaves browsing
 * altogether when there are none behind it, which is where browsing began. A folders step goes to
 * the machines when there is more than one to choose from, and otherwise leaves as well.
 */
export const browseBack = (step: BrowseStep, machineCount: number): BrowseBack => {
    if (step.machines) {
        return step.path === '' ? { to: 'palette' } : { to: 'folders', path: step.path };
    }
    return machineCount > 1 ? { to: 'machines' } : { to: 'palette' };
};
