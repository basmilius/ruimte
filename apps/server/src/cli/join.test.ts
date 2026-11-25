import { describe, expect, test } from 'bun:test';
import { JOIN_WAIT_MS, runJoin, type JoinOptions } from './join.ts';

const REGISTRATION = {
    id: 'workbench',
    name: 'workbench',
    icon: null,
    publicKey: Buffer.from(Uint8Array.from({ length: 32 }, (_value, i) => i)).toString('base64url'),
    brokerUrl: 'wss://broker.ruimte.app',
    issuedAt: 1_000_000,
    signature: 's'.repeat(86)
};

interface Asked {
    path: string;
    authorization: string | undefined;
    body: unknown;
}

function harness(daemon: (asked: Asked, attempt: number) => Response | null, extra: Partial<JoinOptions> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const asked: Asked[] = [];
    let clock = 0;
    const options: JoinOptions = {
        port: 4210,
        home: '/home/ruimte/.ruimte',
        accountId: 'account-1',
        readSecret: async () => 'secret',
        fetch: async (input, init) => {
            const ask = {
                path: new URL(input).pathname,
                authorization: (init.headers as Record<string, string>).authorization,
                body: JSON.parse(String(init.body))
            };

            asked.push(ask);

            const answer = daemon(ask, asked.length);

            if (answer === null) {
                throw new Error('connection refused');
            }

            return answer;
        },
        sleep: async (ms) => {
            clock += ms;
        },
        now: () => clock,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        ...extra
    };

    return { out, err, asked, run: () => runJoin(options) };
}

describe('ruimte join', () => {
    test('has the daemon sign for the account on the local secret and prints the registration as one line of JSON', async () => {
        const { out, err, asked, run } = harness(() => Response.json(REGISTRATION));

        expect(await run()).toBe(0);
        expect(asked).toEqual([{ path: '/machine/registration', authorization: 'Bearer secret', body: { accountId: 'account-1' } }]);
        expect(out.map((line) => JSON.parse(line))).toEqual([REGISTRATION]);
        expect(err).toEqual([]);
    });

    test('waits for a daemon that has not written its secret or does not answer yet', async () => {
        let reads = 0;
        const { out, asked, run } = harness((_asked, attempt) => (attempt < 3 ? null : Response.json(REGISTRATION)), {
            readSecret: async () => {
                reads += 1;

                if (reads < 3) {
                    throw new Error('no such file');
                }

                return 'secret';
            }
        });

        expect(await run()).toBe(0);
        expect(reads).toBe(5);
        expect(asked).toHaveLength(3);
        expect(out).toHaveLength(1);
    });

    test('gives up on a daemon that never answers, after a bounded wait', async () => {
        let slept = 0;
        const down = harness(() => null, {
            sleep: async (ms) => {
                slept += ms;
            },
            now: () => slept
        });

        expect(await down.run()).toBe(1);
        expect(slept).toBe(JOIN_WAIT_MS);
        expect(down.err).toEqual([expect.stringContaining('No daemon answers on port 4210.')]);
        expect(down.out).toEqual([]);
    });

    test('waits for a daemon of a home with a secret from an earlier run that holds its port and is still starting', async () => {
        const starting = (): Response => new Response('The machine is starting', { status: 503 });
        const restarted = harness((_asked, attempt) => (attempt < 3 ? starting() : Response.json(REGISTRATION)));

        expect(await restarted.run()).toBe(0);
        expect(restarted.asked).toHaveLength(3);
        expect(restarted.out.map((line) => JSON.parse(line))).toEqual([REGISTRATION]);
        expect(restarted.err).toEqual([]);

        const stuck = harness(starting);

        expect(await stuck.run()).toBe(1);
        expect(stuck.err).toEqual(['The daemon on port 4210 is still starting. Try again in a moment.']);
        expect(stuck.out).toEqual([]);
    });

    test('says that the machine is on another account, and prints nothing', async () => {
        const { out, err, run } = harness(() =>
            Response.json({ code: 'machine-has-account', message: 'This machine is on another account.' }, { status: 409 })
        );

        expect(await run()).toBe(1);
        expect(out).toEqual([]);
        expect(err).toEqual(['This machine is on another account. Take it off that account first, with `ruimte logout` on this machine.']);
    });

    test('a daemon that refuses the secret, predates the command or answers something else ends with 1 and a reason', async () => {
        const forbidden = harness(() => new Response('Forbidden', { status: 403 }));

        expect(await forbidden.run()).toBe(1);
        expect(forbidden.err[0]).toContain('set RUIMTE_HOME');

        const older = harness(() => new Response('Not found', { status: 404 }));

        expect(await older.run()).toBe(1);
        expect(older.err[0]).toContain('older than `ruimte join`');

        const unreadable = harness(() => Response.json({ id: 'workbench' }));

        expect(await unreadable.run()).toBe(1);
        expect(unreadable.out).toEqual([]);

        const unnamed = harness(() => Response.json(REGISTRATION), { accountId: '' });

        expect(await unnamed.run()).toBe(1);
        expect(unnamed.asked).toEqual([]);
    });
});
