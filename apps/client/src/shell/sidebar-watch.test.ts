import { afterEach, describe, expect, jest, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { Transport, TransportStatus } from '../transport/transport';
import { SidebarWatch, type SidebarWatchOptions } from './sidebar-watch';

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

function summary(projectId: string) {
    return { projectId, name: projectId, color: 'blue', folder: `/${projectId}`, lastOpenedAt: 0, closedAt: null, available: true };
}

const watchers: SidebarWatch[] = [];
function watch(transport: FakeTransport, options: SidebarWatchOptions = {}) {
    const watcher = new SidebarWatch(transport, { polls: () => true, ...options });
    watchers.push(watcher);
    return watcher;
}
async function settle() {
    for (let turn = 0; turn < 15; turn++) {
        await Promise.resolve();
    }
}
afterEach(() => {
    watchers.splice(0).forEach((watcher) => watcher.dispose());
    jest.useRealTimers();
});

describe('background sidebar updates', () => {
    test('dates a wait from its oldest request and keeps a requestless terminal at its first known date', async () => {
        const transport = new FakeTransport();
        let updatedAt = 100;
        transport.answer = (type) =>
            type === 'session.list'
                ? { sessions: [{ sessionId: 'terminal', exited: false, agent: { live: true, status: 'needs-you', updatedAt } }] }
                : type === 'chat.list'
                  ? { chats: [{ chatId: 'chat', status: 'needs-you', requests: [{ createdAt: 80 }, { createdAt: 40 }] }] }
                  : { projects: [] };
        const watcher = watch(transport);
        await settle();
        expect(watcher.getSnapshot().waitingSince).toEqual({ 'terminal:terminal': 100, 'chat:chat': 40 });
        updatedAt = 200;
        watcher.refresh();
        await settle();
        expect(watcher.getSnapshot().waitingSince['terminal:terminal']).toBe(100);
        transport.emit('session.status', { sessionId: 'terminal', agent: { status: 'needs-you', updatedAt: 300, requests: [{ createdAt: 50 }] } });
        expect(watcher.getSnapshot().waitingSince['terminal:terminal']).toBe(50);
        transport.emit('session.status', { sessionId: 'terminal', agent: { status: 'running', updatedAt: 400 } });
        expect(watcher.getSnapshot().waitingSince['terminal:terminal']).toBeUndefined();
        transport.emit('session.status', { sessionId: 'terminal', agent: { status: 'needs-you', updatedAt: 500 } });
        expect(watcher.getSnapshot().waitingSince['terminal:terminal']).toBe(500);
    });

    test.each([
        { status: 'needs-you', expected: 30 },
        { status: 'running', expected: undefined }
    ])('a newer $status event wins over a pending list for the date as well as status', async ({ status, expected }) => {
        const transport = new FakeTransport();
        const watcher = watch(transport);
        await settle();
        transport.emit('chat.status', { chatId: 'chat', info: { status: 'needs-you', requests: [{ createdAt: 10 }] } });
        let reply: (value: unknown) => void = () => {};
        transport.answer = (type) =>
            type === 'chat.list'
                ? new Promise((resolve) => {
                      reply = resolve;
                  })
                : type === 'project.sidebar'
                  ? { projects: [] }
                  : { sessions: [] };
        watcher.refresh();
        transport.emit('chat.status', { chatId: 'chat', info: { status, requests: [{ createdAt: 30 }] } });
        reply({ chats: [{ chatId: 'chat', status: 'needs-you', requests: [{ createdAt: 20 }] }] });
        await settle();
        expect(watcher.getSnapshot().statuses['chat:chat']).toBe(status);
        expect<number | undefined>(watcher.getSnapshot().waitingSince['chat:chat']).toBe(expected);
    });

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

    test('a fresh socket is asked in the turn it opens, so the lists ride on what other clients ask then', async () => {
        const transport = new FakeTransport();
        watch(transport);
        await settle();
        transport.setStatus('closed');
        transport.calls = [];
        transport.setStatus('open');
        expect(transport.calls).toEqual(['project.sidebar', 'session.list', 'chat.list']);
    });

    test('a change to a listed project takes its rows from the document without asking', async () => {
        const transport = new FakeTransport();
        transport.answer = (type) =>
            type === 'project.sidebar' ? { projects: [{ summary: summary('p1'), views: [] }] } : type === 'session.list' ? { sessions: [] } : { chats: [] };
        const watcher = watch(transport);
        await settle();
        const before = transport.calls.length;
        transport.emit('project.changed', {
            projectId: 'p1',
            document: { views: [{ id: 'chat', kind: 'chat', name: 'Discussion', node: { provider: 'claude' } }], shared: ['chat'], flags: { chat: 'red' } }
        });
        await settle();
        expect(transport.calls).toHaveLength(before);
        expect(watcher.getSnapshot().projects[0]?.views).toEqual([
            expect.objectContaining({ id: 'chat', name: 'Discussion', shared: true, flag: 'red', self: expect.objectContaining({ id: 'chat', kind: 'chat' }) })
        ]);
    });

    test('a project the sidebar does not list yet asks for the projects alone', async () => {
        const transport = new FakeTransport();
        watch(transport);
        await settle();
        transport.calls = [];
        transport.emit('project.changed', { projectId: 'new', document: { views: [], shared: [] } });
        await settle();
        expect(transport.calls).toEqual(['project.sidebar']);
        transport.emit('project.summary', { summary: summary('other') });
        await settle();
        expect(transport.calls).toEqual(['project.sidebar', 'project.sidebar']);
    });

    test('a new summary of a listed project is taken as it comes, and a closed one asks again', async () => {
        const transport = new FakeTransport();
        transport.answer = (type) =>
            type === 'project.sidebar' ? { projects: [{ summary: summary('p1'), views: [] }] } : type === 'session.list' ? { sessions: [] } : { chats: [] };
        const watcher = watch(transport);
        await settle();
        transport.calls = [];
        transport.emit('project.summary', { summary: { ...summary('p1'), name: 'Renamed' } });
        await settle();
        expect(transport.calls).toEqual([]);
        expect(watcher.getSnapshot().projects[0]?.summary.name).toBe('Renamed');
        transport.emit('project.summary', { summary: { ...summary('p1'), closedAt: 1 } });
        await settle();
        expect(transport.calls).toEqual(['project.sidebar']);
    });

    test('a client that does not hold a listed project takes its new rows from the summary without asking', async () => {
        const transport = new FakeTransport();
        transport.answer = (type) =>
            type === 'project.sidebar' ? { projects: [{ summary: summary('p1'), views: [] }] } : type === 'session.list' ? { sessions: [] } : { chats: [] };
        const watcher = watch(transport);
        await settle();
        transport.calls = [];
        const row = {
            id: 'chat',
            name: 'Discussion',
            kind: 'chat' as const,
            icon: null,
            provider: 'claude' as const,
            path: null,
            shared: false,
            nodes: [],
            self: null
        };
        transport.emit('project.summary', { summary: summary('p1'), views: [row] });
        await settle();
        expect(transport.calls).toEqual([]);
        expect(watcher.getSnapshot().projects[0]?.views).toEqual([row]);
        transport.emit('project.summary', { summary: { ...summary('p1'), name: 'Renamed' } });
        await settle();
        expect(watcher.getSnapshot().projects[0]).toMatchObject({ summary: { name: 'Renamed' }, views: [row] });
    });

    test('a changed list of sessions asks for the sessions alone, and a burst waits for the round that is out', async () => {
        const transport = new FakeTransport();
        watch(transport);
        await settle();
        transport.calls = [];
        transport.emit('session.list-changed', {});
        transport.emit('session.list-changed', {});
        transport.emit('session.list-changed', {});
        expect(transport.calls).toEqual(['session.list']);
        await settle();
        expect(transport.calls).toEqual(['session.list', 'session.list']);
    });

    test('a status an event set while the list was out stays, and the list replaces only its own kind', async () => {
        const transport = new FakeTransport();
        const watcher = watch(transport);
        await settle();
        transport.emit('chat.status', { chatId: 'chat', info: { status: 'needs-you' } });
        let reply: (value: unknown) => void = () => {};
        transport.answer = () =>
            new Promise((resolve) => {
                reply = resolve;
            });
        transport.emit('session.list-changed', {});
        await settle();
        transport.emit('session.status', { sessionId: 'fresh', agent: { status: 'idle' } });
        reply({
            sessions: [
                { sessionId: 'fresh', exited: false, agent: { live: true, status: 'running' } },
                { sessionId: 'other', exited: true }
            ]
        });
        await settle();
        expect(watcher.getSnapshot().statuses).toEqual({ 'chat:chat': 'needs-you', 'terminal:fresh': 'idle', 'terminal:other': 'error' });
    });

    test('an unchanged status still wins over a list that was already in flight', async () => {
        const transport = new FakeTransport();
        const watcher = watch(transport);
        await settle();
        transport.emit('session.status', { sessionId: 'fresh', agent: { status: 'idle' } });
        const snapshot = watcher.getSnapshot();
        let notifications = 0;
        watcher.subscribe(() => notifications++);
        let reply: (value: unknown) => void = () => {};
        transport.answer = () =>
            new Promise((resolve) => {
                reply = resolve;
            });
        transport.emit('session.list-changed', {});
        transport.emit('session.status', { sessionId: 'fresh', agent: { status: 'idle' } });
        expect(watcher.getSnapshot()).toBe(snapshot);
        reply({ sessions: [{ sessionId: 'fresh', exited: false, agent: { live: true, status: 'running' } }] });
        await settle();
        expect(watcher.getSnapshot().statuses['terminal:fresh']).toBe('idle');
        expect(notifications).toBe(0);
    });

    test('equal summary rows keep the snapshot while a changed name reaches listeners', async () => {
        const transport = new FakeTransport();
        transport.answer = (type) =>
            type === 'project.sidebar' ? { projects: [{ summary: summary('p1'), views: [] }] } : type === 'session.list' ? { sessions: [] } : { chats: [] };
        const watcher = watch(transport);
        await settle();
        const snapshot = watcher.getSnapshot();
        let notifications = 0;
        watcher.subscribe(() => notifications++);
        transport.emit('project.summary', { summary: summary('p1'), views: [] });
        expect(watcher.getSnapshot()).toBe(snapshot);
        expect(notifications).toBe(0);
        transport.emit('project.summary', { summary: { ...summary('p1'), name: 'Renamed' } });
        expect(watcher.getSnapshot().projects[0]?.summary.name).toBe('Renamed');
        expect(notifications).toBe(1);
    });

    test('only a page that polls asks, and then for the projects alone', async () => {
        jest.useFakeTimers();
        let polls = false;
        const transport = new FakeTransport();
        watch(transport, { polls: () => polls });
        await settle();
        transport.calls = [];
        jest.advanceTimersByTime(15_000);
        await settle();
        expect(transport.calls).toEqual([]);
        polls = true;
        jest.advanceTimersByTime(15_000);
        await settle();
        expect(transport.calls).toEqual(['project.sidebar']);
    });

    test('disposal removes listeners and timers', async () => {
        jest.useFakeTimers();
        const transport = new FakeTransport();
        const watcher = watch(transport);
        await settle();
        watcher.dispose();
        const count = transport.calls.length;
        jest.advanceTimersByTime(30_000);
        transport.emit('session.list-changed', {});
        await settle();
        expect(transport.calls).toHaveLength(count);
        expect(transport.statusListeners.size).toBe(0);
        expect([...transport.handlers.values()].every((handlers) => handlers.size === 0)).toBe(true);
    });
});
