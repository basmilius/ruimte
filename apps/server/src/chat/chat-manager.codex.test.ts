import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatInfo, ChatItem, ChatSubagentItem } from '@ruimte/contracts';
import type { ContextSource } from '@ruimte/contracts';
import { chatPrompt, contextPrompt, verbsNote } from '../context/context-note.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { AttachmentStore } from './attachment-store.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatStore } from './chat-store.ts';
import { ChatRecorder } from './chat-test-helpers.ts';
import { inProcess, type InProcessCli } from './fake-cli.ts';
import { FAKE_CHILD_STEPS, fakeCodex } from './fake-codex.ts';

let home: string;
let store: ChatStore;
let attachments: AttachmentStore;
let manager: ChatManager;
let recorder: ChatRecorder;
let codex: InProcessCli;
let requests: Array<{ method: string; params: Record<string, unknown> }>;
let modelPage: ((params: Record<string, unknown>) => unknown) | null;

const png = { name: 'shot.png', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
const turnInputs = () => requests.filter((request) => request.method === 'turn/start').map((request) => request.params.input as Array<Record<string, unknown>>);

// The device of the session this line was written for; the Claude test asserts against the same call.
const LINKED: ContextSource[] = [{ id: 'dev-1', kind: 'device', title: 'iPhone 18 Pro Max' }];

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

const makeManager = (extra: Partial<ConstructorParameters<typeof ChatManager>[0]> = {}) =>
    new ChatManager({ providers, store, attachments, spawn: codex.spawn, env: { PATH: process.env.PATH, HOME: home }, ...extra });

// A chat's CLI outlives a shutdown; only a dispose ends it.
const retire = async (target: ChatManager): Promise<void> => {
    await target.shutdown();
    for (const info of target.list()) {
        target.get(info.chatId)?.dispose();
    }
};

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-codex-'));
    attachments = new AttachmentStore(home);
    store = new ChatStore(home, attachments);
    requests = [];
    modelPage = null;
    codex = inProcess((io) => {
        const program = fakeCodex(io);
        return {
            onLine: (line) => {
                const frame = JSON.parse(line);
                if (frame.method) {
                    requests.push(frame);
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
    manager.subscribe('c1', recorder.sink());
});

afterEach(async () => {
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

const idle = () => recorder.info?.status === 'idle' && recorder.info.running && recorder.info.activeTurnId === null;

const needsYou = () => recorder.info?.status === 'needs-you';

const open = async (chatId: string, extra: Record<string, unknown> = {}): Promise<ChatInfo> => {
    const info = await manager.create({ chatId, provider: 'codex', cwd: home, ...extra });
    manager.attach(chatId, 'c1');
    return info;
};

describe('ChatManager with Codex', () => {
    test.each(['Inspect these', ''])('sends actual image inputs with prompt %j and keeps originals in the thread', async (text) => {
        await open('chat-images');
        await manager.send('chat-images', text, {}, [png, { ...png, name: 'finder.PNG', mime: 'application/octet-stream' }]);
        await recorder.until(idle);
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
        await manager.send('chat-mixed', 'Look', {}, [
            png,
            { name: 'drawing.svg', mime: 'image/svg+xml', data: btoa('<svg/>') },
            { name: 'notes.txt', mime: 'text/plain', data: btoa('notes') }
        ]);
        await recorder.until(idle);
        const saved = recorder.ofKind('user')[0]!.attachments!;
        expect(turnInputs()[0]!.filter((input) => input.type === 'localImage')).toEqual([{ type: 'localImage', path: saved[0]!.path }]);
        for (const attachment of saved) {
            expect(turnInputs()[0]![0]!.text).toContain(attachment.path);
        }
    });

    test('queued images are sent after the active turn and survive reopening the chat', async () => {
        await open('chat-queued-image');
        await manager.send('chat-queued-image', 'slow');
        await recorder.until(() => recorder.ofKind('assistant').length === 1);
        expect(await manager.send('chat-queued-image', '', {}, [png])).toMatchObject({ queued: true });
        const queued = recorder.info!.queue![0]!.attachments![0]!;
        manager.cancel('chat-queued-image');
        await recorder.until(() => turnInputs().length === 2 && recorder.ofKind('turn').at(-1)?.state === 'done' && idle());
        expect(turnInputs()[1]!.at(-1)).toEqual({ type: 'localImage', path: queued.path });
        const threadId = recorder.info!.agentSessionId;
        await retire(manager);
        manager = makeManager();
        recorder = new ChatRecorder();
        manager.subscribe('c1', recorder.sink());
        await manager.create({ chatId: 'chat-queued-image' });
        const snapshot = manager.attach('chat-queued-image', 'c1');
        expect(snapshot.items.find((item) => item.kind === 'user' && item.attachments?.length)).toMatchObject({ attachments: [queued] });
        expect(await Bun.file(queued.path).exists()).toBe(true);
        await manager.send('chat-queued-image', 'Another', {}, [png]);
        await recorder.until(idle);
        expect(recorder.info!.agentSessionId).toBe(threadId);
        expect(turnInputs()[2]!.at(-1)?.type).toBe('localImage');
    });

    test('a queued image removed from disk fails visibly without sending an incomplete prompt', async () => {
        await open('chat-missing-image');
        await manager.send('chat-missing-image', 'slow');
        await recorder.until(() => recorder.ofKind('assistant').length === 1);
        await manager.send('chat-missing-image', 'Look', {}, [png]);
        await rm(recorder.info!.queue![0]!.attachments![0]!.path);
        manager.cancel('chat-missing-image');
        await recorder.until(() => recorder.ofKind('note').some((note) => note.text.includes('Could not read attached image')));
        expect(turnInputs()).toHaveLength(1);
        expect(recorder.ofKind('turn').at(-1)?.state).toBe('error');
    });

    test('refuses images for a text-only model and can send text afterwards', async () => {
        await open('chat-text-only', { selection: { model: 'spark' } });
        await manager.send('chat-text-only', 'Look', {}, [png]);
        await recorder.until(() => recorder.ofKind('note').some((note) => note.text.includes('does not support image input')));
        expect(turnInputs()).toHaveLength(0);
        await manager.send('chat-text-only', 'hello');
        await recorder.until(idle);
        expect(turnInputs()).toHaveLength(1);
    });

    test('finds image support on a later model page and tolerates older metadata without modalities', async () => {
        modelPage = (params) =>
            params.cursor === 'next'
                ? { data: [{ model: 'gpt-6-astra', inputModalities: ['text'] }], nextCursor: null }
                : { data: [{ model: 'other', inputModalities: ['text', 'image'] }], nextCursor: 'next' };
        await open('chat-paged');
        await manager.send('chat-paged', 'Look', {}, [png]);
        await recorder.until(() => recorder.ofKind('note').some((note) => note.text.includes('does not support image input')));
        expect(turnInputs()).toHaveLength(0);
        modelPage = () => ({ data: [{ model: 'gpt-5.6-sol' }], nextCursor: null });
        manager.configure({ chatId: 'chat-paged', selection: { model: 'sol', options: {} } });
        await manager.send('chat-paged', 'Look', {}, [png]);
        await recorder.until(idle);
        expect(turnInputs()[0]!.at(-1)?.type).toBe('localImage');
    });

    test('rejects invalid uploads before starting a turn or writing any files', async () => {
        await open('chat-invalid');
        await expect(manager.send('chat-invalid', 'Look', {}, [{ ...png, data: 'not base64' }])).rejects.toMatchObject({ code: 'invalid-attachments' });
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
        await manager.send('chat-1', 'hello there');
        expect(manager.get('chat-1')?.running).toBe(true);
        // A send while a turn runs queues instead of failing, so the test unqueues it to reach idle.
        expect(await manager.send('chat-1', 'again')).toMatchObject({ queued: true });
        manager.unqueue('chat-1', manager.get('chat-1')!.info.queue![0]!.id);
        await recorder.until(idle);

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
        expect(manager.attach('chat-1', 'c2').items.map((item) => item.kind)).toEqual(['turn', 'user', 'assistant']);
    });

    test('the window the CLI of the pick before reports does not land on a meter that already reads the new one', async () => {
        await open('chat-window');
        await manager.send('chat-window', 'tool: date');
        await recorder.until(needsYou);
        expect(recorder.info?.usage.contextWindow).toBe(258400);

        expect(manager.configure({ chatId: 'chat-window', selection: { model: 'gpt-5.3-codex-spark', options: {} } })).toMatchObject({
            usage: { contextWindow: 121600 }
        });
        // The turn in flight is the wider model's, and the usage it reports is that thread's.
        manager.approve('chat-window', recorder.ofKind('approval')[0]!.requestId, 'allow');
        await recorder.until(idle);
        expect(recorder.info?.usage.contextWindow).toBe(121600);

        // The restart runs on the new pick, so what it reports is the chat's own again.
        const turns = recorder.info!.usage.turns;
        await manager.send('chat-window', 'after');
        await recorder.until(() => recorder.info?.usage.turns === turns + 1 && idle());
        expect(recorder.info?.model).toContain('gpt-5.3-codex-spark');
        expect(recorder.info?.usage.contextWindow).toBe(121600);
    });

    test('a command approval becomes an approval card; allowing always sends the policy amendment', async () => {
        await open('chat-2');
        await manager.send('chat-2', 'tool: date');
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

        expect(() => manager.approve('chat-2', 'nope', 'allow')).toThrow('Nothing waits');
        manager.approve('chat-2', approval!.requestId, 'allow-always');
        await recorder.until(idle);
        expect(recorder.ofKind('approval')[0]?.decision).toBe('allow-always');
        expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'done', output: 'ran: date\n' });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['done, remembered']);
    });

    test('denying declines the command and the tool ends in error', async () => {
        await open('chat-3');
        await manager.send('chat-3', 'tool: rm -rf /');
        await recorder.until(needsYou);
        manager.approve('chat-3', recorder.ofKind('approval')[0]!.requestId, 'deny', 'not that');
        await recorder.until(idle);
        expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'error' });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['denied']);
    });

    test('a file change asks too and shows the diff on the tool item', async () => {
        await open('chat-e');
        await manager.send('chat-e', 'edit: hello.txt');
        await recorder.until(needsYou);
        expect(recorder.ofKind('approval')[0]).toMatchObject({ toolName: 'ApplyPatch', description: 'Write outside the sandbox', canAllowAlways: false });
        manager.approve('chat-e', recorder.ofKind('approval')[0]!.requestId, 'allow');
        await recorder.until(idle);
        expect(recorder.ofKind('tool')[0]).toMatchObject({ name: 'ApplyPatch', state: 'done', output: '+++ hello.txt\n+hello\n' });
    });

    test('a blocking question is answered by question id', async () => {
        await open('chat-q');
        await manager.send('chat-q', 'ask: Which color?');
        await recorder.until(needsYou);
        const question = recorder.ofKind('question')[0];
        expect(question).toMatchObject({ state: 'pending', questions: [{ id: 'color', header: 'Choice', question: 'Which color?', multiSelect: false }] });
        expect(question?.questions[0]?.choices.map((choice) => choice.label)).toEqual(['Red', 'Blue']);

        expect(() => manager.answer('chat-q', 'nope', {})).toThrow('No question');
        manager.answer('chat-q', question!.requestId, { color: 'Blue' });
        await recorder.until(idle);
        expect(recorder.ofKind('question')[0]).toMatchObject({ state: 'answered', answers: { color: 'Blue' } });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['you chose Blue']);
    });

    test('an async question is answered by steering the running turn', async () => {
        await open('chat-a');
        await manager.send('chat-a', 'async: Which color?');
        await recorder.until(needsYou);
        const question = recorder.ofKind('question')[0];
        expect(question?.questions[0]).toMatchObject({ id: '0', question: 'Which color?' });
        manager.answer('chat-a', question!.requestId, { '0': 'Red' });
        await recorder.until(idle);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['you chose Red']);
    });

    test('a blocking question cannot be dismissed', async () => {
        await open('chat-b');
        await manager.send('chat-b', 'ask: Which color?');
        await recorder.until(needsYou);
        const blocking = recorder.ofKind('question')[0]!;
        expect(blocking.async).toBeUndefined();
        expect(() => manager.dismiss('chat-b', blocking.id)).toThrow('No question to dismiss');
    });

    test('an async question is dismissed without telling Codex and settles as dismissed', async () => {
        await open('chat-d');
        await manager.send('chat-d', 'async: Which color?');
        await recorder.until(needsYou);
        const asked = recorder.ofKind('question')[0]!;
        expect(asked.async).toBe(true);
        manager.dismiss('chat-d', asked.id);
        expect(recorder.items.get(asked.id)).toMatchObject({ state: 'dismissed' });
        // The turn goes on, since Codex asked beside it and never waits for the answer.
        expect(recorder.info?.status).toBe('running');
        expect(() => manager.dismiss('chat-d', asked.id)).toThrow('No question to dismiss');
    });

    test('cancel interrupts a running turn and marks it aborted', async () => {
        await open('chat-4');
        await manager.send('chat-4', 'slow');
        await recorder.until(() => recorder.ofKind('assistant').length === 1);
        manager.cancel('chat-4');
        await recorder.until(idle);
        expect(recorder.ofKind('turn')[0]?.state).toBe('aborted');
        expect(recorder.ofKind('assistant')[0]?.streaming).toBe(false);
    });

    test('configure restarts the app-server with the new settings on the next send and resumes the thread', async () => {
        await open('chat-c');
        await manager.send('chat-c', 'first');
        await recorder.until(idle);
        const threadId = recorder.info?.agentSessionId;

        const info = manager.configure({
            chatId: 'chat-c',
            selection: { model: 'sol', options: { effort: 'xhigh' } },
            runtimeMode: 'supervised'
        });
        expect(info).toMatchObject({ selection: { model: 'gpt-5.6-sol', options: { effort: 'xhigh' } }, runtimeMode: 'supervised' });
        expect(manager.configure({ chatId: 'chat-c', runtimeMode: 'supervised' })).toBe(info);

        await manager.send('chat-c', 'again');
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
        expect(recorder.info?.agentSessionId).toBe(threadId ?? null);
        expect(recorder.info?.model).toBe('gpt-5.6-sol untrusted read-only');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first (medium)', 'echo: again (xhigh)']);
        expect(codex.started).toHaveLength(2);
        expect(await codex.started[0]!.exited).toBe(0);
    });

    test('a thread survives a new manager and the next send resumes the same Codex thread', async () => {
        await open('chat-5');
        await manager.send('chat-5', 'first');
        await recorder.until(idle);
        const threadId = recorder.info?.agentSessionId;
        // Shutdown persists every thread, so the manager built next reads it back.
        await manager.shutdown();

        const again = makeManager();
        const other = new ChatRecorder();
        again.subscribe('c9', other.sink());
        // Created without a provider, since the record on disk already says codex.
        const info = await again.create({ chatId: 'chat-5' });
        expect(info).toMatchObject({ provider: 'codex', agentSessionId: threadId, running: false, status: 'idle', usage: { turns: 1 } });
        again.attach('chat-5', 'c9');
        void again.send('chat-5', 'second');
        await other.until(() => other.info?.status === 'idle' && other.info.running);
        expect(other.info?.agentSessionId).toBe(threadId ?? null);
        expect(other.info?.usage.turns).toBe(2);
        await retire(again);
    });

    test('after a clear the next send starts a new Codex thread instead of resuming', async () => {
        await open('chat-clear');
        await manager.send('chat-clear', 'first');
        await recorder.until(idle);
        const threadId = recorder.info?.agentSessionId;
        expect(threadId?.startsWith('fake-')).toBe(true);

        await manager.clear('chat-clear');
        expect(recorder.info).toMatchObject({ agentSessionId: null, running: false, activeTurnId: null });
        expect(manager.attach('chat-clear', 'c1').items).toEqual([]);

        await manager.send('chat-clear', 'second');
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
        // `thread/resume` hands the fake its old id back; `thread/start` makes a new one.
        expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
        expect(recorder.info?.agentSessionId).not.toBe(threadId);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: second (medium)']);
    });

    test('a thread starts with the note about the verbs as developer instructions, and no prompt carries it', async () => {
        await retire(manager);
        manager = makeManager({ depthOf: () => 1 });
        manager.subscribe('c1', recorder.sink());
        await open('chat-note');
        await manager.send('chat-note', 'note?');
        await recorder.until(idle);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual([verbsNote({ depth: 1 })]);
        await manager.send('chat-note', 'hi');
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
        expect(turnInputs().map((input) => input[0]!.text)).toEqual(['note?', 'hi']);
    });

    test('a thread with links names them in its developer instructions, the way Claude hears them', async () => {
        await retire(manager);
        manager = makeManager({ contextSources: () => LINKED, depthOf: () => 2 });
        manager.subscribe('c1', recorder.sink());
        await open('chat-linked-note');
        await manager.send('chat-linked-note', 'note?');
        await recorder.until(idle);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual([chatPrompt({ sources: LINKED, depth: 2 })]);
        expect(recorder.ofKind('assistant')[0]?.text).toContain('"iPhone 18 Pro Max" (device)');
        // A start already carries the names, so nothing is pasted in front of the prompt as well.
        expect(turnInputs().map((input) => input[0]!.text)).toEqual(['note?']);
    });

    test('a resumed thread keeps its instructions and hears about its links in front of the first prompt only', async () => {
        await open('chat-resumed-note');
        await manager.send('chat-resumed-note', 'first');
        await recorder.until(idle);
        await retire(manager);

        manager = makeManager({ contextSources: () => LINKED });
        const again = new ChatRecorder();
        manager.subscribe('c2', again.sink());
        await manager.create({ chatId: 'chat-resumed-note' });
        manager.attach('chat-resumed-note', 'c2');
        await manager.send('chat-resumed-note', 'note?');
        await again.until(() => again.ofKind('assistant').length === 1 && again.info?.activeTurnId === null);
        await manager.send('chat-resumed-note', 'pasted?');
        await again.until(() => again.ofKind('assistant').length === 2 && again.info?.activeTurnId === null);
        expect(again.ofKind('assistant').map((item) => item.text)).toEqual([chatPrompt({ sources: [], depth: 0 }), contextPrompt(LINKED)!]);
        expect(requests.filter((request) => request.method === 'thread/resume').map((request) => request.params.developerInstructions)).toEqual([undefined]);
        expect(turnInputs().at(-1)![0]!.text).toBe('pasted?');
    });

    test('a thread Codex no longer has starts fresh with a warning', async () => {
        await open('chat-g', { resume: 'gone' });
        await manager.send('chat-g', 'hi');
        await recorder.until(idle);
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'warning', text: expect.stringContaining('could not resume') });
        expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: hi (medium)']);
    });

    test('compaction shows up as a marker in a turn of its own', async () => {
        await open('chat-k');
        await manager.send('chat-k', 'x');
        await recorder.until(idle);
        manager.compact('chat-k');
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
        expect(recorder.ofKind('compaction')).toHaveLength(1);
        expect(recorder.ofKind('turn').map((turn) => turn.state)).toEqual(['done', 'done']);
    });

    test('a failed turn leaves an error note and the chat can go on', async () => {
        await open('chat-f');
        await manager.send('chat-f', 'fail');
        await recorder.until(idle);
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: 'The model is overloaded' });
        expect(recorder.ofKind('turn')[0]?.state).toBe('error');
        await manager.send('chat-f', 'again');
        await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: again (medium)']);
    });

    test('an app-server that dies mid-turn leaves an error note and the chat can go on', async () => {
        await open('chat-6');
        await manager.send('chat-6', 'crash');
        await recorder.until(() => recorder.info?.running === false && recorder.info.status === 'error');
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: 'Codex exited with code 1' });
        expect(recorder.ofKind('turn')[0]?.state).toBe('error');

        await manager.send('chat-6', 'again');
        await recorder.until(idle);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: again (medium)']);
    });

    test('a binary that will not start ends the turn with the spawn error', async () => {
        const broken = makeManager({
            spawn: () => {
                throw new Error('Executable not found in $PATH: "codex"');
            }
        });
        const other = new ChatRecorder();
        broken.subscribe('c1', other.sink());
        await broken.create({ chatId: 'chat-m', provider: 'codex', cwd: home });
        broken.attach('chat-m', 'c1');
        void broken.send('chat-m', 'hi');
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
            manager.subscribe('c1', recorder.sink());
            return asked;
        };

        test('is asked once, after the first turn, and given to the thread as well', async () => {
            await retire(manager);
            const asked = withNamer(() => 'Greeting the fake');
            await open('chat-name');

            await manager.send('chat-name', 'hello there');
            await recorder.until(() => recorder.info?.suggestedTitle === 'Greeting the fake');
            expect(asked).toEqual([{ prompt: 'hello there', answer: 'echo: hello there (medium)' }]);

            // The app-server was told the same name, which is what its thread list and a resume carry.
            await recorder.until(idle);
            await manager.send('chat-name', 'name?');
            await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
            expect(recorder.ofKind('assistant').map((item) => item.text)).toContain('Greeting the fake');
            expect(asked).toHaveLength(1);
        });

        test('a namer that gives nothing leaves the chat unnamed and is not asked again', async () => {
            await retire(manager);
            const asked = withNamer(() => null);
            await open('chat-unnamed');
            await manager.send('chat-unnamed', 'first');
            await recorder.until(idle);
            // The namer is asked in the same step that settles the turn, so it has been by now.
            expect(asked).toHaveLength(1);
            await manager.send('chat-unnamed', 'second');
            await recorder.until(() => recorder.info?.usage.turns === 2 && idle());
            expect(asked).toHaveLength(1);
            expect(recorder.info?.suggestedTitle).toBeUndefined();
        });

        test('a resumed thread that Codex already named keeps that name and asks for none', async () => {
            await retire(manager);
            const asked = withNamer(() => 'Not this one');
            await open('chat-named', { resume: 'named-1' });
            await manager.send('chat-named', 'hello again');
            await recorder.until(idle);
            expect(recorder.info?.suggestedTitle).toBe('Named before');
            expect(asked).toEqual([]);
        });
    });

    describe('the conversation of a spawned agent', () => {
        const spawned = async (chatId: string): Promise<ChatSubagentItem> => {
            await open(chatId);
            await manager.send(chatId, 'spawn: survey the docs');
            await recorder.until(() => idle() && recorder.ofKind('subagent')[0]?.native?.threadId !== undefined);
            return recorder.ofKind('subagent')[0]!;
        };

        const readAll = async (target: ChatManager, chatId: string, toolUseId: string): Promise<ChatItem[]> => {
            const pages: ChatItem[][] = [];
            let cursor: string | undefined;
            do {
                const page = await target.subagent('c1', { chatId, toolUseId, limit: 100, ...(cursor ? { cursor } : {}) });
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
            await retire(manager);
            manager = makeManager();
            await manager.create({ chatId: 'chat-dead', provider: 'codex', cwd: home });
            expect(manager.get('chat-dead')?.running).toBe(false);

            const first = await manager.subagent('c1', { chatId: 'chat-dead', toolUseId: row.toolUseId, limit: 100 });
            expect(first.live).toBe(false);
            expect(codex.started).toHaveLength(2);
            const items = await readAll(manager, 'chat-dead', row.toolUseId);
            expect(items.filter((item) => item.kind === 'tool')).toHaveLength(FAKE_CHILD_STEPS);
        });

        test('a row without a thread is refused by name', async () => {
            await open('chat-none');
            await expect(manager.subagent('c1', { chatId: 'chat-none', toolUseId: 'nope' })).rejects.toMatchObject({ code: 'subagent-not-found' });
        });
    });
});
