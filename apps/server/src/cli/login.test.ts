import { describe, expect, test } from 'bun:test';
import type { DeviceLinkPollResult } from '@ruimte/pulsar';
import { runLogin, type LoginOptions } from './login.ts';

const MACHINE_KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_value, i) => i)).toString('base64url');
const DEVICE_CODE = 'd'.repeat(43);
const SIGNATURE = 's'.repeat(86);
const ACCOUNT = { id: 'account-1', provider: 'github', login: 'octo' } as const;
const NOW = 1_000_000;

interface Fakes {
    polls: Array<DeviceLinkPollResult | 'network' | 'refused'>;
    daemon?: 'down' | 'forbidden';
    startRefusal?: boolean;
}

interface Recorded {
    registrationFor: string[];
    completes: unknown[];
    cancels: number;
    out: string[];
    err: string[];
}

const answer = (body: unknown, status = 200): Response => Response.json(body, { status });

/*
 * A daemon and an address book as one fake fetch: the daemon answers on loopback with signed-looking
 * payloads, the address book walks through the scripted polls.
 */
const harness = (fakes: Fakes, extra: Partial<LoginOptions> = {}) => {
    const recorded: Recorded = { registrationFor: [], completes: [], cancels: 0, out: [], err: [] };
    const fetch = async (input: string, init: RequestInit): Promise<Response> => {
        const url = new URL(input);
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
        if (url.hostname === '127.0.0.1') {
            if (fakes.daemon === 'down') {
                throw new Error('connection refused');
            }
            if (fakes.daemon === 'forbidden' || (init.headers as Record<string, string>).authorization !== 'Bearer secret') {
                return new Response('Forbidden', { status: 403 });
            }
            const machine = { id: 'droplet', name: 'droplet', icon: null, brokerUrl: 'wss://broker.ruimte.app', publicKey: MACHINE_KEY };
            if (url.pathname === '/machine/link-request') {
                return answer({ ...machine, issuedAt: NOW, signature: SIGNATURE });
            }
            if (url.pathname === '/machine/registration') {
                recorded.registrationFor.push(String(body?.accountId));
                return answer({ ...machine, issuedAt: NOW + 1, signature: SIGNATURE });
            }
            return new Response('Not found', { status: 404 });
        }
        switch (url.pathname) {
            case '/v1/device/start':
                if (fakes.startRefusal) {
                    return answer({ error: { code: 'rate-limited', message: 'Too many requests, try again in 30 s' } }, 429);
                }
                return answer({
                    deviceCode: DEVICE_CODE,
                    userCode: 'BCDF-GHJK',
                    verificationUri: 'https://station.ruimte.app/link',
                    verificationUriComplete: 'https://station.ruimte.app/link?code=BCDF-GHJK',
                    expiresAt: NOW + 600_000,
                    interval: 5
                });
            case '/v1/device/poll': {
                const next = fakes.polls.shift() ?? { status: 'pending', interval: 5, account: null };
                if (next === 'network') {
                    throw new Error('offline');
                }
                if (next === 'refused') {
                    return answer({ error: { code: 'not-found', message: 'No such link; it expired or was used' } }, 404);
                }
                return answer(next);
            }
            case '/v1/device/complete':
                recorded.completes.push(body);
                return answer({
                    machine: { id: 'droplet', name: 'droplet', icon: null, publicKey: MACHINE_KEY, brokerUrl: 'wss://broker.ruimte.app', lastSeenAt: NOW },
                    account: ACCOUNT
                });
            case '/v1/device/cancel':
                recorded.cancels++;
                return new Response(null, { status: 204 });
        }
        return new Response('unexpected', { status: 599 });
    };
    const options: LoginOptions = {
        port: 4210,
        home: '/home/ruimte/.ruimte',
        addressBookUrl: 'https://pulsar.test',
        fetch,
        readSecret: async () => 'secret',
        sleep: async () => undefined,
        now: () => NOW,
        out: (line) => recorded.out.push(line),
        err: (line) => recorded.err.push(line),
        ...extra
    };
    return { recorded, run: () => runLogin(options) };
};

