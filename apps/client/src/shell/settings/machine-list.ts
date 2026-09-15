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
        } else if (!(local && !showLocal && local.daemonId === machine.id)) {
            entries.push({ id: machine.id, endpoint: null, machine, local: false, paired: false, onAccount: true });
        }
    }
    return entries;
};

/* How a machine is reached, in the words of its row: "Paired", "On your account" or both. */
export const reachLabel = (entry: MachineEntry): string => {
    const parts: string[] = [];
    if (entry.local) {
        parts.push('This machine');
    }
    if (entry.paired) {
        parts.push('Paired');
    }
    if (entry.onAccount) {
        parts.push('On your account');
    } else if (entry.endpoint !== null && !entry.local && !entry.paired) {
        // A row opened from the account while this client cannot see the account list.
        parts.push('Opened through your account');
    }
    return parts.map((part, index) => (index === 0 ? part : part.toLowerCase())).join(', ');
};

/* The name a row shows: what this client calls the machine, or what the account does for one it never opened. */
export const nameOf = (entry: MachineEntry): string => entry.endpoint?.label ?? entry.machine?.name ?? entry.id;
