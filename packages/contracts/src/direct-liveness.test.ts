import { describe, expect, test } from 'bun:test';
import { ChannelLiveness, directPingFrame } from './direct-liveness.ts';

const setup = () => {
    let clock = 0;
    const pings: string[] = [];
    let dead = 0;
    const liveness = new ChannelLiveness({
        ping: (id) => pings.push(id),
        dead: () => {
            dead += 1;
        },
        now: () => clock,
        idleMs: 2_000,
        timeoutMs: 5_000
    });
    return {
        liveness,
        pings,
        dead: () => dead,
        at: (ms: number) => {
            clock = ms;
            liveness.tick();
        }
    };
};

describe('ChannelLiveness', () => {
    test('a connection that keeps talking is never pinged', () => {
        const { liveness, pings, at } = setup();
        for (let ms = 500; ms <= 20_000; ms += 500) {
            liveness.heard();
            at(ms);
        }
        expect(pings).toEqual([]);
    });

    test('a quiet connection is pinged once, and an answer puts it back to quiet', () => {
        const { liveness, pings, dead, at } = setup();
        at(1_000);
        expect(pings).toEqual([]);
        at(2_000);
        at(3_000);
        expect(pings).toEqual(['alive-1']);
        liveness.heard();
        at(4_000);
        expect(pings).toEqual(['alive-1']);
        at(6_000);
        expect(pings).toEqual(['alive-1', 'alive-2']);
        expect(dead()).toBe(0);
    });

    test('nothing heard within the timeout of a ping is a dead peer', () => {
        const { dead, at } = setup();
        at(2_000);
        at(6_000);
        expect(dead()).toBe(0);
        at(7_000);
        expect(dead()).toBe(1);
    });

    test('a tick that comes a minute late sends a ping instead of calling the peer dead', () => {
        const { pings, dead, at } = setup();
        at(60_000);
        expect(pings).toEqual(['alive-1']);
        expect(dead()).toBe(0);
    });

    test('the ping is a server.ping request under its own id', () => {
        expect(JSON.parse(directPingFrame('alive-3'))).toEqual({ id: 'alive-3', type: 'server.ping', payload: {} });
    });
});
