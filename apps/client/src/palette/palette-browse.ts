import i18next from 'i18next';
import { nameOf, type MachineEntry } from '@/machines/machine-list';
import { endsWithSeparator, lastSegment } from '@/paths/machine-path';
import type { ConnectionState } from '@/transport-api/transport';

export interface BrowseAnswer {
    entries: readonly { name: string }[];
    exists?: boolean;
}

/* `unknown` is what a daemon older than the `exists` field leaves behind, not a third state on disk. */
type FolderPresence = 'there' | 'missing' | 'unknown';

/*
 * A path ending in a separator was listed itself, so its `exists` decides; otherwise its parent was
 * listed and the last segment has to be among the names. Case-sensitive even on a file system that is
 * not, because the folder that gets created should be the one that was typed.
 */
export function folderPresence(path: string, result: BrowseAnswer | null, sep: string): FolderPresence {
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
}

/*
 * Whether the machine opens a path as it was typed. It refuses a relative one (`folder-to-open.ts`
 * on the daemon), since its own working folder means nothing to a person.
 */
export function isFullPath(path: string, platform: string | null): boolean {
    const trimmed = path.trim();
    if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
        return true;
    }
    if (platform === 'win32') {
        return /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\') || trimmed.startsWith('/');
    }
    return trimmed.startsWith('/');
}

/*
 * Whether what is typed turns the palette into a folder browser; anything else searches nodes and
 * actions. A drive letter browses only on a machine that has drives, and a bare `C:` stays a search
 * until the separator, since the machine reads it as relative to that drive's working folder.
 */
export function isPathQuery(query: string, platform: string | null): boolean {
    if (query.startsWith('/') || query.startsWith('~') || query.startsWith('./') || query.startsWith('../')) {
        return true;
    }
    return platform === 'win32' && isFullPath(query, platform);
}

/* What Enter does with the typed path; a relative one is refused at once rather than after the machine said no. */
type TypedPathOffer = 'open' | 'create' | 'relative';

export function typedPathOffer(path: string, platform: string | null, presence: FolderPresence): TypedPathOffer {
    if (!isFullPath(path, platform)) {
        return 'relative';
    }
    return presence === 'missing' ? 'create' : 'open';
}

interface BrowseStart {
    start: string;
    home: string;
}

/*
 * Home is the tilde the machine expands itself: what `server.hello` calls home is Ruimte's own folder
 * there. `configured` is the machine's own start folder.
 */
export function browseStart(configured: string, sep: string): BrowseStart {
    const homePath = `~${sep}`;
    const trimmed = configured.trim();
    if (trimmed === '') {
        return { start: homePath, home: homePath };
    }
    return { start: endsWithSeparator(trimmed) ? trimmed : `${trimmed}${sep}`, home: homePath };
}

type MachineLink =
    | { kind: 'open' }
    | { kind: 'connecting' }
    | { kind: 'failed'; reason: string }
    | { kind: 'account' }
    | { kind: 'idle' }
    /* On the account without a broker, which nothing outside its own network can reach. */
    | { kind: 'network-only' };

type LinkWait = { state: 'connecting' } | { state: 'failed'; reason: string };

/*
 * The state of one machine in a list. An open link is the whole story; otherwise the wait a person
 * started speaks first, since it is about the pick they just made, and then what the pool knows. A
 * machine this client never dialed is not a broken one, so it says how it would be reached instead.
 */
export function machineLink(entry: MachineEntry, connection: ConnectionState, wait: LinkWait | null): MachineLink {
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
        return { kind: 'failed', reason: i18next.t('shell:browse.machineSilent') };
    }
    return entry.local ? { kind: 'idle' } : { kind: 'account' };
}

