import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import type { ServerFrame } from '@ruimte/contracts';
import { peerStatementMessage } from '@ruimte/pulsar';
import { generateKeyPair, signMessage } from '../auth/keys.ts';
import { Dispatcher } from '../dispatcher.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { PeerMachines } from '../remote/peer-machines.ts';
import { PendingAdmissions } from '../remote/pending-admissions.ts';
import { registerRemoteHandlers } from './remote.ts';

let root: string;
let store: ProjectStore;
let dispatcher: Dispatcher;
let projectId: string;
let pending: PendingAdmissions;
let machines: PeerMachines;
let attempts: string[];
let connectFails: boolean;
let closed: string[];
let lapsed: string[];
let binding: { id: string; since: number } | null | undefined;

const PEER_KEY = 'P'.repeat(43);
const MACHINE_KEY = 'A'.repeat(43);
const addressBook = generateKeyPair();
const NOW = Date.UTC(2026, 9, 1);

// What the address book signs for machine a to work in machine b, with the fields a test wants changed.
function statementFor(patch: Record<string, unknown> = {}, signer = addressBook): Record<string, unknown> {
    const issuedAt = NOW;
    const fields = {
        machineId: 'machine-b',
        machinePublicKey: 'B'.repeat(43),
        accountId: 'account-1',
        peerPublicKey: PEER_KEY,
        peerMachineId: 'machine-a',
        peerMachinePublicKey: MACHINE_KEY,
        nonce: 'n'.repeat(22),
        issuedAt,
        expiresAt: issuedAt + 600_000,
        ...patch
    } as {
        machineId: string;
        machinePublicKey: string;
        accountId: string;
        peerPublicKey: string;
        peerMachineId: string;
        peerMachinePublicKey: string;
        nonce: string;
        issuedAt: number;
        expiresAt: number;
    };
    return {
        ...fields,
        signature: signMessage(
            signer.privateKey,
            peerStatementMessage(
                fields.machineId,
                fields.machinePublicKey,
                fields.accountId,
                fields.peerPublicKey,
                fields.peerMachineId,
                fields.peerMachinePublicKey,
                fields.nonce,
                fields.issuedAt,
                fields.expiresAt
            )
        )
    };
}

const LINK = { machineId: 'machine-b', remoteProjectId: 'remote-1', label: 'MacBook Pro', rootCommit: 'abc123' };

beforeEach(async () => {
    setSystemTime(NOW);
    root = await mkdtemp(join(tmpdir(), 'ruimte-remote-handlers-'));
    const folder = join(root, 'repo');
    await mkdir(folder);
    store = new ProjectStore(join(root, 'home'), projectLinks(), new FakeWatch());
    dispatcher = new Dispatcher();
    pending = new PendingAdmissions();
    machines = new PeerMachines(join(root, 'home'));
    attempts = [];
    closed = [];
    lapsed = [];
    connectFails = false;
    binding = undefined;
    registerRemoteHandlers(dispatcher, store.remote, store, {
        machineId: 'machine-a',
        machinePublicKey: MACHINE_KEY,
        peerPublicKey: async () => PEER_KEY,
        pending,
        machines,
        connections: {
            connectWithStatement: async (machineId) => {
                attempts.push(machineId);
                if (connectFails) {
                    throw new Error('That machine is not online');
                }
            },
            close: (machineId) => closed.push(machineId)
        },
        trustedKeys: [addressBook.publicKey],
        accountBinding: async () => binding,
        lapse: async (machineId) => {
            lapsed.push(machineId);
        },
        now: () => NOW
    });
    projectId = (await store.openProject({ folder })).summary.projectId;
});

