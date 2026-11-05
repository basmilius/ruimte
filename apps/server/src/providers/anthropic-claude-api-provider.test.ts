import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ChatSession, type BackendLaunch } from '@adecore/agents/chat';
import { ModelCatalog } from '@adecore/agents/providers';
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
    const backend = createAnthropicClaudeApiProvider(service, { detect: installed }).createBackend(launch, { onEvent: () => undefined });
    await backend.start();
    await backend.dispose();

    return seen;
}

test('saving, refreshing and removing a Claude API key update the provider offered to other clients', async () => {
    let model = 'claude-sonnet-example';
    const service = new AnthropicClaudeApiService(async () => Response.json({ data: [{ id: model, display_name: model, line: 'sonnet' }] }));
    await service.load(await newHome());
    const provider = createAnthropicClaudeApiProvider(service, { detect: installed });
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
    const provider = createAnthropicClaudeApiProvider(service, { detect: async () => ({ installed: false, version: null }) });
    const [info] = await new ProviderRegistry({ providers: [provider] }).list();

    expect(info).toMatchObject({ installed: false, version: null });
    expect(info?.install?.commands.darwin).toContain('claude.ai/install.sh');
});

test('a chat compacts, reports its cost and never runs in a terminal', () => {
    const { capabilities } = createAnthropicClaudeApiProvider(new AnthropicClaudeApiService());

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

describe('a chat from before Claude Code', () => {
    const SESSION = '3f0c9a52-6d1e-4c2b-9a7f-1e2d3c4b5a69';
    const THREAD = [
        { role: 'user', content: 'The codeword is pineapple.' },
        {
            role: 'assistant',
            content: [
                { type: 'thinking', thinking: 'A secret plan.', signature: 'signed' },
                { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }
            ]
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'const a = 1;' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Noted.' }] },
        { role: 'user', content: 'Stop reading.' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call-2', name: 'shell', input: { command: 'ls' } }] },
        {
            role: 'user',
            content: [
                { type: 'tool_result', tool_use_id: 'call-2', content: 'Interrupted.', is_error: true },
                { type: 'text', text: 'What was the codeword?' }
            ]
        }
    ];

    const transcriptPath = (home: string): string => join(home, 'anthropic-claude-api', 'claude-config', 'projects', '-work-repo', `${SESSION}.jsonl`);
    const keptThread = (home: string): Promise<void> => writeFile(join(home, 'anthropic-claude-api', `${SESSION}.json`), JSON.stringify(THREAD));

    test('goes on from its thread as a Claude Code transcript, with its tool rounds as text in the replies', async () => {
        const home = await newHome();
        const service = await keyedService(home);
        await keptThread(home);

        expect((await started(service, SESSION)).command).toContain(`--resume=${SESSION}`);

        const lines = (await readFile(transcriptPath(home), 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        const said = lines.map((line) => [line.type, line.type === 'user' ? line.message.content : line.message.content[0].text]);

        expect(said).toEqual([
            ['user', expect.stringMatching(/^\[Ruimte: .*\]\n\nThe codeword is pineapple\.$/)],
            ['assistant', '[Tool call: read_file {"path":"a.ts"}]\n\n[Tool result: const a = 1;]\n\nNoted.'],
            ['user', 'Stop reading.'],
            ['assistant', '[Tool call: shell {"command":"ls"}]\n\n[Tool error: Interrupted.]'],
            ['user', 'What was the codeword?']
        ]);
        expect(lines.map((line) => line.parentUuid)).toEqual([null, ...lines.slice(0, -1).map((line) => line.uuid)]);
        expect(new Set(lines.map((line) => line.sessionId))).toEqual(new Set([SESSION]));
    });

    test('takes its thread over once, also after a restart between the first start and the first turn', async () => {
        const home = await newHome();
        const service = await keyedService(home);
        await keptThread(home);
        await started(service, SESSION);
        const written = await readFile(transcriptPath(home), 'utf8');

        const restarted = new AnthropicClaudeApiService(fetch);
        await restarted.load(home);

        expect((await started(restarted, SESSION)).command).toContain(`--resume=${SESSION}`);
        expect(await readFile(transcriptPath(home), 'utf8')).toBe(written);
    });

    test('leaves a chat on Claude Code alone, also when a thread carries its id', async () => {
        const home = await newHome();
        const service = await keyedService(home);
        await keptThread(home);
        await mkdir(dirname(transcriptPath(home)), { recursive: true });
        await writeFile(transcriptPath(home), 'what the CLI wrote\n');

        expect((await started(service, SESSION)).command).toContain(`--resume=${SESSION}`);
        expect(await readFile(transcriptPath(home), 'utf8')).toBe('what the CLI wrote\n');
    });

    test.each([
        ['no thread', null],
        ['a thread that does not parse', 'not json'],
        ['an empty thread', '[]']
    ])('starts a session of its own with %s', async (_name, thread) => {
        const home = await newHome();
        const service = await keyedService(home);
        if (thread !== null) {
            await writeFile(join(home, 'anthropic-claude-api', `${SESSION}.json`), thread);
        }

        expect((await started(service, SESSION)).command.some((arg) => arg.startsWith('--resume'))).toBe(false);
    });

    test('never counts its old turns on the usage page again', async () => {
        const home = await newHome();
        const service = await keyedService(home);
        await keptThread(home);
        await started(service, SESSION);
        const transcript = await readFile(transcriptPath(home), 'utf8');
        const stamped = transcript
            .replaceAll(/"timestamp":"[^"]+"/g, '"timestamp":"2026-10-13T09:00:00.000Z"')
            .replaceAll('"input_tokens":0', '"input_tokens":5000');
        await writeFile(transcriptPath(home), stamped);
        const usage = new UsageService({ home, allowPriceFetch: false, roots: claudeApiUsageRoots(service), knownProjects: async () => [] });
        const summary = await usage.summary({ from: '2026-10-13', to: '2026-10-13', resolution: 'day', timeZone: 'UTC' });
        usage.stop();

        expect(summary.models).toEqual([]);
    });
});

test('a session Claude Code wrote resumes, wherever its transcript sits', async () => {
    const home = await newHome();
    const service = await keyedService(home);
    const projects = join(home, 'anthropic-claude-api', 'claude-config', 'projects');
    await mkdir(join(projects, '-work-repo'), { recursive: true });
    await writeFile(join(projects, '-work-repo', 'cli-session.jsonl'), '');
    await mkdir(join(projects, '-elsewhere'), { recursive: true });
    await writeFile(join(projects, '-elsewhere', 'moved-session.jsonl'), '');

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

    expect(createAnthropicClaudeApiProvider(service).claudeCode).toEqual({ configDir: join(home, 'anthropic-claude-api', 'claude-config') });
});

test("a Claude API model offers Claude Code's reasoning levels, and the one picked reaches the CLI", async () => {
    const service = new AnthropicClaudeApiService(
        async () => Response.json({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5', line: 'sonnet' }] }),
        new ModelCatalog()
    );
    await service.load(await newHome());
    await service.configure('sk-ant-test-only');
    const provider = createAnthropicClaudeApiProvider(service, { detect: installed });
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
        provider: createAnthropicClaudeApiProvider(service, { detect: installed }),
        command: ['claude'],
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
