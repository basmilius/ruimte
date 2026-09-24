import { describe, expect, test } from 'bun:test';
import { isCloudflareAddress } from './cloudflare.ts';
import { clientIpOf, DEFAULT_LIMITS, DEFAULT_PORT, nameFor, parseBrokerArgs } from './config.ts';
import { RateLimiter } from './rate-limit.ts';

describe('parseBrokerArgs', () => {
    test('defaults to loopback, its own port and the default limits', () => {
        const config = parseBrokerArgs([], {});
        expect(config).toEqual({
            host: '127.0.0.1',
            port: DEFAULT_PORT,
            names: [],
            trustProxy: false,
            trustCloudflare: false,
            limits: DEFAULT_LIMITS,
            turn: { kind: 'none' }
        });
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

describe('the TURN flags', () => {
    test('pick a provider from a flag or the environment, with the ttl an hour unless said', () => {
        expect(
            parseBrokerArgs(['--turn', 'shared-secret', '--turn-secret-file', '/etc/turn-secret', '--turn-url', 'turn:turn.example.com:3478?transport=udp'], {})
                .turn
        ).toEqual({ kind: 'shared-secret', secretFile: '/etc/turn-secret', urls: ['turn:turn.example.com:3478?transport=udp'], ttlSeconds: 3_600 });
        expect(
            parseBrokerArgs([], {
                PULSAR_BROKER_TURN: 'shared-secret',
                PULSAR_BROKER_TURN_SECRET_FILE: '/etc/turn-secret',
                PULSAR_BROKER_TURN_URLS: 'turn:a.example.com:3478, turns:a.example.com:5349?transport=tcp',
                PULSAR_BROKER_TURN_TTL_SECONDS: '600'
            }).turn
        ).toEqual({
            kind: 'shared-secret',
            secretFile: '/etc/turn-secret',
            urls: ['turn:a.example.com:3478', 'turns:a.example.com:5349?transport=tcp'],
            ttlSeconds: 600
        });
        expect(parseBrokerArgs(['--turn', 'cloudflare', '--cloudflare-turn-key-id', 'k', '--cloudflare-turn-token-file', '/etc/cf'], {}).turn).toEqual({
            kind: 'cloudflare',
            keyId: 'k',
            tokenFile: '/etc/cf',
            ttlSeconds: 3_600
        });
        expect(parseBrokerArgs(['--key-ice-per-minute', '3'], {}).limits.iceRequestsPerMinutePerKey).toBe(3);
        expect(parseBrokerArgs([], { PULSAR_BROKER_IP_ICE_PER_MINUTE: '7' }).limits.iceRequestsPerMinutePerIp).toBe(7);
    });

    test('refuse a provider without what it needs, a URL that is no TURN URL and a kind they do not know', () => {
        expect(() => parseBrokerArgs(['--turn', 'shared-secret', '--turn-url', 'turn:a.example.com'], {})).toThrow(/--turn-secret-file/);
        expect(() => parseBrokerArgs(['--turn', 'shared-secret', '--turn-secret-file', '/s', '--turn-url', 'stun:a.example.com'], {})).toThrow(/--turn-url/);
        expect(() => parseBrokerArgs(['--turn', 'cloudflare'], {})).toThrow(/--cloudflare-turn-key-id/);
        expect(() => parseBrokerArgs(['--turn', 'twilio'], {})).toThrow(/--turn/);
        expect(() => parseBrokerArgs(['--turn-ttl-seconds', '5'], {})).toThrow(/--turn-ttl-seconds/);
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
    const proxy = { trustProxy: true, trustCloudflare: false };
    const none = { trustProxy: false, trustCloudflare: false };
    const forwarded = (forwardedFor: string | null, cfConnectingIp: string | null = null) => ({ forwardedFor, cfConnectingIp });

    test('believes the last forwarded entry only behind a trusted proxy on loopback', () => {
        expect(clientIpOf('::ffff:203.0.113.9', forwarded(null), none)).toBe('203.0.113.9');
        expect(clientIpOf('127.0.0.1', forwarded('198.51.100.1, 203.0.113.9'), proxy)).toBe('203.0.113.9');
        expect(clientIpOf('127.0.0.1', forwarded('203.0.113.9'), none)).toBe('127.0.0.1');
        // A client that reaches the broker directly cannot pick its own address with the header.
        expect(clientIpOf('203.0.113.9', forwarded('198.51.100.1'), proxy)).toBe('203.0.113.9');
    });

    test('believes CF-Connecting-IP only from a Cloudflare address, and only when told to', () => {
        const cloudflare = { trustProxy: true, trustCloudflare: true };
        // Cloudflare's edge in front of Caddy: the proxy saw an edge address and passes the real client on.
        expect(clientIpOf('127.0.0.1', forwarded('198.51.100.1, 172.70.1.2', '198.51.100.1'), cloudflare)).toBe('198.51.100.1');
        expect(clientIpOf('127.0.0.1', forwarded('2400:cb00:1::5', '2001:db8::7'), cloudflare)).toBe('2001:db8::7');
        // Straight from the edge, without a proxy of its own.
        expect(clientIpOf('::ffff:104.16.0.9', forwarded(null, '198.51.100.1'), { trustProxy: false, trustCloudflare: true })).toBe('198.51.100.1');
        // Anyone else who writes the header, directly or through the local proxy, is counted as themselves.
        expect(clientIpOf('203.0.113.9', forwarded(null, '198.51.100.1'), cloudflare)).toBe('203.0.113.9');
        expect(clientIpOf('127.0.0.1', forwarded('172.70.1.2, 203.0.113.9', '198.51.100.1'), cloudflare)).toBe('203.0.113.9');
        // Without the switch an edge address is only an address, and a header that is no address is ignored.
        expect(clientIpOf('127.0.0.1', forwarded('172.70.1.2', '198.51.100.1'), proxy)).toBe('172.70.1.2');
        expect(clientIpOf('127.0.0.1', forwarded('172.70.1.2', 'not an address'), cloudflare)).toBe('172.70.1.2');
        // A trusted local proxy is still required before its header counts as what the connection came from.
        expect(clientIpOf('127.0.0.1', forwarded('172.70.1.2', '198.51.100.1'), { trustProxy: false, trustCloudflare: true })).toBe('127.0.0.1');
    });

    test('knows the edge ranges, IPv4 and IPv6, and nothing next to them', () => {
        expect(isCloudflareAddress('173.245.48.1')).toBe(true);
        expect(isCloudflareAddress('173.245.64.1')).toBe(false);
        expect(isCloudflareAddress('::ffff:162.159.255.255')).toBe(true);
        expect(isCloudflareAddress('2a06:98c7:ffff::1')).toBe(true);
        expect(isCloudflareAddress('2a06:98c8::1')).toBe(false);
        expect(isCloudflareAddress('2606:4700:3033::6815:2be0')).toBe(true);
        expect(isCloudflareAddress('127.0.0.1')).toBe(false);
        expect(isCloudflareAddress('garbage')).toBe(false);
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
