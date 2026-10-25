import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoticeStore } from '@adecore/agents/coordination';
import { REQUEST_SCHEMAS, type AgentBridge, type ProjectCanvasView, type PeerMessagePayload, type ServerFrame } from '@ruimte/contracts';
import { Dispatcher, type ClientConnection } from '../dispatcher.ts';
import { registerAgentBridgeHandlers } from '../handlers/agent-bridges.ts';
import { deliverNotice } from '../context/notices.ts';
import { AgentBridges, type AgentBridgeDeps } from './agent-bridges.ts';

const ID = 'b7880251-89c4-4f9e-8a03-9f98448639e6';
const homes: string[] = [];
afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function machine(name: string) {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-bridge-'));
    homes.push(home);
    const canvas: ProjectCanvasView = {
        id: 'canvas',
        name: `${name} canvas`,
        kind: 'canvas',
        texts: [],
        edges: [],
        layouts: [],
        nodes: [{ id: name, title: name, kind: 'chat', x: 0, y: 0, w: 400, h: 400 }]
    };
    const notices = new NoticeStore(home, () => 1000);
    const wakes: string[] = [];
    let replyTurn = false;
    let remote: { dispatcher: Dispatcher; name: string } | null = null;
    const dispatcher = new Dispatcher();
    let peerCalls = 0;
    let features = true;
    const deps: AgentBridgeDeps = {
        home,
        projects: {
            index: { viewsOf: (projectId: string) => (projectId === name ? [canvas] : []) },
            remote: { machineOf: () => null }
        } as unknown as AgentBridgeDeps['projects'],
        connections: {
            connect: async () => ({
                request: async <T>(type: string, payload: unknown): Promise<T> => {
                    if (type === 'endpoint.info') {
                        return REQUEST_SCHEMAS['endpoint.info'].result.parse({
                            id: 'remote',
                            label: 'Remote',
                            platform: 'darwin',
                            version: '0.23.0',
                            reachability: 'lan',
                            authenticated: true,
                            features: features ? ['peer.message'] : []
                        }) as T;
                    }
                    peerCalls += 1;
                    if (remote === null) {
                        throw new Error('offline');
                    }
                    const answer = await ask(remote.dispatcher, type, payload, name);
                    if (!('ok' in answer) || !answer.ok) {
                        throw new Error('error' in answer ? answer.error.message : 'No reply');
                    }
                    return answer.result as T;
                },
                onFrame: () => () => undefined,
                onLost: () => undefined,
                close: () => undefined
            })
        },
        fromMessage: () => replyTurn,
        messages: {
            alert: () => undefined,
            notify: async (notice, fromMessage = false) => {
                const delivery = await deliverNotice(notices, { terminal: () => null, chat: async () => 'idle', fromMessage: () => fromMessage }, notice);
                if (delivery.wake) {
                    wakes.push(notice.targetId);
                }
                return delivery;
            }
        }
    };
    const bridges = new AgentBridges(deps);
    await bridges.load();
    registerAgentBridgeHandlers(dispatcher, bridges);
    const binding = (other: string): AgentBridge => ({ id: ID, projectId: name, nodeId: name, machineId: other, remoteNodeId: other, label: `${other} agent` });
    return {
        name,
        home,
        bridges,
        deps,
        dispatcher,
        canvas,
        notices,
        wakes,
        binding,
        connect: (other: { dispatcher: Dispatcher; name: string } | null) => {
            remote = other;
        },
        replyTurn: () => {
            replyTurn = true;
        },
        oldVersion: () => {
            features = false;
        },
        calls: () => peerCalls
    };
}

async function ask(dispatcher: Dispatcher, type: string, payload: unknown, peer?: string): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];
    const client: ClientConnection = {
        id: 'client',
        send: (frame) => frames.push(frame),
        ...(peer === undefined ? {} : { access: { reachability: 'lan', sessionId: 'peer', peer: { machineId: peer } } })
    };
    await dispatcher.handle(client, JSON.stringify({ id: 'request', type, payload }));
    return frames[0]!;
}

