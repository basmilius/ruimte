import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLineageStore, TaskStore } from '@adecore/agents/coordination';
import { FakeWatch } from '@adecore/agents/testing';
import type { ProjectContent, ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../../dispatcher.ts';
import { askOnce } from '../../handlers/test-helpers.ts';
import { projectOverlays } from '../../projects/overlays.ts';
import { peerCanvasId } from '../../projects/peer-links.ts';
import { projectLinks } from '../../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../../projects/project-store.ts';
import { peerLinksArea } from './area-links.ts';
import { PeerTasks } from './peer-tasks.ts';

let root: string;
let store: ProjectStore;
let dispatcher: Dispatcher;
let ended: string[];
let heard: string[];
let launched: string[];
let attested: Record<string, number>;
let projectId: string;
let lineage: AgentLineageStore;
let tasks: TaskStore;
let peerTasks: PeerTasks;
let told: string[];

function makePeerTasks(): PeerTasks {
    return new PeerTasks({
        links: store.peers,
        projects: store,
        lineage,
        tasks,
        outbox: { list: () => [], remove: async () => undefined },
        enqueue: async () => undefined,
        prompts: { put: async () => undefined, take: async () => null },
        stopNode: async () => undefined,
        installed: async () => ['claude'],
        exists: () => false,
        git: () => {
            throw new Error('no git in this test');
        },
        peerBundles: () => {
            throw new Error('no bundles in this test');
        },
        worktreePaths: async () => [],
        notify: (_machineId, nodeId) => void told.push(nodeId)
    });
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-peer-handlers-'));
    const folder = join(root, 'repo');
    await mkdir(folder);
    ended = [];
    heard = [];
    launched = [];
    store = new ProjectStore(
        join(root, 'home'),
        projectLinks({
            endSession: async (kind, nodeId) => void ended.push(`${kind}:${nodeId}`),
            launches: { opened: (id) => void launched.push(id), running: () => 0, end: async () => 0 }
        }),
        projectOverlays(join(root, 'home')),
        new FakeWatch()
    );
    attested = {};
    lineage = new AgentLineageStore(join(root, 'home'));
    tasks = new TaskStore(join(root, 'home'));
    await Promise.all([lineage.load(), tasks.load()]);
    told = [];
    store.peers.subscribe('c1', (event) => void heard.push(event.event));
    dispatcher = new Dispatcher();
    peerLinksArea({
        links: store.peers,
        lineage,
        tasks: {
            openNodesOf: (machineId, project) => peerTasks.openNodesOf(machineId, project),
            tellEnded: (machineId, ids) => peerTasks.tellEnded(machineId, ids),
            lapseDeliveries: (machineId, project) => peerTasks.lapseDeliveries(machineId, project)
        },
        projects: store,
        endSession: async (kind, nodeId) => void ended.push(`${kind}:${nodeId}`),
        worktreePaths: async () => [],
        attestedUntil: async (machineId) => attested[machineId] ?? null
    }).handlers?.(dispatcher);
    projectId = (await store.openProject({ folder })).summary.projectId;
    peerTasks = makePeerTasks();
});

