import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUSH_HKDF_SALT, pushEncryptionInfo, pushMessage, pushRoutingMessage, type PushEnvelope } from '@ruimte/pulsar';
import type { AgentRequest, AgentStatus, ChatRequestSummary, ProcessAlert, PushSubscribePayload, ServerFrame } from '@ruimte/contracts';
import { AuthStore } from '../auth/auth-store.ts';
import { admitClient } from '../auth/test-admit.ts';
import { verifySignature } from '@ruimte/pulsar/verify-node';
import { generateKeyPair, signMessage } from '../auth/keys.ts';
import { Dispatcher } from '../dispatcher.ts';
import { registerPushHandlers } from '../handlers/push.ts';
import { makeHarness } from '../sessions/test-helpers.ts';
import { ManualClock } from '@adecore/agents/testing';
import { PushService } from './service.ts';
import { SnoozeStore } from './snoozes.ts';

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

function decrypt(push: PushEnvelope): unknown {
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
}

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-push-'));
    auth = new AuthStore(home, () => NOW);
    sessionId = await admitClient(auth, generateKeyPair().publicKey, 'Phone');
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

function approvalFrame(
    chatId: string,
    requestId: string,
    options: { description?: string; decision?: 'pending' | 'allow' } = {}
): Parameters<PushService['consume']>[0] {
    return {
        event: 'chat.event',
        payload: {
            chatId,
            event: {
                type: 'item',
                item: {
                    id: requestId,
                    createdAt: NOW,
                    turnId: null,
                    kind: 'approval',
                    requestId,
                    toolUseId: null,
                    toolName: 'Bash',
                    input: {},
                    description: options.description ?? 'Run test',
                    canAllowAlways: false,
                    decision: options.decision ?? 'pending'
                }
            }
        }
    };
}

function status(value: AgentStatus, nodeId = 'node', destination = service, requests?: AgentRequest[]): void {
    return destination.consume({
        event: 'session.status',
        payload: {
            sessionId: nodeId,
            agent: {
                kind: 'codex',
                agentSessionId: 'cli',
                transcriptPath: null,
                status: value,
                suggestedTitle: 'Secret project',
                ...(requests ? { requests } : {}),
                live: true,
                updatedAt: NOW
            }
        }
    });
}

function shellRequest(command: string): AgentRequest {
    return { id: command, source: '', kind: 'approval', toolName: 'Bash', title: null, text: command, createdAt: NOW };
}

function chatInfo(value: AgentStatus, requests?: ChatRequestSummary[]): Parameters<PushService['consume']>[0] {
    return {
        event: 'chat.event',
        payload: {
            chatId: 'node',
            event: {
                type: 'info',
                info: {
                    chatId: 'node',
                    provider: 'claude',
                    cwd: home,
                    agentSessionId: 'cli',
                    model: null,
                    selection: { model: 'default', options: {} },
                    runtimeMode: 'supervised',
                    status: value,
                    running: true,
                    activeTurnId: 'turn',
                    slashCommands: [],
                    usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
                    ...(requests ? { requests } : {}),
                    createdAt: NOW
                }
            }
        }
    };
}

