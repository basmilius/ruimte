import { describe, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { SessionSink } from '../state/sessions';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';
import { SessionClient } from './session-client';

type Call = { type: RequestType; payload: unknown };

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    readonly calls: Call[] = [];
    readonly existing = new Set<string>();
    readonly exited = new Map<string, number>();
    screen = 'screen';
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
    private readonly eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.calls.push({ type, payload });
        if (this.status !== 'open') {
            return Promise.reject(new TransportError('not-connected', 'offline'));
        }
        const id = (payload as { sessionId?: string }).sessionId ?? '';
        switch (type) {
            case 'session.create':
                if (this.existing.has(id)) {
                    return Promise.reject(new TransportError('session-exists', 'exists'));
                }
                this.existing.add(id);
                return Promise.resolve({
                    sessionId: id,
                    cwd: '/',
                    pid: 1,
                    cols: 80,
                    rows: 24,
                    createdAt: 0,
                    attached: 0,
                    exited: false
                } as RequestMap[T]['result']);
            case 'session.attach':
                return Promise.resolve({ screen: this.screen, cols: 80, rows: 24, exited: this.exited.has(id) } as RequestMap[T]['result']);
            case 'session.list':
                return Promise.resolve({
                    sessions: [...this.exited].map(([sessionId, exitCode]) => ({
                        sessionId,
                        cwd: '/',
                        pid: 1,
                        cols: 80,
                        rows: 24,
                        createdAt: 0,
                        attached: 0,
                        exited: true,
                        exitCode
                    }))
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

class FakeSink implements SessionSink {
    readonly attached = new Map<string, boolean>();
    readonly exited = new Map<string, number | undefined>();
    readonly forgotten: string[] = [];

    setAttached(nodeId: string, attached: boolean): void {
        this.attached.set(nodeId, attached);
    }

    setExited(nodeId: string, exitCode: number | undefined): void {
        this.exited.set(nodeId, exitCode);
    }

    forget(nodeId: string): void {
        this.forgotten.push(nodeId);
    }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setup = () => {
    const transport = new FakeTransport();
    const sink = new FakeSink();
    const client = new SessionClient(transport, sink);
    return { transport, sink, client };
};

describe('SessionClient', () => {
    test('ensure treats session-exists as success', async () => {
        const { transport, client } = setup();
        transport.existing.add('a');
        await client.ensure('a', undefined, 80, 24);
        expect(transport.of('session.create')).toHaveLength(1);
    });

    test('open creates, attaches and reports the screen', async () => {
        const { transport, sink, client } = setup();
        const result = await client.open('a', '/tmp', 100, 30);
        expect(result?.screen).toBe('screen');
        expect(transport.of('session.create')[0]?.payload).toEqual({ sessionId: 'a', cwd: '/tmp', cols: 100, rows: 30 });
        expect(transport.of('session.attach')[0]?.payload).toEqual({ sessionId: 'a', cols: 100, rows: 30 });
        expect(sink.attached.get('a')).toBe(true);
    });

    test('output and exit events reach only the handlers of their node', () => {
        const { transport, sink, client } = setup();
        const seenA: string[] = [];
        const seenB: string[] = [];
        const exits: number[] = [];
        client.onOutput('a', (data) => seenA.push(data));
        client.onOutput('b', (data) => seenB.push(data));
        client.onExit('a', (code) => exits.push(code));

        transport.emit('session.output', { sessionId: 'a', data: 'hello' });
        transport.emit('session.exit', { sessionId: 'a', exitCode: 3 });
        transport.emit('session.exit', { sessionId: 'b', exitCode: 1 });

        expect(seenA).toEqual(['hello']);
        expect(seenB).toEqual([]);
        expect(exits).toEqual([3]);
        expect(sink.exited.get('a')).toBe(3);
    });

    test('unsubscribing stops the fan-out', () => {
        const { transport, client } = setup();
        const seen: string[] = [];
        const off = client.onOutput('a', (data) => seen.push(data));
        off();
        transport.emit('session.output', { sessionId: 'a', data: 'x' });
        expect(seen).toEqual([]);
    });

    test('a reconnect re-attaches every mounted session and hands out the new screen', async () => {
        const { transport, sink, client } = setup();
        const screens: string[] = [];
        client.onScreen('a', (result) => screens.push(result.screen));
        await client.open('a', '/x', 80, 24);
        await client.open('b', undefined, 80, 24);
        await client.detach('b');
        client.resize('a', 120, 40);

        transport.setStatus('closed');
        expect(sink.attached.get('a')).toBe(false);

        transport.calls.length = 0;
        transport.screen = 'after';
        transport.setStatus('open');
        await flush();

        expect(transport.of('session.create').map((c) => c.payload)).toEqual([{ sessionId: 'a', cwd: '/x', cols: 120, rows: 40 }]);
        expect(transport.of('session.attach').map((c) => c.payload)).toEqual([{ sessionId: 'a', cols: 120, rows: 40 }]);
        expect(screens).toEqual(['after']);
        expect(sink.attached.get('a')).toBe(true);
    });

    test('a node opened while offline attaches once the transport opens', async () => {
        const { transport, client } = setup();
        transport.setStatus('closed');
        const screens: string[] = [];
        client.onScreen('a', (result) => screens.push(result.screen));

        const result = await client.open('a', undefined, 80, 24);
        expect(result).toBeNull();
        expect(client.isMounted('a')).toBe(true);

        transport.setStatus('open');
        await flush();
        expect(screens).toEqual(['screen']);
    });

    test('a detached node is not brought back by a reconnect', async () => {
        const { transport, client } = setup();
        await client.open('a', undefined, 80, 24);
        await client.detach('a');
        expect(transport.of('session.detach')).toHaveLength(1);

        transport.setStatus('closed');
        transport.calls.length = 0;
        transport.setStatus('open');
        await flush();
        expect(transport.calls).toEqual([]);
    });

    test('attaching an exited session records its exit code from the list', async () => {
        const { transport, sink, client } = setup();
        transport.existing.add('a');
        transport.exited.set('a', 130);
        await client.open('a', undefined, 80, 24);
        expect(sink.exited.get('a')).toBe(130);
    });

    test('kill forgets the session and its state', async () => {
        const { transport, sink, client } = setup();
        await client.open('a', undefined, 80, 24);
        await client.kill('a');
        expect(client.isMounted('a')).toBe(false);
        expect(sink.forgotten).toEqual(['a']);
        expect(transport.of('session.kill')).toHaveLength(1);
    });

    test('open rethrows errors that are not about the connection', async () => {
        const { transport, client } = setup();
        transport.request = () => Promise.reject(new TransportError('spawn-failed', 'no shell'));
        await expect(client.open('a', undefined, 80, 24)).rejects.toMatchObject({ code: 'spawn-failed' });
    });
});
