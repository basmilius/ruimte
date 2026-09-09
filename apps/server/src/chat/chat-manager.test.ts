import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEvent, ChatInfo, ChatItem } from '@ruimte/contracts';
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

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-chat-'));
    store = new ChatStore(home);
    manager = new ChatManager({ store, command: FAKE, env: { PATH: process.env.PATH, HOME: home, RUIMTE_HOOK_URL: 'x' } });
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

const idle = () => recorder.info?.status === 'idle' && recorder.info.running;

describe('ChatManager', () => {
    test('create spawns nothing; the first send starts the CLI and streams a reply', async () => {
        const info = await manager.create({ chatId: 'chat-1', cwd: home });
        expect(info).toMatchObject({ chatId: 'chat-1', cwd: home, running: false, status: 'idle', agentSessionId: null });
        expect(manager.get('chat-1')?.running).toBe(false);
        expect(manager.attach('chat-1', 'c1')).toEqual({ info, items: [] });

        manager.send('chat-1', 'hello there');
        expect(manager.get('chat-1')?.running).toBe(true);
        await waitFor(idle, 'the turn to end');

        expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['hello there']);
        expect(recorder.deltas).toBe('echo: hello there');
        const assistant = recorder.ofKind('assistant');
        expect(assistant).toHaveLength(1);
        expect(assistant[0]).toMatchObject({ text: 'echo: hello there', streaming: false });
        expect(recorder.info).toMatchObject({ model: 'fake-model', usage: { turns: 1, costUsd: 0.01, contextWindow: 200000, contextTokens: 1110 } });
        expect(recorder.info?.agentSessionId?.startsWith('fake-')).toBe(true);
        // The thread from the daemon's side matches what the events built.
        expect(manager.attach('chat-1', 'c2').items.map((item) => item.kind)).toEqual(['user', 'assistant']);
    });

    test('a permission request becomes an approval card, and approving runs the tool', async () => {
        await manager.create({ chatId: 'chat-2', cwd: home });
        manager.attach('chat-2', 'c1');
        manager.send('chat-2', 'tool: date');
        await waitFor(() => recorder.info?.status === 'needs-you', 'needs-you');

        const approval = recorder.ofKind('approval')[0];
        expect(approval).toMatchObject({ requestId: 'req-1', toolName: 'Bash', input: { command: 'date' }, decision: 'pending', description: 'Run a command' });
        expect(recorder.ofKind('tool')[0]).toMatchObject({ toolUseId: 'toolu_1', name: 'Bash', state: 'running', output: null });

        expect(() => manager.approve('chat-2', 'nope', 'allow')).toThrow('Nothing waits');
        manager.approve('chat-2', 'req-1', 'allow');
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('approval')[0]?.decision).toBe('allow');
        expect(recorder.ofKind('tool')[0]).toMatchObject({ state: 'done', output: 'ran: date' });
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['done']);
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

    test('cancel interrupts a running turn', async () => {
        await manager.create({ chatId: 'chat-4', cwd: home });
        manager.attach('chat-4', 'c1');
        manager.send('chat-4', 'slow');
        await waitFor(() => recorder.info?.running === true, 'process up');
        manager.cancel('chat-4');
        await waitFor(idle, 'the turn to end');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['[interrupted]']);
    });

    test('a thread survives a new manager and the next send resumes the same CLI session', async () => {
        await manager.create({ chatId: 'chat-5', cwd: home });
        manager.attach('chat-5', 'c1');
        manager.send('chat-5', 'first');
        await waitFor(idle, 'the turn to end');
        const sessionId = recorder.info?.agentSessionId;
        await waitForAsync(async () => (await store.read('chat-5')) !== null, 'the record on disk');
        await manager.shutdown();

        const again = new ChatManager({ store, command: FAKE, env: { PATH: process.env.PATH, HOME: home } });
        const other = new ChatRecorder();
        again.subscribe('c9', other.sink());
        const info = await again.create({ chatId: 'chat-5' });
        expect(info).toMatchObject({ agentSessionId: sessionId, running: false, status: 'idle', usage: { turns: 1 } });
        expect(again.attach('chat-5', 'c9').items.map((item) => item.kind)).toEqual(['user', 'assistant']);

        again.send('chat-5', 'second');
        await waitFor(() => other.info?.status === 'idle' && other.info.running, 'the second turn');
        expect(other.info?.agentSessionId).toBe(sessionId ?? null);
        expect(other.info?.usage.turns).toBe(2);
        await again.shutdown();
        again.get('chat-5')?.dispose();
    });

    test('a CLI that dies mid-turn leaves an error note and the chat can go on', async () => {
        await manager.create({ chatId: 'chat-6', cwd: home });
        manager.attach('chat-6', 'c1');
        manager.send('chat-6', 'crash');
        await waitFor(() => recorder.info?.running === false && recorder.info.status === 'error', 'error status');
        expect(recorder.ofKind('note')[0]).toMatchObject({ level: 'error', text: 'Claude Code exited with code 1' });

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
