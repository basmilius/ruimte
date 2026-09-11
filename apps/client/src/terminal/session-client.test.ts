import { describe, expect, test } from 'bun:test';
import type { AgentInfo, EventMap, EventType, RequestMap, RequestType, SessionInfo } from '@ruimte/contracts';
import type { SessionSink } from '../state/sessions';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';
import { SessionClient } from './session-client';

type Call = { type: RequestType; payload: unknown };

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    readonly calls: Call[] = [];
    readonly existing = new Set<string>();
    readonly exited = new Map<string, number>();
    readonly agents = new Map<string, AgentInfo>();
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
            case 'session.list': {
                const ids = new Set([...this.exited.keys(), ...this.agents.keys()]);
                const sessions: SessionInfo[] = [...ids].map((sessionId) => ({
                    sessionId,
                    cwd: '/',
                    pid: 1,
                    cols: 80,
                    rows: 24,
                    createdAt: 0,
                    attached: 0,
                    exited: this.exited.has(sessionId),
                    exitCode: this.exited.get(sessionId),
                    agent: this.agents.get(sessionId) ?? null
                }));
                return Promise.resolve({ sessions } as RequestMap[T]['result']);
            }
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
    readonly agents = new Map<string, AgentInfo | null>();
    readonly forgotten: string[] = [];

    setAttached(nodeId: string, attached: boolean): void {
        this.attached.set(nodeId, attached);
    }

    setExited(nodeId: string, exitCode: number | undefined): void {
        this.exited.set(nodeId, exitCode);
    }

    setAgent(nodeId: string, agent: AgentInfo | null): void {
        this.agents.set(nodeId, agent);
    }

    forget(nodeId: string): void {
        this.forgotten.push(nodeId);
    }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const setup = () => {
    const transport = new FakeTransport();
    const sink = new FakeSink();
    let endpointId = 'daemon-a';
    const client = new SessionClient(transport, sink, () => endpointId);
    return {
        transport,
        sink,
        client,
        moveTo: (id: string): void => {
            endpointId = id;
        }
    };
};

describe('SessionClient', () => {
    test('ensure treats session-exists as success', async () => {
        const { transport, client } = setup();
        transport.existing.add('a');
        await client.ensure('a', {}, 80, 24);
        expect(transport.of('session.create')).toHaveLength(1);
    });

    test('open creates, attaches and reports the screen', async () => {
        const { transport, sink, client } = setup();
        const result = await client.open('a', { cwd: '/tmp', command: 'ls' }, 100, 30);
        expect(result?.screen).toBe('screen');
        expect(transport.of('session.create')[0]?.payload).toEqual({ sessionId: 'a', cwd: '/tmp', command: 'ls', cols: 100, rows: 30 });
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
        await client.open('a', { cwd: '/x' }, 80, 24);
        await client.open('b', {}, 80, 24);
        await client.detach('b');
        client.resize('a', 120, 40);

        transport.setStatus('closed');
        expect(sink.attached.get('a')).toBe(false);

        transport.calls.length = 0;
        transport.screen = 'after';
        transport.setStatus('open');
        await flush();

        expect(transport.of('session.create').map((c) => c.payload)).toEqual([{ sessionId: 'a', cwd: '/x', command: undefined, cols: 120, rows: 40 }]);
        expect(transport.of('session.attach').map((c) => c.payload)).toEqual([{ sessionId: 'a', cols: 120, rows: 40 }]);
        expect(screens).toEqual(['after']);
        expect(sink.attached.get('a')).toBe(true);
    });

    test('a node opened while offline attaches once the transport opens', async () => {
        const { transport, client } = setup();
        transport.setStatus('closed');
        const screens: string[] = [];
        client.onScreen('a', (result) => screens.push(result.screen));

        const result = await client.open('a', {}, 80, 24);
        expect(result).toBeNull();
        expect(client.isMounted('a')).toBe(true);

        transport.setStatus('open');
        await flush();
        expect(screens).toEqual(['screen']);
    });

    test('a socket that comes back pointed at another daemon leaves the first machine alone', async () => {
        const { transport, client, moveTo } = setup();
        await client.open('a', { cwd: '/x' }, 80, 24);

        transport.setStatus('closed');
        transport.calls.length = 0;
        moveTo('daemon-b');
        transport.setStatus('open');
        await flush();

        // Creating it here would be a second shell, on a machine the node was never on.
        expect(transport.calls).toEqual([]);
        expect(client.isMounted('a')).toBe(false);
    });

    test('a detached node is not brought back by a reconnect', async () => {
        const { transport, client } = setup();
        await client.open('a', {}, 80, 24);
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
        await client.open('a', {}, 80, 24);
        expect(sink.exited.get('a')).toBe(130);
    });

    test('kill forgets the session and its state', async () => {
        const { transport, sink, client } = setup();
        await client.open('a', {}, 80, 24);
        await client.kill('a');
        expect(client.isMounted('a')).toBe(false);
        expect(sink.forgotten).toEqual(['a']);
        expect(transport.of('session.kill')).toHaveLength(1);
    });

    test('a status event and the list entry both feed the agent of a node', async () => {
        const { transport, sink, client } = setup();
        const agent: AgentInfo = { kind: 'claude', agentSessionId: 'abc', transcriptPath: null, status: 'running', live: true, updatedAt: 1 };
        transport.existing.add('a');
        transport.agents.set('a', agent);
        await client.open('a', {}, 80, 24);
        expect(sink.agents.get('a')).toEqual(agent);
        expect(transport.of('agent.resume')).toHaveLength(0);

        transport.emit('session.status', { sessionId: 'a', agent: { ...agent, status: 'needs-you' } });
        expect(sink.agents.get('a')?.status).toBe('needs-you');
        transport.emit('session.status', { sessionId: 'a', agent: null });
        expect(sink.agents.get('a')).toBeNull();
    });

    test('an agent the daemon remembers but no longer runs is resumed once', async () => {
        const { transport, client } = setup();
        transport.agents.set('a', { kind: 'claude', agentSessionId: 'abc', transcriptPath: null, status: 'idle', live: false, updatedAt: 1 });
        await client.open('a', {}, 80, 24);
        expect(transport.of('agent.resume').map((c) => c.payload)).toEqual([{ sessionId: 'a' }]);

        transport.setStatus('closed');
        transport.setStatus('open');
        await flush();
        expect(transport.of('agent.resume')).toHaveLength(1);
    });

    test('open rethrows errors that are not about the connection', async () => {
        const { transport, client } = setup();
        transport.request = () => Promise.reject(new TransportError('spawn-failed', 'no shell'));
        await expect(client.open('a', {}, 80, 24)).rejects.toMatchObject({ code: 'spawn-failed' });
    });
});
