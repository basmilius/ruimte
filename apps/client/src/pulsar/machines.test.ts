import { describe, expect, jest, spyOn, test } from 'bun:test';
import i18next from 'i18next';
import type { Machine } from '@ruimte/pulsar';
import { brokerRouteOf, useEndpoints, type Endpoint } from '@/state/endpoints';
import { pool } from '@/transport';
import { endpointForAccountMachine, rowForAccountMachine, waitForOpen } from './machines';

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

describe('waiting for a machine that was paired again', () => {
    test('a machine that never answers lets go of its link once the wait is over', async () => {
        jest.useFakeTimers();
        const row = { ...endpointForAccountMachine(machine())!, id: 'silent' };
        useEndpoints.getState().add(row);
        let held = 0;
        const hold = spyOn(pool, 'hold').mockImplementation(() => {
            held += 1;
            return () => {
                held -= 1;
            };
        });
        const statusOf = spyOn(pool, 'statusOf').mockReturnValue({ status: 'connecting', attempts: 0, retryAt: null });
        const subscribe = spyOn(pool, 'subscribeStatus').mockReturnValue(() => undefined);
        try {
            const waiting = waitForOpen(row.id);
            expect(held).toBe(1);
            jest.advanceTimersByTime(60_000);
            expect(held).toBe(0);
            await expect(waiting).rejects.toThrow(i18next.t('machines:link.silent'));
        } finally {
            hold.mockRestore();
            statusOf.mockRestore();
            subscribe.mockRestore();
            useEndpoints.getState().remove(row.id);
            jest.useRealTimers();
        }
    });
});
