import { describe, expect, test } from 'bun:test';
import { CodedError } from '@adecore/agents';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from './dispatcher.ts';
import { sendEvent, type ClientConnection } from './wire.ts';

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

function makeDispatcher(): Dispatcher {
    const dispatcher = new Dispatcher();
    dispatcher.register('server.hello', () => ({ version: '1.2.3', platform: 'test', home: '/tmp/home' }));
    return dispatcher;
}

describe('Dispatcher', () => {
    test('tells its observers when a request starts and when it was answered', async () => {
        const heard: string[] = [];
        const dispatcher = makeDispatcher();
        dispatcher.observe({
            started: (type) => heard.push(`started ${type}`),
            answered: (type, _ms, counts) => heard.push(`answered ${type} ${JSON.stringify(counts)}`)
        });
        await dispatcher.handle(new FakeSocket(), JSON.stringify({ id: 'r1', type: 'server.hello', payload: {} }));
        expect(heard).toEqual(['started server.hello', 'answered server.hello []']);
    });

    test('hands the observers what a request registered to count, from its payload when that decides', async () => {
        const heard: string[] = [];
        const dispatcher = new Dispatcher();
        dispatcher.register('server.hello', () => ({ version: '1', platform: 'test', home: '/tmp/home' }), { count: ['actions.device'] });
        dispatcher.register('fs.read', () => ({ text: 'x' }) as never, {
            count: (payload) => [{ counter: 'files.opened', once: payload.path }]
        });
        dispatcher.observe({ answered: (type, _ms, counts) => heard.push(`${type} ${JSON.stringify(counts)}`) });
        await dispatcher.handle(new FakeSocket(), JSON.stringify({ id: 'r1', type: 'server.hello', payload: {} }));
        await dispatcher.handle(new FakeSocket(), JSON.stringify({ id: 'r2', type: 'fs.read', payload: { path: '/work/a.ts' } }));
        expect(heard).toEqual(['server.hello ["actions.device"]', 'fs.read [{"counter":"files.opened","once":"/work/a.ts"}]']);
    });

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

    test('maps a CodedError to its code and anything else to internal', async () => {
        const socket = new FakeSocket();
        const dispatcher = new Dispatcher();
        dispatcher.register('session.kill', () => {
            throw new CodedError('session-not-found', 'No such session');
        });
        dispatcher.register('session.detach', () => {
            throw new TypeError('boom');
        });
        await dispatcher.handle(socket, JSON.stringify({ id: 'r7', type: 'session.kill', payload: { sessionId: 'n1' } }));
        expect(socket.last()).toEqual({ id: 'r7', ok: false, error: { code: 'session-not-found', message: 'No such session' } });
        await dispatcher.handle(socket, JSON.stringify({ id: 'r8', type: 'session.detach', payload: { sessionId: 'n1' } }));
        expect(socket.last()).toEqual({ id: 'r8', ok: false, error: { code: 'internal', message: 'Request failed' } });
    });

    test('maps a coded error of any domain, thrown or rejected, to its code', async () => {
        class DomainError extends CodedError<'domain-refused'> {}
        const socket = new FakeSocket();
        const dispatcher = new Dispatcher();
        dispatcher.register('session.kill', () => {
            throw new DomainError('domain-refused', 'Refused at once');
        });
        dispatcher.register('session.detach', () => Promise.reject(new DomainError('domain-refused', 'Refused later')));
        await dispatcher.handle(socket, JSON.stringify({ id: 'r9', type: 'session.kill', payload: { sessionId: 'n1' } }));
        expect(socket.last()).toEqual({ id: 'r9', ok: false, error: { code: 'domain-refused', message: 'Refused at once' } });
        await dispatcher.handle(socket, JSON.stringify({ id: 'r10', type: 'session.detach', payload: { sessionId: 'n1' } }));
        expect(socket.last()).toEqual({ id: 'r10', ok: false, error: { code: 'domain-refused', message: 'Refused later' } });
    });

    test('refuses an owner-only request from a client that did not present the local secret, before its handler runs', async () => {
        let runs = 0;
        const dispatcher = new Dispatcher();
        dispatcher.register(
            'endpoint.leaveAccount',
            () => {
                runs += 1;
                return { revoked: 0 };
            },
            { owner: true }
        );
        const frame = JSON.stringify({ id: 'r11', type: 'endpoint.leaveAccount', payload: {} });

        const guest = Object.assign(new FakeSocket(), { access: { reachability: 'tunnel' as const, sessionId: 'session-1' } });
        await dispatcher.handle(guest, frame);
        expect(guest.last()).toMatchObject({ id: 'r11', ok: false, error: { code: 'forbidden' } });
        const unknown = new FakeSocket();
        await dispatcher.handle(unknown, frame);
        expect(unknown.last()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(runs).toBe(0);

        const owner = Object.assign(new FakeSocket(), { access: { reachability: 'loopback' as const, sessionId: null } });
        await dispatcher.handle(owner, frame);
        expect(owner.last()).toEqual({ id: 'r11', ok: true, result: { revoked: 0 } });
        expect(runs).toBe(1);
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

describe('Dispatcher and a peer', () => {
    const PEER = { reachability: 'lan', sessionId: 'peer-session', peer: { machineId: 'machine-a' } } as const;

    class PeerSocket extends FakeSocket {
        readonly access = PEER;
    }

    function listed(): Dispatcher {
        const dispatcher = new Dispatcher();
        dispatcher.register('server.hello', () => ({ version: '1', platform: 'test', home: '/home' }));
        dispatcher.register('server.ping', () => ({ time: 1 }), { peer: true });
        return dispatcher;
    }

    test('answers a request on the peer list and refuses every other as forbidden before its handler runs', async () => {
        const dispatcher = listed();
        let ran = 0;
        dispatcher.register('fs.read', () => {
            ran += 1;
            return {} as never;
        });
        const socket = new PeerSocket();

        await dispatcher.handle(socket, JSON.stringify({ id: 'r1', type: 'server.ping', payload: {} }));
        expect(socket.last()).toMatchObject({ id: 'r1', ok: true });
        for (const type of ['server.hello', 'fs.read', 'session.create', 'auth.revoke', 'endpoint.signRegistration', 'not-a-request']) {
            await dispatcher.handle(socket, JSON.stringify({ id: type, type, payload: {} }));
            expect(socket.last()).toMatchObject({ id: type, ok: false, error: { code: 'forbidden' } });
        }
        expect(ran).toBe(0);
    });

    test('keeps a request registered later closed to a peer, and opens it only when it is added on purpose', async () => {
        const dispatcher = new Dispatcher();
        dispatcher.register('server.ping', () => ({ time: 1 }), { peer: true });
        dispatcher.register('server.hello', () => ({ version: '1', platform: 'test', home: '/home' }));
        const socket = new PeerSocket();
        await dispatcher.handle(socket, JSON.stringify({ id: 'r1', type: 'server.hello', payload: {} }));
        expect(socket.last()).toMatchObject({ ok: false, error: { code: 'forbidden' } });

        const opened = new Dispatcher();
        opened.register('server.hello', () => ({ version: '1', platform: 'test', home: '/home' }), { peer: true });
        await opened.handle(socket, JSON.stringify({ id: 'r2', type: 'server.hello', payload: {} }));
        expect(socket.last()).toMatchObject({ id: 'r2', ok: true });
    });

    test('refuses a peer on every owner-only request, and refuses to register one that is both', async () => {
        const dispatcher = listed();
        dispatcher.register('endpoint.leaveAccount', () => ({ revoked: 0 }), { owner: true });
        const socket = new PeerSocket();
        await dispatcher.handle(socket, JSON.stringify({ id: 'r1', type: 'endpoint.leaveAccount', payload: {} }));
        expect(socket.last()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(() => dispatcher.register('endpoint.signRegistration', () => ({}) as never, { owner: true, peer: true })).toThrow(/owner-only/);
        expect(dispatcher.has('endpoint.signRegistration')).toBe(false);
    });

    test('lists the peer requests apart from the rest', () => {
        const dispatcher = listed();
        expect(dispatcher.peerTypes()).toEqual(['server.ping']);
        expect(dispatcher.types()).toEqual(['server.hello', 'server.ping']);
    });

    test('leaves a client that is no peer alone', async () => {
        const dispatcher = listed();
        const socket = new FakeSocket();
        await dispatcher.handle(socket, JSON.stringify({ id: 'r1', type: 'server.hello', payload: {} }));
        expect(socket.last()).toMatchObject({ ok: true });
    });
});
