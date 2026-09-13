import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEvent, ChatInfo, ChatItem } from '@ruimte/contracts';
import { ProviderRegistry } from '../providers/registry.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { waitFor, waitForAsync } from '../sessions/test-helpers.ts';
import { VERBS_NOTE } from '../context/context-note.ts';
import { AttachmentStore } from './attachment-store.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatStore } from './chat-store.ts';

const FAKE_CODEX = ['bun', join(import.meta.dir, 'fake-codex.ts')];

class ChatRecorder {
    readonly events: ChatEvent[] = [];
    readonly items = new Map<string, ChatItem>();
    info: ChatInfo | null = null;

    sink() {
        return (event: SessionEvent): void => {
            if (event.event !== 'chat.event') {
                return;
            }
            const chatEvent = event.payload.event;
            this.events.push(chatEvent);
            if (chatEvent.type === 'item') {
                this.items.set(chatEvent.item.id, chatEvent.item);
            } else if (chatEvent.type === 'delta') {
                const item = this.items.get(chatEvent.itemId);
                if (item?.kind === 'assistant') {
                    this.items.set(item.id, { ...item, text: item.text + chatEvent.text });
                }
            } else {
                this.info = chatEvent.info;
            }
        };
    }

    ofKind<K extends ChatItem['kind']>(kind: K): Array<Extract<ChatItem, { kind: K }>> {
        return [...this.items.values()].filter((item): item is Extract<ChatItem, { kind: K }> => item.kind === kind);
    }

    get deltas(): string {
        return this.events
            .filter((event) => event.type === 'delta')
            .map((event) => (event.type === 'delta' ? event.text : ''))
            .join('');
    }
}

let home: string;
let store: ChatStore;
let attachments: AttachmentStore;
let manager: ChatManager;
let recorder: ChatRecorder;

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

const makeManager = () =>
    new ChatManager({ providers, store, attachments, command: ['false'], codexCommand: FAKE_CODEX, env: { PATH: process.env.PATH, HOME: home } });

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-codex-'));
    attachments = new AttachmentStore(home);
    store = new ChatStore(home, attachments);
    manager = makeManager();
    recorder = new ChatRecorder();
    manager.subscribe('c1', recorder.sink());
});

afterEach(async () => {
    await manager.shutdown();
    for (const info of manager.list()) {
        manager.get(info.chatId)?.dispose();
    }
    await rm(home, { recursive: true, force: true });
});

const idle = () => recorder.info?.status === 'idle' && recorder.info.running && recorder.info.activeTurnId === null;

const open = async (chatId: string, extra: Record<string, unknown> = {}): Promise<ChatInfo> => {
    const info = await manager.create({ chatId, provider: 'codex', cwd: home, ...extra });
    manager.attach(chatId, 'c1');
    return info;
};

