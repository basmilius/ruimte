import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentStore, ChatStore } from '@adecore/agents/chat';
import { inProcess, type InProcessCli, FAKE_CHILD_STEPS, fakeCodexWith } from '@adecore/agents/testing';
import nativeApprovalCapture from '@adecore/agents/testing/fixtures/codex-0.159.2-native-approval.json';
import { generatedImageAttachment, type ChatInfo, type ChatItem, type ChatSubagentItem } from '@ruimte/contracts';
import type { ContextSource } from '@ruimte/contracts';
import { CONTEXT_LEAD, chatNote, chatPrompt, contextPrompt, toolsNote } from '../context/context-note.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { OPEN_BOUNDS } from '../sessions/open-bounds-test-helpers.ts';
import { testChatManager, type TestChatOptions } from './chat-manager-test-helpers.ts';
import { retire } from './chat-manager.fixture.test.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatRecorder } from './chat-test-helpers.ts';

let home: string;
let store: ChatStore;
let attachments: AttachmentStore;
let manager: ChatManager;
let recorder: ChatRecorder;
let codex: InProcessCli;
let requests: Array<{ method: string; params: Record<string, unknown> }>;
let turnSent: (() => void) | null = null;
let modelPage: ((params: Record<string, unknown>) => unknown) | null;

const png = { name: 'shot.png', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
function turnInputs() {
    return requests.filter((request) => request.method === 'turn/start').map((request) => request.params.input as Array<Record<string, unknown>>);
}

// The device of the session this line was written for; the Claude test asserts against the same call.
const LINKED: ContextSource[] = [{ id: 'dev-1', kind: 'device', title: 'iPhone 18 Pro Max' }];

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

function makeManager(extra: Partial<TestChatOptions> = {}) {
    return testChatManager({ ...OPEN_BOUNDS, providers, store, attachments, spawn: codex.spawn, env: { PATH: process.env.PATH, HOME: home }, ...extra });
}

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-codex-'));
    attachments = new AttachmentStore(home);
    store = new ChatStore(home, { attachments: attachments });
    requests = [];
    turnSent = null;
    modelPage = null;
    codex = inProcess((io) => {
        const program = fakeCodexWith({ resumeLead: CONTEXT_LEAD })(io);
        return {
            onLine: (line) => {
                const frame = JSON.parse(line);
                if (frame.method) {
                    requests.push(frame);
                    if (frame.method === 'turn/start') {
                        turnSent?.();
                    }
                }
                if (frame.method === 'model/list' && modelPage) {
                    io.out({ id: frame.id, result: modelPage(frame.params) });
                } else {
                    program.onLine(line);
                }
            }
        };
    });
    manager = makeManager();
    recorder = new ChatRecorder();
    manager.core.subscribe('c1', recorder.sink());
});