describe('connections between existing agents on different machines', () => {
    test('exchanges messages in both directions and keeps the one-step wake rule across machines', async () => {
        const a = await machine('windows');
        const b = await machine('mac');
        a.connect(b);
        b.connect(a);
        await a.bridges.bind(a.binding('mac'));
        await b.bridges.bind(b.binding('windows'));
        expect(await a.bridges.send('windows', ID, 'Check the Mac build')).toMatchObject({ at: 'now' });
        expect(b.wakes).toEqual(['mac']);
        expect(b.notices.waiting('mac')[0]).toMatchObject({ from: `bridge:${ID}`, fromTitle: 'windows agent', text: 'Check the Mac build' });
        b.replyTurn();
        expect(await b.bridges.send('mac', ID, 'The build passed')).toMatchObject({ at: 'waiting' });
        expect(a.wakes).toEqual([]);
        expect(a.notices.waiting('windows')[0]?.text).toBe('The build passed');
    });

    test('an agent cannot use the connection of another agent or discover its grants', async () => {
        const a = await machine('windows');
        await a.bridges.bind(a.binding('mac'));
        expect(a.bridges.list('someone-else')).toEqual([]);
        await expect(a.bridges.send('someone-else', ID, 'hello')).rejects.toMatchObject({ code: 'bridge-not-linked' });
        expect(a.calls()).toBe(0);
    });

    test('binds the recipient to both the authenticated machine and the selected sender', async () => {
        const b = await machine('mac');
        await b.bridges.bind(b.binding('windows'));
        const payload: PeerMessagePayload = { bridgeId: ID, fromNodeId: 'windows', text: 'hello', fromMessage: false };
        await expect(b.bridges.receive('someone-else', payload)).rejects.toMatchObject({ code: 'bridge-not-linked' });
        await expect(b.bridges.receive('windows', { ...payload, fromNodeId: 'other-agent' })).rejects.toMatchObject({ code: 'bridge-not-linked' });
        expect(b.wakes).toEqual([]);
    });

    test('a peer cannot bind, enumerate or remove grants, and a person cannot pretend to be a peer sender', async () => {
        const b = await machine('mac');
        for (const type of ['bridge.bind', 'bridge.list', 'bridge.candidates', 'bridge.remove']) {
            expect(await ask(b.dispatcher, type, {}, 'windows')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        }
        expect(await ask(b.dispatcher, 'peer.message', { bridgeId: ID, fromNodeId: 'windows', text: 'hello', fromMessage: false })).toMatchObject({
            ok: false,
            error: { code: 'forbidden' }
        });
    });

    test('rejects oversized messages before delivery and does not expose a peer send without a grant', async () => {
        const b = await machine('mac');
        for (const text of ['', 'x'.repeat(501)]) {
            expect(await ask(b.dispatcher, 'peer.message', { bridgeId: ID, fromNodeId: 'windows', text, fromMessage: false }, 'windows')).toMatchObject({
                ok: false,
                error: { code: 'bad-request' }
            });
        }
        expect(await ask(b.dispatcher, 'peer.message', { bridgeId: ID, fromNodeId: 'windows', text: 'hello', fromMessage: false }, 'windows')).toMatchObject({
            ok: false,
            error: { code: 'bridge-not-linked' }
        });
        expect(b.notices.waiting('mac')).toEqual([]);
    });

    test('keeps grants after restart, rejects duplicate pairs and revokes them immediately', async () => {
        const b = await machine('mac');
        await b.bridges.bind(b.binding('windows'));
        await expect(b.bridges.bind({ ...b.binding('windows'), id: '0ba6335d-f04c-4e5c-a290-9f359276d728' })).rejects.toMatchObject({ code: 'bridge-exists' });
        const restored = new AgentBridges(b.deps);
        await restored.load();
        expect(restored.list('mac')).toHaveLength(1);
        await restored.remove(ID);
        await expect(restored.receive('windows', { bridgeId: ID, fromNodeId: 'windows', text: 'hello', fromMessage: false })).rejects.toMatchObject({
            code: 'bridge-not-linked'
        });
    });

    test('deleted or hidden recipients cannot be messaged; leaving the account clears the grants', async () => {
        const b = await machine('mac');
        await b.bridges.bind(b.binding('windows'));
        b.canvas.hidden = true;
        expect(b.bridges.list('mac')).toEqual([]);
        await expect(b.bridges.receive('windows', { bridgeId: ID, fromNodeId: 'windows', text: 'hello', fromMessage: false })).rejects.toMatchObject({
            code: 'bridge-not-linked'
        });
        b.canvas.hidden = undefined;
        await b.bridges.wipe();
        expect(b.bridges.list('mac')).toEqual([]);
    });

    test('checks the other machine supports messages before sending', async () => {
        const a = await machine('windows');
        await a.bridges.bind(a.binding('mac'));
        a.oldVersion();
        await expect(a.bridges.send('windows', ID, 'hello')).rejects.toMatchObject({ code: 'bridge-update-required' });
        expect(a.calls()).toBe(0);
    });

    test('does not send a message if the person disconnects while the channel opens', async () => {
        const a = await machine('windows');
        await a.bridges.bind(a.binding('mac'));
        const connect = a.deps.connections.connect;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        a.deps.connections.connect = async (id) => {
            await gate;
            return connect(id);
        };
        const pending = a.bridges.send('windows', ID, 'hello');
        await a.bridges.remove(ID);
        release();
        await expect(pending).rejects.toMatchObject({ code: 'bridge-not-linked' });
        expect(a.calls()).toBe(0);
    });
});
