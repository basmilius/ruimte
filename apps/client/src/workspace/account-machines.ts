import { messageOf } from '@adecore/ui';
import { AddressBookRequestError, type Machine } from '@ruimte/pulsar';
import i18next from 'i18next';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { endpointForAccountMachine, rowForAccountMachine, usePulsarMachines } from '@/state/pulsar-machines';
import { serverInfoOf, useServers } from '@/state/server';
import { transportFor } from '@/transport/index';
import { usePulsarAccount, withAccessToken } from '../pulsar/account';
import { accountRefusalText } from '../pulsar/account-refusal';

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

/* The machine behind a row signs itself onto the account, and this client posts that with its own session. */
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
