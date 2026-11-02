import { describe, expect, setSystemTime, test } from 'bun:test';
import { join } from 'node:path';
import type { BackendEvent, BackendLaunch } from '@adecore/agents/chat';
import { ModelCatalog, ProviderAccountsService, ProviderRegistry, createAcpProvider, type ChatProvider } from '@adecore/agents/providers';
import { fakeAcpWith, inProcess, type FakeAcpOptions } from '@adecore/agents/testing';
import { UsageService } from '@adecore/agents/usage';
import {
    AGENT_DEFAULT_MODEL,
    ANTIGRAVITY_MODES,
    COPILOT_MODES,
    GROK_MODES,
    adoptGrokModels,
    agentDefaultCatalog,
    copilotProvider,
    createAntigravityProvider,
    createCopilotProvider,
    copilotUsageDirectory,
    createGrokProvider,
    grokAuthMethod,
    grokProvider,
    loadingRuimteMcp,
    readGrokModels,
    shippedAgentCatalog
} from './acp-providers.ts';
import type { AcpServerLaunch } from './acp-server.ts';
import { ProviderRegistry as RuimteProviderRegistry } from './registry.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';

const newHome = tempHomes('ruimte-acp-providers-');

const GROK_SESSION_MODES = ['default', 'plan', 'ask'];

/* A chat backend of the provider on the fake ACP agent, the events it raised and the arguments it started with. */
function run(provider: ChatProvider, options: FakeAcpOptions, overrides: Partial<BackendLaunch> = {}) {
    const events: BackendEvent[] = [];
    const methods: string[] = [];
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const done = Promise.withResolvers<void>();
    const fake = inProcess((io) => {
        const program = fakeAcpWith(options)(io);
        return {
            onLine: (line) => {
                const frame = JSON.parse(line) as { method?: string; params?: Record<string, unknown> };
                if (frame.method) {
                    methods.push(frame.method);
                    requests.push({ method: frame.method, params: frame.params ?? {} });
                }
                program.onLine(line);
            }
        };
    });
    const backend = provider.createBackend(
        {
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
        },
        {
            onEvent: (event) => {
                events.push(event);
                if (event.type === 'turn.done') {
                    done.resolve();
                }
            }
        }
    );
    return { backend, events, methods, requests, fake, turnDone: done.promise };
}

const HELLO = { promptId: 'p1', text: 'hello', preamble: null, attachments: [], mentions: [], skills: [] };

function textOf(events: BackendEvent[]): string {
    return events.flatMap((event) => (event.type === 'text.done' ? [event.text] : [])).join('');
}

