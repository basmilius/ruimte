import { describe, expect, test } from 'bun:test';
import type { Machine } from '@ruimte/pulsar';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';
import { forgetOnClient, machineDialogModel, removeFromAccount, type MachineActionDeps } from './machine-actions';
import type { MachineEntry } from './machine-list';

const endpoint = (id: string, overrides: Partial<Endpoint> = {}): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: '',
    wsBaseUrl: '',
    reachability: 'public',
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

const opened: MachineEntry = { id: 'studio', endpoint: endpoint('studio'), machine: machine('studio'), local: false, onAccount: true };
const accountOnly: MachineEntry = { id: 'attic', endpoint: null, machine: machine('attic'), local: false, onAccount: true };
const here: MachineEntry = {
    id: 'home',
    endpoint: endpoint(LOCAL_ENDPOINT_ID, { daemonId: 'home', httpBaseUrl: 'http://127.0.0.1:4210', wsBaseUrl: 'ws://127.0.0.1:4210' }),
    machine: null,
    local: true,
    onAccount: false
};

const signedIn = { connected: true, signedIn: true, removedMachineIds: [] };

describe('machineDialogModel', () => {
    test('a machine opened from the account offers both destructive actions', () => {
        const model = machineDialogModel(opened, signedIn);
        expect(model).toEqual({
            settings: 'ready',
            direct: false,
            canOpen: false,
            canForget: true,
            canRemoveFromAccount: true,
            canAddToAccountAgain: false,
            canLeaveAccount: false
        });
    });

    test('a machine that does not answer keeps its settings but disables them', () => {
        expect(machineDialogModel(opened, { ...signedIn, connected: false }).settings).toBe('not-answering');
    });

    test('signed out, a machine cannot be removed from the account', () => {
        expect(machineDialogModel(opened, { ...signedIn, signedIn: false }).canRemoveFromAccount).toBe(false);
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

    test('this machine on an account offers to leave it, which replaces removing it from the list', () => {
        const model = machineDialogModel({ ...here, onAccount: true }, { ...signedIn, machineAccount: 'account-1' });
        expect(model.canLeaveAccount).toBe(true);
        expect(model.canRemoveFromAccount).toBe(false);
    });

    test('nothing to leave on a machine on no account, one that does not say, or another machine', () => {
        expect(machineDialogModel(here, { ...signedIn, machineAccount: null }).canLeaveAccount).toBe(false);
        const silent = machineDialogModel({ ...here, onAccount: true }, signedIn);
        expect(silent.canLeaveAccount).toBe(false);
        expect(silent.canRemoveFromAccount).toBe(true);
        expect(machineDialogModel(opened, { ...signedIn, machineAccount: 'account-1' }).canLeaveAccount).toBe(false);
    });

    test('only this machine has a Direct to turn off', () => {
        expect(machineDialogModel(opened, signedIn).direct).toBe(false);
        expect(machineDialogModel(here, signedIn).direct).toBe(true);
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
        await forgetOnClient(opened, deps);
        await forgetOnClient(here, deps);
        await forgetOnClient(accountOnly, deps);
        expect(calls).toEqual(['forget studio']);
    });

    test('removing from the account also drops the row here', async () => {
        const { calls, deps } = recorder();
        await removeFromAccount(opened, deps);
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
        await expect(removeFromAccount(opened, deps)).rejects.toThrow('not-found');
        expect(calls).toEqual([]);
    });
});
