import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, type ServerFrame } from '@ruimte/contracts';
import { AuthStore } from '../auth/auth-store.ts';
import { machineRegistrationMessage } from '@ruimte/pulsar';
import { generateKeyPair, verifySignature } from '../auth/keys.ts';
import { Dispatcher, type ClientAccess, type ClientConnection } from '../dispatcher.ts';
import { readOrCreateEndpointIdentity, type EndpointIdentity } from '../endpoint-id.ts';
import { registerAuthHandlers } from './auth.ts';

let home: string;
let store: AuthStore;
let identity: EndpointIdentity;
let dispatcher: Dispatcher;
let minted: number;
let disconnected: string[];

const client = (access?: ClientAccess): { connection: ClientConnection; frames: ServerFrame[] } => {
    const frames: ServerFrame[] = [];
    return {
        frames,
        connection: {
            id: 'c1',
            access,
            send(frame) {
                frames.push(frame);
            }
        }
    };
};

const ask = async (access: ClientAccess | undefined, type: string, payload: unknown = {}): Promise<ServerFrame> => {
    const { connection, frames } = client(access);
    await dispatcher.handle(connection, JSON.stringify({ id: '1', type, payload }));
    return frames[0]!;
};

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-auth-handlers-'));
    store = new AuthStore(home);
    identity = await readOrCreateEndpointIdentity(home, 'box');
    dispatcher = new Dispatcher();
    minted = 0;
    disconnected = [];
    registerAuthHandlers(dispatcher, store, {
        identity,
        version: '0.0.0',
        broker: () => ({ brokerUrl: identity.broker.mode === 'custom' ? identity.broker.url : null, brokerFixed: false }),
        pairingUrl: () => `http://box:4210/pair#${store.issuePairingToken()}${minted++}`,
        disconnect: (sessionId) => disconnected.push(sessionId)
    });
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('auth handlers', () => {
    test('a client with the local secret gets a pairing link, a paired one does not, wherever it comes from', async () => {
        const local = await ask({ reachability: 'loopback', sessionId: null }, 'auth.pairingToken');
        expect(local).toMatchObject({ ok: true, result: { url: expect.stringMatching(/^http:\/\/box:4210\/pair#/) } });

        const remote = await ask({ reachability: 'lan', sessionId: 's1' }, 'auth.pairingToken');
        expect(remote).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        // Paired, but arriving through a tunnel on this machine: the address is loopback and still grants nothing.
        const tunneled = await ask({ reachability: 'loopback', sessionId: 's1' }, 'auth.pairingToken');
        expect(tunneled).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await ask(undefined, 'auth.pairingToken')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(minted).toBe(1);
    });

    test('sessions list the asking client as current, and revoking an unknown one is an error', async () => {
        const paired = await store.pair(store.issuePairingToken(), { label: 'laptop' });
        const listed = await ask({ reachability: 'lan', sessionId: paired!.id }, 'auth.sessions');
        expect(listed).toMatchObject({ ok: true, result: { sessions: [{ id: paired!.id, label: 'laptop', current: true }] } });

        const loopback: ClientAccess = { reachability: 'loopback', sessionId: null };
        expect(await ask(loopback, 'auth.revoke', { id: 'nope' })).toMatchObject({ ok: false, error: { code: 'session-not-found' } });
        expect(await ask(loopback, 'auth.revoke', { id: paired!.id })).toMatchObject({ ok: true });
        expect(await store.list(null)).toEqual([]);
        expect(disconnected).toEqual([paired!.id]);
    });

    test('endpoint.info carries the key a client pins the machine on', async () => {
        const info = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.info');
        expect(info).toMatchObject({ ok: true, result: { id: identity.id, publicKey: identity.publicKey, authenticated: true } });
    });

    test('endpoint.info carries the protocol version a client refuses the machine without', async () => {
        const info = await ask({ reachability: 'loopback', sessionId: null }, 'endpoint.info');
        expect(info).toMatchObject({ ok: true, result: { protocol: PROTOCOL_VERSION } });
    });

    test('a machine nobody has named answers to the name it started with', async () => {
        const info = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.info');
        expect(info).toMatchObject({ ok: true, result: { label: 'box', nameSource: 'default', icon: null } });
    });

    test('naming the machine answers with the new name and tells every other client', async () => {
        const heard: unknown[] = [];
        identity.subscribe('other-client', (event) => heard.push(event));

        const set = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', {
            name: 'The one under the desk',
            icon: { kind: 'lucide', value: 'server' }
        });
        expect(set).toMatchObject({ ok: true, result: { label: 'The one under the desk', nameSource: 'chosen', icon: { kind: 'lucide', value: 'server' } } });
        expect(heard).toEqual([
            {
                event: 'endpoint.changed',
                payload: {
                    id: identity.id,
                    label: 'The one under the desk',
                    nameSource: 'chosen',
                    icon: { kind: 'lucide', value: 'server' },
                    agentsDeleteAnyView: false,
                    refuseStatements: false,
                    broker: { mode: 'default' }
                }
            }
        ]);

        // A client that connects after the rename is told the same thing without asking for it.
        const info = await ask({ reachability: 'loopback', sessionId: null }, 'endpoint.info');
        expect(info).toMatchObject({ ok: true, result: { label: 'The one under the desk' } });
    });

    test('a null name hands the machine back to the one it started with', async () => {
        await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: 'Renamed', icon: null });
        const cleared = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: null, icon: null });
        expect(cleared).toMatchObject({ ok: true, result: { label: 'box', nameSource: 'default' } });
    });

    test('what an agent may delete travels with the machine and is left alone by a rename', async () => {
        const freed = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: null, icon: null, agentsDeleteAnyView: true });
        expect(freed).toMatchObject({ ok: true, result: { agentsDeleteAnyView: true } });

        const renamed = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: 'Renamed', icon: null });
        expect(renamed).toMatchObject({ ok: true, result: { agentsDeleteAnyView: true } });
        expect(await ask({ reachability: 'loopback', sessionId: null }, 'endpoint.info')).toMatchObject({ ok: true, result: { agentsDeleteAnyView: true } });
    });

    test('a name nobody could read is refused before it reaches the file', async () => {
        const empty = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: '', icon: null });
        expect(empty).toMatchObject({ ok: false });
        expect(identity.label).toBe('box');
    });

    test('a paired client hangs a key on its own session; a loopback one has no session to hang it on', async () => {
        const paired = await store.pair(store.issuePairingToken(), { label: 'container' });
        const { publicKey } = generateKeyPair();

        const registered = await ask({ reachability: 'lan', sessionId: paired!.id }, 'auth.registerKey', { publicKey });
        expect(registered).toMatchObject({ ok: true, result: { registered: true } });
        expect(await store.sessionForPublicKey(publicKey)).toBe(paired!.id);

        expect(await ask({ reachability: 'loopback', sessionId: null }, 'auth.registerKey', { publicKey: generateKeyPair().publicKey })).toMatchObject({
            ok: true,
            result: { registered: false }
        });
        expect(await ask({ reachability: 'lan', sessionId: paired!.id }, 'auth.registerKey', { publicKey: 'not-a-key' })).toMatchObject({
            ok: true,
            result: { registered: false }
        });
    });
    test('the switch that refuses statements is set from any client, travels in endpoint.info and leaves the name alone', async () => {
        expect(await ask({ reachability: 'loopback', sessionId: null }, 'endpoint.info')).toMatchObject({ ok: true, result: { refuseStatements: false } });
        const refused = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: 'Studio', icon: null, refuseStatements: true });
        expect(refused).toMatchObject({ ok: true, result: { label: 'Studio', refuseStatements: true, agentsDeleteAnyView: false } });
        expect(identity.refuseStatements).toBe(true);
        const renamed = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: 'Studio 2', icon: null });
        expect(renamed).toMatchObject({ ok: true, result: { refuseStatements: true } });
    });

    test('the broker setting is set from any client, checked, and endpoint.info carries the broker it leads to', async () => {
        expect(await ask({ reachability: 'loopback', sessionId: null }, 'endpoint.info')).toMatchObject({
            ok: true,
            result: { broker: { mode: 'default' }, brokerUrl: null, brokerFixed: false }
        });
        const custom = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', {
            name: null,
            icon: null,
            broker: { mode: 'custom', url: 'wss://mine.example.com' }
        });
        expect(custom).toMatchObject({ ok: true, result: { broker: { mode: 'custom', url: 'wss://mine.example.com' }, brokerUrl: 'wss://mine.example.com' } });
        const plain = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', {
            name: null,
            icon: null,
            broker: { mode: 'custom', url: 'ws://mine.example.com' }
        });
        expect(plain).toMatchObject({ ok: false });
        expect(identity.broker).toEqual({ mode: 'custom', url: 'wss://mine.example.com' });
        // A rename leaves the broker where it stands.
        expect(await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: 'Studio', icon: null })).toMatchObject({
            ok: true,
            result: { broker: { mode: 'custom' } }
        });
    });

    test('a registration carries the name and icon a person chose, and the name the machine started with until then', async () => {
        const sign = async () => {
            const frame = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.signRegistration', { accountId: 'account-1' });
            if (!('ok' in frame) || !frame.ok) {
                throw new Error(`Expected an answer, got ${JSON.stringify(frame)}`);
            }
            return (frame.result as { registration: { name: string; icon: unknown } }).registration;
        };
        expect(await sign()).toMatchObject({ name: 'box', icon: null });
        await identity.setIdentity('Studio', { kind: 'emoji', value: '🎛️' });
        expect(await sign()).toMatchObject({ name: 'Studio', icon: { kind: 'emoji', value: '🎛️' } });
        await identity.setIdentity(null, null);
        expect(await sign()).toMatchObject({ name: 'box', icon: null });
    });

    test('a registration is signed by the machine for the account a client names, with what a client needs to reach it', async () => {
        await identity.setIdentity('Studio', { kind: 'lucide', value: 'server' });
        const frame = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.signRegistration', { accountId: 'account-1' });
        if (!('ok' in frame) || !frame.ok) {
            throw new Error(`Expected an answer, got ${JSON.stringify(frame)}`);
        }
        const { registration } = frame.result as {
            registration: { id: string; name: string; publicKey: string; issuedAt: number; signature: string; icon: unknown; brokerUrl: unknown };
        };
        expect(registration).toMatchObject({
            id: identity.id,
            name: 'Studio',
            publicKey: identity.publicKey,
            icon: { kind: 'lucide', value: 'server' },
            brokerUrl: null
        });
        const message = machineRegistrationMessage('account-1', identity.id, identity.publicKey, 'Studio', registration.issuedAt);
        expect(verifySignature(identity.publicKey, message, registration.signature)).toBe(true);
        expect(
            verifySignature(
                identity.publicKey,
                machineRegistrationMessage('account-2', identity.id, identity.publicKey, 'Studio', registration.issuedAt),
                registration.signature
            )
        ).toBe(false);
    });
});
