import { beforeEach, describe, expect, test } from 'bun:test';
import type { SecretAsk, SecretOutcome } from '../secrets/secret-requests.ts';
import type { CanvasHost, Noun, Verb } from './verb.ts';
import { launchReading as reading, printed } from './verb-test-helpers.ts';
import { verbNamed } from './verbs.ts';

const noun = verbNamed('secret') as Noun;

let asks: { ask: SecretAsk; waitMs: number | undefined }[];
let outcome: SecretOutcome;
let host: CanvasHost;

beforeEach(() => {
    asks = [];
    outcome = 'saved';
    host = {
        projects: {
            locate: (id: string) => ({ projectId: 'p1', folder: '/tmp/p1', canvasId: id === 'term-1' || id === 'chat-1' ? 'main' : null }),
            read: async () => ({
                views: [
                    {
                        id: 'main',
                        kind: 'canvas',
                        nodes: [
                            { id: 'chat-1', kind: 'chat' },
                            { id: 'term-1', kind: 'terminal' }
                        ]
                    }
                ]
            })
        },
        launches: {
            list: async () => [reading('api', { name: 'API' }), reading('stack', { name: 'Stack', kind: 'group', members: ['api'] })],
            text: async () => null,
            start: async () => ({ outcome: 'started' }),
            stop: async () => 0
        },
        secrets: {
            ask: async (ask: SecretAsk, waitMs?: number) => {
                asks.push({ ask, waitMs });
                return { requestId: 'req-1', outcome };
            }
        }
    } as unknown as CanvasHost;
});

function run(argv: string[], caller = 'chat-1'): Promise<string[]> {
    return printed(noun, argv, { caller, host });
}

const REQUEST = ['request', '--launch', 'API', '--variable', 'API_KEY', '--label', 'Stripe test key', '--reason', 'Checkout calls Stripe'];

describe('ruimte-context secret', () => {
    test('asks for a launch by name and prints only the outcome', async () => {
        expect(await run([...REQUEST, '--placeholder', 'sk_test_...', '--wait', '60'])).toEqual(['request\treq-1\tsaved\tapi\tAPI\tAPI_KEY']);
        expect(asks).toEqual([
            {
                ask: {
                    nodeId: 'chat-1',
                    projectId: 'p1',
                    launchId: 'api',
                    launchName: 'API',
                    variable: 'API_KEY',
                    label: 'Stripe test key',
                    reason: 'Checkout calls Stripe',
                    placeholder: 'sk_test_...'
                },
                waitMs: 60_000
            }
        ]);
    });

    test('passes every outcome on, the default hold included', async () => {
        for (const next of ['declined', 'cancelled', 'timed-out', 'waiting'] as const) {
            outcome = next;
            expect((await run(REQUEST))[0]).toBe(`request\treq-1\t${next}\tapi\tAPI\tAPI_KEY`);
        }
        expect(asks.at(-1)?.waitMs).toBeUndefined();
    });

    test('refuses a terminal, a group, a reserved or malformed variable and a missing flag', async () => {
        expect((await run(REQUEST, 'term-1'))[0]).toStartWith('refused\tsecret-needs-chat\t');
        expect((await run(['request', '--launch', 'Stack', ...REQUEST.slice(3)]))[0]).toStartWith('refused\tlaunch-group\t');
        expect((await run([...REQUEST.slice(0, 3), '--variable', 'RUIMTE_HOOK_TOKEN', ...REQUEST.slice(5)]))[0]).toStartWith('refused\treserved-variable\t');
        expect((await run([...REQUEST.slice(0, 3), '--variable', '1KEY', ...REQUEST.slice(5)]))[0]).toStartWith('refused\t');
        expect((await run(REQUEST.slice(0, 7)))[0]).toStartWith('refused\t');
        expect((await run(['request', '--launch', 'nope', ...REQUEST.slice(3)]))[0]).toStartWith('refused\tunknown-launch\t');
        expect(asks).toEqual([]);
    });

    test('help names every outcome and says the value never comes back', async () => {
        const help = await (verbNamed('help') as Verb).run(['secret', 'request'], { caller: 'chat-1', host });
        const text = help.join('\n');
        for (const word of ['saved', 'declined', 'waiting', 'cancelled', 'timed-out', '--variable', '--wait S']) {
            expect(text).toContain(word);
        }
        expect(text).toContain('never the value');
    });
});