afterEach(async () => {
    setSystemTime();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function ask(type: string, payload: unknown): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];
    await dispatcher.handle({ id: 'phone', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
    return frames[0]!;
}

describe('the checkout a project is linked to on another machine', () => {
    test('is remembered per machine, replaced by a new link and listed', async () => {
        expect(await ask('remote.list', { projectId })).toMatchObject({ ok: true, result: { links: [] } });
        expect(await ask('remote.link', { projectId, ...LINK })).toMatchObject({ ok: true, result: LINK });
        await ask('remote.link', { projectId, ...LINK, remoteProjectId: 'remote-2' });
        await ask('remote.link', { projectId, ...LINK, machineId: 'machine-c', label: 'Mac mini' });
        expect(await ask('remote.list', { projectId })).toMatchObject({
            result: { links: [{ machineId: 'machine-b', remoteProjectId: 'remote-2' }, { machineId: 'machine-c' }] }
        });
    });

    test('survives a restart', async () => {
        await ask('remote.link', { projectId, ...LINK });
        const fresh = new ProjectStore(join(root, 'home'), projectLinks(), new FakeWatch());
        await fresh.remote.load();
        expect(fresh.remote.linksOf(projectId)).toEqual([LINK]);
    });

    test('is refused for a project that is not here', async () => {
        expect(await ask('remote.link', { projectId: 'nowhere', ...LINK })).toMatchObject({ ok: false, error: { code: 'project-not-found' } });
        expect(await ask('remote.list', { projectId: 'nowhere' })).toMatchObject({ ok: false, error: { code: 'project-not-found' } });
    });

    test('is removed with unlink, unless a node still runs on that machine', async () => {
        await ask('remote.link', { projectId, ...LINK });
        const node = { id: 'n1', kind: 'terminal' as const, title: 'shell', x: 0, y: 0, w: 560, h: 360, machine: 'machine-b' };
        await store.save(projectId, 0, {
            name: 'repo',
            color: '#123456',
            views: [{ kind: 'canvas', id: 'main', name: 'Canvas', nodes: [node], texts: [], edges: [], layouts: [] }]
        });
        expect(await ask('remote.unlink', { projectId, machineId: 'machine-b' })).toMatchObject({ ok: false, error: { code: 'machine-in-use' } });
        expect(store.remote.linksOf(projectId)).toHaveLength(1);

        await store.save(projectId, 1, { name: 'repo', color: '#123456', views: [] });
        expect(await ask('remote.unlink', { projectId, machineId: 'machine-b' })).toMatchObject({ ok: true });
        expect(store.remote.linksOf(projectId)).toEqual([]);
    });
});

describe('a peer statement handed over for another machine', () => {
    test('is held, the machine is remembered under the key the address book signed, and the link opens', async () => {
        const reply = await ask('remote.connect', { machineId: 'machine-b', statement: statementFor(), brokerUrl: 'wss://broker.example.com' });
        expect(reply).toMatchObject({ ok: true });
        expect(pending.peek('machine-b')).toMatchObject({ machineId: 'machine-b', peerMachineId: 'machine-a' });
        expect(machines.get('machine-b')).toMatchObject({ publicKey: 'B'.repeat(43), brokerUrl: 'wss://broker.example.com' });
        expect(attempts).toEqual(['machine-b']);
    });

    test('says why the machine could not be reached, and keeps the statement for another try', async () => {
        connectFails = true;
        expect(await ask('remote.connect', { machineId: 'machine-b', statement: statementFor() })).toMatchObject({
            ok: false,
            error: { code: 'peer-unreachable', message: 'That machine is not online' }
        });
        expect(pending.peek('machine-b')).not.toBeNull();
    });

    test('goes through a broker over wss only, or on this machine for development, and refuses any other', async () => {
        for (const brokerUrl of ['ws://broker.example.com', 'wss://user:secret@broker.example.com', 'ws://127.0.0.1.example.com']) {
            expect(await ask('remote.connect', { machineId: 'machine-b', statement: statementFor(), brokerUrl })).toMatchObject({
                ok: false,
                error: { code: 'bad-broker' }
            });
        }
        // The wire shape already refuses anything that is no ws or wss address.
        for (const brokerUrl of ['https://broker.example.com', 'not a url']) {
            expect(await ask('remote.connect', { machineId: 'machine-b', statement: statementFor(), brokerUrl })).toMatchObject({
                ok: false,
                error: { code: 'bad-request' }
            });
        }
        expect(machines.get('machine-b')).toBeNull();
        expect(attempts).toEqual([]);
        expect(await ask('remote.connect', { machineId: 'machine-b', statement: statementFor(), brokerUrl: 'ws://127.0.0.1:4430' })).toMatchObject({
            ok: true
        });
    });

    test('is refused when it names another machine, another peer key, another machine key of this one, or has run out', async () => {
        const cases = [
            { machineId: 'machine-c' },
            { peerMachineId: 'machine-z' },
            { peerPublicKey: 'Q'.repeat(43) },
            { peerMachinePublicKey: 'Z'.repeat(43) },
            { issuedAt: 1, expiresAt: 2 }
        ];
        for (const patch of cases) {
            expect(await ask('remote.connect', { machineId: 'machine-b', statement: statementFor(patch) })).toMatchObject({
                ok: false,
                error: { code: 'bad-statement' }
            });
        }
        expect(pending.peek('machine-b')).toBeNull();
        expect(machines.get('machine-b')).toBeNull();
        expect(attempts).toEqual([]);
    });

    test('is refused when the address book did not sign it, so no machine key is pinned on a client`s word', async () => {
        const forged = statementFor({ machinePublicKey: 'F'.repeat(43) }, generateKeyPair());
        expect(await ask('remote.connect', { machineId: 'machine-b', statement: forged })).toMatchObject({ ok: false, error: { code: 'bad-statement' } });
        const altered = { ...statementFor(), machinePublicKey: 'F'.repeat(43) };
        expect(await ask('remote.connect', { machineId: 'machine-b', statement: altered })).toMatchObject({ ok: false, error: { code: 'bad-statement' } });
        expect(machines.get('machine-b')).toBeNull();
    });

    test('is refused for another account than the one this machine is on', async () => {
        binding = { id: 'account-2', since: 1 };
        expect(await ask('remote.connect', { machineId: 'machine-b', statement: statementFor() })).toMatchObject({
            ok: false,
            error: { code: 'bad-statement' }
        });
        binding = { id: 'account-1', since: 1 };
        expect(await ask('remote.connect', { machineId: 'machine-b', statement: statementFor() })).toMatchObject({ ok: true });
    });
});

describe('unlinking the last project that links to a machine', () => {
    test('closes the link, ends the reconnect and forgets the machine', async () => {
        await ask('remote.connect', { machineId: 'machine-b', statement: statementFor() });
        await ask('remote.link', { projectId, ...LINK });
        expect(await ask('remote.unlink', { projectId, machineId: 'machine-b' })).toMatchObject({ ok: true });
        expect(closed).toEqual(['machine-b']);
        expect(lapsed).toEqual(['machine-b']);
        expect(machines.get('machine-b')).toBeNull();
        expect(pending.peek('machine-b')).toBeNull();
    });
});
