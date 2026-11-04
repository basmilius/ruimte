import { beforeEach, describe, expect, test } from 'bun:test';
import type { CliVersion, RegistryAgent, UsageLimitsSnapshot } from '@ruimte/contracts';
import type { CanvasHost, NodeAccount } from './host.ts';
import { providerToolkit } from './provider-tools.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';

const AGENTS: RegistryAgent[] = [
    {
        id: 'goose',
        kind: 'goose',
        name: 'goose',
        version: '1.55.0',
        description: 'A local, extensible agent',
        distribution: 'binary',
        checksum: true,
        installed: '1.54.0',
        state: 'installed'
    },
    {
        id: 'kilo',
        kind: 'kilo',
        name: 'Kilo',
        version: '7.8.15',
        description: 'The open source coding agent',
        distribution: 'npm',
        checksum: false,
        installed: null,
        state: 'missing'
    }
];

const VERSIONS: CliVersion[] = [
    { provider: 'claude', method: 'unknown', package: null, path: '/c', version: '2.1.304', latest: null, updatable: false, state: 'idle', checkedAt: null },
    {
        provider: 'copilot',
        method: 'npm',
        package: '@github/copilot',
        path: '/p',
        version: '1.0.101',
        latest: '1.0.110',
        updatable: true,
        state: 'idle',
        checkedAt: 1
    }
];

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

const LIMITS: UsageLimitsSnapshot = {
    providers: [
        {
            kind: 'claude',
            account: { id: 'claude', label: 'Personal' },
            plan: 'max',
            checkedAt: NOW - 60_000,
            source: 'event',
            windows: [
                // Two of five hours have run, so an even spread stands at 40%.
                { id: 'session', kind: 'session', label: 'Session', used: 0.6, resetsAt: NOW + 3 * HOUR, durationMs: 5 * HOUR },
                { id: 'weekly', kind: 'weekly', label: 'Weekly', used: 0.1, resetsAt: null, durationMs: null }
            ],
            cost: null,
            unavailable: null
        },
        {
            kind: 'claude',
            account: { id: 'acct-work', label: 'Work' },
            plan: null,
            checkedAt: 0,
            source: 'probe',
            windows: [],
            cost: null,
            unavailable: { reason: 'no-subscription', message: null }
        },
        { kind: 'codex', account: { id: 'codex', label: 'Codex' }, plan: 'pro', checkedAt: NOW, source: 'probe', windows: [], cost: null, unavailable: null }
    ]
};

let refreshed: boolean[];
let host: CanvasHost;
let accounts: Map<string, NodeAccount>;

beforeEach(() => {
    refreshed = [];
    accounts = new Map([['chat-1', { kind: 'claude' }]]);
    host = {
        projects: { locate: (id: string) => (id === 'chat-1' ? { projectId: 'p1', folder: '/repo', canvasId: null } : null) },
        starts: { accountOf: (id: string) => accounts.get(id) ?? null },
        planLimits: { snapshot: () => LIMITS, now: () => NOW },
        providerInstalls: {
            catalog: async (refresh: boolean) => {
                refreshed.push(refresh);

                return { source: 'cached', fetchedAt: Date.UTC(2026, 9, 21), error: 'offline', platform: 'darwin-aarch64', agents: AGENTS };
            },
            versions: async (refresh: boolean) => {
                refreshed.push(refresh);

                return VERSIONS;
            }
        }
    } as unknown as CanvasHost;
});

async function info(input: Record<string, unknown>): Promise<string[]> {
    return (await toolAnswer('provider_info', input, toolCall('chat-1', host))).lines;
}

