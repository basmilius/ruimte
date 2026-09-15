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

const request = async (clientId: string, type: string, payload: unknown): Promise<ServerFrame> => {
    const frames: ServerFrame[] = [];
    await dispatcher.handle({ id: clientId, send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
    return frames[0]!;
};

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
