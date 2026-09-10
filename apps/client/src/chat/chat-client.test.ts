import { describe, expect, test } from 'bun:test';
import type { ChatEvent, ChatInfo, ChatItem, EventMap, EventType, ProviderInfo, RequestMap, RequestType } from '@ruimte/contracts';
import type { ChatSink } from '../state/chats';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';
import { ChatClient } from './chat-client';

type Call = { type: RequestType; payload: unknown };

const info = (chatId: string): ChatInfo => ({
    chatId,
    provider: 'claude',
    cwd: '/',
    agentSessionId: null,
    model: null,
    selection: { model: 'claude-sonnet-5', options: {} },
    runtimeMode: 'full-access',
    interactionMode: 'default',
    status: 'idle',
    running: false,
    activeTurnId: null,
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
    createdAt: 0
});

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    readonly calls: Call[] = [];
    items: ChatItem[] = [];
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
    private readonly eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.calls.push({ type, payload });
        if (this.status !== 'open') {
            return Promise.reject(new TransportError('not-connected', 'offline'));
        }
        const chatId = (payload as { chatId?: string }).chatId ?? '';
        switch (type) {
            case 'chat.create':
                return Promise.resolve(info(chatId) as RequestMap[T]['result']);
            case 'chat.attach':
                return Promise.resolve({ info: info(chatId), items: this.items } as RequestMap[T]['result']);
            case 'chat.configure':
                return Promise.resolve({ ...info(chatId), runtimeMode: 'auto' } as RequestMap[T]['result']);
            case 'provider.list':
                return Promise.resolve({
                    providers: [{ kind: 'claude', name: 'Claude Code', installed: true, version: '1', models: [], defaultModel: null }]
                } as RequestMap[T]['result']);
            default:
                return Promise.resolve({} as RequestMap[T]['result']);
        }
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        let handlers = this.eventHandlers.get(event);
        if (!handlers) {
            handlers = new Set();
            this.eventHandlers.set(event, handlers);
        }
        handlers.add(handler as (payload: unknown) => void);
        return () => {
            handlers.delete(handler as (payload: unknown) => void);
        };
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => {
            this.statusHandlers.delete(handler);
        };
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        for (const handler of this.eventHandlers.get(event) ?? []) {
            handler(payload);
        }
    }

    setStatus(status: TransportStatus): void {
        this.status = status;
        for (const handler of this.statusHandlers) {
            handler(status);
        }
    }

    of(type: RequestType): Call[] {
        return this.calls.filter((call) => call.type === type);
    }
}

class FakeSink implements ChatSink {
    readonly resets: Array<{ chatId: string; items: ChatItem[] }> = [];
    readonly events: Array<{ chatId: string; event: ChatEvent }> = [];
    readonly forgotten: string[] = [];

    reset(chatId: string, _info: ChatInfo, items: ChatItem[]): void {
        this.resets.push({ chatId, items });
    }

    apply(chatId: string, event: ChatEvent): void {
        this.events.push({ chatId, event });
    }

    forget(chatId: string): void {
        this.forgotten.push(chatId);
    }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setup = () => {
    const transport = new FakeTransport();
    const sink = new FakeSink();
    const providers: ProviderInfo[][] = [];
    const client = new ChatClient(transport, sink, { setProviders: (list) => providers.push(list) });
    return { transport, sink, client, providers };
};

describe('ChatClient', () => {
    test('open creates with cwd and resume, attaches and resets the store with the thread', async () => {
        const { transport, sink, client } = setup();
        transport.items = [{ id: 'u1', kind: 'user', createdAt: 1, turnId: null, text: 'hi' }];
        expect(await client.open('c', { cwd: '/tmp', resume: 'abc', runtimeMode: 'auto' })).toBe(true);
        expect(transport.of('chat.create')[0]?.payload).toEqual({
            chatId: 'c',
            provider: undefined,
            cwd: '/tmp',
            resume: 'abc',
            selection: undefined,
            runtimeMode: 'auto'
        });
        expect(transport.of('chat.attach')[0]?.payload).toEqual({ chatId: 'c' });
        expect(sink.resets).toEqual([{ chatId: 'c', items: transport.items }]);
    });

    test('events reach the store, whatever chat they are for', () => {
        const { transport, sink } = setup();
        transport.emit('chat.event', { chatId: 'c', event: { type: 'delta', itemId: 'a1', text: 'x' } });
        expect(sink.events).toEqual([{ chatId: 'c', event: { type: 'delta', itemId: 'a1', text: 'x' } }]);
    });

    test('a reconnect attaches every mounted chat again and hands the store the fresh thread', async () => {
        const { transport, sink, client } = setup();
        await client.open('a', {});
        await client.open('b', {});
        await client.detach('b');
        expect(transport.of('chat.detach')).toHaveLength(1);

        transport.setStatus('closed');
        transport.calls.length = 0;
        transport.setStatus('open');
        await flush();
        expect(transport.of('chat.attach').map((c) => c.payload)).toEqual([{ chatId: 'a' }]);
        expect(sink.resets.map((r) => r.chatId)).toEqual(['a', 'b', 'a']);
    });

    test('opening while offline waits for the transport', async () => {
        const { transport, sink, client } = setup();
        transport.setStatus('closed');
        expect(await client.open('a', {})).toBe(false);
        expect(client.isMounted('a')).toBe(true);
        transport.setStatus('open');
        await flush();
        expect(sink.resets.map((r) => r.chatId)).toEqual(['a']);
    });

    test('send, cancel, approve, answer, compact and kill map to their requests', async () => {
        const { transport, sink, client } = setup();
        await client.open('a', {});
        await client.send('a', 'hello');
        await client.cancel('a');
        await client.approve('a', 'r1', 'deny', 'no');
        await client.answer('a', 'r2', { '0': 'Blue' });
        await client.compact('a');
        await client.kill('a');
        expect(transport.of('chat.send')[0]?.payload).toEqual({ chatId: 'a', text: 'hello' });
        expect(transport.of('chat.cancel')).toHaveLength(1);
        expect(transport.of('chat.approve')[0]?.payload).toEqual({ chatId: 'a', requestId: 'r1', decision: 'deny', message: 'no' });
        expect(transport.of('chat.answer')[0]?.payload).toEqual({ chatId: 'a', requestId: 'r2', answers: { '0': 'Blue' } });
        expect(transport.of('chat.compact')).toHaveLength(1);
        expect(transport.of('chat.kill')).toHaveLength(1);
        expect(sink.forgotten).toEqual(['a']);
        expect(client.isMounted('a')).toBe(false);
    });

    test('configure feeds the answered info straight into the store', async () => {
        const { sink, client } = setup();
        await client.open('a', {});
        const info = await client.configure({ chatId: 'a', runtimeMode: 'auto' });
        expect(info.runtimeMode).toBe('auto');
        expect(sink.events.at(-1)).toEqual({ chatId: 'a', event: { type: 'info', info } });
    });

    test('the provider list is loaded on construction and again on every reconnect', async () => {
        const { transport, providers } = setup();
        await flush();
        expect(providers).toHaveLength(1);
        transport.setStatus('closed');
        transport.setStatus('open');
        await flush();
        expect(providers).toHaveLength(2);
        expect(providers[1]?.[0]?.kind).toBe('claude');
    });
});
