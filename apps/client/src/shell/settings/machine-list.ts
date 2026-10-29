import i18next from 'i18next';
import type { Machine } from '@ruimte/pulsar';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';

/* One machine in the Machines pane, however this client knows it: a row of its own, the account, or both. */
export interface MachineEntry {
    /* The machine's own id, which is what a row of this client and the account list agree on. */
    id: string;
    endpoint: Endpoint | null;
    machine: Machine | null;
    local: boolean;
    onAccount: boolean;
}

interface MergeInput {
    endpoints: readonly Endpoint[];
    /* The account list, or null while signed out or not loaded yet, which leaves only this client's rows. */
    accountMachines: readonly Machine[] | null;
    /* The web client has no machine behind its own origin, so its local row is not a machine at all. */
    showLocal: boolean;
}

function localFirst(endpoints: readonly Endpoint[]): Endpoint[] {
    return [...endpoints.filter((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID), ...endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID)];
}

/* The machines a section per machine lists, this machine first: it is the one a person with a single machine looks at. */
export function useListedMachines(): Endpoint[] {
    const stored = useEndpoints((s) => s.endpoints);
    return localFirst(listedEndpoints(stored));
}

/* The row of this machine holds the daemon id once it answered; every other row is keyed on it. */
export function machineIdOf(endpoint: Endpoint): string {
    return endpoint.daemonId ?? endpoint.id;
}

/* This machine first, then the rows in the order they were added, then what only the account has. */
export function mergeMachines({ endpoints, accountMachines, showLocal }: MergeInput): MachineEntry[] {
    const entries: MachineEntry[] = [];
    for (const endpoint of localFirst(listedEndpoints(endpoints, showLocal))) {
        const id = machineIdOf(endpoint);
        if (entries.some((entry) => entry.id === id)) {
            continue;
        }
        entries.push({ id, endpoint, machine: null, local: endpoint.id === LOCAL_ENDPOINT_ID, onAccount: false });
    }
    for (const machine of accountMachines ?? []) {
        const known = entries.find((entry) => entry.id === machine.id);
        if (known) {
            known.machine = machine;
            known.onAccount = true;
        } else {
            entries.push({ id: machine.id, endpoint: null, machine, local: false, onAccount: true });
        }
    }
    return entries;
}

/* How a machine is reached, in the words of its row: "This machine", "On your account" or both. */
export function reachLabel(entry: MachineEntry): string {
    const parts: string[] = [];
    if (entry.local) {
        parts.push(i18next.t('settings:reach.thisMachine'));
    }
    if (entry.onAccount) {
        parts.push(i18next.t('settings:reach.onAccount'));
    } else if (entry.endpoint !== null && !entry.local) {
        // A row opened from the account while this client cannot see the account list.
        parts.push(i18next.t('settings:reach.openedThroughAccount'));
    }
    return parts.map((part, index) => (index === 0 ? part : part.toLowerCase())).join(', ');
}

/* The name a row shows: what this client calls the machine, or what the account does for one it never opened. */
export function nameOf(entry: MachineEntry): string {
    return entry.endpoint?.label ?? entry.machine?.name ?? entry.id;
}

/* What the Account pane shows: the account row, one machine by its id, or what this computer offers while its app runs no machine. */
export type MachinePick = { kind: 'account' } | { kind: 'machine'; id: string } | { kind: 'this-computer' };

/*
 * What was picked while it is still in the list, else the account. Never a machine by itself: its
 * detail holds a link to it, and opening settings must not reach out to one.
 */
export function currentPick(picked: MachinePick | null, entries: readonly MachineEntry[], offersThisComputer = false): MachinePick {
    if (picked?.kind === 'account' || (picked?.kind === 'this-computer' && offersThisComputer)) {
        return picked;
    }
    if (picked?.kind === 'machine' && entries.some((entry) => entry.id === picked.id)) {
        return picked;
    }
    return { kind: 'account' };
}

const LOCAL_ONLY_TARGETS = ['machines.machine.keepRunning', 'machines.machine.stopRunning', 'machines.machine.direct'];

/*
 * Where a search result of the Account pane lands, or null for one of another pane. A row of a
 * machine's detail lands on the machine picked when this client opened it, else on the machine of
 * this window, else on this machine, else on the first one it opened.
 */
export function pickForTarget(
    target: string,
    entries: readonly MachineEntry[],
    picked: MachineEntry | null,
    windowEndpointId: string | null = null
): MachinePick | null {
    if (target === 'machines.signIn' || target === 'machines.add') {
        return { kind: 'account' };
    }
    if (target === 'machines.thisComputer') {
        return { kind: 'this-computer' };
    }
    if (!target.startsWith('machines.machine.')) {
        return null;
    }
    const local = entries.find((entry) => entry.local) ?? null;
    const windowEntry = entries.find((entry) => entry.endpoint !== null && entry.endpoint.id === windowEndpointId) ?? null;
    const opened = picked?.endpoint ? picked : (windowEntry ?? local ?? entries.find((entry) => entry.endpoint !== null) ?? null);
    // Running in the background, stopping it and Direct are about this machine only.
    const entry = LOCAL_ONLY_TARGETS.includes(target) ? local : opened;
    return entry === null ? null : { kind: 'machine', id: entry.id };
}
