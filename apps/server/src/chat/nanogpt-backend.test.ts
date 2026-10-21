import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeMode } from '@ruimte/contracts';
import type { BackendEvent, BackendLaunch, TurnInput } from '@adecore/agents/chat';
import { NANOGPT_URL, NanoGptService } from '../providers/nanogpt-service.ts';
import { NanoGptBackend, type NanoGptLimits } from './nanogpt-backend.ts';
import type { executeNanoTool } from './nanogpt-tools.ts';

const turn: TurnInput = { text: 'What is in the project?', preamble: null, attachments: [], mentions: [], skills: [] };
const MODELS = { data: [{ id: 'tool-model', name: 'Tool model', context_length: 1000, capabilities: { tool_calling: true } }] };

const homes: string[] = [];
const backends: NanoGptBackend[] = [];
afterEach(async () => {
    await Promise.all(backends.splice(0).map((backend) => backend.dispose()));
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

function stream(...chunks: unknown[]): Response {
    return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`);
}

const listCall = () =>
    stream({
        choices: [
            { delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'list_files', arguments: '{"path":"."}' } }] }, finish_reason: 'tool_calls' }
        ]
    });
const reply = (text: string) =>
    stream({
        choices: [{ delta: { content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 5 } }
    });

interface Rig {
    backend: NanoGptBackend;
    service: NanoGptService;
    events: BackendEvent[];
    bodies: Array<{ model: string; messages: Array<{ role: string; content: string; tool_call_id?: string }>; tools?: unknown[]; stream_options?: unknown }>;
    tools: string[];
    until(predicate: (event: BackendEvent) => boolean): Promise<BackendEvent>;
}

/* A backend against a fake API that answers each chat request with the next response given. */
async function rig(
    responses: Array<() => Response>,
    options: { resume?: string; home?: string; mode?: RuntimeMode; limits?: NanoGptLimits } = {}
): Promise<Rig> {
    const home = options.home ?? (await mkdtemp(join(tmpdir(), 'ruimte-nanogpt-chat-')));
    if (options.home === undefined) {
        homes.push(home);
    }
    const bodies: Rig['bodies'] = [];
    const service = new NanoGptService(async (url, init) => {
        if (url === `${NANOGPT_URL}/usage`) {
            return new Response('{}');
        }
        if (url.startsWith(`${NANOGPT_URL}/models`)) {
            return new Response(JSON.stringify(MODELS));
        }
        expect(url).toBe(`${NANOGPT_URL}/chat/completions`);
        bodies.push(JSON.parse(String(init?.body)));
        const next = responses.shift();
        return next ? next() : new Response('', { status: 500 });
    });
    await service.load(home);
    await service.configure('nano-key');
    const events: BackendEvent[] = [];
    const waiters: Array<{ predicate: (event: BackendEvent) => boolean; resolve: (event: BackendEvent) => void }> = [];
    const tools: string[] = [];
    const executeTool: typeof executeNanoTool = async (_cwd, call) => {
        tools.push(call.name);
        return { output: 'a.txt\nb.txt', failed: false };
    };
    const launch: BackendLaunch = {
        command: ['nanogpt'],
        cwd: home,
        env: {},
        selection: { model: 'tool-model', options: {} },
        modelName: 'Tool model',
        runtimeMode: options.mode ?? 'supervised',
        resume: options.resume ?? null,
        generation: 1,
        instructions: 'Be brief.',
        resumeNote: null
    };
    const backend = new NanoGptBackend(
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
        tools,
        until: (predicate) => {
            const seen = events.find(predicate);
            return seen ? Promise.resolve(seen) : new Promise((resolve) => waiters.push({ predicate, resolve }));
        }
    };
}

const isDone = (event: BackendEvent) => event.type === 'turn.done';

describe('NanoGPT backend', () => {
    test('a tool runs only after approval and the model hears its result', async () => {
        const chat = await rig([listCall, () => reply('Two files.')]);
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        const approval = await chat.until((event) => event.type === 'approval.requested');
        expect(approval).toMatchObject({ toolName: 'ListFiles', input: { path: '.' }, canAllowAlways: false });
        expect(chat.tools).toEqual([]);
        chat.backend.respondApproval((approval as { requestId: string }).requestId, 'allow');

        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });
        expect(chat.tools).toEqual(['list_files']);
        expect(chat.events).toContainEqual(expect.objectContaining({ type: 'text.done', text: 'Two files.' }));
        expect(chat.events).toContainEqual(expect.objectContaining({ type: 'usage', contextTokens: 120, contextWindow: 1000 }));
        expect(chat.bodies).toHaveLength(2);
        expect(chat.bodies[0]!.model).toBe('tool-model');
        expect(chat.bodies[0]!.messages[0]).toMatchObject({ role: 'system' });
        expect(chat.bodies[0]!.messages[0]!.content).toContain('Be brief.');
        expect(chat.bodies[0]!.tools?.length).toBeGreaterThan(0);
        expect(chat.bodies[1]!.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call-1', content: 'a.txt\nb.txt' });
    });

    test('full access runs every tool without asking', async () => {
        const chat = await rig([listCall, () => reply('Two files.')], { mode: 'full-access' });
        await chat.backend.start();
        expect(chat.events).toContainEqual(expect.objectContaining({ type: 'session', effectiveRuntimeMode: 'full-access' }));
        chat.backend.sendTurn(turn);

        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });
        expect(chat.tools).toEqual(['list_files']);
        expect(chat.events.some((event) => event.type === 'approval.requested')).toBe(false);
    });

    test('accepting edits lets reads and edits through and still asks for a command', async () => {
        const command = () =>
            stream({
                choices: [
                    {
                        delta: { tool_calls: [{ index: 0, id: 'call-2', function: { name: 'run_command', arguments: '{"command":"echo hi"}' } }] },
                        finish_reason: 'tool_calls'
                    }
                ]
            });
        const chat = await rig([listCall, command, () => reply('Done.')], { mode: 'auto-accept-edits' });
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        const approval = (await chat.until((event) => event.type === 'approval.requested')) as { requestId: string; toolName: string };
        expect(approval.toolName).toBe('Bash');
        // The read before it went through without a card.
        expect(chat.tools).toEqual(['list_files']);
        chat.backend.respondApproval(approval.requestId, 'allow');
        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });
        expect(chat.tools).toEqual(['list_files', 'run_command']);
    });

    test('auto has no classifier here and works as accepting edits', async () => {
        const chat = await rig([], { mode: 'auto' });
        await chat.backend.start();
        expect(chat.events).toContainEqual(expect.objectContaining({ type: 'session', effectiveRuntimeMode: 'auto-accept-edits' }));
    });

    test('every call is counted in the usage log, and the API is asked for the counts', async () => {
        const chat = await rig([() => reply('Hi.')]);
        await chat.backend.start();
        const session = chat.events.find((event) => event.type === 'session') as { agentSessionId: string };
        chat.backend.sendTurn(turn);
        await chat.until(isDone);

        expect(chat.bodies[0]!.stream_options).toEqual({ include_usage: true });
        const [file] = await readdir(chat.service.usageDirectory);
        expect(file).toMatch(/^\d{4}-\d{2}\.jsonl$/);
        const lines = (await readFile(join(chat.service.usageDirectory, file!), 'utf8')).trim().split('\n');
        expect(lines.map((line) => JSON.parse(line))).toEqual([
            expect.objectContaining({
                model: 'tool-model',
                session: session.agentSessionId,
                input: 100,
                cacheRead: 20,
                cacheWrite: 0,
                output: 30,
                reasoning: 5
            })
        ]);
    });

    test('a question is a card the person answers, in any mode, and the model hears the answer', async () => {
        const ask = () =>
            stream({
                choices: [
                    {
                        delta: {
                            tool_calls: [
                                {
                                    index: 0,
                                    id: 'call-q',
                                    function: { name: 'ask_user', arguments: '{"question":"Which name?","options":["claude-api","anthropic"]}' }
                                }
                            ]
                        },
                        finish_reason: 'tool_calls'
                    }
                ]
            });
        const chat = await rig([ask, () => reply('Using anthropic.')], { mode: 'full-access' });
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        const card = (await chat.until((event) => event.type === 'question.requested')) as {
            requestId: string;
            questions: Array<{ id: string; question: string; choices: Array<{ label: string }>; multiSelect: boolean }>;
        };
        expect(card.questions).toEqual([
            expect.objectContaining({
                id: card.requestId,
                question: 'Which name?',
                choices: [expect.objectContaining({ label: 'claude-api' }), expect.objectContaining({ label: 'anthropic' })],
                multiSelect: false
            })
        ]);
        // Nothing to approve: a question is the person's whatever the mode is.
        expect(chat.events.some((event) => event.type === 'approval.requested')).toBe(false);

        expect(chat.backend.respondQuestion(card.requestId, { [card.requestId]: 'anthropic' })).toBe(true);
        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });
        expect(chat.bodies[1]!.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call-q', content: 'anthropic' });
        expect(chat.tools).toEqual([]);
        // An answer to a question that is not open, or one that is not text, is refused.
        expect(chat.backend.respondQuestion(card.requestId, { [card.requestId]: 'again' })).toBe(false);
    });

    test('a question the person declines, or a stop while it waits, ends without an answer', async () => {
        const ask = () =>
            stream({
                choices: [
                    {
                        delta: { tool_calls: [{ index: 0, id: 'call-q', function: { name: 'ask_user', arguments: '{"question":"Sure?"}' } }] },
                        finish_reason: 'tool_calls'
                    }
                ]
            });
        const declined = await rig([ask, () => reply('Fine.')]);
        await declined.backend.start();
        declined.backend.sendTurn(turn);
        const card = (await declined.until((event) => event.type === 'question.requested')) as { requestId: string };
        expect(declined.backend.declineRequest(card.requestId, 'No thanks')).toBe(true);
        expect(await declined.until(isDone)).toMatchObject({ state: 'done' });
        expect(declined.bodies[1]!.messages.at(-1)?.content).toContain('declined');

        const stopped = await rig([ask]);
        await stopped.backend.start();
        stopped.backend.sendTurn(turn);
        const open = (await stopped.until((event) => event.type === 'question.requested')) as { requestId: string };
        stopped.backend.interrupt();
        expect(await stopped.until(isDone)).toMatchObject({ state: 'aborted' });
        expect(stopped.events).toContainEqual({ type: 'request.withdrawn', requestId: open.requestId });
    });

    test('a run that reaches its limit of tool rounds goes on by itself, and says so', async () => {
        const chat = await rig([listCall, listCall, () => reply('Done.')], { mode: 'full-access', limits: { roundsPerRun: 2, runs: 3 } });
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });
        expect(chat.tools).toEqual(['list_files', 'list_files']);
        expect(chat.events).toContainEqual({ type: 'note', level: 'info', text: 'Continuing after 2 tool rounds.' });
        // The model hears it was cut and is told to carry on, as a message of the person's would say.
        const last = chat.bodies[2]!.messages.at(-1)!;
        expect(last.role).toBe('user');
        expect(last.content).toContain('limit of tool rounds');
    });

    test('what a person set in Settings decides, as the run starts: without continuing it stops at its first cut', async () => {
        const chat = await rig([listCall, listCall, listCall, listCall, listCall, () => reply('Never.')], { mode: 'full-access' });
        await chat.service.setSettings({ autoContinue: false, roundsPerRun: 5 });
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        expect(await chat.until(isDone)).toMatchObject({ state: 'error', error: 'NanoGPT reached 5 tool rounds. Send another message to continue.' });
        expect(chat.tools).toHaveLength(5);
        expect(chat.events.some((event) => event.type === 'note')).toBe(false);
    });

    test('a loop that never ends still stops, after the runs it is allowed', async () => {
        const chat = await rig([listCall, listCall, listCall, listCall], { mode: 'full-access', limits: { roundsPerRun: 2, runs: 2 } });
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        expect(await chat.until(isDone)).toMatchObject({ state: 'error', error: 'NanoGPT reached 4 tool rounds. Send another message to continue.' });
        expect(chat.tools).toHaveLength(4);
    });

    test('a denied tool does not run and the model is told so', async () => {
        const chat = await rig([listCall, () => reply('Understood.')]);
        await chat.backend.start();
        chat.backend.sendTurn(turn);
        const approval = (await chat.until((event) => event.type === 'approval.requested')) as { requestId: string };
        chat.backend.respondApproval(approval.requestId, 'deny');

        expect(await chat.until(isDone)).toMatchObject({ state: 'done' });
        expect(chat.tools).toEqual([]);
        expect(chat.bodies[1]!.messages.at(-1)?.content).toContain('denied');
    });

    test('a stop while a tool waits withdraws the approval and ends the turn as aborted', async () => {
        const chat = await rig([listCall]);
        await chat.backend.start();
        chat.backend.sendTurn(turn);
        const approval = (await chat.until((event) => event.type === 'approval.requested')) as { requestId: string };
        chat.backend.interrupt();

        expect(await chat.until(isDone)).toMatchObject({ state: 'aborted' });
        expect(chat.events).toContainEqual({ type: 'request.withdrawn', requestId: approval.requestId });
        expect(chat.tools).toEqual([]);
    });

    test('an HTTP error ends the turn with a sentence of its own and never the response', async () => {
        const chat = await rig([() => new Response('{"error":"bad key nano-key"}', { status: 401 })]);
        await chat.backend.start();
        chat.backend.sendTurn(turn);

        const done = await chat.until(isDone);
        expect(done).toMatchObject({ state: 'error', error: 'NanoGPT rejected the API key.' });
        expect(JSON.stringify(chat.events)).not.toContain('nano-key');
    });

    test('a resumed chat continues the saved conversation', async () => {
        const first = await rig([() => reply('First answer.')]);
        await first.backend.start();
        const session = first.events.find((event) => event.type === 'session') as { agentSessionId: string };
        first.backend.sendTurn(turn);
        await first.until(isDone);
        await first.backend.dispose();

        const home = join(first.service.directory, '..');
        const second = await rig([() => reply('Second answer.')], { resume: session.agentSessionId, home });
        await second.backend.start();
        second.backend.sendTurn({ ...turn, text: 'And now?' });
        await second.until(isDone);

        expect(second.bodies[0]!.messages.slice(1).map((message) => message.content)).toEqual(['What is in the project?', 'First answer.', 'And now?']);
        const saved = JSON.parse(await readFile(join(first.service.directory, `${session.agentSessionId}.json`), 'utf8'));
        expect(saved).toHaveLength(4);
    });

    test('a chat does not start without a key', async () => {
        const chat = await rig([]);
        await chat.service.configure('');
        await expect(chat.backend.start()).rejects.toThrow('Add a NanoGPT Subscription API key');
    });
});
