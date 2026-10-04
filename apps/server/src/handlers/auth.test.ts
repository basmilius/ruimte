import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, type ServerFrame } from '@ruimte/contracts';
import { AuthStore, type StatementAdmission } from '../auth/auth-store.ts';
import { admitClient } from '../auth/test-admit.ts';
import { machineRegistrationMessage } from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-node';
import { generateKeyPair } from '../auth/keys.ts';
import { Dispatcher, type ClientAccess, type ClientConnection } from '../dispatcher.ts';
import { readOrCreateEndpointIdentity, type EndpointIdentity } from '../endpoint-id.ts';
import { MachineUpdates } from '../power/machine-update.ts';
import { PAIRING_REMOVED, registerAuthHandlers } from './auth.ts';
import { ClosedLidError, DEFAULT_ADMIN_PROMPT } from '../power/closed-lid.ts';

let home: string;
let store: AuthStore;
let identity: EndpointIdentity;
let dispatcher: Dispatcher;
let lanDoorOpen: boolean;
let disconnected: string[];
let streamingChanges: boolean[];
let appleChanges: boolean[];
let keepAwakeChanges: number;
let lidRule: boolean;
let lidCancels: boolean;
let ruleRequests: { install: boolean; prompt: string }[];
let updates: MachineUpdates;

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

// A client that presented the local secret: the app on this machine, or `ruimte login`.
const LOCAL: ClientAccess = { reachability: 'loopback', sessionId: null };

