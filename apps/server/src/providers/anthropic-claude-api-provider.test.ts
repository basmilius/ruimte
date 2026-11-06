import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatSession, type BackendLaunch } from '@adecore/agents/chat';
import { createClaudeProvider, ModelCatalog } from '@adecore/agents/providers';
import { fakeClaude, inProcess } from '@adecore/agents/testing';
import { UsageService } from '@adecore/agents/usage';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { claudeApiUsageRoots, createAnthropicClaudeApiProvider } from './anthropic-claude-api-provider.ts';
import { AnthropicClaudeApiService } from './anthropic-claude-api-service.ts';
import { ProviderRegistry } from './registry.ts';

const newHome = tempHomes('ruimte-claude-provider-');
const installed = async () => ({ installed: true, version: '2.1.320' });

async function keyedService(home: string): Promise<AnthropicClaudeApiService> {
    const service = new AnthropicClaudeApiService(async () =>
        Response.json({ data: [{ id: 'claude-sonnet-example', display_name: 'Sonnet', line: 'sonnet', max_tokens: 64_000 }] })
    );
    await service.load(home);
    await service.configure('sk-ant-test-only');

    return service;
}

/* What the CLI was started with, through a spawn that starts nothing. */
async function started(
    service: AnthropicClaudeApiService,
    resume: string | null = null,
    selection: BackendLaunch['selection'] = { model: 'claude-sonnet-example', options: {} }
): Promise<{ command: string[]; env: Record<string, string> }> {
    const seen = { command: [] as string[], env: {} as Record<string, string> };
    const launch: BackendLaunch = {
        command: ['claude'],
        cwd: '/work/repo',
        env: { RUIMTE_MCP_URL: 'http://127.0.0.1:4210/mcp', RUIMTE_CONTEXT_TOKEN: 'chat-token', CLAUDE_CODE_OAUTH_TOKEN: 'sign-in' },
        selection,
        modelName: 'Sonnet',
        runtimeMode: 'supervised',
        resume,
        generation: 1,
        instructions: null,
        resumeNote: null,
        spawn: (options) => {
            seen.command = options.command;
            seen.env = options.env;
            let close = (): void => undefined;
            // It exits as soon as it is told to, so a dispose never waits out the grace before a kill.
            const stdout = new ReadableStream<Uint8Array>({
                start: (controller) => {
                    close = () => {
                        close = () => undefined;
                        controller.close();
                        options.onExit?.(0);
                    };
                }
            });

            return {
                pid: 1,
                stdin: { write: () => 0, flush: () => 0, end: () => 0 },
                stdout,
                kill: () => close()
            };
        }
    };
    const provider = createAnthropicClaudeApiProvider(service, createClaudeProvider(), { detect: installed });
    // The session applies the provider's launch additions where it makes a backend; a test that builds one itself does the same.
    const backend = provider.createBackend(provider.launch?.(launch) ?? launch, { onEvent: () => undefined });
    await backend.start();
    await backend.dispose();

    return seen;
}

test('saving, refreshing and removing a Claude API key update the provider offered to other clients', async () => {
    let model = 'claude-sonnet-example';
    const service = new AnthropicClaudeApiService(async () => Response.json({ data: [{ id: model, display_name: model, line: 'sonnet' }] }));
    await service.load(await newHome());
    const provider = createAnthropicClaudeApiProvider(service, createClaudeProvider(), { detect: installed });
    const registry = new ProviderRegistry({ providers: [provider] });
    service.onChange(() => registry.invalidate('anthropic-claude-api'));
    const changes: string[] = [];
    registry.onChange((kind) => changes.push(kind));

    expect(await registry.list()).toEqual([expect.objectContaining({ kind: 'anthropic-claude-api', installed: false })]);
    await service.configure('sk-ant-test-only');
    expect((await registry.list())[0]).toMatchObject({ installed: true, version: 'API key', defaultModel: model });

    model = 'claude-sonnet-updated';
    await service.configure();
    expect((await registry.list())[0]?.models.map((entry) => entry.slug)).toEqual([model]);

    await service.configure('');
    expect((await registry.list())[0]).toMatchObject({ installed: false, models: [] });
    expect(changes).toEqual(['anthropic-claude-api', 'anthropic-claude-api', 'anthropic-claude-api']);
});

