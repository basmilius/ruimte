import { describe, expect, test } from 'bun:test';
import { runLogout, type LogoutOptions } from './logout.ts';

function harness(daemon: (request: { path: string; authorization: string | undefined }) => Response | null) {
    const out: string[] = [];
    const err: string[] = [];
    const options: LogoutOptions = {
        port: 4210,
        home: '/home/ruimte/.ruimte',
        readSecret: async () => 'secret',
        fetch: async (input, init) => {
            const answer = daemon({ path: new URL(input).pathname, authorization: (init.headers as Record<string, string>).authorization });
            if (answer === null) {
                throw new Error('connection refused');
            }
            return answer;
        },
        out: (line) => out.push(line),
        err: (line) => err.push(line)
    };
    return { out, err, run: () => runLogout(options) };
}

describe('ruimte logout', () => {
    test('takes the machine off its account with the local secret and says how many clients lost access', async () => {
        const asked: string[] = [];
        const { out, run } = harness(({ path, authorization }) => {
            asked.push(`${path} ${authorization}`);
            return Response.json({ revoked: 2 });
        });
        expect(await run()).toBe(0);
        expect(asked).toEqual(['/machine/leave-account Bearer secret']);
        expect(out).toEqual(['This machine is on no account now, and 2 clients that came in through it lost access. `ruimte login` puts it on one.']);
    });

    test('a daemon that is down, refuses the secret or predates the command ends with 1 and a reason', async () => {
        const down = harness(() => null);
        expect(await down.run()).toBe(1);
        expect(down.err).toEqual(['No daemon answers on port 4210; start one first.']);

        const forbidden = harness(() => new Response('Forbidden', { status: 403 }));
        expect(await forbidden.run()).toBe(1);
        expect(forbidden.err[0]).toContain('set RUIMTE_HOME');

        const older = harness(() => new Response('Not found', { status: 404 }));
        expect(await older.run()).toBe(1);
        expect(older.err[0]).toContain('older than `ruimte logout`');
    });
});
