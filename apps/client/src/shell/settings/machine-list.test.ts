import { describe, expect, test } from 'bun:test';
import type { Machine } from '@ruimte/pulsar';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';
import { currentPick, mergeMachines, nameOf, pickForTarget, reachLabel } from './machine-list';

const KEY = 'A'.repeat(43);

const local = (daemonId: string | null): Endpoint => ({
    id: LOCAL_ENDPOINT_ID,
    label: 'This MacBook Pro',
    httpBaseUrl: 'http://127.0.0.1:4210',
    wsBaseUrl: 'ws://127.0.0.1:4210',
    reachability: 'loopback',
    daemonId,
    daemonPublicKey: null
});

const row = (id: string, overrides: Partial<Endpoint> = {}): Endpoint => ({
    id,
    label: `Row ${id}`,
    httpBaseUrl: '',
    wsBaseUrl: '',
    reachability: 'public',
    daemonId: id,
    daemonPublicKey: KEY,
    pairedBy: 'statement',
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
        expect(entries.map(reachLabel)).toEqual(['This machine', 'Opened through your account']);
    });

    test('a machine on this client and on the account is one entry', () => {
        const entries = mergeMachines({
            endpoints: [local('home'), row('studio')],
            accountMachines: [machine('studio'), machine('home'), machine('attic')],
            showLocal: true
        });
        expect(entries.map((entry) => entry.id)).toEqual(['home', 'studio', 'attic']);
        expect(entries.map(reachLabel)).toEqual(['This machine, on your account', 'On your account', 'On your account']);
        expect(entries[2]!.endpoint).toBeNull();
        expect(nameOf(entries[1]!)).toBe('Row studio');
        expect(nameOf(entries[2]!)).toBe('Account attic');
    });

    test('a row matches its machine through the daemon id', () => {
        const entries = mergeMachines({ endpoints: [row('row-id', { daemonId: 'studio' })], accountMachines: [machine('studio')], showLocal: true });
        expect(entries).toHaveLength(1);
        expect(entries[0]!.onAccount).toBe(true);
    });

    test('a row opened from the account says so while the account list is not there', () => {
        const opened = row('attic');
        expect(reachLabel(mergeMachines({ endpoints: [opened], accountMachines: [machine('attic')], showLocal: true })[0]!)).toBe('On your account');
        expect(reachLabel(mergeMachines({ endpoints: [opened], accountMachines: null, showLocal: true })[0]!)).toBe('Opened through your account');
    });

    test('the web client leaves out its local row but keeps that machine from the account', () => {
        const entries = mergeMachines({ endpoints: [local('home'), row('studio')], accountMachines: [machine('home')], showLocal: false });
        expect(entries.map((entry) => entry.id)).toEqual(['studio', 'home']);
        expect(entries[1]?.endpoint).toBeNull();
    });
});

describe('what the Account pane shows', () => {
    const entries = mergeMachines({ endpoints: [local('home'), row('studio')], accountMachines: [machine('attic')], showLocal: true });
    const remoteOnly = mergeMachines({ endpoints: [local('home'), row('studio')], accountMachines: [machine('attic')], showLocal: false });

    test('opens on this machine, and on the account where there is none, never on another machine', () => {
        expect(currentPick(null, entries)).toEqual({ kind: 'machine', id: 'home' });
        expect(currentPick(null, remoteOnly)).toEqual({ kind: 'account' });
    });

    test('keeps a pick while its machine is listed, and lets go of one that was forgotten', () => {
        expect(currentPick({ kind: 'machine', id: 'studio' }, entries)).toEqual({ kind: 'machine', id: 'studio' });
        expect(currentPick({ kind: 'machine', id: 'gone' }, entries)).toEqual({ kind: 'machine', id: 'home' });
        expect(currentPick({ kind: 'account' }, entries)).toEqual({ kind: 'account' });
    });

    test('a search result lands on the account, on this machine, or on the machine picked', () => {
        const studio = entries[1]!;
        const attic = entries[2]!;
        expect(pickForTarget('machines.add', entries, studio)).toEqual({ kind: 'account' });
        expect(pickForTarget('machines.machine.broker', entries, studio)).toEqual({ kind: 'machine', id: 'studio' });
        expect(pickForTarget('machines.machine.broker', entries, attic)).toEqual({ kind: 'machine', id: 'home' });
        expect(pickForTarget('machines.machine.broker', remoteOnly, null)).toEqual({ kind: 'machine', id: 'studio' });
        expect(pickForTarget('machines.machine.keepRunning', entries, studio)).toEqual({ kind: 'machine', id: 'home' });
        expect(pickForTarget('machines.machine.keepRunning', remoteOnly, null)).toBeNull();
        expect(pickForTarget('machines.machine.direct', entries, studio)).toEqual({ kind: 'machine', id: 'home' });
        expect(pickForTarget('appearance.theme', entries, studio)).toBeNull();
    });
});
