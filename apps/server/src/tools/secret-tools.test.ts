import { beforeEach, describe, expect, test } from 'bun:test';
import type { CanvasHost } from '../canvas/host.ts';
import type { LaunchReading } from '../launches/agent-host.ts';
import type { SecretAsk, SecretFile, SecretOutcome } from '../secrets/secret-requests.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';

let asks: { ask: SecretAsk; waitMs: number | undefined }[];
let outcome: SecretOutcome;
let files: SecretFile[];
let host: CanvasHost;

function reading(launchId: string, overrides: Partial<LaunchReading> = {}): LaunchReading {
    return { launchId, name: launchId, kind: 'service', approved: true, url: null, port: null, members: [], status: null, source: null, ...overrides };
}

beforeEach(() => {
    asks = [];
    outcome = 'saved';
    files = [];
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

                return { requestId: 'req-1', outcome, files };
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
                    target: { delivery: 'launch', launchId: 'api', launchName: 'API', variable: 'API_KEY' },
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

    test('tells a waiting agent to end its turn and a declined one not to ask again', async () => {
        outcome = 'waiting';
        expect((await request(REQUEST))[1]).toContain('End your turn');
        outcome = 'declined';
        expect((await request(REQUEST))[1]).toContain("Don't ask for it in the chat");
    });

    test('asks for files without a launch and prints where each value is', async () => {
        files = [
            { field: 'EMAIL', path: '/home/secrets/files/a' },
            { field: 'PASSWORD', path: '/home/secrets/files/b' }
        ];
        const lines = await request({
            label: 'Apple ID',
            reason: 'notarytool signs in',
            url: 'https://account.apple.com',
            fields: [
                { name: 'EMAIL', label: 'E-mail', masked: false },
                { name: 'PASSWORD', label: 'Password' }
            ]
        });

        expect(lines[0]).toBe('request\treq-1\tsaved\tfile');
        expect(lines.slice(2)).toEqual(['file\tEMAIL\t/home/secrets/files/a', 'file\tPASSWORD\t/home/secrets/files/b']);
        expect(asks[0]?.ask).toMatchObject({
            target: {
                delivery: 'file',
                fields: [
                    { name: 'EMAIL', label: 'E-mail', masked: false },
                    { name: 'PASSWORD', label: 'Password' }
                ]
            },
            url: 'https://account.apple.com'
        });
    });

    test('refuses a variable without a launch, a launch with fields, a launch without a variable and a page that is no web address', async () => {
        const two = [
            { name: 'A', label: 'A' },
            { name: 'B', label: 'B' }
        ];

        expect((await request({ label: 'Key', reason: 'Needed', variable: 'API_KEY' }))[0]).toStartWith('refused\tsecret-file-launch\t');
        expect((await request({ ...REQUEST, fields: two }))[0]).toStartWith('refused\tsecret-launch-fields\t');
        expect((await request({ launch: 'API', label: 'Key', reason: 'Needed' }))[0]).toStartWith('refused\tsecret-launch-needs\t');
        expect((await request({ label: 'Key', reason: 'Needed', url: 'file:///etc/passwd' }))[0]).toBe('refused\tbad-arguments\turl is an http(s) address');
        expect(asks).toEqual([]);
    });

    test('refuses a terminal, a group, a reserved or malformed variable, a missing field and a hold past its bounds', async () => {
        expect((await request(REQUEST, 'term-1'))[0]).toStartWith('refused\tsecret-needs-chat\t');
        expect((await request({ ...REQUEST, launch: 'Stack' }))[0]).toStartWith('refused\tlaunch-group\t');
        expect((await request({ ...REQUEST, variable: 'RUIMTE_HOOK_TOKEN' }))[0]).toStartWith('refused\treserved-variable\t');
        expect((await request({ ...REQUEST, variable: '1KEY' }))[0]).toStartWith('refused\t');
        expect((await request({ launch: 'API', variable: 'API_KEY', label: 'Key' }))[0]).toBe(
            'refused\tbad-arguments\tsecret_request needs reason, what it is for and where to find it'
        );
        expect((await request({ ...REQUEST, wait: 111 }))[0]).toBe('refused\tbad-arguments\twait is between 1 and 110');
        expect((await request({ ...REQUEST, launch: 'nope' }))[0]).toStartWith('refused\tunknown-launch\t');
        expect(asks).toEqual([]);
    });
});