const sessionOf = (admission: StatementAdmission): string => {
    if (!('sessionId' in admission)) {
        throw new Error(`Expected an admission, got ${admission.refused}`);
    }
    return admission.sessionId;
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
    lanDoorOpen = true;
    disconnected = [];
    streamingChanges = [];
    appleChanges = [];
    keepAwakeChanges = 0;
    lidRule = false;
    lidCancels = false;
    ruleRequests = [];
    updates = new MachineUpdates();
    registerAuthHandlers(dispatcher, store, {
        identity,
        version: '0.0.0',
        broker: () => ({ brokerUrl: identity.broker.mode === 'custom' ? identity.broker.url : null, brokerFixed: false }),
        lanDoor: () => ({ lan: lanDoorOpen ? { port: 4220, addresses: ['192.168.1.20'] } : null, lanDoorFixed: false }),
        streamingChanged: (allowed) => streamingChanges.push(allowed),
        appleFoundationChanged: async (on) => {
            appleChanges.push(on);
        },
        keepAwake: {
            available: true,
            changed: () => {
                keepAwakeChanges += 1;
            }
        },
        closedLid: {
            available: true,
            rule: async () => lidRule,
            setRule: async (install, prompt) => {
                ruleRequests.push({ install, prompt });
                if (lidCancels) {
                    throw new ClosedLidError('closed-lid-cancelled', 'The administrator dialog was cancelled');
                }
                lidRule = install;
            }
        },
        updates: {
            state: () => updates.state(),
            report: (clientId, report) => updates.report(clientId, report),
            requestInstall: () => updates.requestInstall(),
            ending: () => ({ terminals: 1, agents: 2 })
        },
        disconnect: (sessionId) => disconnected.push(sessionId)
    });
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('auth handlers', () => {
    test('a client of before account-only that asks for a pairing link or to hang a key on a token hears that links are gone', async () => {
        const removed = { ok: false, error: { code: 'pairing-removed', message: PAIRING_REMOVED } };
        expect(await ask({ reachability: 'loopback', sessionId: null }, 'auth.pairingToken')).toMatchObject(removed);
        expect(await ask({ reachability: 'lan', sessionId: 's1' }, 'auth.registerKey', { publicKey: generateKeyPair().publicKey })).toMatchObject(removed);
    });

    test('endpoint.info says where the door on the local network stands, and the switch closes it from any client', async () => {
        expect(await ask({ reachability: 'loopback', sessionId: null }, 'endpoint.info')).toMatchObject({
            ok: true,
            result: { lan: { port: 4220, addresses: ['192.168.1.20'] }, lanDoor: true, lanDoorFixed: false }
        });
        const closed = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: 'Studio', icon: null, lanDoor: false });
        expect(closed).toMatchObject({ ok: true, result: { label: 'Studio', lanDoor: false } });
        expect(identity.lanDoor).toBe(false);
        const renamed = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: 'Studio 2', icon: null });
        expect(renamed).toMatchObject({ ok: true, result: { lanDoor: false } });
    });

    test('sessions list the asking client as current, and revoking an unknown one is an error', async () => {
        const laptop = await admitClient(store, generateKeyPair().publicKey, 'laptop');
        const listed = await ask({ reachability: 'lan', sessionId: laptop }, 'auth.sessions');
        expect(listed).toMatchObject({ ok: true, result: { sessions: [{ id: laptop, label: 'laptop', current: true }] } });

        const loopback: ClientAccess = { reachability: 'loopback', sessionId: null };
        expect(await ask(loopback, 'auth.revoke', { id: 'nope' })).toMatchObject({ ok: false, error: { code: 'session-not-found' } });
        expect(await ask(loopback, 'auth.revoke', { id: laptop })).toMatchObject({ ok: true });
        expect(await store.list(null)).toEqual([]);
        expect(disconnected).toEqual([laptop]);
    });

    test('Apple setting invokes lifecycle changes and leaves it alone on unrelated edits', async () => {
        expect(await ask(undefined, 'endpoint.info')).toMatchObject({ result: { appleFoundationEnabled: false } });
        expect(await ask(undefined, 'endpoint.setIdentity', { name: null, icon: null, appleFoundationEnabled: true })).toMatchObject({
            ok: true,
            result: { appleFoundationEnabled: true }
        });
        await ask(undefined, 'endpoint.setIdentity', { name: 'Box', icon: null });
        await ask(undefined, 'endpoint.setIdentity', { name: null, icon: null, appleFoundationEnabled: false });
        expect(appleChanges).toEqual([true, false]);
    });

    test('keep awake is set from any paired client, and only a change of it reaches the holder', async () => {
        expect(await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.info')).toMatchObject({
            result: { keepAwake: 'off', keepAwakeOnBattery: false, keepAwakeDisplay: false, keepAwakeAvailable: true }
        });
        const set = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: null, icon: null, keepAwake: 'working' });
        expect(set).toMatchObject({ ok: true, result: { keepAwake: 'working' } });
        await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: 'Box', icon: null });
        expect(keepAwakeChanges).toBe(1);
    });

    test('the closed-lid switch turns on only once the rule is installed, and off always goes through', async () => {
        const paired: ClientAccess = { reachability: 'lan', sessionId: 's1' };
        expect(await ask(paired, 'endpoint.info')).toMatchObject({
            result: { keepAwakeLidClosed: false, keepAwakeLidAvailable: true, keepAwakeLidRule: false }
        });
        expect(await ask(paired, 'endpoint.setIdentity', { name: null, icon: null, keepAwakeLidClosed: true })).toMatchObject({
            ok: false,
            error: { code: 'closed-lid-no-rule' }
        });
        expect([identity.keepAwake.lidClosed, keepAwakeChanges]).toEqual([false, 0]);

        lidRule = true;
        expect(await ask(paired, 'endpoint.setIdentity', { name: null, icon: null, keepAwakeLidClosed: true })).toMatchObject({
            ok: true,
            result: { keepAwakeLidClosed: true, keepAwakeLidRule: true }
        });
        expect(keepAwakeChanges).toBe(1);

        // A phone that sends the whole keep awake back after the rule went is not refused for a switch that was on already.
        lidRule = false;
        expect(await ask(paired, 'endpoint.setIdentity', { name: null, icon: null, keepAwake: 'always', keepAwakeLidClosed: true })).toMatchObject({
            ok: true
        });
        expect(await ask(paired, 'endpoint.setIdentity', { name: null, icon: null, keepAwakeLidClosed: false })).toMatchObject({
            ok: true,
            result: { keepAwakeLidClosed: false }
        });
        expect(keepAwakeChanges).toBe(3);
    });

    test('only the app on this machine installs or removes the closed-lid rule, through the dialog it asks macOS for', async () => {
        expect(await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.closedLidRule', { install: true })).toMatchObject({
            ok: false,
            error: { code: 'forbidden' }
        });
        expect(ruleRequests).toEqual([]);

        expect(await ask(LOCAL, 'endpoint.closedLidRule', { install: true })).toMatchObject({ ok: true, result: { keepAwakeLidRule: true } });
        expect(await ask(LOCAL, 'endpoint.closedLidRule', { install: false, prompt: 'Ruimte wil de regel weghalen.' })).toMatchObject({
            ok: true,
            result: { keepAwakeLidRule: false }
        });
        expect(ruleRequests).toEqual([
            { install: true, prompt: DEFAULT_ADMIN_PROMPT.install },
            { install: false, prompt: 'Ruimte wil de regel weghalen.' }
        ]);

        lidCancels = true;
        expect(await ask(LOCAL, 'endpoint.closedLidRule', { install: true })).toMatchObject({ ok: false, error: { code: 'closed-lid-cancelled' } });
    });

    test('only the app on this machine says where its update stands', async () => {
        const report = { status: 'ready', currentVersion: '1.0.0', version: '1.1.0' };
        expect(await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.reportUpdate', report)).toMatchObject({
            ok: false,
            error: { code: 'forbidden' }
        });
        expect(await ask(LOCAL, 'endpoint.reportUpdate', report)).toMatchObject({ ok: true });
        expect(await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.info')).toMatchObject({
            result: { update: { app: true, status: 'ready', version: '1.1.0' } }
        });
    });

    test('an install says what ends first, and starts only when confirmed with an app to do it', async () => {
        const phone: ClientAccess = { reachability: 'lan', sessionId: 's1' };
        expect(await ask(phone, 'endpoint.installUpdate', { confirm: false })).toMatchObject({
            ok: true,
            result: { started: false, ending: { terminals: 1, agents: 2 } }
        });
        expect(await ask(phone, 'endpoint.installUpdate', { confirm: true })).toMatchObject({ ok: false, error: { code: 'update-no-app' } });

        const heard: unknown[] = [];
        updates.subscribe('c1', (event) => heard.push(event));
        await ask(LOCAL, 'endpoint.reportUpdate', { status: 'current' });
        expect(await ask(phone, 'endpoint.installUpdate', { confirm: true })).toMatchObject({ ok: false, error: { code: 'update-none' } });

        await ask(LOCAL, 'endpoint.reportUpdate', { status: 'available', version: '1.1.0' });
        expect(await ask(phone, 'endpoint.installUpdate', { confirm: true })).toMatchObject({
            ok: true,
            result: { started: true, ending: { terminals: 1, agents: 2 } }
        });
        expect(heard.at(-1)).toEqual({ event: 'endpoint.updateInstall', payload: {} });
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
                    streamingAllowed: true,
                    resumeAtReset: false,
                    appleFoundationEnabled: false,
                    keepAwake: 'off',
                    keepAwakeOnBattery: false,
                    keepAwakeDisplay: false,
                    keepAwakeLidClosed: false,
                    broker: { mode: 'default' },
                    lanDoor: true
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

    test('streaming starts allowed, can be disabled, and is left alone by a rename', async () => {
        expect(await ask({ reachability: 'loopback', sessionId: null }, 'endpoint.info')).toMatchObject({
            ok: true,
            result: { streamingAllowed: true }
        });
        const disabled = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', {
            name: null,
            icon: null,
            streamingAllowed: false
        });
        expect(disabled).toMatchObject({ ok: true, result: { streamingAllowed: false } });
        expect(identity.streamingAllowed).toBe(false);
        expect(streamingChanges).toEqual([false]);

        const renamed = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.setIdentity', { name: 'Studio', icon: null });
        expect(renamed).toMatchObject({ ok: true, result: { streamingAllowed: false } });
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
            const frame = await ask(LOCAL, 'endpoint.signRegistration', { accountId: 'account-1' });
            if (!('ok' in frame) || !frame.ok) {
                throw new Error(`Expected an answer, got ${JSON.stringify(frame)}`);
            }
            return (frame.result as { registration: { name: string; icon: unknown } }).registration;
        };
        expect(await sign()).toMatchObject({ name: 'box', icon: null });
        await identity.setIdentity('Studio', { kind: 'lucide', value: 'monitor' });
        expect(await sign()).toMatchObject({ name: 'Studio', icon: { kind: 'lucide', value: 'monitor' } });
        await identity.setIdentity(null, null);
        expect(await sign()).toMatchObject({ name: 'box', icon: null });
    });

    test('a registration is signed by the machine for the account a client names, with what a client needs to reach it', async () => {
        await identity.setIdentity('Studio', { kind: 'lucide', value: 'server' });
        const frame = await ask(LOCAL, 'endpoint.signRegistration', { accountId: 'account-1' });
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
    test('only the app on this machine has it sign a registration; a paired client is refused whatever account it names', async () => {
        for (const access of [{ reachability: 'lan', sessionId: 's1' } as const, { reachability: 'loopback', sessionId: 's1' } as const, undefined]) {
            expect(await ask(access, 'endpoint.signRegistration', { accountId: 'account-1' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        }
        expect(await store.accountBinding()).toBeUndefined();
    });

    test('signing a registration puts the machine on that account, and a second account is refused until a person takes it off', async () => {
        expect(await ask(LOCAL, 'endpoint.signRegistration', { accountId: 'account-1' })).toMatchObject({ ok: true });
        expect(await ask(LOCAL, 'endpoint.signRegistration', { accountId: 'account-1' })).toMatchObject({ ok: true });
        expect(await ask(LOCAL, 'endpoint.signRegistration', { accountId: 'account-2' })).toMatchObject({
            ok: false,
            error: { code: 'machine-has-account' }
        });
        expect(await ask(LOCAL, 'endpoint.info')).toMatchObject({ ok: true, result: { accountId: 'account-1' } });

        expect(await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.leaveAccount')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await ask(LOCAL, 'endpoint.leaveAccount')).toMatchObject({ ok: true, result: { revoked: 0 } });
        expect(await ask(LOCAL, 'endpoint.info')).toMatchObject({ ok: true, result: { accountId: null } });
        expect(await ask(LOCAL, 'endpoint.signRegistration', { accountId: 'account-2' })).toMatchObject({ ok: true });
        expect(await store.accountBinding()).toMatchObject({ id: 'account-2' });
    });

    test('only the app on this machine is told which account the machine is on', async () => {
        await ask(LOCAL, 'endpoint.signRegistration', { accountId: 'account-1' });
        const paired = await ask({ reachability: 'lan', sessionId: 's1' }, 'endpoint.info');
        expect(paired).toMatchObject({ ok: true });
        expect('ok' in paired && paired.ok && 'accountId' in (paired.result as object)).toBe(false);
    });

    test('leaving the account cuts off the clients a statement of it let in, and leaves a client paired by link', async () => {
        await ask(LOCAL, 'endpoint.signRegistration', { accountId: 'account-1' });
        const phone = generateKeyPair();
        const admitted = await store.admitStatement({
            publicKey: phone.publicKey,
            label: 'Phone',
            nonce: 'n'.repeat(22),
            keepNonceUntil: Date.now() + 1_000,
            accountId: 'account-1'
        });

        expect(await ask(LOCAL, 'endpoint.leaveAccount')).toMatchObject({ ok: true, result: { revoked: 1 } });
        expect(disconnected).toEqual([sessionOf(admitted)]);
        expect(await store.list(null)).toEqual([]);
    });

    test('joining an account cuts off a client another account let in on a statement', async () => {
        const colleague = generateKeyPair();
        const admitted = await store.admitStatement({
            publicKey: colleague.publicKey,
            label: 'Colleague',
            nonce: 'c'.repeat(22),
            keepNonceUntil: Date.now() + 1_000,
            accountId: 'colleague'
        });
        expect(await ask(LOCAL, 'endpoint.signRegistration', { accountId: 'owner' })).toMatchObject({ ok: true });
        expect(disconnected).toEqual([sessionOf(admitted)]);
        expect(await store.list(null)).toEqual([]);
    });
});
