import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BackendEvent, BackendLaunch } from '@adecore/agents/chat';
import { ProviderAccountsService, ProviderRegistry, type ChatProvider } from '@adecore/agents/providers';
import { fakeAcpWith, inProcess, type FakeAcpOptions } from '@adecore/agents/testing';
import {
    AGENT_DEFAULT_MODEL,
    ANTIGRAVITY_MODES,
    COPILOT_MODES,
    GROK_MODES,
    allowsContextCommand,
    copilotProvider,
    createAntigravityProvider,
    createGrokProvider,
    grokAuthMethod,
    grokProvider
} from './acp-providers.ts';
import type { AcpServerLaunch } from './acp-server.ts';

const GROK_SESSION_MODES = ['default', 'plan', 'ask'];

/* A chat backend of the provider on the fake ACP agent, the events it raised and the arguments it started with. */
function run(provider: ChatProvider, options: FakeAcpOptions, overrides: Partial<BackendLaunch> = {}) {
    const events: BackendEvent[] = [];
    const methods: string[] = [];
    let onTurnDone: () => void = () => undefined;
    const turnDone = new Promise<void>((resolve) => {
        onTurnDone = resolve;
    });
    const fake = inProcess((io) => {
        const program = fakeAcpWith(options)(io);
        return {
            onLine: (line) => {
                const frame = JSON.parse(line) as { method?: string };
                if (frame.method) {
                    methods.push(frame.method);
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
                    onTurnDone();
                }
            }
        }
    );
    return { backend, events, methods, fake, turnDone };
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
        backend.sendTurn({ promptId: 'p1', text: 'hello', preamble: null, attachments: [], mentions: [], skills: [] });
        await turnDone;
        const text = events.flatMap((event) => (event.type === 'text.done' ? [event.text] : [])).join('');
        expect(text).toBe('echo: hello');
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

    test('a full-access chat stays in the default session mode', async () => {
        const { backend, methods } = run(grokProvider, { modes: GROK_SESSION_MODES }, { runtimeMode: 'full-access' });
        await backend.start();
        expect(methods).not.toContain('session/set_mode');
        await backend.dispose();
    });
});

describe('Copilot', () => {
    test('runs its ACP server over stdio beside its terminal', () => {
        expect(copilotProvider.command).toEqual(['copilot', '--acp', '--stdio', '--no-auto-update', '--allow-tool=shell(ruimte-context:*)']);
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
});

describe('Antigravity', () => {
    const SERVER_MODES = ['default', 'auto_edit', 'yolo'];
    const installed: AcpServerLaunch = {
        launch: () => ['/home/.ruimte/agent-servers/antigravity/1.4.1/agy_acp_server.par', '--uid='],
        detection: () => ({ installed: true, version: '1.4.1' })
    };
    const missing: AcpServerLaunch = { launch: () => null, detection: () => ({ installed: false, version: null }) };

    test('chats on the installed server, keeps its accounts apart in GEMINI_HOME and runs `agy` as a terminal', async () => {
        const provider = createAntigravityProvider(installed);
        expect(provider.kind).toBe('antigravity');
        expect(provider.command).toEqual(['/home/.ruimte/agent-servers/antigravity/1.4.1/agy_acp_server.par', '--uid=']);
        expect([provider.capabilities.chat, provider.capabilities.terminal, provider.capabilities.hooks]).toEqual([true, true, false]);
        expect(provider.home).toMatchObject({ env: 'GEMINI_HOME', fallback: '.gemini', loginEnv: [] });
        expect(provider.home?.loginCommand).toBeUndefined();
        expect(provider.firstPromptArgs('go')).toEqual(['-i', 'go']);
        expect(provider.resumeCommand).toBe('agy {flags} --conversation {id}');
        expect(await provider.detect('agy', {})).toEqual({ installed: true, version: '1.4.1' });
    });

    test('without an installed server it is listed as not installed and starts no chat', async () => {
        const provider = createAntigravityProvider(missing);
        expect(await provider.detect('agy', {})).toEqual({ installed: false, version: null });
        expect(() => provider.createBackend({} as BackendLaunch, { onEvent: () => undefined })).toThrow('Install the Antigravity server');
    });

    test('offers a second account, signed in from its chat, in a GEMINI_HOME of its own', async () => {
        const home = await mkdtemp(join(tmpdir(), 'ruimte-antigravity-'));
        try {
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
        } finally {
            await rm(home, { recursive: true, force: true });
        }
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
        backend.sendTurn({ promptId: 'p1', text: 'hello', preamble: null, attachments: [], mentions: [], skills: [] });
        await turnDone;
        expect(events.flatMap((event) => (event.type === 'text.done' ? [event.text] : [])).join('')).toBe('echo: hello');
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

describe('allowsContextCommand', () => {
    const request = (...commands: string[]) => ({ kind: 'execute', title: 'Run a command', commands });

    test('allows ruimte-context, also joined with echo the way an agent labels its parts', () => {
        expect(allowsContextCommand(request('ruimte-context help'))).toBe(true);
        expect(
            allowsContextCommand(
                request('ruimte-context help && echo "--- AGENT ---" && ruimte-context help agent && echo "--- TEAM ---" && ruimte-context help team')
            )
        ).toBe(true);
    });

    test('asks for a command that is not only ruimte-context', () => {
        expect(allowsContextCommand(request('echo hi'))).toBe(false);
        expect(allowsContextCommand(request('ruimte-context x | sh'))).toBe(false);
        expect(allowsContextCommand(request('ruimte-context x; rm -rf ~'))).toBe(false);
        expect(allowsContextCommand(request('ruimte-context help', 'Run ruimte-context help to read the verbs'))).toBe(false);
    });

    test('asks for anything that is not a command request', () => {
        expect(allowsContextCommand({ kind: 'edit', title: 'Edit a file', commands: ['ruimte-context help'] })).toBe(false);
        expect(allowsContextCommand({ kind: null, title: null, commands: ['ruimte-context help'] })).toBe(false);
        expect(allowsContextCommand(request())).toBe(false);
    });
});
