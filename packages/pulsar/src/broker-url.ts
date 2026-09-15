import { z } from 'zod';

/* The broker every daemon announces itself to unless told otherwise. A name rather than an address,
   so the broker can move to another host through DNS alone. */
export const DEFAULT_BROKER_URL = 'wss://broker.ruimte.app';

const BROKER_URL_MAX = 512;

const isPrivateIpv4 = (host: string): boolean => {
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }
    const [first, second] = parts as [number, number, number, number];
    return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
};

/*
 * Where plain `ws:` is allowed: this machine, a container reaching its host, and a LAN address, which
 * is what a bench or a laptop runs a broker on. Everything a broker carries is signed, but a public
 * broker over plain text would still show who talks to whom to anyone on the path.
 */
const isLocalHost = (hostname: string): boolean => {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        host === 'host.docker.internal' ||
        host === '::1' ||
        isPrivateIpv4(host)
    );
};

/* Why a broker URL cannot be used, or null when it can: `wss:` anywhere, `ws:` only on a local host. */
export const brokerUrlProblem = (value: string): string | null => {
    if (value.length > BROKER_URL_MAX) {
        return `A broker URL is at most ${BROKER_URL_MAX} characters`;
    }
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return 'Not a URL';
    }
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
        return 'A broker URL starts with wss://';
    }
    if (url.hostname === '') {
        return 'A broker URL names a host';
    }
    if (url.protocol === 'ws:' && !isLocalHost(url.hostname)) {
        return 'Plain ws:// is only for a broker on this machine or the local network; use wss://';
    }
    return null;
};

/*
 * What a machine keeps in `endpoint.json` about its broker: the build's default, one of its own, or
 * none at all. A flag or an environment variable on the daemon wins over it.
 */
export const BrokerSettingSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('default') }),
    z.object({ mode: z.literal('off') }),
    z.object({
        mode: z.literal('custom'),
        url: z.string().superRefine((url, context) => {
            const problem = brokerUrlProblem(url);
            if (problem !== null) {
                context.addIssue({ code: 'custom', message: problem });
            }
        })
    })
]);
export type BrokerSetting = z.infer<typeof BrokerSettingSchema>;

/* What the flag or the environment says, if anything: a URL, off, or null to leave it to the setting. */
export type BrokerOverride = { mode: 'off' } | { mode: 'custom'; url: string } | null;

/* The broker a daemon dials: the flag or the environment, then the machine's setting, then the default. */
export const effectiveBrokerUrl = (override: BrokerOverride, setting: BrokerSetting): string | null => {
    const decided = override ?? setting;
    if (decided.mode === 'off') {
        return null;
    }
    return decided.mode === 'custom' ? decided.url : DEFAULT_BROKER_URL;
};