const pending: DeviceLinkPollResult = { status: 'pending', interval: 5, account: null };

describe('ruimte login', () => {
    test('prints the page, the code and the fingerprint, and finishes for the account that approved', async () => {
        const { recorded, run } = harness({ polls: [pending, 'network', pending, { status: 'approved', interval: 5, account: ACCOUNT }] });
        expect(await run()).toBe(0);
        const printed = recorded.out.join('\n');
        expect(printed).toContain('https://station.ruimte.app/link?code=BCDF-GHJK');
        expect(printed).toContain('  BCDF-GHJK');
        expect(printed).toContain('Key fingerprint: 0001 0203 0405 0607');
        expect(printed).toContain('The code works for 10 minutes.');
        expect(recorded.out.at(-1)).toBe("Added to octo's account. Clients signed in to it can open droplet now.");
        expect(recorded.registrationFor).toEqual(['account-1']);
        expect(recorded.completes).toEqual([{ deviceCode: DEVICE_CODE, issuedAt: NOW + 1, signature: SIGNATURE }]);
    });

    test('a denial, a withdrawn code and an expired one end without a registration', async () => {
        for (const status of ['denied', 'cancelled', 'expired'] as const) {
            const { recorded, run } = harness({ polls: [{ status, interval: 5, account: null }] });
            expect(await run()).toBe(1);
            expect(recorded.err).toHaveLength(1);
            expect(recorded.registrationFor).toEqual([]);
        }
    });

    test('a link the address book no longer knows ends with its reason', async () => {
        const { recorded, run } = harness({ polls: ['refused'] });
        expect(await run()).toBe(1);
        expect(recorded.err).toEqual(['The address book refused: No such link; it expired or was used']);
    });

    test('an address book that stays unreachable is given up on', async () => {
        const { recorded, run } = harness({ polls: ['network', 'network', 'network', 'network', 'network'] });
        expect(await run()).toBe(1);
        expect(recorded.err[0]).toContain('could not be reached');
    });

    test('the terminal gives up on its own once the code and the grace after it ran out', async () => {
        let clock = NOW;
        const { recorded, run } = harness(
            { polls: [] },
            {
                now: () => clock,
                sleep: async (ms) => {
                    clock += ms * 60;
                }
            }
        );
        expect(await run()).toBe(1);
        expect(recorded.err).toEqual(['The code expired before anyone approved it. Run `ruimte login` again for a new one.']);
    });

    test('stopping withdraws the code and ends with 130', async () => {
        const stop = new AbortController();
        const { recorded, run } = harness(
            { polls: [pending] },
            {
                signal: stop.signal,
                sleep: async () => {
                    stop.abort();
                }
            }
        );
        expect(await run()).toBe(130);
        expect(recorded.cancels).toBe(1);
    });

    test('without a home, a daemon or the right secret nothing reaches the address book', async () => {
        const noHome = harness({ polls: [] }, { readSecret: async () => Promise.reject(new Error('ENOENT')) });
        expect(await noHome.run()).toBe(1);
        expect(noHome.recorded.err[0]).toContain('No daemon has started with /home/ruimte/.ruimte');

        const down = harness({ polls: [], daemon: 'down' });
        expect(await down.run()).toBe(1);
        expect(down.recorded.err).toEqual(['No daemon answers on port 4210; start one first.']);

        const forbidden = harness({ polls: [], daemon: 'forbidden' });
        expect(await forbidden.run()).toBe(1);
        expect(forbidden.recorded.err[0]).toContain('set RUIMTE_HOME');
    });

    test('a refused start says why', async () => {
        const { recorded, run } = harness({ polls: [], startRefusal: true });
        expect(await run()).toBe(1);
        expect(recorded.err).toEqual(['The address book refused: Too many requests, try again in 30 s']);
    });
});
