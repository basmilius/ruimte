import i18next from 'i18next';
import type { Machine } from '@ruimte/pulsar';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';

/* One machine in the Machines pane, however this client knows it: a row of its own, the account, or both. */
export interface MachineEntry {
    /* The machine's own id, which is what a row of this client and the account list agree on. */
    id: string;
    endpoint: Endpoint | null;
    machine: Machine | null;
    local: boolean;
    /* Paired with a link, as opposed to a row opened from the account. */
    paired: boolean;
    onAccount: boolean;
}

export interface MergeInput {
    endpoints: readonly Endpoint[];
    /* The account list, or null while signed out or not loaded yet, which leaves only this client's rows. */
    accountMachines: readonly Machine[] | null;
    /* The web client has no machine behind its own origin, so its local row is not a machine at all. */
    showLocal: boolean;
}

/* The row of this machine holds the daemon id once it answered; every other row is keyed on it. */
export const machineIdOf = (endpoint: Endpoint): string => endpoint.daemonId ?? endpoint.id;

/* This machine first, then the rows in the order they were added, then what only the account has. */
export const mergeMachines = ({ endpoints, accountMachines, showLocal }: MergeInput): MachineEntry[] => {
    const entries: MachineEntry[] = [];
    const local = endpoints.find((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID);
    const ordered = [...(local && showLocal ? [local] : []), ...endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID)];
    for (const endpoint of ordered) {
        const id = machineIdOf(endpoint);
        if (entries.some((entry) => entry.id === id)) {
            continue;
        }
        const isLocal = endpoint.id === LOCAL_ENDPOINT_ID;
        entries.push({ id, endpoint, machine: null, local: isLocal, paired: !isLocal && endpoint.pairedBy !== 'statement', onAccount: false });
    }
    for (const machine of accountMachines ?? []) {
        const known = entries.find((entry) => entry.id === machine.id);
        if (known) {
            known.machine = machine;
            known.onAccount = true;
        } else {
            entries.push({ id: machine.id, endpoint: null, machine, local: false, paired: false, onAccount: true });
        }
    }
    return entries;
};

/* How a machine is reached, in the words of its row: "Paired", "On your account" or both. */
export const reachLabel = (entry: MachineEntry): string => {
    const parts: string[] = [];
    if (entry.local) {
        parts.push(i18next.t('settings:reach.thisMachine'));
    }
    if (entry.paired) {
        parts.push(i18next.t('settings:reach.paired'));
    }
    if (entry.onAccount) {
        parts.push(i18next.t('settings:reach.onAccount'));
    } else if (entry.endpoint !== null && !entry.local && !entry.paired) {
        // A row opened from the account while this client cannot see the account list.
        parts.push(i18next.t('settings:reach.openedThroughAccount'));
    }
    return parts.map((part, index) => (index === 0 ? part : part.toLowerCase())).join(', ');
};

/* The name a row shows: what this client calls the machine, or what the account does for one it never opened. */
export const nameOf = (entry: MachineEntry): string => entry.endpoint?.label ?? entry.machine?.name ?? entry.id;

/* What the Account pane shows: the account row, or one machine by its id. */
export type MachinePick = { kind: 'account' } | { kind: 'machine'; id: string };

/*
 * What was picked while it is still in the list, else this machine, else the account. Never another
 * machine by itself: its detail holds a link to it, and opening settings must not reach out to one.
 */
export const currentPick = (picked: MachinePick | null, entries: readonly MachineEntry[]): MachinePick => {
    if (picked?.kind === 'account' || (picked !== null && entries.some((entry) => entry.id === picked.id))) {
        return picked;
    }
    const local = entries.find((entry) => entry.local);
    return local ? { kind: 'machine', id: local.id } : { kind: 'account' };
};

/*
 * Where a search result of the Account pane lands, or null for one of another pane. A row of a
 * machine's detail lands on the machine picked when this client opened it, else on this machine,
 * else on the first one it opened.
 */
export const pickForTarget = (target: string, entries: readonly MachineEntry[], picked: MachineEntry | null): MachinePick | null => {
    if (target === 'machines.signIn' || target === 'machines.add') {
        return { kind: 'account' };
    }
    if (!target.startsWith('machines.machine.')) {
        return null;
    }
    const local = entries.find((entry) => entry.local) ?? null;
    const opened = picked?.endpoint ? picked : (local ?? entries.find((entry) => entry.endpoint !== null) ?? null);
    const entry = target === 'machines.machine.keepRunning' ? local : opened;
    return entry === null ? null : { kind: 'machine', id: entry.id };
};
