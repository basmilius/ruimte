import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';

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

export interface BrowseStart {
    /* Where the first listing is asked for, ready to be listed whole. */
    start: string;
    /* Where a start that is not on this machine falls back to; a machine always has a home. */
    home: string;
}

/*
 * Where browsing a machine opens. The folder set in settings, else that machine's home, and
 * deliberately not the folder of the open project: that folder is on one machine and is already
 * open, while browsing is for finding another one. The setting is one for every machine rather than
 * one per machine, so it can name a folder that is not on the machine being browsed; `start` is
 * asked for first and `home` is what the caller falls back to when `fs.browse` says it is not there.
 */
export const browseStart = (configured: string, home: string | null, sep: string): BrowseStart => {
    const homePath = `${home ?? '~'}${sep}`;
    const trimmed = configured.trim();
    if (trimmed === '') {
        return { start: homePath, home: homePath };
    }
    return { start: endsWithSeparator(trimmed) ? trimmed : `${trimmed}${sep}`, home: homePath };
};

export interface MachineRow {
    endpointId: string;
    label: string;
    /* False when this client has no open socket to that machine; it is still a machine to browse. */
    connected: boolean;
    active: boolean;
}

/*
 * The machines the browser can be pointed at: the daemon that served this page first, then the rest
 * in the order the endpoint list has them. This machine keeps its place whichever machine is active,
 * because it is the one that is always there and the one the list is read against. Which machine is
 * active is carried on the row instead, as the one the step opens highlighted.
 */
export const browseMachines = (endpoints: readonly Endpoint[], activeId: string, connected: readonly string[]): MachineRow[] =>
    [...endpoints]
        .sort((a, b) => Number(b.id === LOCAL_ENDPOINT_ID) - Number(a.id === LOCAL_ENDPOINT_ID))
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
 * The step browsing opens on. One machine is nothing to choose between, so it goes straight to that
 * machine's folders; more than one asks first. Either way the field opens empty: the machines step
 * narrows its rows with what is typed, and the folders step is waiting for its start folder, which
 * arrives with the listing rather than a frame before it.
 */
export const openBrowse = (endpointId: string, machineCount: number): BrowseStep => ({ endpointId, machines: machineCount > 1, path: '' });

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

/* What the palette reads off its store: whether it is up, which mode it opens in, and how often the
   folder browser has been asked for. */
export interface PaletteSignal {
    open: boolean;
    mode: string;
    /* A count and not a flag, so asking for the browser again while it is already up is a new ask. */
    browseAt: number;
}

/*
 * What a render has to do about the store. The palette opening, its mode changing under it and the
 * browse command being chosen all start it over, and the last of those is the reason the signal
 * counts: choosing the command while the palette is already open changes nothing else about the
 * store, and choosing it twice in a row has to start browsing twice.
 */
export const paletteStart = (now: PaletteSignal, seen: PaletteSignal): { changed: boolean; restart: boolean; browse: boolean } => {
    const changed = now.open !== seen.open || now.mode !== seen.mode || now.browseAt !== seen.browseAt;
    const restart = changed && now.open;
    return { changed, restart, browse: restart && now.browseAt !== seen.browseAt };
};
