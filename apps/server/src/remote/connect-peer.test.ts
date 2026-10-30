import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutboxWorker, type OutboxHandlers } from '@adecore/agents/coordination';
import { ManualClock } from '@adecore/agents/testing';
import { OutboxStore, type ConnectPeerEntry, type OutboxWork } from '../outbox/outbox.ts';
import { refusingHandlers } from '../outbox/outbox-test-helpers.ts';
import { RemoteLinkError } from './remote-connections.ts';
import {
    ConnectPeer,
    PEERS_PROJECT,
    RECONNECT_LIFETIME_MS,
    RECONNECT_MAX_MS,
    RECONNECT_START_MS,
    machineOwed,
    peerTarget,
    restartConnectPeers
} from './connect-peer.ts';

const MACHINE = 'machine-b';

/* The link to a machine as the reconnect sees it: it is down until a test brings it up. */
class FakeConnections {
    up = false;
    refuse = false;
    known = true;
    open = false;
    attempts = 0;
    readonly standing: string[] = [];

    async connect(): Promise<never> {
        this.attempts += 1;
        if (this.refuse) {
            throw new RemoteLinkError('refused', 'The machine closed the attempt: not-paired');
        }
        if (!this.up) {
            throw new Error('The machine did not answer');
        }
        this.open = true;
        return undefined as never;
    }

    isOpen(): boolean {
        return this.open;
    }

    knows(): boolean {
        return this.known;
    }

    idle(machineId: string): void {
        this.standing.push(`idle:${machineId}`);
    }

    waiting(machineId: string, nextAttemptAt: number): void {
        this.standing.push(`waiting:${machineId}:${nextAttemptAt}`);
    }
}

let home: string;
let clock: ManualClock;
let outbox: OutboxStore;
let worker: OutboxWorker<OutboxWork>;
let connections: FakeConnections;
let reconnect: ConnectPeer;
let owed: string[];
let woken: string[];
let gaveUp: string[];
let random: number;

function handlersWith(connectPeer: (entry: ConnectPeerEntry) => Promise<void>): OutboxHandlers<OutboxWork> {
    return refusingHandlers({ 'connect-peer': connectPeer });
}

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-connect-peer-'));
    clock = new ManualClock();
    outbox = new OutboxStore(home);
    await outbox.load();
    connections = new FakeConnections();
    owed = ['chat-1'];
    woken = [];
    gaveUp = [];
    random = 0.5;
    reconnect = new ConnectPeer({
        outbox,
        owedTargets: () => owed,
        enqueue: (projectId, target, work, notBefore) => worker.enqueue(projectId, target, work, notBefore),
        wake: (target) => woken.push(target),
        giveUp: async (machineId, refusal) => void gaveUp.push(refusal === undefined ? machineId : `${machineId}: ${refusal}`),
        connections,
        now: () => clock.now(),
        random: () => random
    });
    worker = new OutboxWorker({ store: outbox, clock, handlers: handlersWith(reconnect.handler) });
    worker.start();
});

afterEach(async () => {
    worker.stop();
    await rm(home, { recursive: true, force: true });
});

function connectEntries(): ConnectPeerEntry[] {
    return outbox.list().filter((entry): entry is ConnectPeerEntry => entry.kind === 'connect-peer');
}

async function advance(ms: number): Promise<void> {
    clock.advance(ms);
    await worker.settled();
}

