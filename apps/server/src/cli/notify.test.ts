import { describe, expect, test } from 'bun:test';
import { runNotify, type NotifyOptions } from './notify.ts';

function harness(
    daemon: (request: { path: string; authorization: string | undefined; body: unknown }) => Response | null,
    overrides: Partial<NotifyOptions> = {}
) {
    const err: string[] = [];
    const asked: unknown[] = [];
    const options: NotifyOptions = {
        port: 4210,
        home: '/home/ruimte/.ruimte',
        text: 'The build is done',
        env: { RUIMTE_SESSION_ID: 'term-1' },
        readSecret: async () => 'secret',
        fetch: async (input, init) => {
            const request = {
                path: new URL(input).pathname,
                authorization: (init.headers as Record<string, string>).authorization,
                body: JSON.parse(String(init.body))
            };
            asked.push(request);
            const answer = daemon(request);
            if (answer === null) {
                throw new Error('connection refused');
            }
            return answer;
        },
        err: (line) => err.push(line),
        ...overrides
    };
    return { err, asked, run: () => runNotify(options) };
}

describe('ruimte notify', () => {
    test('asks the daemon on the local secret to notify for the terminal it runs in', async () => {
        const { asked, err, run } = harness(({ body }) => Response.json(body));
        expect(await run()).toBe(0);
        expect(asked).toEqual([{ path: '/machine/notify', authorization: 'Bearer secret', body: { nodeId: 'term-1', text: 'The build is done' } }]);
        expect(err).toEqual([]);
    });

    test('--node names another node', async () => {
        const { asked, run } = harness(({ body }) => Response.json(body), { node: 'chat-2' });
        expect(await run()).toBe(0);
        expect(asked).toEqual([expect.objectContaining({ body: { nodeId: 'chat-2', text: 'The build is done' } })]);
    });

    test('refuses without the local secret, and asks the daemon nothing', async () => {
        const { asked, err, run } = harness(() => Response.json({}), {
            readSecret: async () => {
                throw new Error('ENOENT');
            }
        });
        expect(await run()).toBe(1);
        expect(asked).toEqual([]);
        expect(err[0]).toContain('No local secret in /home/ruimte/.ruimte');
    });

    test('refuses without a node or a text, before it reads the secret', async () => {
        const reads: string[] = [];
        const readSecret = async (home: string) => {
            reads.push(home);
            return 'secret';
        };
        const nodeless = harness(() => Response.json({}), { env: {}, readSecret });
        expect(await nodeless.run()).toBe(1);
        expect(nodeless.err[0]).toContain('--node');

        const empty = harness(() => Response.json({}), { text: '  ', readSecret });
        expect(await empty.run()).toBe(1);
        expect(empty.err[0]).toContain('Usage: ruimte notify');
        expect(reads).toEqual([]);
        expect([...nodeless.asked, ...empty.asked]).toEqual([]);
    });

    test('a daemon that is down, refuses the secret, predates the command or knows no such node ends with 1 and a reason', async () => {
        const down = harness(() => null);
        expect(await down.run()).toBe(1);
        expect(down.err[0]).toContain('No Ruimte machine answers on port 4210');

        const forbidden = harness(() => new Response('Forbidden', { status: 403 }));
        expect(await forbidden.run()).toBe(1);
        expect(forbidden.err[0]).toContain('Set RUIMTE_HOME');

        const older = harness(() => new Response('Not found', { status: 404 }));
        expect(await older.run()).toBe(1);
        expect(older.err[0]).toContain('older than `ruimte notify`');

        const gone = harness(() => Response.json({ code: 'node-not-found', message: 'gone' }, { status: 422 }));
        expect(await gone.run()).toBe(1);
        expect(gone.err).toEqual(['No project here holds the node term-1.']);
    });
});
