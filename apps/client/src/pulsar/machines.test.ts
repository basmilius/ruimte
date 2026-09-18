import { describe, expect, test } from 'bun:test';
import type { Machine } from '@ruimte/pulsar';
import { brokerRouteOf, type Endpoint } from '@/state/endpoints';
import { endpointForAccountMachine, rowForAccountMachine } from './machines';

const machine = (patch: Partial<Machine> = {}): Machine => ({
    id: 'studio',
    name: 'Studio',
    icon: null,
    publicKey: 'A'.repeat(43),
    brokerUrl: 'wss://broker.ruimte.app',
    lastSeenAt: null,
    ...patch
});

describe('machines on the account', () => {
    test('a machine opened from the account is reached over its broker alone, pinned to the key the account listed, and asks for a statement', () => {
        const row = endpointForAccountMachine(machine())!;
        expect(row).toMatchObject({
            id: 'studio',
            daemonId: 'studio',
            daemonPublicKey: 'A'.repeat(43),
            direct: true,
            pairedBy: 'statement',
            needsStatement: true
        });
        expect(brokerRouteOf(row)).toEqual({ brokerUrl: 'wss://broker.ruimte.app', machineKey: 'A'.repeat(43) });
    });

    test('a machine on no broker cannot be opened from another network', () => {
        expect(endpointForAccountMachine(machine({ brokerUrl: null }))).toBeNull();
    });

    test('a native client may reuse its local row, while a browser opens the account machine separately', () => {
        const local = { id: 'local', daemonId: 'studio' } as Endpoint;
        const other = { id: 'server', daemonId: 'server' } as Endpoint;
        expect(rowForAccountMachine('studio', [other, local], true)).toBe(local);
        expect(rowForAccountMachine('studio', [other, local])).toBeNull();
        expect(rowForAccountMachine('server', [other, local])).toBe(other);
        expect(rowForAccountMachine('nowhere', [other, local])).toBeNull();
    });
});
