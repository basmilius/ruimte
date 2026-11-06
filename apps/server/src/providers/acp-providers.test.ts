import { describe, expect, setSystemTime, test } from 'bun:test';
import type { BackendEvent, BackendLaunch } from '@adecore/agents/chat';
import { agentDefaultCatalog, copilotUsageDirectory, createAcpProvider, type AcpServerLaunch, type ChatProvider } from '@adecore/agents/providers';
import { fakeAcpWith, inProcess, type FakeAcpOptions } from '@adecore/agents/testing';
import { UsageService } from '@adecore/agents/usage';
import { withRuimteMcp } from '../ruimte-mcp.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { createAntigravityProvider, createCopilotProvider, createGrokProvider } from './acp-providers.ts';
import { ProviderRegistry as RuimteProviderRegistry } from './registry.ts';

const newHome = tempHomes('ruimte-acp-providers-');

/* A chat backend of the provider on the fake ACP agent, the events it raised and the requests it sent. */
function run(provider: ChatProvider, options: FakeAcpOptions, overrides: Partial<BackendLaunch> = {}) {
    const events: BackendEvent[] = [];
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const done = Promise.withResolvers<void>();
    const fake = inProcess((io) => {
        const program = fakeAcpWith(options)(io);
        return {
            onLine: (line) => {
                const frame = JSON.parse(line) as { method?: string; params?: Record<string, unknown> };
                if (frame.method) {
                    requests.push({ method: frame.method, params: frame.params ?? {} });
                }
                program.onLine(line);
            }
        };
    });
    // The session applies the provider's launch additions where it makes a backend; a test that builds one itself does the same.
    const launch: BackendLaunch = {
        command: provider.command,
        cwd: '/tmp',
        env: {},
        selection: provider.catalog.normalize(undefined),
        modelName: provider.catalog.nameOf(provider.catalog.defaultModel),
        runtimeMode: 'supervised',
        resume: null,
        generation: 1,
        instructions: null,
        resumeNote: null,
        spawn: fake.spawn,
        ...overrides
    };
    const backend = provider.createBackend(provider.launch?.(launch) ?? launch, {
        onEvent: (event) => {
            events.push(event);
            if (event.type === 'turn.done') {
                done.resolve();
            }
        }
    });
    return { backend, events, requests, turnDone: done.promise };
}

const HELLO = { promptId: 'p1', text: 'hello', preamble: null, attachments: [], mentions: [], skills: [] };

test("a Copilot turn's usage is logged in the machine's folder and shows on the usage page under Copilot", async () => {
    const home = await newHome();
    setSystemTime(Date.UTC(2026, 9, 1, 12));
    try {
        const copilot = new RuimteProviderRegistry({ home, detect: async () => ({ installed: true, version: '1.0.0' }) }).get('copilot');
        const turnUsage = { totalTokens: 1500, inputTokens: 1100, outputTokens: 400, cachedReadTokens: 1000 };
        const { backend, turnDone } = run(copilot, { turnUsage });
        await backend.start();
        backend.sendTurn(HELLO);
        await turnDone;
        await backend.dispose();

        const usage = new UsageService({
            home,
            allowPriceFetch: false,
            knownProjects: async () => [],
            roots: () => [{ provider: 'copilot', path: copilotUsageDirectory(home) }]
        });
        const summary = await usage.summary({ from: '2026-10-01', to: '2026-10-01', resolution: 'day', timeZone: 'UTC' });
        usage.stop();
        expect(summary.models).toEqual([expect.objectContaining({ provider: 'copilot' })]);
        expect(summary.models[0]!.totals).toMatchObject({ calls: 1, input: 100, cacheRead: 1000, output: 400 });
    } finally {
        setSystemTime();
    }
});

test('an Antigravity chat without an installed server points the person at the Providers pane', () => {
    const provider = createAntigravityProvider({ launch: () => null });

    expect(provider.capabilities.chat).toBe(false);
    expect(() => run(provider, {})).toThrow('Install the Antigravity server in Settings, Providers first.');
});

describe("Ruimte's MCP server in an ACP chat", () => {
    const CHAT_ENV = { RUIMTE_MCP_URL: 'http://127.0.0.1:4210/mcp', RUIMTE_CONTEXT_TOKEN: 'chat-token' };
    const RUIMTE_SERVER = { type: 'http', name: 'ruimte', url: 'http://127.0.0.1:4210/mcp', headers: [{ name: 'Authorization', value: 'Bearer chat-token' }] };
    const installed: AcpServerLaunch = { launch: () => ['agy_acp_server.par'] };
    const chats: Array<[string, () => ChatProvider]> = [
        ['Grok', () => createGrokProvider()],
        ['Copilot', () => createCopilotProvider()],
        ['Antigravity', () => createAntigravityProvider(installed)],
        [
            'an agent of the ACP registry',
            () => createAcpProvider({ kind: 'example', name: 'Example', command: 'example', catalog: agentDefaultCatalog(), launch: withRuimteMcp })
        ]
    ];

    for (const [name, provider] of chats) {
        test(`reaches ${name} in its session request with the chat's token, and its tools run without a card`, async () => {
            const { backend, events, requests, turnDone } = run(provider(), { mcp: { http: true } }, { env: CHAT_ENV });
            await backend.start();
            expect(requests.find((request) => request.method === 'session/new')?.params.mcpServers).toEqual([RUIMTE_SERVER]);
            backend.sendTurn({ ...HELLO, text: 'mcp: ruimte node_new' });
            await turnDone;
            expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
            await backend.dispose();
        });
    }

    test('stays out of a chat the daemon gave no token, and out of an agent that takes no HTTP server', async () => {
        const untold = run(createGrokProvider(), { mcp: { http: true } });
        await untold.backend.start();
        expect(untold.requests.find((request) => request.method === 'session/new')?.params.mcpServers).toEqual([]);
        await untold.backend.dispose();
        const unable = run(createGrokProvider(), {}, { env: CHAT_ENV });
        await unable.backend.start();
        expect(unable.requests.find((request) => request.method === 'session/new')?.params.mcpServers).toEqual([]);
        expect(unable.events).toContainEqual({ type: 'note', level: 'warning', text: 'Grok takes no MCP servers over HTTP, so it runs without ruimte.' });
        await unable.backend.dispose();
    });

    // Copilot names no server in a permission request, so its own flag allows the tools; a second copy on its line would load the server twice.
    test('Copilot allows the tools on its line and no longer loads the server there', () => {
        const copilot = createCopilotProvider();
        expect(copilot.terminal?.mcpAllowArgs?.('ruimte')).toEqual(['--allow-tool=ruimte']);
        expect(copilot.command.some((arg) => arg.startsWith('--additional-mcp-config'))).toBe(false);
    });
});
