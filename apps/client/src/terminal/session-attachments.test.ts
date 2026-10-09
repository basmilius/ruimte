import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { SessionSink } from '../state/sessions';
import { SessionClient } from './session-client';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';
import { makeHarness, type Harness } from '../../../server/src/sessions/test-helpers';

function gate() {
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    return {
        entered: entered.promise,
        release: () => released.resolve(),
        async wait() {
            entered.resolve();
            await released.promise;
        }
    };
}

type Gate = ReturnType<typeof gate>;

// Only request delivery is controlled; snapshots, output buffering and attachment ownership are the daemon's.
class SessionWire implements Transport {
    status: TransportStatus = 'open';
    readonly calls: RequestType[] = [];
    readonly before = new Map<RequestType, Gate>();
    readonly after = new Map<RequestType, Gate>();
    readonly failures = new Map<RequestType, Error>();
    private readonly handlers = new Map<string, Set<(payload: never) => void>>();
    private readonly statuses = new Set<(status: TransportStatus) => void>();
    readonly clientId = 'preview-person';

    private readonly harness: Harness;

    constructor(harness: Harness) {
        this.harness = harness;
        harness.manager.subscribe(this.clientId, ({ event, payload }) => {
            for (const handler of this.handlers.get(event) ?? []) {
                handler(payload as never);
            }
        });
    }

    async request<Type extends RequestType>(type: Type, payload: RequestMap[Type]['payload']): Promise<RequestMap[Type]['result']> {
        this.calls.push(type);
        const before = this.before.get(type);
        const after = this.after.get(type);
        this.before.delete(type);
        this.after.delete(type);
        if (before) {
            await before.wait();
        }
        if (this.status !== 'open') {
            throw new TransportError('disconnected', 'Disconnected');
        }
        const failure = this.failures.get(type);
        if (failure) {
            this.failures.delete(type);
            throw failure;
        }
        const result = await this.handle(type, payload);
        if (after) {
            await after.wait();
        }
        return result as RequestMap[Type]['result'];
    }

    private async handle(type: RequestType, payload: unknown): Promise<unknown> {
        const manager = this.harness.manager;
        const request = payload as { sessionId: string; follow?: boolean; cols?: number; rows?: number };
        switch (type) {
            case 'session.create':
                if (manager.get(request.sessionId)) {
                    throw new TransportError('session-exists', 'Existing session');
                }
                return manager.create({
                    sessionId: request.sessionId,
                    shell: '/bin/sh',
                    args: [],
                    cwd: this.harness.home,
                    cols: request.cols ?? 80,
                    rows: request.rows ?? 24
                });
            case 'session.attach':
                return manager.attach(request.sessionId, this.clientId, request.follow ? undefined : request.cols, request.follow ? undefined : request.rows);
            case 'session.detach':
                manager.detach(request.sessionId, this.clientId);
                return {};
            case 'session.list':
                return { sessions: manager.list() };
            default:
                return {};
        }
    }

    on<Event extends EventType>(event: Event, handler: (payload: EventMap[Event]) => void): () => void {
        const handlers = this.handlers.get(event) ?? new Set();
        this.handlers.set(event, handlers);
        handlers.add(handler as (payload: never) => void);
        return () => {
            handlers.delete(handler as (payload: never) => void);
        };
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statuses.add(handler);
        return () => {
            this.statuses.delete(handler);
        };
    }

    setStatus(status: TransportStatus): void {
        if (status !== 'open') {
            this.harness.manager.detachAll(this.clientId);
        }
        this.status = status;
        for (const handler of this.statuses) {
            handler(status);
        }
    }
}

let harness: Harness;
let wire: SessionWire;
let client: SessionClient;
let attached: boolean | undefined;

beforeEach(async () => {
    harness = await makeHarness();
    wire = new SessionWire(harness);
    attached = undefined;
    const sink: SessionSink = {
        setAttached(_id, value) {
            attached = value;
        },
        setExited() {},
        setAgent() {},
        setAccount() {},
        setHeldCommand() {},
        forget() {}
    };
    client = new SessionClient(wire, sink);
    await harness.manager.create({ sessionId: 'shell', shell: '/bin/sh', args: [], cwd: harness.home, cols: 80, rows: 24 });
});

afterEach(async () => {
    client.dispose();
    await harness.cleanup();
});

function expectAttached(value: boolean): void {
    expect(harness.manager.get('shell')!.isAttached(wire.clientId)).toBe(value);
    expect(attached).toBe(value);
}

function renderer() {
    const draws: string[] = [];
    const offOutput = client.onOutput('shell', (data) => draws.push(data));
    const offScreen = client.onScreen('shell', ({ screen }) => {
        draws.length = 0;
        draws.push(screen);
    });
    return {
        draws,
        async open() {
            const result = await client.open('shell', {}, 80, 24);
            if (result) {
                draws.push(result.screen);
            }
            return result;
        },
        async unmount() {
            offOutput();
            offScreen();
            await client.detach('shell');
        }
    };
}