/* The one quiet line a row carries beside its name. An open machine says nothing: the dot is the whole of it. */
export function linkHint(link: MachineLink): string | undefined {
    switch (link.kind) {
        case 'open':
            return undefined;
        case 'connecting':
            return i18next.t('shell:browse.connecting');
        case 'failed':
            return i18next.t('shell:browse.notReachable', { reason: link.reason });
        case 'account':
            return i18next.t('shell:browse.throughAccount');
        case 'idle':
            return i18next.t('shell:browse.notConnected');
        case 'network-only':
            return i18next.t('shell:browse.networkOnly');
    }
}

export function linkDot(link: MachineLink): string {
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
}

export interface MachineRow {
    /* The row this machine is under, or the id the row will be made under when it has none yet. */
    endpointId: string;
    label: string;
    entry: MachineEntry;
}

/*
 * The machines the browser can be pointed at, in the order of the Machines pane, except that the
 * machine the client is pointed at comes first: that is where the work is and usually where the
 * folder being looked for is too, and the highlight always opens on the first row.
 */
export function browseMachines(entries: readonly MachineEntry[], activeId: string): MachineRow[] {
    const rows = entries.map((entry) => ({ endpointId: entry.endpoint?.id ?? entry.id, label: nameOf(entry), entry }));
    return [...rows.filter((row) => row.endpointId === activeId), ...rows.filter((row) => row.endpointId !== activeId)];
}

/*
 * Where browsing is. The machines step holds the path the folders step was on, so stepping back
 * returns to it, and an empty one when browsing began on the machines. `link` is set while the
 * folders of a machine wait for its link, or after that wait failed.
 */
export interface BrowseStep {
    endpointId: string;
    machines: boolean;
    path: string;
    link?: LinkWait;
}

export function pickMachine(endpointId: string, open: boolean): BrowseStep {
    return open ? { endpointId, machines: false, path: '' } : { endpointId, machines: false, path: '', link: { state: 'connecting' } };
}

export function openBrowse(activeId: string, machines: readonly { endpointId: string; open: boolean }[]): BrowseStep {
    const only = machines.length === 1 ? machines[0]! : null;
    return only ? pickMachine(only.endpointId, only.open) : { endpointId: activeId, machines: true, path: '' };
}

/*
 * A wait for a link that ended. Only the step still waiting on that machine takes it: a person who
 * went back or picked another machine canceled the wait, not the attempt, which may still finish.
 */
export function settleLink(step: BrowseStep | null, endpointId: string, failure: string | null): BrowseStep | null {
    if (step === null || step.machines || step.endpointId !== endpointId || step.link?.state !== 'connecting') {
        return step;
    }
    return failure === null ? { endpointId, machines: false, path: '' } : { ...step, link: { state: 'failed', reason: failure } };
}

export function retryLink(step: BrowseStep | null): BrowseStep | null {
    return step?.link?.state === 'failed' ? { ...step, link: { state: 'connecting' } } : step;
}

/* Back to the machines, holding the path to come back to; a step still waiting on a link has none. */
export function machinesStep(step: BrowseStep, query: string): BrowseStep {
    return {
        endpointId: step.endpointId,
        machines: true,
        path: step.link === undefined ? query : ''
    };
}

/* `folders` carries the path to go back to, which has to be listed before it is shown. */
type BrowseBack = { to: 'palette' } | { to: 'machines' } | { to: 'folders'; path: string };

export function browseBack(step: BrowseStep, machineCount: number): BrowseBack {
    if (step.machines) {
        return step.path === '' ? { to: 'palette' } : { to: 'folders', path: step.path };
    }
    return machineCount > 1 ? { to: 'machines' } : { to: 'palette' };
}

export interface PaletteSignal {
    open: boolean;
    mode: string;
    /* A count and not a flag, so asking for the browser again while it is already up is a new ask. */
    browseAt: number;
}

export function paletteStart(now: PaletteSignal, seen: PaletteSignal): { changed: boolean; restart: boolean; browse: boolean } {
    const changed = now.open !== seen.open || now.mode !== seen.mode || now.browseAt !== seen.browseAt;
    const restart = changed && now.open;
    return { changed, restart, browse: restart && now.browseAt !== seen.browseAt };
}
