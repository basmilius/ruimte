import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus, ServerFrame } from '@ruimte/contracts';
import { Dispatcher, type ClientConnection } from '../dispatcher.ts';
import { registerActivityHandlers } from '../handlers/activity.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { NodeActivityStore } from './node-activity.ts';

const PLACES: Record<string, string> = { alpha: 'atlas', bravo: 'atlas', charlie: 'atlas' };

let home: string;
let time: number;
let events: SessionEvent[];

function open(): NodeActivityStore {
    const store = new NodeActivityStore({
        path: join(home, 'node-activity.json'),
        now: () => time,
        locate: (nodeId) => (PLACES[nodeId] === undefined ? null : { projectId: PLACES[nodeId] })
    });
    store.subscribe('client-1', (event) => events.push(event));

    return store;
}

function chatInfo(chatId: string, status: AgentStatus): SessionEvent {
    return { event: 'chat.event', payload: { chatId, seq: 1, event: { type: 'info', info: { status } } } } as unknown as SessionEvent;
}

function atOf(store: NodeActivityStore, nodeId: string): number | undefined {
    return store.list().find((entry) => entry.nodeId === nodeId)?.at;
}

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-node-activity-'));
    time = 1_000;
    events = [];
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('NodeActivityStore', () => {
    test('a project seen for the first time has all its nodes start at once, a later node starts later', () => {
        const store = open();
        store.places('atlas', new Set(['alpha', 'bravo']));
        time = 2_000;
        store.places('atlas', new Set(['alpha', 'bravo', 'charlie']));

        expect(atOf(store, 'alpha')).toBe(1_000);
        expect(atOf(store, 'bravo')).toBe(1_000);
        expect(atOf(store, 'charlie')).toBe(2_000);
        expect(events.at(-1)).toEqual({ event: 'activity.changed', payload: { activity: [{ projectId: 'atlas', nodeId: 'charlie', at: 2_000 }] } });
    });

    test('a node that leaves its project takes its activity along', () => {
        const store = open();
        store.places('atlas', new Set(['alpha', 'bravo']));
        store.places('atlas', new Set(['alpha']));

        expect(store.list().map((entry) => entry.nodeId)).toEqual(['alpha']);
    });

    test('a touch dates the node, and a node in no project here is refused', () => {
        const store = open();
        time = 5_000;

        expect(store.touch('bravo')).toBe(true);
        expect(store.touch('elsewhere')).toBe(false);
        expect(atOf(store, 'bravo')).toBe(5_000);
    });

    test('starting, waiting and finishing a turn date a node, and idle after idle does not', () => {
        const store = open();
        const dates: (number | undefined)[] = [];

        for (const [at, status] of [
            [10, 'idle'],
            [20, 'running'],
            [30, 'needs-you'],
            [40, 'running'],
            [50, 'idle'],
            [60, 'idle']
        ] as const) {
            time = at;
            store.consume(chatInfo('alpha', status));
            dates.push(atOf(store, 'alpha'));
        }

        expect(dates).toEqual([undefined, 20, 30, 40, 50, 50]);
    });

    test('the first status after a start dates a node only when it asks for something', () => {
        const store = open();
        store.consume(chatInfo('alpha', 'error'));
        store.consume(chatInfo('bravo', 'needs-you'));

        expect(atOf(store, 'alpha')).toBeUndefined();
        expect(atOf(store, 'bravo')).toBe(1_000);
    });

    test('what it knew survives a restart', () => {
        open().touch('alpha');
        time = 9_000;

        expect(atOf(open(), 'alpha')).toBe(1_000);
    });
});

describe('the activity requests', () => {
    const request = (type: string, payload: unknown = {}): string => JSON.stringify({ id: type, type, payload });

    test('touch a node, list every node and refuse a node in no project', async () => {
        const dispatcher = new Dispatcher();
        registerActivityHandlers(dispatcher, open());
        const frames: ServerFrame[] = [];
        const client: ClientConnection = { id: 'client-1', send: (frame) => frames.push(frame) };

        await dispatcher.handle(client, request('activity.touch', { nodeId: 'alpha' }));
        expect(frames.at(-1)).toMatchObject({ ok: true });
        await dispatcher.handle(client, request('activity.list'));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { activity: [{ projectId: 'atlas', nodeId: 'alpha', at: 1_000 }] } });
        await dispatcher.handle(client, request('activity.touch', { nodeId: 'elsewhere' }));
        expect(frames.at(-1)).toMatchObject({ ok: false, error: { code: 'node-not-found' } });
    });
});