afterEach(async () => {
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

function ask(type: string, payload: unknown): Promise<ServerFrame> {
    return askOnce(dispatcher, { id: 'phone' }, type, payload);
}

function withPeerCanvas(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [{ id: 'own', kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 }],
                texts: [],
                edges: [],
                layouts: []
            },
            {
                kind: 'canvas',
                id: peerCanvasId('machine-a'),
                name: 'MacBook Pro',
                nodes: [
                    { id: 'remote-term', kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 },
                    { id: 'remote-chat', kind: 'chat', title: 'chat', x: 600, y: 0, w: 560, h: 360 },
                    { id: 'remote-note', kind: 'note', title: 'note', x: 0, y: 400, w: 320, h: 240, body: 'x' }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

describe('linking a project to another machine', () => {
    test('a new link is supervised, listed with the name of its project, and announced', async () => {
        expect(await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId })).toMatchObject({
            ok: true,
            result: { machineId: 'machine-a', projectId, projectName: 'repo', ceiling: 'supervised' }
        });
        expect(await ask('peer.list', {})).toMatchObject({
            ok: true,
            result: { links: [{ machineId: 'machine-a', label: 'MacBook Pro', projectName: 'repo' }] }
        });
        expect(heard).toEqual(['peer.changed']);
    });

    test('says until when the address book vouches for the machine, so a lapsed link can be made again from its side', async () => {
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId });
        await ask('peer.bind', { machineId: 'machine-b', label: 'Studio', projectId });
        attested = { 'machine-a': 1_800_000_000_000 };
        const answer = await ask('peer.list', {});
        const links = 'ok' in answer && answer.ok ? (answer.result as { links: Array<{ machineId: string; attestedUntil?: number }> }).links : [];
        expect(links.find((link) => link.machineId === 'machine-a')?.attestedUntil).toBe(1_800_000_000_000);
        expect(links.find((link) => link.machineId === 'machine-b')).not.toHaveProperty('attestedUntil');
    });

    test('a ceiling is kept, changed on request, and a link of nobody has none to change', async () => {
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId, ceiling: 'auto' });
        expect(await ask('peer.setCeiling', { machineId: 'machine-a', projectId, ceiling: 'supervised' })).toMatchObject({ ok: true });
        expect(await ask('peer.list', {})).toMatchObject({ result: { links: [{ ceiling: 'supervised' }] } });
        expect(await ask('peer.setCeiling', { machineId: 'machine-z', projectId, ceiling: 'auto' })).toMatchObject({
            ok: false,
            error: { code: 'peer-not-linked' }
        });
    });

    test('a project that is not on this machine cannot be linked', async () => {
        expect(await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId: 'nowhere' })).toMatchObject({
            ok: false,
            error: { code: 'project-not-found' }
        });
        expect(await ask('peer.list', {})).toMatchObject({ result: { links: [] } });
    });

    test('is persisted, and a restarted machine hides the canvas of the linked machine again', async () => {
        await store.save(projectId, 0, withPeerCanvas());
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId });
        expect(store.peers.canvasIdsOf(projectId)).toEqual(new Set([peerCanvasId('machine-a')]));

        const fresh = new ProjectStore(join(root, 'home'), projectLinks(), projectOverlays(join(root, 'home')), new FakeWatch());
        await fresh.peers.load();
        const document = (await fresh.openProject({ projectId })).document;
        expect(document.views.map((view) => [view.id, 'hidden' in view ? view.hidden : undefined])).toEqual([
            ['main', undefined],
            [peerCanvasId('machine-a'), true]
        ]);
        fresh.closeAll();
    });
});

describe('unlinking a project', () => {
    test('ends the sessions and chats of the machine, removes its canvas, and leaves the rest', async () => {
        await store.save(projectId, 0, withPeerCanvas());
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId });

        expect(await ask('peer.unbind', { machineId: 'machine-a', projectId })).toMatchObject({ ok: true });
        expect(ended).toEqual(['terminal:remote-term', 'chat:remote-chat']);
        expect((await store.read(projectId)).views.map((view) => view.id)).toEqual(['main']);
        expect(await ask('peer.list', {})).toMatchObject({ result: { links: [] } });
        expect(await ask('peer.unbind', { machineId: 'machine-a', projectId })).toMatchObject({ ok: false, error: { code: 'peer-not-linked' } });
    });
});

describe('the canvas of a linked machine', () => {
    test('is absent from the sidebar and cannot be shared', async () => {
        await store.save(projectId, 0, withPeerCanvas());
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId });
        const sidebar = await store.sidebar();
        expect(sidebar.projects[0]?.views?.map((view) => view.id)).toEqual(['main']);
        const content = await store.read(projectId);
        await expect(store.save(projectId, await store.revision(projectId), content, [peerCanvasId('machine-a')])).rejects.toMatchObject({
            code: 'hidden-view-shared'
        });
    });
});

