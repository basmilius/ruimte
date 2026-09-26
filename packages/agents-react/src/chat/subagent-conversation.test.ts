import { describe, expect, test } from 'bun:test';
import type { AgentEventType, AgentRequestType, ChatItem, ChatSubagentPayload, ChatSubagentResult } from '@ruimte/agent-contracts';
import { ChatTransportError, type ChatEventMap, type ChatRequestMap, type ChatTransport, type ChatTransportStatus } from '../transport';
import { mergeNewest, SubagentConversation, type SubagentConversationState } from './subagent-conversation';

const note = (id: string, text = id): ChatItem => ({ id, kind: 'note', createdAt: 0, turnId: null, level: 'info', text });

/* A machine that answers `chat.subagent` from a list the test grows, newest page first with offsets as cursors. */
class FakeMachine implements ChatTransport {
    status: ChatTransportStatus = 'open';
    conversation: ChatItem[] = [];
    readonly asked: ChatSubagentPayload[] = [];
    fail: ChatTransportError | null = null;
    // Refuses only the next request, the way a record that was just rewritten refuses one cursor.
    failNext: ChatTransportError | null = null;
    private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statusHandlers = new Set<(status: ChatTransportStatus) => void>();

    request<T extends AgentRequestType>(type: T, payload: ChatRequestMap[T]['payload']): Promise<ChatRequestMap[T]['result']> {
        if (type !== 'chat.subagent') {
            return Promise.reject(new ChatTransportError('unknown-request', type));
        }
        const asked = payload as ChatSubagentPayload;
        this.asked.push(asked);
        const failure = this.fail ?? this.failNext;
        this.failNext = null;
        if (failure) {
            return Promise.reject(failure);
        }
        const end = asked.cursor === undefined ? this.conversation.length : Number(asked.cursor);
        const start = Math.max(0, end - (asked.limit ?? 60));
        const result: ChatSubagentResult = {
            items: this.conversation.slice(start, end),
            history: { start, cursor: start > 0 ? String(start) : null },
            source: 'claude-transcript',
            live: true
        };
        return Promise.resolve(result as ChatRequestMap[T]['result']);
    }

    on<E extends AgentEventType>(event: E, handler: (payload: ChatEventMap[E]) => void): () => void {
        const set = this.handlers.get(event) ?? new Set();
        set.add(handler as (payload: unknown) => void);
        this.handlers.set(event, set);
        return () => set.delete(handler as (payload: unknown) => void);
    }

    subscribeStatus(handler: (status: ChatTransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => this.statusHandlers.delete(handler);
    }

    emit<E extends AgentEventType>(event: E, payload: ChatEventMap[E]): void {
        for (const handler of this.handlers.get(event) ?? []) {
            handler(payload);
        }
    }

    setStatus(status: ChatTransportStatus): void {
        this.status = status;
        for (const handler of this.statusHandlers) {
            handler(status);
        }
    }
}

const open = async (machine: FakeMachine): Promise<{ conversation: SubagentConversation; states: SubagentConversationState[] }> => {
    const states: SubagentConversationState[] = [];
    const conversation = new SubagentConversation(machine, 'chat-1', 'toolu_1', (state) => states.push(state));
    await conversation.start();
    return { conversation, states };
};

describe('mergeNewest', () => {
    test('replaces what is there in place and adds what is new after it', () => {
        const merged = mergeNewest([note('a'), note('b')], 'c-1', [note('b', 'b2'), note('c')], null);
        expect(merged.items.map((item) => (item.kind === 'note' ? item.text : ''))).toEqual(['a', 'b2', 'c']);
        expect(merged.cursor).toBe('c-1');
    });

    test('a page that shares nothing with what is held takes its place, cursor and all', () => {
        expect(mergeNewest([note('a')], null, [note('x'), note('y')], 'c-9')).toEqual({ items: [note('x'), note('y')], cursor: 'c-9' });
    });
});

describe('SubagentConversation', () => {
    test('opens on the newest page, holding it, and pages back to the start', async () => {
        const machine = new FakeMachine();
        machine.conversation = Array.from({ length: 130 }, (_, i) => note(`n${i}`));
        const { conversation } = await open(machine);
        expect(machine.asked[0]).toEqual({ chatId: 'chat-1', toolUseId: 'toolu_1', limit: 60, watch: true });
        expect(conversation.current).toMatchObject({ status: 'ready', live: true, cursor: '70' });
        expect(conversation.current.items[0]?.id).toBe('n70');

        await conversation.loadEarlier();
        await conversation.loadEarlier();
        expect(conversation.current.cursor).toBeNull();
        expect(conversation.current.items.map((item) => item.id)).toEqual(machine.conversation.map((item) => item.id));
    });

    test('grows when the machine says so, and asks once for a burst of changes', async () => {
        const machine = new FakeMachine();
        machine.conversation = [note('a')];
        const { conversation } = await open(machine);
        machine.conversation.push(note('b'));
        machine.emit('chat.subagentChanged', { chatId: 'chat-1', toolUseId: 'toolu_1' });
        machine.emit('chat.subagentChanged', { chatId: 'chat-1', toolUseId: 'toolu_1' });
        machine.emit('chat.subagentChanged', { chatId: 'chat-1', toolUseId: 'other' });
        await conversation.refresh();
        expect(conversation.current.items.map((item) => item.id)).toEqual(['a', 'b']);
        expect(machine.asked.filter((asked) => asked.watch === undefined)).toHaveLength(1);
    });

    test('a socket that comes back holds the conversation again, and closing lets go', async () => {
        const machine = new FakeMachine();
        machine.conversation = [note('a')];
        const { conversation } = await open(machine);
        machine.setStatus('closed');
        machine.setStatus('open');
        await conversation.refresh();
        expect(machine.asked.filter((asked) => asked.watch === true)).toHaveLength(2);
        conversation.dispose();
        expect(machine.asked.at(-1)).toMatchObject({ watch: false });
    });

    test('a machine from before the panel says so, and a history that expired starts over from the newest end', async () => {
        const old = new FakeMachine();
        old.fail = new ChatTransportError('unknown-request', 'Unknown request type: chat.subagent');
        const { conversation: refused } = await open(old);
        expect(refused.current).toMatchObject({ status: 'failed', unsupported: true });

        const machine = new FakeMachine();
        machine.conversation = Array.from({ length: 70 }, (_, i) => note(`n${i}`));
        const { conversation } = await open(machine);
        machine.conversation = [note('fresh')];
        machine.failNext = new ChatTransportError('history-expired', 'The conversation changed. Reload its history.');
        await conversation.loadEarlier();
        expect(conversation.current).toMatchObject({ status: 'ready', cursor: null, loadingEarlier: false });
        expect(conversation.current.items.map((item) => item.id)).toEqual(['fresh']);
    });
});
