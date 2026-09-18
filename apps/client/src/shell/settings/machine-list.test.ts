import { describe, expect, test } from 'bun:test';
import type { Machine } from '@ruimte/pulsar';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';
import { mergeMachines, nameOf, reachLabel } from './machine-list';

const KEY = 'A'.repeat(43);

const local = (daemonId: string | null): Endpoint => ({
    id: LOCAL_ENDPOINT_ID,
    label: 'This MacBook Pro',
    httpBaseUrl: 'http://127.0.0.1:4210',
    wsBaseUrl: 'ws://127.0.0.1:4210',
    reachability: 'loopback',
    token: null,
    daemonId,
    daemonPublicKey: null
});

const row = (id: string, overrides: Partial<Endpoint> = {}): Endpoint => ({
    id,
    label: `Row ${id}`,
    httpBaseUrl: `http://${id}:4210`,
    wsBaseUrl: `ws://${id}:4210`,
    reachability: 'lan',
    token: null,
    daemonId: id,
    daemonPublicKey: KEY,
    ...overrides
});

const machine = (id: string, overrides: Partial<Machine> = {}): Machine => ({
    id,
    name: `Account ${id}`,
    icon: null,
    publicKey: KEY,
    brokerUrl: 'wss://broker.example.com',
    lastSeenAt: null,
    ...overrides
});

describe('mergeMachines', () => {
    test('signed out, the list is this client rows with the local one first', () => {
        const entries = mergeMachines({ endpoints: [row('studio'), local('home')], accountMachines: null, showLocal: true });
        expect(entries.map((entry) => entry.id)).toEqual(['home', 'studio']);
        expect(entries.map(reachLabel)).toEqual(['This machine', 'Paired']);
    });

    test('a machine on this client and on the account is one entry', () => {
        const entries = mergeMachines({
            endpoints: [local('home'), row('studio')],
            accountMachines: [machine('studio'), machine('home'), machine('attic')],
            showLocal: true
        });
        expect(entries.map((entry) => entry.id)).toEqual(['home', 'studio', 'attic']);
        expect(entries.map(reachLabel)).toEqual(['This machine, on your account', 'Paired, on your account', 'On your account']);
        expect(entries[2]!.endpoint).toBeNull();
        expect(nameOf(entries[1]!)).toBe('Row studio');
        expect(nameOf(entries[2]!)).toBe('Account attic');
    });

    test('a row keyed on an address still matches its machine through the daemon id', () => {
        const entries = mergeMachines({ endpoints: [row('host:4210', { daemonId: 'studio' })], accountMachines: [machine('studio')], showLocal: true });
        expect(entries).toHaveLength(1);
        expect(entries[0]!.onAccount).toBe(true);
    });

    test('a row opened from the account is not called paired', () => {
        const opened = row('attic', { httpBaseUrl: '', wsBaseUrl: '', pairedBy: 'statement' });
        expect(reachLabel(mergeMachines({ endpoints: [opened], accountMachines: [machine('attic')], showLocal: true })[0]!)).toBe('On your account');
        expect(reachLabel(mergeMachines({ endpoints: [opened], accountMachines: null, showLocal: true })[0]!)).toBe('Opened through your account');
    });

    test('the web client leaves out its local row but keeps that machine from the account', () => {
        const entries = mergeMachines({ endpoints: [local('home'), row('studio')], accountMachines: [machine('home')], showLocal: false });
        expect(entries.map((entry) => entry.id)).toEqual(['studio', 'home']);
        expect(entries[1]?.endpoint).toBeNull();
    });
});
