import { describe, expect, test } from 'bun:test';
import { decodeLiveFrame, type EventMap, type LiveFrame, type ServerFrame } from '@ruimte/contracts';
import type { LiveSink } from './client-sinks.ts';
import { HIGH_WATER_MARK } from './backpressure.ts';
import { connectionOpener, type ClientChannel, type ConnectionServices } from './connection.ts';
import { Dispatcher } from './dispatcher.ts';
import type { SessionEvent, SessionSink } from './sessions/manager.ts';

class FakeChannel implements ClientChannel {
    readonly frames: ServerFrame[] = [];
    readonly binary: Uint8Array[] = [];
    buffered = 0;
    closedWith: { code: number; reason: string } | null = null;
    private readonly closeListeners: Array<() => void> = [];
    private readonly drainListeners: Array<() => void> = [];

    send(data: string | Uint8Array): number {
        if (typeof data !== 'string') {
            this.binary.push(data);
            return data.byteLength;
        }
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

const NAMES = ['sessions', 'chats', 'identity', 'projects', 'drawings', 'diagrams', 'folders', 'statuses', 'usage', 'limits', 'processes'] as const;

function setup(screens: Record<string, string> = {}, presence?: ConnectionServices['presence']) {
    const order: string[] = [];
    const sources = Object.fromEntries(NAMES.map((name) => [name, new FakeSource(name, order)])) as Record<(typeof NAMES)[number], FakeSource>;
    const dispatcher = new Dispatcher();
    dispatcher.register('server.hello', () => ({ version: '1.2.3', platform: 'test', home: '/tmp/home' }));
    const sessions = Object.assign(sources.sessions, {
        get: (sessionId: string) =>
            sessionId in screens
                ? {
                      isAttached: () => true,
                      snapshotFor: (_clientId: string, onScreen: (screen: string) => void) => queueMicrotask(() => onScreen(screens[sessionId] as string))
                  }
                : undefined
    });
    const services: ConnectionServices = { ...sources, sessions, dispatcher, presence };
    return { open: connectionOpener(services), sources, order };
}

// The dispatcher answers across an await; one macrotask settles it.
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

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

    test('subscribes a peer to nothing, so another machine hears no event of what happens here', () => {
        const { open, sources, order } = setup();
        const channel = new FakeChannel();
        const connection = open(channel, { reachability: 'lan', sessionId: 'peer-1', peer: { machineId: 'machine-a' } });

        expect(order).toEqual([]);
        sources.processes.emit(connection.client.id, { event: 'processes.alerts', payload: { alerts: [] } } as unknown as SessionEvent);
        expect(channel.frames).toEqual([]);
    });

    test('tells the tasks of another machine when its channel closes, and nothing when any other channel does', () => {
        const closed: string[] = [];
        const order: string[] = [];
        const sources = Object.fromEntries(NAMES.map((name) => [name, new FakeSource(name, order)])) as Record<(typeof NAMES)[number], FakeSource>;
        const sessions = Object.assign(sources.sessions, { get: () => undefined });
        const open = connectionOpener({
            ...sources,
            sessions,
            dispatcher: new Dispatcher(),
            peerTasks: { channelClosed: (clientId) => void closed.push(clientId) }
        });
        const peerChannel = new FakeChannel();
        const peer = open(peerChannel, { reachability: 'lan', sessionId: 'peer-1', peer: { machineId: 'machine-a' } });
        const personChannel = new FakeChannel();
        open(personChannel, { reachability: 'loopback', sessionId: null });
        personChannel.fireClose();
        expect(closed).toEqual([]);
        peerChannel.fireClose();
        peerChannel.fireClose();
        expect(closed).toEqual([peer.client.id]);
    });

    test("ends the Voice sessions of a person's channel when it closes, once", () => {
        const ended: string[] = [];
        const order: string[] = [];
        const sources = Object.fromEntries(NAMES.map((name) => [name, new FakeSource(name, order)])) as Record<(typeof NAMES)[number], FakeSource>;
        const sessions = Object.assign(sources.sessions, { get: () => undefined });
        const open = connectionOpener({
            ...sources,
            sessions,
            dispatcher: new Dispatcher(),
            voice: { channelClosed: (clientId) => void ended.push(clientId) }
        });
        const personChannel = new FakeChannel();
        const person = open(personChannel, { reachability: 'loopback', sessionId: null });
        const peerChannel = new FakeChannel();
        open(peerChannel, { reachability: 'lan', sessionId: 'peer-1', peer: { machineId: 'machine-a' } });
        peerChannel.fireClose();
        expect(ended).toEqual([]);
        personChannel.fireClose();
        personChannel.fireClose();
        expect(ended).toEqual([person.client.id]);
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

    test('sends a live frame from a device as one binary frame, and its JSON twin as an event', () => {
        const { sources } = setup();
        let deviceSink: LiveSink | null = null;
        const devices = {
            subscribe: (_clientId: string, sink: LiveSink) => {
                deviceSink = sink;
                return () => undefined;
            },
            detachAll: () => undefined,
            requestKeyFrame: () => undefined
        };
        const channel = new FakeChannel();
        connectionOpener({ ...sources, sessions: Object.assign(sources.sessions, { get: () => undefined }), dispatcher: new Dispatcher(), devices })(channel, {
            reachability: 'loopback',
            sessionId: null
        });
        const header = { deviceId: 'phone-1', backendId: 'simctl', platform: 'ios' as const, sequence: 1, width: 2, height: 3 };
        const live: LiveFrame = { event: 'device.frame', payload: header, bytes: new Uint8Array([9]) };

        deviceSink!(live);
        deviceSink!({ event: 'device.frame', payload: { ...header, sequence: 2, data: 'CQ==' } });

        expect(channel.binary.map((frame) => decodeLiveFrame(frame))).toEqual([live]);
        expect(channel.frames).toEqual([{ type: 'event', event: 'device.frame', payload: { ...header, sequence: 2, data: 'CQ==' } }]);
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

    test('releases the database sessions of a client once when its channel closes', () => {
        const released: string[] = [];
        const order: string[] = [];
        const sources = Object.fromEntries(NAMES.map((name) => [name, new FakeSource(name, order)])) as Record<(typeof NAMES)[number], FakeSource>;
        const open = connectionOpener({
            ...sources,
            sessions: Object.assign(sources.sessions, { get: () => undefined }),
            dispatcher: new Dispatcher(),
            databases: {
                release: async (clientId) => {
                    released.push(clientId);
                }
            }
        });
        const channel = new FakeChannel();
        open(channel, { reachability: 'loopback', sessionId: null });

        channel.fireClose();
        channel.fireClose();

        expect(released).toEqual(['client-1']);
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

test('requested notifications travel over the connection and unsubscribe on close', () => {
    const listeners = new Set<(alert: EventMap['push.notification']) => void>();
    const { open } = setup(
        {},
        {
            connected: () => () => undefined,
            observeNotification: (listener) => {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            }
        }
    );
    const channel = new FakeChannel();
    open(channel, { reachability: 'loopback', sessionId: null });
    const payload = { projectId: 'project', viewId: 'main', nodeId: 'node', title: 'Build', body: 'Ready' };
    for (const listener of listeners) {
        listener(payload);
    }
    expect(channel.frames).toEqual([{ type: 'event', event: 'push.notification', payload }]);
    channel.fireClose();
    expect(listeners.size).toBe(0);
});