test('a preview shares the visible renderer without swallowing its pending output into an unused snapshot', async () => {
    const view = renderer();
    await view.open();
    harness.adapter.forSession('shell').emit('BUFFERED-PREVIEW-OUTPUT\r\n');
    const first = await client.retain('shell');
    const second = await client.retain('shell');
    harness.manager.get('shell')!.flush();
    expect(await harness.manager.get('shell')!.plainText()).toContain('BUFFERED-PREVIEW-OUTPUT');
    expect(view.draws.join('').match(/BUFFERED-PREVIEW-OUTPUT/g)).toHaveLength(1);
    first();
    second();
    expectAttached(true);
    await view.unmount();
    expectAttached(false);
});

test('last follow transfers an acknowledged attachment to a pending remount, whose unmount releases it before create answers', async () => {
    const release = await client.retain('shell');
    const create = gate();
    wire.before.set('session.create', create);
    const view = renderer();
    const opened = view.open();
    await create.entered;
    release();
    expectAttached(true);
    await view.unmount();
    expectAttached(false);
    create.release();
    expect(await opened).toBeNull();
    expectAttached(false);
});

test('a preview shares a pending ordinary attach and leaves its snapshot with the renderer', async () => {
    const attach = gate();
    wire.before.set('session.attach', attach);
    const view = renderer();
    const opened = view.open();
    await attach.entered;
    harness.adapter.forSession('shell').emit('IN-THE-SNAPSHOT\r\n');
    const retained = client.retain('shell');
    attach.release();
    expect((await opened)?.screen).toContain('IN-THE-SNAPSHOT');
    const release = await retained;
    harness.adapter.forSession('shell').emit('AFTER-THE-SNAPSHOT\r\n');
    harness.manager.get('shell')!.flush();
    expect(view.draws.join('').match(/IN-THE-SNAPSHOT/g)).toHaveLength(1);
    expect(view.draws.join('').match(/AFTER-THE-SNAPSHOT/g)).toHaveLength(1);
    expect(wire.calls.filter((type) => type === 'session.attach')).toHaveLength(1);
    await view.unmount();
    expectAttached(true);
    release();
    expectAttached(false);
});

test('a hidden follow never creates, resizes or types, and a later renderer gets the current screen once', async () => {
    const count = wire.calls.length;
    const release = await client.retain('shell');
    expect(wire.calls.slice(count)).toEqual(['session.attach']);
    const pty = harness.adapter.forSession('shell');
    expect(pty.input).toEqual([]);
    expect(pty.resizes).toEqual([]);
    const create = gate();
    wire.before.set('session.create', create);
    const view = renderer();
    const opened = view.open();
    await create.entered;
    pty.emit('BEFORE-RENDERER-SNAPSHOT\r\n');
    harness.manager.get('shell')!.flush();
    create.release();
    await opened;
    pty.emit('AFTER-RENDERER-SNAPSHOT\r\n');
    harness.manager.get('shell')!.flush();
    expect(view.draws.join('').match(/BEFORE-RENDERER-SNAPSHOT/g)).toHaveLength(1);
    expect(view.draws.join('').match(/AFTER-RENDERER-SNAPSHOT/g)).toHaveLength(1);
    release();
    expectAttached(true);
    await view.unmount();
    expectAttached(false);
});

test('a renderer waits for an in-flight hidden follow before taking its own current screen', async () => {
    const follow = gate();
    wire.before.set('session.attach', follow);
    const retained = client.retain('shell');
    await follow.entered;
    const attach = gate();
    wire.before.set('session.attach', attach);
    const draws: string[] = [];
    client.onOutput('shell', (data) => draws.push(data));
    const opened = client.open('shell', { follow: true }, 80, 24);
    await Promise.resolve();
    expect(wire.calls.filter((type) => type === 'session.attach')).toHaveLength(1);
    follow.release();
    const release = await retained;
    await attach.entered;
    harness.adapter.forSession('shell').emit('DURING-FOLLOW\r\n');
    harness.manager.get('shell')!.flush();
    attach.release();
    const result = await opened;
    expect(result).not.toBeNull();
    draws.push(result!.screen);
    harness.adapter.forSession('shell').emit('AFTER-BOTH-ATTACHES\r\n');
    harness.manager.get('shell')!.flush();
    expect(draws.join('').match(/DURING-FOLLOW/g)).toHaveLength(1);
    expect(draws.join('').match(/AFTER-BOTH-ATTACHES/g)).toHaveLength(1);
    release();
    await client.detach('shell');
    expectAttached(false);
});

test('a failed remount releases the follow attachment when the last preview closes', async () => {
    const release = await client.retain('shell');
    wire.failures.set('session.create', new TransportError('spawn-failed', 'No shell'));
    await expect(client.open('shell', {}, 80, 24)).rejects.toMatchObject({ code: 'spawn-failed' });
    release();
    expectAttached(false);
});

test('a failed follow releases all holders and a later preview can attach normally', async () => {
    wire.failures.set('session.attach', new TransportError('session-missing', 'Missing shell'));
    await expect(Promise.all([client.retain('shell'), client.retain('shell')])).rejects.toMatchObject({ code: 'session-missing' });
    expectAttached(false);
    const release = await client.retain('shell');
    expectAttached(true);
    release();
    expectAttached(false);
});

