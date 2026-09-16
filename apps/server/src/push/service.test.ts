import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUSH_HKDF_SALT, pushEncryptionInfo, pushMessage, pushRoutingMessage, type PushEnvelope } from '@ruimte/pulsar';
import type { AgentStatus, PushSubscribePayload, ServerFrame } from '@ruimte/contracts';
import { AuthStore } from '../auth/auth-store.ts';
import { generateKeyPair, signMessage, verifySignature } from '../auth/keys.ts';
import { Dispatcher } from '../dispatcher.ts';
import { registerPushHandlers } from '../handlers/push.ts';
import { makeHarness } from '../sessions/test-helpers.ts';
import { PushService } from './service.ts';

const machine = generateKeyPair();
const recipient = generateKeyPairSync('x25519');
const subscription: PushSubscribePayload = {
    handle: 'h'.repeat(43),
    publicKey: recipient.publicKey.export({ format: 'jwk' }).x!,
    follow: ['node'],
    approvals: true,
    activities: false
};
const NOW = 1_900_000_000_000;
let home: string;
let auth: AuthStore;
let sessionId: string;
let pushes: PushEnvelope[];
let service: PushService;

const decrypt = (push: PushEnvelope): unknown => {
    if (push.pushType !== 'alert') {
        throw new Error('Expected alert');
    }
    const shared = diffieHellman({
        privateKey: recipient.privateKey,
        publicKey: createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: push.ephemeralKey }, format: 'jwk' })
    });
    const key = Buffer.from(hkdfSync('sha256', shared, Buffer.from(PUSH_HKDF_SALT), Buffer.from(pushEncryptionInfo(push.machineId, push.handle)), 32));
    const encrypted = Buffer.from(push.ciphertext, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(push.nonce, 'base64url'));
    decipher.setAAD(Buffer.from(pushRoutingMessage(push)), { plaintextLength: encrypted.length - 16 });
    decipher.setAuthTag(encrypted.subarray(-16));
    return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString());
};

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-push-'));
    auth = new AuthStore(home, () => NOW);
    const paired = await auth.pair(auth.issuePairingToken(), { label: 'Phone', publicKey: generateKeyPair().publicKey });
    sessionId = paired!.id;
    await auth.setPush(sessionId, subscription);
    pushes = [];
    service = new PushService({
        auth,
        identity: { id: 'machine', sign: (text) => signMessage(machine.privateKey, text) },
        now: () => NOW,
        send: async (push) => {
            pushes.push(push);
            return 204;
        },
        onError: (error) => {
            throw error;
        }
    });
});

afterEach(async () => {
    await service.settled();
    await rm(home, { recursive: true, force: true });
});

const status = (value: AgentStatus, nodeId = 'node', destination = service): void =>
    destination.consume({
        event: 'session.status',
        payload: {
            sessionId: nodeId,
            agent: { kind: 'codex', agentSessionId: 'cli', transcriptPath: null, status: value, suggestedTitle: 'Secret project', live: true, updatedAt: NOW }
        }
    });