test('with a key but no Claude Code installed, the provider is unavailable and says how to install it', async () => {
    const service = await keyedService(await newHome());
    const provider = createAnthropicClaudeApiProvider(service, createClaudeProvider(), { detect: async () => ({ installed: false, version: null }) });
    const [info] = await new ProviderRegistry({ providers: [provider] }).list();

    expect(info).toMatchObject({ installed: false, version: null });
    expect(info?.install?.commands.darwin).toContain('claude.ai/install.sh');
});

test('a chat compacts, reports its cost and never runs in a terminal', () => {
    const { capabilities } = createAnthropicClaudeApiProvider(new AnthropicClaudeApiService(), createClaudeProvider());

    expect(capabilities).toMatchObject({ chat: true, terminal: false, hooks: false, compaction: 'prompt', reportsCost: true });
});

test('a chat runs Claude Code on the key in a folder of its own, with telemetry, error reports, bug reports and updates off', async () => {
    const home = await newHome();
    const service = await keyedService(home);
    const { command, env } = await started(service);

    expect(env).toMatchObject({
        ANTHROPIC_API_KEY: 'sk-ant-test-only',
        CLAUDE_CONFIG_DIR: join(home, 'anthropic-claude-api', 'claude-config'),
        DISABLE_TELEMETRY: '1',
        DISABLE_ERROR_REPORTING: '1',
        DISABLE_BUG_COMMAND: '1',
        DISABLE_AUTOUPDATER: '1',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000'
    });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(command.join(' ')).not.toContain('sk-ant-test-only');
    expect(command).toContain('--strict-mcp-config');
});

