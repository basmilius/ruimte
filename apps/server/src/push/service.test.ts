import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUSH_HKDF_SALT, pushEncryptionInfo, pushMessage, pushRoutingMessage, type PushEnvelope } from '@ruimte/pulsar';
import type { AgentStatus, PushSubscribePayload, ServerFrame } from '@ruimte/contracts';
import { AuthStore } from '../auth/auth-store.ts';
import { verifySignature } from '@ruimte/pulsar/verify-node';
import { generateKeyPair, signMessage } from '../auth/keys.ts';
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
    if (push.pushType === 'liveactivity') {
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
    for (const target of ['terminal', 'chat'] as const) {
        for (const activityScope of [undefined, 'machine'] as const) {
            test(`${target} completion updates ${activityScope ?? 'conversation'} activities without an alert or unread entry`, async () => {
                await auth.setPush(sessionId, { ...subscription, activities: true, activityScope });
                for (const phase of ['running', 'idle'] as const) {
                    if (target === 'terminal') {
                        status(phase);
                    } else {
                        service.consume({
                            event: 'chat.event',
                            payload: {
                                chatId: 'node',
                                event: {
                                    type: 'info',
                                    info: {
                                        chatId: 'node',
                                        provider: 'codex',
                                        cwd: home,
                                        agentSessionId: 'cli',
                                        model: null,
                                        selection: { model: 'default', options: {} },
                                        runtimeMode: 'supervised',
                                        status: phase,
                                        running: true,
                                        activeTurnId: phase === 'running' ? 'turn' : null,
                                        slashCommands: [],
                                        usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
                                        createdAt: NOW
                                    }
                                }
                            }
                        });
                    }
                    await service.settled();
                }
                expect(pushes.map((push) => push.pushType)).toEqual(['liveactivity', 'liveactivity']);
                expect(pushes.filter((push) => push.pushType === 'liveactivity').map((push) => push.activity.phase)).toEqual(['running', 'done']);
                expect(service.attention.snapshot()).toEqual([]);
            });
        }
    }

    test('subscribed attention is signed and decrypts, with no plaintext title/node/body', async () => {
        status('running');
        status('needs-you');
        await service.settled();
        expect(pushes.length).toBe(1);
        const push = pushes[0]!;
        expect(verifySignature(machine.publicKey, pushMessage(push), push.signature)).toBe(true);
        expect(JSON.stringify(push)).not.toContain('Secret project');
        expect(decrypt(push)).toMatchObject({ kind: 'attention', target: 'terminal', nodeId: 'node', title: 'Secret project' });
        expect(() => decrypt({ ...push, handle: 'z'.repeat(43) })).toThrow();
        expect(() => decrypt({ ...push, collapseId: 'z'.repeat(43) })).toThrow();
    });

    test('the same node id on another machine gets a different collapse id', async () => {
        status('running');
        status('needs-you');
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
        status('needs-you', 'node', other);
        await other.settled();
        expect(pushes.length).toBe(2);
        expect(pushes[0]!.collapseId).not.toBe(pushes[1]!.collapseId);
    });

    test('only followed nodes notify, repeated status and initial idle do not', async () => {
        status('idle');
        status('running', 'unfollowed');
        status('needs-you', 'unfollowed');
        status('running');
        status('needs-you');
        status('needs-you');
        await service.settled();
        expect(pushes.length).toBe(1);
    });

    test('two connections of one paired key suppress delivery until both close', async () => {
        const first = service.connected(sessionId);
        const second = service.connected(sessionId);
        first();
        status('running');
        status('needs-you');
        await service.settled();
        expect(pushes).toEqual([]);
        second();
        status('running');
        status('needs-you');
        await service.settled();
        expect(pushes.length).toBe(1);
    });

    test('revocation removes persisted subscriptions and wins over queued notifications', async () => {
        status('running');
        status('needs-you');
        await auth.revoke(sessionId);
        await service.settled();
        expect(pushes).toEqual([]);
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

    test('a chat approval notifies once per request even outside followed nodes and carries its choices', async () => {
        const approval = (requestId: string) => ({
            event: 'chat.event' as const,
            payload: {
                chatId: 'other',
                event: {
                    type: 'item' as const,
                    item: {
                        id: requestId,
                        createdAt: NOW,
                        turnId: null,
                        kind: 'approval' as const,
                        requestId,
                        toolUseId: null,
                        toolName: 'Bash',
                        input: {},
                        description: 'Run test',
                        canAllowAlways: false,
                        decision: 'pending' as const
                    }
                }
            }
        });
        service.consume(approval('request'));
        service.consume(approval('request'));
        await service.settled();
        expect(pushes.length).toBe(1);
        expect(decrypt(pushes[0]!)).toMatchObject({ kind: 'approval', target: 'chat', nodeId: 'other', requestId: 'request', body: 'Run test' });
        await auth.setPush(sessionId, { ...subscription, approvals: false });
        service.consume(approval('second'));
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
        status('needs-you');
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
});

describe('automatic machine activities', () => {
    const activities = () => pushes.filter((push) => push.pushType === 'liveactivity');
    const automatic = async () => auth.setPush(sessionId, { ...subscription, follow: [], followAll: true, activities: true, activityScope: 'machine' });

    test('each row keeps its own turn start through attention and resets on the next turn', async () => {
        await automatic();
        let now = NOW;
        const target = new PushService({
            auth,
            identity: { id: 'machine', sign: (text) => signMessage(machine.privateKey, text) },
            now: () => now,
            send: async (push) => {
                pushes.push(push);
                return 204;
            }
        });
        const rowTimes = () =>
            Object.fromEntries(
                activities()
                    .at(-1)!
                    .activity.agents!.map((agent) => [agent.nodeId, agent.startedAt])
            );
        status('running', 'first', target);
        now += 60_000;
        status('running', 'second', target);
        now += 60_000;
        status('needs-you', 'first', target);
        await target.settled();
        expect(rowTimes()).toEqual({ first: NOW, second: NOW + 60_000 });
        status('running', 'first', target);
        await target.settled();
        expect(rowTimes()).toEqual({ first: NOW, second: NOW + 60_000 });
        status('idle', 'first', target);
        now += 60_000;
        status('running', 'first', target);
        await target.settled();
        expect(rowTimes()).toEqual({ first: NOW + 180_000, second: NOW + 60_000 });
    });

    test('combines agents, prioritizes attention, and ends only when everyone has finished', async () => {
        await automatic();
        status('running', 'first');
        status('running', 'second');
        status('needs-you', 'first');
        status('idle', 'second');
        status('idle', 'first');
        await service.settled();
        expect(activities().map((push) => [push.activity.phase, push.activity.runningCount, push.activity.attentionCount])).toEqual([
            ['running', 1, 0],
            ['running', 2, 0],
            ['needs-you', 1, 1],
            ['needs-you', 0, 1],
            ['done', 0, 0]
        ]);
        expect(new Set(activities().map((push) => push.collapseId)).size).toBe(1);
        expect(activities().every((push) => verifySignature(machine.publicKey, pushMessage(push), push.signature))).toBe(true);
        expect(pushes.filter((push) => push.pushType === 'alert').length).toBe(1);
    });

    test('a terminal exit removes it from the overview and duplicate status does not resend', async () => {
        await automatic();
        status('running');
        status('running');
        service.consume({ event: 'session.exit', payload: { sessionId: 'node', exitCode: 0 } });
        await service.settled();
        expect(activities().map((push) => push.activity.phase)).toEqual(['running', 'done']);
    });

    test('subscription sync includes work already running and keeps machine routes separate', async () => {
        await automatic();
        for (const id of ['first-machine', 'second-machine']) {
            const target = new PushService({
                auth,
                identity: { id, sign: (text) => signMessage(machine.privateKey, text) },
                now: () => NOW,
                machineName: () => id,
                activityNodes: () =>
                    (['running', 'needs-you', 'idle'] as const).map((status, index) => ({
                        nodeId: `agent-${index}`,
                        target: 'chat',
                        title: `Agent ${index}`,
                        status
                    })),
                send: async (push) => {
                    pushes.push(push);
                    return 204;
                }
            });
            target.synchronizeActivities();
            await target.settled();
        }
        expect(activities().length).toBe(2);
        expect(activities()[0]!.collapseId).not.toBe(activities()[1]!.collapseId);
        expect(activities().every((push) => push.activity.runningCount === 1 && push.activity.attentionCount === 1)).toBe(true);
    });

    test('automatic activities still respect opt-out and foreground suppresses only alerts', async () => {
        await automatic();
        const disconnect = service.connected(sessionId);
        status('running', 'unfollowed');
        status('idle', 'unfollowed');
        await service.settled();
        expect(pushes.map((push) => push.pushType)).toEqual(['liveactivity', 'liveactivity']);
        await auth.setPush(sessionId, { ...subscription, activities: false, activityScope: 'machine' });
        status('running', 'unfollowed');
        await service.settled();
        expect(pushes.length).toBe(2);
        disconnect();
    });
});

test('a read sends a signed encrypted background push only once, after the alert', async () => {
    await auth.setPush(sessionId, { ...subscription, readSync: true });
    status('running');
    status('needs-you');
    await service.settled();
    const issuedAt = service.attention.snapshot()[0]!.issuedAt;
    service.read('node', issuedAt);
    service.read('node', issuedAt);
    await service.settled();
    expect(pushes.map((push) => push.pushType)).toEqual(['alert', 'background']);
    const clear = pushes[1]!;
    expect(verifySignature(machine.publicKey, pushMessage(clear), clear.signature)).toBe(true);
    expect(decrypt(clear)).toEqual({ nodeId: 'node', through: issuedAt, expiresAt: NOW + 120000 });
    expect(JSON.stringify(clear)).not.toContain('node');
});

test('an attention request seen before delivery does not leave an obsolete alert', async () => {
    await auth.setPush(sessionId, { ...subscription, readSync: true });
    status('running');
    status('needs-you');
    service.read('node', service.attention.snapshot()[0]!.issuedAt);
    await service.settled();
    expect(pushes.map((push) => push.pushType)).toEqual(['background']);
});

test('machine cards prioritize attention, bound the rows and sign session destinations', async () => {
    await auth.setPush(sessionId, { ...subscription, activities: true, activityScope: 'machine' });
    const target = new PushService({
        auth,
        identity: { id: 'machine', sign: (text) => signMessage(machine.privateKey, text) },
        now: () => NOW,
        activityNodes: () => [
            { nodeId: 'first', target: 'terminal', title: 'Build app', status: 'running' },
            { nodeId: 'second', target: 'chat', title: 'Write tests', status: 'needs-you' },
            { nodeId: 'third', target: 'chat', title: 'Also running', status: 'running' },
            { nodeId: 'old', target: 'chat', title: 'Finished', status: 'idle' }
        ],
        send: async (push) => {
            pushes.push(push);
            return 204;
        }
    });
    target.synchronizeActivities();
    await target.settled();
    const push = pushes.find((item) => item.pushType === 'liveactivity')!;
    expect(push.activity).toMatchObject({
        runningCount: 2,
        attentionCount: 1,
        agents: [
            { nodeId: 'second', target: 'chat', title: 'Write tests', phase: 'needs-you' },
            { nodeId: 'first', target: 'terminal', title: 'Build app', phase: 'running' }
        ]
    });
    expect(verifySignature(machine.publicKey, pushMessage(push), push.signature)).toBe(true);
    push.activity.agents![0]!.nodeId = 'other';
    expect(verifySignature(machine.publicKey, pushMessage(push), push.signature)).toBe(false);
});

test('killing the last terminal ends its machine round before another terminal starts', async () => {
    await auth.setPush(sessionId, { ...subscription, activities: true, activityScope: 'machine' });
    const harness = await makeHarness();
    let now = NOW;
    const target = new PushService({
        auth,
        identity: { id: 'machine', sign: (text) => signMessage(machine.privateKey, text) },
        now: () => now,
        activityNodes: () =>
            harness.manager.list().flatMap((session) =>
                session.agent && !session.exited
                    ? [
                          {
                              nodeId: session.sessionId,
                              target: 'terminal' as const,
                              title: 'Test agent',
                              status: session.agent.status
                          }
                      ]
                    : []
            ),
        send: async (push) => {
            pushes.push(push);
            return 204;
        }
    });
    const stop = harness.manager.observe((event) => target.consume(event));
    try {
        for (const nodeId of ['first', 'second']) {
            await harness.manager.create({ sessionId: nodeId, cols: 80, rows: 24, shell: '/bin/sh', args: [], cwd: harness.home });
            await harness.manager.applyHook('codex', harness.manager.get(nodeId)!.hookToken, { session_id: nodeId, hook_event_name: 'UserPromptSubmit' });
            await target.settled();
            const pty = harness.adapter.forSession(nodeId);
            await harness.manager.kill(nodeId);
            await pty.exited;
            await target.settled();
            expect(pushes.filter((push) => push.pushType === 'liveactivity').at(-1)?.activity.phase).toBe('done');
            now += 1000;
        }
        const starts = pushes.filter((push) => push.pushType === 'liveactivity').filter((push) => push.activity.phase === 'running');
        expect(starts.map((push) => push.activity.startedAt)).toEqual([NOW, NOW + 1000]);
    } finally {
        stop();
        await target.settled();
        await harness.cleanup();
    }
});

test('requested notifications reach connected clients and subscribed offline devices without changing agent status', async () => {
    const notifications: unknown[] = [];
    const off = service.observeNotification((alert) => notifications.push(alert));
    status('running');
    service.notify('terminal', 'node', 'Build', 'The build is ready.', { projectId: 'project', viewId: 'main' });
    status('idle');
    await service.settled();
    expect(notifications).toEqual([{ projectId: 'project', viewId: 'main', nodeId: 'node', title: 'Build', body: 'The build is ready.' }]);
    expect(pushes).toHaveLength(1);
    expect(decrypt(pushes[0]!)).toMatchObject({ kind: 'attention', target: 'terminal', nodeId: 'node', body: 'The build is ready.' });
    off();
    service.notify('terminal', 'unfollowed', 'Build', 'Done', { projectId: 'project', viewId: 'main' });
    await service.settled();
    expect(notifications).toHaveLength(1);
    expect(pushes).toHaveLength(1);
});

test('a requested notification uses the connected event without also pushing to that device', async () => {
    const disconnect = service.connected(sessionId);
    const notifications: unknown[] = [];
    const off = service.observeNotification((alert) => notifications.push(alert));
    service.notify('chat', 'node', 'Review', 'Review complete.', { projectId: 'project', viewId: 'node' });
    await service.settled();
    expect(notifications).toHaveLength(1);
    expect(pushes).toEqual([]);
    off();
    disconnect();
});
