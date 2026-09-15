import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';

/*
 * The rows a signed-in client drops because a person took their machine off the account, a paired
 * row included: removed on the account means removed from every client signed in to it. The row of
 * this machine stays, since it is where the app runs rather than something it connected to, and so
 * does a machine that is being put back after a pairing.
 */
export const rowsRemovedFromAccount = (endpoints: readonly Endpoint[], removedMachineIds: readonly string[], reclaiming: readonly string[]): string[] =>
    endpoints
        .filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID)
        .filter((endpoint) => {
            const machineId = endpoint.daemonId ?? endpoint.id;
            return removedMachineIds.includes(machineId) && !reclaiming.includes(machineId);
        })
        .map((endpoint) => endpoint.id);

export interface ReclaimDeps {
    /* Resolves once the machine answers, since only a machine that answers can sign its registration. */
    waitForOpen(endpointId: string): Promise<void>;
    /* A registration without `automatic`, which is what clears a removal at the address book, and a refresh of the list. */
    addToAccount(endpointId: string): Promise<void>;
    setReclaiming(machineId: string, reclaiming: boolean): void;
}

export interface AccountView {
    signedIn: boolean;
    removedMachineIds: readonly string[];
}

/*
 * Pairing with a machine a person removed, while signed in, is a person saying they want it: it goes
 * back on the account rather than being dropped at the next refresh. The machine is marked while that
 * runs, so neither the removal rule nor the list in between takes the new row away; a registration
 * that fails leaves the mark, and the row, for as long as the page lives.
 */
export const reclaimPairedMachine = async (endpoint: Endpoint, account: AccountView, deps: ReclaimDeps): Promise<'untouched' | 'reclaimed'> => {
    const machineId = endpoint.daemonId ?? endpoint.id;
    if (!account.signedIn || !account.removedMachineIds.includes(machineId)) {
        return 'untouched';
    }
    deps.setReclaiming(machineId, true);
    await deps.waitForOpen(endpoint.id);
    await deps.addToAccount(endpoint.id);
    deps.setReclaiming(machineId, false);
    return 'reclaimed';
};