test('dispose releases a follow attachment even while a remount waits for create', async () => {
    await client.retain('shell');
    const create = gate();
    wire.before.set('session.create', create);
    const opened = client.open('shell', {}, 80, 24);
    await create.entered;
    client.dispose();
    expectAttached(false);
    create.release();
    expect(await opened).toBeNull();
    expectAttached(false);
});

test('dispose cleans a follow whose acknowledgement arrives after disposal', async () => {
    const reply = gate();
    wire.after.set('session.attach', reply);
    const retained = client.retain('shell');
    await reply.entered;
    client.dispose();
    reply.release();
    await expect(retained).rejects.toMatchObject({ code: 'disconnected' });
    expectAttached(false);
});

test('a disconnect invalidates preview holders, and their late releases cannot detach a new connection', async () => {
    const releaseOld = await client.retain('shell');
    wire.setStatus('closed');
    expectAttached(false);
    wire.setStatus('open');
    const releaseNew = await client.retain('shell');
    expectAttached(true);
    releaseOld();
    expectAttached(true);
    releaseNew();
    expectAttached(false);
});

test('an old follow acknowledgement cannot resurrect or detach the new connection attachment', async () => {
    const reply = gate();
    wire.after.set('session.attach', reply);
    const old = client.retain('shell');
    await reply.entered;
    wire.setStatus('closed');
    wire.setStatus('open');
    const current = client.retain('shell');
    reply.release();
    await expect(old).rejects.toMatchObject({ code: 'disconnected' });
    const releaseNew = await current;
    expectAttached(true);
    releaseNew();
    expectAttached(false);
});

test('ordinary output, resync and reconnect still reach a renderer after its preview closes', async () => {
    const view = renderer();
    await view.open();
    const release = await client.retain('shell');
    release();
    harness.adapter.forSession('shell').emit('BEFORE-CLEAR\r\n');
    harness.manager.get('shell')!.flush();
    await harness.manager.clear('shell');
    expect(view.draws.join('')).not.toContain('BEFORE-CLEAR');
    wire.setStatus('closed');
    expectAttached(false);
    harness.adapter.forSession('shell').emit('WHILE-DISCONNECTED\r\n');
    const screen = Promise.withResolvers<void>();
    client.onScreen('shell', () => screen.resolve());
    wire.setStatus('open');
    await screen.promise;
    expect(view.draws.join('')).toContain('WHILE-DISCONNECTED');
    expectAttached(true);
    await view.unmount();
    expectAttached(false);
});

test('a pending ordinary attach transfers to a preview after unmount, then detaches on the last release', async () => {
    const reply = gate();
    wire.after.set('session.attach', reply);
    const opened = client.open('shell', {}, 80, 24);
    await reply.entered;
    await client.detach('shell');
    const retained = client.retain('shell');
    reply.release();
    expect(await opened).toBeNull();
    const release = await retained;
    expectAttached(true);
    release();
    expectAttached(false);
});

test('a pending ordinary attach with no remaining owner detaches when its late acknowledgement lands', async () => {
    const reply = gate();
    wire.after.set('session.attach', reply);
    const opened = client.open('shell', {}, 80, 24);
    await reply.entered;
    await client.detach('shell');
    reply.release();
    expect(await opened).toBeNull();
    expectAttached(false);
});

test('a failed ordinary attach releases both the pending renderer and preview ownership', async () => {
    const attach = gate();
    wire.before.set('session.attach', attach);
    wire.failures.set('session.attach', new TransportError('session-missing', 'Missing shell'));
    const opened = client.open('shell', {}, 80, 24);
    await attach.entered;
    const retained = client.retain('shell');
    attach.release();
    const results = await Promise.allSettled([opened, retained]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expectAttached(false);
    expect(client.isMounted('shell')).toBe(false);
});

test('a failed snapshot for a remount does not leak a previously acknowledged follow attachment', async () => {
    const release = await client.retain('shell');
    wire.failures.set('session.attach', new TransportError('snapshot-failed', 'Snapshot failed'));
    await expect(client.open('shell', {}, 80, 24)).rejects.toMatchObject({ code: 'snapshot-failed' });
    expectAttached(true);
    release();
    expectAttached(false);
});

test('an old renderer acknowledgement after reconnect cannot repaint or detach the current renderer', async () => {
    const reply = gate();
    wire.after.set('session.attach', reply);
    const opened = client.open('shell', {}, 80, 24);
    await reply.entered;
    wire.setStatus('closed');
    expectAttached(false);
    harness.adapter.forSession('shell').emit('NEW-CONNECTION-SCREEN\r\n');
    const screen = Promise.withResolvers<string>();
    client.onScreen('shell', ({ screen: value }) => screen.resolve(value));
    wire.setStatus('open');
    expect(await screen.promise).toContain('NEW-CONNECTION-SCREEN');
    reply.release();
    expect(await opened).toBeNull();
    expectAttached(true);
    await client.detach('shell');
    expectAttached(false);
});
