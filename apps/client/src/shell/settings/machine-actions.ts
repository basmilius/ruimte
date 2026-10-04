import type { MachineEntry } from './machine-list';

export interface MachineContext {
    connected: boolean;
    signedIn: boolean;
    removedMachineIds: readonly string[];
    // The account the machine says it is on, null for none; undefined when it did not say, as any machine but this one.
    machineAccount?: string | null;
}

/* Why the settings of a machine cannot be changed right now, or `ready` when they can. */
export type SettingsState = 'ready' | 'not-answering' | 'not-opened';

export interface MachineDialogModel {
    settings: SettingsState;
    /* Direct is a choice only for this machine; every other one is always reached directly. */
    direct: boolean;
    canOpen: boolean;
    canForget: boolean;
    canRemoveFromAccount: boolean;
    /* Only this machine survives a removal on a signed-in client, so it is the only row that needs a way back. */
    canAddToAccountAgain: boolean;
    /* Only the app on a machine takes it off its account; leaving takes it off the list as well, so it replaces removing. */
    canLeaveAccount: boolean;
}

/* What the detail of one machine offers, from what this client knows about it. */
export const machineDialogModel = (entry: MachineEntry, context: MachineContext): MachineDialogModel => {
    const canLeaveAccount = entry.local && entry.endpoint !== null && typeof context.machineAccount === 'string';
    return {
        settings: entry.endpoint === null ? 'not-opened' : context.connected ? 'ready' : 'not-answering',
        direct: entry.local && entry.endpoint !== null,
        canOpen: entry.endpoint === null && (entry.machine?.brokerUrl ?? null) !== null,
        canForget: entry.endpoint !== null && !entry.local,
        canRemoveFromAccount: context.signedIn && entry.onAccount && !canLeaveAccount,
        canAddToAccountAgain: context.signedIn && entry.endpoint !== null && !entry.onAccount && context.removedMachineIds.includes(entry.id),
        canLeaveAccount
    };
};

export interface MachineActionDeps {
    forgetEndpoint(endpointId: string): Promise<void>;
    deleteFromAccount(machineId: string): Promise<void>;
    refreshAccount(): Promise<void>;
}

/* The row on this client only; the machine and the account keep theirs. */
export const forgetOnClient = async (entry: MachineEntry, deps: MachineActionDeps): Promise<void> => {
    if (entry.endpoint === null || entry.local) {
        return;
    }
    await deps.forgetEndpoint(entry.endpoint.id);
};

/*
 * Off the account, and so off every client signed in to it. This client does at once what the others
 * do at their next refresh; the row of this machine stays, since it is where the app runs.
 */
export const removeFromAccount = async (entry: MachineEntry, deps: MachineActionDeps): Promise<void> => {
    await deps.deleteFromAccount(entry.id);
    if (entry.endpoint !== null && !entry.local) {
        await deps.forgetEndpoint(entry.endpoint.id);
    }
    await deps.refreshAccount();
};
