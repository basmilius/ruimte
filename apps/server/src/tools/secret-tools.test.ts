import { beforeEach, describe, expect, test } from 'bun:test';
import type { CanvasHost } from '../canvas/host.ts';
import type { LaunchReading } from '../launches/agent-host.ts';
import type { SecretAsk, SecretOutcome } from '../secrets/secret-requests.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';

let asks: { ask: SecretAsk; waitMs: number | undefined }[];
let outcome: SecretOutcome;
let host: CanvasHost;

function reading(launchId: string, overrides: Partial<LaunchReading> = {}): LaunchReading {
    return { launchId, name: launchId, kind: 'service', approved: true, url: null, port: null, members: [], status: null, ...overrides };
}

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

async function request(input: Record<string, unknown>, caller = 'chat-1'): Promise<string[]> {
    return (await toolAnswer('secret_request', input, toolCall(caller, host))).lines;
}

const REQUEST = { launch: 'API', variable: 'API_KEY', label: 'Stripe test key', reason: 'Checkout calls Stripe' };

describe('secret_request', () => {
    test('asks for a launch by name and prints only the outcome', async () => {
        expect(await request({ ...REQUEST, placeholder: 'sk_test_...', wait: 60 })).toEqual(['request\treq-1\tsaved\tapi\tAPI\tAPI_KEY']);
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
            expect((await request(REQUEST))[0]).toBe(`request\treq-1\t${next}\tapi\tAPI\tAPI_KEY`);
        }

        expect(asks.at(-1)?.waitMs).toBeUndefined();
    });

    test('refuses a terminal, a group, a reserved or malformed variable, a missing field and a hold past its bounds', async () => {
        expect((await request(REQUEST, 'term-1'))[0]).toStartWith('refused\tsecret-needs-chat\t');
        expect((await request({ ...REQUEST, launch: 'Stack' }))[0]).toStartWith('refused\tlaunch-group\t');
        expect((await request({ ...REQUEST, variable: 'RUIMTE_HOOK_TOKEN' }))[0]).toStartWith('refused\treserved-variable\t');
        expect((await request({ ...REQUEST, variable: '1KEY' }))[0]).toStartWith('refused\t');
        expect((await request({ launch: 'API', variable: 'API_KEY', label: 'Key' }))[0]).toBe(
            'refused\tbad-arguments\tsecret_request needs reason, why the launch needs it'
        );
        expect((await request({ ...REQUEST, wait: 111 }))[0]).toBe('refused\tbad-arguments\twait is between 1 and 110');
        expect((await request({ ...REQUEST, launch: 'nope' }))[0]).toStartWith('refused\tunknown-launch\t');
        expect(asks).toEqual([]);
    });
});