test("Ruimte's server and the HTTP servers of api-mcp.json go along, never the token or a stdio server", async () => {
    const home = await newHome();
    await writeFile(
        join(home, 'api-mcp.json'),
        JSON.stringify({
            mcpServers: {
                docs: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${DOCS_TOKEN}' } },
                local: { command: 'node', args: ['server.js'] },
                narrow: { url: 'https://narrow.example.com/mcp', allowedTools: ['search'] },
                off: { url: 'https://off.example.com/mcp', enabled: false }
            }
        })
    );
    const { command } = await started(await keyedService(home));
    const servers = JSON.parse(command[command.indexOf('--mcp-config') + 1]!).mcpServers;

    expect(Object.keys(servers).toSorted()).toEqual(['docs', 'ruimte']);
    expect(servers.docs).toEqual({ type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${DOCS_TOKEN}' } });
    expect(servers.ruimte.headers).toEqual({ Authorization: 'Bearer ${RUIMTE_CONTEXT_TOKEN}' });
    expect(command.join(' ')).not.toContain('chat-token');
    expect(command).toContain('--allowedTools=mcp__ruimte__*');
});

test('a chat from before Claude Code starts a session of its own, and one Claude Code wrote resumes', async () => {
    const home = await newHome();
    const service = await keyedService(home);
    const projects = join(home, 'anthropic-claude-api', 'claude-config', 'projects');
    await mkdir(join(projects, '-work-repo'), { recursive: true });
    await writeFile(join(projects, '-work-repo', 'cli-session.jsonl'), '');
    await mkdir(join(projects, '-elsewhere'), { recursive: true });
    await writeFile(join(projects, '-elsewhere', 'moved-session.jsonl'), '');

    expect((await started(service, '3f0c9a52-6d1e-4c2b-9a7f-1e2d3c4b5a69')).command.some((arg) => arg.startsWith('--resume'))).toBe(false);
    expect((await started(service, 'cli-session')).command).toContain('--resume=cli-session');
    expect((await started(service, 'moved-session')).command).toContain('--resume=moved-session');
});

test("the usage page reads Claude Code's transcripts of these chats under the Claude API, beside the older log", async () => {
    const home = await newHome();
    const service = await keyedService(home);
    const folder = join(home, 'anthropic-claude-api', 'claude-config', 'projects', '-work-repo');
    await mkdir(folder, { recursive: true });
    const line = {
        type: 'assistant',
        timestamp: '2026-10-13T09:00:00.000Z',
        sessionId: 's-api',
        cwd: '/work/repo',
        message: {
            id: 'msg_api',
            model: 'claude-sonnet-example',
            usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 500 }
        }
    };
    await writeFile(join(folder, 's-api.jsonl'), `${JSON.stringify(line)}\n`);
    const usage = new UsageService({ home, allowPriceFetch: false, roots: claudeApiUsageRoots(service), knownProjects: async () => [] });
    const summary = await usage.summary({ from: '2026-10-13', to: '2026-10-13', resolution: 'day', timeZone: 'UTC' });
    usage.stop();

    expect(summary.roots.map((root) => root.provider)).toEqual(['anthropic-claude-api', 'anthropic-claude-api']);
    expect(summary.models).toEqual([
        expect.objectContaining({
            provider: 'anthropic-claude-api',
            model: 'claude-sonnet-example',
            totals: expect.objectContaining({ input: 1000, output: 500 })
        })
    ]);
});

test("its chats run Claude Code in the provider's own config folder", async () => {
    const home = await newHome();
    const service = await keyedService(home);

    expect(createAnthropicClaudeApiProvider(service, createClaudeProvider()).claudeCode).toEqual({
        configDir: join(home, 'anthropic-claude-api', 'claude-config')
    });
});

test("a Claude API model offers Claude Code's reasoning levels, and the one picked reaches the CLI", async () => {
    const service = new AnthropicClaudeApiService(
        async () => Response.json({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5', line: 'sonnet' }] }),
        new ModelCatalog()
    );
    await service.load(await newHome());
    await service.configure('sk-ant-test-only');
    const provider = createAnthropicClaudeApiProvider(service, createClaudeProvider(), { detect: installed });
    const effort = provider.catalog.list()[0]!.options.find((option) => option.id === 'effort');

    expect(effort?.type === 'select' ? effort.choices.map((choice) => choice.id) : []).toEqual(expect.arrayContaining(['low', 'medium', 'high']));

    const { command } = await started(
        service,
        null,
        provider.catalog.normalize({ model: 'claude-sonnet-5-5', options: { effort: 'low', contextWindow: '200k' } })
    );

    expect(command).toContain('--effort=low');
    expect(command).toContain('--model=claude-sonnet-5-5');
});

test('a running chat takes a changed output limit, or a model with another one, on a new process at its next turn', async () => {
    const home = await newHome();
    const service = new AnthropicClaudeApiService(async () =>
        Response.json({
            data: [
                { id: 'claude-sonnet-example', display_name: 'Sonnet', line: 'sonnet', max_tokens: 64_000 },
                { id: 'claude-haiku-example', display_name: 'Haiku', line: 'haiku', max_tokens: 8_000 }
            ]
        })
    );
    await service.load(home);
    await service.configure('sk-ant-test-only');
    const cli = inProcess(fakeClaude);
    const limits: (string | undefined)[] = [];
    const sonnet = { model: 'claude-sonnet-example', options: {} };
    const session = new ChatSession({
        info: {
            chatId: 'api-chat',
            provider: 'anthropic-claude-api',
            cwd: home,
            agentSessionId: null,
            model: null,
            selection: sonnet,
            runtimeMode: 'supervised',
            status: 'idle',
            running: false,
            activeTurnId: null,
            slashCommands: [],
            usage: { contextTokens: 0, contextWindow: 200_000, costUsd: 0, turns: 0 },
            createdAt: 1
        },
        provider: createAnthropicClaudeApiProvider(service, createClaudeProvider(), { detect: installed }),
        env: () => ({}),
        emit: () => undefined,
        persist: () => undefined,
        persistSoon: () => undefined,
        spawn: (options) => {
            limits.push(options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS);

            return cli.spawn(options);
        }
    });

    const turn = async (text: string): Promise<void> => {
        session.send(text);

        for (let i = 0; i < 1000 && (session.info.activeTurnId !== null || session.info.running === false); i++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    };

    try {
        await turn('first');
        await turn('same limit');
        await service.setSettings({ maxOutputTokens: 16_000 });
        await turn('lower limit');
        session.configure({ selection: { model: 'claude-haiku-example', options: {} } });
        await turn('smaller model');

        expect(limits).toEqual(['32000', '16000', '8000']);
        expect(session.info.activeTurnId).toBeNull();
    } finally {
        await session.dispose();
    }
});