afterEach(async () => {
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

function needsYou() {
    return recorder.info?.status === 'needs-you';
}

// A restart: the old manager goes, a new one reads the same store and a fresh client listens.
async function remake(extra: Partial<TestChatOptions> = {}): Promise<void> {
    await retire(manager);
    manager = makeManager(extra);
    recorder = new ChatRecorder();
    manager.core.subscribe('c1', recorder.sink());
}

async function open(chatId: string, extra: Record<string, unknown> = {}): Promise<ChatInfo> {
    const info = await manager.core.create({ chatId, provider: 'codex', cwd: home, ...extra });
    manager.core.attach(chatId, 'c1');
    return info;
}

describe('ChatManager with Codex', () => {
    test.each(['Inspect these', ''])('sends actual image inputs with prompt %j and keeps originals in the thread', async (text) => {
        await open('chat-images');
        await manager.core.send('chat-images', text, {}, [png, { ...png, name: 'finder.PNG', mime: 'application/octet-stream' }]);
        await recorder.untilIdle();
        const saved = recorder.ofKind('user')[0]!.attachments!;
        expect(saved).toHaveLength(2);
        expect(saved.map((attachment) => attachment.mime)).toEqual(['image/png', 'image/png']);
        expect(turnInputs()[0]).toEqual([
            { type: 'text', text: expect.stringContaining(saved[0]!.path), text_elements: [] },
            ...saved.map((attachment) => ({ type: 'localImage', path: attachment.path }))
        ]);
        expect((await readFile(saved[0]!.path)).toString('base64')).toBe(png.data);
        expect(recorder.ofKind('user')[0]!.text).toBe(text);
    });

    test('keeps unsupported images and documents as file references alongside native images', async () => {
        await open('chat-mixed');
        await manager.core.send('chat-mixed', 'Look', {}, [
            png,
            { name: 'drawing.svg', mime: 'image/svg+xml', data: btoa('<svg/>') },
            { name: 'notes.txt', mime: 'text/plain', data: btoa('notes') }
        ]);
        await recorder.untilIdle();
        const saved = recorder.ofKind('user')[0]!.attachments!;
        expect(turnInputs()[0]!.filter((input) => input.type === 'localImage')).toEqual([{ type: 'localImage', path: saved[0]!.path }]);
        for (const attachment of saved) {
            expect(turnInputs()[0]![0]!.text).toContain(attachment.path);
        }
    });

    test('queued images are sent after the active turn and survive reopening the chat', async () => {
        await open('chat-queued-image');
        await manager.core.send('chat-queued-image', 'slow');
        await recorder.until(() => recorder.ofKind('assistant').length === 1);
        expect(await manager.core.send('chat-queued-image', '', { delivery: 'queue' }, [png])).toMatchObject({ queued: true });
        const queued = recorder.info!.queue![0]!.attachments![0]!;
        manager.core.cancel('chat-queued-image');
        await recorder.untilIdle();
        expect(turnInputs()).toHaveLength(1);
        expect(recorder.info?.queuePaused).toBe(true);
        manager.core.sendNow('chat-queued-image', recorder.info!.queue![0]!.id);
        await recorder.until(() => turnInputs().length === 2 && recorder.ofKind('turn').at(-1)?.state === 'done' && recorder.idle);
        expect(turnInputs()[1]!.at(-1)).toEqual({ type: 'localImage', path: queued.path });
        const threadId = recorder.info!.agentSessionId;
        await remake();
        await manager.core.create({ chatId: 'chat-queued-image' });
        const snapshot = manager.core.attach('chat-queued-image', 'c1');
        expect(snapshot.items.find((item) => item.kind === 'user' && item.attachments?.length)).toMatchObject({ attachments: [queued] });
        expect(await Bun.file(queued.path).exists()).toBe(true);
        await manager.core.send('chat-queued-image', 'Another', {}, [png]);
        await recorder.untilIdle();
        expect(recorder.info!.agentSessionId).toBe(threadId);
        expect(turnInputs()[2]!.at(-1)?.type).toBe('localImage');
    });

    test('a queued image removed from disk fails visibly without sending an incomplete prompt', async () => {
        await open('chat-missing-image');
        await manager.core.send('chat-missing-image', 'slow');
        await recorder.until(() => recorder.ofKind('assistant').length === 1);
        await manager.core.send('chat-missing-image', 'Look', { delivery: 'queue' }, [png]);
        await rm(recorder.info!.queue![0]!.attachments![0]!.path);
        manager.core.cancel('chat-missing-image');
        await recorder.untilIdle();
        manager.core.sendNow('chat-missing-image', recorder.info!.queue![0]!.id);
        await recorder.until(() => recorder.ofKind('note').some((note) => note.text.includes('Could not read attached image')));
        expect(turnInputs()).toHaveLength(1);
        expect(recorder.ofKind('turn').at(-1)?.state).toBe('error');
    });

    test('refuses images for a text-only model and can send text afterwards', async () => {
        await open('chat-text-only', { selection: { model: 'spark' } });
        await manager.core.send('chat-text-only', 'Look', {}, [png]);
        await recorder.until(() => recorder.ofKind('note').some((note) => note.text.includes('does not support image input')));
        expect(turnInputs()).toHaveLength(0);
        await manager.core.send('chat-text-only', 'hello');
        await recorder.untilIdle();
        expect(turnInputs()).toHaveLength(1);
    });

    test('finds image support on a later model page and tolerates older metadata without modalities', async () => {
        modelPage = (params) =>
            params.cursor === 'next'
                ? { data: [{ model: 'gpt-6-astra', inputModalities: ['text'] }], nextCursor: null }
                : { data: [{ model: 'other', inputModalities: ['text', 'image'] }], nextCursor: 'next' };
        await open('chat-paged');
        await manager.core.send('chat-paged', 'Look', {}, [png]);
        await recorder.until(() => recorder.ofKind('note').some((note) => note.text.includes('does not support image input')));
        expect(turnInputs()).toHaveLength(0);
        modelPage = () => ({ data: [{ model: 'gpt-5.6-sol' }], nextCursor: null });
        manager.core.configure({ chatId: 'chat-paged', selection: { model: 'sol', options: {} } });
        await manager.core.send('chat-paged', 'Look', {}, [png]);
        await recorder.untilIdle();
        expect(turnInputs()[0]!.at(-1)?.type).toBe('localImage');
    });

    test('rejects invalid uploads before starting a turn or writing any files', async () => {
        await open('chat-invalid');
        await expect(manager.core.send('chat-invalid', 'Look', {}, [{ ...png, data: 'not base64' }])).rejects.toMatchObject({ code: 'invalid-attachments' });
        expect(codex.started).toHaveLength(0);
        expect(await Bun.file(join(home, 'attachments', 'chat-invalid')).exists()).toBe(false);
        expect(recorder.ofKind('user')).toHaveLength(0);
    });

    test('a codex chat starts the app-server on the first send, handshakes and streams a reply', async () => {
        const info = await open('chat-1');
        expect(info).toMatchObject({
            provider: 'codex',
            running: false,
            status: 'idle',
            agentSessionId: null,
            selection: { model: 'gpt-6-astra', options: { effort: 'medium' } },
            usage: { contextWindow: 258400 }
        });
        expect(codex.started).toHaveLength(0);
        await manager.core.send('chat-1', 'hello there');
        expect(manager.core.get('chat-1')?.running).toBe(true);
        // A send while a turn runs queues instead of failing, so the test unqueues it to reach idle.
        expect(await manager.core.send('chat-1', 'again')).toMatchObject({ queued: true });
        manager.core.unqueue('chat-1', manager.core.get('chat-1')!.info.queue![0]!.id);
        await recorder.untilIdle();

        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['hello there']);
        expect(recorder.deltas).toBe('echo: hello there (medium)');
        const assistant = recorder.ofKind('assistant');
        expect(assistant).toHaveLength(1);
        expect(assistant[0]).toMatchObject({ text: 'echo: hello there (medium)', streaming: false });
        const turn = recorder.ofKind('turn')[0];
        expect(turn).toMatchObject({ state: 'done' });
        expect(assistant[0]?.turnId).toBe(turn?.id ?? '');
        // Full access maps to a "never ask" sandbox with full access, which the fake echoes back as the model string.
        expect(recorder.info).toMatchObject({
            model: 'gpt-6-astra never danger-full-access',
            usage: { turns: 1, contextTokens: 25090, contextWindow: 258400 }
        });
        expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
        expect(manager.core.attach('chat-1', 'c2').items.map((item) => item.kind)).toEqual(['turn', 'user', 'assistant']);
    });

    test('the window the CLI of the pick before reports does not land on a meter that already reads the new one', async () => {
        await open('chat-window');
        await manager.core.send('chat-window', 'tool: date');
        await recorder.until(needsYou);
        expect(recorder.info?.usage.contextWindow).toBe(258400);

        expect(manager.core.configure({ chatId: 'chat-window', selection: { model: 'gpt-5.3-codex-spark', options: {} } })).toMatchObject({
            usage: { contextWindow: 121600 }
        });
        // The turn in flight is the wider model's, and the usage it reports is that thread's.
        manager.core.approve('chat-window', recorder.ofKind('approval')[0]!.requestId, 'allow');
        await recorder.untilIdle();
        expect(recorder.info?.usage.contextWindow).toBe(121600);

        // The restart runs on the new pick, so what it reports is the chat's own again.
        const turns = recorder.info!.usage.turns;
        await manager.core.send('chat-window', 'after');
        await recorder.until(() => recorder.info?.usage.turns === turns + 1 && recorder.idle);
        expect(recorder.info?.model).toContain('gpt-5.3-codex-spark');
        expect(recorder.info?.usage.contextWindow).toBe(121600);
    });

    test('a command approval becomes an approval card; allowing always sends the policy amendment', async () => {
        await open('chat-2');
        await manager.core.send('chat-2', 'tool: date');
        await recorder.until(needsYou);

        const approval = recorder.ofKind('approval')[0];
        expect(approval).toMatchObject({
            toolName: 'Bash',
            input: { command: 'date' },
            decision: 'pending',
            canAllowAlways: true,
            description: 'Run a command'
        });
        expect(recorder.ofKind('tool')[0]).toMatchObject({ name: 'Bash', input: { command: 'date' }, state: 'running', output: null });

        expect(() => manager.core.approve('chat-2', 'nope', 'allow')).toThrow('Nothing waits');
        manager.core.approve('chat-2', approval!.requestId, 'allow-always');
        await recorder.untilIdle();
        expect(recorder.ofKind('approval')[0]?.decision).toBe('allow-always');
        expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'done', output: 'ran: date\n' });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['done, remembered']);
    });

    test('denying declines the command and the tool ends in error', async () => {
        await open('chat-3');
        await manager.core.send('chat-3', 'tool: rm -rf /');
        await recorder.until(needsYou);
        manager.core.approve('chat-3', recorder.ofKind('approval')[0]!.requestId, 'deny', 'not that');
        await recorder.untilIdle();
        expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'error' });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['denied']);
    });

    test('a file change asks too and shows the diff on the tool item', async () => {
        await open('chat-e');
        await manager.core.send('chat-e', 'edit: hello.txt');
        await recorder.until(needsYou);
        expect(recorder.ofKind('approval')[0]).toMatchObject({ toolName: 'ApplyPatch', description: 'Write outside the sandbox', canAllowAlways: false });
        manager.core.approve('chat-e', recorder.ofKind('approval')[0]!.requestId, 'allow');
        await recorder.untilIdle();
        expect(recorder.ofKind('tool')[0]).toMatchObject({ name: 'ApplyPatch', state: 'done', output: '+++ hello.txt\n+hello\n' });
    });

    test('a blocking question is answered by question id', async () => {
        await open('chat-q');
        await manager.core.send('chat-q', 'ask: Which color?');
        await recorder.until(needsYou);
        const question = recorder.ofKind('question')[0];
        expect(question).toMatchObject({ state: 'pending', questions: [{ id: 'color', header: 'Choice', question: 'Which color?', multiSelect: false }] });
        expect(question?.questions[0]?.choices.map((choice) => choice.label)).toEqual(['Red', 'Blue']);

        expect(() => manager.core.answer('chat-q', 'nope', {})).toThrow('No question');
        manager.core.answer('chat-q', question!.requestId, { color: 'Blue' });
        await recorder.untilIdle();
        expect(recorder.ofKind('question')[0]).toMatchObject({ state: 'answered', answers: { color: 'Blue' } });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['you chose Blue']);
    });

    test('an async question is answered by steering the running turn', async () => {
        await open('chat-a');
        await manager.core.send('chat-a', 'async: Which color?');
        await recorder.until(needsYou);
        const question = recorder.ofKind('question')[0];
        expect(question?.questions[0]).toMatchObject({ id: '0', question: 'Which color?' });
        manager.core.answer('chat-a', question!.requestId, { '0': 'Red' });
        await recorder.untilIdle();
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['you chose Red']);
    });

    test('a blocking question cannot be dismissed', async () => {
        await open('chat-b');
        await manager.core.send('chat-b', 'ask: Which color?');
        await recorder.until(needsYou);
        const blocking = recorder.ofKind('question')[0]!;
        expect(blocking.async).toBeUndefined();
        expect(() => manager.core.dismiss('chat-b', blocking.id)).toThrow('No question to dismiss');
    });

    test('an async question is dismissed without telling Codex and settles as dismissed', async () => {
        await open('chat-d');
        await manager.core.send('chat-d', 'async: Which color?');
        await recorder.until(needsYou);
        const asked = recorder.ofKind('question')[0]!;
        expect(asked.async).toBe(true);
        manager.core.dismiss('chat-d', asked.id);
        expect(recorder.items.get(asked.id)).toMatchObject({ state: 'dismissed' });
        // The turn goes on, since Codex asked beside it and never waits for the answer.
        expect(recorder.info?.status).toBe('running');
        expect(() => manager.core.dismiss('chat-d', asked.id)).toThrow('No question to dismiss');
    });

    test('cancel interrupts a running turn and marks it aborted', async () => {
        await open('chat-4');
        await manager.core.send('chat-4', 'slow');
        await recorder.until(() => recorder.ofKind('assistant').length === 1);
        manager.core.cancel('chat-4');
        await recorder.untilIdle();
        expect(recorder.ofKind('turn')[0]?.state).toBe('aborted');
        expect(recorder.ofKind('assistant')[0]?.streaming).toBe(false);
    });

    test.each([false, true])('a reply after background output completes with native background turn %j and delivers steering', async (nativeBackground) => {
        let sends = 0;
        const probe = inProcess((io) => {
            const program = fakeCodexWith({ resumeLead: CONTEXT_LEAD })(io);
            return {
                onLine: (line) => {
                    const frame = JSON.parse(line);
                    if (frame.method === 'turn/start' && sends === 1 && nativeBackground) {
                        io.out({
                            method: 'turn/completed',
                            params: { threadId: frame.params.threadId, turn: { id: 'background-turn', status: 'completed', items: [], error: null } }
                        });
                    }
                    program.onLine(line);
                    if (frame.method !== 'turn/start') {
                        return;
                    }
                    sends += 1;
                    const threadId = frame.params.threadId;
                    if (sends === 1) {
                        io.later(() => {
                            if (nativeBackground) {
                                io.out({
                                    method: 'turn/started',
                                    params: { threadId, turn: { id: 'background-turn', status: 'inProgress', items: [], error: null } }
                                });
                            }
                            io.out({
                                method: 'item/completed',
                                params: {
                                    threadId,
                                    item: { type: 'agentMessage', id: 'background-report', text: 'Background work finished', phase: 'commentary' }
                                }
                            });
                        });
                    }
                    io.out({
                        method: 'thread/tokenUsage/updated',
                        params: { threadId, tokenUsage: { last: { totalTokens: 25090 + sends } } }
                    });
                }
            };
        });
        await remake({ spawn: probe.spawn });
        await open('chat-background-reply');
        await manager.core.send('chat-background-reply', 'first');
        await recorder.untilIdle();
        probe.started[0]!.runLater();
        await recorder.until(() => recorder.ofKind('assistant').some((item) => item.text === 'Background work finished'));
        expect(recorder.ofKind('turn').at(-1)).toMatchObject({ origin: 'agent', state: 'running' });

        await manager.core.send('chat-background-reply', 'second');
        await recorder.until(() => recorder.info?.usage.contextTokens === 25092);
        expect(recorder.ofKind('assistant').at(-1)).toMatchObject({ text: 'echo: second (medium)', streaming: false });
        expect(recorder.info).toMatchObject({ status: 'idle', activeTurnId: null });
        expect(recorder.ofKind('turn').at(-1)?.state).toBe('done');

        expect(await manager.core.send('chat-background-reply', 'third', { delivery: 'steer' })).toMatchObject({ queued: false });
        await recorder.until(() => recorder.info?.usage.contextTokens === 25093);
        expect(recorder.info).toMatchObject({ status: 'idle', activeTurnId: null });
        expect(recorder.info?.queue ?? []).toEqual([]);
    });

    for (const arrivesAfterRoot of [false, true]) {
        test(`Stop declines a native child approval ${arrivesAfterRoot ? 'arriving after' : 'held across'} root completion`, async () => {
            const answered = Promise.withResolvers<unknown>();
            const probe = inProcess((io) => {
                const program = fakeCodexWith({ resumeLead: CONTEXT_LEAD })(io);
                return {
                    onLine: (line) => {
                        const frame = JSON.parse(line);
                        if (frame.method === 'turn/start') {
                            const root = nativeApprovalCapture.frames.find(
                                (event) => event.method === 'turn/completed' && event.params.threadId === nativeApprovalCapture.rootThreadId
                            )!;
                            const approval = nativeApprovalCapture.frames.find((event) => event.method.endsWith('/requestApproval'))!;
                            const spawn = nativeApprovalCapture.frames.filter((event) => event.method.startsWith('item/') && event.id === undefined);
                            io.out({ id: frame.id, result: { turn: root.params.turn } });
                            const events = [...spawn, ...(arrivesAfterRoot ? [root, approval] : [approval, root])];
                            for (const event of events) {
                                io.out({
                                    ...event,
                                    params: {
                                        ...event.params,
                                        threadId: event.params.threadId === nativeApprovalCapture.rootThreadId ? frame.params.threadId : event.params.threadId
                                    }
                                });
                            }
                        } else if (frame.method === undefined && frame.id === 0) {
                            answered.resolve(frame.result);
                        } else {
                            program.onLine(line);
                        }
                    }
                };
            });
            await remake({ spawn: probe.spawn });
            await open('chat-child-approval');
            await manager.core.send('chat-child-approval', 'probe');
            await recorder.until(() => recorder.ofKind('turn')[0]?.state === 'done' && recorder.ofKind('approval')[0]?.decision === 'pending');
            manager.core.cancel('chat-child-approval');
            expect(await answered.promise).toEqual({ decision: 'decline' });
            await recorder.until(() => recorder.ofKind('approval')[0]?.decision === 'cancelled');
            expect(recorder.info?.activeTurnId).toBeNull();
            expect(recorder.ofKind('subagent')[0]?.status).toBe('running');
            expect(probe.started).toHaveLength(1);
        });
    }

    test('a cancel sent before Codex named the turn still interrupts it', async () => {
        await open('chat-4');
        const sent = Promise.withResolvers<void>();
        turnSent = () => sent.resolve();
        await manager.core.send('chat-4', 'slow');
        await sent.promise;
        manager.core.cancel('chat-4');
        await recorder.untilIdle();
        expect(recorder.ofKind('turn')[0]?.state).toBe('aborted');
        expect(requests.filter((request) => request.method === 'turn/interrupt')).toHaveLength(1);
    });

    test('configure restarts the app-server with the new settings on the next send and resumes the thread', async () => {
        await open('chat-c');
        await manager.core.send('chat-c', 'first');
        await recorder.untilIdle();
        const threadId = recorder.info?.agentSessionId;

        const info = manager.core.configure({
            chatId: 'chat-c',
            selection: { model: 'sol', options: { effort: 'xhigh' } },
            runtimeMode: 'supervised'
        });
        expect(info).toMatchObject({ selection: { model: 'gpt-6.1-sol', options: { effort: 'xhigh' } }, runtimeMode: 'supervised' });
        expect(manager.core.configure({ chatId: 'chat-c', runtimeMode: 'supervised' })).toBe(info);

        await manager.core.send('chat-c', 'again');
        await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
        expect(recorder.info?.agentSessionId).toBe(threadId ?? null);
        expect(recorder.info?.model).toBe('gpt-6.1-sol untrusted read-only');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first (medium)', 'echo: again (xhigh)']);
        expect(codex.started).toHaveLength(2);
        expect(await codex.started[0]!.exited).toBe(0);
    });

    test('a thread survives a new manager and the next send resumes the same Codex thread', async () => {
        await open('chat-5');
        await manager.core.send('chat-5', 'first');
        await recorder.untilIdle();
        const threadId = recorder.info?.agentSessionId;
        // Shutdown persists every thread, so the manager built next reads it back.
        await manager.core.shutdown();

        const again = makeManager();
        const other = new ChatRecorder();
        again.core.subscribe('c9', other.sink());
        // Created without a provider, since the record on disk already says codex.
        const info = await again.core.create({ chatId: 'chat-5' });
        expect(info).toMatchObject({ provider: 'codex', agentSessionId: threadId, running: false, status: 'idle', usage: { turns: 1 } });
        again.core.attach('chat-5', 'c9');
        void again.core.send('chat-5', 'second');
        await other.until(() => other.info?.status === 'idle' && other.info.running);
        expect(other.info?.agentSessionId).toBe(threadId ?? null);
        expect(other.info?.usage.turns).toBe(2);
        await retire(again);
    });

    test('after a clear the next send starts a new Codex thread instead of resuming', async () => {
        await open('chat-clear');
        await manager.core.send('chat-clear', 'first');
        await recorder.untilIdle();
        const threadId = recorder.info?.agentSessionId;
        expect(threadId?.startsWith('fake-')).toBe(true);

        await manager.core.clear('chat-clear');
        expect(recorder.info).toMatchObject({ agentSessionId: null, running: false, activeTurnId: null });
        expect(manager.core.attach('chat-clear', 'c1').items).toEqual([]);

        await manager.core.send('chat-clear', 'second');
        await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
        // `thread/resume` hands the fake its old id back; `thread/start` makes a new one.
        expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
        expect(recorder.info?.agentSessionId).not.toBe(threadId);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: second (medium)']);
    });

    test('a client opening an agent before its outbox start keeps the requested model', async () => {
        await remake({ openingAgent: (chatId) => ({ chatId, selection: { model: 'gpt-5.6-sol', options: {} } }) });
        const info = await manager.core.create({ chatId: 'chat-model', provider: 'codex', cwd: home, selection: { model: 'gpt-6-astra', options: {} } });
        expect(info.selection.model).toBe('gpt-5.6-sol');
        await manager.core.configure({ chatId: 'chat-model', selection: { model: 'gpt-5.6-luna', options: {} } });
        await remake({ openingAgent: (chatId) => ({ chatId, selection: { model: 'gpt-5.6-sol', options: {} } }) });
        const restored = await manager.core.create({ chatId: 'chat-model', provider: 'codex', cwd: home });
        expect(restored.selection.model).toBe('gpt-5.6-luna');
    });

    test('a client opening an agent before its outbox start keeps the planned mode, while a later choice survives a reload', async () => {
        const openingAgent = (chatId: string) => ({ chatId, runtimeMode: 'full-access' as const });
        await remake({ openingAgent });
        await open('chat-mode', { selection: { model: 'gpt-6.1-sol', options: {} }, runtimeMode: 'supervised' });
        expect(manager.core.get('chat-mode')?.info.runtimeMode).toBe('full-access');
        await manager.core.send('chat-mode', 'hello');
        await recorder.untilIdle();
        expect(recorder.info?.model).toBe('gpt-6.1-sol never danger-full-access');

        manager.core.configure({ chatId: 'chat-mode', runtimeMode: 'supervised' });
        await remake({ openingAgent });
        const restored = await manager.core.create({ chatId: 'chat-mode', provider: 'codex', cwd: home });
        expect(restored.runtimeMode).toBe('supervised');
    });

    test('a standalone chat passes its location to Codex developer instructions', async () => {
        await remake({ standalone: (id) => id === 'chat-view' });
        await open('chat-view');
        await manager.core.send('chat-view', 'note?');
        await recorder.untilIdle();
        expect(recorder.ofKind('assistant')[0]?.text).toBe(toolsNote({ depth: 0, standalone: true }));
    });

    test('a thread starts with the note about the tools as developer instructions, and no prompt carries it', async () => {
        await remake({ depthOf: () => 1 });
        await open('chat-note');
        await manager.core.send('chat-note', 'note?');
        await recorder.untilIdle();
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual([toolsNote({ depth: 1 })]);
        await manager.core.send('chat-note', 'hi');
        await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
        expect(turnInputs().map((input) => input[0]!.text)).toEqual(['note?', 'hi']);
    });

    test('a thread with links names them in its developer instructions, the way Claude hears them', async () => {
        await remake({ contextSources: () => LINKED, depthOf: () => 2 });
        await open('chat-linked-note');
        await manager.core.send('chat-linked-note', 'note?');
        await recorder.untilIdle();
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual([chatPrompt({ sources: LINKED, depth: 2 })]);
        expect(recorder.ofKind('assistant')[0]?.text).toContain('"iPhone 18 Pro Max" (device)');
        // A start already carries the names, so nothing is pasted in front of the prompt as well.
        expect(turnInputs().map((input) => input[0]!.text)).toEqual(['note?']);
    });

    test('a resumed thread whose note is unchanged keeps its instructions and hears about its links in front of the first prompt only', async () => {
        await open('chat-resumed-note');
        await manager.core.send('chat-resumed-note', 'first');
        await recorder.untilIdle();
        await retire(manager);

        const sources: ContextSource[] = [{ id: 'text-1', kind: 'text', title: 'Brief' }];
        manager = makeManager({ contextSources: () => sources });
        const again = new ChatRecorder();
        manager.core.subscribe('c2', again.sink());
        await manager.core.create({ chatId: 'chat-resumed-note' });
        manager.core.attach('chat-resumed-note', 'c2');
        await manager.core.send('chat-resumed-note', 'note?');
        await again.until(() => again.ofKind('assistant').length === 1 && again.info?.activeTurnId === null);
        await manager.core.send('chat-resumed-note', 'pasted?');
        await again.until(() => again.ofKind('assistant').length === 2 && again.info?.activeTurnId === null);
        expect(again.ofKind('assistant').map((item) => item.text)).toEqual([chatPrompt({ sources: [], depth: 0 }), contextPrompt(sources)!]);
        expect(requests.filter((request) => request.method === 'thread/resume').map((request) => request.params.developerInstructions)).toEqual([undefined]);
        expect(requests.some((request) => request.method === 'thread/inject_items')).toBe(false);
        expect(turnInputs().at(-1)![0]!.text).toBe('pasted?');
    });

    test('a resumed thread whose note changed takes the new one in as developer instructions, once', async () => {
        await open('chat-changed-note');
        await manager.core.send('chat-changed-note', 'first');
        await recorder.untilIdle();
        await retire(manager);

        // A linked device adds a line to the note, as a new release of Ruimte would change it.
        for (const round of [1, 2]) {
            manager = makeManager({ contextSources: () => LINKED });
            const again = new ChatRecorder();
            manager.core.subscribe('c2', again.sink());
            await manager.core.create({ chatId: 'chat-changed-note' });
            manager.core.attach('chat-changed-note', 'c2');
            await manager.core.send('chat-changed-note', 'note?');
            await again.until(() => again.ofKind('assistant').length === 1 && again.info?.activeTurnId === null);
            expect(again.ofKind('assistant')[0]?.text).toBe(chatNote({ sources: LINKED, depth: 0 }));
            expect(requests.filter((request) => request.method === 'thread/inject_items')).toHaveLength(1);
            if (round === 1) {
                await retire(manager);
            }
        }
    });

    test('a thread from before Ruimte kept a digest of its note hears the note once', async () => {
        await open('chat-old-thread', { resume: 'thread-old' });
        await manager.core.send('chat-old-thread', 'note?');
        await recorder.untilIdle();
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual([chatNote({ sources: [], depth: 0 })]);
        expect(requests.filter((request) => request.method === 'thread/inject_items').map((request) => request.params.threadId)).toEqual(['thread-old']);
    });

    test('a thread Codex no longer has starts fresh with a warning', async () => {
        await open('chat-g', { resume: 'gone' });
        await manager.core.send('chat-g', 'hi');
        await recorder.untilIdle();
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'warning', text: expect.stringContaining('could not resume') });
        expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: hi (medium)']);
    });

    test('a turn over the usage limit or on an overloaded server ends in an error that names it', async () => {
        await open('chat-limit');
        await manager.core.send('chat-limit', 'limit:1789000000');
        await recorder.untilIdle();
        expect(recorder.ofKind('turn')[0]).toMatchObject({ state: 'error', limit: { kind: 'usage', resetsAt: 1_789_000_000_000 } });
        await manager.core.send('chat-limit', 'overloaded');
        await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
        expect(recorder.ofKind('turn')[1]).toMatchObject({ state: 'error', limit: { kind: 'overload' } });
    });

    test('compaction shows up as a marker in a turn of its own', async () => {
        await open('chat-k');
        await manager.core.send('chat-k', 'x');
        await recorder.untilIdle();
        manager.core.compact('chat-k');
        await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
        expect(recorder.ofKind('compaction')).toHaveLength(1);
        expect(recorder.ofKind('turn').map((turn) => turn.state)).toEqual(['done', 'done']);
    });

    test('a failed turn leaves an error note and the chat can go on', async () => {
        await open('chat-f');
        await manager.core.send('chat-f', 'fail');
        await recorder.untilIdle();
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: 'The model is overloaded' });
        expect(recorder.ofKind('turn')[0]?.state).toBe('error');
        await manager.core.send('chat-f', 'again');
        await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: again (medium)']);
    });

    test('an app-server that dies mid-turn leaves an error note and the chat can go on', async () => {
        await open('chat-6');
        await manager.core.send('chat-6', 'crash');
        await recorder.until(() => recorder.crashed);
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: 'Codex exited with code 1' });
        expect(recorder.ofKind('turn')[0]?.state).toBe('error');

        await manager.core.send('chat-6', 'again');
        await recorder.untilIdle();
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: again (medium)']);
    });

    test('a binary that will not start ends the turn with the spawn error', async () => {
        const broken = makeManager({
            spawn: () => {
                throw new Error('Executable not found in $PATH: "codex"');
            }
        });
        const other = new ChatRecorder();
        broken.core.subscribe('c1', other.sink());
        await broken.core.create({ chatId: 'chat-m', provider: 'codex', cwd: home });
        broken.core.attach('chat-m', 'c1');
        void broken.core.send('chat-m', 'hi');
        await other.until(() => other.info?.status === 'error' && other.info.activeTurnId === null);
        expect(other.ofKind('note')[0]).toMatchObject({ level: 'error', text: expect.stringContaining('Executable not found') });
        await retire(broken);
    });

    describe('the name of a Codex chat', () => {
        const withNamer = (answer: (input: { prompt: string; answer: string }) => string | null) => {
            const asked: Array<{ prompt: string; answer: string }> = [];
            manager = makeManager({
                nameChat: async (provider, input) => {
                    expect(provider).toBe('codex');
                    asked.push({ prompt: input.prompt, answer: input.answer });
                    return answer(input);
                }
            });
            manager.core.subscribe('c1', recorder.sink());
            return asked;
        };

        test('is asked once, after the first turn, and given to the thread as well', async () => {
            await retire(manager);
            const asked = withNamer(() => 'Greeting the fake');
            await open('chat-name');

            await manager.core.send('chat-name', 'hello there');
            await recorder.until(() => recorder.info?.suggestedTitle === 'Greeting the fake');
            expect(asked).toEqual([{ prompt: 'hello there', answer: 'echo: hello there (medium)' }]);

            // The app-server was told the same name, which is what its thread list and a resume carry.
            await recorder.untilIdle();
            await manager.core.send('chat-name', 'name?');
            await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
            expect(recorder.ofKind('assistant').map((item) => item.text)).toContain('Greeting the fake');
            expect(asked).toHaveLength(1);
        });

        test('a namer that gives nothing leaves the chat unnamed and is not asked again', async () => {
            await retire(manager);
            const asked = withNamer(() => null);
            await open('chat-unnamed');
            await manager.core.send('chat-unnamed', 'first');
            await recorder.untilIdle();
            // The namer is asked in the same step that settles the turn, so it has been by now.
            expect(asked).toHaveLength(1);
            await manager.core.send('chat-unnamed', 'second');
            await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
            expect(asked).toHaveLength(1);
            expect(recorder.info?.suggestedTitle).toBeUndefined();
        });

        test('a resumed thread that Codex already named keeps that name and asks for none', async () => {
            await retire(manager);
            const asked = withNamer(() => 'Not this one');
            await open('chat-named', { resume: 'named-1' });
            await manager.core.send('chat-named', 'hello again');
            await recorder.untilIdle();
            expect(recorder.info?.suggestedTitle).toBe('Named before');
            expect(asked).toEqual([]);
        });
    });

    describe('the conversation of a spawned agent', () => {
        const spawned = async (chatId: string): Promise<ChatSubagentItem> => {
            await open(chatId);
            await manager.core.send(chatId, 'spawn: survey the docs');
            await recorder.until(() => recorder.idle && recorder.ofKind('subagent')[0]?.native?.threadId !== undefined);
            return recorder.ofKind('subagent')[0]!;
        };

        const readAll = async (target: ChatManager, chatId: string, toolUseId: string): Promise<ChatItem[]> => {
            const pages: ChatItem[][] = [];
            let cursor: string | undefined;
            do {
                const page = await target.core.subagent('c1', { chatId, toolUseId, limit: 100, ...(cursor ? { cursor } : {}) });
                expect(page.source).toBe('codex-thread');
                pages.unshift(page.items);
                cursor = page.history.cursor ?? undefined;
            } while (cursor !== undefined);
            return pages.flat();
        };

        test('keeps the thread the spawn opened on the row, and reads every step of it through the running app-server', async () => {
            const row = await spawned('chat-spawn');
            expect(row.native?.threadId?.startsWith('child-')).toBe(true);
            expect(codex.started).toHaveLength(1);

            const items = await readAll(manager, 'chat-spawn', row.toolUseId);
            expect(items[0]).toMatchObject({ kind: 'user', text: 'survey the docs', turnId: null });
            const steps = items.filter((item) => item.kind === 'tool');
            expect(steps).toHaveLength(FAKE_CHILD_STEPS);
            expect(steps[0]).toMatchObject({ name: 'Bash', input: { command: 'echo 1' }, state: 'done' });
            expect(steps.at(-1)).toMatchObject({ output: `${FAKE_CHILD_STEPS}\n` });
            // No second process, since the chat's own app-server answered every page.
            expect(codex.started).toHaveLength(1);
        });

        test('reads the same conversation with the CLI gone, from a process started for the question, after a restart', async () => {
            const row = await spawned('chat-dead');
            await remake();
            await manager.core.create({ chatId: 'chat-dead', provider: 'codex', cwd: home });
            expect(manager.core.get('chat-dead')?.running).toBe(false);

            const first = await manager.core.subagent('c1', { chatId: 'chat-dead', toolUseId: row.toolUseId, limit: 100 });
            expect(first.live).toBe(false);
            expect(codex.started).toHaveLength(2);
            const items = await readAll(manager, 'chat-dead', row.toolUseId);
            expect(items.filter((item) => item.kind === 'tool')).toHaveLength(FAKE_CHILD_STEPS);
        });

        test('a snapshot of the spawn that arrives after the agent finished does not run it again', async () => {
            await open('chat-snapshot');
            await manager.core.send('chat-snapshot', 'spawn and finish: survey the docs');
            await recorder.until(() => recorder.idle && recorder.ofKind('subagent')[0]?.status === 'done');
            const finished = structuredClone(recorder.ofKind('subagent')[0]!);
            expect(typeof finished.finishedAt).toBe('number');

            const seen = recorder.events.length;
            codex.started[0]!.runLater();
            // The row is written again once the snapshot is heard, even with nothing in it changed.
            await recorder.until(() => recorder.events.slice(seen).some((event) => event.type === 'item' && event.item.kind === 'subagent'));

            expect(recorder.ofKind('subagent')).toEqual([finished]);
            // Nor does it open a turn of the agent's own that nothing would ever end.
            expect(recorder.ofKind('turn')).toHaveLength(1);
            expect(recorder.idle).toBe(true);
        });

        // The shape Codex 0.156.1 streams: activity items instead of a spawnAgent call, and the agent's own thread beside the chat's.
        test('an agent spawned through activity items stays running past the turn until its completed activity', async () => {
            await open('chat-activity');
            await manager.core.send('chat-activity', 'spawn agent: survey the docs');
            await recorder.until(() => recorder.idle && recorder.ofKind('subagent').length === 1);
            const row = recorder.ofKind('subagent')[0]!;
            expect(row).toMatchObject({ description: 'survey', background: true, status: 'running' });
            expect(row.native?.threadId?.startsWith('child-')).toBe(true);
            // The agent's own turn ending did not end the chat's, and none of its items is the chat's.
            expect(recorder.ofKind('turn')).toHaveLength(1);
            expect(recorder.ofKind('turn')[0]).toMatchObject({ state: 'done' });
            expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['spawned']);
            expect(recorder.ofKind('tool')).toEqual([]);

            codex.started[0]!.runLater();
            await recorder.until(() => recorder.ofKind('subagent')[0]?.status === 'done');
            expect(recorder.ofKind('subagent')[0]?.finishedAt).toEqual(expect.any(Number));
            expect(recorder.ofKind('turn')).toHaveLength(1);
            expect(recorder.idle).toBe(true);
        });

        test('a row without a thread is refused by name', async () => {
            await open('chat-none');
            await expect(manager.core.subagent('c1', { chatId: 'chat-none', toolUseId: 'nope' })).rejects.toMatchObject({ code: 'subagent-not-found' });
        });
    });
});

