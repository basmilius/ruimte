import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NODE_SIZE } from '@ruimte/contracts';
import { verifySignature } from '@ruimte/pulsar/verify-node';
import { readOrCreateEndpointIdentity as readIdentity } from './endpoint-id.ts';
import { LENT_NOTHING, lendNothing } from './endpoint-id-test-helpers.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-endpoint-id-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

/* The identity of a home, lent what the daemon would lend it. */
async function readOrCreateEndpointIdentity(folder: string, defaultName?: string) {
    return lendNothing(await readIdentity(folder, defaultName));
}

async function readWritten(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(home, 'endpoint.json'), 'utf8')) as Record<string, unknown>;
}

describe('readOrCreateEndpointIdentity', () => {
    test('mints an id and a key pair once and answers with the same ones after that', async () => {
        const first = await readOrCreateEndpointIdentity(home);
        expect(first.id.length).toBeGreaterThan(8);
        const again = await readOrCreateEndpointIdentity(home);
        expect(again.id).toBe(first.id);
        expect(again.publicKey).toBe(first.publicKey);
        expect(verifySignature(first.publicKey, 'hello', again.sign('hello'))).toBe(true);

        const written = await readWritten();
        expect(written.version).toBe(1);
        expect(written.id).toBe(first.id);
        expect(written.privateKey).toContain('PRIVATE KEY');
    });

    test('a home from before the key pair keeps its id and only gains the key', async () => {
        await writeFile(join(home, 'endpoint.json'), JSON.stringify({ version: 1, id: 'minted-earlier' }));
        const identity = await readOrCreateEndpointIdentity(home);
        expect(identity.id).toBe('minted-earlier');
        expect(verifySignature(identity.publicKey, 'x', identity.sign('x'))).toBe(true);
        expect((await readOrCreateEndpointIdentity(home)).publicKey).toBe(identity.publicKey);
    });

    test('two homes are two machines, with two ids and two keys', async () => {
        const other = await mkdtemp(join(tmpdir(), 'ruimte-endpoint-id-'));
        try {
            const mine = await readOrCreateEndpointIdentity(home);
            const theirs = await readOrCreateEndpointIdentity(other);
            expect(theirs.id).not.toBe(mine.id);
            expect(verifySignature(theirs.publicKey, 'x', mine.sign('x'))).toBe(false);
        } finally {
            await rm(other, { recursive: true, force: true });
        }
    });

    test('a machine nobody has named answers to the name it was started with', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(identity.label).toBe('the-hostname');
        expect(identity.nameSource).toBe('default');
        expect(identity.icon).toBeNull();
    });

    test('a name and an icon go into the file and come back after a restart', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        await identity.setIdentity('Studio', { kind: 'lucide', value: 'server' });
        expect(identity.label).toBe('Studio');
        expect(identity.nameSource).toBe('chosen');

        const written = await readWritten();
        // Still version 1: an older daemon reading this file has to keep the id rather than mint one.
        expect(written.version).toBe(1);
        expect(written.name).toBe('Studio');
        // The key pair is written back with it, or the machine would have to pair again.
        expect(written.privateKey).toContain('PRIVATE KEY');

        const restarted = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(restarted.id).toBe(identity.id);
        expect(restarted.label).toBe('Studio');
        expect(restarted.icon).toEqual({ kind: 'lucide', value: 'server' });
    });

    test.each([
        ['empty, as a power cut leaves it', ''],
        ['cut off halfway', '{"version":1,"id":"minted-earlier","publicKey":"-----BEGIN'],
        ['from a version this one does not read', '{"version":2,"id":"minted-later"}']
    ])('a file that will not read, %s, is set aside rather than minted over', async (_case, text) => {
        await writeFile(join(home, 'endpoint.json'), text);

        const minted = await readOrCreateEndpointIdentity(home);

        const aside = (await readdir(home)).filter((name) => name.startsWith('endpoint.json.corrupt-'));
        expect(aside).toHaveLength(1);
        expect(await readFile(join(home, aside[0]!), 'utf8')).toBe(text);
        expect((await readOrCreateEndpointIdentity(home)).id).toBe(minted.id);
    });

    test('a name that was typed in a client wins over the one the daemon was started with', async () => {
        await (await readOrCreateEndpointIdentity(home, 'from-the-flag')).setIdentity('Typed here', null);
        // What `--label` or `RUIMTE_LABEL` says on the next start; the person's choice outlives it.
        expect((await readOrCreateEndpointIdentity(home, 'from-the-flag')).label).toBe('Typed here');
    });

    test('clearing the name hands the machine back to the one it starts with', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        await identity.setIdentity('Studio', { kind: 'lucide', value: 'monitor' });
        await identity.setIdentity(null, null);
        expect(identity.label).toBe('the-hostname');
        expect(identity.nameSource).toBe('default');

        const written = await readWritten();
        expect(written.name).toBeUndefined();
        expect(written.icon).toBeUndefined();
    });

    test('every connected client hears the new name, and one that left hears nothing', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        const first: unknown[] = [];
        const second: unknown[] = [];
        identity.subscribe('c1', (event) => first.push(event));
        const unsubscribe = identity.subscribe('c2', (event) => second.push(event));

        await identity.setIdentity('Studio', null);
        expect(first).toEqual([
            {
                event: 'endpoint.changed',
                payload: {
                    id: identity.id,
                    label: 'Studio',
                    nameSource: 'chosen',
                    icon: null,
                    agentsDeleteAnyView: false,
                    reachOpenProjects: false,
                    streamingAllowed: true,
                    resumeAtReset: false,
                    visualReplies: true,
                    appleFoundationEnabled: false,
                    keepAwake: 'off',
                    keepAwakeOnBattery: false,
                    keepAwakeDisplay: false,
                    keepAwakeLidClosed: false,
                    ...LENT_NOTHING,
                    broker: { mode: 'default' },
                    lanDoor: true,
                    nodeSizes: {},
                    usageStats: true
                }
            }
        ]);
        expect(second).toHaveLength(1);

        unsubscribe();
        await identity.setIdentity('Studio again', null);
        expect(first).toHaveLength(2);
        expect(second).toHaveLength(1);
    });

    test('the door on the local network starts open, and a closed one stays closed across a restart', async () => {
        const identity = await readOrCreateEndpointIdentity(home);
        expect(identity.lanDoor).toBe(true);
        const applied: boolean[] = [];
        identity.attachLanDoor({ apply: () => applied.push(identity.lanDoor), describe: () => ({ lan: null, lanDoorFixed: false }) });
        await identity.setIdentity(null, null, { lanDoor: false });
        expect(applied).toEqual([false]);
        // A rename is not the switch, so the door is left alone.
        await identity.setIdentity('Studio', null);
        expect(applied).toEqual([false]);
        expect((await readOrCreateEndpointIdentity(home)).lanDoor).toBe(false);
    });

    // A switch is stored only away from its default, and a rename leaves it where it stands.
    test.each([
        { key: 'agentsDeleteAnyView', fallback: false, change: true, set: 'setIdentity' },
        { key: 'reachOpenProjects', fallback: false, change: true, set: 'setSwitches' },
        { key: 'streamingAllowed', fallback: true, change: false, set: 'setIdentity' },
        { key: 'resumeAtReset', fallback: false, change: true, set: 'setIdentity' },
        { key: 'visualReplies', fallback: true, change: false, set: 'setIdentity' },
        { key: 'usageStats', fallback: true, change: false, set: 'setSwitches' }
    ] as const)(
        '$key starts at $fallback, survives a restart once changed and writes nothing when back at the default',
        async ({ key, fallback, change, set }) => {
            const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
            const apply = async (patch: Record<string, boolean>): Promise<void> => {
                if (set === 'setSwitches') {
                    await identity.setSwitches(patch);
                } else {
                    await identity.setIdentity(null, null, patch);
                }
            };
            expect(identity[key]).toBe(fallback);

            await apply({ [key]: change });
            expect((await readOrCreateEndpointIdentity(home, 'the-hostname'))[key]).toBe(change);
            expect((await readWritten())[key]).toBe(change);
            await identity.setIdentity('Studio', null);
            expect(identity[key]).toBe(change);

            await apply({ [key]: fallback });
            expect((await readWritten())[key]).toBeUndefined();
        }
    );

    test('a node size is stored only for a kind a person changed, survives a restart and resets to the built-in size', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(identity.nodeSizes).toEqual({});
        expect(identity.nodeSize('terminal')).toEqual(NODE_SIZE.terminal);
        const heard: unknown[] = [];
        identity.subscribe('client', (event) => heard.push(event));

        await identity.setNodeSize('terminal', { w: 800, h: 480 });
        await identity.setNodeSize('note', { w: 400, h: 320 });
        const again = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(again.nodeSize('terminal')).toEqual({ w: 800, h: 480 });
        expect(again.nodeSize('chat')).toEqual(NODE_SIZE.chat);
        expect(heard.at(-1)).toMatchObject({ event: 'endpoint.changed', payload: { nodeSizes: { terminal: { w: 800, h: 480 }, note: { w: 400, h: 320 } } } });

        await identity.setNodeSize('terminal', null);
        await identity.setNodeSize('note', null);
        expect(identity.nodeSize('terminal')).toEqual(NODE_SIZE.terminal);
        const written = await readWritten();
        expect(written.nodeSizes).toBeUndefined();
    });

    test('a node size that will not read costs only its own kind, and a kind this version does not know is left out', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        const written = await readWritten();
        const nodeSizes = { terminal: { w: 640, h: 400 }, chat: { w: 10, h: 400 }, note: { w: 320.5, h: 240 }, hologram: { w: 640, h: 400 } };
        await writeFile(join(home, 'endpoint.json'), JSON.stringify({ ...written, nodeSizes }));
        const again = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(again.id).toBe(identity.id);
        expect(again.nodeSizes).toEqual({ terminal: { w: 640, h: 400 } });
    });

    test('keep awake is off by default, each part set on its own survives a restart, and off writes nothing', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(identity.keepAwake).toEqual({ mode: 'off', onBattery: false, display: false, lidClosed: false });

        await identity.setIdentity(null, null, { keepAwake: 'always', keepAwakeDisplay: true });
        await identity.setIdentity(null, null, { keepAwakeOnBattery: true });
        await identity.setIdentity(null, null, { keepAwakeLidClosed: true });
        expect((await readOrCreateEndpointIdentity(home, 'the-hostname')).keepAwake).toEqual({
            mode: 'always',
            onBattery: true,
            display: true,
            lidClosed: true
        });

        await identity.setIdentity(null, null, { keepAwake: 'off', keepAwakeOnBattery: false, keepAwakeDisplay: false, keepAwakeLidClosed: false });
        const written = await readWritten();
        expect([written.keepAwake, written.keepAwakeOnBattery, written.keepAwakeDisplay, written.keepAwakeLidClosed]).toEqual([
            undefined,
            undefined,
            undefined,
            undefined
        ]);
    });

    test('a switch set on its own keeps the name and icon, and an announcement carries the closed-lid rule as described', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        await identity.setIdentity('Studio', { kind: 'lucide', value: 'server' });
        let rule = false;
        identity.attachClosedLid({ describe: () => ({ keepAwakeLidRule: rule }) });
        const heard: unknown[] = [];
        identity.subscribe('c1', (event) => heard.push(event));

        await identity.setSwitches({ keepAwakeLidClosed: true });
        expect([identity.label, identity.icon, identity.keepAwake.lidClosed]).toEqual(['Studio', { kind: 'lucide', value: 'server' }, true]);
        rule = true;
        identity.announce();
        expect(heard).toMatchObject([
            { event: 'endpoint.changed', payload: { label: 'Studio', keepAwakeLidClosed: true, keepAwakeLidRule: false } },
            { event: 'endpoint.changed', payload: { label: 'Studio', keepAwakeLidClosed: true, keepAwakeLidRule: true } }
        ]);
    });

    test('Apple Foundation Models is off by default, persists and broadcasts changes to every client', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'box');
        expect(identity.appleFoundationEnabled).toBe(false);
        const first: unknown[] = [];
        const second: unknown[] = [];
        identity.subscribe('first', (event) => first.push(event));
        identity.subscribe('second', (event) => second.push(event));
        await identity.setIdentity(null, null, { appleFoundationEnabled: true });
        expect((await readOrCreateEndpointIdentity(home, 'box')).appleFoundationEnabled).toBe(true);
        expect(first.at(-1)).toMatchObject({ payload: { appleFoundationEnabled: true } });
        expect(second).toEqual(first);
        await identity.setIdentity('Renamed', null);
        expect(identity.appleFoundationEnabled).toBe(true);
        await identity.setIdentity(null, null, { appleFoundationEnabled: false });
        expect((await readOrCreateEndpointIdentity(home, 'box')).appleFoundationEnabled).toBe(false);
    });

    test('the broker setting survives a restart, is applied before clients hear it, and a default one is not written', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(identity.broker).toEqual({ mode: 'default' });
        const events: unknown[] = [];
        identity.subscribe('c1', (event) => events.push(event));
        const applied: string[] = [];
        identity.attachBroker({
            apply: async () => {
                applied.push(identity.broker.mode);
            },
            describe: () => ({ brokerUrl: null, brokerFixed: false })
        });

        await identity.setIdentity(null, null, { broker: { mode: 'off' } });
        expect(applied).toEqual(['off']);
        expect(events.at(-1)).toMatchObject({ payload: { broker: { mode: 'off' }, brokerUrl: null, brokerFixed: false } });
        expect((await readOrCreateEndpointIdentity(home, 'the-hostname')).broker).toEqual({ mode: 'off' });

        // A rename does not touch the relay.
        await identity.setIdentity('Studio', null);
        expect(applied).toEqual(['off']);

        await identity.setIdentity(null, null, { broker: { mode: 'default' } });
        const written = await readWritten();
        expect(written.broker).toBeUndefined();
    });

    test('a broker setting that will not read falls back to the default', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        await identity.persist();
        const path = join(home, 'endpoint.json');
        const file = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
        await writeFile(path, JSON.stringify({ ...file, broker: { mode: 'custom', url: 'http://nope' } }));
        const again = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(again.id).toBe(identity.id);
        expect(again.broker).toEqual({ mode: 'default' });
    });

    test('a name or an icon that will not read is dropped, and the machine keeps its id', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        const written = await readWritten();
        await writeFile(join(home, 'endpoint.json'), JSON.stringify({ ...written, name: '', icon: { kind: 'nonsense', value: 'x' } }));

        const read = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(read.id).toBe(identity.id);
        expect(read.publicKey).toBe(identity.publicKey);
        expect(read.label).toBe('the-hostname');
        expect(read.icon).toBeNull();
    });

    test('creates the home directory when the daemon has never written there', async () => {
        const fresh = join(home, 'nested', 'home');
        const minted = await readOrCreateEndpointIdentity(fresh);
        expect(await readFile(join(fresh, 'endpoint.json'), 'utf8')).toContain(minted.id);
    });
});