const alertBodies = (): unknown[] => pushes.filter((push) => push.pushType === 'alert').map((push) => (decrypt(push) as { body: string }).body);

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

    test('subscriptions survive restarts and cannot be assigned to the local secret or a client the machine does not know', async () => {
        expect(await new AuthStore(home).pushSubscriptions()).toEqual([{ sessionId, subscription }]);
        const dispatcher = new Dispatcher();
        registerPushHandlers(dispatcher, auth);
        for (const owner of [null, 'missing']) {
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
        service.consume(approvalFrame('other', 'request'));
        service.consume(approvalFrame('other', 'request'));
        await service.settled();
        expect(pushes.length).toBe(1);
        expect(decrypt(pushes[0]!)).toMatchObject({ kind: 'approval', target: 'chat', nodeId: 'other', requestId: 'request', body: 'Run test' });
        await auth.setPush(sessionId, { ...subscription, approvals: false });
        service.consume(approvalFrame('other', 'second'));
        await service.settled();
        expect(pushes.length).toBe(1);
    });

    test('a long approval is cut between two characters, so the phone still reads its choices', async () => {
        // The emoji takes the 500th and 501st unit.
        const description = `${'x'.repeat(499)}😀 and more`;
        service.consume(approvalFrame('other', 'long', { description }));
        await service.settled();
        expect(decrypt(pushes[0]!)).toMatchObject({ kind: 'approval', body: 'x'.repeat(499) });
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
        expect(pushes.filter((push) => push.pushType === 'liveactivity')[0]!.activity).toEqual({
            title: 'Secret project',
            phase: 'running',
            startedAt: NOW
        });
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
});

describe('what a wait says on the phone', () => {
    test('a terminal waiting on a command names the kind, never the command', async () => {
        status('running');
        status('needs-you', 'node', service, [shellRequest('export TOKEN=secret && deploy')]);
        await service.settled();
        expect(alertBodies()).toEqual(['Wants to run a command']);
        expect(JSON.stringify(pushes.map((push) => decrypt(push)))).not.toContain('secret');
    });

    test('a chat question says it asks one, and counts what waits behind it', async () => {
        const question: ChatRequestSummary = {
            requestId: 'question',
            itemId: 'question',
            kind: 'question',
            createdAt: NOW,
            question: { questions: [{ id: 'q', header: 'Database', question: 'Which customer database?', choices: [], multiSelect: false }] }
        };
        const approval: ChatRequestSummary = {
            requestId: 'approval',
            itemId: 'approval',
            kind: 'approval',
            createdAt: NOW,
            approval: { toolName: 'WebFetch', subject: 'example.com', description: null, canAllowAlways: false }
        };
        service.consume(chatInfo('running'));
        service.consume(chatInfo('needs-you', [question, approval]));
        await service.settled();
        expect(alertBodies()).toEqual(['Asks a question, and 1 more']);
    });

    test('a wait without a request keeps the words it always had', async () => {
        status('running');
        status('needs-you');
        await service.settled();
        expect(alertBodies()).toEqual(['The agent needs your attention.']);
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

test('marks only the nodes a person can open, in the ledger a client asks for and in what it hears', async () => {
    const shown = new PushService({
        auth,
        identity: { id: 'machine', sign: (text) => signMessage(machine.privateKey, text) },
        now: () => NOW,
        shows: (nodeId) => nodeId === 'node',
        send: async () => 204
    });
    const heard: string[] = [];
    shown.observeAttention((entry) => heard.push(entry.nodeId));
    status('needs-you', 'node', shown);
    status('needs-you', 'hidden-agent', shown);
    await shown.settled();

    expect(shown.attention.snapshot().map((entry) => entry.nodeId)).toEqual(['node', 'hidden-agent']);
    expect(shown.marks().map((entry) => entry.nodeId)).toEqual(['node']);
    expect(heard).toEqual(['node']);
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

describe('a snoozed node', () => {
    let clock: ManualClock;
    let snoozes: SnoozeStore;
    let snoozing: PushService;

    beforeEach(() => {
        clock = new ManualClock();
        snoozes = new SnoozeStore({ clock });
        snoozing = new PushService({
            auth,
            identity: { id: 'machine', sign: (text) => signMessage(machine.privateKey, text) },
            now: () => NOW,
            send: async (push) => {
                pushes.push(push);
                return 204;
            },
            snoozes
        });
    });

    afterEach(async () => {
        snoozes.stop();
        await snoozing.settled();
    });

    const alerts = (): PushEnvelope[] => pushes.filter((push) => push.pushType === 'alert');

    test('raises no alert while it waits, and raises one when the snooze runs out and it still waits', async () => {
        snoozes.set('project', 'node', clock.now() + 60_000);
        status('running', 'node', snoozing);
        status('needs-you', 'node', snoozing);
        await snoozing.settled();
        expect(alerts()).toEqual([]);
        clock.advance(60_000);
        await snoozing.settled();
        expect(alerts().map((push) => decrypt(push))).toEqual([expect.objectContaining({ kind: 'attention', nodeId: 'node' })]);
    });

    test('a snooze that runs out says what the node still asks', async () => {
        snoozes.set('project', 'node', clock.now() + 60_000);
        status('running', 'node', snoozing);
        status('needs-you', 'node', snoozing, [shellRequest('bun test')]);
        clock.advance(60_000);
        await snoozing.settled();
        expect(alertBodies()).toEqual(['Wants to run a command']);
    });

    test('takes back the alert it already raised', async () => {
        await auth.setPush(sessionId, { ...subscription, readSync: true });
        status('running', 'node', snoozing);
        status('needs-you', 'node', snoozing);
        await snoozing.settled();
        snoozes.set('project', 'node', clock.now() + 60_000);
        await snoozing.settled();
        expect(pushes.map((push) => push.pushType)).toEqual(['alert', 'background']);
        expect(snoozing.attention.snapshot()[0]).toMatchObject({ readThrough: snoozing.attention.snapshot()[0]!.issuedAt });
    });

    test('a node answered under its snooze ends it, and nothing wakes when its time comes', async () => {
        status('running', 'node', snoozing);
        status('needs-you', 'node', snoozing);
        await snoozing.settled();
        snoozes.set('project', 'node', clock.now() + 60_000);
        status('running', 'node', snoozing);
        expect(snoozes.list()).toEqual([]);
        clock.advance(60_000);
        await snoozing.settled();
        expect(alerts()).toHaveLength(1);
    });

    test('a snooze a person ends raises nothing, though the node still waits', async () => {
        status('running', 'node', snoozing);
        status('needs-you', 'node', snoozing);
        snoozes.set('project', 'node', clock.now() + 60_000);
        await snoozing.settled();
        const before = alerts().length;
        snoozes.clear('node');
        clock.advance(60_000);
        await snoozing.settled();
        expect(alerts()).toHaveLength(before);
    });

    test('a snooze that runs out on an approval raises the card with its choices again', async () => {
        status('running', 'node', snoozing);
        snoozes.set('project', 'node', clock.now() + 60_000);
        status('needs-you', 'node', snoozing);
        snoozing.consume(approvalFrame('node', 'request'));
        await snoozing.settled();
        expect(alerts()).toEqual([]);
        clock.advance(60_000);
        await snoozing.settled();
        expect(alerts().map((push) => decrypt(push))).toEqual([
            expect.objectContaining({
                kind: 'approval',
                nodeId: 'node',
                requestId: 'request',
                choices: [expect.objectContaining({ id: 'allow' }), expect.objectContaining({ id: 'deny' })]
            })
        ]);
    });

    test("a followed node's own activity goes quiet while it is snoozed", async () => {
        await auth.setPush(sessionId, { ...subscription, activities: true });
        status('running', 'node', snoozing);
        status('needs-you', 'node', snoozing);
        snoozes.set('project', 'node', clock.now() + 60_000);
        await snoozing.settled();
        clock.advance(60_000);
        await snoozing.settled();
        const phases = pushes.filter((push) => push.pushType === 'liveactivity').map((push) => push.activity.phase);
        expect(phases).toEqual(['running', 'needs-you', 'done', 'needs-you']);
    });

    test('leaves the machine activity until it runs out', async () => {
        await auth.setPush(sessionId, { ...subscription, follow: [], followAll: true, activities: true, activityScope: 'machine' });
        status('running', 'first', snoozing);
        status('needs-you', 'first', snoozing);
        snoozes.set('project', 'first', clock.now() + 60_000);
        clock.advance(60_000);
        await snoozing.settled();
        const counts = pushes
            .filter((push) => push.pushType === 'liveactivity')
            .map((push) => [push.activity.phase, push.activity.runningCount, push.activity.attentionCount]);
        expect(counts).toEqual([
            ['running', 1, 0],
            ['needs-you', 0, 1],
            ['done', 0, 0],
            ['needs-you', 0, 1]
        ]);
    });
});

describe('what a device chose to hear of', () => {
    let chosen: PushService;

    beforeEach(() => {
        chosen = new PushService({
            auth,
            identity: { id: 'machine', sign: (text) => signMessage(machine.privateKey, text) },
            now: () => NOW,
            projectOf: (nodeId) => (nodeId.startsWith('quiet') ? 'quiet-project' : 'project'),
            targetOf: () => 'chat',
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
        await chosen.settled();
    });

    const alerts = (): unknown[] => pushes.filter((push) => push.pushType === 'alert').map(decrypt);

    const warning = (id: string, nodeId: string | null): ProcessAlert => ({
        id,
        kind: 'memory',
        nodeId,
        pid: 42,
        startTime: 1,
        name: 'node',
        since: NOW,
        value: 1
    });

    test('a finished turn pushes only to a device that asked, and marks nothing unread', async () => {
        status('running', 'node', chosen);
        status('idle', 'node', chosen);
        await chosen.settled();
        expect(alerts()).toEqual([]);
        await auth.setPush(sessionId, { ...subscription, notify: ['needs-you', 'turn'] });
        status('running', 'node', chosen);
        status('idle', 'node', chosen);
        status('running', 'node', chosen);
        status('error', 'node', chosen);
        await chosen.settled();
        expect(alerts()).toMatchObject([
            { kind: 'turn', nodeId: 'node', body: 'The agent finished its turn.' },
            { kind: 'turn', nodeId: 'node', body: 'The agent stopped with an error.' }
        ]);
        expect(chosen.attention.snapshot()).toEqual([]);
    });

    test('a device that left out needs-you hears of no wait and no approval', async () => {
        await auth.setPush(sessionId, { ...subscription, notify: ['turn'] });
        status('running', 'node', chosen);
        status('needs-you', 'node', chosen);
        chosen.consume(approvalFrame('node', 'approval-no-needs-you'));
        chosen.alert('chat', 'node', 'Task failed', 'It failed');
        await chosen.settled();
        expect(alerts()).toEqual([]);
    });

    test("a project's own list wins over the device's, and an empty one keeps the project quiet", async () => {
        await auth.setPush(sessionId, {
            ...subscription,
            follow: [],
            followAll: true,
            notify: ['needs-you'],
            projects: [
                { projectId: 'quiet-project', notify: [] },
                { projectId: 'project', notify: ['needs-you', 'turn'] }
            ]
        });
        status('running', 'quiet', chosen);
        status('needs-you', 'quiet', chosen);
        status('running', 'node', chosen);
        status('idle', 'node', chosen);
        await chosen.settled();
        expect(alerts()).toMatchObject([{ kind: 'turn', nodeId: 'node' }]);
    });

    test('a process warning about a node pushes once while it stays raised', async () => {
        await auth.setPush(sessionId, { ...subscription, notify: ['process'] });
        chosen.processAlerts([warning('memory:node', 'node'), warning('memory:none', null)]);
        chosen.processAlerts([warning('memory:node', 'node')]);
        await chosen.settled();
        expect(alerts()).toMatchObject([{ kind: 'attention', target: 'chat', nodeId: 'node', body: 'node uses a lot of memory.' }]);
        chosen.processAlerts([]);
        chosen.processAlerts([warning('memory:node', 'node')]);
        await chosen.settled();
        expect(alerts().length).toBe(2);
        expect(chosen.attention.snapshot()).toEqual([]);
    });

    test('a device that never chose hears of no process warning', async () => {
        chosen.processAlerts([warning('memory:node', 'node')]);
        await chosen.settled();
        expect(alerts()).toEqual([]);
    });

    test('a kind this machine does not know is dropped, and the rest of the subscription stands', async () => {
        const dispatcher = new Dispatcher();
        registerPushHandlers(dispatcher, auth);
        const replies: ServerFrame[] = [];
        const payload = {
            ...subscription,
            notify: ['turn', 'someday'],
            projects: [{ projectId: 'project', notify: ['someday', 'process'], later: true }]
        };
        await dispatcher.handle(
            { id: 'client', access: { reachability: 'loopback', sessionId }, send: (frame) => replies.push(frame) },
            JSON.stringify({ id: 'subscribe', type: 'push.subscribe', payload })
        );
        expect(replies[0]).toMatchObject({ ok: true });
        const [stored] = await new AuthStore(home).pushSubscriptions();
        expect(stored?.subscription.notify).toEqual(['turn']);
        expect(stored?.subscription.projects).toEqual([{ projectId: 'project', notify: ['process'] }]);
    });

    test('a finished turn and a process warning collapse apart from a wait, and a read still clears the wait', async () => {
        await auth.setPush(sessionId, { ...subscription, readSync: true, notify: ['needs-you', 'turn', 'process'] });
        status('running', 'node', chosen);
        status('needs-you', 'node', chosen);
        await chosen.settled();
        const wait = pushes.at(-1)!;
        status('running', 'node', chosen);
        await chosen.settled();
        const read = pushes.at(-1)!;
        status('idle', 'node', chosen);
        chosen.processAlerts([warning('memory:node', 'node')]);
        await chosen.settled();
        const [turn, process] = pushes.slice(-2);
        expect(decrypt(wait)).toMatchObject({ kind: 'attention' });
        expect(read.pushType).toBe('background');
        expect(read.collapseId).toBe(wait.collapseId);
        expect(decrypt(turn!)).toMatchObject({ kind: 'turn' });
        expect(decrypt(process!)).toMatchObject({ kind: 'attention', body: 'node uses a lot of memory.' });
        expect(new Set([wait.collapseId, turn!.collapseId, process!.collapseId]).size).toBe(3);
        status('running', 'node', chosen);
        status('idle', 'node', chosen);
        await chosen.settled();
        expect(pushes.at(-1)!.collapseId).toBe(turn!.collapseId);
    });

    test('push.preferences reads back what the asking device chose, defaults filled in', async () => {
        const dispatcher = new Dispatcher();
        registerPushHandlers(dispatcher, auth);
        const ask = async (owner: string | null): Promise<ServerFrame> => {
            const replies: ServerFrame[] = [];
            await dispatcher.handle(
                { id: 'client', access: { reachability: 'loopback', sessionId: owner }, send: (frame) => replies.push(frame) },
                JSON.stringify({ id: 'read', type: 'push.preferences', payload: {} })
            );
            return replies[0]!;
        };
        expect(await ask(sessionId)).toMatchObject({ ok: true, result: { subscribed: true, approvals: true, notify: ['needs-you'], projects: [] } });
        const projects = [{ projectId: 'project', notify: ['turn' as const] }];
        await auth.setPush(sessionId, { ...subscription, notify: ['process'], projects });
        expect(await ask(sessionId)).toMatchObject({ ok: true, result: { subscribed: true, notify: ['process'], projects } });
        await auth.removePush(sessionId, subscription.handle);
        expect(await ask(sessionId)).toMatchObject({ ok: true, result: { subscribed: false, notify: ['needs-you'], projects: [] } });
        expect(await ask(null)).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    });
});

describe('a person at a desktop', () => {
    let now: number;
    let timers: { at: number; run: () => void }[];
    let held: PushService;

    const advance = async (ms: number): Promise<void> => {
        now += ms;
        const due = timers.filter((timer) => timer.at <= now);
        timers = timers.filter((timer) => timer.at > now);
        due.forEach((timer) => timer.run());
        await held.settled();
    };

    beforeEach(() => {
        now = NOW;
        timers = [];
        held = new PushService({
            auth,
            identity: { id: 'machine', sign: (text) => signMessage(machine.privateKey, text) },
            now: () => now,
            send: async (push) => {
                pushes.push(push);
                return 204;
            },
            schedule: (delayMs, run) => {
                const timer = { at: now + delayMs, run };
                timers.push(timer);
                return () => {
                    timers = timers.filter((entry) => entry !== timer);
                };
            }
        });
        held.reportPresence('desktop', true);
    });

    afterEach(async () => {
        await held.settled();
    });

    test('holds a wait, and sends it after a minute when it is still unread', async () => {
        status('running', 'node', held);
        status('needs-you', 'node', held);
        await held.settled();
        expect(pushes).toEqual([]);
        await advance(30_000);
        held.reportPresence('desktop', true);
        await advance(30_000);
        expect(pushes.length).toBe(1);
    });

    test('a held wait says what the node asks when it goes out', async () => {
        status('running', 'node', held);
        status('needs-you', 'node', held);
        status('needs-you', 'node', held, [shellRequest('bun test')]);
        await advance(60_000);
        expect(alertBodies()).toEqual(['Wants to run a command']);
    });

    test('drops a held wait the desktop read', async () => {
        status('running', 'node', held);
        status('needs-you', 'node', held);
        const entry = held.attention.snapshot().find((candidate) => candidate.nodeId === 'node')!;
        held.read('node', entry.issuedAt);
        await advance(60_000);
        expect(pushes.filter((push) => push.pushType === 'alert')).toEqual([]);
    });

    test('drops a finished turn that came due while the person stayed', async () => {
        await auth.setPush(sessionId, { ...subscription, notify: ['needs-you', 'turn'] });
        status('running', 'node', held);
        status('idle', 'node', held);
        await advance(30_000);
        held.reportPresence('desktop', true);
        await advance(30_000);
        expect(pushes).toEqual([]);
    });

    test('sends everything held at once when the person leaves', async () => {
        await auth.setPush(sessionId, { ...subscription, notify: ['needs-you', 'turn'] });
        status('running', 'node', held);
        status('idle', 'node', held);
        status('needs-you', 'node', held);
        await held.settled();
        expect(pushes).toEqual([]);
        held.reportPresence('desktop', false);
        await held.settled();
        expect(pushes.length).toBe(2);
    });

    test('sends what it held once the presence lapses unrenewed', async () => {
        await auth.setPush(sessionId, { ...subscription, notify: ['needs-you', 'turn'] });
        status('running', 'node', held);
        await advance(30_000);
        status('idle', 'node', held);
        await advance(29_000);
        expect(pushes).toEqual([]);
        await advance(1_000);
        expect(pushes.length).toBe(1);
    });

    test('holds an approval for ten seconds and drops one answered in that time', async () => {
        held.consume(approvalFrame('node', 'request', { decision: 'pending' }));
        await advance(9_000);
        expect(pushes).toEqual([]);
        await advance(1_000);
        expect(decrypt(pushes[0]!)).toMatchObject({ kind: 'approval', requestId: 'request' });
        pushes = [];
        held.consume(approvalFrame('node', 'request', { decision: 'allow' }));
        held.consume(approvalFrame('other', 'request', { decision: 'pending' }));
        held.consume(approvalFrame('other', 'request', { decision: 'allow' }));
        await advance(10_000);
        expect(pushes).toEqual([]);
    });

    test('an alert someone asked for goes out at once', async () => {
        held.notify('chat', 'node', 'Agent', 'Look at this', { projectId: 'project', viewId: 'view' });
        await held.settled();
        expect(pushes.length).toBe(1);
    });
});