const PERSON = expect.stringMatching(/^person\tInstalling, updating and removing stay a person's/);

describe('provider_info', () => {
    test('catalog lists the agents a line each, and says a person installs them', async () => {
        expect(await info({ action: 'catalog' })).toEqual([
            'registry\tcached\t2026-10-21T00:00:00.000Z\toffline',
            'agent\tgoose\tgoose\t1.55.0\tbinary\t1.54.0\tinstalled\tA local, extensible agent',
            'agent\tkilo\tKilo\t7.8.15\tnpm\t-\tmissing\tThe open source coding agent',
            PERSON
        ]);
        expect(refreshed).toEqual([false]);
    });

    test('catalog with search keeps the agents that hold every word', async () => {
        const lines = await info({ action: 'catalog', search: 'open source', refresh: true });

        expect(lines.filter((line) => line.startsWith('agent\t'))).toEqual(['agent\tkilo\tKilo\t7.8.15\tnpm\t-\tmissing\tThe open source coding agent']);
        expect(refreshed).toEqual([true]);
    });

    test('versions says how each CLI came here and whether its route has a newer one', async () => {
        expect(await info({ action: 'versions' })).toEqual([
            'cli\tclaude\t2.1.304\tunknown\t-\t-\tno',
            'cli\tcopilot\t1.0.101\tnpm\t@github/copilot\t1.0.110\tyes',
            PERSON
        ]);
    });

    test('limits reads the plan of the account the caller runs on, each window against an even pace', async () => {
        expect(await info({ action: 'limits' })).toEqual([
            'plan\tclaude\tPersonal\tmax\t2026-10-22T11:59:00.000Z',
            'window\tSession\tsession\t60%\t2026-10-22T15:00:00.000Z\t40%\tahead',
            'window\tWeekly\tweekly\t10%\t-\t-\t-'
        ]);
    });

    test('limits with json answers the same as one object', async () => {
        expect(JSON.parse((await info({ action: 'limits', json: true })).join('\n'))).toEqual({
            provider: 'claude',
            account: 'Personal',
            plan: 'max',
            checkedAt: '2026-10-22T11:59:00.000Z',
            unavailable: null,
            windows: [
                { label: 'Session', kind: 'session', usedPercent: 60, resetsAt: '2026-10-22T15:00:00.000Z', evenPacePercent: 40, pace: 'ahead' },
                { label: 'Weekly', kind: 'weekly', usedPercent: 10, resetsAt: null, evenPacePercent: null, pace: null }
            ]
        });
    });

    test('limits of another account of the same CLI says why it has no windows, and one with none read yet says so', async () => {
        accounts.set('chat-1', { kind: 'claude', account: 'acct-work' });
        expect(await info({ action: 'limits' })).toEqual(['plan\tclaude\tWork\t-\t-', 'unavailable\tno-subscription']);

        accounts.set('chat-1', { kind: 'codex' });
        expect(await info({ action: 'limits' })).toEqual([
            'plan\tcodex\tCodex\tpro\t2026-10-22T12:00:00.000Z',
            'note\tThe CLI reported no plan windows for this account yet'
        ]);
    });

    test('limits refuses a caller that runs no agent, and an account the machine reads no plan of', async () => {
        accounts.clear();
        expect((await info({ action: 'limits' }))[0]).toStartWith('refused\tno-agent\t');

        accounts.set('chat-1', { kind: 'claude', account: 'acct-gone' });
        expect((await info({ action: 'limits' }))[0]).toStartWith('refused\tno-limits\tThis machine reads no plan windows for the claude account you run on');

        accounts.set('chat-1', { kind: 'grok' });
        expect((await info({ action: 'limits' }))[0]).toBe('refused\tno-limits\tThis machine reads no plan windows for grok');
    });

    test('a read refuses a field only another read takes, and asks nothing', async () => {
        expect(await info({ action: 'limits', refresh: true })).toEqual(['refused\tbad-arguments\tprovider_info limits takes no refresh', 'fields\tjson']);
        expect((await info({ action: 'versions', search: 'goose' }))[0]).toBe('refused\tbad-arguments\tprovider_info versions takes no search');
        expect(refreshed).toEqual([]);
    });

    test('no tool installs or updates', () => {
        expect(providerToolkit.tools.map((tool) => tool.name)).toEqual(['provider_info']);
    });
});