describe('Grok', () => {
    test('runs as an ACP agent over stdio, without an update check, and as a terminal', () => {
        expect(grokProvider.kind).toBe('grok');
        expect(grokProvider.command).toEqual(['grok', '--no-auto-update', 'agent', 'stdio']);
        expect(grokProvider.capabilities.chat).toBe(true);
        expect(grokProvider.capabilities.terminal).toBe(true);
        expect(grokProvider.home).toEqual({ env: 'GROK_HOME', fallback: '.grok', loginEnv: ['XAI_API_KEY'], loginCommand: 'grok login' });
        expect(grokProvider.firstPromptArgs('fix it')).toEqual(['fix it']);
    });

    test('only supervised names a session mode, since Grok has no mode that widens what it may do', () => {
        expect(GROK_MODES).toEqual({ supervised: ['default'] });
    });

    test('signs in with the key in the environment where there is one, else with the stored login', () => {
        expect(grokAuthMethod({ XAI_API_KEY: 'key' })).toBe('xai.api_key');
        expect(grokAuthMethod({})).toBe('cached_token');
    });

    test('a turn goes through and back, signed in with the stored login and left on its own model', async () => {
        const { backend, events, methods, fake, turnDone } = run(grokProvider, { authMethod: 'cached_token', modes: GROK_SESSION_MODES });
        await backend.start();
        expect(fake.started[0]?.argv).toEqual(['--no-auto-update', 'agent', 'stdio']);
        expect(methods).toEqual(['initialize', 'session/new', 'authenticate', 'session/new']);
        backend.sendTurn(HELLO);
        await turnDone;
        expect(textOf(events)).toBe('echo: hello');
        expect(events).toContainEqual(expect.objectContaining({ type: 'turn.done', promptId: 'p1', state: 'done' }));
        expect(methods).not.toContain('session/set_model');
        await backend.dispose();
    });

    test('the models a chat reports fill the catalog, with the current one as the default', async () => {
        const provider = createGrokProvider();
        const { backend } = run(provider, { authMethod: 'cached_token', modes: GROK_SESSION_MODES });
        await backend.start();
        expect(provider.catalog.list().map((model) => model.slug)).toEqual(['fake-small', 'fake-large']);
        expect(provider.catalog.defaultModel).toBe('fake-small');
        await backend.dispose();
    });

    test('what a chat signed in with the key learns reaches the listed provider and its listeners', async () => {
        const provider = createGrokProvider();
        let changes = 0;
        provider.onChange?.(() => {
            changes += 1;
        });
        const { backend } = run(
            provider,
            { authMethod: 'xai.api_key', modes: GROK_SESSION_MODES, commands: ['compact', 'goal'] },
            { env: { XAI_API_KEY: 'key' } }
        );
        await backend.start();
        expect(provider.capabilities.compaction).toBe('prompt');
        expect(provider.capabilities.goals).toBe('command');
        expect(provider.catalog.list().map((model) => model.slug)).toEqual(['fake-small', 'fake-large']);
        expect(changes).toBeGreaterThan(0);
        await backend.dispose();
    });

    test('a full-access chat stays in the default session mode', async () => {
        const { backend, methods } = run(grokProvider, { modes: GROK_SESSION_MODES }, { runtimeMode: 'full-access' });
        await backend.start();
        expect(methods).not.toContain('session/set_mode');
        await backend.dispose();
    });
});

// As Grok 1.0.62 prints `grok models`.
const GROK_MODELS = [
    'You are logged in with grok.com.',
    '',
    'Default model: grok-4.7',
    '',
    'Available models:',
    '  * grok-4.7 (default)',
    '  - grok-4.7-build-fast',
    '  - grok-4.6',
    ''
].join('\n');

