import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@ruimte/agents/outbox/manual-clock';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher, type ClientConnection } from '../dispatcher.ts';
import { registerSnoozeHandlers } from '../handlers/snooze.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { MAX_WAIT_MS, SnoozeStore, type SnoozeChange } from './snoozes.ts';

let home: string;
let clock: ManualClock;
let store: SnoozeStore;
let events: SessionEvent[];
let changes: SnoozeChange[];

const open = (): SnoozeStore => {
    const opened = new SnoozeStore({ path: join(home, 'snoozes.json'), clock });
    opened.subscribe('client-1', (event) => events.push(event));
    opened.observe((change) => changes.push(change));
    return opened;
};

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-snoozes-'));
    clock = new ManualClock();
    events = [];
    changes = [];
    store = open();
});

afterEach(async () => {
    store.stop();
    await rm(home, { recursive: true, force: true });
});

describe('a snooze on the machine', () => {
    test('holds until its moment, then ends and wakes its node', () => {
        store.set('project-1', 'node-1', clock.now() + 30_000);
        expect(store.isSnoozed('node-1')).toBe(true);
        expect(changes).toEqual([{ kind: 'snoozed', nodeId: 'node-1' }]);
        clock.advance(29_999);
        expect(store.isSnoozed('node-1')).toBe(true);
        clock.advance(1);
        expect(store.isSnoozed('node-1')).toBe(false);
        expect(store.list()).toEqual([]);
        expect(changes.at(-1)).toEqual({ kind: 'woke', nodeId: 'node-1' });
        expect(events.at(-1)).toEqual({ event: 'snooze.changed', payload: { snoozes: [] } });
    });

    test('reads the clock again at least once a minute, so a machine that slept ends it late by no more than that', () => {
        store.set('project-1', 'node-1', clock.now() + 10 * MAX_WAIT_MS);
        // Only the timer of the first minute fires, but the clock has moved past the snooze by then.
        clock.advance(11 * MAX_WAIT_MS);
        expect(store.list()).toEqual([]);
    });

    test('tells every client what it holds whenever it changes', () => {
        const until = clock.now() + 60_000;
        store.set('project-1', 'node-1', until);
        expect(events).toEqual([{ event: 'snooze.changed', payload: { snoozes: [{ projectId: 'project-1', nodeId: 'node-1', until }] } }]);
    });

    test('a person ending it wakes the node', () => {
        store.set('project-1', 'node-1', clock.now() + 60_000);
        store.clear('node-1');
        expect(store.list()).toEqual([]);
        expect(changes.at(-1)).toEqual({ kind: 'woke', nodeId: 'node-1' });
    });

    test('a moment already past ends it like clearing does', () => {
        store.set('project-1', 'node-1', clock.now() + 60_000);
        store.set('project-1', 'node-1', clock.now());
        expect(store.list()).toEqual([]);
    });

    test('setting it again moves the moment and is no new snooze', () => {
        store.set('project-1', 'node-1', clock.now() + 60_000);
        store.set('project-1', 'node-1', clock.now() + 120_000);
        expect(store.list()).toEqual([{ projectId: 'project-1', nodeId: 'node-1', until: clock.now() + 120_000 }]);
        expect(changes).toEqual([{ kind: 'snoozed', nodeId: 'node-1' }]);
    });

    test('survives a restart, and what ran out meanwhile is gone without waking anything', async () => {
        store.set('project-1', 'node-1', clock.now() + 60_000);
        store.set('project-1', 'node-2', clock.now() + 600_000);
        store.stop();
        clock.advance(120_000);
        changes = [];
        store = open();
        expect(store.list().map((entry) => entry.nodeId)).toEqual(['node-2']);
        expect(changes).toEqual([]);
        expect(JSON.parse(await readFile(join(home, 'snoozes.json'), 'utf8')).snoozes).toHaveLength(1);
    });

    test('a file that will not read starts empty', async () => {
        store.stop();
        await writeFile(join(home, 'snoozes.json'), '{nope');
        store = open();
        expect(store.list()).toEqual([]);
    });
});

describe('a snooze that ends early', () => {
    beforeEach(() => {
        store.set('project-1', 'node-1', clock.now() + 60_000);
        changes = [];
    });

    test('ends without waking once its node was seen waiting and then stops', () => {
        store.noteStatus('node-1', true);
        store.noteStatus('node-1', false);
        expect(store.list()).toEqual([]);
        expect(changes).toEqual([]);
    });

    test('stays while its node was never seen waiting, as after a restart', () => {
        store.noteStatus('node-1', false);
        expect(store.isSnoozed('node-1')).toBe(true);
    });

    test('goes with its node when the node leaves the project', () => {
        store.set('project-2', 'node-2', clock.now() + 60_000);
        store.places('project-1', new Set(['node-3']));
        expect(store.list().map((entry) => entry.nodeId)).toEqual(['node-2']);
        expect(changes.some((change) => change.kind === 'woke')).toBe(false);
    });

    test('stays while its project still places it', () => {
        store.places('project-1', new Set(['node-1']));
        expect(store.isSnoozed('node-1')).toBe(true);
    });
});

describe('the snooze requests', () => {
    const request = (type: string, payload: unknown = {}): string => JSON.stringify({ id: type, type, payload });

    test('set one against the project its node is in, list them and clear one', async () => {
        const dispatcher = new Dispatcher();
        registerSnoozeHandlers(dispatcher, store, (nodeId) => (nodeId === 'node-1' ? { projectId: 'project-1' } : null));
        const frames: ServerFrame[] = [];
        const client: ClientConnection = { id: 'client-1', send: (frame) => frames.push(frame) };
        const until = clock.now() + 60_000;

        await dispatcher.handle(client, request('snooze.set', { nodeId: 'node-1', until }));
        expect(frames.at(-1)).toMatchObject({ ok: true });
        await dispatcher.handle(client, request('snooze.list'));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { snoozes: [{ projectId: 'project-1', nodeId: 'node-1', until }] } });
        await dispatcher.handle(client, request('snooze.set', { nodeId: 'node-9', until }));
        expect(frames.at(-1)).toMatchObject({ ok: false, error: { code: 'node-not-found' } });
        await dispatcher.handle(client, request('snooze.clear', { nodeId: 'node-1' }));
        expect(store.list()).toEqual([]);
    });
});