describe('the reconnect of a link to another machine', () => {
    test('is owed once, under the machine, and tried at once', async () => {
        await reconnect.owe(MACHINE);
        await reconnect.owe(MACHINE);
        await worker.settled();
        expect(connections.attempts).toBe(1);
        const [entry, ...rest] = connectEntries();
        expect(rest).toEqual([]);
        expect(entry).toMatchObject({
            projectId: PEERS_PROJECT,
            target: peerTarget(MACHINE),
            payload: { machineId: MACHINE, interval: RECONNECT_START_MS * 2 }
        });
    });

    test('is not owed while nothing waits on the machine', async () => {
        owed = [];
        await reconnect.owe(MACHINE);
        await worker.settled();
        expect(connectEntries()).toEqual([]);
        expect(connections.attempts).toBe(0);
    });

    test('waits a minute after the first failure and doubles that up to ten minutes', async () => {
        await reconnect.owe(MACHINE);
        await worker.settled();
        const waits: number[] = [];
        for (let attempt = 0; attempt < 7; attempt += 1) {
            const entry = connectEntries()[0]!;
            waits.push(entry.notBefore - clock.now());
            await advance(entry.notBefore - clock.now());
        }
        expect(waits).toEqual([60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000]);
        expect(connections.attempts).toBe(8);
        expect(RECONNECT_MAX_MS).toBe(600_000);
    });

    test('spreads each wait by a tenth either way, and says when the next try is', async () => {
        random = 0;
        await reconnect.owe(MACHINE);
        await worker.settled();
        const first = connectEntries()[0]!;
        expect(first.notBefore - clock.now()).toBe(54_000);
        expect(connections.standing.at(-1)).toBe(`waiting:${MACHINE}:${first.notBefore}`);
        random = 1;
        await advance(54_000);
        expect(connectEntries()[0]!.notBefore - clock.now()).toBe(132_000);
    });

    test('ends and wakes the work for that machine once the link opens', async () => {
        owed = ['chat-1', 'chat-1', 'chat-2'];
        await reconnect.owe(MACHINE);
        await worker.settled();
        connections.up = true;
        await advance(60_000);
        expect(connectEntries()).toEqual([]);
        expect(woken.toSorted()).toEqual(['chat-1', 'chat-2']);
    });

    test('ends when nothing is owed to the machine any more, without trying again', async () => {
        await reconnect.owe(MACHINE);
        await worker.settled();
        owed = [];
        await advance(60_000);
        expect(connectEntries()).toEqual([]);
        expect(connections.attempts).toBe(1);
        expect(connections.standing.at(-1)).toBe(`idle:${MACHINE}`);
    });

    test('ends when a person unlinks the machine or stops the work', async () => {
        await reconnect.owe(MACHINE);
        await worker.settled();
        await reconnect.lapse(MACHINE, (id) => outbox.remove(id));
        expect(connectEntries()).toEqual([]);
        await advance(RECONNECT_MAX_MS);
        expect(connections.attempts).toBe(1);

        await reconnect.owe(MACHINE);
        await worker.settled();
        connections.known = false;
        await advance(60_000);
        expect(connectEntries()).toEqual([]);
    });

    test('ends for every machine when the machine leaves its account', async () => {
        await reconnect.owe(MACHINE);
        await reconnect.owe('machine-c');
        await worker.settled();
        expect(connectEntries()).toHaveLength(2);
        await reconnect.lapseAll((id) => outbox.remove(id));
        expect(connectEntries()).toEqual([]);
    });

    test('fails what is owed once the 7 days are over, and work that comes after gets a window of its own', async () => {
        await reconnect.owe(MACHINE);
        await worker.settled();
        const since = clock.now();
        // One jump to the last attempt inside the window: walking the 7 days takes a thousand rounds on disk, which outlast a test's timeout under load.
        await advance(RECONNECT_LIFETIME_MS - 1);
        expect(gaveUp).toEqual([]);
        expect(connectEntries()).toHaveLength(1);
        await advance(connectEntries()[0]!.notBefore - clock.now());
        expect(gaveUp).toEqual([MACHINE]);
        expect(connectEntries()).toEqual([]);
        expect(clock.now() - since).toBeGreaterThanOrEqual(RECONNECT_LIFETIME_MS);
        expect(clock.now() - since).toBeLessThan(RECONNECT_LIFETIME_MS + RECONNECT_MAX_MS + 1);
        expect(connections.standing.at(-1)).toBe(`idle:${MACHINE}`);

        await reconnect.owe(MACHINE);
        await worker.settled();
        expect(connectEntries()[0]!.payload.since).toBe(clock.now());
        expect(gaveUp).toEqual([MACHINE]);
    });

    test('owes nothing for a link that is open, and owes again when the link was lost during an attempt', async () => {
        connections.open = true;
        await reconnect.owe(MACHINE);
        expect(connectEntries()).toEqual([]);

        connections.open = false;
        connections.up = true;
        const gate = Promise.withResolvers<void>();
        const opens = connections.connect.bind(connections);
        connections.connect = async () => {
            await gate.promise;
            const link = await opens();
            // The link is lost the moment it opened, before the attempt has ended.
            connections.open = false;
            return link;
        };
        await reconnect.owe(MACHINE);
        await Promise.resolve();
        await reconnect.owe(MACHINE);
        gate.resolve();
        await worker.settled();
        expect(connections.attempts).toBe(2);
        expect(connectEntries()).toEqual([]);
    });

    test('starts the 7 days over once a link opened, however long ago the work was first owed', async () => {
        await reconnect.owe(MACHINE);
        await worker.settled();
        const since = connectEntries()[0]!.payload.since;
        connections.up = true;
        await advance(60_000);
        expect(connectEntries()).toEqual([]);
        // The link stays open for longer than the window, then is lost while the work is still owed.
        await advance(RECONNECT_LIFETIME_MS + 24 * 60 * 60 * 1000);
        connections.open = false;
        connections.up = false;
        await reconnect.owe(MACHINE);
        await worker.settled();
        expect(gaveUp).toEqual([]);
        expect(connectEntries()[0]!.payload.since).toBe(clock.now());
        expect(connectEntries()[0]!.payload.since).toBeGreaterThan(since);
    });

    test('counts afresh once nothing is owed any more', async () => {
        await reconnect.owe(MACHINE);
        await worker.settled();
        const since = connectEntries()[0]!.payload.since;
        owed = [];
        await advance(RECONNECT_MAX_MS);
        expect(connectEntries()).toEqual([]);
        owed = ['chat-1'];
        await reconnect.owe(MACHINE);
        await worker.settled();
        expect(connectEntries()[0]!.payload.since).toBeGreaterThan(since);
    });

    test('fails what is owed at a refusal that asking again will not change, and says why', async () => {
        connections.refuse = true;
        await reconnect.owe(MACHINE);
        await worker.settled();
        expect(connectEntries()).toEqual([]);
        expect(connections.attempts).toBe(1);
        expect(gaveUp).toEqual([`${MACHINE}: it does not know this machine, or no longer vouches for it`]);
        expect(connections.standing.at(-1)).toBe(`idle:${MACHINE}`);
        await advance(RECONNECT_MAX_MS);
        expect(connections.attempts).toBe(1);
    });

    test('is due at once after a restart, whatever delay an earlier run set', async () => {
        await reconnect.owe(MACHINE);
        await worker.settled();
        worker.stop();
        const entry = connectEntries()[0]!;
        expect(entry.notBefore).toBeGreaterThan(clock.now());

        const fresh = new OutboxStore(home);
        await fresh.load();
        await restartConnectPeers(fresh, clock.now());
        expect(fresh.list()[0]).toMatchObject({ id: entry.id, notBefore: clock.now(), attempts: 0 });
        const attempts = connections.attempts;
        const restarted = new OutboxWorker({ store: fresh, clock, handlers: handlersWith(reconnect.handler) });
        restarted.start();
        await restarted.settled();
        restarted.stop();
        expect(connections.attempts).toBe(attempts + 1);
    });

    test('survives a prune of the project ids and keeps its own lane beside the work it waits for', async () => {
        await reconnect.owe(MACHINE);
        await worker.settled();
        await outbox.prune('project-1', new Set());
        await outbox.prune(PEERS_PROJECT, new Set());
        expect(connectEntries()).toHaveLength(1);
        expect(outbox.lanesOf(connectEntries()[0]!)).toEqual([peerTarget(MACHINE)]);
    });
});

describe('the work owed to another machine', () => {
    test('is told by its kind and the machine in its payload', () => {
        expect(machineOwed({ kind: 'start-remote-agent', payload: { machineId: MACHINE } })).toBe(MACHINE);
        expect(machineOwed({ kind: 'deliver-remote-result', payload: { machineId: MACHINE } })).toBe(MACHINE);
        expect(machineOwed({ kind: 'stop-remote-agent', payload: { machineId: MACHINE } })).toBe(MACHINE);
        expect(machineOwed({ kind: 'start-agent', payload: { machineId: MACHINE } })).toBeNull();
        expect(machineOwed({ kind: 'start-remote-agent', payload: {} })).toBeNull();
    });
});
