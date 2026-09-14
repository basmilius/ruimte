import { create } from 'zustand';
import type { Machine } from '@ruimte/pulsar';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { transportFor } from '@/transport';
import { messageOf, usePulsarAccount, withAccessToken } from './account';

interface MachinesState {
    // Null until the account list has been asked for once.
    machines: Machine[] | null;
    error: string | null;
}

/* The machines on the account this client is signed in to. */
export const usePulsarMachines = create<MachinesState>(() => ({ machines: null, error: null }));

/* The row this client keeps for a machine on the account, whatever id the row is under. */
export const rowForAccountMachine = (machineId: string, endpoints: readonly Endpoint[]): Endpoint | null =>
    endpoints.find((endpoint) => endpoint.id === machineId || endpoint.daemonId === machineId) ?? null;

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
        const machines = await withAccessToken((client, token) => client.listMachines(token));
        usePulsarMachines.setState({ machines, error: null });
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
        throw new Error(`${machine.name} is not on a broker, so this client cannot find it`);
    }
    useEndpoints.getState().add(row);
    return row;
};

export const forgetAccountMachines = (): void => {
    usePulsarMachines.setState({ machines: null, error: null });
};
