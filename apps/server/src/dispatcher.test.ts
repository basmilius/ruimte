import { describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher, RequestError, sendEvent, type ClientConnection } from './dispatcher.ts';

class FakeSocket implements ClientConnection {
    readonly id = 'client-1';
    readonly frames: ServerFrame[] = [];

    send(frame: ServerFrame): void {
        this.frames.push(frame);
    }

    last(): ServerFrame {
        const frame = this.frames.at(-1);
        if (!frame) {
            throw new Error('Nothing was sent');
        }
        return frame;
    }
}

const makeDispatcher = (): Dispatcher => {
    const dispatcher = new Dispatcher();
    dispatcher.register('server.hello', () => ({ version: '1.2.3', platform: 'test', home: '/tmp/home' }));
    return dispatcher;
};

describe('Dispatcher', () => {
    test('answers a known request with ok and the result', async () => {
        const socket = new FakeSocket();
        await makeDispatcher().handle(socket, JSON.stringify({ id: 'r1', type: 'server.hello', payload: {} }));
        expect(socket.last()).toEqual({ id: 'r1', ok: true, result: { version: '1.2.3', platform: 'test', home: '/tmp/home' } });
    });

    test('accepts a binary frame', async () => {
        const socket = new FakeSocket();
        await makeDispatcher().handle(socket, new TextEncoder().encode(JSON.stringify({ id: 'r2', type: 'server.hello', payload: {} })));
        expect(socket.last()).toMatchObject({ id: 'r2', ok: true });
    });

    test('replies unknown-request for a type without a handler', async () => {
        const socket = new FakeSocket();
        await makeDispatcher().handle(socket, JSON.stringify({ id: 'r3', type: 'session.list', payload: {} }));
        expect(socket.last()).toEqual({ id: 'r3', ok: false, error: { code: 'unknown-request', message: 'Unknown request type: session.list' } });
    });

    test('replies unknown-request for a type the contracts do not know', async () => {
        const socket = new FakeSocket();
        await makeDispatcher().handle(socket, JSON.stringify({ id: 'r4', type: 'nope', payload: {} }));
        expect(socket.last()).toMatchObject({ id: 'r4', ok: false, error: { code: 'unknown-request' } });
    });

    test('replies bad-request with a null id for invalid JSON', async () => {
        const socket = new FakeSocket();
        await makeDispatcher().handle(socket, '{not json');
        expect(socket.last()).toMatchObject({ id: null, ok: false, error: { code: 'bad-request' } });
    });

    test('replies bad-request and keeps the id when only the envelope is wrong', async () => {
        const socket = new FakeSocket();
        await makeDispatcher().handle(socket, JSON.stringify({ id: 'r5', payload: {} }));
        expect(socket.last()).toMatchObject({ id: 'r5', ok: false, error: { code: 'bad-request' } });
    });

    test('replies bad-request with a null id when the id is unusable', async () => {
        const socket = new FakeSocket();
        await makeDispatcher().handle(socket, JSON.stringify({ id: 7, type: 'server.hello', payload: {} }));
        expect(socket.last()).toMatchObject({ id: null, ok: false, error: { code: 'bad-request' } });
    });

    test('replies bad-request when the payload fails the schema of its type', async () => {
        const socket = new FakeSocket();
        const dispatcher = makeDispatcher();
        dispatcher.register('session.write', () => ({}));
        await dispatcher.handle(socket, JSON.stringify({ id: 'r6', type: 'session.write', payload: { sessionId: 'n1' } }));
        expect(socket.last()).toMatchObject({ id: 'r6', ok: false, error: { code: 'bad-request' } });
    });

    test('maps a RequestError to its code and anything else to internal', async () => {
        const socket = new FakeSocket();
        const dispatcher = new Dispatcher();
        dispatcher.register('session.kill', () => {
            throw new RequestError('session-not-found', 'No such session');
        });
        dispatcher.register('session.detach', () => {
            throw new TypeError('boom');
        });
        await dispatcher.handle(socket, JSON.stringify({ id: 'r7', type: 'session.kill', payload: { sessionId: 'n1' } }));
        expect(socket.last()).toEqual({ id: 'r7', ok: false, error: { code: 'session-not-found', message: 'No such session' } });
        await dispatcher.handle(socket, JSON.stringify({ id: 'r8', type: 'session.detach', payload: { sessionId: 'n1' } }));
        expect(socket.last()).toEqual({ id: 'r8', ok: false, error: { code: 'internal', message: 'Request failed' } });
    });

    test('refuses a second handler for the same type', () => {
        const dispatcher = makeDispatcher();
        expect(() => dispatcher.register('server.hello', () => ({ version: '', platform: '', home: '' }))).toThrow('already registered');
    });

    test('sendEvent wraps a payload in the event envelope', () => {
        const socket = new FakeSocket();
        sendEvent(socket, 'session.exit', { sessionId: 'n1', exitCode: 0 });
        expect(socket.last()).toEqual({ type: 'event', event: 'session.exit', payload: { sessionId: 'n1', exitCode: 0 } });
    });
});
