import { describe, expect, test } from 'bun:test';
import type { ReachProbe } from '@ruimte/contracts';
import type { IceTarget } from './ice-probe.ts';
import { AUTOMATIC_GAP_MS, ReachChecker, type ReachCheckerOptions } from './reach-check.ts';

const QUIET = { log: () => undefined, warn: () => undefined };

function checker(patch: Partial<ReachCheckerOptions> = {}) {
    const state = { now: 1_000, network: 'en0=192.168.1.2', probed: [] as string[], connected: true };
    const reach = new ReachChecker({
        broker: () => ({ url: 'wss://broker.example.com', connected: state.connected }),
        iceServers: () => [
            { urls: 'stun:turn.example.com:3478' },
            { urls: ['turn:turn.example.com:3478', 'turn:turn.example.com:3478'], username: 'u', credential: 'c' }
        ],
        granted: () => true,
        lanDoor: () => ({ wanted: true, listening: true, port: 4220, addresses: 1 }),
        tunnel: async () => null,
        probe: async (target: IceTarget): Promise<ReachProbe> => {
            state.probed.push(target.url);
            return { kind: target.kind, url: target.url, transport: target.transport, outcome: 'ok' };
        },
        network: () => state.network,
        now: () => state.now,
        log: QUIET,
        ...patch
    });
    return { reach, state };
}

describe('the reach check', () => {
    test('asks each server once and keeps the verdict with its facts', async () => {
        const { reach, state } = checker();
        const check = await reach.check();
        expect(state.probed).toEqual(['stun:turn.example.com:3478', 'turn:turn.example.com:3478']);
        expect(check).toMatchObject({ checkedAt: 1_000, cause: 'ok', severity: 'ok' });
        expect(reach.latest).toBe(check);
    });

    test('a check asked while one runs is that same check', async () => {
        const { reach } = checker();
        const [first, second] = await Promise.all([reach.check(), reach.check()]);
        expect(first).toBe(second);
    });

    test('reading it checks again only when the network changed', async () => {
        const { reach, state } = checker();
        const first = await reach.current();
        expect(await reach.current()).toBe(first);
        state.network = 'en0=10.0.0.4';
        expect(await reach.current()).not.toBe(first);
    });

    test('a broker that settles right after a check is not checked again, one later is', async () => {
        const { reach, state } = checker();
        await reach.check();
        state.probed = [];
        state.now += AUTOMATIC_GAP_MS - 1;
        reach.brokerSettled();
        await Promise.resolve();
        expect(state.probed).toEqual([]);
        state.now += 1;
        reach.brokerSettled();
        await reach.check();
        expect(state.probed.length).toBeGreaterThan(0);
    });

    test('without the broker no server is asked', async () => {
        const { reach, state } = checker();
        state.connected = false;
        expect((await reach.check()).cause).toBe('broker-unreachable');
        expect(state.probed).toEqual([]);
    });
});
