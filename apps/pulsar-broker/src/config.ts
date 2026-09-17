import { isIP } from 'node:net';
import { parseArgs } from 'node:util';
import { isCloudflareAddress } from './cloudflare.ts';

export interface BrokerLimits {
    /* A frame larger than this closes the socket. An offer is a few KiB; the schema caps an SDP at 32 KiB. */
    maxMessageBytes: number;
    maxSocketsPerIp: number;
    connectionsPerMinutePerIp: number;
    framesPerSecondPerIp: number;
    relaysPerMinutePerKey: number;
    announcesPerMinutePerKey: number;
    /* A daemon asks after every announcement and before its credentials expire, a client once per attempt. */
    iceRequestsPerMinutePerKey: number;
    /* How often a socket is pinged; one that answers nothing for twice this long is dropped. */
    heartbeatMs: number;
    /* How long a socket may take from opening to a verified signature. */
    helloTimeoutMs: number;
}

export interface BrokerConfig {
    host: string;
    port: number;
    /*
     * The host names this broker answers to and signs into its challenge. Empty takes the `Host`
     * header as it comes, which is fine on a laptop; a public broker names itself, or a service in
     * the middle could hand a peer this broker's nonce under its own name.
     */
    names: string[];
    /* Read the client address from `X-Forwarded-For`, for a broker behind a proxy on the same host. */
    trustProxy: boolean;
    /* Read the client address from `CF-Connecting-IP`, but only on a connection that came from Cloudflare's edge. */
    trustCloudflare: boolean;
    limits: BrokerLimits;
    turn: TurnConfig;
}

/* Where TURN credentials come from; `none` unless configured, so a broker hands out nothing by default. */
export type TurnConfig =
    | { kind: 'none' }
    | { kind: 'shared-secret'; secretFile: string; urls: string[]; ttlSeconds: number }
    | { kind: 'cloudflare'; keyId: string; tokenFile: string; ttlSeconds: number };

export const DEFAULT_TURN_TTL_SECONDS = 86_400;

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4400;

export const DEFAULT_LIMITS: BrokerLimits = {
    maxMessageBytes: 64 * 1024,
    maxSocketsPerIp: 32,
    connectionsPerMinutePerIp: 30,
    framesPerSecondPerIp: 20,
    relaysPerMinutePerKey: 60,
    announcesPerMinutePerKey: 10,
    iceRequestsPerMinutePerKey: 10,
    heartbeatMs: 25_000,
    helloTimeoutMs: 10_000
};

interface NumberOption {
    flag: string;
    min: number;
    max: number;
    fallback: number;
}

/* `--key-relays-per-minute` reads `PULSAR_BROKER_KEY_RELAYS_PER_MINUTE` when the flag is not given. */
const envNameOf = (flag: string): string => `PULSAR_BROKER_${flag.replaceAll('-', '_').toUpperCase()}`;

const readNumber = (value: string | undefined, env: Record<string, string | undefined>, option: NumberOption): number => {
    const raw = value ?? env[envNameOf(option.flag)];
    if (raw === undefined || raw === '') {
        return option.fallback;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < option.min || parsed > option.max) {
        throw new Error(`Invalid --${option.flag}: ${raw} (a whole number from ${option.min} to ${option.max})`);
    }
    return parsed;
};

const LIMIT_FLAGS = [
    'max-message-bytes',
    'max-sockets-per-ip',
    'ip-connections-per-minute',
    'ip-frames-per-second',
    'key-relays-per-minute',
    'key-announces-per-minute',
    'key-ice-per-minute',
    'heartbeat-seconds',
    'hello-timeout-seconds'
] as const;

