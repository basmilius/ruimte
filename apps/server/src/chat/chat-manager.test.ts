import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEvent, ChatInfo, ChatItem, ContextSource } from '@ruimte/contracts';
import { ProviderRegistry } from '../providers/registry.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { waitFor, waitForAsync } from '../sessions/test-helpers.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatStore } from './chat-store.ts';

const FAKE = ['bun', join(import.meta.dir, 'fake-claude.ts')];

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
let manager: ChatManager;
let recorder: ChatRecorder;

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

const makeManager = () => new ChatManager({ providers, store, command: FAKE, env: { PATH: process.env.PATH, HOME: home, RUIMTE_HOOK_URL: 'x' } });

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-chat-'));
    store = new ChatStore(home);
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

describe('ChatManager', () => {
    test('create spawns nothing; the first send starts the CLI with the selection and streams a reply', async () => {
        const info = await manager.create({ chatId: 'chat-1', cwd: home });
        expect(info).toMatchObject({
            chatId: 'chat-1',
            provider: 'claude',
            cwd: home,
            running: false,
            status: 'idle',
            agentSessionId: null,
            runtimeMode: 'full-access',
            selection: { model: 'claude-sonnet-5', options: { effort: 'high', contextWindow: '200k' } },
            usage: { contextWindow: 200000 }
        });
        expect(manager.get('chat-1')?.running).toBe(false);
        expect(manager.attach('chat-1', 'c1')).toEqual({ info, items: [] });

        manager.send('chat-1', 'hello there');
        expect(manager.get('chat-1')?.running).toBe(true);
        expect(() => manager.send('chat-1', 'again')).toThrow('still working');
        await waitFor(idle, 'the turn to end');

        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['hello there']);
        expect(recorder.deltas).toBe('echo: hello there');
        const assistant = recorder.ofKind('assistant');
        expect(assistant).toHaveLength(1);
        expect(assistant[0]).toMatchObject({ text: 'echo: hello there', streaming: false });
        const turn = recorder.ofKind('turn')[0];
        expect(turn).toMatchObject({ state: 'done' });
        expect(turn?.endedAt).not.toBeNull();
        expect(assistant[0]?.turnId).toBe(turn?.id ?? '');
        expect(recorder.info).toMatchObject({
            model: 'claude-sonnet-5',
            slashCommands: ['compact', 'review'],
            usage: { turns: 1, costUsd: 0.01, contextWindow: 200000, contextTokens: 1110 }
        });
        expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
        expect(manager.attach('chat-1', 'c2').items.map((item) => item.kind)).toEqual(['turn', 'user', 'assistant']);
    });

    test('a permission request becomes an approval card, and allowing always sends the suggested rule', async () => {
        await manager.create({ chatId: 'chat-2', cwd: home });
        manager.attach('chat-2', 'c1');
        manager.send('chat-2', 'tool: date');
        await waitFor(() => recorder.info?.status === 'needs-you', 'needs-you');

        const approval = recorder.ofKind('approval')[0];
        expect(approval).toMatchObject({
            requestId: 'req-1',
            toolName: 'Bash',
            input: { command: 'date' },
            decision: 'pending',
            canAllowAlways: true,
            description: 'Run a command'
        });
        expect(recorder.ofKind('tool')[0]).toMatchObject({ toolUseId: 'toolu_1', name: 'Bash', state: 'running', output: null });

        expect(() => manager.approve('chat-2', 'nope', 'allow')).toThrow('Nothing waits');
        manager.approve('chat-2', 'req-1', 'allow-always');
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('approval')[0]?.decision).toBe('allow-always');
        expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'done', output: 'ran: date' });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['done, remembered']);
    });

    test('a running tool carries the progress the CLI reports until its result arrives', async () => {
        await manager.create({ chatId: 'chat-2b', cwd: home });
        manager.attach('chat-2b', 'c1');
        const before = Date.now();
        manager.send('chat-2b', 'run: sleep 30');
        await waitFor(idle, 'the turn to end');

        const running = recorder.events.filter((event) => event.type === 'item' && event.item.kind === 'tool' && event.item.state === 'running');
        const withProgress = running.map((event) => (event.type === 'item' && event.item.kind === 'tool' ? event.item.progress : undefined)).filter(Boolean);
        expect(withProgress.at(-1)).toMatchObject({ description: 'Run sleep 30', output: null });
        expect(withProgress.at(-1)!.startedAt).toBeLessThanOrEqual(before - 30_000 + 5_000);
        expect(recorder.ofKind('tool')[0]).toMatchObject({ toolUseId: 'toolu_run', state: 'done', output: 'ran: sleep 30' });
        expect(recorder.ofKind('tool')[0]).not.toHaveProperty('progress');
    });

    test('denying answers the CLI and the tool ends in error', async () => {
        await manager.create({ chatId: 'chat-3', cwd: home });
        manager.attach('chat-3', 'c1');
        manager.send('chat-3', 'tool: rm -rf /');
        await waitFor(() => recorder.info?.status === 'needs-you', 'needs-you');
        manager.approve('chat-3', 'req-1', 'deny', 'not that');
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'error', output: 'denied by user' });
    });

    test('a question to the person is answered by id and reaches the CLI by text', async () => {
        await manager.create({ chatId: 'chat-q', cwd: home });
        manager.attach('chat-q', 'c1');
        manager.send('chat-q', 'ask: Which color?');
        await waitFor(() => recorder.info?.status === 'needs-you', 'needs-you');
        const question = recorder.ofKind('question')[0];
        expect(question).toMatchObject({
            requestId: 'req-q',
            state: 'pending',
            questions: [{ id: '0', header: 'Choice', question: 'Which color?', multiSelect: false }]
        });
        expect(question?.questions[0]?.choices.map((choice) => choice.label)).toEqual(['Red', 'Blue']);

        expect(() => manager.answer('chat-q', 'nope', {})).toThrow('No question');
        manager.answer('chat-q', 'req-q', { '0': 'Blue' });
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('question')[0]).toMatchObject({ state: 'answered', answers: { '0': 'Blue' } });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['you chose Blue']);
    });

    test('cancel interrupts a running turn and marks it aborted', async () => {
        await manager.create({ chatId: 'chat-4', cwd: home });
        manager.attach('chat-4', 'c1');
        manager.send('chat-4', 'slow');
        await waitFor(() => recorder.info?.running === true, 'process up');
        manager.cancel('chat-4');
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['[interrupted]']);
        expect(recorder.ofKind('turn')[0]?.state).toBe('aborted');
    });

    test('configure restarts the CLI with new flags on the next send and keeps the session', async () => {
        await manager.create({ chatId: 'chat-c', cwd: home });
        manager.attach('chat-c', 'c1');
        manager.send('chat-c', 'first');
        await waitFor(idle, 'first turn');
        const sessionId = recorder.info?.agentSessionId;

        const info = manager.configure({
            chatId: 'chat-c',
            selection: { model: 'opus', options: { effort: 'max' } },
            runtimeMode: 'supervised',
            interactionMode: 'plan'
        });
        expect(info).toMatchObject({
            selection: { model: 'claude-opus-5', options: { effort: 'max', contextWindow: '1m' } },
            runtimeMode: 'supervised',
            interactionMode: 'plan',
            usage: { contextWindow: 1000000 }
        });
        // Same again is a no-op and does not schedule a restart.
        expect(manager.configure({ chatId: 'chat-c', runtimeMode: 'supervised' })).toBe(info);

        manager.send('chat-c', 'argv?');
        await waitFor(() => recorder.info?.usage.turns === 2 && idle(), 'second turn');
        expect(recorder.info?.agentSessionId).toBe(sessionId ?? null);
        // The fake reports the `--model` it was started with, so this proves the restart carried the new flags.
        expect(recorder.info?.model).toBe('claude-opus-5[1m]');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first', 'echo: argv?']);
    });

    test('a thread survives a new manager and the next send resumes the same CLI session', async () => {
        await manager.create({ chatId: 'chat-5', cwd: home });
        manager.attach('chat-5', 'c1');
        manager.send('chat-5', 'first');
        await waitFor(idle, 'the turn to end');
        const sessionId = recorder.info?.agentSessionId;
        await waitForAsync(async () => (await store.read('chat-5')) !== null, 'the record on disk');
        await manager.shutdown();

        const again = makeManager();
        const other = new ChatRecorder();
        again.subscribe('c9', other.sink());
        const info = await again.create({ chatId: 'chat-5' });
        expect(info).toMatchObject({ agentSessionId: sessionId, running: false, status: 'idle', usage: { turns: 1 } });
        expect(again.attach('chat-5', 'c9').items.map((item) => item.kind)).toEqual(['turn', 'user', 'assistant']);

        again.send('chat-5', 'second');
        await waitFor(() => other.info?.status === 'idle' && other.info.running, 'the second turn');
        expect(other.info?.agentSessionId).toBe(sessionId ?? null);
        expect(other.info?.usage.turns).toBe(2);
        await again.shutdown();
        again.get('chat-5')?.dispose();
    });

    test('compaction shows up as a marker', async () => {
        await manager.create({ chatId: 'chat-k', cwd: home });
        manager.attach('chat-k', 'c1');
        manager.send('chat-k', 'compact');
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('compaction')[0]).toMatchObject({ preTokens: 5000 });
    });

    test('a link made between turns is put in front of the next prompt, once, as a note', async () => {
        let sources: ContextSource[] = [];
        await manager.shutdown();
        manager = new ChatManager({ providers, store, command: FAKE, env: { PATH: process.env.PATH, HOME: home }, contextSources: () => sources });
        manager.subscribe('c1', recorder.sink());
        await manager.create({ chatId: 'chat-ctx', cwd: home });
        manager.attach('chat-ctx', 'c1');

        manager.send('chat-ctx', 'first');
        await waitFor(idle, 'the first turn');
        sources = [{ id: 'term-1', kind: 'terminal', title: 'dev server' }];
        manager.send('chat-ctx', 'second');
        await waitFor(() => recorder.ofKind('assistant').length === 2, 'the second turn');
        manager.send('chat-ctx', 'third');
        await waitFor(() => recorder.ofKind('assistant').length === 3, 'the third turn');

        const notes = recorder.ofKind('note');
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ level: 'info', turnId: recorder.ofKind('turn')[1]?.turnId });
        expect(notes[0]?.text).toContain('Added: "dev server" (terminal)');
        // The fake echoes its prompt, so the reply shows what the CLI was given.
        const replies = recorder.ofKind('assistant').map((item) => item.text);
        expect(replies[0]).toBe('echo: first');
        expect(replies[1]).toBe(`echo: ${notes[0]?.text}\n\nsecond`);
        expect(replies[2]).toBe('echo: third');
        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['first', 'second', 'third']);
    });

    test('a CLI that dies mid-turn leaves an error note and the chat can go on', async () => {
        await manager.create({ chatId: 'chat-6', cwd: home });
        manager.attach('chat-6', 'c1');
        manager.send('chat-6', 'crash');
        await waitFor(() => recorder.info?.running === false && recorder.info.status === 'error', 'error status');
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: 'Claude Code exited with code 1' });
        expect(recorder.ofKind('turn')[0]?.state).toBe('error');

        manager.send('chat-6', 'again');
        await waitFor(idle, 'the next turn');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: again']);
    });

    test('kill drops the thread and its record', async () => {
        await manager.create({ chatId: 'chat-7', cwd: home });
        manager.attach('chat-7', 'c1');
        manager.send('chat-7', 'x');
        await waitFor(idle, 'the turn to end');
        await waitForAsync(async () => (await store.read('chat-7')) !== null, 'record');
        await manager.kill('chat-7');
        expect(manager.list()).toEqual([]);
        expect(await store.read('chat-7')).toBeNull();
        expect(() => manager.send('chat-7', 'x')).toThrow('No chat');
    });
});
