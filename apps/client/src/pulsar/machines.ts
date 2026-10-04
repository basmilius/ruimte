import i18next from 'i18next';
import { create } from 'zustand';
import { AddressBookRequestError, type Machine } from '@ruimte/pulsar';
import { hasLocalMachine, listedEndpoints } from '@/state/local-machine';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { serverInfoOf, useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { messageOf } from '@basmilius/desktop-ui';
import { accountRefusalText } from './account-refusal';
import { usePulsarAccount, withAccessToken } from './account';

interface MachinesState {
    // Null until the account list has been asked for once.
    machines: Machine[] | null;
    // Machines a person took off the account, which only a person puts back.
    removedMachineIds: string[];
    error: string | null;
}

/* The machines on the account this client is signed in to. */
export const usePulsarMachines = create<MachinesState>(() => ({ machines: null, removedMachineIds: [], error: null }));

/* The row this client keeps for a machine on the account, whatever id the row is under. */
export function rowForAccountMachine(machineId: string, endpoints: readonly Endpoint[], local = hasLocalMachine()): Endpoint | null {
    return listedEndpoints(endpoints, local).find((endpoint) => endpoint.id === machineId || endpoint.daemonId === machineId) ?? null;
}

/*
 * A row for a machine this client has never reached. There is no address of its own to try, so it is
 * reached directly through the broker until `endpoint.info` names its doors on the local network; the
 * key comes from the account list, which is the trust signing in buys. Null for a machine on no
 * broker, which a client that never reached it has no way to find.
 */
export function endpointForAccountMachine(machine: Machine): Endpoint | null {
    return machine.brokerUrl === null
        ? null
        : {
              id: machine.id,
              label: machine.name,
              httpBaseUrl: '',
              wsBaseUrl: '',
              reachability: 'public',
              daemonId: machine.id,
              daemonPublicKey: machine.publicKey,
              direct: true,
              brokerUrl: machine.brokerUrl,
              pairedBy: 'statement',
              needsStatement: true
          };
}

export async function refreshAccountMachines(): Promise<void> {
    try {
        const list = await withAccessToken((client, token) => client.listMachines(token));
        usePulsarMachines.setState({ machines: list.machines, removedMachineIds: list.removedMachineIds ?? [], error: null });
    } catch (e) {
        usePulsarMachines.setState({ error: messageOf(e) });
    }
}

/* A refusal to put a machine on an account in the words of this client; anything else as it came. */
async function withRefusalText<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (e) {
        const text = accountRefusalText(e);
        if (text !== null) {
            throw new Error(text, { cause: e });
        }
        throw e;
    }
}

/*
 * The machine behind a row signs itself onto the account, and this client posts that with its own
 * session. Only the app on the machine may have it sign, which a machine of before this rule did not know.
 */
export async function addMachineToAccount(endpointId: string): Promise<void> {
    const account = usePulsarAccount.getState().account;
    const link = transportFor(endpointId);
    if (!account || !link) {
        throw new Error(i18next.t('machines:account.signInAndConnect'));
    }
    const { registration } = await withRefusalText(() => link.request('endpoint.signRegistration', { accountId: account.id }));
    if (serverInfoOf(endpointId).accountId !== undefined) {
        useServers.getState().setAccount(endpointId, account.id);
    }
    await withRefusalText(() => withAccessToken((client, token) => client.registerMachine(token, registration)));
    await refreshAccountMachines();
}

/*
 * Takes the machine this app runs on off its account, and cuts off every client that came in through an
 * account. When this client is signed in to that account the machine leaves its list first, so nothing
 * puts it back while it leaves; another account's list keeps it until someone signed in there removes it.
 */
export async function leaveAccount(endpointId: string, machineId: string): Promise<number> {
    const link = transportFor(endpointId);
    if (!link) {
        throw new Error(i18next.t('machines:link.notInList'));
    }
    const { status, account } = usePulsarAccount.getState();
    if (status === 'signed-in' && account !== null && account.id === serverInfoOf(endpointId).accountId) {
        await withAccessToken((client, token) => client.deleteMachine(token, machineId)).catch((e: unknown) => {
            if (!(e instanceof AddressBookRequestError && e.code === 'not-found')) {
                throw e;
            }
        });
        await refreshAccountMachines();
    }
    const { revoked } = await link.request('endpoint.leaveAccount', {});
    useServers.getState().setAccount(endpointId, null);
    return revoked;
}

/* Off the account list; the machine keeps every client it already let in. */
export async function removeMachineFromAccount(machineId: string): Promise<void> {
    await withAccessToken((client, token) => client.deleteMachine(token, machineId));
    await refreshAccountMachines();
}

export function openAccountMachine(machine: Machine): Endpoint {
    const known = rowForAccountMachine(machine.id, useEndpoints.getState().endpoints);
    if (known) {
        return known;
    }
    const row = endpointForAccountMachine(machine);
    if (!row) {
        throw new Error(i18next.t('machines:account.noBroker', { name: machine.name }));
    }
    useEndpoints.getState().add(row);
    return row;
}

export function forgetAccountMachines(): void {
    usePulsarMachines.setState({ machines: null, removedMachineIds: [], error: null });
}
