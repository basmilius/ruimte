import { nameOf, type MachineEntry } from '@/shell/settings/machine-list';
import type { ConnectionState } from '@/transport/transport';

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

/* What a machine's link is doing, in the terms a row of machines draws it. */
export type MachineLink =
    | { kind: 'open' }
    | { kind: 'connecting' }
    | { kind: 'failed'; reason: string }
    /* No link yet, and the account is the way in. */
    | { kind: 'account' }
    /* A paired machine nothing has asked for yet. */
    | { kind: 'idle' }
    /* On the account without a broker, which nothing outside its own network can reach. */
    | { kind: 'network-only' };

/* A wait for one machine that a person started by picking it: under way, or ended with a reason. */
export type LinkWait = { state: 'connecting' } | { state: 'failed'; reason: string };

/*
 * The state of one machine in a list. An open link is the whole story; otherwise the wait a person
 * started speaks first, since it is about the pick they just made, and then what the pool knows. A
 * machine this client never dialed is not a broken one, so it says how it would be reached instead.
 */
export const machineLink = (entry: MachineEntry, connection: ConnectionState, wait: LinkWait | null): MachineLink => {
    if (connection.status === 'open') {
        return { kind: 'open' };
    }
    if (wait?.state === 'connecting') {
        return { kind: 'connecting' };
    }
    if (wait?.state === 'failed') {
        return { kind: 'failed', reason: wait.reason };
    }
    if (entry.endpoint === null) {
        return entry.machine?.brokerUrl ? { kind: 'account' } : { kind: 'network-only' };
    }
    if (connection.status === 'connecting') {
        return { kind: 'connecting' };
    }
    if (connection.failure) {
        return { kind: 'failed', reason: connection.failure };
    }
    if (connection.attempts > 0) {
        return { kind: 'failed', reason: 'That machine is not answering' };
    }
    return entry.endpoint.pairedBy === 'statement' ? { kind: 'account' } : { kind: 'idle' };
};

/* The one quiet line a row carries beside its name. An open machine says nothing: the dot is the whole of it. */
export const linkHint = (link: MachineLink): string | undefined => {
    switch (link.kind) {
        case 'open':
            return undefined;
        case 'connecting':
            return 'Connecting...';
        case 'failed':
            return `Not reachable: ${link.reason}`;
        case 'account':
            return 'Connects through your account';
        case 'idle':
            return 'Not connected';
        case 'network-only':
            return 'On its own network only';
    }
};

/* The colors the settings page paints a machine in. */
export const linkDot = (link: MachineLink): string => {
    switch (link.kind) {
        case 'open':
            return 'bg-status-idle';
        case 'connecting':
            return 'bg-status-needs-you';
        case 'failed':
            return 'bg-status-error';
        default:
            return 'bg-text-faint';
    }
};

export interface MachineRow {
    /* The row this machine is under, or the id the row will be made under when it has none yet. */
    endpointId: string;
    label: string;
    entry: MachineEntry;
    active: boolean;
}

/*
 * The machines the browser can be pointed at, in the order of the Machines pane: this machine first
 * where there is one, then the rows of this client, then what only the account has. Which machine is
 * active is carried on the row, as the one the step opens highlighted.
 */
export const browseMachines = (entries: readonly MachineEntry[], activeId: string): MachineRow[] =>
    entries.map((entry) => {
        const endpointId = entry.endpoint?.id ?? entry.id;
        return { endpointId, label: nameOf(entry), entry, active: endpointId === activeId };
    });

/*
 * Where browsing is: which machine, whether the machines themselves are up instead of folders, and
 * the path the folders step was on. The machines step holds that path so stepping back returns to
 * it, and holds an empty one when browsing began on the machines and has no folders behind it.
 * `link` is set while the folders of a machine wait for its link, or after that wait failed.
 */
export interface BrowseStep {
    endpointId: string;
    machines: boolean;
    path: string;
    link?: LinkWait;
}

/* The folders of one machine, behind a wait for its link when it is not open yet. */
export const pickMachine = (endpointId: string, open: boolean): BrowseStep =>
    open ? { endpointId, machines: false, path: '' } : { endpointId, machines: false, path: '', link: { state: 'connecting' } };

/*
 * The step browsing opens on. One machine is nothing to choose between, so it goes straight to that
 * machine's folders, connecting first when it has to; more than one asks first. Either way the field
 * opens empty: the machines step narrows its rows with what is typed, and the folders step is waiting
 * for its start folder, which arrives with the listing rather than a frame before it.
 */
export const openBrowse = (activeId: string, machines: readonly { endpointId: string; open: boolean }[]): BrowseStep => {
    const only = machines.length === 1 ? machines[0]! : null;
    return only ? pickMachine(only.endpointId, only.open) : { endpointId: activeId, machines: true, path: '' };
};

/*
 * A wait for a link that ended. Only the step still waiting on that machine takes it: a person who
 * went back or picked another machine cancelled the wait, not the attempt, which may still finish.
 */
export const settleLink = (step: BrowseStep | null, endpointId: string, failure: string | null): BrowseStep | null => {
    if (step === null || step.machines || step.endpointId !== endpointId || step.link?.state !== 'connecting') {
        return step;
    }
    return failure === null ? { endpointId, machines: false, path: '' } : { ...step, link: { state: 'failed', reason: failure } };
};

/* Trying a failed machine again waits again, on the same step. */
export const retryLink = (step: BrowseStep | null): BrowseStep | null => (step?.link?.state === 'failed' ? { ...step, link: { state: 'connecting' } } : step);

/* Back to the machines, holding the path to come back to; a step still waiting on a link has none. */
export const machinesStep = (step: BrowseStep, query: string): BrowseStep => ({
    endpointId: step.endpointId,
    machines: true,
    path: step.link === undefined ? query : ''
});

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