describe('Codex generated image attachments', () => {
    test.each(['success', 'replay'])('generated image %s is readable, reloads without bytes in the log and survives a fork', async (scenario) => {
        await open('image-chat');
        await manager.core.send('image-chat', `image:${scenario}`);
        await recorder.untilIdle();
        const tool = recorder.ofKind('tool').find((item) => item.name === 'ImageGeneration')!;
        expect(tool.state).toBe('done');
        const attachment = generatedImageAttachment(tool)!;
        expect(attachment).toMatchObject({ name: 'a-rabbit.png', mime: 'image/png', width: 1, height: 1, size: Buffer.from(png.data, 'base64').length });
        expect(manager.core.attachment('image-chat', attachment.id)).toEqual(attachment);
        expect(await readFile(attachment.path)).toEqual(Buffer.from(png.data, 'base64'));
        expect(await readdir(attachments.folderOf('image-chat'))).toHaveLength(1);
        expect(manager.core.attachment('another-chat', attachment.id)).toBeNull();
        expect(JSON.stringify(recorder.events)).not.toContain(png.data);
        const info = manager.core.get('image-chat')!.info;
        await manager.core.writeRecord('image-fork', { ...info, chatId: 'image-fork', running: false }, manager.core.get('image-chat')!.thread.list(), []);
        const fork = await store.read('image-fork');
        const copied = fork!.items.map(generatedImageAttachment).find(Boolean)!;
        expect(copied.id).toBe(attachment.id);
        expect(copied.path).not.toBe(attachment.path);
        await retire(manager);
        const files = await readdir(store.dir);
        for (const name of files.filter((name) => name.endsWith('.json') || name.endsWith('.jsonl'))) {
            expect(await readFile(join(store.dir, name), 'utf8')).not.toContain(png.data);
        }
        manager = makeManager();
        await manager.core.create({ chatId: 'image-chat' });
        expect(manager.core.attachment('image-chat', attachment.id)).toEqual(attachment);
        await attachments.removeAll('image-chat');
        expect(await readFile(copied.path)).toEqual(Buffer.from(png.data, 'base64'));
    });

    test.each(['failed', 'empty', 'invalid', 'not-image', 'too-large'])('generated image %s shows an error and saves no attachment', async (scenario) => {
        await open('image-chat');
        await manager.core.send('image-chat', `image:${scenario}`);
        await recorder.untilIdle();
        const tool = recorder.ofKind('tool').find((item) => item.name === 'ImageGeneration')!;
        expect(tool.state).toBe('error');
        expect(generatedImageAttachment(tool)).toBeNull();
        expect(await Bun.file(attachments.folderOf('image-chat')).exists()).toBe(false);
        expect(JSON.stringify(recorder.events)).not.toContain(png.data);
    });
});