describe('the nodes another machine draws here', () => {
    const TERM = { id: 'remote-term', kind: 'terminal' as const, title: 'shell' };
    const CHAT = { id: 'remote-chat', kind: 'chat' as const, title: 'chat' };

    async function linked(): Promise<void> {
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId });
    }

    const place = (nodes: unknown[], edges: unknown[] = [], extra: Record<string, unknown> = {}) =>
        ask('peer.placeNodes', { machineId: 'machine-a', projectId, nodes, edges, ...extra });

    test('goes on a canvas of its own that is hidden and private, with the ids it came with', async () => {
        await linked();
        expect(await place([TERM, CHAT], [{ id: 'e1', from: 'remote-chat', to: 'remote-term', role: 'target' }])).toMatchObject({ ok: true });
        const canvas = (await store.read(projectId)).views.find((view) => view.id === peerCanvasId('machine-a'));
        expect(canvas).toMatchObject({
            kind: 'canvas',
            name: 'MacBook Pro',
            hidden: true,
            nodes: [{ id: 'remote-term' }, { id: 'remote-chat' }],
            edges: [{ id: 'e1' }]
        });
        expect((await store.sidebar()).projects[0]?.views).toEqual([]);
        expect(await store.openProject({ projectId }).then((opened) => opened.document.shared)).toEqual([]);
    });

    test('twice is the same as once', async () => {
        await linked();
        await place([TERM, CHAT]);
        const rev = await store.revision(projectId);
        await place([TERM, CHAT]);
        expect(await store.revision(projectId)).toBe(rev);
    });

    test('ends the session of a node the other machine no longer draws, once the canvas dropped it', async () => {
        await linked();
        await place([TERM, CHAT]);
        ended.length = 0;
        await place([TERM]);
        expect(ended).toEqual(['chat:remote-chat']);
        const canvas = (await store.read(projectId)).views.find((view) => view.id === peerCanvasId('machine-a'));
        expect(canvas).toMatchObject({ nodes: [{ id: 'remote-term' }] });
    });

    test('keeps the sessions of a node it could not drop, when the write is refused', async () => {
        const own = withPeerCanvas();
        own.views = own.views.slice(0, 1);
        await store.save(projectId, await store.revision(projectId), own);
        await linked();
        await place([TERM, CHAT]);
        ended.length = 0;
        // The id of a node of this machine's own canvas: the whole write is refused, and nothing may have ended before it.
        expect(await place([{ id: 'own', kind: 'terminal', title: 'taken' }])).toMatchObject({ ok: false, error: { code: 'peer-node-taken' } });
        expect(ended).toEqual([]);
        const canvas = (await store.read(projectId)).views.find((view) => view.id === peerCanvasId('machine-a'));
        expect(canvas).toMatchObject({ nodes: [{ id: 'remote-term' }, { id: 'remote-chat' }] });
    });

    test('is a hold that starts no launch of this machine, where a person opening the project does', async () => {
        await linked();
        await place([TERM]);
        expect(launched).toEqual([]);
        expect(store.holdersOf(projectId)).toEqual(['phone']);
        store.hold('person', projectId);
        expect(launched).toEqual([projectId]);
    });

    test('keeps no line it draws to a device, so nothing here drives one over it', async () => {
        await linked();
        const PHONE = { id: 'remote-phone', kind: 'device' as const, title: 'Phone' };
        await place(
            [TERM, CHAT, PHONE],
            [
                { id: 'e1', from: 'remote-chat', to: 'remote-term' },
                { id: 'e2', from: 'remote-phone', to: 'remote-chat' }
            ]
        );
        const canvas = (await store.read(projectId)).views.find((view) => view.id === peerCanvasId('machine-a'));
        expect(canvas).toMatchObject({ edges: [{ id: 'e1' }] });
    });

    test('refuses a line with an end that is not among the nodes', async () => {
        await linked();
        expect(await place([TERM], [{ id: 'e1', from: 'remote-term', to: 'on-the-other-machine' }])).toMatchObject({
            ok: false,
            error: { code: 'edge-off-machine' }
        });
    });

    test('refuses a machine without a link, and a folder beyond the project', async () => {
        expect(await place([TERM])).toMatchObject({ ok: false, error: { code: 'peer-not-linked' } });
        await linked();
        expect(await place([{ ...TERM, cwd: tmpdir() }])).toMatchObject({ ok: false, error: { code: 'cwd-outside' } });
        expect(await place([{ ...TERM, cwd: join(root, 'repo') }])).toMatchObject({ ok: true });
    });

    test('lets the asking client hold the project; an empty place ends only the nodes of that machine, and letting go ends nothing', async () => {
        await linked();
        const send = async (nodes: unknown[]): Promise<void> => {
            await dispatcher.handle(
                { id: 'window', send: () => undefined },
                JSON.stringify({ id: 'place', type: 'peer.placeNodes', payload: { machineId: 'machine-a', projectId, nodes, edges: [] } })
            );
        };
        await send([TERM, CHAT]);
        expect(store.holdersOf(projectId)).toEqual(['window']);
        ended.length = 0;
        await send([]);
        expect(ended.sort()).toEqual(['chat:remote-chat', 'terminal:remote-term']);
        ended.length = 0;
        store.letGo('window', projectId);
        expect(ended).toEqual([]);
        expect(store.holdersOf(projectId)).toEqual([]);
    });
});

