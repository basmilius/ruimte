import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { peerStatementMessage, type PeerStatement } from '@ruimte/pulsar';
import { generateKeyPair, signMessage } from '../auth/keys.ts';
import { TEST_STATEMENT_KEY_VARIABLE } from '../pulsar/statement.ts';
import type { PeerLink } from './peer-connection.ts';
import { PeerKey } from './peer-key.ts';
import { brokerDialer } from './remote-connections.ts';

/*
 * The whole daemon, started as `main.ts` starts it, with a machine of the account working in it as a
 * peer through a real broker. What it may ask is what the daemon's own wiring registered with
 * `{ peer: true }`, so a request added to the list anywhere in the code shows up here and nowhere else.
 */

const addressBook = generateKeyPair();
const SERVER = join(import.meta.dir, '..', 'main.ts');
const BROKER = join(import.meta.dir, '..', '..', '..', 'pulsar-broker', 'src', 'main.ts');

let daemon: Subprocess;
let broker: Subprocess;
let home: string;
let homeA: string;
let link: PeerLink;

async function freePort(): Promise<number> {
    const server = Bun.serve({ port: 0, fetch: () => new Response('') });
    const { port } = server;
    await server.stop(true);
    return port!;
}

async function waitFor(label: string, ready: () => boolean | Promise<boolean>, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await ready())) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${label}`);
        }
        await Bun.sleep(100);
    }
}

beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-peer-daemon-'));
    homeA = await mkdtemp(join(tmpdir(), 'ruimte-peer-a-'));
    const [brokerPort, daemonPort] = [await freePort(), await freePort()];
    const brokerUrl = `ws://127.0.0.1:${brokerPort}`;
    broker = Bun.spawn(['bun', BROKER, '--port', String(brokerPort)], { stdout: 'ignore', stderr: 'inherit' });
    await waitFor('the broker to answer', async () => (await fetch(`http://127.0.0.1:${brokerPort}/health`).catch(() => null))?.ok === true);
    daemon = Bun.spawn(
        [
            'bun',
            SERVER,
            '--host',
            '127.0.0.1',
            '--port',
            String(daemonPort),
            '--broker',
            brokerUrl,
            '--no-lan',
            '--no-hooks',
            '--no-price-fetch',
            '--no-model-fetch',
            '--no-stun'
        ],
        {
            env: { ...process.env, RUIMTE_HOME: home, [TEST_STATEMENT_KEY_VARIABLE]: addressBook.publicKey },
            stdout: 'ignore',
            stderr: 'inherit'
        }
    );
    await waitFor(
        'the daemon to announce itself to the broker',
        async () => (((await (await fetch(`http://127.0.0.1:${brokerPort}/health`)).json()) as { machines: number }).machines ?? 0) >= 1
    );
    const machine = JSON.parse(await readFile(join(home, 'endpoint.json'), 'utf8')) as { id: string; publicKey: string };

    const peerKey = new PeerKey(homeA);
    const peerPublicKey = await peerKey.publicKey();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + 600_000;
    const peerMachinePublicKey = generateKeyPair().publicKey;
    const nonce = 'allow-list-nonce'.padEnd(22, 'n');
    const statement: PeerStatement = {
        machineId: machine.id,
        machinePublicKey: machine.publicKey,
        accountId: 'owner',
        peerPublicKey,
        peerMachineId: 'machine-a',
        peerMachinePublicKey,
        nonce,
        issuedAt,
        expiresAt,
        signature: signMessage(
            addressBook.privateKey,
            peerStatementMessage(machine.id, machine.publicKey, 'owner', peerPublicKey, 'machine-a', peerMachinePublicKey, nonce, issuedAt, expiresAt)
        )
    };
    const dialer = brokerDialer({ signer: peerKey, defaultBroker: () => brokerUrl, label: () => 'Studio', timeoutMs: 30_000 });
    link = await dialer.dial({ machineId: machine.id, publicKey: machine.publicKey, linkedAt: issuedAt }, statement);
}, 120_000);

afterAll(async () => {
    link?.close();
    daemon?.kill();
    broker?.kill();
    await daemon?.exited;
    await rm(home, { recursive: true, force: true });
    await rm(homeA, { recursive: true, force: true });
});

const PAYLOADS: Record<string, unknown> = {
    'peer.taskStart': {
        projectId: 'project-1',
        nodeId: 'chat-one',
        parentId: 'chat-parent',
        title: 'Task',
        prompt: 'Do it',
        provider: 'claude',
        ceiling: 'full-access',
        depth: 1
    },
    'peer.taskStop': { nodeId: 'chat-one' },
    'peer.result': { nodeId: 'chat-one' },
    'peer.bundlePut': { bundleId: 'a-bundle-id', offset: 0, data: '' },
    'peer.bundleRead': { bundleId: 'a-bundle-id', offset: 0, length: 10 },
    'peer.close': { projectId: 'project-1' }
};

describe('a peer in the whole daemon', () => {
    test('the requests it may ask are exactly the peer list', async () => {
        const info = await link.request<{ features: string[]; accountId?: string }>('endpoint.info', {});
        expect(info.features.toSorted()).toEqual([
            'endpoint.info',
            'peer.bundlePut',
            'peer.bundleRead',
            'peer.close',
            'peer.message',
            'peer.result',
            'peer.taskStart',
            'peer.taskStop',
            'server.ping'
        ]);
        expect(info.accountId).toBeUndefined();
        await expect(link.request('server.ping', {})).resolves.toBeDefined();
    }, 30_000);

    test('and everything else is forbidden, the requests that read, write, run and sign most of all', async () => {
        for (const type of [
            'fs.read',
            'session.create',
            'launch.start',
            'project.save',
            'auth.revoke',
            'auth.sessions',
            'endpoint.signRegistration',
            'endpoint.signPeerAccess',
            'remote.connect',
            'peer.bind',
            'peer.placeNodes',
            'git.bundlePut',
            'git.fetchBundle',
            'bytes.read'
        ]) {
            await expect(link.request(type, {})).rejects.toThrow(/^forbidden:/);
        }
    }, 30_000);

    test('and every request on the list answers peer-not-linked until a person here links the machine', async () => {
        for (const type of ['peer.taskStart', 'peer.taskStop', 'peer.result', 'peer.bundlePut', 'peer.bundleRead', 'peer.close']) {
            await expect(link.request(type, PAYLOADS[type])).rejects.toThrow(/^peer-not-linked:/);
        }
    }, 30_000);
});