describe('offline push delivery', () => {
    test('subscribed turn completion is signed and decrypts, with no plaintext title/node/body', async () => {
        status('running');
        status('idle');
        await service.settled();
        expect(pushes.length).toBe(1);
        const push = pushes[0]!;
        expect(verifySignature(machine.publicKey, pushMessage(push), push.signature)).toBe(true);
        expect(JSON.stringify(push)).not.toContain('Secret project');
        expect(decrypt(push)).toMatchObject({ kind: 'turn', target: 'terminal', nodeId: 'node', title: 'Secret project' });
        expect(() => decrypt({ ...push, handle: 'z'.repeat(43) })).toThrow();
        expect(() => decrypt({ ...push, collapseId: 'z'.repeat(43) })).toThrow();
    });

    test('the same node id on another machine gets a different collapse id', async () => {
        status('running');
        status('idle');
        await service.settled();
        const other = new PushService({
            auth,
            identity: { id: 'other-machine', sign: (text) => signMessage(machine.privateKey, text) },
            now: () => NOW,
            send: async (push) => {
                pushes.push(push);
                return 204;
            }
        });
        status('running', 'node', other);
        status('idle', 'node', other);
        await other.settled();
        expect(pushes.length).toBe(2);
        expect(pushes[0]!.collapseId).not.toBe(pushes[1]!.collapseId);
    });

    test('only followed nodes notify, repeated status and initial idle do not', async () => {
        status('idle');
        status('running', 'unfollowed');
        status('idle', 'unfollowed');
        status('running');
        status('idle');
        status('idle');
        await service.settled();
        expect(pushes.length).toBe(1);
    });

    test('two connections of one paired key suppress delivery until both close', async () => {
        const first = service.connected(sessionId);
        const second = service.connected(sessionId);
        expect(await service.hasOfflineApprovals()).toBe(false);
        first();
        status('running');
        status('idle');
        await service.settled();
        expect(pushes).toEqual([]);
        second();
        status('running');
        status('idle');
        await service.settled();
        expect(pushes.length).toBe(1);
        expect(await service.hasOfflineApprovals()).toBe(true);
    });

    test('revocation removes persisted subscriptions and wins over queued notifications', async () => {
        status('running');
        status('idle');
        await auth.revoke(sessionId);
        await service.settled();
        expect(pushes).toEqual([]);
        expect(await service.hasOfflineApprovals()).toBe(false);
        expect(await new AuthStore(home).pushSubscriptions()).toEqual([]);
    });

    test('a concurrent subscription save cannot resurrect a revoked key on disk', async () => {
        await Promise.all([auth.setPush(sessionId, { ...subscription, follow: ['other'] }), auth.revoke(sessionId)]);
        const restarted = new AuthStore(home);
        expect(await restarted.pushSubscriptions()).toEqual([]);
        expect(await restarted.list(null)).toEqual([]);
    });

    test('subscriptions survive restarts and cannot be assigned to secret or bearer-only clients', async () => {
        expect(await new AuthStore(home).pushSubscriptions()).toEqual([{ sessionId, subscription }]);
        const bearer = await auth.pair(auth.issuePairingToken(), { label: 'Old client' });
        const dispatcher = new Dispatcher();
        registerPushHandlers(dispatcher, auth);
        for (const owner of [null, bearer!.id, 'missing']) {
            const replies: ServerFrame[] = [];
            await dispatcher.handle(
                { id: 'client', access: { reachability: 'loopback', sessionId: owner }, send: (frame) => replies.push(frame) },
                JSON.stringify({ id: 'push', type: 'push.subscribe', payload: subscription })
            );
            expect(replies[0]).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
        }
        expect(await readFile(join(home, 'auth.json'), 'utf8')).toContain(subscription.publicKey);
    });

    test('approvals notify once per request even outside followed nodes and carry expiry/choices', async () => {
        const approval = {
            requestId: 'request',
            sessionId: 'other',
            toolName: 'Shell',
            summary: 'Run test',
            choices: [{ id: 'allow', kind: 'allow' as const, label: 'Allow' }],
            createdAt: NOW,
            expiresAt: NOW + 110_000
        };
        service.consume({ event: 'session.approvals', payload: { sessionId: 'other', approvals: [approval] } });
        service.consume({ event: 'session.approvals', payload: { sessionId: 'other', approvals: [approval] } });
        await service.settled();
        expect(pushes.length).toBe(1);
        expect(decrypt(pushes[0]!)).toMatchObject({
            kind: 'approval',
            nodeId: 'other',
            requestId: 'request',
            expiresAt: approval.expiresAt,
            choices: approval.choices
        });
        await auth.setPush(sessionId, { ...subscription, approvals: false });
        service.consume({ event: 'session.approvals', payload: { sessionId: 'other', approvals: [{ ...approval, requestId: 'second' }] } });
        await service.settled();
        expect(pushes.length).toBe(1);
    });

    test('foreground devices still receive ActivityKit phase updates while alerts stay quiet', async () => {
        await auth.setPush(sessionId, { ...subscription, activities: true });
        const disconnected = service.connected(sessionId);
        status('running');
        await service.settled();
        status('idle');
        await service.settled();
        expect(pushes.map((push) => push.pushType)).toEqual(['liveactivity', 'liveactivity']);
        expect(pushes.filter((push) => push.pushType === 'liveactivity').map((push) => push.activity.phase)).toEqual(['running', 'done']);
        disconnected();
    });

    test('an explicit latest chat limits activities without changing alert follows', async () => {
        await auth.setPush(sessionId, { ...subscription, activities: true, activityNodeId: 'other' });
        status('running');
        await service.settled();
        expect(pushes.length).toBe(0);
        status('idle');
        await service.settled();
        expect(pushes.map((push) => push.pushType)).toEqual(['alert']);
        await auth.setPush(sessionId, { ...subscription, activities: true, activityNodeId: null });
        status('running');
        await service.settled();
        expect(pushes.length).toBe(1);
    });

    test('activity delivery is explicit opt-in and contains only approved title/phase/time', async () => {
        await auth.setPush(sessionId, { ...subscription, activities: true });
        status('running');
        await service.settled();
        status('idle');
        await service.settled();
        const activities = pushes.filter((push) => push.pushType === 'liveactivity');
        expect(activities.map((push) => push.activity.phase)).toEqual(['running', 'done']);
        expect(activities[0]!.activity).toEqual({ title: 'Secret project', phase: 'running', startedAt: NOW });
    });

    test('an offline paired approval subscription holds a real hook without counting the observer as a viewer', async () => {
        const harness = await makeHarness();
        try {
            await harness.manager.create({ sessionId: 'node', cols: 80, rows: 24, shell: '/bin/sh', args: [], cwd: harness.home });
            harness.manager.observe((event) => service.consume(event));
            harness.manager.offlineApprovals = () => service.hasOfflineApprovals();
            expect(harness.manager.wantsApprovals()).toBe(false);
            let ready!: () => void;
            const appeared = new Promise<void>((resolve) => {
                ready = resolve;
            });
            const stop = harness.manager.observe((event) => {
                if (event.event === 'session.approvals' && event.payload.approvals.length) {
                    ready();
                }
            });
            const token = harness.manager.get('node')!.hookToken;
            const decision = harness.manager.holdApproval(
                token,
                { hook_event_name: 'PermissionRequest', session_id: 'cli', tool_name: 'Bash', tool_input: { command: 'pwd' } },
                new AbortController().signal
            );
            await appeared;
            const approval = harness.manager.list()[0]!.approvals![0]!;
            expect(harness.manager.answerApproval('node', approval.requestId, approval.choices[0]!.id)).toBe(true);
            expect(await decision).not.toBeNull();
            stop();
            await auth.revoke(sessionId);
            expect(
                await harness.manager.holdApproval(
                    token,
                    { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'pwd' } },
                    new AbortController().signal
                )
            ).toBeNull();
        } finally {
            await harness.cleanup();
        }
    });
});