describe('grok models', () => {
    test('a login on the first line is signed in, with the listed models and the default', () => {
        expect(readGrokModels(GROK_MODELS)).toEqual({ signedIn: true, defaultModel: 'grok-4.7', models: ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6'] });
        expect(readGrokModels(GROK_MODELS.replace('You are logged in with grok.com.', 'You are using XAI_API_KEY.')).signedIn).toBe(true);
    });

    test('"not authenticated" is signed out, and a first line it does not know is no answer', () => {
        expect(readGrokModels(GROK_MODELS.replace('You are logged in with grok.com.', 'You are not authenticated.')).signedIn).toBe(false);
        expect(() => readGrokModels('error: something broke\n')).toThrow('Grok did not say who is signed in');
        expect(() => readGrokModels('')).toThrow('Grok did not say who is signed in');
    });

    test('a slug that reads as a flag is left out', () => {
        expect(readGrokModels(GROK_MODELS.replace('grok-4.6', '--yolo')).models).toEqual(['grok-4.7', 'grok-4.7-build-fast']);
    });

    test('the listed models replace the catalog, with the names and reasoning effort a chat learned kept', () => {
        const effort = {
            id: 'effort',
            label: 'Reasoning',
            type: 'select' as const,
            defaultChoice: 'high',
            choices: [
                { id: 'low', label: 'Low' },
                { id: 'high', label: 'High' }
            ]
        };
        let stored: unknown = {
            commands: ['compact'],
            models: { defaultModel: 'grok-4.6', models: [{ slug: 'grok-4.6', name: 'Grok 4.6', contextWindow: 256000 }], options: [effort] }
        };
        const store = {
            load: () => stored,
            save: (value: unknown) => {
                stored = value;
            }
        };
        const catalog = new ModelCatalog({
            defaultModel: 'default',
            profiles: { agent: { options: [], contextWindowTokens: {} } },
            models: [{ slug: 'default', name: 'Default', profile: 'agent' }]
        });

        expect(adoptGrokModels(catalog, store, readGrokModels(GROK_MODELS))).toBe(true);
        expect(catalog.defaultModel).toBe('grok-4.7');
        expect(catalog.list().map((model) => [model.slug, model.name])).toEqual([
            ['grok-4.7', 'grok-4.7'],
            ['grok-4.7-build-fast', 'grok-4.7-build-fast'],
            ['grok-4.6', 'Grok 4.6']
        ]);
        expect(catalog.list()[0]!.options).toEqual([effort]);
        expect(stored).toEqual({
            commands: ['compact'],
            models: {
                defaultModel: 'grok-4.7',
                models: [
                    { slug: 'grok-4.7', name: 'grok-4.7' },
                    { slug: 'grok-4.7-build-fast', name: 'grok-4.7-build-fast' },
                    { slug: 'grok-4.6', name: 'Grok 4.6', contextWindow: 256000 }
                ],
                options: [effort]
            }
        });
        expect(adoptGrokModels(catalog, store, readGrokModels(GROK_MODELS))).toBe(false);
    });
});

describe('Copilot', () => {
    test('runs its ACP server over stdio beside its terminal', () => {
        expect(copilotProvider.command).toEqual(['copilot', '--acp', '--stdio', '--no-auto-update', '--allow-tool=ruimte']);
        expect(copilotProvider.capabilities.chat).toBe(true);
        expect(copilotProvider.capabilities.terminal).toBe(true);
        expect(copilotProvider.firstPromptArgs('go')).toEqual(['-i', 'go']);
        expect(copilotProvider.catalog.defaultModel).toBe(AGENT_DEFAULT_MODEL);
    });

    test('a supervised chat switches to the agent mode', async () => {
        const agentMode = COPILOT_MODES.supervised![0]!;
        const { backend, methods } = run(copilotProvider, { modes: ['https://agentclientprotocol.com/protocol/session-modes#autopilot', agentMode] });
        await backend.start();
        expect(methods).toContain('session/set_mode');
        await backend.dispose();
    });

    test("a turn's usage is logged in the machine's folder and shows on the usage page under Copilot", async () => {
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
});

describe('a catalog store', () => {
    test('keeps what a chat reported, so a provider made after a restart offers it before any chat', async () => {
        let stored: unknown = null;
        const store = {
            load: () => stored,
            save: (value: unknown) => {
                stored = value;
            }
        };
        const first = createCopilotProvider(store);
        const { backend } = run(first, { modes: [], commands: ['compact'] });
        await backend.start();
        await backend.dispose();
        const again = createCopilotProvider(store);
        expect(again.catalog.list().map((model) => model.slug)).toEqual(['fake-small', 'fake-large']);
        expect(again.catalog.defaultModel).toBe('fake-small');
        expect(again.capabilities.compaction).toBe('prompt');
    });

    test('a provider without one starts from the shipped models, with the agent left its own choice', () => {
        const catalog = createCopilotProvider().catalog;
        expect(catalog.defaultModel).toBe(AGENT_DEFAULT_MODEL);
        expect(catalog.list().map((model) => model.slug)).toEqual(
            shippedAgentCatalog('copilot')
                .list()
                .map((model) => model.slug)
        );
        expect(catalog.list().length).toBeGreaterThan(1);
    });
});

describe('Antigravity', () => {
    const SERVER_MODES = ['default', 'auto_edit', 'yolo'];
    const installed: AcpServerLaunch = {
        launch: () => ['/home/.ruimte/agent-servers/antigravity/1.4.1/agy_acp_server.par', '--uid=']
    };
    const missing: AcpServerLaunch = { launch: () => null };

    test('chats on the installed server, keeps its accounts apart in GEMINI_HOME and runs `agy` as a terminal', async () => {
        const provider = createAntigravityProvider(installed);
        expect(provider.kind).toBe('antigravity');
        expect(provider.command).toEqual(['/home/.ruimte/agent-servers/antigravity/1.4.1/agy_acp_server.par', '--uid=']);
        expect([provider.capabilities.chat, provider.capabilities.terminal, provider.capabilities.hooks]).toEqual([true, true, true]);
        expect(provider.home).toMatchObject({ env: 'GEMINI_HOME', fallback: '.gemini', loginEnv: [] });
        expect(provider.home?.loginCommand).toBeUndefined();
        expect(provider.firstPromptArgs('go')).toEqual(['-i', 'go']);
        expect(provider.resumeCommand).toBe('agy {flags} --conversation {id}');
    });

    test('without an installed server it offers no chat and starts none, but stays a terminal', () => {
        const provider = createAntigravityProvider(missing);
        expect([provider.capabilities.chat, provider.capabilities.terminal]).toEqual([false, true]);
        expect(createAntigravityProvider(null).capabilities.chat).toBe(true);
        expect(() => provider.createBackend({} as BackendLaunch, { onEvent: () => undefined })).toThrow('Install the Antigravity server');
    });

    test('offers a second account, signed in from its chat, in a GEMINI_HOME of its own', async () => {
        const home = await newHome();
        const accounts = new ProviderAccountsService({
            home,
            providers: new ProviderRegistry({
                providers: [grokProvider, createAntigravityProvider(installed)],
                detect: async () => ({ installed: true, version: null })
            }),
            env: { HOME: home },
            secrets: null,
            folderExists: () => true
        });
        await accounts.load();
        expect(accounts.snapshot()).toMatchObject({ loginCommands: { grok: 'grok login' }, chatLogins: ['antigravity'] });
        const created = await accounts.create({ kind: 'antigravity', label: 'Work' });
        const folder = join(home, 'accounts', created.id);
        expect(created.accounts[created.id]).toEqual({ kind: 'antigravity', label: 'Work', home: folder });
        expect(accounts.envFor('antigravity', created.id, { HOME: home }).GEMINI_HOME).toBe(folder);
    });

    test("each runtime mode names the server's own mode, the two between sharing auto_edit", () => {
        expect(ANTIGRAVITY_MODES).toEqual({ supervised: ['default'], 'auto-accept-edits': ['auto_edit'], auto: ['auto_edit'], 'full-access': ['yolo'] });
    });

    test("a turn goes through and back, signed in through the server's own browser sign-in", async () => {
        const provider = createAntigravityProvider(installed);
        const { backend, events, methods, fake, turnDone } = run(provider, { authMethod: 'oauth-personal', modes: SERVER_MODES });
        await backend.start();
        expect(fake.started[0]?.argv).toEqual(['--uid=']);
        expect(methods).toEqual(['initialize', 'session/new', 'authenticate', 'session/new']);
        backend.sendTurn(HELLO);
        await turnDone;
        expect(textOf(events)).toBe('echo: hello');
        await backend.dispose();
    });

    test('a full-access chat switches the server to yolo, and an auto chat to auto_edit', async () => {
        for (const [runtimeMode, mode] of [
            ['full-access', 'yolo'],
            ['auto', 'auto_edit']
        ] as const) {
            const { backend, events } = run(createAntigravityProvider(installed), { modes: SERVER_MODES }, { runtimeMode });
            await backend.start();
            expect(events).toContainEqual(expect.objectContaining({ type: 'permissions', permissionMode: mode, effectiveRuntimeMode: runtimeMode }));
            await backend.dispose();
        }
    });
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
            () => loadingRuimteMcp(createAcpProvider({ kind: 'example', name: 'Example', command: 'example', catalog: agentDefaultCatalog() }))
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
        expect(copilotProvider.command).toContain('--allow-tool=ruimte');
        expect(copilotProvider.command.some((arg) => arg.startsWith('--additional-mcp-config'))).toBe(false);
    });
});
