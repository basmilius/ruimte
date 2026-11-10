import { describe, expect, test } from 'bun:test';
import type { ReachCheck } from '@ruimte/contracts';
import { reachText } from './reach-text';

function check(patch: Partial<ReachCheck>): ReachCheck {
    return {
        checkedAt: 0,
        cause: 'ok',
        severity: 'ok',
        facts: {
            broker: { url: 'wss://broker.ruimte.app', connected: true },
            granted: true,
            probes: [],
            lanDoor: { wanted: true, listening: true, port: 4220, addresses: 1 },
            tunnel: 'utun4'
        },
        ...patch
    };
}

describe('the reach row', () => {
    test('a reachable machine says so and needs no fix', () => {
        expect(reachText(check({}))).toEqual({ problem: 'Your other devices can reach this machine.', fix: null });
    });

    test('a VPN reads differently when the relay still carries the connection', () => {
        expect(reachText(check({ cause: 'vpn-blocks-udp', severity: 'relayed' })).problem).toBe(
            'utun4 blocks the direct route, so every connection goes through the relay and is slower.'
        );
        expect(reachText(check({ cause: 'vpn-blocks-udp', severity: 'unreachable' })).problem).toBe(
            'utun4 blocks the routes other devices need, so they cannot connect.'
        );
    });

    test('the connection service is named by its host only where the fix needs it', () => {
        const text = reachText(check({ cause: 'broker-unreachable', severity: 'unreachable' }));
        expect(text.problem).toBe('The machine cannot reach the connection service, so devices outside this network cannot find it.');
        expect(text.fix).toContain('blocks broker.ruimte.app.');
    });

    test('a cause a newer machine names is told as it is, without a fix', () => {
        expect(reachText(check({ cause: 'carrier-pigeon', severity: 'limited' }))).toEqual({
            problem: 'The machine reports a problem this version of Ruimte does not know: carrier-pigeon.',
            fix: null
        });
    });
});
