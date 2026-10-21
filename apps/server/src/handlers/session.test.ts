import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { makeHarness, Recorder, type Harness } from '../sessions/test-helpers.ts';
import { registerSessionHandlers } from './session.ts';

let harness: Harness;
let dispatcher: Dispatcher;

beforeEach(async () => {
    harness = await makeHarness();
    dispatcher = new Dispatcher();
    registerSessionHandlers(dispatcher, harness.manager);
    await harness.manager.create({ sessionId: 'terminal', cols: 120, rows: 40, shell: '/bin/sh', args: [], cwd: harness.home });
});

afterEach(async () => {
    await harness.cleanup();
});

async function request(clientId: string, type: string, payload: unknown): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];
    await dispatcher.handle({ id: clientId, send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
    return frames[0]!;
}

describe('following a shared terminal', () => {
    test('a phone follows the desktop dimensions and receives the same output', async () => {
        const desktop = new Recorder();
        const phone = new Recorder();
        harness.manager.subscribe('desktop', desktop.sink());
        harness.manager.subscribe('phone', phone.sink());
        await request('desktop', 'session.attach', { sessionId: 'terminal', cols: 120, rows: 40 });
        const response = await request('phone', 'session.attach', { sessionId: 'terminal', follow: true, cols: 40, rows: 15 });
        expect(response).toMatchObject({ ok: true, result: { cols: 120, rows: 40, exited: false } });
        const pty = harness.adapter.forSession('terminal');
        expect(pty.resizes).toEqual([]);
        pty.emit('same output');
        harness.manager.get('terminal')!.flush();
        expect(desktop.output).toBe('same output');
        expect(phone.output).toBe(desktop.output);
        expect(harness.manager.list()[0]?.attached).toBe(2);
    });

    test('follow accepts no dimensions, preserves scrollback and reports the latest desktop size', async () => {
        const pty = harness.adapter.forSession('terminal');
        pty.emit('before the phone');
        const response = await request('phone', 'session.attach', { sessionId: 'terminal', follow: true });
        expect(response).toMatchObject({ ok: true, result: { screen: expect.stringContaining('before the phone'), cols: 120, rows: 40 } });
        const phone = new Recorder();
        harness.manager.subscribe('phone', phone.sink());
        await request('desktop', 'session.resize', { sessionId: 'terminal', cols: 100, rows: 30 });
        expect(phone.events).toContainEqual({ event: 'session.list-changed', payload: {} });
        expect(harness.manager.list()[0]).toMatchObject({ cols: 100, rows: 30 });
        expect(pty.resizes).toEqual([{ cols: 100, rows: 30 }]);
        const reattached = await request('phone', 'session.attach', { sessionId: 'terminal', follow: true });
        expect(reattached).toMatchObject({ ok: true, result: { cols: 100, rows: 30 } });
        expect(pty.resizes).toEqual([{ cols: 100, rows: 30 }]);
    });

    test('legacy attach still resizes and repeated same-size resize emits no notification', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('desktop', recorder.sink());
        expect(await request('desktop', 'session.attach', { sessionId: 'terminal', cols: 80, rows: 24 })).toMatchObject({
            ok: true,
            result: { cols: 80, rows: 24 }
        });
        const count = recorder.events.length;
        await request('desktop', 'session.resize', { sessionId: 'terminal', cols: 80, rows: 24 });
        expect(recorder.events.length).toBe(count);
        expect(harness.adapter.forSession('terminal').resizes).toEqual([{ cols: 80, rows: 24 }]);
    });

    test.each([
        {},
        { follow: false },
        { follow: true, cols: 40 },
        { follow: true, rows: 15 },
        { cols: 40 },
        { rows: 15 },
        { follow: true, cols: 0, rows: 15 },
        { follow: true, cols: 40, rows: 1.5 }
    ])('rejects missing or invalid paired dimensions %j', async (dimensions) => {
        expect(await request('phone', 'session.attach', { sessionId: 'terminal', ...dimensions })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
        expect(harness.manager.list()[0]?.attached).toBe(0);
        expect(harness.adapter.forSession('terminal').resizes).toEqual([]);
    });
});

describe('a login for a client that goes', () => {
    test('leaves no login shell behind when the client closed while it started', async () => {
        const logins = new Dispatcher();
        registerSessionHandlers(logins, harness.manager, undefined, { commandOf: () => 'claude /login', nameOf: () => 'Claude Code' });
        const frames: ServerFrame[] = [];
        const client = { id: 'phone', closed: false, send: (frame: ServerFrame) => frames.push(frame) };

        const payload = { sessionId: 'login-1', kind: 'claude', cols: 80, rows: 24 };
        const handled = logins.handle(client, JSON.stringify({ id: 'login', type: 'session.login', payload }));
        // The socket goes while the shell is still being set up, and its own cleanup runs at once.
        client.closed = true;
        harness.manager.detachAll('phone');
        await handled;

        expect(harness.manager.get('login-1')).toBeUndefined();
    });
});

describe('a shell that ends with its client', () => {
    test('ends when its client leaves, and leaves every other shell running', async () => {
        const created = await request('desktop', 'session.create', { sessionId: 'provider-1', cols: 80, rows: 24, shell: '/bin/sh', endsWithClient: true });
        expect(created).toMatchObject({ ok: true });
        expect(harness.manager.labelOf('provider-1')).toBe('Shell');

        harness.manager.detachAll('phone');
        expect(harness.manager.get('provider-1')?.exited).toBe(false);
        harness.manager.detachAll('desktop');
        await harness.adapter.forSession('provider-1').exited;
        expect(harness.manager.get('provider-1')).toBeUndefined();
        expect(harness.manager.get('terminal')).toBeDefined();
    });

    test('is none when its client closed while it started', async () => {
        const frames: ServerFrame[] = [];
        const client = { id: 'desktop', closed: false, send: (frame: ServerFrame) => frames.push(frame) };
        const payload = { sessionId: 'provider-2', cols: 80, rows: 24, shell: '/bin/sh', endsWithClient: true };
        const handled = dispatcher.handle(client, JSON.stringify({ id: 'create', type: 'session.create', payload }));
        client.closed = true;
        harness.manager.detachAll('desktop');
        await handled;

        expect(harness.manager.get('provider-2')).toBeUndefined();
    });

    test('carries no command past an approval', async () => {
        const refused = await request('desktop', 'session.create', {
            sessionId: 'provider-3',
            cols: 80,
            rows: 24,
            command: 'make deploy',
            endsWithClient: true
        });
        expect(refused).toMatchObject({ ok: false, error: { code: 'client-shell-command' } });
        expect(harness.manager.get('provider-3')).toBeUndefined();
    });
});

describe('a node that runs on another machine', () => {
    async function ask(type: string, payload: unknown): Promise<ServerFrame> {
        const guarded = new Dispatcher();
        registerSessionHandlers(guarded, harness.manager, undefined, undefined, (nodeId) => (nodeId === 'remote' ? 'machine-b' : null));
        const frames: ServerFrame[] = [];
        await guarded.handle({ id: 'client', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
        return frames[0]!;
    }

    test('gets no shell here, and nothing to attach to', async () => {
        const spawned = harness.adapter.spawned.length;
        expect(await ask('session.create', { sessionId: 'remote', cols: 80, rows: 24, shell: '/bin/sh' })).toMatchObject({
            ok: false,
            error: { code: 'node-on-other-machine' }
        });
        expect(await ask('session.attach', { sessionId: 'remote', cols: 80, rows: 24 })).toMatchObject({ ok: false, error: { code: 'node-on-other-machine' } });
        expect(harness.adapter.spawned).toHaveLength(spawned);
    });

    test('leaves every other node alone', async () => {
        expect(await ask('session.attach', { sessionId: 'terminal', cols: 80, rows: 24 })).toMatchObject({ ok: true });
    });
});
