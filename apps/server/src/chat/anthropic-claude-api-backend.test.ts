import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeMode } from '@ruimte/contracts';
import type { BackendEvent, BackendLaunch, TurnInput } from '@adecore/agents/chat';
import { ANTHROPIC_URL, AnthropicClaudeApiService } from '../providers/anthropic-claude-api-service.ts';
import { AnthropicClaudeApiBackend, type ClaudeApiLimits } from './anthropic-claude-api-backend.ts';
import type { executeNanoTool } from './nanogpt-tools.ts';

const turn: TurnInput = { text: 'What is in the project?', preamble: null, attachments: [], mentions: [], skills: [] };
const MODELS = {
    data: [
        {
            id: 'claude-sonnet-5-5',
            display_name: 'Claude Sonnet 5.5',
            created_at: '2026-09-20T00:00:00Z',
            lifecycle: 'active',
            line: 'sonnet',
            max_input_tokens: 500_000,
            max_tokens: 32_000
        },
        {
            id: 'claude-opus-4-6',
            display_name: 'Claude Opus 4.6',
            created_at: '2026-02-01T00:00:00Z',
            lifecycle: 'active',
            line: 'opus',
            max_input_tokens: 200_000,
            max_tokens: 16_000,
            capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } } }
        }
    ],
    has_more: false,
    last_id: null
};

