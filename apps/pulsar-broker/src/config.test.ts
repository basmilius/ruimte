import { describe, expect, test } from 'bun:test';
import { clientIpOf, DEFAULT_LIMITS, DEFAULT_PORT, nameFor, parseBrokerArgs } from './config.ts';
import { RateLimiter } from './rate-limit.ts';

describe('parseBrokerArgs', () => {
    test('defaults to loopback, its own port and the default limits', () => {
        const config = parseBrokerArgs([], {});
        expect(config).toEqual({ host: '127.0.0.1', port: DEFAULT_PORT, names: [], trustProxy: false, limits: DEFAULT_LIMITS });
    });

    test('flags win over the environment, and the environment over the defaults', () => {
        const env = {
            PULSAR_BROKER_PORT: '5000',
            PULSAR_BROKER_KEY_RELAYS_PER_MINUTE: '12',
            PULSAR_BROKER_NAMES: 'Broker.Example.com, other.example.com',
            PULSAR_BROKER_TRUST_PROXY: '1'
        };
        const config = parseBrokerArgs(['--port', '6000', '--heartbeat-seconds', '10'], env);
        expect(config.port).toBe(6000);
        expect(config.limits.relaysPerMinutePerKey).toBe(12);
        expect(config.limits.heartbeatMs).toBe(10_000);
        expect(config.names).toEqual(['broker.example.com', 'other.example.com']);
        expect(config.trustProxy).toBe(true);
        expect(parseBrokerArgs(['--name', 'a.example.com', '--name', 'b.example.com'], env).names).toEqual(['a.example.com', 'b.example.com']);
    });

    test('refuses a limit that is not a whole number in range, and a flag it does not know', () => {
        expect(() => parseBrokerArgs(['--max-sockets-per-ip', '0'], {})).toThrow(/--max-sockets-per-ip/);
        expect(() => parseBrokerArgs(['--heartbeat-seconds', '90'], {})).toThrow(/--heartbeat-seconds/);
        expect(() => parseBrokerArgs([], { PULSAR_BROKER_IP_FRAMES_PER_SECOND: '2.5' })).toThrow(/--ip-frames-per-second/);
        expect(() => parseBrokerArgs(['--database', 'x'], {})).toThrow();
    });
});

describe('nameFor', () => {
    test('takes the Host header when no names are set, and only a listed name otherwise', () => {
        expect(nameFor('127.0.0.1:4400', [])).toBe('127.0.0.1:4400');
        expect(nameFor(null, [])).toBeNull();
        expect(nameFor('Broker.Example.com', ['broker.example.com'])).toBe('broker.example.com');
        expect(nameFor('evil.example.com', ['broker.example.com'])).toBeNull();
    });
});

describe('clientIpOf', () => {
    test('believes the last forwarded entry only behind a trusted proxy on loopback', () => {
        expect(clientIpOf('::ffff:203.0.113.9', null, false)).toBe('203.0.113.9');
        expect(clientIpOf('127.0.0.1', '198.51.100.1, 203.0.113.9', true)).toBe('203.0.113.9');
        expect(clientIpOf('127.0.0.1', '203.0.113.9', false)).toBe('127.0.0.1');
        // A client that reaches the broker directly cannot pick its own address with the header.
        expect(clientIpOf('203.0.113.9', '198.51.100.1', true)).toBe('203.0.113.9');
    });
});

describe('RateLimiter', () => {
    test('hands out its capacity, then refills evenly, and forgets a key that is full again', () => {
        let now = 0;
        const limiter = new RateLimiter(3, 3_000, () => now);
        expect([limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([0, 0, 0]);
        expect(limiter.take('a')).toBe(1_000);
        expect(limiter.take('b')).toBe(0);
        now = 1_000;
        expect(limiter.take('a')).toBe(0);
        now = 10_000;
        limiter.prune();
        expect(limiter.size).toBe(0);
    });
});
