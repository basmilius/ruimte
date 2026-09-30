import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { FakeWatch } from '@ruimte/agents/watch-test-helpers';
import { connectionOpener, socketChannel, type OpenConnection, type SocketChannel } from '../connection.ts';
import { Dispatcher, type ClientAccess } from '../dispatcher.ts';
import { registerDrawingHandlers } from '../handlers/drawing.ts';
import { registerDiagramHandlers } from '../handlers/diagram.ts';
import { ProjectStore } from './project-store.ts';
import { DrawingStore } from './drawing-store.ts';
import { DiagramStore } from './diagram-store.ts';

class Peer {
    readonly socket: WebSocket;
    readonly frames: ServerFrame[] = [];
    private readonly waiters = new Map<string, (frame: ServerFrame) => void>();
    private sequence = 0;

    constructor(socket: WebSocket) {
        this.socket = socket;
        socket.addEventListener('message', ({ data }) => {
            const frame = JSON.parse(String(data)) as ServerFrame;
            this.frames.push(frame);
            const key = 'type' in frame ? frame.event : frame.id;
            if (key) {
                this.waiters.get(key)?.(frame);
                this.waiters.delete(key);
            }
        });
    }

    request(type: string, payload: unknown): Promise<ServerFrame> {
        const id = `${++this.sequence}`;
        const reply = new Promise<ServerFrame>((resolve) => {
            this.waiters.set(id, resolve);
        });
        this.socket.send(JSON.stringify({ id, type, payload }));
        return reply;
    }

    changed(event: string): Promise<ServerFrame> {
        return new Promise((resolve) => {
            this.waiters.set(event, resolve);
        });
    }
}

for (const kind of ['drawing', 'diagram'] as const) {
    test(`${kind} saves cross two real sockets without a writer echo`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'ruimte-view-sockets-'));
        const folder = join(root, 'repo');
        await mkdir(folder);
        const watch = new FakeWatch();
        const projects = new ProjectStore(join(root, 'home'), watch);
        const drawings = new DrawingStore(projects, watch);
        const diagrams = new DiagramStore(projects, watch);
        projects.attachDrawings(drawings);
        projects.attachDiagrams(diagrams);
        const projectId = (await projects.openProject({ folder })).summary.projectId;
        await projects.save(projectId, 0, { name: 'repo', color: '#353e53', views: [{ kind, id: 'view', name: 'View' }] });
        const dispatcher = new Dispatcher();
        registerDrawingHandlers(dispatcher, drawings);
        registerDiagramHandlers(dispatcher, diagrams);
        dispatcher.register('server.hello', () => ({ version: 'test', platform: 'test', home: root }));
        const unused = { subscribe: () => () => undefined, detachAll: () => undefined, get: () => undefined };
        const connect = connectionOpener({
            dispatcher,
            projects,
            drawings,
            diagrams,
            sessions: unused,
            chats: unused,
            identity: unused,
            folders: unused,
            statuses: unused,
            usage: unused,
            limits: unused,
            processes: unused
        });
        const connections = new Map<unknown, { connection: OpenConnection; channel: SocketChannel }>();
        const server = Bun.serve<ClientAccess>({
            hostname: '127.0.0.1',
            port: 0,
            fetch: (request, host) =>
                host.upgrade(request, { data: { reachability: 'loopback', sessionId: null } }) ? undefined : new Response('', { status: 400 }),
            websocket: {
                open: (socket) => {
                    const channel = socketChannel(socket);
                    connections.set(socket, { connection: connect(channel, socket.data), channel });
                },
                message: (socket, message) => connections.get(socket)?.connection.receive(message),
                close: (socket) => {
                    connections.get(socket)?.channel.closed();
                    connections.delete(socket);
                },
                drain: (socket) => connections.get(socket)?.channel.drained()
            }
        });
        const peers: Peer[] = [];
        try {
            for (let i = 0; i < 2; i++) {
                const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
                peers.push(new Peer(socket));
                await new Promise<void>((resolve, reject) => {
                    socket.addEventListener('open', () => resolve(), { once: true });
                    socket.addEventListener('error', () => reject(new Error('The local test socket did not open')), { once: true });
                });
            }
            const [writer, reader] = peers as [Peer, Peer];
            for (const peer of peers) {
                expect(await peer.request(`${kind}.open`, { projectId, viewId: 'view' })).toMatchObject({ ok: true });
            }
            const changed = reader.changed(`${kind}.changed`);
            const content =
                kind === 'drawing'
                    ? { elements: [{ kind: 'rect', id: 'new', x: 0, y: 0, w: 100, h: 60, stroke: 'ink', strokeWidth: 2, seed: 1 }] }
                    : { meta: { title: '', direction: 'right' }, nodes: [{ id: 'new', label: 'New' }], groups: [], edges: [] };
            expect(await writer.request(`${kind}.save`, { projectId, viewId: 'view', baseRev: 0, content })).toMatchObject({ ok: true, result: { rev: 1 } });
            expect(await changed).toMatchObject({
                type: 'event',
                event: `${kind}.changed`,
                payload: { projectId, viewId: 'view', document: { rev: 1, ...content } }
            });
            await watch.settle();
            await Promise.all(peers.map((peer) => peer.request('server.hello', {})));
            expect(writer.frames.filter((frame) => 'type' in frame)).toEqual([]);
            expect(reader.frames.filter((frame) => 'type' in frame)).toHaveLength(1);
        } finally {
            peers.forEach((peer) => peer.socket.close());
            await server.stop(true);
            projects.closeAll();
            await rm(root, { recursive: true, force: true });
        }
    });
}