describe('the nodes of a machine and the tasks it gave share one canvas', () => {
    const TERM = { id: 'remote-term', kind: 'terminal' as const, title: 'shell' };
    const CHAT = { id: 'remote-chat', kind: 'chat' as const, title: 'chat' };
    const TASK = { id: 'task-chat', kind: 'chat' as const, title: 'Fix the lexer' };

    const give = (nodeId: string) =>
        peerTasks.start('machine-a', 'peer-client', {
            projectId,
            nodeId,
            parentId: 'parent',
            title: 'Fix the lexer',
            prompt: 'Fix it',
            provider: 'claude',
            ceiling: 'full-access',
            depth: 1
        });

    const place = (nodes: unknown[]) => ask('peer.placeNodes', { machineId: 'machine-a', projectId, nodes, edges: [] });

    async function canvasNodes(): Promise<Array<{ id: string; cwd?: string; providerFixed?: boolean }>> {
        const canvas = (await store.read(projectId)).views.find((view) => view.id === peerCanvasId('machine-a'));
        return (canvas as unknown as { nodes: Array<{ id: string; cwd?: string; providerFixed?: boolean }> }).nodes.toSorted((first, second) =>
            first.id.localeCompare(second.id)
        );
    }

    beforeEach(async () => {
        await ask('peer.bind', { machineId: 'machine-a', label: 'MacBook Pro', projectId });
    });

    test('a window that draws other nodes keeps the node and the settings of a task', async () => {
        await give('task-chat');
        await place([TERM, TASK]);
        const nodes = await canvasNodes();
        expect(nodes.map((node) => node.id).sort()).toEqual(['remote-term', 'task-chat']);
        expect(nodes.find((node) => node.id === 'task-chat')).toMatchObject({ providerFixed: true, cwd: join(root, 'repo') });
        await place([TERM]);
        expect(await canvasNodes()).toHaveLength(2);
    });

    test('a window draws no line to a task the machine gave', async () => {
        await give('task-chat');
        await ask('peer.placeNodes', {
            machineId: 'machine-a',
            projectId,
            nodes: [TERM, TASK],
            edges: [{ id: 'e1', from: 'remote-term', to: 'task-chat' }]
        });
        const canvas = (await store.read(projectId)).views.find((view) => view.id === peerCanvasId('machine-a'));
        expect(canvas).toMatchObject({ edges: [] });
    });

    test('a window that closes with nothing to draw ends its own nodes and leaves the task running', async () => {
        await give('task-chat');
        await place([TERM, CHAT, TASK]);
        ended.length = 0;
        await place([]);
        expect(ended.sort()).toEqual(['chat:remote-chat', 'terminal:remote-term']);
        expect(await canvasNodes()).toMatchObject([{ id: 'task-chat', providerFixed: true }]);
        expect(lineage.peerOf('task-chat')).toEqual({ machineId: 'machine-a' });
        expect(tasks.all()).toMatchObject([{ childId: 'task-chat', status: 'open' }]);
    });

    test('a task takes over the node the window placed for it, and the window cannot rewrite it afterwards', async () => {
        await place([TERM, CHAT]);
        await give('remote-chat');
        expect(await canvasNodes()).toMatchObject([{ id: 'remote-chat', providerFixed: true }, { id: 'remote-term' }]);
        ended.length = 0;
        await place([TERM]);
        expect(ended).toEqual([]);
        expect(await canvasNodes()).toMatchObject([{ id: 'remote-chat', providerFixed: true }, { id: 'remote-term' }]);
    });

    test('a person can close the project once the tasks of the machine are done', async () => {
        tasks.onChange((task) => peerTasks.changed(task));
        await peerTasks.start('machine-a', 'peer-client', {
            projectId,
            nodeId: 'task-chat',
            parentId: 'parent',
            title: 'Fix the lexer',
            prompt: 'Fix it',
            provider: 'claude',
            ceiling: 'full-access',
            depth: 1
        });
        expect(store.holdersOf(projectId)).toEqual(['peer-client']);
        await tasks.settle(tasks.all()[0]!.id, 'done', { text: 'ok', source: 'turn', at: 1 }, 2);
        expect(store.holdersOf(projectId)).toEqual([]);
        store.hold('person', projectId);
        expect(await store.closeProject(projectId, 'person')).toMatchObject({ otherClients: 0 });
    });

    test('unlinking the project tells the machine which of its open tasks ended with the link', async () => {
        await give('task-chat');
        await give('second-chat');
        await tasks.settle(tasks.all()[1]!.id, 'done', { text: 'ok', source: 'turn', at: 1 }, 2);
        told.length = 0;
        expect(await ask('peer.unbind', { machineId: 'machine-a', projectId })).toMatchObject({ ok: true });
        expect(told).toContain('task-chat');
        expect(told).not.toContain('second-chat');
    });

    test('a task never takes over a node a person placed, and the window never rewrites or ends it', async () => {
        await store.save(projectId, await store.revision(projectId), withPeerCanvas());
        await expect(give('remote-term')).rejects.toMatchObject({ code: 'peer-node-taken' });
        expect(lineage.peerOf('remote-term')).toBeNull();
        expect(tasks.all()).toHaveLength(0);
        expect(await place([{ ...TERM, title: 'rewritten' }])).toMatchObject({ ok: true });
        expect(ended).toEqual([]);
        expect((await canvasNodes()).map((node) => node.id)).toEqual(['remote-chat', 'remote-note', 'remote-term']);
        expect(((await canvasNodes())[2] as { title?: string }).title).toBe('shell');
    });
});
