import { describe, expect, test } from 'bun:test';
import type { Machine } from '@ruimte/pulsar';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';
import { forgetOnClient, machineDialogModel, removeFromAccount, type MachineActionDeps } from './machine-actions';
import type { MachineEntry } from './machine-list';

const endpoint = (id: string, overrides: Partial<Endpoint> = {}): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: `http://${id}:4210`,
    wsBaseUrl: `ws://${id}:4210`,
    reachability: 'lan',
    token: null,
    daemonId: id,
    daemonPublicKey: null,
    ...overrides
});

const machine = (id: string, brokerUrl: string | null = 'wss://broker.example.com'): Machine => ({
    id,
    name: id,
    icon: null,
    publicKey: 'A'.repeat(43),
    brokerUrl,
    lastSeenAt: null
});

const paired: MachineEntry = { id: 'studio', endpoint: endpoint('studio'), machine: machine('studio'), local: false, paired: true, onAccount: true };
const accountOnly: MachineEntry = { id: 'attic', endpoint: null, machine: machine('attic'), local: false, paired: false, onAccount: true };
const here: MachineEntry = {
    id: 'home',
    endpoint: endpoint(LOCAL_ENDPOINT_ID, { daemonId: 'home' }),
    machine: null,
    local: true,
    paired: false,
    onAccount: false
};

const signedIn = { connected: true, signedIn: true, removedMachineIds: [] };

describe('machineDialogModel', () => {
    test('a paired machine on the account offers both destructive actions', () => {
        const model = machineDialogModel(paired, signedIn);
        expect(model).toEqual({
            settings: 'ready',
            direct: true,
            canOpen: false,
            canForget: true,
            canRemoveFromAccount: true,
            canAddToAccountAgain: false
        });
    });

    test('a machine that does not answer keeps its settings but disables them', () => {
        expect(machineDialogModel(paired, { ...signedIn, connected: false }).settings).toBe('not-answering');
    });

    test('signed out, a machine cannot be removed from the account', () => {
        expect(machineDialogModel(paired, { ...signedIn, signedIn: false }).canRemoveFromAccount).toBe(false);
    });

    test('a machine only on the account is opened first, and never forgotten', () => {
        const model = machineDialogModel(accountOnly, signedIn);
        expect(model.settings).toBe('not-opened');
        expect(model.canOpen).toBe(true);
        expect(model.canForget).toBe(false);
        expect(machineDialogModel({ ...accountOnly, machine: machine('attic', null) }, signedIn).canOpen).toBe(false);
    });

    test('this machine is never forgotten, and is the one that can go back on the account', () => {
        const model = machineDialogModel(here, { ...signedIn, removedMachineIds: ['home'] });
        expect(model.canForget).toBe(false);
        expect(model.canAddToAccountAgain).toBe(true);
    });

    test('a row opened from the account has no Direct to turn off', () => {
        expect(machineDialogModel({ ...paired, endpoint: endpoint('studio', { httpBaseUrl: '' }) }, signedIn).direct).toBe(false);
    });
});

const recorder = () => {
    const calls: string[] = [];
    const deps: MachineActionDeps = {
        forgetEndpoint: async (endpointId) => {
            calls.push(`forget ${endpointId}`);
        },
        deleteFromAccount: async (machineId) => {
            calls.push(`delete ${machineId}`);
        },
        refreshAccount: async () => {
            calls.push('refresh');
        }
    };
    return { calls, deps };
};

describe('machine actions', () => {
    test('forgetting touches this client only', async () => {
        const { calls, deps } = recorder();
        await forgetOnClient(paired, deps);
        await forgetOnClient(here, deps);
        await forgetOnClient(accountOnly, deps);
        expect(calls).toEqual(['forget studio']);
    });

    test('removing from the account also drops the row here', async () => {
        const { calls, deps } = recorder();
        await removeFromAccount(paired, deps);
        expect(calls).toEqual(['delete studio', 'forget studio', 'refresh']);
    });

    test('removing this machine or one never opened leaves no row to drop', async () => {
        const { calls, deps } = recorder();
        await removeFromAccount(here, deps);
        await removeFromAccount(accountOnly, deps);
        expect(calls).toEqual(['delete home', 'refresh', 'delete attic', 'refresh']);
    });

    test('a removal the address book refuses forgets nothing', async () => {
        const { calls, deps } = recorder();
        deps.deleteFromAccount = async () => {
            throw new Error('not-found');
        };
        await expect(removeFromAccount(paired, deps)).rejects.toThrow('not-found');
        expect(calls).toEqual([]);
    });
});