const homes: string[] = [];
const backends: AnthropicClaudeApiBackend[] = [];
afterEach(async () => {
    await Promise.all(backends.splice(0).map((backend) => backend.dispose()));
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

/* One streamed message: the events of its blocks, then its end with the cumulative counts. */
function message(blocks: object[], options: { stop?: string; start?: object; end?: object } = {}): Response {
    const frame = (event: object) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`;
    const events: object[] = [
        {
            type: 'message_start',
            message: { usage: options.start ?? { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } }
        }
    ];
    blocks.forEach((block, index) => {
        const { delta, deltas, ...start } = block as { delta?: object; deltas?: object[]; type: string };
        events.push({ type: 'content_block_start', index, content_block: start });
        for (const piece of deltas ?? (delta === undefined ? [] : [delta])) {
            events.push({ type: 'content_block_delta', index, delta: piece });
        }
        events.push({ type: 'content_block_stop', index });
    });
    events.push({ type: 'message_delta', delta: { stop_reason: options.stop ?? 'end_turn' }, usage: options.end ?? { output_tokens: 30 } });
    events.push({ type: 'message_stop' });
    return new Response(events.map(frame).join(''));
}

const text = (value: string) => message([{ type: 'text', text: '', delta: { type: 'text_delta', text: value } }]);
const tool = (id: string, name: string, input: object) => ({
    type: 'tool_use',
    id,
    name,
    input: {},
    delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) }
});
const listCall = () => message([tool('toolu_1', 'list_files', { path: '.' })], { stop: 'tool_use' });

interface Body {
    model: string;
    max_tokens: number;
    stream: boolean;
    system: Array<{ type: string; text: string; cache_control?: unknown }>;
    messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
    tools: Array<{ name: string; input_schema: unknown; cache_control?: unknown }>;
    thinking?: unknown;
}

interface Rig {
    backend: AnthropicClaudeApiBackend;
    service: AnthropicClaudeApiService;
    events: BackendEvent[];
    bodies: Body[];
    headers: Headers[];
    tools: string[];
    home: string;
    until(predicate: (event: BackendEvent) => boolean): Promise<BackendEvent>;
}

/* A backend against a fake API that answers each message request with the next response given. */
async function rig(
    responses: Array<() => Response>,
    options: { resume?: string; home?: string; mode?: RuntimeMode; limits?: ClaudeApiLimits; model?: string } = {}
): Promise<Rig> {
    const home = options.home ?? (await mkdtemp(join(tmpdir(), 'ruimte-claude-api-chat-')));
    if (options.home === undefined) {
        homes.push(home);
    }
    const bodies: Body[] = [];
    const headers: Headers[] = [];
    const service = new AnthropicClaudeApiService(async (url, init) => {
        if (url.startsWith(`${ANTHROPIC_URL}/v1/models`)) {
            return new Response(JSON.stringify(MODELS));
        }
        expect(url).toBe(`${ANTHROPIC_URL}/v1/messages`);
        bodies.push(JSON.parse(String(init?.body)));
        headers.push(new Headers(init?.headers));
        const next = responses.shift();
        return next ? next() : new Response('', { status: 500 });
    });
    await service.load(home);
    await service.configure('sk-ant-key');
    const events: BackendEvent[] = [];
    const waiters: Array<{ predicate: (event: BackendEvent) => boolean; resolve: (event: BackendEvent) => void }> = [];
    const tools: string[] = [];
    const executeTool: typeof executeNanoTool = async (_cwd, call) => {
        tools.push(call.name);
        return { output: 'a.txt\nb.txt', failed: false };
    };
    const launch: BackendLaunch = {
        command: ['anthropic-claude-api'],
        cwd: home,
        env: {},
        selection: { model: options.model ?? 'claude-sonnet-5-5', options: {} },
        modelName: 'Claude',
        runtimeMode: options.mode ?? 'supervised',
        resume: options.resume ?? null,
        generation: 1,
        instructions: 'Be brief.',
        resumeNote: null
    };
    const backend = new AnthropicClaudeApiBackend(
        launch,
        {
            onEvent: (event) => {
                events.push(event);
                for (const waiter of [...waiters]) {
                    if (waiter.predicate(event)) {
                        waiters.splice(waiters.indexOf(waiter), 1);
                        waiter.resolve(event);
                    }
                }
            }
        },
        service,
        executeTool,
        options.limits
    );
    backends.push(backend);
    return {
        backend,
        service,
        events,
        bodies,
        headers,
        tools,
        home,
        until: (predicate) => {
            const seen = events.find(predicate);
            return seen ? Promise.resolve(seen) : new Promise((resolve) => waiters.push({ predicate, resolve }));
        }
    };
}

const isDone = (event: BackendEvent) => event.type === 'turn.done';

describe('Claude API backend', () => {
    test('a request carries the key, the tools, and a cache mark on the system prompt, the last tool and the last message', async () => {
        const chat = await rig([() => text('Hello.')]);
        await chat.backend.start();
        chat.backend.sendTurn(turn);
        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });

        const body = chat.bodies[0]!;
        expect(chat.headers[0]!.get('x-api-key')).toBe('sk-ant-key');
        expect(body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 8192, stream: true });
        expect(body.system).toEqual([expect.objectContaining({ type: 'text', cache_control: { type: 'ephemeral' } })]);
        expect(body.system[0]!.text).toContain('Be brief.');
        expect(body.tools.map((entry) => entry.name)).toEqual([
            'list_files',
            'read_file',
            'search_files',
            'edit_file',
            'write_file',
            'run_command',
            'ask_user'
        ]);
        expect(body.tools.at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
        expect(body.tools.slice(0, -1).every((entry) => entry.cache_control === undefined)).toBe(true);
        expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'What is in the project?', cache_control: { type: 'ephemeral' } }] }]);
        expect(chat.events).toContainEqual(expect.objectContaining({ type: 'text.done', text: 'Hello.' }));
    });

    test('a tool runs only after approval, and the results of one turn go back in one message after their calls', async () => {
        const two = () =>
            message([tool('toolu_1', 'list_files', { path: '.' }), tool('toolu_2', 'read_file', { path: 'a.txt', offset: 0 })], { stop: 'tool_use' });
        const chat = await rig([two, () => text('Two files.')]);
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        const first = (await chat.until((event) => event.type === 'approval.requested')) as { requestId: string; toolName: string };
        expect(first.toolName).toBe('ListFiles');
        expect(chat.tools).toEqual([]);
        chat.backend.respondApproval(first.requestId, 'allow');
        const second = (await chat.until((event) => event.type === 'approval.requested' && event.requestId !== first.requestId)) as { requestId: string };
        chat.backend.respondApproval(second.requestId, 'allow');

        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });
        expect(chat.tools).toEqual(['list_files', 'read_file']);
        const sent = chat.bodies[1]!.messages;
        expect(sent.map((entry) => entry.role)).toEqual(['user', 'assistant', 'user']);
        expect(sent[2]!.content).toEqual([
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.txt\nb.txt' },
            { type: 'tool_result', tool_use_id: 'toolu_2', content: 'a.txt\nb.txt', cache_control: { type: 'ephemeral' } }
        ]);
    });

    test('a thinking block goes back with its signature in front of its tool call, and the cache mark is not kept in the thread', async () => {
        const thinking = () =>
            message(
                [
                    {
                        type: 'thinking',
                        thinking: '',
                        signature: '',
                        deltas: [
                            { type: 'thinking_delta', thinking: 'Look first.' },
                            { type: 'signature_delta', signature: 'sig-abc' }
                        ]
                    },
                    tool('toolu_1', 'list_files', { path: '.' })
                ],
                { stop: 'tool_use' }
            );
        const chat = await rig([thinking, () => text('Done.')], { mode: 'full-access' });
        await chat.backend.start();
        chat.backend.sendTurn(turn);
        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });

        const assistant = chat.bodies[1]!.messages[1]!;
        expect(assistant.role).toBe('assistant');
        expect((assistant.content as Array<Record<string, unknown>>)[0]).toMatchObject({ type: 'thinking', thinking: 'Look first.', signature: 'sig-abc' });
        expect((assistant.content as Array<Record<string, unknown>>)[1]).toMatchObject({
            type: 'tool_use',
            id: 'toolu_1',
            name: 'list_files',
            input: { path: '.' }
        });
        expect(chat.events).toContainEqual(expect.objectContaining({ type: 'thinking.done', text: 'Look first.' }));
        // The first request's mark was on a copy: the thread the second request starts from has none on its first message.
        expect(chat.bodies[1]!.messages[0]!.content).toEqual('What is in the project?');
    });

    test('full access runs every tool without asking, and accepting edits still asks for a command', async () => {
        const command = () => message([tool('toolu_2', 'run_command', { command: 'echo hi' })], { stop: 'tool_use' });
        const full = await rig([listCall, () => text('Done.')], { mode: 'full-access' });
        await full.backend.start();
        expect(full.events).toContainEqual(expect.objectContaining({ type: 'session', effectiveRuntimeMode: 'full-access' }));
        full.backend.sendTurn(turn);
        expect(await full.until(isDone)).toMatchObject({ state: 'done' });
        expect(full.tools).toEqual(['list_files']);
        expect(full.events.some((event) => event.type === 'approval.requested')).toBe(false);

        const edits = await rig([listCall, command, () => text('Done.')], { mode: 'auto-accept-edits' });
        await edits.backend.start();
        edits.backend.sendTurn(turn);
        const approval = (await edits.until((event) => event.type === 'approval.requested')) as { requestId: string; toolName: string };
        expect(approval.toolName).toBe('Bash');
        expect(edits.tools).toEqual(['list_files']);
        edits.backend.respondApproval(approval.requestId, 'allow');
        expect(await edits.until(isDone)).toMatchObject({ state: 'done' });
        expect(edits.tools).toEqual(['list_files', 'run_command']);
    });

    test('a denied tool does not run and the model is told so', async () => {
        const chat = await rig([listCall, () => text('Understood.')]);
        await chat.backend.start();
        chat.backend.sendTurn(turn);
        const approval = (await chat.until((event) => event.type === 'approval.requested')) as { requestId: string };
        chat.backend.respondApproval(approval.requestId, 'deny');

        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });
        expect(chat.tools).toEqual([]);
        const result = (chat.bodies[1]!.messages.at(-1)!.content as Array<Record<string, unknown>>)[0]!;
        expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true });
        expect(String(result.content)).toContain('denied');
    });

    test('a question is a card the person answers, in any mode, and the model hears the answer', async () => {
        const ask = () => message([tool('toolu_q', 'ask_user', { question: 'Which name?', options: ['claude-api', 'anthropic'] })], { stop: 'tool_use' });
        const chat = await rig([ask, () => text('Using anthropic.')], { mode: 'full-access' });
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        const card = (await chat.until((event) => event.type === 'question.requested')) as {
            requestId: string;
            questions: Array<{ question: string; choices: Array<{ label: string }> }>;
        };
        expect(card.questions[0]).toMatchObject({ question: 'Which name?', choices: [{ label: 'claude-api' }, { label: 'anthropic' }] });
        expect(chat.events.some((event) => event.type === 'approval.requested')).toBe(false);
        expect(chat.backend.respondQuestion(card.requestId, { [card.requestId]: 'anthropic' })).toBe(true);

        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });
        expect((chat.bodies[1]!.messages.at(-1)!.content as Array<Record<string, unknown>>)[0]).toMatchObject({
            type: 'tool_result',
            tool_use_id: 'toolu_q',
            content: 'anthropic'
        });
        expect(chat.backend.respondQuestion(card.requestId, { [card.requestId]: 'again' })).toBe(false);
    });

    test('a stop while a tool waits withdraws the approval, ends the turn as aborted and leaves no call without a result', async () => {
        const chat = await rig([listCall]);
        await chat.backend.start();
        chat.backend.sendTurn(turn);
        const approval = (await chat.until((event) => event.type === 'approval.requested')) as { requestId: string };
        chat.backend.interrupt();

        expect(await chat.until(isDone)).toMatchObject({ state: 'aborted' });
        expect(chat.events).toContainEqual({ type: 'request.withdrawn', requestId: approval.requestId });
        expect(chat.tools).toEqual([]);
        const session = (chat.events.find((event) => event.type === 'session') as { agentSessionId: string }).agentSessionId;
        const saved = JSON.parse(await readFile(join(chat.service.directory, `${session}.json`), 'utf8'));
        expect(saved.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true }] });
    });

    test('continuing is off until a person turns it on: the first cut ends the turn, and with it on the chat goes by itself', async () => {
        // Five rounds of a tool and no answer: the run is cut, and nothing goes on by itself.
        const more = await rig([listCall, listCall, listCall, listCall, listCall, () => text('Never.')], { mode: 'full-access' });
        await more.service.setSettings({ roundsPerRun: 5 });
        await more.backend.start();
        more.backend.sendTurn(turn);
        expect(await more.until(isDone)).toMatchObject({ state: 'error', error: 'The Claude API reached 5 tool rounds. Send another message to continue.' });
        expect(more.events.some((event) => event.type === 'note')).toBe(false);

        const on = await rig([listCall, listCall, () => text('Done.')], { mode: 'full-access', limits: { roundsPerRun: 2, runs: 3 } });
        await on.backend.start();
        on.backend.sendTurn(turn);
        expect(await on.until(isDone)).toMatchObject({ state: 'done' });
        expect(on.events).toContainEqual({ type: 'note', level: 'info', text: 'Continuing after 2 tool rounds.' });
        // The continue message joins the results it follows, so the thread keeps one user turn there.
        const last = on.bodies[2]!.messages.at(-1)!;
        expect(last.role).toBe('user');
        expect(JSON.stringify(last.content)).toContain('limit of tool rounds');
        expect(on.bodies[2]!.messages.map((entry) => entry.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    });

    test('the thinking parameter goes only to a model that says it takes it', async () => {
        const newer = await rig([() => text('Hi.')]);
        await newer.backend.start();
        newer.backend.sendTurn(turn);
        await newer.until(isDone);
        expect(newer.bodies[0]!.thinking).toBeUndefined();

        const older = await rig([() => text('Hi.')], { model: 'claude-opus-4-6' });
        await older.backend.start();
        older.backend.sendTurn(turn);
        await older.until(isDone);
        expect(older.bodies[0]!.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    });

    test('every call is counted once in the usage log, with the cache kinds apart, and the context meter holds all of them', async () => {
        const counted = () =>
            message([{ type: 'text', text: '', delta: { type: 'text_delta', text: 'Hi.' } }], {
                start: { input_tokens: 20, cache_read_input_tokens: 9000, cache_creation_input_tokens: 400, output_tokens: 1 },
                end: { output_tokens: 250 }
            });
        const chat = await rig([counted]);
        await chat.backend.start();
        const session = (chat.events.find((event) => event.type === 'session') as { agentSessionId: string }).agentSessionId;
        chat.backend.sendTurn(turn);
        await chat.until(isDone);

        expect(chat.events).toContainEqual(expect.objectContaining({ type: 'usage', contextTokens: 9420, contextWindow: 500_000 }));
        const [file] = await readdir(chat.service.usageDirectory);
        const lines = (await readFile(join(chat.service.usageDirectory, file!), 'utf8')).trim().split('\n');
        expect(lines.map((line) => JSON.parse(line))).toEqual([
            expect.objectContaining({ model: 'claude-sonnet-5-5', session, input: 20, cacheRead: 9000, cacheWrite: 400, output: 250, reasoning: 0 })
        ]);
    });

    test('a 401 ends the turn with a sentence that says so and never the key, and a 400 carries Anthropic words', async () => {
        const rejected = await rig([() => new Response('{"error":{"message":"invalid x-api-key sk-ant-key"}}', { status: 401 })]);
        await rejected.backend.start();
        rejected.backend.sendTurn(turn);
        expect(await rejected.until(isDone)).toMatchObject({ state: 'error', error: 'Anthropic rejected the API key.' });
        expect(JSON.stringify(rejected.events)).not.toContain('sk-ant-key');

        const refused = await rig([() => new Response('{"error":{"message":"Your credit balance is too low"}}', { status: 400 })]);
        await refused.backend.start();
        refused.backend.sendTurn(turn);
        expect(await refused.until(isDone)).toMatchObject({ state: 'error', error: 'Anthropic refused the request: Your credit balance is too low' });
    });

    test('a reply cut at its limit of tokens says so, and a refusal is said as one', async () => {
        const cut = await rig([() => message([{ type: 'text', text: '', delta: { type: 'text_delta', text: 'Long' } }], { stop: 'max_tokens' })]);
        await cut.backend.start();
        cut.backend.sendTurn(turn);
        expect(await cut.until(isDone)).toMatchObject({ state: 'error', error: expect.stringContaining('limit of output tokens') });

        const refusal = await rig([() => message([{ type: 'text', text: '', delta: { type: 'text_delta', text: 'No.' } }], { stop: 'refusal' })]);
        await refusal.backend.start();
        refusal.backend.sendTurn(turn);
        expect(await refusal.until(isDone)).toMatchObject({ state: 'error', error: 'Claude declined to answer this.' });
    });

    test('a resumed chat continues the saved conversation, and one with a call that has no result gets an interrupted one', async () => {
        const first = await rig([listCall]);
        await first.backend.start();
        const session = (first.events.find((event) => event.type === 'session') as { agentSessionId: string }).agentSessionId;
        first.backend.sendTurn(turn);
        await first.until((event) => event.type === 'approval.requested');
        first.backend.interrupt();
        await first.until(isDone);
        await first.backend.dispose();

        const second = await rig([() => text('Second answer.')], { resume: session, home: first.home });
        await second.backend.start();
        second.backend.sendTurn({ ...turn, text: 'And now?' });
        await second.until(isDone);

        const roles = second.bodies[0]!.messages.map((entry) => entry.role);
        expect(roles).toEqual(['user', 'assistant', 'user']);
        expect(JSON.stringify(second.bodies[0]!.messages[2]!.content)).toContain('And now?');
        expect(JSON.stringify(second.bodies[0]!.messages[2]!.content)).toContain('tool_result');
    });

    test('a chat does not start without a key, or for a model Anthropic does not list', async () => {
        const nokey = await rig([]);
        await nokey.service.configure('');
        await expect(nokey.backend.start()).rejects.toThrow('Add an Anthropic API key');

        const unknown = await rig([], { model: 'claude-unknown-9' });
        await expect(unknown.backend.start()).rejects.toThrow('Refresh the Claude API models');
    });
});
