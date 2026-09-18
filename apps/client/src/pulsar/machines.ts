import { create } from 'zustand';
import type { Machine } from '@ruimte/pulsar';
import { hasLocalMachine, listedEndpoints } from '@/state/local-machine';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { pool, transportFor } from '@/transport';
import { messageOf, usePulsarAccount, withAccessToken } from './account';
import { reclaimPairedMachine } from './removal';

interface MachinesState {
    // Null until the account list has been asked for once.
    machines: Machine[] | null;
    // Machines a person took off the account, which only a person puts back.
    removedMachineIds: string[];
    // Removed machines this client just paired with again, on their way back onto the account.
    reclaiming: string[];
    error: string | null;
}

/* The machines on the account this client is signed in to. */
export const usePulsarMachines = create<MachinesState>(() => ({ machines: null, removedMachineIds: [], reclaiming: [], error: null }));

/* The row this client keeps for a machine on the account, whatever id the row is under. */
export const rowForAccountMachine = (machineId: string, endpoints: readonly Endpoint[], local = hasLocalMachine()): Endpoint | null =>
    listedEndpoints(endpoints, local).find((endpoint) => endpoint.id === machineId || endpoint.daemonId === machineId) ?? null;

/*
 * A row for a machine this client has never reached. There is no address to try, so the broker is the
 * only route and Direct is on; the key comes from the account list, which is the trust signing in buys.
 * Null for a machine on no broker, which a client somewhere else has no way to find.
 */
export const endpointForAccountMachine = (machine: Machine): Endpoint | null =>
    machine.brokerUrl === null
        ? null
        : {
              id: machine.id,
              label: machine.name,
              httpBaseUrl: '',
              wsBaseUrl: '',
              reachability: 'public',
              token: null,
              daemonId: machine.id,
              daemonPublicKey: machine.publicKey,
              direct: true,
              brokerUrl: machine.brokerUrl,
              pairedBy: 'statement',
              needsStatement: true
          };

export const refreshAccountMachines = async (): Promise<void> => {
    try {
        const list = await withAccessToken((client, token) => client.listMachines(token));
        usePulsarMachines.setState({ machines: list.machines, removedMachineIds: list.removedMachineIds ?? [], error: null });
    } catch (e) {
        usePulsarMachines.setState({ error: messageOf(e) });
    }
};

/* The machine behind a row signs itself onto the account, and this client posts that with its own session. */
export const addMachineToAccount = async (endpointId: string): Promise<void> => {
    const account = usePulsarAccount.getState().account;
    const link = transportFor(endpointId);
    if (!account || !link) {
        throw new Error('Sign in, and connect to the machine, first');
    }
    const { registration } = await link.request('endpoint.signRegistration', { accountId: account.id });
    await withAccessToken((client, token) => client.registerMachine(token, registration));
    await refreshAccountMachines();
};

/* Off the account list; the machine keeps every client it already let in. */
export const removeMachineFromAccount = async (machineId: string): Promise<void> => {
    await withAccessToken((client, token) => client.deleteMachine(token, machineId));
    await refreshAccountMachines();
};

/* Adds the row that reaches a machine from the account list, or answers the one this client already has. */
export const openAccountMachine = (machine: Machine): Endpoint => {
    const known = rowForAccountMachine(machine.id, useEndpoints.getState().endpoints);
    if (known) {
        return known;
    }
    const row = endpointForAccountMachine(machine);
    if (!row) {
        throw new Error(`${machine.name} is not connected to a broker yet, so it can only be reached on its own network`);
    }
    useEndpoints.getState().add(row);
    return row;
};

export const forgetAccountMachines = (): void => {
    usePulsarMachines.setState({ machines: null, removedMachineIds: [], reclaiming: [], error: null });
};

const setReclaiming = (machineId: string, on: boolean): void => {
    usePulsarMachines.setState((state) => ({
        reclaiming: on ? [...state.reclaiming.filter((id) => id !== machineId), machineId] : state.reclaiming.filter((id) => id !== machineId)
    }));
};

/* The machine has to answer to sign its registration, so the socket is held until it does. */
const waitForOpen = (endpointId: string): Promise<void> =>
    new Promise((resolve) => {
        const endpoint = useEndpoints.getState().endpoints.find((entry) => entry.id === endpointId);
        if (!endpoint) {
            resolve();
            return;
        }
        const release = pool.hold(endpoint);
        let off: (() => void) | null = null;
        const check = (): void => {
            if (pool.statusOf(endpointId).status === 'open') {
                off?.();
                release();
                resolve();
            }
        };
        off = pool.subscribeStatus(endpointId, check);
        check();
    });

/* Called after every pairing by link; see `reclaimPairedMachine` for why a removed machine goes back on the account. */
export const reclaimAfterPairing = (endpoint: Endpoint): Promise<'untouched' | 'reclaimed'> =>
    reclaimPairedMachine(
        endpoint,
        { signedIn: usePulsarAccount.getState().status === 'signed-in', removedMachineIds: usePulsarMachines.getState().removedMachineIds },
        { waitForOpen, addToAccount: addMachineToAccount, setReclaiming }
    );
