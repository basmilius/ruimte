import { describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { HIGH_WATER_MARK } from './backpressure.ts';
import { connectionOpener, type ClientChannel, type ConnectionServices } from './connection.ts';
import { Dispatcher } from './dispatcher.ts';
import type { SessionEvent, SessionSink } from './sessions/manager.ts';

class FakeChannel implements ClientChannel {
    readonly frames: ServerFrame[] = [];
    buffered = 0;
    closedWith: { code: number; reason: string } | null = null;
    private readonly closeListeners: Array<() => void> = [];
    private readonly drainListeners: Array<() => void> = [];

    send(data: string): number {
        this.frames.push(JSON.parse(data) as ServerFrame);
        return data.length;
    }

    bufferedAmount(): number {
        return this.buffered;
    }

    close(code: number, reason: string): void {
        this.closedWith = { code, reason };
    }

    onClose(listener: () => void): void {
        this.closeListeners.push(listener);
    }

    onDrain(listener: () => void): void {
        this.drainListeners.push(listener);
    }

    fireClose(): void {
        for (const listener of this.closeListeners) {
            listener();
        }
    }

    fireDrain(): void {
        for (const listener of this.drainListeners) {
            listener();
        }
    }
}

// A manager or store as the opener sees it: who subscribed, in which order, and who was detached.
class FakeSource {
    readonly sinks = new Map<string, SessionSink>();
    private readonly name: string;
    private readonly order: string[];

    constructor(name: string, order: string[]) {
        this.name = name;
        this.order = order;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.order.push(`subscribe:${this.name}`);
        this.sinks.set(clientId, sink);
        return () => {
            this.order.push(`unsubscribe:${this.name}`);
            this.sinks.delete(clientId);
        };
    }

    detachAll(clientId: string): void {
        this.order.push(`detach:${this.name}:${clientId}`);
    }

    emit(clientId: string, event: SessionEvent): void {
        this.sinks.get(clientId)?.(event);
    }
}

const NAMES = ['sessions', 'chats', 'identity', 'projects', 'drawings', 'diagrams', 'flows', 'folders', 'statuses', 'usage', 'limits', 'processes'] as const;

const setup = (screens: Record<string, string> = {}) => {
    const order: string[] = [];
    const sources = Object.fromEntries(NAMES.map((name) => [name, new FakeSource(name, order)])) as Record<(typeof NAMES)[number], FakeSource>;
    const dispatcher = new Dispatcher();
    dispatcher.register('server.hello', () => ({ version: '1.2.3', platform: 'test', home: '/tmp/home' }));
    const sessions = Object.assign(sources.sessions, {
        get: (sessionId: string) => (sessionId in screens ? { isAttached: () => true, serializeScreen: async () => screens[sessionId] as string } : undefined)
    });
    const services: ConnectionServices = { ...sources, sessions, dispatcher };
    return { open: connectionOpener(services), sources, order };
};

// The dispatcher answers across an await; one macrotask settles it.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('connectionOpener', () => {
    test('gives every channel a client id of its own and subscribes it everywhere, in order', () => {
        const { open, order } = setup();
        const first = open(new FakeChannel(), { reachability: 'loopback', sessionId: null });
        const second = open(new FakeChannel(), { reachability: 'lan', sessionId: 'paired-1' });

        expect(first.client.id).toBe('client-1');
        expect(second.client.id).toBe('client-2');
        expect(second.client.access).toEqual({ reachability: 'lan', sessionId: 'paired-1' });
        expect(order.slice(0, NAMES.length)).toEqual(NAMES.map((name) => `subscribe:${name}`));
    });

    test('answers a request on the channel it came in on', async () => {
        const { open } = setup();
        const channel = new FakeChannel();
        const connection = open(channel, { reachability: 'loopback', sessionId: null });

        connection.receive(JSON.stringify({ id: 'r1', type: 'server.hello', payload: {} }));
        await flush();

        expect(channel.frames).toEqual([{ id: 'r1', ok: true, result: { version: '1.2.3', platform: 'test', home: '/tmp/home' } }]);
    });

    test('passes an event from a subscription on as an event frame', () => {
        const { open, sources } = setup();
        const channel = new FakeChannel();
        const connection = open(channel, { reachability: 'loopback', sessionId: null });

        sources.processes.emit(connection.client.id, { event: 'processes.alerts', payload: { alerts: [] } } as unknown as SessionEvent);

        expect(channel.frames).toEqual([{ type: 'event', event: 'processes.alerts', payload: { alerts: [] } }]);
    });

    test('detaches and unsubscribes once when the channel closes, and ignores what arrives after', async () => {
        const { open, sources, order } = setup();
        const channel = new FakeChannel();
        const connection = open(channel, { reachability: 'loopback', sessionId: null });
        order.length = 0;

        channel.fireClose();
        channel.fireClose();
        connection.receive(JSON.stringify({ id: 'r1', type: 'server.hello', payload: {} }));
        await flush();

        expect(order).toEqual([
            'detach:sessions:client-1',
            'detach:chats:client-1',
            'detach:folders:client-1',
            'detach:statuses:client-1',
            ...NAMES.map((name) => `unsubscribe:${name}`)
        ]);
        for (const name of NAMES) {
            expect(sources[name].sinks.size).toBe(0);
        }
        expect(channel.frames).toEqual([]);
    });

    test('gates output on the channel buffer and repairs it with a screen on drain', async () => {
        const { open, sources } = setup({ a: 'screen-a' });
        const channel = new FakeChannel();
        const connection = open(channel, { reachability: 'loopback', sessionId: null });
        const output = (data: string) => ({ event: 'session.output', payload: { sessionId: 'a', data } }) as SessionEvent;

        channel.buffered = HIGH_WATER_MARK + 1;
        sources.sessions.emit(connection.client.id, output('fills the queue'));
        sources.sessions.emit(connection.client.id, output('dropped'));
        channel.buffered = 0;
        channel.fireDrain();
        await flush();

        expect(channel.frames).toEqual([
            { type: 'event', event: 'session.output', payload: { sessionId: 'a', data: 'fills the queue' } },
            { type: 'event', event: 'session.resync', payload: { sessionId: 'a', screen: 'screen-a' } }
        ]);
    });
});
