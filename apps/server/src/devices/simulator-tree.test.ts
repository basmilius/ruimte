import { beforeEach, describe, expect, test } from 'bun:test';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import { BRIDGE_TREE_MS, SimulatorTreeReader, TREE_REPLY_MS, type TreeChild, type TreeChildEvents } from './simulator-tree.ts';

/* A bridge process a test speaks for: what it was sent, and whether it was told to end or killed. */
class FakeChild implements TreeChild {
    readonly written: string[] = [];
    ended = false;
    killed = false;
    readonly events: TreeChildEvents;

    constructor(events: TreeChildEvents) {
        this.events = events;
    }

    write(line: string): void {
        this.written.push(line);
    }

    end(): void {
        this.ended = true;
    }

    kill(): void {
        this.killed = true;
    }

    say(message: object): void {
        this.events.line(JSON.stringify(message));
    }

    get requests(): { type: string; id: number; timeoutMs: number }[] {
        return this.written.map((line) => JSON.parse(line) as { type: string; id: number; timeoutMs: number });
    }
}

const ROOT = {
    role: 'AXApplication',
    subrole: null,
    label: 'Settings',
    value: null,
    identifier: null,
    frame: { x: 0, y: 0, width: 402, height: 874 },
    enabled: true,
    children: []
};

const treeReply = (id: number) => ({ type: 'tree', id, scale: 3, root: ROOT, truncated: false, ms: 30 });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let timers: ManualTimers;
let children: FakeChild[];
let launched: string[];
let reader: SimulatorTreeReader;

beforeEach(() => {
    timers = new ManualTimers();
    children = [];
    launched = [];
    reader = new SimulatorTreeReader(
        'SIM-1',
        (udid, events) => {
            launched.push(udid);
            const child = new FakeChild(events);
            children.push(child);
            return child;
        },
        timers
    );
});

/* The last process started, once the reader has asked it for a tree. */
const asked = async (): Promise<FakeChild> => {
    await flush();
    return children.at(-1)!;
};

describe('SimulatorTreeReader', () => {
    test('starts the bridge on the first read, waits for it and keeps it for the next', async () => {
        const first = reader.read();
        const child = await asked();
        expect(launched).toEqual(['SIM-1']);
        expect(child.written).toEqual([]);
        child.say({ type: 'ready', scale: 3 });
        await flush();
        expect(child.requests).toEqual([{ type: 'tree', id: 1, timeoutMs: BRIDGE_TREE_MS }]);
        child.say(treeReply(1));
        expect((await first).root.label).toBe('Settings');

        const second = reader.read();
        await flush();
        child.say(treeReply(2));
        expect((await second).id).toBe(2);
        expect(launched).toHaveLength(1);
        expect(reader.running).toBe(true);
    });

    test('asks one tree at a time', async () => {
        const first = reader.read();
        const second = reader.read();
        const child = await asked();
        child.say({ type: 'ready', scale: 3 });
        await flush();
        expect(child.requests.map((request) => request.id)).toEqual([1]);
        child.say(treeReply(1));
        await first;
        await flush();
        expect(child.requests.map((request) => request.id)).toEqual([1, 2]);
        child.say(treeReply(2));
        expect((await second).id).toBe(2);
    });

    test('names what the bridge could not do in a device failure, and keeps running after one', async () => {
        const read = reader.read();
        const child = await asked();
        child.say({ type: 'ready', scale: 3 });
        await flush();
        child.say({ type: 'error', id: 1, code: 'device-not-booted', message: 'the simulator is not booted' });
        await expect(read).rejects.toMatchObject({ code: 'device-not-booted' });
        const next = reader.read();
        await flush();
        child.say({ type: 'error', id: 2, code: 'no-frontmost-app', message: 'the simulator shows no app to read' });
        await expect(next).rejects.toMatchObject({ code: 'device-tree-failed', message: expect.stringContaining('shows no app') });
        expect(child.killed).toBe(false);
        expect(launched).toHaveLength(1);
    });

    test('refuses cleanly when this Xcode lacks what the bridge needs, and tries a fresh bridge next time', async () => {
        const read = reader.read();
        const child = await asked();
        child.say({ type: 'error', id: null, code: 'unavailable', message: '-[AXPTranslator sharedInstance] is missing' });
        await expect(read).rejects.toMatchObject({ code: 'device-tree-unavailable', message: expect.stringContaining('sharedInstance') });
        expect(child.killed).toBe(true);
        const again = reader.read();
        await flush();
        expect(launched).toHaveLength(2);
        children[1]!.say({ type: 'ready', scale: 3 });
        await flush();
        children[1]!.say(treeReply(1));
        expect((await again).id).toBe(1);
    });

    test('stops waiting for a device that hangs, ends the bridge and starts a new one for the next read', async () => {
        const read = reader.read();
        const child = await asked();
        child.say({ type: 'ready', scale: 3 });
        await flush();
        timers.advance(TREE_REPLY_MS);
        await expect(read).rejects.toMatchObject({ code: 'device-tree-failed', message: expect.stringContaining('did not answer') });
        expect(child.killed).toBe(true);
        expect(reader.running).toBe(false);
        // A reply that comes after all is not taken for the next read.
        child.say(treeReply(2));
        const next = reader.read();
        await flush();
        expect(launched).toHaveLength(2);
        children[1]!.say({ type: 'ready', scale: 3 });
        await flush();
        children[1]!.say(treeReply(children[1]!.requests[0]!.id));
        await next;
    });

    test('fails a bridge that never gets ready', async () => {
        const read = reader.read();
        const child = await asked();
        timers.advance(15_000);
        await expect(read).rejects.toMatchObject({ code: 'device-tree-failed', message: expect.stringContaining('did not start') });
        expect(child.killed).toBe(true);
    });

    test('fails what waits when the bridge exits, and says what it wrote', async () => {
        const read = reader.read();
        const child = await asked();
        child.say({ type: 'ready', scale: 3 });
        await flush();
        child.events.exit(101, 'thread main panicked\n');
        await expect(read).rejects.toMatchObject({ code: 'device-tree-failed', message: 'thread main panicked' });
        expect(reader.running).toBe(false);
    });

    test('ends a bridge that writes something other than a reply', async () => {
        const read = reader.read();
        const child = await asked();
        child.events.line('not json');
        await expect(read).rejects.toMatchObject({ code: 'device-tree-failed' });
        expect(child.killed).toBe(true);
    });

    test('closes the bridge by ending its input, and kills one that does not leave', async () => {
        const read = reader.read();
        const child = await asked();
        child.say({ type: 'ready', scale: 3 });
        await flush();
        reader.close();
        await expect(read).rejects.toMatchObject({ code: 'device-tree-failed' });
        expect(child.ended).toBe(true);
        expect(child.killed).toBe(false);
        timers.advance(1_000);
        expect(child.killed).toBe(true);
        expect(reader.running).toBe(false);
    });
});
