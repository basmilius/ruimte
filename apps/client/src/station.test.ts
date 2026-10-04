import { describe, expect, test } from 'bun:test';
import type { Machine } from '@ruimte/pulsar';
import { stationBoot, type StationBootInput } from './station';

const machine: Machine = { id: 'studio', name: 'Studio', icon: null, publicKey: 'A'.repeat(43), brokerUrl: 'wss://broker.ruimte.app', lastSeenAt: null };

function input(patch: Partial<StationBootInput> = {}): StationBootInput {
    return {
        station: true,
        accountStatus: 'signed-out',
        machines: null,
        ...patch
    };
}

describe('the web boot state', () => {
    test('a fresh web client offers signing in rather than reaching for a machine at its own origin', () => {
        expect(stationBoot(input())).toBe('sign-in');
        expect(stationBoot(input({ accountStatus: 'unavailable' }))).toBe('sign-in');
        expect(stationBoot(input({ accountStatus: 'loading' }))).toBe('loading');
        expect(stationBoot(input({ accountStatus: 'signing-in' }))).toBe('signing-in');
    });

    test('signed in, it waits for the account list and then lists the machines, even when there are none', () => {
        expect(stationBoot(input({ accountStatus: 'signed-in' }))).toBe('loading');
        expect(stationBoot(input({ accountStatus: 'signed-in', machines: [] }))).toBe('machines');
        expect(stationBoot(input({ accountStatus: 'signed-in', machines: [machine] }))).toBe('machines');
    });

    test('a build that is not the web client keeps the desktop order', () => {
        expect(stationBoot(input({ station: false }))).toBeNull();
    });
});
