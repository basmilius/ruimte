import { beforeEach, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ToolRefusal } from '@adecore/agents/context';
import { ActionRefusal } from '@ruimte/actions';
import { codeOf } from '../fs/test-boundary.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { StartClaims, startInputHash, type StartClaim } from './start-claims.ts';

let home: string;
let clock: number;

const input = { provider: 'claude', prompt: 'x', requestId: 'r1' };

function claim(overrides: Partial<StartClaim> = {}): StartClaim {
    return { actor: { kind: 'agent', id: 'chat-1' }, requestId: 'r1', inputHash: startInputHash('p1', input), ...overrides };
}

function claims(): StartClaims {
    return new StartClaims(home, () => clock);
}

async function loaded(): Promise<StartClaims> {
    const fresh = claims();
    await fresh.load();
    return fresh;
}

const newHome = tempHomes('ruimte-start-claims-');

beforeEach(async () => {
    home = await newHome();
    clock = 1_000_000;
});

describe('startInputHash', () => {
    test('ignores the request id and nothing else', () => {
        expect(startInputHash('p1', { ...input, requestId: 'other' })).toBe(startInputHash('p1', input));
        expect(startInputHash('p1', { ...input, prompt: 'y' })).not.toBe(startInputHash('p1', input));
        expect(startInputHash('p2', input)).not.toBe(startInputHash('p1', input));
    });
});

describe('StartClaims', () => {
    test('a done claim answers a repeat, also from a new instance after a restart', async () => {
        let made = 0;
        const first = await loaded();
        const answer = await first.run(claim(), async () => ({ nodeId: `chat-${++made}` }));

        const restarted = await loaded();
        const replay = await restarted.run(claim(), async () => ({ nodeId: `chat-${++made}` }));

        expect(replay).toEqual(answer);
        expect(made).toBe(1);
    });

    test('another command under the same id is refused', async () => {
        const store = await loaded();
        await store.run(claim(), async () => 'made');

        expect(await codeOf(store.run(claim({ inputHash: startInputHash('p1', { ...input, prompt: 'y' }) }), async () => 'again'))).toBe('request-id-reused');
    });

    test('another actor gets a start of its own', async () => {
        const store = await loaded();
        await store.run(claim(), async () => 'mine');

        expect(await store.run(claim({ actor: { kind: 'agent', id: 'chat-2' } }), async () => 'theirs')).toBe('theirs');
    });

    test('calls at the same moment run the work once and share the answer', async () => {
        const store = await loaded();
        let runs = 0;
        const work = async (): Promise<string> => {
            runs += 1;
            await Promise.resolve();
            return 'node';
        };

        const answers = await Promise.all([store.run(claim(), work), store.run(claim(), work), store.run(claim(), work)]);

        expect(answers).toEqual(['node', 'node', 'node']);
        expect(runs).toBe(1);
    });

    test.each([
        ['a tool refusal', () => new ToolRefusal('no-room', 'The canvas is full')],
        ['an action refusal', () => new ActionRefusal('no-room', 'The canvas is full')]
    ])('%s frees the id, since nothing was made', async (_name, refusal) => {
        const store = await loaded();
        await expect(
            store.run(claim(), async () => {
                throw refusal();
            })
        ).rejects.toThrow('The canvas is full');

        expect(await store.run(claim(), async () => 'made now')).toBe('made now');
        expect(await readdir(join(home, 'start-claims'))).toHaveLength(1);
    });

    test('any other failure leaves the start unsettled, also after a restart', async () => {
        const store = await loaded();
        await expect(
            store.run(claim(), async () => {
                throw new Error('disk gone');
            })
        ).rejects.toThrow('disk gone');

        expect(await codeOf(store.run(claim(), async () => 'again'))).toBe('request-unsettled');
        expect(await codeOf((await loaded()).run(claim(), async () => 'again'))).toBe('request-unsettled');
    });

    test('a claim older than 24 hours is dropped at load', async () => {
        await (await loaded()).run(claim(), async () => 'old');
        clock += 24 * 60 * 60 * 1000 + 1;

        const restarted = await loaded();

        expect(await restarted.run(claim(), async () => 'new')).toBe('new');
    });

    test('a claim that grew old while the daemon ran is ignored too', async () => {
        const store = await loaded();
        await store.run(claim(), async () => 'old');
        clock += 24 * 60 * 60 * 1000 + 1;

        expect(await store.run(claim(), async () => 'new')).toBe('new');
    });
});
