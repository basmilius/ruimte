import { describe, expect, test } from 'bun:test';
import type { ReachFacts, ReachProbe } from '@ruimte/contracts';
import { classifyReach, reachAdvice } from './reach-classify.ts';

const STUN_OK: ReachProbe = { kind: 'stun', url: 'stun:turn.example.com:3478', transport: 'udp', outcome: 'ok' };
const TURN_UDP: ReachProbe = { kind: 'turn', url: 'turn:turn.example.com:3478', transport: 'udp', outcome: 'ok' };
const TURN_TCP: ReachProbe = { kind: 'turn', url: 'turn:turn.example.com:3478?transport=tcp', transport: 'tcp', outcome: 'ok' };
const TURN_TLS: ReachProbe = { kind: 'turn', url: 'turns:turn.example.com:5349', transport: 'tls', outcome: 'ok' };

function down(probe: ReachProbe): ReachProbe {
    return { ...probe, outcome: 'unreachable', error: 'No answer in time' };
}

function refused(probe: ReachProbe): ReachProbe {
    return { ...probe, outcome: 'refused', error: 'Allocate answered 401' };
}

function facts(patch: Partial<ReachFacts> = {}): ReachFacts {
    return {
        broker: { url: 'wss://broker.example.com', connected: true },
        granted: true,
        probes: [STUN_OK, TURN_UDP, TURN_TCP, TURN_TLS],
        lanDoor: { wanted: true, listening: true, port: 4220, addresses: 1 },
        tunnel: null,
        ...patch
    };
}

describe('classifying how others reach a machine', () => {
    test('a machine whose broker, relay and door all work is reachable', () => {
        expect(classifyReach(facts())).toEqual({ cause: 'ok', severity: 'ok' });
    });

    test('without a broker only the local network reaches it, and nothing does without the door either', () => {
        expect(classifyReach(facts({ broker: { url: null, connected: false } }))).toEqual({ cause: 'broker-off', severity: 'limited' });
        expect(
            classifyReach(facts({ broker: { url: null, connected: false }, lanDoor: { wanted: false, listening: false, port: null, addresses: 0 } }))
        ).toEqual({ cause: 'broker-off', severity: 'unreachable' });
    });

    test('a broker it cannot reach comes before anything about the relay', () => {
        expect(classifyReach(facts({ broker: { url: 'wss://broker.example.com', connected: false }, probes: [] })).cause).toBe('broker-unreachable');
    });

    test('UDP that gets nowhere while TURN over TCP allocates is UDP blocked, relayed', () => {
        expect(classifyReach(facts({ probes: [down(STUN_OK), down(TURN_UDP), TURN_TCP, down(TURN_TLS)] }))).toEqual({
            cause: 'udp-blocked',
            severity: 'relayed'
        });
    });

    test('the same behind a tunnel names the VPN or exit node', () => {
        expect(classifyReach(facts({ probes: [down(STUN_OK), down(TURN_UDP), TURN_TLS], tunnel: 'utun4' }))).toEqual({
            cause: 'vpn-blocks-udp',
            severity: 'relayed'
        });
        expect(classifyReach(facts({ probes: [down(STUN_OK), down(TURN_UDP), down(TURN_TLS)], tunnel: 'wg0' }))).toEqual({
            cause: 'vpn-blocks-udp',
            severity: 'unreachable'
        });
    });

    test('nothing getting out at all is blocked', () => {
        expect(classifyReach(facts({ probes: [STUN_OK, TURN_UDP, TURN_TCP].map(down) }))).toEqual({ cause: 'blocked', severity: 'unreachable' });
    });

    test('a TURN server that answers with a refusal still proves UDP gets out', () => {
        expect(classifyReach(facts({ probes: [down(STUN_OK), refused(TURN_UDP), refused(TURN_TCP)] }))).toEqual({ cause: 'turn-refused', severity: 'limited' });
    });

    test('a relay that does not answer while UDP gets out is TURN unreachable', () => {
        expect(classifyReach(facts({ probes: [STUN_OK, down(TURN_UDP), down(TURN_TCP)] }))).toEqual({ cause: 'turn-unreachable', severity: 'limited' });
    });

    test('a broker that handed out no relay says so', () => {
        expect(classifyReach(facts({ granted: false, probes: [STUN_OK] }))).toEqual({ cause: 'no-relay', severity: 'limited' });
    });

    test('a door that should listen and does not is the last thing that is wrong', () => {
        expect(classifyReach(facts({ lanDoor: { wanted: true, listening: false, port: 4220, addresses: 1 } }))).toEqual({
            cause: 'lan-door-down',
            severity: 'limited'
        });
        expect(reachAdvice('lan-door-down', facts({ lanDoor: { wanted: true, listening: false, port: 4220, addresses: 1 } })).problem).toContain(
            'because port 4220 is taken'
        );
    });

    test('every cause has a problem, and every cause but ok a fix', () => {
        for (const cause of [
            'broker-off',
            'broker-unreachable',
            'no-relay',
            'turn-unreachable',
            'turn-refused',
            'udp-blocked',
            'vpn-blocks-udp',
            'blocked',
            'lan-door-down'
        ]) {
            const advice = reachAdvice(cause, facts({ tunnel: 'utun4' }));
            expect(advice.problem).not.toBe('');
            expect(advice.fix).not.toBeNull();
        }
        expect(reachAdvice('ok', facts()).fix).toBeNull();
        expect(reachAdvice('something-new', facts()).problem).toContain('something-new');
    });
});