describe('ChatManager with Codex', () => {
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
        await manager.send('chat-1', 'hello there');
        expect(manager.get('chat-1')?.running).toBe(true);
        // A send while the turn runs queues instead of failing; this test wants the queue empty again.
        expect(await manager.send('chat-1', 'again')).toEqual({ queued: true });
        manager.unqueue('chat-1', manager.get('chat-1')!.info.queue![0]!.id);
        await waitFor(idle, 'the turn to end');

        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['hello there']);
        expect(recorder.deltas).toBe('echo: hello there (medium)');
        const assistant = recorder.ofKind('assistant');
        expect(assistant).toHaveLength(1);
        expect(assistant[0]).toMatchObject({ text: 'echo: hello there (medium)', streaming: false });
        const turn = recorder.ofKind('turn')[0];
        expect(turn).toMatchObject({ state: 'done' });
        expect(assistant[0]?.turnId).toBe(turn?.id ?? '');
        // The fake echoes its start parameters as the model: full access is "never ask" in a sandbox with full access.
        expect(recorder.info).toMatchObject({
            model: 'gpt-6-astra never danger-full-access',
            usage: { turns: 1, contextTokens: 25090, contextWindow: 258400 }
        });
        expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
        expect(manager.attach('chat-1', 'c2').items.map((item) => item.kind)).toEqual(['turn', 'user', 'assistant']);
    });

    test('a command approval becomes an approval card; allowing always sends the policy amendment', async () => {
        await open('chat-2');
        await manager.send('chat-2', 'tool: date');
        await waitFor(() => recorder.info?.status === 'needs-you', 'needs-you');

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
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('approval')[0]?.decision).toBe('allow-always');
        expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'done', output: 'ran: date\n' });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['done, remembered']);
    });

    test('denying declines the command and the tool ends in error', async () => {
        await open('chat-3');
        await manager.send('chat-3', 'tool: rm -rf /');
        await waitFor(() => recorder.info?.status === 'needs-you', 'needs-you');
        manager.approve('chat-3', recorder.ofKind('approval')[0]!.requestId, 'deny', 'not that');
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'error' });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['denied']);
    });

    test('a file change asks too and shows the diff on the tool item', async () => {
        await open('chat-e');
        await manager.send('chat-e', 'edit: hello.txt');
        await waitFor(() => recorder.info?.status === 'needs-you', 'needs-you');
        expect(recorder.ofKind('approval')[0]).toMatchObject({ toolName: 'ApplyPatch', description: 'Write outside the sandbox', canAllowAlways: false });
        manager.approve('chat-e', recorder.ofKind('approval')[0]!.requestId, 'allow');
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('tool')[0]).toMatchObject({ name: 'ApplyPatch', state: 'done', output: '+++ hello.txt\n+hello\n' });
    });

    test('a blocking question is answered by question id', async () => {
        await open('chat-q');
        await manager.send('chat-q', 'ask: Which color?');
        await waitFor(() => recorder.info?.status === 'needs-you', 'needs-you');
        const question = recorder.ofKind('question')[0];
        expect(question).toMatchObject({ state: 'pending', questions: [{ id: 'color', header: 'Choice', question: 'Which color?', multiSelect: false }] });
        expect(question?.questions[0]?.choices.map((choice) => choice.label)).toEqual(['Red', 'Blue']);

        expect(() => manager.answer('chat-q', 'nope', {})).toThrow('No question');
        manager.answer('chat-q', question!.requestId, { color: 'Blue' });
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('question')[0]).toMatchObject({ state: 'answered', answers: { color: 'Blue' } });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['you chose Blue']);
    });

    test('an async question is answered by steering the running turn', async () => {
        await open('chat-a');
        await manager.send('chat-a', 'async: Which color?');
        await waitFor(() => recorder.info?.status === 'needs-you', 'needs-you');
        const question = recorder.ofKind('question')[0];
        expect(question?.questions[0]).toMatchObject({ id: '0', question: 'Which color?' });
        manager.answer('chat-a', question!.requestId, { '0': 'Red' });
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['you chose Red']);
    });

    test('a blocking question cannot be dismissed', async () => {
        await open('chat-b');
        await manager.send('chat-b', 'ask: Which color?');
        await waitFor(() => recorder.info?.status === 'needs-you', 'the question');
        const blocking = recorder.ofKind('question')[0]!;
        expect(blocking.async).toBeUndefined();
        expect(() => manager.dismiss('chat-b', blocking.id)).toThrow('No question to dismiss');
    });

    test('an async question is dismissed without telling Codex and settles as dismissed', async () => {
        await open('chat-d');
        await manager.send('chat-d', 'async: Which color?');
        await waitFor(() => recorder.info?.status === 'needs-you', 'the question');
        const asked = recorder.ofKind('question')[0]!;
        expect(asked.async).toBe(true);
        manager.dismiss('chat-d', asked.id);
        expect(recorder.items.get(asked.id)).toMatchObject({ state: 'dismissed' });
        // The turn goes on: Codex asked beside it and never waits for the answer.
        expect(recorder.info?.status).toBe('running');
        expect(() => manager.dismiss('chat-d', asked.id)).toThrow('No question to dismiss');
    });

    test('cancel interrupts a running turn and marks it aborted', async () => {
        await open('chat-4');
        await manager.send('chat-4', 'slow');
        await waitFor(() => recorder.ofKind('assistant').length === 1, 'the turn to stream');
        manager.cancel('chat-4');
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('turn')[0]?.state).toBe('aborted');
        expect(recorder.ofKind('assistant')[0]?.streaming).toBe(false);
    });

    test('configure restarts the app-server with the new settings on the next send and resumes the thread', async () => {
        await open('chat-c');
        await manager.send('chat-c', 'first');
        await waitFor(idle, 'first turn');
        const threadId = recorder.info?.agentSessionId;

        const info = manager.configure({
            chatId: 'chat-c',
            selection: { model: 'sol', options: { effort: 'xhigh' } },
            runtimeMode: 'supervised'
        });
        expect(info).toMatchObject({ selection: { model: 'gpt-5.6-sol', options: { effort: 'xhigh' } }, runtimeMode: 'supervised' });
        expect(manager.configure({ chatId: 'chat-c', runtimeMode: 'supervised' })).toBe(info);

        await manager.send('chat-c', 'again');
        await waitFor(() => recorder.info?.usage.turns === 2 && idle(), 'second turn');
        expect(recorder.info?.agentSessionId).toBe(threadId ?? null);
        expect(recorder.info?.model).toBe('gpt-5.6-sol untrusted read-only');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first (medium)', 'echo: again (xhigh)']);
    });

    test('a thread survives a new manager and the next send resumes the same Codex thread', async () => {
        await open('chat-5');
        await manager.send('chat-5', 'first');
        await waitFor(idle, 'the turn to end');
        const threadId = recorder.info?.agentSessionId;
        await waitForAsync(async () => (await store.read('chat-5')) !== null, 'the record on disk');
        await manager.shutdown();

        const again = makeManager();
        const other = new ChatRecorder();
        again.subscribe('c9', other.sink());
        // Created without a provider: the record on disk says codex.
        const info = await again.create({ chatId: 'chat-5' });
        expect(info).toMatchObject({ provider: 'codex', agentSessionId: threadId, running: false, status: 'idle', usage: { turns: 1 } });
        again.attach('chat-5', 'c9');
        again.send('chat-5', 'second');
        await waitFor(() => other.info?.status === 'idle' && other.info.running, 'the second turn');
        expect(other.info?.agentSessionId).toBe(threadId ?? null);
        expect(other.info?.usage.turns).toBe(2);
        await again.shutdown();
        again.get('chat-5')?.dispose();
    });

    test('the first prompt of a process carries the note about the verbs', async () => {
        await open('chat-note');
        await manager.send('chat-note', 'note?');
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual([VERBS_NOTE]);
    });

    test('a thread Codex no longer has starts fresh with a warning', async () => {
        await open('chat-g', { resume: 'gone' });
        await manager.send('chat-g', 'hi');
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'warning', text: expect.stringContaining('could not resume') });
        expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: hi (medium)']);
    });

    test('compaction shows up as a marker in a turn of its own', async () => {
        await open('chat-k');
        await manager.send('chat-k', 'x');
        await waitFor(idle, 'the first turn');
        manager.compact('chat-k');
        await waitFor(() => recorder.info?.usage.turns === 2 && idle(), 'the compaction turn');
        expect(recorder.ofKind('compaction')).toHaveLength(1);
        expect(recorder.ofKind('turn').map((turn) => turn.state)).toEqual(['done', 'done']);
    });

    test('a failed turn leaves an error note and the chat can go on', async () => {
        await open('chat-f');
        await manager.send('chat-f', 'fail');
        await waitFor(idle, 'the failed turn');
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: 'The model is overloaded' });
        expect(recorder.ofKind('turn')[0]?.state).toBe('error');
        await manager.send('chat-f', 'again');
        await waitFor(() => recorder.info?.usage.turns === 2 && idle(), 'the next turn');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: again (medium)']);
    });

    test('an app-server that dies mid-turn leaves an error note and the chat can go on', async () => {
        await open('chat-6');
        await manager.send('chat-6', 'crash');
        await waitFor(() => recorder.info?.running === false && recorder.info.status === 'error', 'error status');
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: 'Codex exited with code 1' });
        expect(recorder.ofKind('turn')[0]?.state).toBe('error');

        await manager.send('chat-6', 'again');
        await waitFor(idle, 'the next turn');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: again (medium)']);
    });

    test('a missing binary ends the turn with the spawn error', async () => {
        const broken = new ChatManager({ providers, store, attachments, codexCommand: ['/nonexistent/codex'], env: { PATH: process.env.PATH, HOME: home } });
        const other = new ChatRecorder();
        broken.subscribe('c1', other.sink());
        await broken.create({ chatId: 'chat-m', provider: 'codex', cwd: home });
        broken.attach('chat-m', 'c1');
        void broken.send('chat-m', 'hi');
        await waitFor(() => other.info?.status === 'error' && other.info.activeTurnId === null, 'the spawn failure');
        expect(other.ofKind('note')[0]?.level).toBe('error');
        await broken.shutdown();
    });
});