export const parseBrokerArgs = (argv: string[], env: Record<string, string | undefined> = process.env): BrokerConfig => {
    const { values } = parseArgs({
        args: argv,
        options: {
            host: { type: 'string' },
            port: { type: 'string' },
            name: { type: 'string', multiple: true, default: [] },
            'trust-proxy': { type: 'boolean', default: false },
            'trust-cloudflare': { type: 'boolean', default: false },
            turn: { type: 'string' },
            'turn-secret-file': { type: 'string' },
            'turn-url': { type: 'string', multiple: true, default: [] },
            'turn-ttl-seconds': { type: 'string' },
            'cloudflare-turn-key-id': { type: 'string' },
            'cloudflare-turn-token-file': { type: 'string' },
            ...Object.fromEntries(LIMIT_FLAGS.map((flag) => [flag, { type: 'string' as const }]))
        },
        strict: true,
        allowPositionals: false
    });
    const flags = values as unknown as Record<string, string | undefined>;
    const number = (flag: string, min: number, max: number, fallback: number): number => readNumber(flags[flag], env, { flag, min, max, fallback });

    const names = values.name.length > 0 ? values.name : (env.PULSAR_BROKER_NAMES ?? '').split(',');
    return {
        host: values.host ?? env.PULSAR_BROKER_HOST ?? DEFAULT_HOST,
        port: number('port', 0, 65_535, DEFAULT_PORT),
        names: names.map((name) => name.trim().toLowerCase()).filter((name) => name !== ''),
        trustProxy: values['trust-proxy'] || env.PULSAR_BROKER_TRUST_PROXY === '1',
        trustCloudflare: values['trust-cloudflare'] || env.PULSAR_BROKER_TRUST_CLOUDFLARE === '1',
        limits: {
            maxMessageBytes: number('max-message-bytes', 1024, 1024 * 1024, DEFAULT_LIMITS.maxMessageBytes),
            maxSocketsPerIp: number('max-sockets-per-ip', 1, 100_000, DEFAULT_LIMITS.maxSocketsPerIp),
            connectionsPerMinutePerIp: number('ip-connections-per-minute', 1, 100_000, DEFAULT_LIMITS.connectionsPerMinutePerIp),
            framesPerSecondPerIp: number('ip-frames-per-second', 1, 100_000, DEFAULT_LIMITS.framesPerSecondPerIp),
            relaysPerMinutePerKey: number('key-relays-per-minute', 1, 100_000, DEFAULT_LIMITS.relaysPerMinutePerKey),
            announcesPerMinutePerKey: number('key-announces-per-minute', 1, 100_000, DEFAULT_LIMITS.announcesPerMinutePerKey),
            iceRequestsPerMinutePerKey: number('key-ice-per-minute', 1, 100_000, DEFAULT_LIMITS.iceRequestsPerMinutePerKey),
            // A peer gives up on a broker it has not heard from in 90 seconds, so a ping has to come well inside that.
            heartbeatMs: number('heartbeat-seconds', 1, 40, DEFAULT_LIMITS.heartbeatMs / 1000) * 1000,
            helloTimeoutMs: number('hello-timeout-seconds', 1, 120, DEFAULT_LIMITS.helloTimeoutMs / 1000) * 1000
        },
        turn: turnConfigOf(flags, values['turn-url'], env, number)
    };
};

const turnConfigOf = (
    flags: Record<string, string | undefined>,
    urlFlags: string[],
    env: Record<string, string | undefined>,
    number: (flag: string, min: number, max: number, fallback: number) => number
): TurnConfig => {
    const text = (flag: string): string => (flags[flag] ?? env[envNameOf(flag)] ?? '').trim();
    const kind = text('turn') || 'none';
    // Credentials that outlive a day are what a leaked one costs; a minute is shorter than an attempt.
    const ttlSeconds = number('turn-ttl-seconds', 60, 7 * 86_400, DEFAULT_TURN_TTL_SECONDS);
    if (kind === 'none') {
        return { kind: 'none' };
    }
    if (kind === 'shared-secret') {
        const urls = (urlFlags.length > 0 ? urlFlags : (env.PULSAR_BROKER_TURN_URLS ?? '').split(',')).map((url) => url.trim()).filter((url) => url !== '');
        const secretFile = text('turn-secret-file');
        if (secretFile === '' || urls.length === 0) {
            throw new Error('--turn shared-secret needs --turn-secret-file and at least one --turn-url');
        }
        const wrong = urls.find((url) => !/^turns?:/.test(url));
        if (wrong !== undefined) {
            throw new Error(`Invalid --turn-url: ${wrong} (a turn: or turns: URL)`);
        }
        return { kind, secretFile, urls, ttlSeconds };
    }
    if (kind === 'cloudflare') {
        const keyId = text('cloudflare-turn-key-id');
        const tokenFile = text('cloudflare-turn-token-file');
        if (keyId === '' || tokenFile === '') {
            throw new Error('--turn cloudflare needs --cloudflare-turn-key-id and --cloudflare-turn-token-file');
        }
        return { kind, keyId, tokenFile, ttlSeconds };
    }
    throw new Error(`Invalid --turn: ${kind} (none, shared-secret or cloudflare)`);
};

/*
 * The name a socket signs into its answer. With names configured the `Host` header has to be one of
 * them, and null refuses the upgrade; without, the header is taken as it is.
 */
export const nameFor = (hostHeader: string | null, names: string[]): string | null => {
    const host = hostHeader?.trim().toLowerCase() ?? '';
    if (names.length === 0) {
        return host === '' ? null : host;
    }
    return names.includes(host) ? host : null;
};

const stripMappedPrefix = (address: string): string => (address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address);

const isLoopback = (address: string): boolean => address === '::1' || address.startsWith('127.');

export interface ClientHeaders {
    forwardedFor: string | null;
    cfConnectingIp: string | null;
}

export interface ProxyTrust {
    trustProxy: boolean;
    trustCloudflare: boolean;
}

/*
 * Trust the last forwarded address only from a loopback proxy. Trust `CF-Connecting-IP` only when
 * the resulting peer is in Cloudflare's ranges, otherwise clients could choose their rate-limit key.
 */
export const clientIpOf = (socketAddress: string, headers: ClientHeaders, trust: ProxyTrust): string => {
    const socket = stripMappedPrefix(socketAddress);
    let seen = socket;
    if (trust.trustProxy && headers.forwardedFor !== null && isLoopback(socket)) {
        const last = headers.forwardedFor.split(',').at(-1)?.trim() ?? '';
        seen = last === '' ? socket : stripMappedPrefix(last);
    }
    const connecting = headers.cfConnectingIp?.trim() ?? '';
    if (trust.trustCloudflare && isIP(connecting) !== 0 && isCloudflareAddress(seen)) {
        return stripMappedPrefix(connecting);
    }
    return seen;
};
