import { describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { HIGH_WATER_MARK, LOW_WATER_MARK, OutputGate, type BackpressuredSocket } from './backpressure.ts';

class FakeSocket implements BackpressuredSocket {
    readonly frames: ServerFrame[] = [];
    buffered = 0;
    // What the next send answers: 0 dropped, -1 queued under backpressure, else bytes sent.
    status = 1;

    send(data: string): number {
        this.frames.push(JSON.parse(data) as ServerFrame);
        return this.status;
    }

    getBufferedAmount(): number {
        return this.buffered;
    }

    of(event: string): Array<Record<string, unknown>> {
        return this.frames
            .filter((frame): frame is Extract<ServerFrame, { type: 'event' }> => 'event' in frame && frame.event === event)
            .map((frame) => frame.payload as Record<string, unknown>);
    }

    get events(): string[] {
        return this.frames.map((frame) => ('event' in frame ? frame.event : 'reply'));
    }
}

const output = (sessionId: string, data: string): ServerFrame => ({ type: 'event', event: 'session.output', payload: { sessionId, data } });
const browserFrame = (sequence: number): ServerFrame => ({
    type: 'event',
    event: 'browser.frame',
    payload: { browserId: 'browser-1', sequence, width: 800, height: 600, data: 'jpeg' }
});

const setup = (screens: Record<string, string | null> = { a: 'screen-a', b: 'screen-b' }) => {
    const socket = new FakeSocket();
    const gate = new OutputGate({ socket, screenOf: async (sessionId) => screens[sessionId] ?? null });
    return { socket, gate, screens };
};

// The gate resyncs across an await; one macrotask is enough for its whole loop.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('OutputGate', () => {
    test('output flows while the socket keeps up', () => {
        const { socket, gate } = setup();
        gate.send(output('a', 'one'));
        gate.send(output('a', 'two'));
        expect(socket.of('session.output').map((payload) => payload.data)).toEqual(['one', 'two']);
    });

    test('output stops above the high-water mark and the sessions that lost it are marked', () => {
        const { socket, gate } = setup();
        socket.buffered = HIGH_WATER_MARK + 1;
        gate.send(output('a', 'the frame that filled the queue'));
        gate.send(output('a', 'dropped'));
        gate.send(output('b', 'dropped too'));

        expect(socket.of('session.output').map((payload) => payload.data)).toEqual(['the frame that filled the queue']);
        expect(gate.staleSessions().sort()).toEqual(['a', 'b']);
    });

    test('a send that answers -1 pauses output but keeps that frame', () => {
        const { socket, gate } = setup();
        socket.status = -1;
        gate.send(output('a', 'queued'));
        socket.status = 1;
        gate.send(output('a', 'dropped'));

        expect(socket.of('session.output').map((payload) => payload.data)).toEqual(['queued']);
        expect(gate.staleSessions()).toEqual(['a']);
    });

    test('a dropped frame marks its session even without a full queue', () => {
        const { socket, gate } = setup();
        socket.status = 0;
        gate.send(output('a', 'gone'));
        expect(gate.staleSessions()).toEqual(['a']);
    });

    test('replies and other events keep flowing while output is paused', () => {
        const { socket, gate } = setup();
        socket.buffered = HIGH_WATER_MARK + 1;
        gate.send(output('a', 'first'));
        gate.send(output('a', 'dropped'));
        gate.send({ id: 'r1', ok: true, result: {} });
        gate.send({ type: 'event', event: 'session.exit', payload: { sessionId: 'a', exitCode: 0 } });

        expect(socket.events).toEqual(['session.output', 'reply', 'session.exit']);
    });

    test('browser frames are dropped while the client is behind and resume after drain', async () => {
        const { socket, gate } = setup();
        socket.buffered = HIGH_WATER_MARK + 1;
        gate.send(browserFrame(1));
        gate.send(browserFrame(2));
        expect(socket.of('browser.frame')).toEqual([]);

        socket.buffered = 0;
        gate.onDrain();
        await flush();
        gate.send(browserFrame(3));
        expect(socket.of('browser.frame').map((payload) => payload.sequence)).toEqual([3]);
    });

    test('a drain sends one resync per marked session and then streams again', async () => {
        const { socket, gate } = setup();
        socket.buffered = HIGH_WATER_MARK + 1;
        gate.send(output('a', 'first'));
        gate.send(output('a', 'dropped'));
        gate.send(output('b', 'dropped'));
        gate.send(output('b', 'dropped again'));

        socket.buffered = 0;
        gate.onDrain();
        await flush();

        expect(socket.of('session.resync')).toEqual([
            { sessionId: 'a', screen: 'screen-a' },
            { sessionId: 'b', screen: 'screen-b' }
        ]);
        expect(gate.staleSessions()).toEqual([]);

        gate.send(output('a', 'after'));
        expect(socket.events).toEqual(['session.output', 'session.resync', 'session.resync', 'session.output']);
    });

    test('output for a marked session waits for its screen, output for another session does not', async () => {
        const { socket, gate } = setup();
        socket.buffered = HIGH_WATER_MARK + 1;
        gate.send(output('a', 'first'));
        gate.send(output('a', 'dropped'));

        socket.buffered = 0;
        gate.onDrain();
        // Still inside the resync: `a` has no screen yet, `b` never lost a byte.
        gate.send(output('a', 'too early'));
        gate.send(output('b', 'unaffected'));
        await flush();

        expect(socket.events).toEqual(['session.output', 'session.output', 'session.resync']);
        expect(socket.of('session.output').map((payload) => payload.data)).toEqual(['first', 'unaffected']);
    });

    test('a drain while the queue is still over the low-water mark changes nothing', async () => {
        const { socket, gate } = setup();
        socket.buffered = HIGH_WATER_MARK + 1;
        gate.send(output('a', 'first'));
        gate.send(output('a', 'dropped'));

        socket.buffered = LOW_WATER_MARK + 1;
        gate.onDrain();
        await flush();

        expect(socket.of('session.resync')).toEqual([]);
        expect(gate.staleSessions()).toEqual(['a']);
    });

    test('a session that is gone loses its mark without a resync', async () => {
        const { socket, gate } = setup({ a: null, b: 'screen-b' });
        socket.buffered = HIGH_WATER_MARK + 1;
        gate.send(output('a', 'first'));
        gate.send(output('a', 'dropped'));
        gate.send(output('b', 'dropped'));

        socket.buffered = 0;
        gate.onDrain();
        await flush();

        expect(socket.of('session.resync')).toEqual([{ sessionId: 'b', screen: 'screen-b' }]);
        expect(gate.staleSessions()).toEqual([]);
    });

    test('a resync that fills the queue again leaves the rest for the next drain', async () => {
        const { socket, gate } = setup();
        socket.buffered = HIGH_WATER_MARK + 1;
        gate.send(output('a', 'first'));
        gate.send(output('a', 'dropped'));
        gate.send(output('b', 'dropped'));

        socket.buffered = 0;
        gate.onDrain();
        socket.buffered = HIGH_WATER_MARK + 1;
        await flush();

        expect(socket.of('session.resync')).toEqual([{ sessionId: 'a', screen: 'screen-a' }]);
        expect(gate.staleSessions()).toEqual(['b']);

        socket.buffered = 0;
        gate.onDrain();
        await flush();

        expect(socket.of('session.resync')).toEqual([
            { sessionId: 'a', screen: 'screen-a' },
            { sessionId: 'b', screen: 'screen-b' }
        ]);
    });
});
