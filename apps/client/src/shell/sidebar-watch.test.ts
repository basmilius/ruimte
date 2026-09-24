import { afterEach, describe, expect, jest, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';
import { SidebarWatch } from './sidebar-watch';

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    calls: string[] = [];
    handlers = new Map<string, Set<(value: never) => void>>();
    statusListeners = new Set<(status: TransportStatus) => void>();
    answer: (type: RequestType) => unknown = (type) =>
        type === 'project.sidebar' ? { projects: [] } : type === 'session.list' ? { sessions: [] } : { chats: [] };
    async request<T extends RequestType>(type: T): Promise<RequestMap[T]['result']> {
        this.calls.push(type);
        return (await this.answer(type)) as RequestMap[T]['result'];
    }
    on<E extends EventType>(event: E, handler: (value: EventMap[E]) => void): () => void {
        const handlers = this.handlers.get(event) ?? new Set();
        handlers.add(handler as (value: never) => void);
        this.handlers.set(event, handlers);
        return () => {
            handlers.delete(handler as (value: never) => void);
        };
    }
    subscribeStatus(listener: (status: TransportStatus) => void): () => void {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    }
    emit(event: string, value: unknown) {
        this.handlers.get(event)?.forEach((handler) => handler(value as never));
    }
    setStatus(status: TransportStatus) {
        this.status = status;
        this.statusListeners.forEach((handler) => handler(status));
    }
}

const watchers: SidebarWatch[] = [];
const watch = (transport: FakeTransport) => {
    const watcher = new SidebarWatch(transport);
    watchers.push(watcher);
    return watcher;
};
const settle = async () => {
    for (let turn = 0; turn < 15; turn++) {
        await Promise.resolve();
    }
};
afterEach(() => {
    watchers.splice(0).forEach((watcher) => watcher.dispose());
    jest.useRealTimers();
});

describe('background sidebar updates', () => {
    test('loads statuses without opening projects or attaching sessions', async () => {
        const transport = new FakeTransport();
        transport.answer = (type) =>
            type === 'project.sidebar'
                ? { projects: [] }
                : type === 'session.list'
                  ? { sessions: [{ sessionId: 'terminal', exited: false, agent: { live: true, status: 'needs-you' } }] }
                  : { chats: [{ chatId: 'chat', status: 'running' }] };
        const watcher = watch(transport);
        await settle();
        expect(watcher.getSnapshot().state).toBe('ready');
        expect(watcher.getSnapshot().statuses).toEqual({ 'terminal:terminal': 'needs-you', 'chat:chat': 'running' });
        expect(transport.calls).toEqual(['project.sidebar', 'session.list', 'chat.list']);
        transport.emit('chat.status', { chatId: 'chat', info: { status: 'needs-you' } });
        expect(watcher.getSnapshot().statuses['chat:chat']).toBe('needs-you');
        transport.emit('session.status', { sessionId: 'terminal', agent: { status: 'idle' } });
        expect(watcher.getSnapshot().statuses['terminal:terminal']).toBe('idle');
    });

    test('disconnects invalidate in-flight results and a reconnect loads fresh data', async () => {
        const transport = new FakeTransport();
        let reply: (value: unknown) => void = () => {};
        transport.answer = (type) =>
            type === 'project.sidebar'
                ? new Promise((resolve) => {
                      reply = resolve;
                  })
                : type === 'chat.list'
                  ? { chats: [] }
                  : { sessions: [] };
        const watcher = watch(transport);
        transport.setStatus('closed');
        reply({ projects: [] });
        await settle();
        expect(watcher.getSnapshot().state).toBe('offline');
        transport.answer = (type) => (type === 'project.sidebar' ? { projects: [] } : type === 'chat.list' ? { chats: [] } : { sessions: [] });
        transport.setStatus('open');
        await settle();
        expect(watcher.getSnapshot().state).toBe('ready');
    });

    test('external edits are refreshed and disposal removes listeners and timers', async () => {
        jest.useFakeTimers();
        const transport = new FakeTransport();
        const watcher = watch(transport);
        await settle();
        transport.emit('project.changed', {});
        jest.advanceTimersByTime(150);
        await settle();
        expect(transport.calls.filter((type) => type === 'project.sidebar')).toHaveLength(2);
        jest.advanceTimersByTime(15_000);
        await settle();
        expect(transport.calls.filter((type) => type === 'project.sidebar')).toHaveLength(3);
        watcher.dispose();
        const count = transport.calls.length;
        jest.advanceTimersByTime(30_000);
        await settle();
        expect(transport.calls).toHaveLength(count);
        expect(transport.statusListeners.size).toBe(0);
        expect([...transport.handlers.values()].every((handlers) => handlers.size === 0)).toBe(true);
    });

    test('older daemons get an explicit unsupported state and are not repeatedly queried', async () => {
        const transport = new FakeTransport();
        transport.answer = () => {
            throw new TransportError('unknown-request', 'Unsupported');
        };
        const watcher = watch(transport);
        await settle();
        expect(watcher.getSnapshot().state).toBe('unsupported');
        const count = transport.calls.length;
        watcher.refresh();
        await settle();
        expect(transport.calls).toHaveLength(count);
    });
});