test.each(['clear', 'kill'])('%s waits for an in-flight generated image before deleting its files', async (action) => {
    let started!: () => void;
    let release!: () => void;
    const saving = new Promise<void>((resolve) => {
        started = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
        release = resolve;
    });
    class HeldImages extends AttachmentStore {
        override async saveGenerated(chatId: string, ref: string, upload: Parameters<AttachmentStore['saveGenerated']>[2]) {
            started();
            await resumed;
            return super.saveGenerated(chatId, ref, upload);
        }
    }
    attachments = new HeldImages(home);
    manager = makeManager();
    manager.core.subscribe('c1', recorder.sink());
    await open('held-image');
    await manager.core.send('held-image', 'image:success');
    await saving;
    const deleted = action === 'clear' ? manager.core.clear('held-image', true) : manager.core.kill('held-image');
    release();
    await deleted;
    expect(await Bun.file(attachments.folderOf('held-image')).exists()).toBe(false);
    if (action === 'clear') {
        expect(manager.core.get('held-image')!.thread.list()).toEqual([]);
    }
});

test('image storage failure remains a tool error and the turn still completes', async () => {
    class BrokenImages extends AttachmentStore {
        override async saveGenerated(): Promise<never> {
            throw new Error('The image store is not writable');
        }
    }
    attachments = new BrokenImages(home);
    manager = makeManager();
    manager.core.subscribe('c1', recorder.sink());
    await open('broken-image');
    await manager.core.send('broken-image', 'image:success');
    await recorder.untilIdle();
    expect(recorder.ofKind('tool').find((item) => item.name === 'ImageGeneration')).toMatchObject({
        state: 'error',
        output: 'The image store is not writable'
    });
});
